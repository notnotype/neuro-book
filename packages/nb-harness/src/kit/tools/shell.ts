/**
 * `shell`（docs/specs/agent/builtin-tools.md 输出 18–22）：`pi-natives` 内嵌的 brush shell。套件只管前台；宿主给了 `ShellBackground` 时
 * `async: true` 的命令准备好之后交给宿主转后台（任务的登记、寿命与输出文件是宿主的事）。
 *
 * 输出的回调不等异步，所以回调里只做同步的事（同 omp 的 `OutputSink`）：内存里留开头与结尾，放不下之后同步追加到一个本地临时文件；命令
 * 结束后才把它拷进 `artifacts/`。这样暂存目录不可用不影响命令执行，命令也不会因为保存失败而跑第二遍。
 */

import {join} from "node:path";

import {executeShell} from "@oh-my-pi/pi-natives";

import type {ToolContext, ToolResult, ToolSessionContext} from "../../kernel/contracts.js";
import {commandEffect} from "../commands/index.js";
import type {Dialects} from "../commands/index.js";
import {failure} from "../files/index.js";
import type {KitServices, SessionFiles} from "../files/index.js";
import {findAddresses, substitute} from "./shell-address.js";
import {OutputCapture, saveFullOutput, type OutputSoFar} from "./output-capture.js";
import type {KitToolDeclaration, KitToolImplementation} from "./types.js";

/** 前台 `shell` 缺省的时限（秒）；自动转后台照它判门槛。 */
export const DEFAULT_TIMEOUT_SECONDS = 300;
const MAX_TIMEOUT_SECONDS = 3_600;

/**
 * 整段说明由宿主给：工作目录、哪些地址会换成路径、环境变量、全文存哪里都是宿主的事实。`background` 为真时多一个 `async` 参数，
 * 宿主要同时给 `shellTool` 后台的实现。
 */
export const shellDeclaration = (description: string, options: {readonly background?: boolean} = {}): KitToolDeclaration => ({
    description,
    parameters: {
        type: "object",
        properties: {
            command: {type: "string"},
            ...(options.background === true
                ? {
                    timeout: {type: "integer", minimum: 1, maximum: MAX_TIMEOUT_SECONDS, description: `超时秒数，前台缺省 ${String(DEFAULT_TIMEOUT_SECONDS)}；后台不写就不设超时`},
                    async: {type: "boolean", description: "为 true 时转后台：命令照常跑，输出边跑边写进文件"},
                }
                : {timeout: {type: "integer", minimum: 1, maximum: MAX_TIMEOUT_SECONDS, description: `超时秒数，缺省 ${String(DEFAULT_TIMEOUT_SECONDS)}`}}),
        },
        required: ["command"],
    },
    version: options.background === true ? "2" : "1",
    concurrency: "exclusive",
    effect: "exec",
});

/**
 * 收集输出：放得进窗口就只在内存里；放不下（总量、行数或单行超限）之后内存只留开头与结尾，全文进本地临时文件。
 * 开头常有报错，结尾常有结论，两头都留（同 omp）。
 */
/**
 * 全局地址定位成真实路径；目标不存在时从最近的已存在祖先接上余下的段（`mkdir`、重定向的目标），不预先建任何东西。
 * 祖先一直问到方案根（`user://new.txt` 的祖先是 `user://`）；虚拟方案的根没有真实路径，这时交回第一次的 `not-found`，原因才对得上。
 */
async function locate(files: SessionFiles, address: string, signal: AbortSignal): Promise<{readonly path: string} | {readonly failure: ToolResult}> {
    const prefix = address.slice(0, address.indexOf("://") + 3);
    const segments = address.slice(prefix.length).split("/");
    const missing: string[] = [];
    let firstMissing: ToolResult | null = null;
    for (;;) {
        const located = await files.readPath(prefix + segments.join("/"), {signal});
        if (located.ok) return {path: join(located.value.path, ...missing)};
        const problem = failure({code: located.code, detail: `${address}：${located.detail}`});
        if (located.code !== "not-found" || segments.length === 0) return {failure: firstMissing ?? problem};
        firstMissing ??= problem;
        missing.unshift(segments.pop() as string);
    }
}

/** 换掉命令里的地址。方案是否已登记问资源视图：`https://`、`git://` 这些得 `unknown-scheme`，原样留着。 */
async function replaceAddresses(files: SessionFiles, command: string, signal: AbortSignal): Promise<{readonly command: string} | {readonly failure: ToolResult}> {
    const found = findAddresses(command);
    const known = new Map<string, boolean>();
    const replacements: (string | null)[] = [];
    for (const item of found) {
        const scheme = item.address.slice(0, item.address.indexOf("://"));
        let registered = known.get(scheme);
        if (registered === undefined) {
            const probe = await files.readPath(`${scheme}://`, {signal});
            registered = probe.ok || probe.code !== "unknown-scheme";
            known.set(scheme, registered);
        }
        if (!registered) {
            replacements.push(null);
            continue;
        }
        // shell 里常写 `ls project://dir/`、`cp a session://dir/`：地址规则不收末尾的斜杠，去掉再补回。
        const trailing = item.address.endsWith("/") && !item.address.endsWith("://");
        const expanded = files.expand(trailing ? item.address.slice(0, -1) : item.address);
        if (!expanded.ok) return {failure: failure({code: expanded.code, detail: `${item.address}：${expanded.detail}，命令没有执行`})};
        const located = await locate(files, expanded.address, signal);
        if ("failure" in located) return located;
        replacements.push(trailing ? `${located.path}/` : located.path);
    }
    return {command: substitute(command, found, replacements)};
}

