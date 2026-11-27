/**
 * 消息视图的视图段收着时放几项（docs/specs/agent/conversation.md 输出 57 的“收着”）：中段量到的高度放得下几项，bot 与最近会话各放几个。
 *
 * - 量的是中段的 `clientHeight`（含上下内边距 `SEGMENT_PADDING`）。中段是一列 flex：n 项按钮加一条短线共 n+1 个子项、n 个 4 像素的间距，
 *   所以一项连它的间距占 `SEGMENT_ITEM_STEP`（36 + 4），短线连上下的余地占 `SEGMENT_DIVIDER`（1 + 4 × 2）；n 项要 n × 40 + 9 + 8。
 *   这几个数与 `AgentMessagesSegment.vue` 的样式（`.acv-segment__main`、`__item`、`__divider`）一起改。“新对话”总在。
 * - bot 先放，给最近会话至少留两个位置（会话不到两个时按会话数）；放不下时最后一个位置换成“+N”。bot 一组至少一个位置。
 * - 最近会话按宿主给的次序（最近活动）放剩下的位置，高度变时只在末尾增减。
 * - 当前会话永远占位：排在放得下的范围之外时顶替最后一个。当前 bot 也顶替最后一个，但 bot 只剩“+N”的位置时一起收进“+N”。
 * - 高度还没量到（null）时全放：首帧不按 0 高度把东西都藏起来再冒出来。
 */

export const SEGMENT_ITEM_STEP = 40;
export const SEGMENT_DIVIDER = 9;
export const SEGMENT_PADDING = 8;

export interface SegmentFit<Bot, Session> {
    readonly bots: readonly Bot[];
    /** 收进“+N”的 bot 个数；0 时没有“+N”。 */
    readonly more: number;
    readonly sessions: readonly Session[];
}

export function fitSegment<Bot, Session>(input: {
    readonly height: number | null;
    readonly bots: readonly Bot[];
    readonly sessions: readonly Session[];
    readonly isCurrentBot: (bot: Bot) => boolean;
    readonly isCurrentSession: (session: Session) => boolean;
}): SegmentFit<Bot, Session> {
    const {height, bots, sessions} = input;
    if (height === null) return {bots, more: 0, sessions};
    const slots = Math.max(0, Math.floor((height - SEGMENT_PADDING - SEGMENT_DIVIDER) / SEGMENT_ITEM_STEP));
    // 去掉“新对话”那一项。
    const free = Math.max(0, slots - 1);
    const reserve = Math.min(2, sessions.length);
    const botRoom = bots.length === 0 ? 0 : Math.max(1, free - reserve);
    let shownBots: readonly Bot[] = bots;
    let more = 0;
    if (bots.length > botRoom) {
        shownBots = botRoom > 1 ? keepCurrent(bots, botRoom - 1, input.isCurrentBot) : [];
        more = bots.length - shownBots.length;
    }
    const used = shownBots.length + (more > 0 ? 1 : 0);
    return {bots: shownBots, more, sessions: keepCurrent(sessions, Math.max(0, free - used), input.isCurrentSession)};
}

/** 前 `count` 项；当前的那一项排在后面时顶替最后一个，`count` 为 0 时也留它一个（当前会话）。 */
function keepCurrent<T>(items: readonly T[], count: number, isCurrent: (item: T) => boolean): readonly T[] {
    const taken = items.slice(0, count);
    const current = items.find(isCurrent);
    if (current === undefined || taken.includes(current)) return taken;
    return [...taken.slice(0, Math.max(0, count - 1)), current];
}
