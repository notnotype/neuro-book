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
const estimateEvent = (event: LogEvent): number => estimateTokens(JSON.stringify(event.data));
const usageTotal = (usage: Usage): number => usage.input + usage.cacheRead + usage.cacheWrite + usage.output;

/** t11 决定 1 的缺省触发点：窗口 − max(窗口的 15%, 16,384)。窗口未知（0）时不按阈值压缩。 */
export function triggerPoint(model: ModelInfo): number {
    if (model.contextWindow <= 0) return Number.POSITIVE_INFINITY;
    return model.contextWindow - Math.max(Math.floor(model.contextWindow * 0.15), 16_384);
}

function turnEvents(turn: ConversationTurn): LogEvent[] {
    return [...turn.attachments, ...(turn.input === null ? [] : [turn.input]), ...turn.steps.flatMap((step) => [step.reply, ...step.results, ...step.after])] as LogEvent[];
}

/**
 * 当前上下文的 token 估算（runtime.md 输出 46）：上一次回复的用量加它之后路径上新增的对话事件；上一次回复之后压缩过的，
 * 以压缩的 `tokensAfter` 为基数。
 */
export function estimateContext(core: SessionCore): number {
    const path = core.pathTo();
    let base = 0;
    let from = 0;
    for (let index = path.length - 1; index >= 0; index -= 1) {
        const event = path[index]!;
        if (event.type === "assistant") {
            base = usageTotal((event.data as {usage: Usage}).usage);
            from = index + 1;
            break;
        }
        if (event.type === "compaction") {
            base = (event.data as {tokensAfter: number}).tokensAfter;
            from = index + 1;
            break;
        }
    }
    let added = 0;
    for (let index = from; index < path.length; index += 1) if (path[index]!.kind === "conv") added += estimateEvent(path[index]!);
    return base + added;
}

/** 合法切点（runtime.md 输出 47）：对话里还在的每一轮的 `turnStarted`，与进行中这一轮每一步的回复。 */
export function compactionCuts(core: SessionCore): {cuts: CompactionCut[]; tokens: number} {
    const history = core.leafState.kernel.history;
    const startOf = new Map<string, string>();
    for (let node = history.starts; node !== null; node = node.tail) if (!startOf.has(node.head.turnId)) startOf.set(node.head.turnId, node.head.eventId);
    const sizeOf = (events: readonly LogEvent[]) => events.reduce((sum, event) => sum + estimateEvent(event), 0);
    const turns = [...committedTurns(history), ...(history.current === null ? [] : [history.current])];
    const sizes = turns.map((turn) => sizeOf(turnEvents(turn)));
    const summary = history.summary === null ? 0 : estimateTokens(history.summary.text);
    const cuts: CompactionCut[] = [];
    let kept = sizes.reduce((sum, size) => sum + size, 0);
    turns.forEach((turn, index) => {
        const start = startOf.get(turn.id);
        if (start !== undefined) cuts.push({entryId: start, kind: "turn", tokensKept: kept});
        if (turn === history.current) {
            // 切在某一步：这一轮的输入与附带内容留着，加上这一步及其后的步。
            const head = sizeOf(turnEvents({...turn, steps: []}));
            const steps = turn.steps.map((step) => sizeOf([step.reply, ...step.results, ...step.after] as LogEvent[]));
            turn.steps.forEach((step, at) => cuts.push({entryId: step.reply.id, kind: "step", tokensKept: head + steps.slice(at).reduce((sum, size) => sum + size, 0)}));
        }
        kept -= sizes[index]!;
    });
    return {cuts, tokens: summary + sizes.reduce((sum, size) => sum + size, 0)};
}

export interface CompactHost {
    readonly core: SessionCore;
    readonly resources: Resources;
    readonly methods: Readonly<Record<string, (job: CompactionJob) => Promise<CompactionResult>>>;
    restore?(context: ToolSessionContext): Promise<readonly string[]> | readonly string[];
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

/** 结果合不合格：切点是合法切点之一（或 null），省略的是对话里还在的条目、占位不空，token 是非负数。 */
function resultProblem(result: Done, cuts: readonly CompactionCut[], present: ReadonlySet<string>): string | null {
    if (result.firstKeptEntryId !== null && !cuts.some((cut) => cut.entryId === result.firstKeptEntryId)) return `firstKeptEntryId ${result.firstKeptEntryId} is not a cut point`;
    if (result.replacement !== null && typeof result.replacement !== "string") return "replacement must be a string or null";
    for (const item of result.omitted) {
        if (!present.has(item.entryId)) return `omitted entry ${item.entryId} is not in the conversation`;
        if (typeof item.placeholder !== "string" || item.placeholder === "") return `omitted entry ${item.entryId} has no placeholder`;
    }
    if (!(result.tokensBefore >= 0) || !(result.tokensAfter >= 0)) return "token counts must be non-negative numbers";
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
    const request: ModelRequest | null = computed.ok ? computed.request : null;
    const history = core.leafState.kernel.history;
    const present = new Set([...committedTurns(history), ...(history.current === null ? [] : [history.current])].flatMap(turnEvents).map((event) => event.id));
    const state = core.stateAt();
    const attempts: string[] = [];
    const failed: EventDraft[] = [];
    for (const method of order) {
        if (args.signal.aborted) return {ok: false, code: "aborted"};
        const job: CompactionJob = {method, reason: args.reason, request: request ?? {purpose: "compaction", model: args.model, params: {}, headers: {}, system: [], messages: [], tools: []}, cuts, tokens, require: requirements, signal: args.signal, model: host.model};
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
            normalize: (item, returned) => {
                const value = returned as Partial<Done> & {failed?: unknown};
                if (typeof value !== "object" || value === null || (typeof value.failed !== "string" && typeof value.method !== "string")) throw new TypeError(`compaction interceptor of ${item.definition.id} did not return a compaction result`);
                return value as CompactionResult;
            },
        });
        failed.push(...failureDrafts(core, "intercept.compaction", outcome.failures));
        const result = outcome.value;
        if ("failed" in result) {
            attempts.push(`${method}: ${result.failed}`);
            continue;
        }
        const problem = resultProblem(result, cuts, present);
        if (problem !== null) {
            attempts.push(`${method}: invalid`);
            core.diagnostics.add({code: "compaction-invalid", entry: "host", subject: method, params: {method}, message: `compaction method ${method} returned an invalid result: ${problem}`}, core.head);
            continue;
        }
        // 中止之后不写压缩事件（runtime.md 输出 51）。
        if (args.signal.aborted) return {ok: false, code: "aborted"};
        let restored: readonly string[] = [];
        try {
            restored = (await host.restore?.(host.context)) ?? [];
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
