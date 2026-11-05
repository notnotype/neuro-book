/**
 * 把新内核的会话（快照、当前路径、日志帧与状态帧）合成视图要的数据，给 NeuroBook 的宿主用。输入是 JSON，本包不依赖 nb-harness，
 * 只认这里读到的字段；另有跑真内核的对契约测试（`kernel-transcript.test.ts`）。旧内核的适配器见 `harness.ts`。
 *
 * 分工：
 * - **路径上的状态**（消息、待处理的事项、中断）由 `applyPath` 整份重建，之后按日志帧增量更新。回退、切分支时宿主重取路径再来一次，
 *   不把各分支的日志接在一起（`applyEvent` 遇到 `leafChanged` 交回 `"leaf-changed"` 通知它）。
 * - **会话级的状态**（标题、设置、缓冲区、累计用量）以 `applySnapshot` 为基线，之后按日志帧增量更新；`path` 不返回这些事件。
 * - **增量只画“正在生成的那条”**，`assistant` 事件到了整条换掉。一次请求重发时丢掉半截（带 `retry` 的 `modelFailed`）。
 *
 * 每种事件只有一个去向，认不出的记 `problems()`，不抛错、不中断回放：输入来自磁盘与网络，日志里可能有更新版本写的事件。
 * 交出去的消息对象不再改动，状态变了换新对象；没变时 `messages()` 给同一个数组，宿主放进响应式状态不会多算。
 *
 * docs/specs/agent/conversation.md 输出 5、15–18；事件表见 Task 计划。
 */

import type {Text} from "@notnotype/nb-ui/text";

import {agentRef} from "./text";
import type {AgentTextKey} from "./text";
import type {AssistantMessageView, ContentBlockView, JsonValue, MessageView, RunStatus, ToolCallStatus, ToolCallView, UsageView, UserMessageView} from "./types";

export type KernelTranscriptProblem = {readonly source: string; readonly reason: string};

/** 等用户的一个事项。`request` 是内核事件里的原文：审批是 `{tool, args, effect, reason?}`，提问是工具给的 `{question, data}`。 */
export type KernelPending = {readonly id: string; readonly callId: string; readonly kind: "approval" | "question"; readonly request: JsonValue};

export type KernelQueued = {readonly id: string; readonly mode: "steer" | "followup"; readonly text: string};

export type KernelRun = {
    readonly status: RunStatus;
    /** 运行中的阶段；别的状态为 null。 */
    readonly phase: "requesting" | "streaming" | "tools" | "compacting" | null;
    /** 这次运行的开始时刻（日志时间）；打开会话时运行已在跑、路径里找不到时为 null。 */
    readonly startedAt: number | null;
    /** 模型请求失败、在等重发。 */
    readonly retry: JsonValue | null;
};

/** 累计的费用与 token（跨回退、含失败与后台用途），加上下文占用（最近一次回复的输入、缓存读、缓存写之和，即下一次请求至少要带的量）。 */
export type KernelUsage = {
    readonly cost: number;
    readonly unpriced: number;
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
    readonly context: number | null;
};

export type KernelMeta = {
    readonly title: string | null;
    readonly description: string | null;
    readonly archived: boolean;
    readonly settings: {readonly [key: string]: JsonValue};
    /** 快照的 `model`：`{ok: true, id, contextWindow, efforts}` 或 `{ok: false, code}`。 */
    readonly model: JsonValue;
    readonly profile: string | null;
    /** 会话为什么只读；可写时为 null。 */
    readonly readOnly: string | null;
};