async function realPathOf(files: SessionFiles, address: string, signal: AbortSignal): Promise<string | null> {
    const located = await files.readPath(address, {signal});
    return located.ok ? located.value.path : null;
}

/** 命令准备好之后的样子：地址换成了本机路径，工作目录与环境变量定好了。 */
export interface PreparedCommand {
    readonly command: string;
    readonly cwd: string;
    readonly env: Readonly<Record<string, string>>;
}

/**
 * 宿主给了它，`async: true` 的命令转后台：套件把命令准备好就交给它，由它登记任务、起命令、交回结果（例如任务 id 与输出文件的地址）。
 * 交回之后命令与这次调用无关：父会话的运行被中止不影响它。
 */
export type ShellBackground = (prepared: PreparedCommand, request: {readonly args: Readonly<Record<string, unknown>>; readonly call: ToolContext; readonly context: ToolSessionContext; readonly files: SessionFiles}) => ToolResult | Promise<ToolResult>;

/** 前台的命令跑过门槛就转后台（host-kit.md 的自动转后台）：宿主给门槛，接手时登记任务、接过到此刻的输出。 */
export interface ShellAutoBackground {
    /**
     * 这次调用要不要自动转：交回门槛（到点完成的 Promise，用宿主的时钟计；`signal` 中止时它不再完成）；null 表示不转（设置为 0、子会话）。
     * 代码里调的套件先排除。
     */
    threshold(request: {readonly args: Readonly<Record<string, unknown>>; readonly call: ToolContext; readonly context: ToolSessionContext}, signal: AbortSignal): Promise<void> | null;
    /** 接手的第一步（异步）：占任务 id 与名额、建好输出目录。交回 null（例如名额满）或失败时命令留在前台；失败的原因写进前台的结果。 */
    prepare(request: {readonly prepared: PreparedCommand; readonly args: Readonly<Record<string, unknown>>; readonly call: ToolContext; readonly context: ToolSessionContext; readonly files: SessionFiles}): Promise<BackgroundTarget | null>;
}

export interface BackgroundTarget {
    /**
     * 同步：把到此刻的输出接成任务的输出记录（内存里的文字写进自己的文件，暂存文件改名或拷贝接过）、交回从此接收输出的出口与给模型的结果。
     * 抛错时命令留在前台，暂存仍归套件、原因写进前台的结果。
     */
    take(handover: ShellHandover): {readonly sink: (error: Error | null, chunk: string) => void; readonly result: ToolResult};
    /** 没用上（命令已结束、调用已中止、`take` 失败）：退回名额、删掉建好的目录。 */
    discard(): void;
}

/** 移交给后台的一条命令：到此刻的输出、命令结束的 Promise（时限照旧）、停它的办法。 */
export interface ShellHandover {
    readonly prepared: PreparedCommand;
    readonly output: OutputSoFar;
    readonly done: Promise<ShellOutcome>;
    abort(): void;
}

/** 命令结束时的样子（退出码、超时、被取消），同 `executeShell` 交回的。 */
export type ShellOutcome = Awaited<ReturnType<typeof executeShell>>;

