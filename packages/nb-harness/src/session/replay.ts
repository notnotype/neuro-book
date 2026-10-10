/**
 * 回放：从条目序列算派生状态的纯函数（docs/specs/harness/session.md 输出 12–16）。不读句柄、不看时钟，同样的条目总得到同样的结果。
 *
 * 读 `buildModelContext` 前先记住两件事：
 * 1. 工具结果只在“调用窗口”里配对（术语见 Spec）：一条助手消息加上它之后、下一条助手或用户 `message` 之前的工具结果。
 *    跨轮重复的工具调用 id 因此互不相干，模型上下文里也不会出现没有结果的调用（OMP 会给它们合成假结果）。
 * 2. 有压缩时顺序固定为：本段历史里的种子、摘要、从 `firstKeptEntryId` 起保留的消息、本段历史里其余的消息。
 */

import type {AssistantMessage, Message, ToolResultMessage} from "@oh-my-pi/pi-ai";
import type {EntryInput, InteractionData, InteractionRequest, InvocationData, SessionEntry} from "./types";

export type Projection<S> = {readonly initial: S; reduce(state: S, entry: SessionEntry): S};
export type PendingInteraction = {interactionId: string; kind: "approval" | "question"; request: InteractionRequest};
export type SessionStatus = {phase: "idle" | "running" | "waiting"; invocationId?: string; pending: PendingInteraction[]};
export type SessionSettings = {model?: string; role?: string; thinkingLevel?: string; title?: string; approvalGrants: {toolName: string; tier?: string}[]};

type MessageEntry = Extract<SessionEntry, {type: "message"}>;
type CustomMessageEntry = Extract<SessionEntry, {type: "custom_message"}>;
type CompactionEntry = Extract<SessionEntry, {type: "compaction"}>;
type InvocationEntry = Extract<SessionEntry, {type: "custom"}> & {data: InvocationData};
type InteractionEntry = Extract<SessionEntry, {type: "custom"}> & {data: InteractionData};

const isInvocation = (entry: SessionEntry): entry is InvocationEntry => entry.type === "custom" && entry.customType === "harness/invocation";
const isInteraction = (entry: SessionEntry): entry is InteractionEntry => entry.type === "custom" && entry.customType === "harness/interaction";
const isSeed = (entry: SessionEntry): entry is CustomMessageEntry => entry.type === "custom_message" && entry.customType === "harness/seed";
const isReplayable = (entry: SessionEntry): entry is MessageEntry | CustomMessageEntry => entry.type === "message" || entry.type === "custom_message";

/** 从后往前找；包的 lib 目标还没有 findLastIndex。 */
function lastIndexWhere<T>(items: readonly T[], predicate: (item: T) => boolean): number {
    for (let index = items.length - 1; index >= 0; index -= 1) if (predicate(items[index]!)) return index;
    return -1;
}

export function defineProjection<S>(projection: Projection<S>): Projection<S> {
    return projection;
}

export function fold<S>(entries: readonly SessionEntry[], projection: Projection<S>): S {
    let state = projection.initial;
    for (const entry of entries) state = projection.reduce(state, entry);
    return state;
}

/** 摘要在模型上下文里的包装；措辞照 OMP 的 compaction-summary-context，模型对两边的摘要有同样的理解。 */
export function renderCompactionSummary(summary: string): string {
    return `Prior model work/tool state available.\nMUST build on prior work; NEVER duplicate prior work.\n\n<summary>\n${summary}\n</summary>`;
}

const millis = (iso: string): number => Date.parse(iso);

function customMessageToMessage(entry: CustomMessageEntry): Message {
    const role = isSeed(entry) ? (entry.details as {role: "user" | "developer"}).role : "user";
    return {role, content: entry.content, attribution: "agent", timestamp: millis(entry.timestamp)};
}

function summaryMessage(compaction: CompactionEntry): Message {
    return {role: "user", content: [{type: "text", text: renderCompactionSummary(compaction.summary)}], attribution: "agent", timestamp: millis(compaction.timestamp)};
}

/** 输出 12.1：选出要回放的条目（已转成消息），顺序按有无压缩分两种。 */
function replaySequence(entries: readonly SessionEntry[]): {entry: SessionEntry; message: Message}[] {
    const toItem = (entry: MessageEntry | CustomMessageEntry): {entry: SessionEntry; message: Message} => ({
        entry,
        message: entry.type === "message" ? entry.message : customMessageToMessage(entry),
    });
    const compactionIndex = lastIndexWhere(entries, (entry) => entry.type === "compaction");
    if (compactionIndex === -1) return entries.filter(isReplayable).map(toItem);

    const compaction = entries[compactionIndex] as CompactionEntry;
    const segment = entries.slice(compactionIndex + 1);
    const keptStart = entries.findIndex((entry) => entry.id === compaction.firstKeptEntryId);
    const kept = keptStart === -1 ? [] : entries.slice(keptStart, compactionIndex);
    return [
        ...segment.filter(isSeed).map(toItem),
        {entry: compaction, message: summaryMessage(compaction)},
        ...kept.filter((entry): entry is MessageEntry | CustomMessageEntry => isReplayable(entry) && !isSeed(entry)).map(toItem),
        ...segment.filter((entry): entry is MessageEntry | CustomMessageEntry => isReplayable(entry) && !isSeed(entry)).map(toItem),
    ];
}

