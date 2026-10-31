/**
 * 压缩的公共流程（docs/specs/harness/runtime.md 输出 46–52；方法本身在 t11，宿主经 `SessionEnv.compaction` 交进来）。
 *
 * 一次压缩：算出压缩前的请求（`purpose: "compaction"`）、合法切点与 token 估算 → 按 Profile 给的顺序逐个方法经压缩
 * 拦截链调用，失败或结果不合格就换下一个 → 有一个成功时，压缩事件与放回的内容同一个写入批写下。全部失败、或运行在
 * 方法返回之前被中止，都不写压缩事件。
 *
 * token 只做估算：上一次回复的用量（含缓存读写）加之后新增内容按 UTF-8 字节数折算。中文一个字约一个 token、英文约四个
 * 字母一个 token，按每 3 字节一个 token 算，中文略高估、英文高估，宁可早压缩。
 */

import {jsonProblem} from "../api/index.js";
import type {CompactionCut, CompactionJob, CompactionMethod, CompactionResult, ConversationTurn, JsonValue, LogEvent, ModelCaller, ModelInfo, ModelRequest, Resources, ToolDeclaration, ToolSessionContext, Usage} from "../api/index.js";
import type {EventDraft, SessionCore} from "../dispatch/core.js";
import {HANDLER_TIMEOUT_MS} from "../dispatch/reactions.js";
import {interceptCtx, type ViewEnvironment} from "../extension/ctx.js";
import {chainLayers, failureDrafts, runChain} from "../run/chain.js";
import {ctrl} from "../run/writes.js";
import {committedTurns} from "../state/history.js";
import {computeRequest} from "../view/request.js";

/** t11 决定 2 的缺省顺序：超过阈值时 shake → 就地；服务商报溢出时 shake → 摘要模型。 */
const DEFAULT_ORDER: Readonly<Record<"threshold" | "overflow", readonly CompactionMethod[]>> = {threshold: ["shake", "inplace"], overflow: ["shake", "summary"]};

const encoder = new TextEncoder();
export const estimateTokens = (text: string): number => Math.ceil(encoder.encode(text).length / 3);
const finiteNonNegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
/**
 * 一条事件在请求里大约占多少 token：被压缩省略的按占位算（回复另加它的工具调用），其余按数据。
 * 切点估算与上下文估算共用它，和方法拿到的请求是同一条来源规则。
 */
function estimateEvent(event: LogEvent, omitted: ReadonlyMap<string, string>): number {
    const placeholder = omitted.get(event.id);
    if (placeholder === undefined) return estimateTokens(JSON.stringify(event.data));
    const calls = event.type === "assistant" ? JSON.stringify((event.data as {toolCalls?: unknown}).toolCalls ?? []) : "";
    return estimateTokens(placeholder + calls);
}
/** 回复的用量：服务商给了总数用总数，否则四项相加（runtime.md 输出 46）。 */
const usageTotal = (usage: Usage): number => (finiteNonNegative(usage.totalTokens) ? usage.totalTokens : usage.input + usage.cacheRead + usage.cacheWrite + usage.output);

/**
 * 触发点：模型端口给了 `compactAt`（宿主按全局与按模型的配置算好的，t11 决定 1）用它；否则缺省为
 * 窗口 − max(窗口的 15%, 16,384)。窗口未知（0）又没给触发点时不按阈值压缩。
 */
export function triggerPoint(model: ModelInfo): number {
    if (finiteNonNegative(model.compactAt) && model.compactAt > 0) return model.compactAt;
    if (model.contextWindow <= 0) return Number.POSITIVE_INFINITY;
    return model.contextWindow - Math.max(Math.floor(model.contextWindow * 0.15), 16_384);
}

function turnEvents(turn: ConversationTurn): LogEvent[] {
    return [...turn.attachments, ...(turn.input === null ? [] : [turn.input]), ...turn.steps.flatMap((step) => [step.reply, ...step.results, ...step.after])] as LogEvent[];
}

/**
 * 当前上下文的 token 估算（runtime.md 输出 46）：上一次回复的用量加它之后路径上新增的对话事件；上一次回复之后压缩过的，
 * 以压缩的 `tokensAfter` 为基数。从叶子沿父节点往回走，碰到基数就停：最近的回复通常就在叶子附近，不必走整条路径。
 */
export function estimateContext(core: SessionCore): number {
    const omitted = core.leafState.kernel.history.omitted;
    let added = 0;
    for (let event = core.leaf === null ? undefined : core.byId.get(core.leaf); event !== undefined; event = event.parent === null ? undefined : core.byId.get(event.parent)) {
        if (event.type === "assistant") return usageTotal((event.data as {usage: Usage}).usage) + added;
        if (event.type === "compaction") {
            const after = (event.data as {tokensAfter: unknown}).tokensAfter;
            return (finiteNonNegative(after) ? after : 0) + added;
        }
        if (event.kind === "conv") added += estimateEvent(event, omitted);
    }
    return added;
}

