/**
 * 预览下一次请求（docs/specs/harness/runtime.md 输出 55）：跑一遍视图与模型拦截链（`phase: "preview"`），最里层截下请求、
 * 不发给模型，也不写日志。改动按每一层调用 `next` 时收到的与交出的比较得出，不要求拦截自己报。
 * 预览过去的请求不在这一版（`atRequest` 得 `PreviewUnsupported`）。
 *
 * 预览走的冻结、返回值校验与失败策略和真实的模型调用相同（`freezeRequest`、`isResponse`、出错跳过这一层）：
 * 一层在预览里原地改请求同样按这一层失败处理，不会改坏提交缓存；失败交在结果的 `diagnostics` 里，不写日志。
 */

import type {Diagnostic, JsonValue, Message, ModelPort, ModelRequest, ModelResponse, PreviewArgs, PreviewResult, RequestBlock, RequestChange, RequestPath, Resources, ToolDeclaration} from "../api/index.js";
import {diagnosticCodes} from "../api/index.js";
import {estimateTokens, triggerPoint} from "../compaction/compact.js";
import type {EventDraft, SessionCore} from "../dispatch/core.js";
import {HANDLER_TIMEOUT_MS} from "../dispatch/reactions.js";
import {interceptCtx, type ViewEnvironment} from "../extension/ctx.js";
import {chainLayers, runChain, type ChainFailure} from "../run/chain.js";
import {takeInputDrafts, takeSteerDrafts} from "../run/loop.js";
import {freezeRequest, isResponse} from "../run/model-call.js";
import {toolInfo, type ToolBox} from "../run/tools.js";
import {computeRequest} from "../view/request.js";

/** 这一版不支持的预览（过去的请求），或这一刻算不出请求（没有模型、Profile 出错）。 */
export class PreviewUnavailable extends Error {
    constructor(readonly code: "past-request-unsupported" | "unknown-node" | "no-model" | "no-credentials" | "unknown-model" | "profile-failed" | "request-invalid", message: string) {
        super(message);
        this.name = "PreviewUnavailable";
    }
}

export interface PreviewHost {
    readonly core: SessionCore;
    readonly models: ModelPort;
    readonly box: ToolBox;
    readonly resources: Resources;
    environment(model: ViewEnvironment["model"], tools: ViewEnvironment["tools"]): ViewEnvironment;
}

const NEVER = new AbortController().signal;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const MESSAGE_FIELDS = ["role", "toolCalls", "callId", "isError", "model"] as const;
const REQUEST_FIELDS = ["purpose", "model", "effort", "toolChoice", "providerOptions"] as const;

/** 一层交出的请求与它收到的相比改了什么（`RequestPath` 的注释说明消息怎样对齐）。 */
function changesBetween(before: ModelRequest, after: ModelRequest, extension: string): RequestChange[] {
    const changes: RequestChange[] = [];
    const push = (path: RequestPath, was: unknown, now: unknown) => {
        if (was === undefined && now === undefined) return;
        if (was === undefined) changes.push({extension, path, op: "insert", after: now as JsonValue});
        else if (now === undefined) changes.push({extension, path, op: "remove", before: was as JsonValue});
        else if (!same(was, now)) changes.push({extension, path, op: "replace", before: was as JsonValue, after: now as JsonValue});
    };
    const list = <T>(a: readonly T[], b: readonly T[], path: (index: number) => RequestPath) => {
        for (let index = 0; index < Math.max(a.length, b.length); index += 1) push(path(index), a[index], b[index]);
    };
    const record = (a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>, area: "params" | "headers") => {
        for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) push({area, key}, a[key], b[key]);
    };
    list(before.system, after.system, (index) => ({area: "system", index}));

    // 消息：两边相同的前缀与后缀不算改动；中间部分逐条比较，多出来的是插入、少了的是删除。
    const was = before.messages;
    const now = after.messages;
    let prefix = 0;
    while (prefix < was.length && prefix < now.length && (was[prefix] === now[prefix] || same(was[prefix], now[prefix]))) prefix += 1;
    let suffix = 0;
    while (suffix < was.length - prefix && suffix < now.length - prefix && (was[was.length - 1 - suffix] === now[now.length - 1 - suffix] || same(was[was.length - 1 - suffix], now[now.length - 1 - suffix]))) suffix += 1;
    const wasMiddle = was.length - prefix - suffix;
    const nowMiddle = now.length - prefix - suffix;
    for (let offset = 0; offset < Math.max(wasMiddle, nowMiddle); offset += 1) {
        const index = prefix + offset;
        if (offset >= wasMiddle) {
            changes.push({extension, path: {area: "messages", message: index}, op: "insert", after: now[index]!});
            continue;
        }
        if (offset >= nowMiddle) {
            changes.push({extension, path: {area: "messages", message: index}, op: "remove", before: was[index]!});
            continue;
        }
        const a = was[index]!;
        const b = now[index]!;
        for (const field of MESSAGE_FIELDS) push({area: "messages", message: index, field}, a[field], b[field]);
        list(a.content, b.content, (block) => ({area: "messages", message: index, block}));
    }

    record(before.params as Record<string, unknown>, after.params as Record<string, unknown>, "params");
    record(before.headers, after.headers, "headers");
    list(before.tools, after.tools, (index) => ({area: "tools", index}));
    for (const key of REQUEST_FIELDS) push({area: "request", key}, before[key], after[key]);
    return changes;
}

