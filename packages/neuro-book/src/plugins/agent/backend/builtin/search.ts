/**
 * `grep` 与 `glob`（docs/specs/agent/builtin-tools.md 输出 14–17）：原生搜索在本机跑，结果逐个文件经 `readPath` 核对，不露出的文件
 * 不出现、也占不掉配额。两边的边搜边停不一样：`grep` 能流式拿到匹配，`glob` 只能搜完再过滤。
 */

import {FileType, glob as nativeGlob, grep as nativeGrep} from "@oh-my-pi/pi-natives";
import type {GrepMatch} from "@oh-my-pi/pi-natives";

import type {ToolResult} from "@notnotype/nb-harness/kernel/contracts";

import {parseAddress} from "nbook/plugins/files/shared/contracts";

import type {AgentToolDeclaration, AgentToolImplementation, ToolSubject} from "../../shared/points";
import type {SessionResources} from "../../shared/resources";

import {failed, failure, joinAddress, workingAddress} from "./common";

const GREP_DEFAULT_LIMIT = 100;
const GREP_MAX_LIMIT = 500;
const GLOB_DEFAULT_LIMIT = 200;
const GLOB_MAX_LIMIT = 1_000;
const MAX_CONTEXT = 10;
const MAX_COLUMNS = 500;
const MAX_RESULT_BYTES = 50 * 1024;
const GREP_DEADLINE_MS = 30_000;
const GLOB_DEADLINE_MS = 5_000;
/** `glob` 搜完才能过滤：候选上限，不露出的文件多到把它占满时标“不完整”。 */
const GLOB_CANDIDATES = 5_000;
/** 原生的回调不等异步核对，匹配比核对来得快时攒在这里；超过就停下，内存有界。 */
const GREP_MAX_PENDING = 10_000;

const PATH_PARAMETER = {type: "string", description: "搜索根：资源地址，可以是链接；缺省是 shell 的工作目录。虚拟根不能搜，根下面的目录链接不进（要搜就把链接本身当根）"};

export const grepDeclaration: AgentToolDeclaration = {
    description: "在文件内容里搜索正则（pi-natives 的语法；不合法的模式不报错，按字面搜或得到零条）。隐藏文件也搜，按 .gitignore 过滤。结果的地址都是全局地址。",
    parameters: {
        type: "object",
        properties: {
            pattern: {type: "string"},
            path: PATH_PARAMETER,
            glob: {type: "string", description: "只搜匹配这个 glob 的文件，例如 *.md"},
            ignoreCase: {type: "boolean"},
            context: {type: "integer", minimum: 0, maximum: MAX_CONTEXT, description: "前后各带几行上下文"},
            limit: {type: "integer", minimum: 1, maximum: GREP_MAX_LIMIT, description: `最多多少条匹配，缺省 ${String(GREP_DEFAULT_LIMIT)}`},
        },
        required: ["pattern"],
    },
    version: "1",
    concurrency: "shared",
    effect: "read",
};

export const globDeclaration: AgentToolDeclaration = {
    description: "按 glob 模式列文件，例如 **/*.md。隐藏文件也列，按 .gitignore 过滤。结果的地址都是全局地址。",
    parameters: {
        type: "object",
        properties: {
            pattern: {type: "string"},
            path: PATH_PARAMETER,
            limit: {type: "integer", minimum: 1, maximum: GLOB_MAX_LIMIT, description: `最多多少项，缺省 ${String(GLOB_DEFAULT_LIMIT)}`},
        },
        required: ["pattern"],
    },
    version: "1",
    concurrency: "shared",
    effect: "read",
};

/** 核对一个文件能不能给 Agent 看。`protected-path` 这类只是丢掉这个文件，路由层的失败要结束这次搜索。 */
const DROP = new Set(["protected-path", "outside-root", "not-found", "not-a-file", "not-a-directory", "permission-denied"]);
type Verdict = {readonly visible: boolean} | {readonly failure: ToolResult};

async function verdictOf(resources: SessionResources, address: string, signal: AbortSignal): Promise<Verdict> {
    const located = await resources.readPath(address, {signal});
    if (located.ok) return {visible: true};
    return DROP.has(located.code) ? {visible: false} : {failure: failure(located)};
}

/** 搜索根：全局地址与本机路径。 */
async function searchRoot(resources: SessionResources, sessionProject: string | undefined, path: unknown, signal: AbortSignal): Promise<{readonly address: string; readonly path: string; readonly kind: string} | {readonly failure: ToolResult}> {
    const expanded = resources.expand(typeof path === "string" ? path : workingAddress(sessionProject));
    if (!expanded.ok) return {failure: failure(expanded)};
    const located = await resources.readPath(expanded.address, {signal});
    if (!located.ok) return {failure: failure(located)};
    return {address: expanded.address, path: located.value.path, kind: located.value.kind};
}

