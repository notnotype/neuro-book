/**
 * `shell`（docs/specs/agent/builtin-tools.md 输出 18–22）：`pi-natives` 内嵌的 brush shell，只在前台。
 *
 * 输出的回调不等异步，所以回调里只做同步的事（同 omp 的 `OutputSink`）：内存里留开头与结尾，放不下之后同步追加到一个本地临时文件；命令
 * 结束后才把它拷进 `artifacts/`。这样暂存目录不可用不影响命令执行，命令也不会因为保存失败而跑第二遍。
 */

import {closeSync, mkdtempSync, openSync, rmSync, writeSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";

import {executeShell} from "@oh-my-pi/pi-natives";

import type {ToolResult, ToolSessionContext} from "@notnotype/nb-harness/kernel/contracts";

import type {AgentToolDeclaration, AgentToolImplementation} from "../../shared/points";
import type {AgentToolServices, SessionResources} from "../../shared/resources";

import {failure, workingAddress} from "./common";
import {findAddresses, substitute} from "./shell-address";

const DEFAULT_TIMEOUT_SECONDS = 300;
const MAX_TIMEOUT_SECONDS = 3_600;
const WINDOW_BYTES = 50 * 1024;
const WINDOW_LINES = 2_000;
const PART_BYTES = 20 * 1024;
const PART_LINES = 500;
const LINE_BYTES = 768;
const ARTIFACT_LIMIT = 64 * 1024 * 1024;

export const shellDeclaration: AgentToolDeclaration = {
    description: `执行 shell 命令（内嵌的 bash 兼容 shell，只在前台）。工作目录有主项目时是项目，没有时是会话工作区。命令里直接写出的资源地址（project://a.md、session://x 等）会换成真实路径，虚拟地址在执行前报错；heredoc、变量拼接、命令替换里的地址不保证替换。环境变量 $NBOOK_PROJECT、$NBOOK_SESSION 是项目与会话工作区的真实路径。输出过长时只交回开头与结尾，全文存进 session://artifacts/，用 read 分页读。`,
    parameters: {
        type: "object",
        properties: {
            command: {type: "string"},
            timeout: {type: "integer", minimum: 1, maximum: MAX_TIMEOUT_SECONDS, description: `超时秒数，缺省 ${String(DEFAULT_TIMEOUT_SECONDS)}`},
        },
        required: ["command"],
    },
    version: "1",
    concurrency: "exclusive",
    effect: "exec",
};

/** 没有尾部换行的最后一段也算一行。 */
function lineCount(text: string): number {
    if (text === "") return 0;
    let lines = text.endsWith("\n") ? 0 : 1;
    for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1)) lines += 1;
    return lines;
}

function capLines(text: string): string {
    return text.split("\n").map((line) => {
        const size = Buffer.byteLength(line, "utf8");
        // 按字节切可能切开多字节字符，解码时多出来的替换字符去掉。
        return size <= LINE_BYTES ? line : `${Buffer.from(line, "utf8").subarray(0, LINE_BYTES).toString("utf8").replace(/\uFFFD+$/u, "")} …[本行共 ${String(size)} 字节，已截断]`;
    }).join("\n");
}

/**
 * 收集输出：放得进窗口就只在内存里；放不下（总量、行数或单行超限）之后内存只留开头与结尾，全文进本地临时文件。
 * 开头常有报错，结尾常有结论，两头都留（同 omp）。
 */
class OutputCapture {
    /** 没超限时是全部输出；超限后是结尾（留到一个结尾窗口的两倍再修剪，免得每块都修）。 */
    #memory = "";
    #memoryBytes = 0;
    #head = "";
    /** 当前这一行已有多少字节：长行可能跨好几块。 */
    #lineBytes = 0;
    #spool: {readonly fd: number; readonly path: string} | null = null;
    #spoolBytes = 0;
    overflowed = false;
    full = false;
    totalBytes = 0;
    spoolProblem: string | null = null;
    chunkProblem: string | null = null;

