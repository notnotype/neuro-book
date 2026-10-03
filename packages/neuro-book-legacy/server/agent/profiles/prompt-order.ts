export type ProfilePromptMessageSections<TMessage> = {
    history: TMessage[];
    modelContext: TMessage[];
    appending: TMessage[];
    currentUserInput: TMessage[];
};

/**
 * 按 Profile Prompt 正式契约组装 provider messages。
 *
 * 固定顺序：History → ModelContext → AppendingSet → CurrentUserInput。
 * 统一供真实 Harness 与 Profile Preview 使用，避免两条路径各自拼装后再次漂移。
 */
export function assembleProfilePromptMessages<TMessage>(sections: ProfilePromptMessageSections<TMessage>): TMessage[] {
    return [
        ...sections.history,
        ...sections.modelContext,
        ...sections.appending,
        ...sections.currentUserInput,
    ];
}

/**
 * 从已落盘的 prepare 尾部恢复四个消息分区。
 *
 * prepare 写入顺序恒为 HistorySet（仅空历史）→ AppendingSet → CurrentUserInput；
 * ModelContext 不落盘，因此需要在调用 provider 前插回 AppendingSet 之前。
 */
export function assemblePersistedProfilePromptMessages<TMessage>(input: {
    persistedMessages: TMessage[];
    modelContext: TMessage[];
    appendingCount: number;
    currentUserInputCount: number;
}): TMessage[] {
    const tailCount = input.appendingCount + input.currentUserInputCount;
    if (tailCount > input.persistedMessages.length) {
        throw new Error(`Profile prompt 尾部分区越界：tail=${tailCount}, messages=${input.persistedMessages.length}`);
    }
    const historyEnd = input.persistedMessages.length - tailCount;
    const currentUserInputStart = input.persistedMessages.length - input.currentUserInputCount;
    return assembleProfilePromptMessages({
        history: input.persistedMessages.slice(0, historyEnd),
        modelContext: input.modelContext,
        appending: input.persistedMessages.slice(historyEnd, currentUserInputStart),
        currentUserInput: input.persistedMessages.slice(currentUserInputStart),
    });
}
