/**
 * 预览下一次请求（docs/specs/harness/runtime.md 输出 55）：跑一遍视图与模型拦截链（`phase: "preview"`），最里层截下请求、
 * 不发给模型，也不写日志。改动按每一层调用 `next` 时收到的与交出的比较得出，不要求拦截自己报。
 * 预览过去的请求不在这一版（`atRequest` 得 `PreviewUnsupported`）。
 */

import type {Diagnostic, JsonValue, Message, ModelPort, ModelRequest, ModelResponse, PreviewArgs, PreviewResult, RequestBlock, RequestChange, RequestPath, Resources, ToolDeclaration} from "../api/index.js";
import {diagnosticCodes} from "../api/index.js";
import {estimateTokens, triggerPoint} from "../compaction/compact.js";
import type {SessionCore} from "../dispatch/core.js";
import {HANDLER_TIMEOUT_MS} from "../dispatch/reactions.js";
import {interceptCtx, type ViewEnvironment} from "../extension/ctx.js";
import {chainLayers, runChain} from "../run/chain.js";
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

/** 一层交出的请求与它收到的相比改了什么。 */
function changesBetween(before: ModelRequest, after: ModelRequest, extension: string): RequestChange[] {
    const changes: RequestChange[] = [];
    const list = <T>(a: readonly T[], b: readonly T[], path: (index: number) => RequestPath) => {
        for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
            if (index >= a.length) changes.push({extension, path: path(index), op: "insert", after: b[index] as RequestBlock | JsonValue});
            else if (index >= b.length) changes.push({extension, path: path(index), op: "remove", before: a[index] as RequestBlock | JsonValue});
            else if (!same(a[index], b[index])) changes.push({extension, path: path(index), op: "replace", before: a[index] as RequestBlock | JsonValue, after: b[index] as RequestBlock | JsonValue});
        }
    };
    const record = (a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>, area: "params" | "headers") => {
        for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
            if (!(key in a)) changes.push({extension, path: {area, key}, op: "insert", after: b[key] as JsonValue});
            else if (!(key in b)) changes.push({extension, path: {area, key}, op: "remove", before: a[key] as JsonValue});
            else if (!same(a[key], b[key])) changes.push({extension, path: {area, key}, op: "replace", before: a[key] as JsonValue, after: b[key] as JsonValue});
        }
    };
    list(before.system, after.system, (index) => ({area: "system", index}));
    for (let message = 0; message < Math.max(before.messages.length, after.messages.length); message += 1) {
        list(before.messages[message]?.content ?? [], after.messages[message]?.content ?? [], (block) => ({area: "messages", message, block}));
    }
    record(before.params as Record<string, unknown>, after.params as Record<string, unknown>, "params");
    record(before.headers, after.headers, "headers");
    list(before.tools, after.tools, (index) => ({area: "tools", index}));
    return changes;
}

const blockText = (block: RequestBlock): string => (block.kind === "text" || block.kind === "thinking" ? block.text : "");

