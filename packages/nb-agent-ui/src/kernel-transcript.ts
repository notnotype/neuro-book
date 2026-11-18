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
import type {AssistantMessageView, CompactionView, ContentBlockView, JsonValue, MessageView, RunStatus, ToolCallStatus, ToolCallView, UsageView, UserMessageView} from "./types";

export type KernelTranscriptProblem = {readonly source: string; readonly reason: string};

/**
 * 等用户的一个事项。`request` 是内核事件里的原文：审批是 `{tool, args, effect, reason?}`，提问是工具给的 `{question, data}`。
 * `async`：异步提问，不让运行停下，进停靠区（docs/specs/ui/agent-conversation-view.md“输入框与待处理区”）。
 * `within`：嵌套调用的事项，`tool` 是外层工具的 id（没换成界面名），`invocation` 是外层那次调用的身份；`callId` 这时是嵌套调用的 id。
 */
export type KernelPending = {
    readonly id: string;
    readonly callId: string;
    readonly kind: "approval" | "question";
    readonly request: JsonValue;
    readonly async?: true;
    readonly within?: {readonly tool: string; readonly invocation: string};
};

/**
 * 缓冲区里的一条（harness/runtime.md 输出 103）：发出者（没有是用户）、就绪或留着、留着的原因与停的人、改过几次、受理它的指令。
 * `attachments` 是原样的附件（合并留着的话时要带上）。
 */
export type KernelQueued = {
    readonly id: string;
    readonly mode: "steer" | "followup";
    readonly text: string;
    readonly attachments?: readonly JsonValue[];
    readonly by?: KernelIssuer;
    readonly state: "ready" | "held";
    readonly cause?: KernelHeldCause;
    readonly heldBy?: KernelIssuer | {readonly kind: "user"};
    readonly edits: number;
    readonly commandId?: string;
};

/** 话为什么留着：运行的收口方式（加码），或空闲时排的（开不起运行时带码）。 */
export type KernelHeldCause = {readonly end: string; readonly code?: string} | {readonly queued: "idle"; readonly code?: string};

export type KernelRun = {
    readonly status: RunStatus;
    /** 运行中的阶段；别的状态为 null。 */
    readonly phase: "requesting" | "streaming" | "tools" | "compacting" | null;
    /** 只压缩的运行（`runStarted.kind`）；别的运行为 null。 */
    readonly kind: "compact" | null;
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
    /** 最近一次模型回复的缓存命中率；服务商不报缓存时为 null。 */
    readonly lastCacheHitRate: number | null;
};

/** `modelParent`：产生这条回复的模型请求的父节点，也就是内核 `after-step` 目标的 id。用户的话没有。 */
export type KernelAnchor = {readonly turnId: string | null; readonly modelParent: string | null};

export type KernelMeta = {
    readonly title: string | null;
    readonly description: string | null;
    readonly archived: boolean;
    readonly settings: {readonly [key: string]: JsonValue};
    /** 扩展的设置，按扩展 id：Agent 模式在这里。 */
    readonly extensionSettings: {readonly [extension: string]: {readonly [key: string]: JsonValue}};
    /** 快照的 `model`：`{ok: true, id, contextWindow, efforts}` 或 `{ok: false, code}`。 */
    readonly model: JsonValue;
    readonly profile: string | null;
    /** 会话为什么只读；可写时为 null。 */
    readonly readOnly: string | null;
};