/** 调用窗口：助手消息的下标 → 它窗口里的工具结果下标。窗口在下一条助手或用户 `message` 处结束。 */
function callWindows(items: readonly {entry: SessionEntry; message: Message}[]): Map<number, number[]> {
    const windows = new Map<number, number[]>();
    let open: number | null = null;
    items.forEach(({entry, message}, index) => {
        if (entry.type !== "message") return;
        if (message.role === "assistant") {
            open = index;
            windows.set(index, []);
        } else if (message.role === "user") {
            open = null;
        } else if (message.role === "toolResult" && open !== null) {
            windows.get(open)!.push(index);
        }
    });
    return windows;
}

function withoutUnpairedCalls(message: AssistantMessage, pairedCallIds: ReadonlySet<string>): AssistantMessage | null {
    const content = message.content
        .filter((block) => (block.type === "toolCall" ? pairedCallIds.has(block.id) : block.type !== "redactedThinking"))
        .map((block) => (block.type === "thinking" ? {...block, thinkingSignature: undefined} : block))
        .map((block) => Object.fromEntries(Object.entries(block).filter(([, value]) => value !== undefined)) as typeof block);
    if (content.length === 0) return null;
    return {...message, content};
}

export function buildModelContext(entries: readonly SessionEntry[]): Message[] {
    const items = replaySequence(entries);
    const windows = callWindows(items);
    const drop = new Set<number>();
    const replacement = new Map<number, Message>();

    for (const [assistantIndex, resultIndexes] of windows) {
        const assistant = items[assistantIndex]!.message as AssistantMessage;
        // 12.2：出错或中止的助手消息连同窗口里的工具结果一起去掉。
        if (assistant.stopReason === "error" || assistant.stopReason === "aborted") {
            drop.add(assistantIndex);
            for (const index of resultIndexes) drop.add(index);
            continue;
        }
        const callIds = new Set(assistant.content.filter((block) => block.type === "toolCall").map((block) => block.id));
        const paired = new Set<string>();
        for (const index of resultIndexes) {
            const result = items[index]!.message as ToolResultMessage;
            // 12.5：配不上调用的结果去掉；同一调用只认第一个结果。
            if (!callIds.has(result.toolCallId) || paired.has(result.toolCallId)) drop.add(index);
            else paired.add(result.toolCallId);
        }
        // 12.3、12.4：没有结果的调用去掉，被改写的助手消息清掉 redactedThinking 与思考签名。
        if (paired.size === callIds.size) continue;
        const rewritten = withoutUnpairedCalls(assistant, paired);
        if (rewritten === null) drop.add(assistantIndex);
        else replacement.set(assistantIndex, rewritten);
    }

    // 没有窗口的工具结果（例如用户消息之后直接出现的）也配不上调用。
    const covered = new Set([...windows.values()].flat());
    items.forEach(({entry, message}, index) => {
        if (entry.type === "message" && message.role === "toolResult" && !covered.has(index)) drop.add(index);
    });

    // 条目是冻结的；返回副本，调用方（OMP Agent）可以随意改。
    return items.flatMap(({message}, index) => (drop.has(index) ? [] : [structuredClone(replacement.get(index) ?? message)]));
}

type UnfinishedInvocation = {invocationId: string; lastPhase: InvocationData["phase"]; rangeStart: number};

/** 未结束的调用（Spec 术语）：最后一个 invocation 的最后阶段为 start、resumed 或 waiting；范围从它最后一个 start/resumed 之后起。 */
function unfinishedInvocation(entries: readonly SessionEntry[]): UnfinishedInvocation | null {
    const lastIndex = lastIndexWhere(entries, isInvocation);
    if (lastIndex === -1) return null;
    const last = entries[lastIndex] as InvocationEntry;
    if (!["start", "resumed", "waiting"].includes(last.data.phase)) return null;
    const rangeStart = lastIndexWhere(entries, 
        (entry) => isInvocation(entry) && entry.data.invocationId === last.data.invocationId && (entry.data.phase === "start" || entry.data.phase === "resumed"),
    );
    return {invocationId: last.data.invocationId, lastPhase: last.data.phase, rangeStart: rangeStart + 1};
}

function interactionsOf(entries: readonly SessionEntry[]): Map<string, {request?: InteractionEntry; response?: InteractionEntry}> {
    const byId = new Map<string, {request?: InteractionEntry; response?: InteractionEntry}>();
    for (const entry of entries) {
        if (!isInteraction(entry)) continue;
        const current = byId.get(entry.data.interactionId) ?? {};
        byId.set(entry.data.interactionId, {...current, [entry.data.phase]: entry});
    }
    return byId;
}