export type KernelTranscript = {
    /** 会话级基线，也是日志帧的起点：seq 不大于快照 `head` 的日志帧之后会被丢掉。 */
    applySnapshot(snapshot: unknown): void;
    /** 重建当前路径：先清掉路径上的状态（含正在生成的那条），再依次归约。 */
    applyPath(events: readonly unknown[]): void;
    /** 一条日志事件（log 帧的 `event`）。路径变了要重取时交回 `"leaf-changed"`。 */
    applyEvent(event: unknown): "leaf-changed" | null;
    /** 不进日志的帧：`delta`、`status`、`tool`。别的帧忽略。 */
    applyFrame(frame: unknown): void;
    /** 发送之后、内核确认之前先显示的用户消息。`commandId` 用来和受理事件对上。 */
    addOptimistic(message: {readonly id: string; readonly commandId: string; readonly text: string; readonly timestamp: number}): void;
    /** 发送被拒，或用户选择移除。 */
    removeOptimistic(id: string): void;
    /** 连接断开、结果未知。 */
    markOptimisticUnknown(id: string): void;
    messages(): readonly MessageView[];
    pending(): readonly KernelPending[];
    run(): KernelRun;
    usage(): KernelUsage;
    queue(): readonly KernelQueued[];
    meta(): KernelMeta;
    /** 当前路径最后一次运行以 `interrupted` 结束，之后还没有新一轮。用户停止不算。 */
    interrupted(): boolean;
    problems(): readonly KernelTranscriptProblem[];
};

type JsonRecord = {readonly [key: string]: unknown};

const isRecord = (value: unknown): value is JsonRecord => value !== null && typeof value === "object" && !Array.isArray(value);
const stringField = (record: JsonRecord, key: string): string | null => (typeof record[key] === "string" ? record[key] : null);
const numberField = (record: JsonRecord, key: string): number | null => (typeof record[key] === "number" && Number.isFinite(record[key]) ? record[key] : null);

function toJsonValue(value: unknown): JsonValue {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (Array.isArray(value)) return value.map(toJsonValue);
    if (isRecord(value)) {
        const result: {[key: string]: JsonValue} = {};
        for (const [key, item] of Object.entries(value)) if (item !== undefined && typeof item !== "function") result[key] = toJsonValue(item);
        return result;
    }
    return null;
}

const ERROR_KEYS: {readonly [kind: string]: AgentTextKey} = {
    network: "harness.error.network",
    rate_limit: "harness.error.rateLimit",
    auth: "harness.error.auth",
    quota: "harness.error.quota",
    context_overflow: "harness.error.contextOverflow",
    provider: "harness.error.provider",
    local: "harness.error.local",
};
/** 运行结束的码（内核与守卫写的），比类别说得更清楚。 */
const CODE_KEYS: {readonly [code: string]: AgentTextKey} = {
    "cost-limit": "kernel.error.costLimit",
    "tool-call-loop": "kernel.error.toolCallLoop",
    "empty-reply": "kernel.error.emptyReply",
    "thinking-loop": "kernel.error.thinkingLoop",
    "first-event-timeout": "kernel.error.firstEventTimeout",
};
const RETRYABLE_KINDS = new Set(["network", "rate_limit", "provider"]);

/** 不变成消息、也不影响别的状态的内核事件。列出来是为了和“认不出”分开：认不出的记问题。 */
const IGNORED = new Set(["sessionCreated", "turnStarted", "turnEnded", "toolsAnnounced", "modelEnded", "profileChanged", "approvalRemembered", "extensionFailed", "reactionLimit"]);
const USAGE_EVENTS = new Set(["assistant", "modelEnded", "modelFailed"]);

function errorText(error: JsonRecord): Text {
    const code = stringField(error, "code");
    const kind = stringField(error, "kind") ?? "local";
    return agentRef((code === null ? undefined : CODE_KEYS[code]) ?? ERROR_KEYS[kind] ?? ERROR_KEYS.local!);
}

function usageView(usage: unknown): UsageView | null {
    if (!isRecord(usage)) return null;
    const [input, output, cacheRead, cacheWrite] = ["input", "output", "cacheRead", "cacheWrite"].map((key) => numberField(usage, key));
    if (input === null || output === null || cacheRead === null || cacheWrite === null) return null;
    return {input: input!, output: output!, cacheRead: cacheRead!, cacheWrite: cacheWrite!, cost: usage.cost === null ? null : numberField(usage, "cost")};
}