    push(chunk: string): void {
        this.totalBytes += Buffer.byteLength(chunk, "utf8");
        this.#memory += chunk;
        this.#memoryBytes += Buffer.byteLength(chunk, "utf8");
        if (this.overflowed) {
            this.#spoolWrite(chunk);
            if (this.#memoryBytes > PART_BYTES * 2) {
                this.#memory = Buffer.from(this.#memory, "utf8").subarray(-PART_BYTES).toString("utf8");
                this.#memoryBytes = Buffer.byteLength(this.#memory, "utf8");
            }
            return;
        }
        const parts = chunk.split("\n");
        let longest = 0;
        parts.forEach((part, index) => {
            const size = Buffer.byteLength(part, "utf8") + (index === 0 ? this.#lineBytes : 0);
            longest = Math.max(longest, size);
            if (index === parts.length - 1) this.#lineBytes = size;
        });
        if (this.#memoryBytes > WINDOW_BYTES || lineCount(this.#memory) > WINDOW_LINES || longest > LINE_BYTES) {
            this.overflowed = true;
            this.#head = Buffer.from(this.#memory, "utf8").subarray(0, PART_BYTES).toString("utf8");
            this.#spoolWrite(this.#memory);
        }
    }

    #spoolWrite(text: string): void {
        if (this.spoolProblem !== null || this.full) return;
        try {
            if (this.#spool === null) {
                const directory = mkdtempSync(join(tmpdir(), "nbook-shell-"));
                const path = join(directory, "output.log");
                this.#spool = {fd: openSync(path, "wx", 0o600), path};
            }
            const bytes = Buffer.from(text, "utf8");
            const room = ARTIFACT_LIMIT - this.#spoolBytes;
            const taken = bytes.length > room ? bytes.subarray(0, room) : bytes;
            writeSync(this.#spool.fd, taken);
            this.#spoolBytes += taken.length;
            if (taken.length < bytes.length) this.full = true;
        } catch (error) {
            this.spoolProblem = error instanceof Error ? error.message : String(error);
        }
    }

    /** 交给模型的输出窗口（docs/specs/agent/builtin-tools.md 的术语）；`clipped` 指内容少了，全文要去 `artifacts/` 看。 */
    window(): {readonly text: string; readonly clipped: boolean} {
        if (!this.overflowed) return {text: this.#memory, clipped: false};
        // 总量与行数都在预算内，只是单行超限（内存这时一定是全部输出）：不用省略中间。
        if (this.totalBytes <= WINDOW_BYTES && lineCount(this.#memory) <= WINDOW_LINES) return {text: capLines(this.#memory), clipped: true};
        const head = this.#head.split("\n");
        if (head.length > 1) head.pop();
        const tail = Buffer.from(this.#memory, "utf8").subarray(-PART_BYTES).toString("utf8").split("\n");
        if (tail.length > 1) tail.shift();
        const notice = `…[中间省略，共 ${String(this.totalBytes)} 字节]…`;
        return {text: capLines([...head.slice(0, PART_LINES), notice, ...tail.slice(-PART_LINES)].join("\n")), clipped: true};
    }

    get spoolPath(): string | null {
        return this.spoolProblem === null ? (this.#spool?.path ?? null) : null;
    }

    dispose(): void {
        if (this.#spool === null) return;
        closeSync(this.#spool.fd);
        rmSync(dirname(this.#spool.path), {recursive: true, force: true});
        this.#spool = null;
    }
}

const encoder = new TextEncoder();

async function saveFull(artifacts: AgentToolServices["artifacts"], capture: OutputCapture): Promise<{readonly address?: string; readonly problem?: string}> {
    const path = capture.spoolPath;
    if (path === null) return {problem: capture.spoolProblem ?? "没有全文"};
    const saved = await artifacts.save("shell", async (sink) => {
        for await (const chunk of Bun.file(path).stream()) await sink.write(chunk);
        if (capture.full) await sink.write(encoder.encode(`\n[输出超过 64 MiB，后面的没有保存；共 ${String(capture.totalBytes)} 字节]\n`));
    });
    return saved.ok ? {address: saved.value.address} : {problem: `${saved.code}: ${saved.detail}`};
}

/** 全局地址定位成真实路径；目标不存在时从最近的已存在祖先接上余下的段（`mkdir`、重定向的目标），不预先建任何东西。 */
async function locate(resources: SessionResources, address: string, signal: AbortSignal): Promise<{readonly path: string} | {readonly failure: ToolResult}> {
    const trailing = address.endsWith("/") && !address.endsWith("://");
    const base = trailing ? address.slice(0, -1) : address;
    const prefix = base.slice(0, base.indexOf("://") + 3);
    const segments = base.slice(prefix.length).split("/");
    const missing: string[] = [];
    for (;;) {
        const at = prefix + segments.join("/");
        const located = await resources.readPath(at, {signal});
        if (located.ok) return {path: join(located.value.path, ...missing) + (trailing ? "/" : "")};
        if (located.code !== "not-found" || segments.length === 0) return {failure: failure({code: located.code, detail: `${address}：${located.detail}`})};
        // 段走完了就问方案根：`user://new.txt` 的祖先是 `user://`。
        missing.unshift(segments.pop() as string);
    }
}

/** 换掉命令里的地址。方案是否已登记问资源视图：`https://`、`git://` 这些得 `unknown-scheme`，原样留着。 */
async function replaceAddresses(resources: SessionResources, command: string, signal: AbortSignal): Promise<{readonly command: string} | {readonly failure: ToolResult}> {
    const found = findAddresses(command);
    const known = new Map<string, boolean>();
    const replacements: (string | null)[] = [];
    for (const item of found) {
        const scheme = item.address.slice(0, item.address.indexOf("://"));
        let registered = known.get(scheme);
        if (registered === undefined) {
            const probe = await resources.readPath(`${scheme}://`, {signal});
            registered = probe.ok || probe.code !== "unknown-scheme";
            known.set(scheme, registered);
        }
        if (!registered) {
            replacements.push(null);
            continue;
        }
        const expanded = resources.expand(item.address);
        if (!expanded.ok) return {failure: failure({code: expanded.code, detail: `${item.address}：${expanded.detail}，命令没有执行`})};
        const located = await locate(resources, expanded.address, signal);
        if ("failure" in located) return located;
        replacements.push(located.path);
    }
    return {command: substitute(command, found, replacements)};
}

async function realPathOf(resources: SessionResources, address: string, signal: AbortSignal): Promise<string | null> {
    const located = await resources.readPath(address, {signal});
    return located.ok ? located.value.path : null;
}

async function run(context: ToolSessionContext, {resources, artifacts}: AgentToolServices, args: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<ToolResult> {
    const cwd = await resources.readPath(workingAddress(context.project), {signal});
    if (!cwd.ok) return failure(cwd);
    const replaced = await replaceAddresses(resources, args.command as string, signal);
    if ("failure" in replaced) return replaced.failure;
    const projectPath = context.project === undefined ? null : await realPathOf(resources, "project://", signal);
    const sessionPath = await realPathOf(resources, "session://", signal);
    const env: Record<string, string> = {
        ...(projectPath === null ? {} : {NBOOK_PROJECT: projectPath}),
        ...(sessionPath === null ? {} : {NBOOK_SESSION: sessionPath}),
    };

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
        const full = capture.overflowed ? await saveFull(artifacts, capture) : {};
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

export const shellTool: AgentToolImplementation = {
    create: (context, services) => ({execute: (args, call) => run(context, services, args, call.signal)}),
};
