/**
 * 后台命令（docs/specs/agent/jobs.md 输出 7、8）：`shell` 带 `async` 时命令登记成任务，用自己的取消信号跑，父会话的运行被中止不影响它。
 * 输出边跑边追加到会话的 `home/jobs/<任务 id>/output.log`（宿主写、Agent 只读，resources.md 输出 12），至多 64 MiB；结束时同一目录写
 * `status.json`。任务的结果等 `wait` 交回时才从这两个文件读，内存里只留最后一行。
 *
 * 输出回调不等异步（同前台的 `shell`）：文件用同步写。
 */

import {closeSync, copyFileSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync, writeSync} from "node:fs";
import {dirname, join} from "node:path";

import {executeShell} from "@oh-my-pi/pi-natives";

import type {Clock, ToolResult} from "@notnotype/nb-harness/kernel/contracts";
import {failed} from "@notnotype/nb-harness/kit/files";
import {capLine, capLines, DEFAULT_TIMEOUT_SECONDS, headAndTail, LINE_BYTES, lineCount, OUTPUT_LIMIT, PART_BYTES, WINDOW_BYTES, WINDOW_LINES} from "@notnotype/nb-harness/kit/tools";
import type {OutputSoFar, ShellAutoBackground, ShellBackground} from "@notnotype/nb-harness/kit/tools";

import type {CommandStatus} from "../../shared/subagents";
import type {Job, JobCenter} from "../jobs/center";

export const OUTPUT_FILE = "output.log";
export const STATUS_FILE = "status.json";


export interface BackgroundCommand {
    readonly command: string;
    readonly cwd: string;
    readonly env: Readonly<Record<string, string>>;
    readonly timeoutMs?: number;
}

/**
 * 套件 `shell` 的后台实现：登记任务、建好输出文件就交回（jobs.md 输出 7）；命令用任务自己的信号跑，不写 `timeout` 就不设超时。
 * `clock` 给 `status.json` 的结束时刻。
 */
export function shellBackground(jobs: JobCenter, clock: {now(): number}): ShellBackground {
    return async (prepared, {args, call, context, files}): Promise<ToolResult> => {
        const home = await files.readPath("session://", {signal: call.signal});
        if (!home.ok) return failed("unavailable", "unavailable: 会话工作区不可用，后台命令的输出没处写。");
        const command = args.command as string;
        const reserved = jobs.reserve(context.sessionId, "shell", call.invocation, command.length <= 80 ? command : `${command.slice(0, 80)}…`);
        if (!reserved.ok) {
            if (reserved.code === "unavailable") return failed("unavailable", "unavailable: nbook.agent 正在停止，不能再起后台命令。");
            return {...failed("concurrency-limit", "concurrency-limit: 整个应用同时在跑的任务已经到上限；在前台跑，或稍后再试。"), details: {code: "concurrency-limit", scope: reserved.scope}};
        }
        const job = reserved.job;
        const address = jobOutputAddress(context.sessionId, job.id);
        try {
            startBackgroundCommand(jobs, job, jobDirectory(home.value.path, job.id), address, {command: prepared.command, cwd: prepared.cwd, env: prepared.env, ...(typeof args.timeout === "number" ? {timeoutMs: args.timeout * 1000} : {})}, clock);
        } catch (error) {
            jobs.release(job);
            return failed("job-start-failed", `job-start-failed: 后台命令的输出文件建不成（${error instanceof Error ? error.message : String(error)}），命令没有执行。`);
        }
        return {text: `已转到后台：任务 ${job.id}。输出边跑边写进 ${address}，结束后同一目录有 status.json。用 wait 等它，kill 停掉。`, details: {jobId: job.id, invocation: call.invocation, output: address}};
    };
}

/** 后台命令的输出目录：`<会话工作区>/jobs/<任务 id>`。 */
export const jobDirectory = (sessionHome: string, jobId: string): string => join(sessionHome, "jobs", jobId);
export const jobOutputAddress = (sessionId: string, jobId: string): string => `sessions://${sessionId}/home/jobs/${jobId}/${OUTPUT_FILE}`;

/** 内存里只留还没换行的那段的尾部（够截出最后一行）：输出一直不换行（`\r` 刷新的进度、二进制）也不会累积。 */
const PARTIAL_CHARS = LINE_BYTES * 2;
/** 最后一行变了，至多每隔这么久报一次（每次都会唤醒等它的调用与远程推送）。 */
const PROGRESS_MS = 250;

