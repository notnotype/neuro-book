import type {AppendManySessionEntryDraft, SessionWritePlan} from "nbook/server/agent/session/write-plan";
import type {CustomMessageSessionEntry, NeuroSessionContext, SessionEntryDraft, SessionSnapshot} from "nbook/server/agent/session/types";
import type {StoredAgentMessage} from "nbook/server/agent/messages/stored-types";
import type {PiTraceSegmentKind} from "nbook/server/agent/observability/pi-request-recorder";
import type {PromptPrefixAttribution} from "nbook/server/agent/observability/trace-segments";
import type {ProfileTurnPlan} from "nbook/server/agent/profiles/types";
import {profileStateKey} from "nbook/server/agent/profiles/profile-dsl";

export type PrepareRunWritePlanInput = {
    sessionId: number;
    profileKey: string;
    context: NeuroSessionContext;
    prepared: ProfileTurnPlan;
    sessionContextEnabled: boolean;
};

/**
 * 把 ProfileTurnPlan 中需要落盘的 prepare 产物编译成 SessionWritePlan。
 *
 * 这个函数不执行写入；真正 append/publish 由 invoke prepareRun 阶段交给 SessionWriteExecutor。
 */
export function compilePrepareRunWritePlan(input: PrepareRunWritePlanInput): SessionWritePlan | undefined {
    const prepareEntries: AppendManySessionEntryDraft[] = [];
    const labels = input.prepared.promptSourceLabels;
    if (input.sessionContextEnabled && input.prepared.historyInitMessages?.length && input.context.messages.length === 0) {
        prepareEntries.push(...input.prepared.historyInitMessages.map((message, index) => customMessageEntry(message, "historySet", labels?.historyInit?.[index])));
    }
    if (input.sessionContextEnabled) {
        // 两段的顺序必须与 promptSourceLabels 的拼接顺序一致，否则归因会整体错位。
        const modelContextAppending = input.prepared.modelContextAppendingMessages ?? [];
        const appending = input.prepared.appendingMessages ?? [];
        const appendingMessages = [...modelContextAppending, ...appending];
        const appendingLabels = [
            ...modelContextAppending.map((_, index) => labels?.modelContextAppending?.[index] ?? null),
            ...appending.map((_, index) => labels?.appending?.[index] ?? null),
        ];
        prepareEntries.push(...appendingMessages.map((message, index) => customMessageEntry(message, "appending", appendingLabels[index])));
    }
    for (const write of input.prepared.stateWrites ?? []) {
        assertValidProfileStateWrite(input.profileKey, write);
        prepareEntries.push(write as AppendManySessionEntryDraft);
    }
    if (prepareEntries.length === 0) {
        return undefined;
    }
    return {
        target: {sessionId: input.sessionId},
        cause: "profile.prepare",
        ops: [{
            kind: "appendMany",
            entries: prepareEntries,
        }],
    };
}

/**
 * 计算本次请求 messages 前缀的分区归因（Task 126）。
 *
 * 只描述 prepareRun 当时的数组；同一 invocation 后续 turn 追加的 assistant / toolResult
 * 由消费方按缺省值落入 conversation。
 *
 * 归因用**对象标识**从 snapshot entries 反查，而不是给消息体加字段——消息体会原样发给
 * provider，塞归因等于污染 prompt。`applyCompaction` 按引用保留 `entry.message`，
 * 因此压缩后标识依然成立；它合成的 summary 消息不在表里，自然落入 conversation。
 */
