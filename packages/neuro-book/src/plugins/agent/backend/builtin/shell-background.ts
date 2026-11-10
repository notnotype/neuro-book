/**
 * 后台命令（docs/specs/agent/jobs.md 输出 7、8）：`shell` 带 `async` 时命令登记成任务，用自己的取消信号跑，父会话的运行被中止不影响它。
 * 输出边跑边追加到会话的 `home/jobs/<任务 id>/output.log`（宿主写、Agent 只读，resources.md 输出 12），至多 64 MiB；结束时同一目录写
 * `status.json`。任务的结果等 `wait` 交回时才从这两个文件读，内存里只留最后一行。
 *
 * 输出回调不等异步（同前台的 `shell`）：文件用同步写。
 */

import {closeSync, mkdirSync, openSync, writeFileSync, writeSync} from "node:fs";
import {join} from "node:path";

import {executeShell} from "@oh-my-pi/pi-natives";

import type {CommandStatus} from "../../shared/subagents";
import type {Job, JobCenter} from "../jobs/center";
import {capLines, headAndTail, LINE_BYTES, lineCount, OUTPUT_LIMIT, PART_BYTES, WINDOW_BYTES, WINDOW_LINES} from "./shell-window";

export const OUTPUT_FILE = "output.log";
export const STATUS_FILE = "status.json";


export interface BackgroundCommand {
    readonly command: string;
    readonly cwd: string;
    readonly env: Readonly<Record<string, string>>;
    readonly timeoutMs?: number;
}

/** 后台命令的输出目录：`<会话工作区>/jobs/<任务 id>`。 */
export const jobDirectory = (sessionHome: string, jobId: string): string => join(sessionHome, "jobs", jobId);
export const jobOutputAddress = (sessionId: string, jobId: string): string => `sessions://${sessionId}/home/jobs/${jobId}/${OUTPUT_FILE}`;

/** 最后一行给远程与卡片看，截到一行的上限。 */
const shortLine = (line: string): string => (Buffer.byteLength(line, "utf8") <= LINE_BYTES ? line : `${Buffer.from(line, "utf8").subarray(0, LINE_BYTES).toString("utf8").replace(/�+$/u, "")}…`);

/**
 * 建好输出目录与文件、登记驱动并开始跑。目录或文件建不成时抛错，调用方退回名额；之后的失败都记进 `status.json` 与任务的终态。
 */
export function startBackgroundCommand(jobs: JobCenter, job: Job, directory: string, address: string, command: BackgroundCommand, clock: {now(): number}): void {
    mkdirSync(directory, {recursive: true});
    const fd = openSync(join(directory, OUTPUT_FILE), "wx", 0o600);
    const controller = new AbortController();
    let interrupted = false;
    let bytes = 0;
    let lines = 0;
    let truncated = false;
    /** 还没换行的最后一段；输出以换行结尾时它是空的，最后一行看 `lastComplete`。 */
    let partial = "";
    let lastComplete = "";
    let problem: string | null = null;

    const take = (chunk: string) => {
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
        const parts = (partial + chunk).split("\n");
        partial = parts.pop()!;
        lines += parts.length;
        const complete = parts.filter((part) => part.trim() !== "").at(-1);
        if (complete !== undefined) lastComplete = complete;
        const last = partial.trim() === "" ? lastComplete : partial;
        if (last !== "" && last !== job.lastLine) jobs.progress(job, shortLine(last));
    };

    const done = executeShell({command: command.command, cwd: command.cwd, env: {...command.env}, ...(command.timeoutMs === undefined ? {} : {timeoutMs: command.timeoutMs}), signal: controller.signal}, (error, chunk) => {
        if (error !== null) problem ??= error.message;
        else take(chunk);
    }).then(
        (result) => {
            const state: CommandStatus["state"] = result.cancelled ? (interrupted ? "interrupted" : "aborted") : result.timedOut || result.exitCode !== 0 ? "failed" : "completed";
            return {state, exitCode: result.exitCode ?? null, timedOut: result.timedOut};
        },
        (error: unknown) => {
            problem ??= error instanceof Error ? error.message : String(error);
            return {state: "failed" as const, exitCode: null, timedOut: false};
        },
    ).then(({state, exitCode, timedOut}) => {
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
        jobs.end(job, state, {reason: state, ...(exitCode === null ? {} : {exitCode}), lines: total, ...(job.lastLine === undefined ? {} : {line: job.lastLine})});
    });

    jobs.start(job, {
        // 插件停止时按 interrupted 记（jobs.md 输出 8），否则是被停掉；等命令收口、`status.json` 写完再返回。
        kill: async (reason) => {
            interrupted = reason === "interrupted";
            controller.abort();
            await done;
        },
        result: () => commandResult(job.id, directory, address, problem),
    });
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