export type KernelTranscript = {
    /** 会话级基线，也是日志帧的起点：seq 不大于快照 `head` 的日志帧之后会被丢掉。 */
    applySnapshot(snapshot: unknown): void;
    /** 只换解析到的模型（快照的 `model`）：模型库或会话的模型设置变了时用，运行状态、队列、路径与正在生成的那条都不动。 */
    setModel(model: unknown): void;
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
    /** 这条消息在树上的位置，改写历史时用它精确选回退目标（docs/specs/agent/conversation.md 输出 25）。 */
    anchorOf(messageId: string): KernelAnchor | null;
    /** 这句话带的附件（事件里写的样子）：编辑重发时带上，不然图就丢了。 */
    attachmentsOf(messageId: string): readonly JsonValue[];
    /** 当前路径上所有 path 事件的 id，按路径顺序。 */
    pathIds(): readonly string[];
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
    "compaction-failed": "kernel.error.compactionFailed",
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

/** 压缩事件里能给界面的部分（数字与字符串）；缺字段、认不出的不显示，不报错。 */
function compactionView(data: JsonRecord, turnStarts: readonly string[]): CompactionView | null {
    const method = stringField(data, "method");
    const before = numberField(data, "tokensBefore");
    const after = numberField(data, "tokensAfter");
    if (method === null || before === null || after === null) return null;
    const details = isRecord(data.details) ? data.details : {};
    const usage = isRecord(details.usage) ? details.usage : null;
    const modelName = stringField(details, "model");
    const restored = Array.isArray(data.restored) ? data.restored.flatMap((item): CompactionView["restored"] => {
        if (!isRecord(item)) return [];
        const kind = item.kind === "file" || item.kind === "plan" || item.kind === "log" || item.kind === "skill" ? item.kind : null;
        const target = stringField(item, "target");
        return kind === null || target === null ? [] : [{kind, target, tokens: numberField(item, "tokens") ?? 0, truncated: item.truncated === true}];
    }) : [];
    const kept = stringField(data, "firstKeptEntryId");
    const keptAt = kept === null ? -1 : turnStarts.indexOf(kept);
    return {
        method,
        tokensBefore: before,
        tokensAfter: after,
        model: modelName === null || usage === null ? null : {name: modelName, input: numberField(usage, "input") ?? 0, output: numberField(usage, "output") ?? 0, cacheRead: numberField(usage, "cacheRead") ?? 0, cacheWrite: numberField(usage, "cacheWrite") ?? 0, cost: usage.cost === null ? null : numberField(usage, "cost")},
        require: Array.isArray(details.require) ? details.require.filter((item): item is string => typeof item === "string") : [],
        restored,
        omitted: Array.isArray(data.omitted) ? data.omitted.length : 0,
        // 没有摘要（shake）时每一轮都还在、只换了占位，“保留最近几轮”没有意思。
        keptTurns: keptAt === -1 || data.replacement === null ? null : turnStarts.length - keptAt,
    };
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
            if (code === "mode-blocked") return {status: "denied", note: agentRef("kernel.tool.modeBlocked")};
            if (code === "aborted" || code === "interrupted-before-approval") return {status: "denied", note: agentRef("kernel.tool.notStarted")};
            return {status: "denied", note: agentRef("kernel.tool.deniedByRule")};
        default: return {status: "error"};
    }
}

/**
 * 正在写的工具参数还不是合法的 JSON：抽路径、标题与字数，让界面先画出“在写哪个文件、写了多少”，卡片的标题（例如 eval 的
 * `title`）也不空着。只认已经写完的字段值。
 */