const tailOf = (text: string): string => (text.length > PARTIAL_CHARS ? text.slice(-PARTIAL_CHARS) : text);

/** 命令收口的样子：状态、退出码、是否超时。 */
interface CommandEnd {
    readonly state: CommandStatus["state"];
    readonly exitCode: number | null;
    readonly timedOut: boolean;
}

/**
 * 一条后台命令的输出记录：往 `fd` 同步追加（至多 64 MiB）、数字节与行、记最后一行并报进度；收口时关文件、写 `status.json`、报任务的终态。
 * `async` 的命令从零开始用它；自动转后台的接上暂存已有的统计（`initial`）。
 */
function commandOutput(jobs: JobCenter, job: Job, fd: number, directory: string, clock: {now(): number}, initial: {readonly bytes: number; readonly lines: number; readonly tail: string; readonly truncated: boolean} = {bytes: 0, lines: 0, tail: "", truncated: false}) {
    let bytes = initial.bytes;
    let lines = initial.lines;
    let truncated = initial.truncated;
    /** 还没换行的最后一段（只留尾部）；输出以换行结尾时它是空的，最后一行看 `lastComplete`。 */
    const cut = initial.tail.split("\n");
    let partial = tailOf(cut.at(-1) ?? "");
    let lastComplete = tailOf(cut.slice(0, -1).filter((part) => part.trim() !== "").at(-1) ?? "");
    let problem: string | null = null;
    let reportedAt = Number.NEGATIVE_INFINITY;
    const lastLine = (): string => capLine((partial.trim() === "" ? lastComplete : partial).trimEnd());
    return {
        take(chunk: string): void {
            const encoded = Buffer.from(chunk, "utf8");
            const room = OUTPUT_LIMIT - bytes;
            if (room > 0) {
                const taken = encoded.length > room ? encoded.subarray(0, room) : encoded;
                try {
                    writeSync(fd, taken);
                } catch (error) {
                    problem ??= error instanceof Error ? error.message : String(error);
                }
                bytes += taken.length;
                if (taken.length < encoded.length) truncated = true;
            } else truncated = true;
            // 只切这一块：开头接上留着的尾部，各段都有界。
            const segments = chunk.split("\n");
            if (segments.length === 1) partial = tailOf(partial + chunk);
            else {
                lines += segments.length - 1;
                const complete = [partial + segments[0]!, ...segments.slice(1, -1)].filter((part) => part.trim() !== "").at(-1);
                if (complete !== undefined) lastComplete = tailOf(complete);
                partial = tailOf(segments.at(-1)!);
            }
            const last = lastLine();
            const now = clock.now();
            if (last !== "" && last !== job.lastLine && now - reportedAt >= PROGRESS_MS) {
                reportedAt = now;
                jobs.progress(job, last);
            }
        },
        fail(message: string): void {
            problem ??= message;
        },
        problem: (): string | null => problem,
        finish({state, exitCode, timedOut}: CommandEnd): void {
            try {
                closeSync(fd);
            } catch {
                // 关不上不影响结果：内容已经同步写进去了。
            }
            const total = lines + (partial === "" ? 0 : 1);
            const status: CommandStatus = {state, exitCode, lines: total, bytes, truncated, timedOut, endedAt: clock.now()};
            try {
                writeFileSync(join(directory, STATUS_FILE), JSON.stringify(status));
            } catch (error) {
                problem ??= `status.json: ${error instanceof Error ? error.message : String(error)}`;
            }
            const last = lastLine();
            jobs.end(job, state, {reason: state, ...(exitCode === null ? {} : {exitCode}), lines: total, ...(last === "" ? {} : {line: last})});
        },
    };
}

/** `executeShell` 的结局换成命令的终态；`interrupted` 是插件停止时停的。 */
const endOf = (result: {readonly cancelled: boolean; readonly timedOut: boolean; readonly exitCode?: number | null}, interrupted: boolean): CommandEnd => ({
    state: result.cancelled ? (interrupted ? "interrupted" : "aborted") : result.timedOut || result.exitCode !== 0 ? "failed" : "completed",
    exitCode: result.exitCode ?? null,
    timedOut: result.timedOut,
});

/**
 * 建好输出目录与文件、登记驱动并开始跑。目录或文件建不成时抛错，调用方退回名额；之后的失败都记进 `status.json` 与任务的终态。
 */