/** 项目根的 `.nbook/` 不露出，直接不扫，省下无谓的读（授权仍以 `readPath` 为准）。 */
function controlExclude(address: string): readonly string[] {
    const parsed = parseAddress(address);
    return parsed.ok && parsed.address.scheme === "projects" && !parsed.address.path.includes("/") ? ["/.nbook"] : [];
}

interface Located {
    readonly address: string;
    readonly match: GrepMatch;
}

function renderMatches(matches: readonly Located[]): {readonly text: string; readonly clipped: boolean} {
    const sorted = [...matches].sort((a, b) => (a.address === b.address ? a.match.lineNumber - b.match.lineNumber : a.address < b.address ? -1 : 1));
    const rows: string[] = [];
    let bytes = 0;
    let current: string | null = null;
    for (const {address, match} of sorted) {
        const block = [
            ...(address === current ? [] : [address]),
            ...(match.contextBefore ?? []).map((line) => `${String(line.lineNumber)}-${line.line}`),
            `${String(match.lineNumber)}:${match.line}${match.truncated === true ? " …[已截断]" : ""}`,
            ...(match.contextAfter ?? []).map((line) => `${String(line.lineNumber)}-${line.line}`),
        ];
        const size = Buffer.byteLength(block.join("\n"), "utf8") + 1;
        if (bytes + size > MAX_RESULT_BYTES) return {text: rows.join("\n"), clipped: true};
        bytes += size;
        current = address;
        rows.push(...block);
    }
    return {text: rows.join("\n"), clipped: false};
}

export async function runGrep(resources: SessionResources, project: string | undefined, args: Readonly<Record<string, unknown>>, signal: AbortSignal, deadlineMs = GREP_DEADLINE_MS): Promise<ToolResult> {
    const root = await searchRoot(resources, project, args.path, signal);
    if ("failure" in root) return root.failure;
    const limit = (args.limit as number | undefined) ?? GREP_DEFAULT_LIMIT;
    const context = (args.context as number | undefined) ?? 0;
    const isFile = root.kind === "file";

    // 三种停下的原因分开：配额够了是正常结束，到期限与攒太多是“不完整”，工具取消是失败。按哪个信号触发判断，不看原生的错误。
    const quota = new AbortController();
    const deadline = AbortSignal.timeout(deadlineMs);
    // 配额或期限到了就不再核对：期限管的是整次工具调用，不只是原生搜索。已核对过的结果留着。
    const stopped = AbortSignal.any([quota.signal, deadline]);
    const verifying = AbortSignal.any([signal, deadline]);
    let capped = false;
    let routeFailure: ToolResult | null = null;
    const verdicts = new Map<string, boolean>();
    const visible: Located[] = [];
    let pending: GrepMatch[] = [];
    let drained: Promise<void> | null = null;

    const addressOf = (match: GrepMatch): string => (isFile ? root.address : joinAddress(root.address, match.path));
    const accept = (match: GrepMatch): void => {
        visible.push({address: addressOf(match), match});
        if (visible.length > limit) quota.abort();
    };
    const drain = async (): Promise<void> => {
        for (let batch = pending; batch.length > 0 && !stopped.aborted; batch = pending) {
            pending = [];
            for (const match of batch) {
                if (stopped.aborted) return;
                let allowed = verdicts.get(match.path);
                if (allowed === undefined) {
                    const verdict = await verdictOf(resources, addressOf(match), verifying);
                    // 核对途中到期：这一个的结果是被取消的，不算路由失败。
                    if (stopped.aborted) return;
                    if ("failure" in verdict) {
                        routeFailure = verdict.failure;
                        quota.abort();
                        return;
                    }
                    allowed = verdict.visible;
                    verdicts.set(match.path, allowed);
                }
                if (allowed) accept(match);
            }
        }
    };
    const kick = (): void => {
        drained ??= drain().finally(() => {
            drained = null;
            if (pending.length > 0 && !stopped.aborted) kick();
        });
    };
    const onMatches = (matches: GrepMatch[]): void => {
        if (stopped.aborted) return;
        for (const match of matches) {
            const known = verdicts.get(match.path);
            if (known === false) continue;
            pending.push(match);
        }
        if (pending.length > GREP_MAX_PENDING) {
            capped = true;
            quota.abort();
            return;
        }
        kick();
    };

    let nativeFailure: string | null = null;
    try {
        await nativeGrep({
            pattern: args.pattern as string,
            path: root.path,
            ...(typeof args.glob === "string" ? {glob: args.glob} : {}),
            ...(args.ignoreCase === true ? {ignoreCase: true} : {}),
            ...(context === 0 ? {} : {contextBefore: context, contextAfter: context}),
            exclude: [...controlExclude(root.address)],
            hidden: true,
            gitignore: true,
            maxColumns: MAX_COLUMNS,
            maxCountPerFile: limit + 1,
            signal: AbortSignal.any([signal, quota.signal, deadline]),
            onMatches,
        });
    } catch (error) {
        if (!signal.aborted && !quota.signal.aborted && !deadline.aborted) nativeFailure = error instanceof Error ? error.message : String(error);
    }
    // 回调可能在原生结束后还在排队的核对里：等它们做完。原生结束后 `pending` 不再增长。
    while (drained !== null) await drained;
    if (signal.aborted) return failed("cancelled", "cancelled: 搜索被中止");
    if (routeFailure !== null) return routeFailure;
    if (nativeFailure !== null) return failed("io-failed", `io-failed: ${nativeFailure}`);

    const more = visible.length > limit;
    const rendered = renderMatches(visible.slice(0, limit));
    const incomplete = deadline.aborted || capped;
    const notes = [
        ...(more ? [`（还有更多匹配，这里只列 ${String(limit)} 条；缩小范围或调大 limit）`] : []),
        ...(rendered.clipped ? ["（结果超过 50 KB，后面的没有列出）"] : []),
        ...(incomplete ? ["（搜索不完整：到了期限或匹配太多，这不是全部结果；缩小范围重搜）"] : []),
    ];
    const details = {matches: Math.min(visible.length, limit), filesChecked: verdicts.size, incomplete, more};
    if (visible.length === 0) return {text: incomplete ? notes.join("\n") : "没有匹配", details};
    return {text: [rendered.text, ...notes].join("\n"), details};
}