export async function previewRequest(host: PreviewHost, args: PreviewArgs = {}): Promise<PreviewResult> {
    const {core} = host;
    if (args.atRequest !== undefined) throw new PreviewUnavailable("past-request-unsupported", "previewing a past request is not supported yet");
    const leaf = args.leaf === undefined ? core.leaf : args.leaf;
    if (leaf !== null && core.byId.get(leaf)?.scope !== "path") throw new PreviewUnavailable("unknown-node", `node ${leaf} is not in the session`);
    const resolution = host.models.resolve(core.session.kernel.core, "turn");
    if (!resolution.ok) throw new PreviewUnavailable(resolution.code, `no model for the next request (${resolution.code})`);
    const tools: readonly ToolDeclaration[] = host.box.current();
    const environment = host.environment(resolution.info, tools.map(toolInfo));
    const state = core.stateAt(leaf);
    const computed = computeRequest({assembly: core.assembly, state, environment, purpose: "turn", model: resolution.info.id, ...(core.session.kernel.core.effort === null ? {} : {effort: core.session.kernel.core.effort}), tools, cache: core.view, checks: false, inactive: (id) => core.revoked.has(id)});
    if (!computed.ok) throw new PreviewUnavailable(computed.reason, `the next request cannot be computed (${computed.reason})`);

    const changes: RequestChange[] = [];
    let captured: ModelRequest = computed.request;
    const synthetic: ModelResponse = {content: [], toolCalls: [], stopReason: "stop", usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, complete: true}, model: resolution.info.id};
    await runChain<ModelRequest, ModelResponse>({
        core,
        method: "model",
        layers: chainLayers(core, "model"),
        input: computed.request,
        signal: NEVER,
        timeoutMs: (item) => item.definition.timeoutMs ?? HANDLER_TIMEOUT_MS,
        ctxFor: (item, invocation, signal) => interceptCtx({assembly: core.assembly, item, state, environment, resources: host.resources, signal, invocation, phase: "preview"}),
        onNext: (item, received, passed) => changes.push(...changesBetween(received, passed, item.definition.id)),
        terminal: async (final) => {
            captured = final;
            return synthetic;
        },
        onFailure: () => ({kind: "skip"}),
        normalize: (_item, returned) => returned as ModelResponse,
    });

    // 各区的 token 估算：进行中这一轮的消息按来源的事件 id 认（工具结果按调用 id），开场按槽名，其余是历史。
    const current = state.history.current;
    const turnEvents = new Set(current === null ? [] : [...current.attachments, ...(current.input === null ? [] : [current.input]), ...current.steps.flatMap((step) => [step.reply, ...step.results, ...step.after])].map((event) => event.id));
    const turnCalls = new Set(current === null ? [] : current.steps.flatMap((step) => step.reply.data.toolCalls.map((call) => call.id)));
    const inTurn = (message: Message) => (message.role === "tool" && turnCalls.has(message.callId ?? "")) || message.content.some((block) => block.origin.kind === "event" && turnEvents.has(block.origin.eventId));
    const byArea = {system: 0, opening: 0, history: 0, turn: 0, tools: estimateTokens(JSON.stringify(captured.tools))};
    for (const block of captured.system) byArea[block.origin.kind === "slot" && block.origin.name === "opening" ? "opening" : "system"] += estimateTokens(blockText(block));
    for (const message of captured.messages) {
        for (const block of message.content) {
            const area = block.origin.kind === "slot" && block.origin.name === "opening" ? "opening" : inTurn(message) ? "turn" : "history";
            byArea[area] += estimateTokens(blockText(block));
        }
    }

    const diagnostics: Diagnostic[] = computed.problems.map((problem) => ({
        id: [problem.code, problem.extension, problem.entry, problem.subject ?? ""].join("|"),
        level: diagnosticCodes[problem.code],
        code: problem.code,
        extension: problem.extension,
        entry: problem.entry,
        params: problem.params ?? {},
        message: problem.message,
        ...(problem.hint === undefined ? {} : {hint: problem.hint}),
        count: 1,
        firstSeq: core.head,
        lastSeq: core.head,
        persisted: false,
    }));
    return {
        fidelity: "next",
        request: captured,
        original: computed.request,
        changes,
        slots: computed.slots.map((slot) => ({name: slot.name, extension: slot.extension, stable: !slot.volatile, placed: computed.placed.has(slot), tokens: estimateTokens(slot.text)})),
        skipped: core.assembly.order.filter((item) => core.inactive(item.definition.id)).map((item) => ({extension: item.definition.id, reason: core.revoked.has(item.definition.id) ? "revoked" as const : "failed" as const})),
        tokens: {estimated: Object.values(byArea).reduce((sum, value) => sum + value, 0), window: resolution.info.contextWindow, threshold: triggerPoint(resolution.info), byArea},
        diagnostics,
    };
}