/** 一块内容大约多少 token：文字与思考按文字，别的（图片等）按序列化后的长度，与压缩估算事件数据的口径一致。 */
function blockTokens(block: RequestBlock): number {
    if (block.kind === "text" || block.kind === "thinking") return estimateTokens(block.text);
    const {origin: _origin, ...rest} = block;
    return estimateTokens(JSON.stringify(rest));
}
/** 一条消息里内容块之外的部分（工具调用及其参数、回应的调用 id）。 */
const messageExtraTokens = (message: Message): number => (message.toolCalls === undefined || message.toolCalls.length === 0 ? 0 : estimateTokens(JSON.stringify(message.toolCalls))) + (message.callId === undefined ? 0 : estimateTokens(message.callId));

const causeOf = (error: unknown): Diagnostic["cause"] => (error instanceof Error ? {name: error.name, message: error.message, ...(error.stack === undefined ? {} : {stack: error.stack})} : {name: "Error", message: String(error)});

export async function previewRequest(host: PreviewHost, args: PreviewArgs = {}): Promise<PreviewResult> {
    const {core} = host;
    if (args.atRequest !== undefined) throw new PreviewUnavailable("past-request-unsupported", "previewing a past request is not supported yet");
    const leaf = args.leaf === undefined ? core.leaf : args.leaf;
    if (leaf !== null && core.byId.get(leaf)?.scope !== "path") throw new PreviewUnavailable("unknown-node", `node ${leaf} is not in the session`);
    const resolution = host.models.resolve(core.session.kernel.core, "turn");
    if (!resolution.ok) throw new PreviewUnavailable(resolution.code, `no model for the next request (${resolution.code})`);
    const tools: readonly ToolDeclaration[] = host.box.current();
    const environment = host.environment(resolution.info, tools.map(toolInfo));

    // 预览当前叶子时，把下一个边界确定会取走的输入投影进去（不写日志）：两轮之间取缓冲区的第一条开新的一轮，
    // 一轮进行中取全部 steer。投影不到的：在跑的工具的结果、边界上可能触发的压缩。
    let projected: EventDraft[] = [];
    if (leaf === core.leaf) {
        const next = core.session.kernel.buffer[0];
        if (core.leafState.kernel.history.current === null) projected = next === undefined ? [] : takeInputDrafts(next.id, next.input, core.newId());
        else projected = takeSteerDrafts(core);
    }
    const state = projected.length > 0 ? core.project(projected) : core.stateAt(leaf);
    const computed = computeRequest({assembly: core.assembly, state, environment, purpose: "turn", model: resolution.info.id, ...(core.session.kernel.core.effort === null ? {} : {effort: core.session.kernel.core.effort}), tools, cache: core.view, checks: false, inactive: (id) => core.revoked.has(id)});
    if (!computed.ok) throw new PreviewUnavailable(computed.reason, `the next request cannot be computed (${computed.reason})`);

    const changes: RequestChange[] = [];
    const original = freezeRequest(computed.request);
    let captured: ModelRequest = original;
    const synthetic: ModelResponse = {content: [], toolCalls: [], stopReason: "stop", usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, complete: true}, model: resolution.info.id};
    const outcome = await runChain<ModelRequest, ModelResponse>({
        core,
        method: "model",
        layers: chainLayers(core, "model"),
        input: original,
        signal: NEVER,
        timeoutMs: (item) => item.definition.timeoutMs ?? HANDLER_TIMEOUT_MS,
        ctxFor: (item, invocation, signal) => interceptCtx({assembly: core.assembly, item, state, environment, resources: host.resources, signal, invocation, phase: "preview"}),
        onNext: (item, received, passed) => {
            freezeRequest(passed);
            if (received !== passed) changes.push(...changesBetween(received, passed, item.definition.id));
        },
        terminal: async (final) => {
            captured = final;
            return synthetic;
        },
        onFailure: () => ({kind: "skip"}),
        normalize: (item, returned) => {
            if (!isResponse(returned)) throw new TypeError(`model interceptor of ${item.definition.id} did not return a model response`);
            return returned;
        },
    });

    // 各区的 token 估算：进行中这一轮的消息按来源的事件 id 认（工具结果按调用 id），开场按槽名，其余是历史。
    const current = state.history.current;
    const turnEvents = new Set(current === null ? [] : [...current.attachments, ...(current.input === null ? [] : [current.input]), ...current.steps.flatMap((step) => [step.reply, ...step.results, ...step.after])].map((event) => event.id));
    const turnCalls = new Set(current === null ? [] : current.steps.flatMap((step) => step.reply.data.toolCalls.map((call) => call.id)));
    const inTurn = (message: Message) => (message.role === "tool" && turnCalls.has(message.callId ?? "")) || message.content.some((block) => block.origin.kind === "event" && turnEvents.has(block.origin.eventId)) || (message.toolCalls ?? []).some((call) => turnCalls.has(call.id));
    const byArea = {system: 0, opening: 0, history: 0, turn: 0, tools: estimateTokens(JSON.stringify(captured.tools))};
    const isOpening = (block: RequestBlock) => block.origin.kind === "slot" && block.origin.name === "opening";
    for (const block of captured.system) byArea[isOpening(block) ? "opening" : "system"] += blockTokens(block);
    for (const message of captured.messages) {
        const area = inTurn(message) ? "turn" : "history";
        for (const block of message.content) byArea[isOpening(block) ? "opening" : area] += blockTokens(block);
        byArea[area] += messageExtraTokens(message);
    }

    const diagnostic = (fields: Omit<Diagnostic, "id" | "level" | "count" | "firstSeq" | "lastSeq" | "persisted" | "params"> & {params?: Diagnostic["params"]; subject: string}): Diagnostic => {
        const {subject, ...rest} = fields;
        return {id: [fields.code, fields.extension, fields.entry, subject].join("|"), level: diagnosticCodes[fields.code], params: {}, ...rest, count: 1, firstSeq: core.head, lastSeq: core.head, persisted: false};
    };
    const diagnostics: Diagnostic[] = [
        ...computed.problems.map((problem) => diagnostic({code: problem.code, extension: problem.extension, entry: problem.entry, subject: problem.subject ?? "", params: problem.params ?? {}, message: problem.message, ...(problem.hint === undefined ? {} : {hint: problem.hint})})),
        ...outcome.failures.map((failure: ChainFailure) => diagnostic({
            code: "intercept-threw",
            extension: failure.extension,
            entry: "intercept.model",
            subject: failure.code,
            params: {code: failure.code, phase: failure.phase},
            message: `intercept.model of ${failure.extension} ${failure.code === "timeout" ? "timed out" : failure.code === "invalid-output" ? "returned an invalid value" : "threw"} during the preview; the layer is skipped`,
            ...(failure.error === undefined ? {} : {cause: causeOf(failure.error)}),
        })),
    ];
    return {
        fidelity: "next",
        request: captured,
        original,
        changes,
        slots: computed.slots.map((slot) => ({name: slot.name, extension: slot.extension, stable: !slot.volatile, placed: computed.placed.has(slot), tokens: estimateTokens(slot.text)})),
        skipped: core.assembly.order.filter((item) => core.inactive(item.definition.id)).map((item) => ({extension: item.definition.id, reason: core.revoked.has(item.definition.id) ? "revoked" as const : "failed" as const})),
        tokens: {estimated: Object.values(byArea).reduce((sum, value) => sum + value, 0), window: resolution.info.contextWindow, threshold: triggerPoint(resolution.info), byArea},
        diagnostics,
    };
}