function streamingArgs(text: string): JsonValue {
    const field = (name: string): string | undefined => {
        const raw = new RegExp(`"${name}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, "u").exec(text)?.[1];
        if (raw === undefined) return undefined;
        try {
            return JSON.parse(`"${raw}"`) as string;
        } catch {
            // 转义写了一半之类的：先按原样显示，参数写完后整条换掉。
            return raw;
        }
    };
    const path = field("path");
    const title = field("title");
    return {...(path === undefined ? {} : {path}), ...(title === undefined ? {} : {title}), partialChars: text.length};
}

/** 嵌套调用结果的预览是前若干字节，`size` 是全文的字节数：比预览长就是只给了预览。 */
const utf8 = new TextEncoder();
const isPreviewOnly = (preview: string, size: number | null): boolean => size !== null && size > utf8.encode(preview).length;

/** 还没有结果的调用（审批中、执行中）：外层调用有了结果、它们还没有时，按“不知道有没有执行完”收口。 */
const unsettled = (status: ToolCallStatus): boolean => status === "running" || status === "streaming";

const NO_USAGE: KernelUsage = {cost: 0, unpriced: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, context: null, lastCacheHitRate: null};
const NO_META: KernelMeta = {title: null, description: null, archived: false, settings: {}, extensionSettings: {}, model: null, profile: null, readOnly: null};
const IDLE_RUN: KernelRun = {status: "idle", phase: null, kind: null, startedAt: null, retry: null};

type LiveCall = {readonly id: string; readonly name: string; args: string};
type Live = {request: number; next: number; text: string; thinking: string; calls: LiveCall[]; broken: boolean};
type Optimistic = {readonly commandId: string; view: UserMessageView};

/** 别的会话或宿主以自己的身份发来的话的发出者（`input`、`steer` 事件的 `by`，harness/runtime.md 输出 85）；用户发的没有。 */
export type KernelIssuer = {readonly kind: "session"; readonly id: string} | {readonly kind: "host"; readonly source: {readonly plugin: string; readonly label: string; readonly ref?: string; readonly at?: number}};

/** 事件里的发出者；认不出的按没有（用户）。 */
function issuerOf(value: unknown): KernelIssuer | {readonly kind: "user"} | null {
    if (!isRecord(value)) return null;
    if (value.kind === "user") return {kind: "user"};
    if (value.kind === "session" && typeof value.id === "string") return {kind: "session", id: value.id};
    if (value.kind === "host" && isRecord(value.source) && typeof value.source.plugin === "string" && typeof value.source.label === "string") {
        const {plugin, label, ref, at} = value.source;
        return {kind: "host", source: {plugin, label, ...(typeof ref === "string" ? {ref} : {}), ...(typeof at === "number" ? {at} : {})}};
    }
    return null;
}

function heldCauseOf(value: unknown): KernelHeldCause | undefined {
    if (!isRecord(value)) return undefined;
    const code = typeof value.code === "string" ? {code: value.code} : {};
    if (typeof value.end === "string") return {end: value.end, ...code};
    if (value.queued === "idle") return {queued: "idle", ...code};
    return undefined;
}

/** 缓冲区里的一条：事件与快照共用一个读法。 */
function queuedOf(data: JsonRecord, defaults: {readonly state?: unknown; readonly edits?: unknown}): KernelQueued | null {
    const id = stringField(data, "id");
    if (id === null) return null;
    const input = isRecord(data.input) ? data.input : {};
    const by = issuerOf(data.by);
    const heldBy = issuerOf(data.heldBy);
    const cause = heldCauseOf(data.cause);
    const held = defaults.state === "held";
    return {
        id,
        mode: data.mode === "steer" ? "steer" : "followup",
        text: stringField(input, "text") ?? "",
        ...(Array.isArray(input.attachments) ? {attachments: input.attachments as readonly JsonValue[]} : {}),
        ...(by === null || by.kind === "user" ? {} : {by}),
        state: held ? "held" : "ready",
        ...(held && cause !== undefined ? {cause} : {}),
        ...(held && heldBy !== null ? {heldBy} : {}),
        edits: typeof defaults.edits === "number" ? defaults.edits : 0,
        ...(typeof data.commandId === "string" ? {commandId: data.commandId} : {}),
    };
}

/**
 * `toolName`：工具 id 换成界面认的名字。`authorOf`：路径上 `by` 是别的会话的那些话（父 Agent 发给子代理的）用谁的头像与名称；
 * 不给时都画成用户。
 */
export function createKernelTranscript(options: {readonly toolName?: (id: string) => string; readonly authorOf?: (by: KernelIssuer) => UserMessageView["author"]} = {}): KernelTranscript {
    const toolName = options.toolName ?? ((id: string) => id);
    const problems: KernelTranscriptProblem[] = [];
    const problem = (source: string, reason: string): void => void problems.push({source, reason});

    // 路径上的状态
    let logged: MessageView[] = [];
    let pending: KernelPending[] = [];
    let interrupted = false;
    let startedAt: number | null = null;
    let context: number | null = null;
    let lastCacheHitRate: number | null = null;
    let anchors = new Map<string, KernelAnchor>();
    let inputAttachments = new Map<string, readonly JsonValue[]>();
    let pathIds: string[] = [];
    let anchorTurn: string | null = null;
    let anchorModelParent: string | null = null;
    let anchorRequest: number | null = null;
    /** 这次运行是不是只压缩的：它没有 `input`，运行收口时不能把上一轮的回复当成这次的。 */
    let runKind: "compact" | null = null;
    /** 路径上每一轮的 `turnStarted` 事件 id，按顺序：压缩的切点按它数“保留了几轮”。 */
    let turnStarts: string[] = [];
    /** `modelStarted` 记下的用途：`modelFailed` 不带用途，半截文字只有对话请求的才算回复。 */
    let purposes = new Map<number, string>();
    let live: Live | null = null;
    let lastSettledRequest = 0;
    /** 执行完、结果还没写下的调用（`tool` 帧）。 */
    let finishedCalls = new Map<string, ToolCallStatus>();

    // 会话级的状态
    let lastSeq = 0;
    let usage = NO_USAGE;
    let meta = NO_META;
    let queue: KernelQueued[] = [];
    let run = IDLE_RUN;
    let optimistic: Optimistic[] = [];
    const confirmOptimistic = (commandId: string) => {
        optimistic = optimistic.filter((item) => item.commandId !== commandId);
    };
    /** 乐观消息前面还有几条别的发出者放行出来、还没取走的话：取走一条少一条（ui/agent-conversation-view.md 的“前面还有 N 条”）。 */
    const withAhead = (item: Optimistic): UserMessageView => {
        const index = queue.findIndex((entry) => entry.commandId === item.commandId);
        if (index <= 0) return item.view;
        const ahead = queue.slice(0, index).filter((entry) => entry.state === "ready" && entry.by !== undefined).length;
        return ahead === 0 ? item.view : {...item.view, ahead};
    };

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

    /**
     * 改外层调用（按 `invocation` 找，嵌套事件只带外层的身份）下的一个子调用，没有就建：没开始就被拒的嵌套调用只有结果，
     * 审批中的先放占位。找不到外层调用交回 false。
     */
    const updateChild = (parent: string, childId: string, change: (child: ToolCallView | undefined) => ToolCallView): boolean => {
        for (let index = logged.length - 1; index >= 0; index -= 1) {
            const message = logged[index]!;
            if (message.kind !== "assistant") continue;
            const at = message.toolCalls.findIndex((call) => call.invocation === parent);
            if (at < 0) continue;
            const call = message.toolCalls[at]!;
            const children = call.children ?? [];
            const position = children.findIndex((child) => child.id === childId);
            const next = position < 0 ? [...children, change(undefined)] : children.map((child, i) => (i === position ? change(child) : child));
            logged[index] = {...message, toolCalls: message.toolCalls.map((item, i) => (i === at ? {...call, children: next} : item))};
            return true;
        }
        return false;
    };

    /** 嵌套事件与嵌套事项的 `within`：外层工具的 id 与那次调用的身份。 */
    const withinOf = (data: JsonRecord): {tool: string; invocation: string} | null => {
        const within = isRecord(data.within) ? data.within : null;
        const tool = within === null ? null : stringField(within, "tool");
        const invocation = within === null ? null : stringField(within, "invocation");
        return tool === null || invocation === null ? null : {tool, invocation};
    };

    const assistantFrom =(data: JsonRecord, id: string, timestamp: number, status: AssistantMessageView["status"], blocks: readonly unknown[], calls: readonly unknown[]): AssistantMessageView => {
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
        // 只有记过 `modelStarted` 的序号才是真发出去的请求（拦截层直接交回的回复也带序号，但没有请求）。
        const request = numberField(data, "request");
        const sent = request !== null && purposes.has(request);
        return {kind: "assistant", id, timestamp, status, text, thinking, model: stringField(data, "model") ?? "", toolCalls, contentOmitted: false, ...(view === null ? {} : {usage: view}), ...(sent ? {request} : {})};
    };

    const contextOf = (data: JsonRecord): void => {
        const view = usageView(data.usage);
        if (view === null) return;
        context = view.input + view.cacheRead + view.cacheWrite;
        lastCacheHitRate = view.cacheRead + view.cacheWrite === 0 ? null : view.cacheRead / context;
    };

    /** 这次请求写下来了：它的增量到此为止。打开、重建时缓存的增量在路径之后才处理，晚到的不能再画出一条“正在生成”。 */
    const settleRequest = (request: number | null): void => {
        if (request === null) return;
        lastSettledRequest = Math.max(lastSettledRequest, request);
        if (live?.request === request) live = null;
    };

    /**
     * 记路径与锚点：扩展写的事件也是树上的节点，所以在分发之前。回复按 `request` 对上产生它的那次模型请求：拦截层可以不调 `next`
     * 直接交回回复，这时没有 `modelStarted`，不能算到上一次请求头上，否则重试会退到前一步、把前一步的工具再执行一遍。
     */
    function notePath(parsed: {record: JsonRecord; type: string; data: JsonRecord; id: string}): void {
        if (parsed.record.scope !== "path") return;
        pathIds.push(parsed.id);
        const modelParentOf = (data: JsonRecord): string | null => {
            const request = numberField(data, "request");
            return request !== null && request === anchorRequest ? anchorModelParent : null;
        };
        switch (parsed.type) {
            case "turnStarted":
                anchorTurn = stringField(parsed.data, "turnId");
                anchorModelParent = null;
                anchorRequest = null;
                return;
            case "modelStarted":
                if (parsed.data.purpose === "turn") {
                    anchorModelParent = stringField(parsed.record, "parent");
                    anchorRequest = numberField(parsed.data, "request");
                }
                return;
            case "input":
            case "steer":
                anchors.set(parsed.id, {turnId: anchorTurn, modelParent: null});
                if (Array.isArray(parsed.data.attachments)) inputAttachments.set(parsed.id, parsed.data.attachments.map((item) => toJsonValue(item)));
                return;
            case "assistant":
            case "modelFailed":
                anchors.set(parsed.id, {turnId: anchorTurn, modelParent: modelParentOf(parsed.data)});
                return;
            case "runEnded":
                // 没开口就停了时界面用它画一条空回复：重试要回到最后那次请求之前。
                anchors.set(parsed.id, {turnId: anchorTurn, modelParent: anchorModelParent});
                return;
        }
    }

    /** 路径上的事件。session 事件走 `reduceSession`。 */
    function reducePath(type: string, data: JsonRecord, id: string, at: number): void {
        const source = `${type} ${id}`;
        switch (type) {
            case "input":
            case "steer": {
                const text = stringField(data, "text") ?? "";
                // 带范围的附件文字里已经有它的标签，气泡按标签显示，不再单列一块。
                const attachments = Array.isArray(data.attachments) ? data.attachments.flatMap((item): ContentBlockView[] => (isRecord(item) && typeof item.uri === "string" && typeof item.from !== "number" ? [{kind: "attachment", locator: item.uri, name: item.uri.slice(item.uri.lastIndexOf("/") + 1), mimeType: item.kind === "image" ? "image/*" : "", bytes: 0}] : [])) : [];
                const issuer = issuerOf(data.by);
                const by = issuer === null || issuer.kind === "user" ? null : issuer;
                const author = by === null ? undefined : options.authorOf?.(by);
                logged.push({kind: "user", id, timestamp: at, intent: type === "steer" ? "steer" : "normal", blocks: [...(text === "" ? [] : [{kind: "text" as const, text}]), ...attachments], contentOmitted: false, ...(author === undefined ? {} : {author})});
                return;
            }
            case "assistant": {
                if (!Array.isArray(data.content) || !Array.isArray(data.toolCalls)) {
                    problem(source, "assistant 缺 content 或 toolCalls");
                    return;
                }
                settleRequest(numberField(data, "request"));
                logged.push(assistantFrom(data, id, at, "done", data.content, data.toolCalls));
                contextOf(data);
                return;
            }
            case "toolStarted": {
                const callId = stringField(data, "callId");
                const invocation = stringField(data, "invocation");
                // 实际执行的参数：拦截可能改过。`invocation` 是这次调用的唯一身份，宿主跨回复认调用用它（harness/runtime.md 输出 87），
                // 嵌套事件也按它找外层调用。
                if (callId !== null) updateCall(callId, (call) => ({...call, ...(data.args === undefined ? {} : {args: toJsonValue(data.args)}), ...(invocation === null ? {} : {invocation}), startedAt: at}));
                return;
            }
            case "nestedToolStarted":
            case "nestedToolResult": {
                const within = withinOf(data);
                const nested = stringField(data, "id");
                const tool = stringField(data, "tool");
                if (within === null || nested === null || tool === null) {
                    problem(source, "嵌套调用缺 id、tool 或 within");
                    return;
                }
                const args = toJsonValue(data.args ?? {});
                const found = updateChild(within.invocation, nested, (child) => {
                    const base: ToolCallView = {...(child ?? {status: "running" as const}), id: nested, name: toolName(tool), args, invocation: nested};
                    if (type === "nestedToolStarted") return {...base, status: "running", startedAt: at};
                    const outcome = callOutcome(data);
                    const preview = stringField(data, "preview") ?? "";
                    return {
                        ...base,
                        status: outcome.status,
                        result: {text: preview, truncated: isPreviewOnly(preview, numberField(data, "size"))},
                        ...(outcome.status === "success" ? {} : {error: preview}),
                        ...(outcome.note === undefined ? {} : {note: outcome.note}),
                    };
                });
                if (!found) problem(source, `嵌套调用找不到外层调用：${within.invocation}`);
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
                    // 内核在外层调用收口前结算全部嵌套调用（harness/runtime.md 输出 100）；宽限期之后才到的、中途读起的日志里会有
                    // 没结果的，按不知道有没有执行完收口。之后真到了结果照样换上。
                    ...(call.children === undefined ? {} : {children: call.children.map((child) => (unsettled(child.status) ? {...child, status: "unknown" as const, note: agentRef("kernel.tool.unknown")} : child))}),
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
                settleRequest(request);
                // 带 retry：这次运行还要接着发，半截文字作废。没带的半截落成一条消息，已经花了钱，不能丢。
                if (data.retry !== undefined || !Array.isArray(data.partial) || data.partial.length === 0) return;
                const kind = stringField(data, "kind");
                const status: AssistantMessageView["status"] = kind === "aborted" ? "stopped" : kind === "interrupted" ? "interrupted" : "error";
                logged.push(assistantFrom(data, id, at, status, data.partial, []));
                contextOf(data);
                return;
            }
            case "turnStarted":
                turnStarts.push(id);
                return;
            case "runStarted":
                interrupted = false;
                startedAt = at;
                runKind = data.kind === "compact" ? "compact" : null;
                return;
            case "runEnded": {
                live = null;
                finishedCalls = new Map();
                startedAt = null;
                const reason = stringField(data, "reason");
                const compactRun = runKind === "compact";
                // 只压缩的运行被打断时没有可继续的东西：“继续”会续跑已经完成的上一轮。
                interrupted = reason === "interrupted" && !compactRun;
                runKind = null;
                if (compactRun) {
                    // 只压缩的运行没有这一轮：上一轮的回复不是它的，不改；停止与失败各给一行自己的说明。失败也写成系统条目，
                    // 不是错误块：错误块会接在上一轮后面，让上一轮的状态变成出错。
                    if (reason === "aborted") logged.push({kind: "system", id, timestamp: at, source: "reminder", label: agentRef("kernel.compactionStopped"), text: ""});
                    else if (reason === "error") logged.push({kind: "system", id, timestamp: at, source: "reminder", label: errorText(isRecord(data.error) ? data.error : {}), text: ""});
                } else if (reason === "aborted") {
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
            case "compaction": {
                const view = compactionView(data, turnStarts);
                logged.push({kind: "system", id, timestamp: at, source: "compaction", label: agentRef("harness.compaction"), text: stringField(data, "replacement") ?? "", ...(view === null ? {} : {compaction: view})});
                // 压缩后到下一次回复之前：压缩后的估算加放回的量（都是估算，不含系统提示与工具，悬停写明）。
                const after = numberField(data, "tokensAfter");
                if (after !== null) context = after + (view?.restored.reduce((sum, item) => sum + item.tokens, 0) ?? 0);
                return;
            }
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
                const within = withinOf(data);
                const request = toJsonValue(data.request);
                // 嵌套调用批准之后才写开始事件：等审批时先在外层调用下放一个占位，开始或结果到了按 id 补上。提问是执行中的工具问的，
                // 那时它已经在了。
                if (within !== null && kind === "approval" && isRecord(request) && typeof request.tool === "string") {
                    const tool = request.tool;
                    updateChild(within.invocation, callId, (child) => child ?? {id: callId, name: toolName(tool), status: "running", args: toJsonValue(request.args ?? {})});
                }
                pending = [...pending, {id: interaction, callId, kind, request, ...(data.async === true ? {async: true as const} : {}), ...(within === null ? {} : {within})}];
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
                else if (typeof data.extension === "string" && isRecord(data.patch)) meta = {...meta, extensionSettings: {...meta.extensionSettings, [data.extension]: {...meta.extensionSettings[data.extension], ...(toJsonValue(data.patch) as {[key: string]: JsonValue})}}};
                return true;
            case "inputQueued": {
                const item = queuedOf(data, {state: data.state});
                if (item !== null) queue = [...queue, item];
                return true;
            }
            case "inputEdited": {
                const input = isRecord(data.input) ? data.input : {};
                queue = queue.map((item) => (item.id === data.id ? {...item, text: stringField(input, "text") ?? item.text, edits: item.edits + 1} : item));
                return true;
            }
            case "inputHeld": {
                // 已经留着的不改原因与停的人（harness/runtime.md 输出 109）。
                const ids = new Set(Array.isArray(data.ids) ? data.ids : []);
                const cause = heldCauseOf(data.cause);
                const heldBy = issuerOf(data.heldBy);
                queue = queue.map((item) => (ids.has(item.id) && item.state === "ready" ? {...item, state: "held", ...(cause === undefined ? {} : {cause}), ...(heldBy === null ? {} : {heldBy})} : item));
                return true;
            }
            case "inputReleased": {
                const ids = new Set(Array.isArray(data.ids) ? data.ids : []);
                queue = queue.map((item) => {
                    if (!ids.has(item.id)) return item;
                    const {cause: _cause, heldBy: _heldBy, ...rest} = item;
                    return {...rest, state: "ready", ...(data.mode === "followups" ? {mode: "followup" as const} : {})};
                });
                return true;
            }
            case "inputRemoved":
            case "inputConsumed":
                queue = queue.filter((item) => item.id !== data.id);
                return true;
            case "commandAccepted": {
                // `send` 的话没成为新开那次运行的输入时（插进在跑的运行、推迟、留着）排队区会显示它，乐观消息撤掉；
                // 开了新运行的等它的 `input` 确认（harness/runtime.md 输出 110）。
                const value = isRecord(data.value) ? data.value : {};
                const opened = value.placement === undefined ? value.runId !== null : value.placement === "taken" && typeof value.runId === "string";
                if (data.name === "send" && !opened) optimistic = optimistic.filter((item) => item.commandId !== data.commandId);
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
        if (request <= lastSettledRequest) return;
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
            kind: null,
        };
    }

    const resetPath = (): void => {
        logged = [];
        pending = [];
        interrupted = false;
        startedAt = null;
        context = null;
        lastCacheHitRate = null;
        anchors = new Map();
        inputAttachments = new Map();
        pathIds = [];
        anchorTurn = null;
        anchorModelParent = null;
        anchorRequest = null;
        runKind = null;
        turnStarts = [];
        purposes = new Map();
        live = null;
        lastSettledRequest = 0;
        finishedCalls = new Map();
    };

    return {
        setModel(model) {
            meta = {...meta, model: toJsonValue(model)};
        },
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
                extensionSettings: isRecord(snapshot.extensionSettings) ? (toJsonValue(snapshot.extensionSettings) as {[extension: string]: {[key: string]: JsonValue}}) : {},
                model: toJsonValue(snapshot.model),
                profile,
                readOnly,
            };
            queue = Array.isArray(snapshot.buffer) ? snapshot.buffer.flatMap((item): KernelQueued[] => {
                if (!isRecord(item)) return [];
                const queued = queuedOf(item, {state: item.state, edits: item.edits});
                return queued === null ? [] : [queued];
            }) : [];
            if (isRecord(snapshot.status)) applyStatus(snapshot.status);
            touched();
        },

        applyPath(events) {
            resetPath();
            for (const event of events) {
                const parsed = parseEvent(event);
                if (parsed === null) continue;
                notePath(parsed);
                if (isExtensionEvent(parsed)) continue;
                // 重建时路径上已经有这条话：按受理它的指令清掉对应的乐观消息，不会多出一份（旧日志没有 commandId，不清）。
                if ((parsed.type === "input" || parsed.type === "steer") && typeof parsed.data.commandId === "string") confirmOptimistic(parsed.data.commandId);
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
            // 内核确认了：按受理它的指令换掉对应的乐观消息（留着的先跑时先到的是旧话，不能按先后）。拦截可能改写了文字，不按内容。
            // 旧内核的事件没有 commandId：换掉最早的一条。
            if (parsed.type === "input" || parsed.type === "steer") {
                if (typeof parsed.data.commandId === "string") confirmOptimistic(parsed.data.commandId);
                else optimistic = optimistic.slice(1);
            }
            if (parsed.type === "leafChanged") return "leaf-changed";
            notePath(parsed);
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
            cached = [...settled, ...optimistic.map((item) => withAhead(item)), ...streaming];
            return cached;
        },
        pending: () => pending,
        // `kind` 来自路径上的 `runStarted`，与 status 帧是两路输入、到达先后不定：读的时候现算，不在收到帧时抄一份。
        run: () => (run.status === "idle" || runKind === null ? run : {...run, kind: runKind}),
        anchorOf: (messageId) => anchors.get(messageId) ?? null,
        attachmentsOf: (messageId) => inputAttachments.get(messageId) ?? [],
        pathIds: () => pathIds,
        usage: () => ({...usage, context, lastCacheHitRate}),
        // 有乐观消息代表的那条不在排队区重复显示（合并发出的那一条）。
        queue: () => (optimistic.length === 0 ? queue : queue.filter((item) => item.commandId === undefined || !optimistic.some((pending) => pending.commandId === item.commandId))),
        meta: () => meta,
        interrupted: () => interrupted,
        problems: () => problems,
    };
}