export function startBackgroundCommand(jobs: JobCenter, job: Job, directory: string, address: string, command: BackgroundCommand, clock: {now(): number}): void {
    mkdirSync(directory, {recursive: true});
    const fd = openSync(join(directory, OUTPUT_FILE), "wx", 0o600);
    const output = commandOutput(jobs, job, fd, directory, clock);
    const controller = new AbortController();
    let interrupted = false;
    const done = executeShell({command: command.command, cwd: command.cwd, env: {...command.env}, ...(command.timeoutMs === undefined ? {} : {timeoutMs: command.timeoutMs}), signal: controller.signal}, (error, chunk) => {
        if (error !== null) output.fail(error.message);
        else output.take(chunk);
    }).then((result) => endOf(result, interrupted), (error: unknown) => {
        output.fail(error instanceof Error ? error.message : String(error));
        return {state: "failed" as const, exitCode: null, timedOut: false};
    }).then((end) => output.finish(end));

    jobs.start(job, {
        // 插件停止时按 interrupted 记（jobs.md 输出 8），否则是被停掉；等命令收口、`status.json` 写完再返回。
        kill: async (reason) => {
            interrupted = reason === "interrupted";
            controller.abort();
            await done;
        },
        result: () => commandResult(job.id, directory, address, output.problem()),
        address,
    });
}

type Report = (code: string, message: string, data?: Readonly<Record<string, unknown>>) => void;

/**
 * 把套件交出的到此刻的输出接成任务的输出文件 `target`，交回往后追加用的描述符与接过之后的收尾。还没超出窗口的是内存里的文字，写进新文件；
 * 超出之后是系统临时目录里的暂存：改名接过（同一文件系统上不拷贝），改名不成就拷贝一份再接着写新文件。收尾（关掉
 * 套件的描述符、删暂存目录）放到接手的最后一步：之前抛错时暂存仍归套件，由它关、由它删。
 */
function adoptOutput(output: OutputSoFar, target: string): {readonly fd: number; readonly settle: () => void} {
    if (output.spool === null) {
        const fd = openSync(target, "wx", 0o600);
        try {
            if (output.text !== null && output.text !== "") writeSync(fd, output.text);
        } catch (error) {
            closeSync(fd);
            throw error;
        }
        return {fd, settle: () => {}};
    }
    const spool = output.spool;
    const directory = dirname(spool.path);
    try {
        renameSync(spool.path, target);
        return {fd: spool.fd, settle: () => rmSync(directory, {recursive: true, force: true})};
    } catch {
        // 跨文件系统（`EXDEV`）或平台不许给打开着的文件改名：拷贝；拷贝也不成就抛出那个错。
    }
    copyFileSync(spool.path, target);
    const fd = openSync(target, "a");
    return {
        fd,
        settle: () => {
            closeSync(spool.fd);
            rmSync(directory, {recursive: true, force: true});
        },
    };
}

/**
 * 前台的 `shell` 跑过门槛自动转后台（builtin-tools.md 的自动转后台）：门槛是设置 `shellAutoBackground` 的秒数，0 为不转；子会话里不转；
 * 命令的时限不长于门槛的不转（跑不到门槛就结束了）。接手时登记任务、接过到此刻的输出（`adoptOutput`），此后的输出接着追加，时限照旧。
 * 名额满时照常留在前台；其它接不了的原因记诊断、抛给套件写进前台的结果。
 */