export async function runGlob(resources: SessionResources, project: string | undefined, args: Readonly<Record<string, unknown>>, signal: AbortSignal, deadlineMs = GLOB_DEADLINE_MS): Promise<ToolResult> {
    const root = await searchRoot(resources, project, args.path, signal);
    if ("failure" in root) return root.failure;
    if (root.kind !== "directory") return failed("not-a-directory", `not-a-directory: ${root.address} 不是目录`);
    const limit = (args.limit as number | undefined) ?? GLOB_DEFAULT_LIMIT;
    const deadline = AbortSignal.timeout(deadlineMs);
    let found;
    try {
        found = await nativeGlob({pattern: args.pattern as string, path: root.path, hidden: true, gitignore: true, followLinks: false, maxResults: GLOB_CANDIDATES, signal: AbortSignal.any([signal, deadline])});
    } catch (error) {
        if (signal.aborted) return failed("cancelled", "cancelled: 搜索被中止");
        if (deadline.aborted) return failed("timeout", "timeout: glob 到了期限，缩小范围重搜");
        return failed("io-failed", `io-failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const shown: string[] = [];
    for (const match of [...found.matches].sort((a, b) => (a.path < b.path ? -1 : 1))) {
        const address = joinAddress(root.address, match.path);
        const verdict = await verdictOf(resources, address, signal);
        if ("failure" in verdict) return verdict.failure;
        if (!verdict.visible) continue;
        shown.push(`${address}${match.fileType === FileType.Dir ? "/" : ""}`);
        if (shown.length > limit) break;
    }
    const more = shown.length > limit;
    const incomplete = !more && found.matches.length >= GLOB_CANDIDATES;
    const rows = shown.slice(0, limit);
    return {
        text: [
            ...(rows.length === 0 ? [incomplete ? "" : "没有匹配"] : rows),
            ...(more ? [`（还有更多，这里只列 ${String(limit)} 项；缩小范围或调大 limit）`] : []),
            ...(incomplete ? [`（不完整：候选到了 ${String(GLOB_CANDIDATES)} 个的上限，这不是全部结果；缩小范围重搜）`] : []),
        ].join("\n").trim(),
        details: {matches: rows.length, incomplete, more},
    };
}

/** 没写 `path` 时搜工作目录：规则看的是工具写明的路径，缺省的不算（读不是闸门要拦的）。 */
const searchSubjects = (args: Readonly<Record<string, unknown>>): readonly ToolSubject[] => (typeof args.path === "string" ? [{kind: "path", access: "read", address: args.path}] : []);

export const grepTool: AgentToolImplementation = {
    subjects: searchSubjects,
    create: (context, {resources}) => ({execute: (args, call) => runGrep(resources, context.project, args, call.signal)}),
};

export const globTool: AgentToolImplementation = {
    subjects: searchSubjects,
    create: (context, {resources}) => ({execute: (args, call) => runGlob(resources, context.project, args, call.signal)}),
};