/** 合法切点（runtime.md 输出 47）：对话里还在的每一轮的 `turnStarted`，与进行中这一轮每一步的回复。 */
export function compactionCuts(core: SessionCore): {cuts: CompactionCut[]; tokens: number} {
    const history = core.leafState.kernel.history;
    const startOf = new Map<string, string>();
    for (let node = history.starts; node !== null; node = node.tail) if (!startOf.has(node.head.turnId)) startOf.set(node.head.turnId, node.head.eventId);
    const sizeOf = (events: readonly LogEvent[]) => events.reduce((sum, event) => sum + estimateEvent(event, history.omitted), 0);
    const turns = [...committedTurns(history), ...(history.current === null ? [] : [history.current])];
    const sizes = turns.map((turn) => sizeOf(turnEvents(turn)));
    const summary = history.summary === null ? 0 : estimateTokens(history.summary.text);
    const cuts: CompactionCut[] = [];
    let kept = sizes.reduce((sum, size) => sum + size, 0);
    turns.forEach((turn, index) => {
        const start = startOf.get(turn.id);
        if (start !== undefined) cuts.push({entryId: start, kind: "turn", tokensKept: kept});
        if (turn === history.current) {
            // 切在某一步：这一轮的输入与附带内容留着，加上这一步及其后的步（后缀和，一遍算完）。
            const head = sizeOf(turnEvents({...turn, steps: []}));
            const steps = turn.steps.map((step) => sizeOf([step.reply, ...step.results, ...step.after] as LogEvent[]));
            let suffix = steps.reduce((sum, size) => sum + size, 0);
            turn.steps.forEach((step, at) => {
                cuts.push({entryId: step.reply.id, kind: "step", tokensKept: head + suffix});
                suffix -= steps[at]!;
            });
        }
        kept -= sizes[index]!;
    });
    return {cuts, tokens: summary + sizes.reduce((sum, size) => sum + size, 0)};
}

export interface CompactHost {
    readonly core: SessionCore;
    readonly resources: Resources;
    readonly methods: Readonly<Record<string, (job: CompactionJob) => Promise<CompactionResult>>>;
    restore?(context: ToolSessionContext, signal: AbortSignal): Promise<readonly string[]> | readonly string[];
    readonly context: ToolSessionContext;
    readonly model: ModelCaller;
    write(drafts: EventDraft[]): Promise<unknown>;
}

export interface CompactArgs {
    readonly reason: "threshold" | "overflow" | "manual";
    readonly require: readonly string[];
    readonly environment: ViewEnvironment;
    readonly tools: readonly ToolDeclaration[];
    readonly model: string;
    readonly signal: AbortSignal;
}

export type CompactOutcome =
    | {readonly ok: true; readonly eventId: string}
    | {readonly ok: false; readonly code: "disabled" | "nothing-to-compact" | "compaction-failed" | "aborted"};

type Done = Extract<CompactionResult, {method: string}>;

/**
 * 方法（与拦截层）交回的值合不合格（runtime.md 输出 47）：这是插件的边界，按运行时的值完整检查，检查本身不抛错。
 * 合格的交回 null，`{failed}` 交回 `"failed"`，其余交回原因。
 */
function resultProblem(result: unknown, cuts: readonly CompactionCut[], present: ReadonlySet<string>): string | null {
    if (typeof result !== "object" || result === null) return "the result is not an object";
    const value = result as Record<string, unknown>;
    if ("failed" in value) return typeof value.failed === "string" ? "failed" : "failed must be a string";
    if (typeof value.method !== "string") return "method must be a string";
    if (value.firstKeptEntryId !== null && (typeof value.firstKeptEntryId !== "string" || !cuts.some((cut) => cut.entryId === value.firstKeptEntryId))) return `firstKeptEntryId ${String(value.firstKeptEntryId)} is not a cut point`;
    if (value.replacement !== null && typeof value.replacement !== "string") return "replacement must be a string or null";
    if (!Array.isArray(value.omitted)) return "omitted must be an array";
    for (const item of value.omitted as unknown[]) {
        const entry = item as {entryId?: unknown; placeholder?: unknown} | null;
        if (typeof entry !== "object" || entry === null || typeof entry.entryId !== "string" || !present.has(entry.entryId)) return "an omitted entry is not in the conversation";
        if (typeof entry.placeholder !== "string" || entry.placeholder === "") return `omitted entry ${entry.entryId} has no placeholder`;
    }
    if (!finiteNonNegative(value.tokensBefore) || !finiteNonNegative(value.tokensAfter)) return "token counts must be finite non-negative numbers";
    if (value.details !== undefined) {
        const problem = jsonProblem(value.details);
        if (problem !== null) return `details is not JSON: ${problem}`;
    }
    return null;
}

