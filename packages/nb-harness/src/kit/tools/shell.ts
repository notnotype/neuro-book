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
import {OutputCapture, saveFullOutput} from "./output-capture.js";
import type {KitToolDeclaration, KitToolImplementation} from "./types.js";

const DEFAULT_TIMEOUT_SECONDS = 300;
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

async function run(context: ToolSessionContext, {files, artifacts}: KitServices, args: Readonly<Record<string, unknown>>, call: ToolContext, background: ShellBackground | undefined): Promise<ToolResult> {
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

    if (args.async === true && background !== undefined) return background({command: replaced.command, cwd: cwd.value.path, env}, {args, call, context, files});

    const capture = new OutputCapture();
    try {
        const result = await executeShell({
            command: replaced.command,
            cwd: cwd.value.path,
            env,
            timeoutMs: ((args.timeout as number | undefined) ?? DEFAULT_TIMEOUT_SECONDS) * 1000,
            signal,
        }, (error, chunk) => {
            if (error !== null) capture.chunkProblem = error.message;
            else capture.push(chunk);
        });
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
        ];
        const details = {exitCode: result.exitCode ?? null, timedOut: result.timedOut, cancelled: result.cancelled, bytes: capture.totalBytes, ...(full.address === undefined ? {} : {artifact: full.address}), ...(code === undefined ? {} : {code})};
        return {text: [...(text === "" ? [] : [text.endsWith("\n") ? text.slice(0, -1) : text]), ...notes].join("\n"), ...(code === undefined ? {} : {status: "error" as const, code}), details};
    } finally {
        capture.dispose();
    }
}

/** 判定对象是命令；只读清单在方言里，全部只读才算读（docs/specs/agent/permissions.md 输出 17）。 */
export const shellTool = (dialects: Dialects, background?: ShellBackground): KitToolImplementation => ({
    create: (context, services) => ({execute: (args, call) => run(context, services, args, call, background)}),
    effect: (args) => commandEffect(dialects("bash"), args.command as string),
    subjects: (args) => [{kind: "command", dialect: "bash", text: args.command as string}],
});