function pendingIn(entries: readonly SessionEntry[], rangeStart: number): PendingInteraction[] {
    const all = interactionsOf(entries);
    const pending: PendingInteraction[] = [];
    for (const entry of entries.slice(rangeStart)) {
        if (!isInteraction(entry) || entry.data.phase !== "request") continue;
        if (all.get(entry.data.interactionId)?.response !== undefined) continue;
        pending.push({interactionId: entry.data.interactionId, kind: entry.data.kind, request: entry.data.request as InteractionRequest});
    }
    return pending;
}

export function sessionStatus(entries: readonly SessionEntry[]): SessionStatus {
    const unfinished = unfinishedInvocation(entries);
    if (unfinished === null) return {phase: "idle", pending: []};
    const pending = pendingIn(entries, unfinished.rangeStart);
    return {phase: pending.length > 0 ? "waiting" : "running", invocationId: unfinished.invocationId, pending};
}

export function sessionSettings(entries: readonly SessionEntry[]): SessionSettings {
    const settings: SessionSettings = {approvalGrants: []};
    const requests = new Map<string, InteractionRequest>();
    const granted = new Set<string>();
    for (const entry of entries) {
        if (entry.type === "model_change") {
            settings.model = entry.model;
            if (entry.role === undefined) delete settings.role;
            else settings.role = entry.role;
        } else if (entry.type === "thinking_level_change") {
            if (entry.thinkingLevel === null) delete settings.thinkingLevel;
            else settings.thinkingLevel = entry.thinkingLevel;
        } else if (entry.type === "title_change") {
            settings.title = entry.title;
        } else if (isInteraction(entry)) {
            if (entry.data.phase === "request") requests.set(entry.data.interactionId, entry.data.request as InteractionRequest);
            const response = entry.data.response;
            const request = requests.get(entry.data.interactionId);
            if (entry.data.phase !== "response" || response?.decision !== "approve" || response.scope !== "session" || request === undefined) continue;
            const key = `${request.toolName}\u0000${request.tier ?? ""}`;
            if (granted.has(key)) continue;
            granted.add(key);
            settings.approvalGrants.push({toolName: request.toolName, ...(request.tier === undefined ? {} : {tier: request.tier})});
        }
    }
    return settings;
}

/** 输出 16：只计算、不写入。结果条目的时间戳取最后一个条目的时间，保证同样的条目得到同样的结果。 */
export function planRecovery(entries: readonly SessionEntry[]): EntryInput[] {
    const unfinished = unfinishedInvocation(entries);
    if (unfinished === null) return [];
    const range = entries.slice(unfinished.rangeStart);
    const interactions = interactionsOf(entries);
    const byCall = new Map<string, {request: InteractionEntry; response?: InteractionEntry}>();
    for (const pair of interactions.values()) {
        if (pair.request === undefined) continue;
        const request = pair.request.data.request as InteractionRequest;
        byCall.set(`${request.assistantEntryId}\u0000${request.toolCallId}`, {request: pair.request, ...(pair.response === undefined ? {} : {response: pair.response})});
    }
    const timestamp = entries.length === 0 ? 0 : millis(entries[entries.length - 1]!.timestamp);
    const results: EntryInput[] = [];

    const items = range.filter(isReplayable).map((entry) => ({entry, message: entry.type === "message" ? entry.message : customMessageToMessage(entry)}));
    for (const [assistantIndex, resultIndexes] of callWindows(items)) {
        const {entry, message} = items[assistantIndex]!;
        const answered = new Set(resultIndexes.map((index) => (items[index]!.message as ToolResultMessage).toolCallId));
        for (const block of (message as AssistantMessage).content) {
            if (block.type !== "toolCall" || answered.has(block.id)) continue;
            const interaction = byCall.get(`${entry.id}\u0000${block.id}`);
            if (interaction !== undefined && interaction.response === undefined) continue;
            const rejected = interaction?.response?.data.response?.decision === "reject";
            const note = interaction?.response?.data.response?.note;
            const text = rejected ? `用户拒绝执行工具 ${block.name}${note === undefined ? "" : `：${note}`}` : `工具 ${block.name} 的执行被中断，结果未知`;
            results.push({type: "message", message: {role: "toolResult", toolCallId: block.id, toolName: block.name, content: [{type: "text", text}], isError: true, timestamp}});
        }
    }

    const stillPending = pendingIn(entries, unfinished.rangeStart).length > 0;
    if (stillPending && unfinished.lastPhase !== "waiting") results.push({type: "custom", customType: "harness/invocation", data: {invocationId: unfinished.invocationId, phase: "waiting"}});
    if (!stillPending) results.push({type: "custom", customType: "harness/invocation", data: {invocationId: unfinished.invocationId, phase: "interrupted"}});
    return results;
}