/** 工具结果的状态与副文字。 */
function callOutcome(data: JsonRecord): {status: ToolCallStatus; note?: Text} {
    const code = stringField(data, "code");
    const by = stringField(data, "by");
    switch (data.status) {
        case "ok": return {status: "success"};
        case "error": return {status: code === "invalid-arguments" ? "invalid" : "error"};
        case "unknown": return {status: "unknown", note: agentRef("kernel.tool.unknown")};
        case "denied":
        case "blocked":
            if (code === "user-denied" || by === "user") return {status: "denied", note: agentRef("kernel.tool.deniedByUser")};
            if (code === "read-only") return {status: "denied", note: agentRef("kernel.tool.readOnly")};
            if (code === "aborted" || code === "interrupted-before-approval") return {status: "denied", note: agentRef("kernel.tool.notStarted")};
            return {status: "denied", note: agentRef("kernel.tool.deniedByRule")};
        default: return {status: "error"};
    }
}

/** 正在写的工具参数还不是合法的 JSON：抽路径与字数，让界面先画出“在写哪个文件、写了多少”。 */
function streamingArgs(text: string): JsonValue {
    const path = /"path"\s*:\s*"((?:[^"\\]|\\.)*)"/u.exec(text)?.[1];
    return {...(path === undefined ? {} : {path}), partialChars: text.length};
}

const NO_USAGE: KernelUsage = {cost: 0, unpriced: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, context: null};
const NO_META: KernelMeta = {title: null, description: null, archived: false, settings: {}, model: null, profile: null, readOnly: null};
const IDLE_RUN: KernelRun = {status: "idle", phase: null, startedAt: null, retry: null};

type LiveCall = {readonly id: string; readonly name: string; args: string};
type Live = {request: number; next: number; text: string; thinking: string; calls: LiveCall[]; broken: boolean};
type Optimistic = {readonly commandId: string; view: UserMessageView};