async function run(context: ToolSessionContext, {files, artifacts}: KitServices, args: Readonly<Record<string, unknown>>, call: ToolContext, background: ShellBackground | undefined, auto: ShellAutoBackground | undefined): Promise<ToolResult> {
    const signal = call.signal;
    const cwd = await files.readPath(files.layout.working, {signal});
    if (!cwd.ok) return failure(cwd);
    const replaced = await replaceAddresses(files, args.command as string, signal);
    if ("failure" in replaced) return replaced.failure;
    // 布局给的变量按先后求本机路径；定位不到的不设（host-kit.md 输出 10）。
    const env: Record<string, string> = {};
    for (const [name, address] of Object.entries(files.layout.shellEnv)) {
        const path = await realPathOf(files, address, signal);
        if (path !== null) env[name] = path;
    }

    // 代码里调的 shell 不转后台（builtin-tools.md 输出 29）：后台命令的寿命超出那段代码，结果也没人去取。
    if (args.async === true && call.within !== undefined) return {text: "代码里调的 shell 不能转后台（async）：去掉 async 在前台跑，或者直接调 shell。", status: "error", code: "async-in-code"};
    if (args.async === true && background !== undefined) return background({command: replaced.command, cwd: cwd.value.path, env}, {args, call, context, files});

    // 自动转后台只对模型直接调的（代码里调的寿命跟着那段代码）。门槛的等待在命令结束时取消。
    const thresholdStop = new AbortController();
    const plan = call.within === undefined ? auto?.threshold({args, call, context}, thresholdStop.signal) ?? null : null;
    const capture = new OutputCapture();
    // 命令用自己的信号跑，接手之前跟着这次调用的；接手时断开，父会话的运行被中止不再影响它。
    const command = new AbortController();
    const follow = () => command.abort();
    signal.addEventListener("abort", follow, {once: true});
    if (signal.aborted) command.abort();
    let sink = (error: Error | null, chunk: string) => {
        if (error !== null) capture.chunkProblem = error.message;
        else capture.push(chunk);
    };
    const prepared: PreparedCommand = {command: replaced.command, cwd: cwd.value.path, env};
    let handedOver = false;
    /** 想转后台却没转成的原因（宿主抛错）：写进前台的结果，模型知道这条命令为什么一直占着前台。 */
    let notMoved: string | null = null;
    try {
        let finished = false;
        const done = executeShell({
            command: replaced.command,
            cwd: cwd.value.path,
            env,
            timeoutMs: ((args.timeout as number | undefined) ?? DEFAULT_TIMEOUT_SECONDS) * 1000,
            signal: command.signal,
        }, (error, chunk) => sink(error, chunk)).finally(() => {
            finished = true;
        });
        if (plan !== null && auto !== undefined) {
            const first = await Promise.race([done.then(() => "done" as const, () => "done" as const), plan.then(() => "threshold" as const)]);
            if (first === "threshold") {
                const target = await auto.prepare({prepared, args, call, context, files}).catch((error: unknown) => {
                    notMoved = error instanceof Error ? error.message : String(error);
                    return null;
                });
                // 一个同步步骤：命令这期间结束了、调用中止了，就照前台交回；否则移交，此后的输出进后台的记录。
                if (target !== null) {
                    const output = finished || signal.aborted ? null : capture.soFar();
                    if (output === null) target.discard();
                    else {
                        try {
                            const taken = target.take({prepared, output, done, abort: () => command.abort()});
                            capture.release();
                            sink = taken.sink;
                            signal.removeEventListener("abort", follow);
                            handedOver = true;
                            return taken.result;
                        } catch (error) {
                            // 接不了：留在前台照原合同跑完，暂存仍归这里。
                            notMoved = error instanceof Error ? error.message : String(error);
                            target.discard();
                        }
                    }
                }
            }
        }
        const result = await done;
        const {text, clipped} = capture.window();
        const full = capture.overflowed ? await saveFullOutput(artifacts, capture, "shell") : {};
        const code = result.timedOut ? "timeout" : result.cancelled ? "cancelled" : result.exitCode !== 0 ? "exit-nonzero" : undefined;
        const status = result.timedOut ? "超时" : result.cancelled ? "被中止" : `退出码 ${String(result.exitCode ?? "未知")}`;
        const notes = [
            `[${status}]`,
            ...(clipped ? [`（输出 ${String(capture.totalBytes)} 字节，这里只有一部分）`] : []),
            ...(full.address === undefined ? [] : [`全文：${full.address}${capture.full ? "（超过 64 MiB，只存了前 64 MiB）" : ""}，用 read 分页读`]),
            ...(full.problem === undefined ? [] : [`全文没能保存：${full.problem}`]),
            ...(capture.chunkProblem === null ? [] : [`读取输出时出错：${capture.chunkProblem}`]),
            ...(notMoved === null ? [] : [`（跑过门槛想转到后台，没转成：${notMoved}）`]),
        ];
        const details = {exitCode: result.exitCode ?? null, timedOut: result.timedOut, cancelled: result.cancelled, bytes: capture.totalBytes, ...(full.address === undefined ? {} : {artifact: full.address}), ...(code === undefined ? {} : {code})};
        return {text: [...(text === "" ? [] : [text.endsWith("\n") ? text.slice(0, -1) : text]), ...notes].join("\n"), ...(code === undefined ? {} : {status: "error" as const, code}), details};
    } finally {
        thresholdStop.abort();
        if (!handedOver) signal.removeEventListener("abort", follow);
        // 移交之后暂存已归接手的一方（`release` 过）；没有暂存时只是空操作。
        capture.dispose();
    }
}

/** 判定对象是命令；只读清单在方言里，全部只读才算读（docs/specs/agent/permissions.md 输出 17）。 */
export const shellTool = (dialects: Dialects, background?: ShellBackground, auto?: ShellAutoBackground): KitToolImplementation => ({
    create: (context, services) => ({execute: (args, call) => run(context, services, args, call, background, auto)}),
    effect: (args) => commandEffect(dialects("bash"), args.command as string),
    subjects: (args) => [{kind: "command", dialect: "bash", text: args.command as string}],
});