export function shellAutoBackground(jobs: JobCenter, clock: Clock & {now(): number}, options: {readonly seconds: () => number; readonly isChild: (sessionId: string) => boolean; readonly report: Report}): ShellAutoBackground {
    const failure = (code: string, message: string, data: Readonly<Record<string, unknown>>): Error => {
        options.report(code, message, data);
        return new Error(message);
    };
    return {
        threshold: ({args, context}, signal) => {
            const seconds = options.seconds();
            if (seconds === 0 || options.isChild(context.sessionId)) return null;
            const timeout = typeof args.timeout === "number" ? args.timeout : DEFAULT_TIMEOUT_SECONDS;
            if (timeout <= seconds) return null;
            return clock.wait(seconds * 1000, signal);
        },
        prepare: async ({args, call, context, files}) => {
            const home = await files.readPath("session://", {signal: call.signal});
            if (!home.ok) throw failure("shell-auto-background-failed", `the session home is unavailable: ${home.code}`, {session: context.sessionId, code: home.code});
            const command = args.command as string;
            const reserved = jobs.reserve(context.sessionId, "shell", call.invocation, command.length <= 80 ? command : `${command.slice(0, 80)}…`);
            // 名额满、插件正在停止：不是故障，照常留在前台。
            if (!reserved.ok) return null;
            const job = reserved.job;
            const directory = jobDirectory(home.value.path, job.id);
            const address = jobOutputAddress(context.sessionId, job.id);
            try {
                mkdirSync(directory, {recursive: true});
            } catch (error) {
                jobs.release(job);
                throw failure("shell-auto-background-failed", `the job directory could not be created: ${error instanceof Error ? error.message : String(error)}`, {session: context.sessionId, job: job.id});
            }
            return {
                take: (handover) => {
                    let adopted: ReturnType<typeof adoptOutput>;
                    try {
                        adopted = adoptOutput(handover.output, join(directory, OUTPUT_FILE));
                    } catch (error) {
                        throw failure("shell-auto-background-failed", `the output so far could not be taken over: ${error instanceof Error ? error.message : String(error)}`, {session: context.sessionId, job: job.id});
                    }
                    const so = handover.output;
                    const output = commandOutput(jobs, job, adopted.fd, directory, clock, {bytes: so.bytes, lines: so.lines, tail: so.tail, truncated: so.full});
                    let interrupted = false;
                    const done = handover.done.then((result) => endOf(result, interrupted), (error: unknown) => {
                        output.fail(error instanceof Error ? error.message : String(error));
                        return {state: "failed" as const, exitCode: null, timedOut: false};
                    }).then((end) => output.finish(end));
                    jobs.start(job, {
                        kill: async (reason) => {
                            interrupted = reason === "interrupted";
                            handover.abort();
                            await done;
                        },
                        result: () => commandResult(job.id, directory, address, output.problem()),
                        address,
                    });
                    adopted.settle();
                    const lines = so.tail.split("\n").filter((line) => line.trim() !== "").slice(-5).join("\n");
                    const timeout = typeof args.timeout === "number" ? args.timeout : DEFAULT_TIMEOUT_SECONDS;
                    return {
                        sink: (error, chunk) => (error !== null ? output.fail(error.message) : output.take(chunk)),
                        result: {
                            text: `跑了 ${String(options.seconds())} 秒还没结束，已转到后台：任务 ${job.id}，时限照旧（${String(timeout)} 秒）。${lines === "" ? "" : `到目前为止的最后几行：\n${lines}\n`}全文写进 ${address}。结束时回执会自动送来，不用 wait 轮询。`,
                            details: {jobId: job.id, invocation: call.invocation, output: address, autoBackground: true},
                        },
                    };
                },
                discard: () => {
                    jobs.release(job);
                    rmSync(directory, {recursive: true, force: true});
                },
            };
        },
    };
}

const STATE_TEXT: Readonly<Record<CommandStatus["state"], string>> = {completed: "完成", failed: "失败", aborted: "已停止", interrupted: "已中断（应用停止时它在跑）"};

/** 读 `status.json`；没有或读不了时为 null。 */
export async function readStatus(directory: string): Promise<CommandStatus | null> {
    try {
        return JSON.parse(await Bun.file(join(directory, STATUS_FILE)).text()) as CommandStatus;
    } catch {
        return null;
    }
}

/** 结束后交给模型的结果：状态加输出窗口（同前台 `shell` 的截断规则），全文在输出文件里。 */
async function commandResult(jobId: string, directory: string, address: string, problem: string | null): Promise<string> {
    const status = await readStatus(directory);
    const file = Bun.file(join(directory, OUTPUT_FILE));
    const size = file.size;
    let window: string;
    if (size <= WINDOW_BYTES) {
        const text = await file.text();
        window = lineCount(text) <= WINDOW_LINES ? capLines(text) : headAndTail(text.slice(0, PART_BYTES), text.slice(-PART_BYTES), size);
    } else {
        window = headAndTail(await file.slice(0, PART_BYTES).text(), await file.slice(size - PART_BYTES).text(), size);
    }
    const head = status === null
        ? `[后台命令 ${jobId}：没有 status.json]`
        : `[后台命令 ${jobId}：${STATE_TEXT[status.state]}${status.timedOut ? "（超时）" : ""}，退出码 ${String(status.exitCode ?? "未知")}，${String(status.lines)} 行]`;
    const notes = [
        `全文：${address}${status?.truncated === true ? "（超过 64 MiB，后面的没有写进去）" : ""}`,
        ...(problem === null ? [] : [`读写输出时出错：${problem}`]),
    ];
    return [head, ...(window === "" ? [] : [window.endsWith("\n") ? window.slice(0, -1) : window]), ...notes].join("\n");
}