export function createKernelTranscript(options: {readonly toolName?: (id: string) => string} = {}): KernelTranscript {
    const toolName = options.toolName ?? ((id: string) => id);
    const problems: KernelTranscriptProblem[] = [];
    const problem = (source: string, reason: string): void => void problems.push({source, reason});

    // 路径上的状态
    let logged: MessageView[] = [];
    let pending: KernelPending[] = [];
    let interrupted = false;
    let startedAt: number | null = null;
    let context: number | null = null;
    /** `modelStarted` 记下的用途：`modelFailed` 不带用途，半截文字只有对话请求的才算回复。 */
    let purposes = new Map<number, string>();
    let live: Live | null = null;
    /** 执行完、结果还没写下的调用（`tool` 帧）。 */
    let finishedCalls = new Map<string, ToolCallStatus>();

    // 会话级的状态
    let lastSeq = 0;
    let usage = NO_USAGE;
    let meta = NO_META;
    let queue: KernelQueued[] = [];
    let run = IDLE_RUN;
    let optimistic: Optimistic[] = [];

    let cached: readonly MessageView[] | null = null;
    const touched = (): void => {
        cached = null;
    };

    const updateCall = (callId: string, change: (call: ToolCallView) => ToolCallView): boolean => {
        for (let index = logged.length - 1; index >= 0; index -= 1) {
            const message = logged[index]!;
            if (message.kind !== "assistant" || !message.toolCalls.some((call) => call.id === callId)) continue;
            logged[index] = {...message, toolCalls: message.toolCalls.map((call) => (call.id === callId ? change(call) : call))};
            return true;
        }
        return false;
    };

    const assistantFrom = (data: JsonRecord, id: string, timestamp: number, status: AssistantMessageView["status"], blocks: readonly unknown[], calls: readonly unknown[]): AssistantMessageView => {
        let text = "";
        let thinking = "";
        for (const block of blocks) {
            if (!isRecord(block)) continue;
            if (block.kind === "text" && typeof block.text === "string") text += block.text;
            if (block.kind === "thinking" && typeof block.text === "string") thinking += block.text;
        }
        const toolCalls = calls.flatMap((call): ToolCallView[] => {
            if (!isRecord(call) || typeof call.id !== "string" || typeof call.tool !== "string") return [];
            return [{id: call.id, name: toolName(call.tool), status: "running", args: toJsonValue(call.args ?? {})}];
        });
        const view = usageView(data.usage);
        return {kind: "assistant", id, timestamp, status, text, thinking, model: stringField(data, "model") ?? "", toolCalls, contentOmitted: false, ...(view === null ? {} : {usage: view})};
    };

    const contextOf = (data: JsonRecord): void => {
        const view = usageView(data.usage);
        if (view !== null) context = view.input + view.cacheRead + view.cacheWrite;
    };

    /** 路径上的事件。session 事件走 `reduceSession`。 */
    function reducePath(type: string, data: JsonRecord, id: string, at: number): void {
        const source = `${type} ${id}`;
        switch (type) {
            case "input":
            case "steer": {
                const text = stringField(data, "text") ?? "";
                const attachments = Array.isArray(data.attachments) ? data.attachments.flatMap((item): ContentBlockView[] => (isRecord(item) && typeof item.uri === "string" ? [{kind: "attachment", locator: item.uri, name: item.uri.slice(item.uri.lastIndexOf("/") + 1), mimeType: item.kind === "image" ? "image/*" : "", bytes: 0}] : [])) : [];
                logged.push({kind: "user", id, timestamp: at, intent: type === "steer" ? "steer" : "normal", blocks: [...(text === "" ? [] : [{kind: "text" as const, text}]), ...attachments], contentOmitted: false});
                // 内核确认了：换掉最早的乐观消息。拦截可能改写了文字，所以只按先后，不按内容。
                optimistic = optimistic.slice(1);
                return;
            }
            case "assistant": {
                if (!Array.isArray(data.content) || !Array.isArray(data.toolCalls)) {
                    problem(source, "assistant 缺 content 或 toolCalls");
                    return;
                }
                if (live?.request === numberField(data, "request")) live = null;
                logged.push(assistantFrom(data, id, at, "done", data.content, data.toolCalls));
                contextOf(data);
                return;
            }
            case "toolStarted": {
                const callId = stringField(data, "callId");
                // 实际执行的参数：拦截可能改过。
                if (callId !== null && data.args !== undefined) updateCall(callId, (call) => ({...call, args: toJsonValue(data.args)}));
                return;
            }
            case "toolResult": {
                const callId = stringField(data, "callId");
                const text = stringField(data, "text") ?? "";
                if (callId === null) {
                    problem(source, "工具结果缺 callId");
                    return;
                }
                finishedCalls.delete(callId);
                const outcome = callOutcome(data);
                const found = updateCall(callId, (call) => ({
                    ...call,
                    status: outcome.status,
                    result: {text, truncated: false, ...(data.details === undefined ? {} : {details: toJsonValue(data.details)})},
                    ...(outcome.status === "success" ? {} : {error: text}),
                    ...(outcome.note === undefined ? {} : {note: outcome.note}),
                }));
                if (!found) problem(source, `工具结果找不到对应的调用：${callId}`);
                return;
            }
            case "modelStarted": {
                const request = numberField(data, "request");
                if (request !== null) purposes.set(request, stringField(data, "purpose") ?? "turn");
                return;
            }
            case "modelFailed": {
                const request = numberField(data, "request");
                if (request === null || (purposes.get(request) ?? "turn") !== "turn") return;
                if (live?.request === request) live = null;
                // 带 retry：这次运行还要接着发，半截文字作废。没带的半截落成一条消息，已经花了钱，不能丢。
                if (data.retry !== undefined || !Array.isArray(data.partial) || data.partial.length === 0) return;
                const kind = stringField(data, "kind");
                const status: AssistantMessageView["status"] = kind === "aborted" ? "stopped" : kind === "interrupted" ? "interrupted" : "error";
                logged.push(assistantFrom(data, id, at, status, data.partial, []));
                contextOf(data);
                return;
            }
            case "runStarted":
                interrupted = false;
                startedAt = at;
                return;
            case "runEnded": {
                live = null;
                finishedCalls = new Map();
                startedAt = null;
                const reason = stringField(data, "reason");
                interrupted = reason === "interrupted";
                if (reason === "aborted") {
                    const last = logged.at(-1);
                    if (last?.kind === "assistant") logged[logged.length - 1] = {...last, status: "stopped"};
                    // 模型还没开口就被停了：补一条空的回复，分轮层才会在这一轮末尾写“已停止”。
                    else logged.push({kind: "assistant", id, timestamp: at, status: "stopped", text: "", thinking: "", model: "", toolCalls: [], contentOmitted: false});
                } else if (reason === "error") {
                    const error = isRecord(data.error) ? data.error : {};
                    logged.push({kind: "error", id, timestamp: at, message: errorText(error), retryable: RETRYABLE_KINDS.has(stringField(error, "kind") ?? "")});
                }
                return;
            }
            case "compaction":
                logged.push({kind: "system", id, timestamp: at, source: "compaction", label: agentRef("harness.compaction"), text: stringField(data, "replacement") ?? ""});
                {
                    const after = numberField(data, "tokensAfter");
                    if (after !== null) context = after;
                }
                return;
            case "continued":
                // `text` 是写给模型的，界面用自己的文案。
                logged.push({kind: "system", id, timestamp: at, source: "reminder", label: agentRef("kernel.continued"), text: ""});
                return;
            case "notice":
                // `tools-changed`、`restored` 只和模型有关。
                if (data.code === "result-requested") logged.push({kind: "system", id, timestamp: at, source: "reminder", label: agentRef("kernel.resultRequested"), text: ""});
                return;
            case "interactionRequested": {
                const interaction = stringField(data, "id");
                const callId = stringField(data, "callId");
                const kind = data.kind === "approval" || data.kind === "question" ? data.kind : null;
                if (interaction === null || callId === null || kind === null) {
                    problem(source, "事项缺 id、callId 或 kind");
                    return;
                }
                // 异步提问不让运行停下，第一版不进向导（conversation.md 的不承诺）。
                if (data.async !== true) pending = [...pending, {id: interaction, callId, kind, request: toJsonValue(data.request)}];
                return;
            }
            case "interactionResolved":
                pending = pending.filter((item) => item.id !== data.id);
                return;
            default:
                if (!IGNORED.has(type)) problem(source, `不认识的事件：${type}`);
        }
    }

    /** 会话级事件；是的话交回 true。 */
    function reduceSession(type: string, data: JsonRecord): boolean {
        switch (type) {
            case "titleChanged":
                meta = {...meta, title: stringField(data, "title")};
                return true;
            case "descriptionChanged":
                meta = {...meta, description: stringField(data, "description")};
                return true;
            case "archived":
                meta = {...meta, archived: data.archived === true};
                return true;
            case "settingsChanged":
                if (data.extension === "core" && isRecord(data.patch)) meta = {...meta, settings: {...meta.settings, ...(toJsonValue(data.patch) as {[key: string]: JsonValue})}};
                return true;
            case "inputQueued": {
                const id = stringField(data, "id");
                const input = isRecord(data.input) ? data.input : {};
                if (id !== null) queue = [...queue, {id, mode: data.mode === "steer" ? "steer" : "followup", text: stringField(input, "text") ?? ""}];
                return true;
            }
            case "inputEdited": {
                const input = isRecord(data.input) ? data.input : {};
                queue = queue.map((item) => (item.id === data.id ? {...item, text: stringField(input, "text") ?? item.text} : item));
                return true;
            }
            case "inputRemoved":
            case "inputConsumed":
                queue = queue.filter((item) => item.id !== data.id);
                return true;
            case "commandAccepted": {
                // `send` 撞上别的运行时进了缓冲区（值里没有 runId）：排队区会显示它，乐观消息撤掉。
                const value = isRecord(data.value) ? data.value : {};
                if (data.name === "send" && value.runId === null) optimistic = optimistic.filter((item) => item.commandId !== data.commandId);
                return true;
            }
            default:
                return false;
        }
    }

    function addUsage(data: JsonRecord): void {
        const view = usageView(data.usage);
        if (view === null) return;
        usage = {
            ...usage,
            cost: usage.cost + (view.cost ?? 0),
            unpriced: usage.unpriced + (view.cost === null ? 1 : 0),
            input: usage.input + view.input,
            output: usage.output + view.output,
            cacheRead: usage.cacheRead + view.cacheRead,
            cacheWrite: usage.cacheWrite + view.cacheWrite,
        };
    }

    const parseEvent = (event: unknown): {record: JsonRecord; type: string; data: JsonRecord; id: string; at: number; seq: number | null} | null => {
        if (!isRecord(event) || typeof event.type !== "string") {
            problem("日志", "事件不是带 type 的对象");
            return null;
        }
        return {record: event, type: event.type, data: isRecord(event.data) ? event.data : {}, id: stringField(event, "id") ?? `seq-${String(event.seq)}`, at: numberField(event, "at") ?? 0, seq: numberField(event, "seq")};
    };

    /** 扩展自己的事件不归这里管（费用告警由快照与设置算）。 */
    const isExtensionEvent = (parsed: {record: JsonRecord; type: string}): boolean => parsed.type.includes("/") || parsed.record.kind === "ext";

    function liveMessage(current: Live): AssistantMessageView {
        return {
            kind: "assistant",
            id: `live-${String(current.request)}`,
            timestamp: 0,
            status: "streaming",
            text: current.text,
            thinking: current.thinking,
            model: "",
            toolCalls: current.calls.map((call) => ({id: call.id, name: call.name, status: "streaming" as const, args: streamingArgs(call.args)})),
            contentOmitted: false,
        };
    }

    function applyDelta(frame: JsonRecord): void {
        // 压缩、审批模型这些请求的增量不是助手的回复。
        if (frame.purpose !== "turn") return;
        const request = numberField(frame, "request");
        const n = numberField(frame, "n");
        const text = stringField(frame, "text");
        if (request === null || n === null || text === null) {
            problem("delta", "增量缺 request、n 或 text");
            return;
        }
        // n 从 1 重新开始：重连后服务端的合并器重新编号，手里的内容接不上，清空重来；后面的增量会补上重连之后的部分。
        if (live === null || live.request !== request || n === 1) live = {request, next: 1, text: "", thinking: "", calls: [], broken: false};
        // 中间丢了帧：这条回复的临时内容已经不完整，不再画，等 `assistant` 事件。
        if (n !== live.next) live.broken = true;
        live.next = n + 1;
        if (live.broken) return;
        if (frame.part === "text") live.text += text;
        else if (frame.part === "thinking") live.thinking += text;
        else if (frame.part === "toolArgs") {
            const callId = stringField(frame, "callId");
            if (callId === null) return;
            let call = live.calls.find((item) => item.id === callId);
            if (call === undefined) {
                const tool = stringField(frame, "tool");
                call = {id: callId, name: tool === null ? "" : toolName(tool), args: ""};
                live.calls.push(call);
            }
            call.args += text;
        }
    }

    function applyStatus(status: JsonRecord): void {
        const state = status.state;
        run = {
            status: state === "running" ? "running" : state === "waiting" ? "waiting" : state === "aborting" ? "stopping" : "idle",
            phase: state === "running" && (status.phase === "requesting" || status.phase === "streaming" || status.phase === "tools" || status.phase === "compacting") ? status.phase : null,
            startedAt,
            retry: state === "running" && status.retry !== undefined ? toJsonValue(status.retry) : null,
        };
    }

    const resetPath = (): void => {
        logged = [];
        pending = [];
        interrupted = false;
        startedAt = null;
        context = null;
        purposes = new Map();
        live = null;
        finishedCalls = new Map();
    };

    return {
        applySnapshot(snapshot) {
            if (!isRecord(snapshot)) {
                problem("快照", "不是对象");
                return;
            }
            lastSeq = numberField(snapshot, "head") ?? lastSeq;
            const spend = isRecord(snapshot.usage) ? snapshot.usage : {};
            usage = {
                ...usage,
                cost: numberField(spend, "cost") ?? 0,
                unpriced: numberField(spend, "unpriced") ?? 0,
                input: numberField(spend, "input") ?? 0,
                output: numberField(spend, "output") ?? 0,
                cacheRead: numberField(spend, "cacheRead") ?? 0,
                cacheWrite: numberField(spend, "cacheWrite") ?? 0,
            };
            const profile = isRecord(snapshot.profile) ? stringField(snapshot.profile, "id") : null;
            const readOnly = isRecord(snapshot.readOnly) ? stringField(snapshot.readOnly, "code") : null;
            meta = {
                title: stringField(snapshot, "title"),
                description: stringField(snapshot, "description"),
                archived: snapshot.archived === true,
                settings: isRecord(snapshot.settings) ? (toJsonValue(snapshot.settings) as {[key: string]: JsonValue}) : {},
                model: toJsonValue(snapshot.model),
                profile,
                readOnly,
            };
            queue = Array.isArray(snapshot.buffer) ? snapshot.buffer.flatMap((item): KernelQueued[] => {
                if (!isRecord(item) || typeof item.id !== "string") return [];
                const input = isRecord(item.input) ? item.input : {};
                return [{id: item.id, mode: item.mode === "steer" ? "steer" : "followup", text: stringField(input, "text") ?? ""}];
            }) : [];
            if (isRecord(snapshot.status)) applyStatus(snapshot.status);
            touched();
        },

        applyPath(events) {
            resetPath();
            for (const event of events) {
                const parsed = parseEvent(event);
                if (parsed === null || isExtensionEvent(parsed)) continue;
                reducePath(parsed.type, parsed.data, parsed.id, parsed.at);
            }
            // 打开时运行已在跑：开始时刻在路径里读到了，补进状态。
            run = {...run, startedAt};
            touched();
        },

        applyEvent(event) {
            const parsed = parseEvent(event);
            if (parsed === null) return null;
            if (parsed.seq !== null) {
                if (parsed.seq <= lastSeq) return null;
                lastSeq = parsed.seq;
            }
            touched();
            if (USAGE_EVENTS.has(parsed.type)) addUsage(parsed.data);
            if (parsed.type === "leafChanged") return "leaf-changed";
            if (isExtensionEvent(parsed) || reduceSession(parsed.type, parsed.data)) return null;
            reducePath(parsed.type, parsed.data, parsed.id, parsed.at);
            return null;
        },

        applyFrame(frame) {
            if (!isRecord(frame)) return;
            touched();
            switch (frame.type) {
                case "delta":
                    applyDelta(frame);
                    return;
                case "status":
                    if (isRecord(frame.status)) applyStatus(frame.status);
                    return;
                case "tool": {
                    const callId = stringField(frame, "callId");
                    if (callId !== null) finishedCalls.set(callId, callOutcome({status: frame.status}).status);
                    return;
                }
            }
        },

        addOptimistic({id, commandId, text, timestamp}) {
            optimistic = [...optimistic, {commandId, view: {kind: "user", id, timestamp, intent: "normal", blocks: text === "" ? [] : [{kind: "text", text}], contentOmitted: false, delivery: "pending"}}];
            touched();
        },
        removeOptimistic(id) {
            optimistic = optimistic.filter((item) => item.view.id !== id);
            touched();
        },
        markOptimisticUnknown(id) {
            optimistic = optimistic.map((item) => (item.view.id === id ? {...item, view: {...item.view, delivery: "unknown"}} : item));
            touched();
        },

        messages() {
            if (cached !== null) return cached;
            const settled = finishedCalls.size === 0 ? logged : logged.map((message) => {
                if (message.kind !== "assistant" || !message.toolCalls.some((call) => finishedCalls.has(call.id))) return message;
                return {...message, toolCalls: message.toolCalls.map((call) => {
                    const status = finishedCalls.get(call.id);
                    return status === undefined ? call : {...call, status};
                })};
            });
            const streaming = live === null || live.broken ? [] : [liveMessage(live)];
            cached = [...settled, ...optimistic.map((item) => item.view), ...streaming];
            return cached;
        },
        pending: () => pending,
        run: () => run,
        usage: () => ({...usage, context}),
        queue: () => queue,
        meta: () => meta,
        interrupted: () => interrupted,
        problems: () => problems,
    };
}