export async function compact(host: CompactHost, args: CompactArgs): Promise<CompactOutcome> {
    const {core} = host;
    const setting = (core.assembly.profile as {compaction?: false | {require?: string; onThreshold?: CompactionMethod[]; onOverflow?: CompactionMethod[]}}).compaction;
    if (setting === false) return {ok: false, code: "disabled"};
    const {cuts, tokens} = compactionCuts(core);
    if (cuts.length === 0) return {ok: false, code: "nothing-to-compact"};
    const order = args.reason === "overflow" ? (setting?.onOverflow ?? DEFAULT_ORDER.overflow) : (setting?.onThreshold ?? DEFAULT_ORDER.threshold);
    const requirements = [...(setting?.require === undefined ? [] : [setting.require]), ...args.require];
    const computed = computeRequest({assembly: core.assembly, state: core.stateAt(), environment: args.environment, purpose: "compaction", model: args.model, tools: args.tools, cache: core.view, checks: false});
    if (!computed.ok) {
        // 压缩前的请求算不出来（Profile 出错、请求不合格）：不拿空请求去压缩，这次压缩失败（runtime.md 输出 47）。
        for (const {error, ...problem} of computed.problems) core.diagnostics.add({...problem, ...(error === undefined ? {} : {cause: error})}, core.head);
        core.diagnostics.add({code: "compaction-failed", entry: "host", subject: args.reason, params: {reason: args.reason}, message: `the request before compaction cannot be computed (${computed.reason}); nothing is compacted`, ...(computed.reason === "profile-failed" ? {cause: computed.error} : {})}, core.head);
        return {ok: false, code: "compaction-failed"};
    }
    const request: ModelRequest = computed.request;
    const history = core.leafState.kernel.history;
    const present = new Set([...committedTurns(history), ...(history.current === null ? [] : [history.current])].flatMap(turnEvents).map((event) => event.id));
    const state = core.stateAt();
    const attempts: string[] = [];
    const failed: EventDraft[] = [];
    for (const method of order) {
        if (args.signal.aborted) return {ok: false, code: "aborted"};
        const job: CompactionJob = {method, reason: args.reason, request, cuts, tokens, require: requirements, signal: args.signal, model: host.model};
        const outcome = await runChain<CompactionJob, CompactionResult>({
            core,
            method: "compaction",
            layers: chainLayers(core, "compaction"),
            input: job,
            signal: args.signal,
            timeoutMs: (item) => item.definition.timeoutMs ?? HANDLER_TIMEOUT_MS,
            ctxFor: (item, invocation, layerSignal) => interceptCtx({assembly: core.assembly, item, state, environment: args.environment, resources: host.resources, signal: layerSignal, invocation, phase: "run"}),
            terminal: async (final) => {
                const impl = host.methods[final.method];
                if (impl === undefined) return {failed: "unknown-method"};
                try {
                    return await impl(final);
                } catch (error) {
                    core.diagnostics.add({code: "compaction-failed", entry: "host", subject: final.method, params: {method: final.method}, message: `compaction method ${final.method} threw`, cause: error}, core.head);
                    return {failed: "threw"};
                }
            },
            onFailure: () => ({kind: "skip"}),
            // 拦截层交回的值原样往外交，合不合格统一在下面检查。
            normalize: (_item, returned) => returned as CompactionResult,
        });
        failed.push(...failureDrafts(core, "intercept.compaction", outcome.failures));
        const problem = resultProblem(outcome.value, cuts, present);
        if (problem === "failed") {
            attempts.push(`${method}: ${(outcome.value as {failed: string}).failed}`);
            continue;
        }
        if (problem !== null) {
            attempts.push(`${method}: invalid`);
            core.diagnostics.add({code: "compaction-invalid", entry: "host", subject: method, params: {method}, message: `compaction method ${method} returned an invalid result: ${problem}`}, core.head);
            continue;
        }
        const result = outcome.value as Done;
        // 中止之后不写压缩事件（runtime.md 输出 51）。
        if (args.signal.aborted) return {ok: false, code: "aborted"};
        let restored: readonly string[] = [];
        try {
            restored = (await host.restore?.(host.context, args.signal)) ?? [];
        } catch (error) {
            core.diagnostics.add({code: "compaction-failed", entry: "host", subject: "restore", message: "restoring content after compaction threw; nothing is restored", cause: error}, core.head);
        }
        if (args.signal.aborted) return {ok: false, code: "aborted"};
        const written = (await host.write([
            ...failed,
            ctrl("compaction", {method: result.method, firstKeptEntryId: result.firstKeptEntryId, replacement: result.replacement, omitted: result.omitted, tokensBefore: result.tokensBefore, tokensAfter: result.tokensAfter, ...(result.details === undefined ? {} : {details: result.details})}),
            ...restored.filter((text) => text !== "").map((text): EventDraft => ({type: "notice", kind: "conv", scope: "path", data: {code: "restored", text} as JsonValue})),
        ])) as {events: readonly LogEvent[]};
        return {ok: true, eventId: written.events.find((event) => event.type === "compaction")!.id};
    }
    core.diagnostics.add({code: "compaction-failed", entry: "host", subject: args.reason, params: {reason: args.reason, attempts: attempts.join("; ")}, message: `every compaction method failed (${attempts.join("; ") || "no methods"}); nothing is written`}, core.head);
    if (failed.length > 0) await host.write(failed);
    return {ok: false, code: "compaction-failed"};
}