export function buildPromptPrefixAttribution(input: {
    snapshot: SessionSnapshot;
    /** assemblePersistedProfilePromptMessages 的同一份输入。 */
    persistedMessages: readonly StoredAgentMessage[];
    modelContextCount: number;
    appendingCount: number;
    currentUserInputCount: number;
}): PromptPrefixAttribution {
    const sources = new Map<StoredAgentMessage, NonNullable<CustomMessageSessionEntry["promptSource"]>>();
    for (const entry of input.snapshot.entries) {
        if (entry.type === "custom_message" && entry.promptSource) {
            sources.set(entry.message, entry.promptSource);
        }
    }
    // 一条都没有 = 该 session 建于归因功能之前，退化到位置推断（见 legacyPromptSources 的局限说明）。
    const mode: PromptPrefixAttribution["mode"] = sources.size > 0 ? "full" : "legacy";
    if (mode === "legacy") {
        for (const [message, source] of legacyPromptSources(input.snapshot)) {
            sources.set(message, source);
        }
    }

    const kinds: PiTraceSegmentKind[] = [];
    const labels: (readonly string[] | null)[] = [];
    const push = (kind: PiTraceSegmentKind, label: readonly string[] | null): void => {
        kinds.push(kind);
        labels.push(label);
    };

    const historyEnd = input.persistedMessages.length - (input.appendingCount + input.currentUserInputCount);
    for (let index = 0; index < historyEnd; index += 1) {
        const source = sources.get(input.persistedMessages[index]!);
        push(source?.zone === "historySet" ? "historySet" : source ? "appending" : "conversation", source?.labels ?? null);
    }
    for (let index = 0; index < input.modelContextCount; index += 1) {
        push("modelContext", null);
    }
    for (let index = historyEnd; index < historyEnd + input.appendingCount; index += 1) {
        push("appending", sources.get(input.persistedMessages[index]!)?.labels ?? null);
    }
    for (let index = 0; index < input.currentUserInputCount; index += 1) {
        push("currentInput", null);
    }
    return {kinds, labels, mode};
}

/**
 * 旧 session 的位置推断归因。
 *
 * 依据：`compilePrepareRunWritePlan` 只在 `context.messages.length === 0` 时写 HistorySet，
 * 因此首条真实 `message` 之前的那段连续 `custom_message` 必定是首轮 prepare 的产物，
 * 之后出现的 `custom_message` 必定是后续轮次的 AppendingSet。
 *
 * **已知局限**：首轮的 AppendingSet 提醒和 HistorySet 写在同一批、同样排在首条用户消息之前，
 * 没有标签就分不开，会被一并计入 historySet。调用方据此把 mode 标成 legacy，由 UI 披露。
 */
function legacyPromptSources(snapshot: SessionSnapshot): Map<StoredAgentMessage, NonNullable<CustomMessageSessionEntry["promptSource"]>> {
    const inferred = new Map<StoredAgentMessage, NonNullable<CustomMessageSessionEntry["promptSource"]>>();
    let seenRealMessage = false;
    for (const entry of snapshot.entries) {
        if (entry.type === "message") {
            seenRealMessage = true;
            continue;
        }
        if (entry.type === "custom_message" && entry.visibleToModel) {
            inferred.set(entry.message, {zone: seenRealMessage ? "appending" : "historySet"});
        }
    }
    return inferred;
}

/**
 * 构造一条 prepare 写入的 custom_message entry。
 *
 * zone 恒写入——即使没有具名 labels，「这条是 AppendingSet 产物」本身就是归因信息，
 * 否则匿名提醒在面板里会和普通对话混在一起。labels 为空时省略。
 */
function customMessageEntry(
    message: StoredAgentMessage,
    zone: "historySet" | "appending",
    labels: readonly string[] | null | undefined,
): AppendManySessionEntryDraft {
    return {
        type: "custom_message" as const,
        message,
        visibleToModel: true,
        promptSource: {zone, ...(labels?.length ? {labels} : {})},
    };
}

/**
 * profile prepare 只能写自己的 profile state，不能成为任意 session mutation 入口。
 */
export function assertValidProfileStateWrite(profileKey: string, write: SessionEntryDraft): void {
    if (write.type !== "custom" || write.key !== profileStateKey(profileKey)) {
        throw new Error(`profile ${profileKey} stateWrites 只允许写 ${profileStateKey(profileKey)} custom entry。`);
    }
}
