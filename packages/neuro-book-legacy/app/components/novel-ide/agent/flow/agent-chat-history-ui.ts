/** Chat Flow 接近顶部时自动请求更早历史的阈值。 */
export const PREVIOUS_HISTORY_SCROLL_THRESHOLD_PX = 160;

/**
 * 判断当前滚动状态是否应请求更早历史。
 * 请求去重、cursor 和 revision 校验由 session state 负责。
 */
export function shouldLoadPreviousHistory(input: {
    scrollTop: number;
    hasPrevious: boolean;
    loading: boolean;
}): boolean {
    return input.hasPrevious
        && !input.loading
        && input.scrollTop <= PREVIOUS_HISTORY_SCROLL_THRESHOLD_PX;
}

/**
 * 根据 prepend 前后的内容高度差恢复原有视口。
 * 返回值只负责滚动位置，不改变 Chat Flow 的自动吸底状态。
 */
export function prependAnchoredScrollTop(input: {
    previousScrollTop: number;
    previousScrollHeight: number;
    nextScrollHeight: number;
}): number {
    return input.previousScrollTop + Math.max(0, input.nextScrollHeight - input.previousScrollHeight);
}

/** System Prompt 只有在用户显式打开独立视图后才按需加载。 */
export function shouldLoadSystemPrompt(input: {
    open: boolean;
    loading: boolean;
    hasValue: boolean;
}): boolean {
    return input.open && !input.loading && !input.hasValue;
}

/** prepend transaction 期间禁止自动吸底覆盖滚动锚点。 */
export function shouldAutoScrollChat(input: {
    stickToBottom: boolean;
    prependPending: boolean;
}): boolean {
    return input.stickToBottom && !input.prependPending;
}

/** preview 被省略的历史正文不能回写为完整消息。 */
export function canEditHistoryMessage(input: {
    type: "user" | "ai" | "system";
    contentOmitted?: boolean;
}): boolean {
    if (input.type === "user") {
        return true;
    }
    return input.type === "ai" && !input.contentOmitted;
}
