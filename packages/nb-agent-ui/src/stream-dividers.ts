/**
 * 轮与轮之间的分隔线放在哪（ui/agent-conversation-view.md 的“分轮视图”）。只看消息与 `ctx.dividers`，不看 `now`：宿主每秒换 `now`
 * 不让它重算出不同的结果；线上写今天、昨天还是月日，由组件按 `now` 的日序号定。
 */

import {localDayIndex} from "./format";
import type {DividersView, MessageView} from "./types";

export type StreamDivider = {readonly kind: "day"; readonly at: number} | {readonly kind: "unread"};

/** 一轮的日子：第一条有时间的消息（正在生成的、缺时间的为 0，跳过）；整轮都没有时为 null。一轮跨零点时按开头算。 */
function dayOf(group: readonly MessageView[]): {readonly day: number; readonly at: number} | null {
    const first = group.find((message) => message.timestamp > 0);
    return first === undefined ? null : {day: localDayIndex(first.timestamp), at: first.timestamp};
}

/**
 * 每一轮之前要画的线，按这一轮第一条消息的 id 索引；没有线的轮不在表里。同一轮之前两条都有时日子在上、未读在下。
 * 按天：第一条有日子的轮之前总有一条，之后与上一条有日子的轮不在同一天时一条。
 */
export function dividersBefore(groups: readonly (readonly MessageView[])[], dividers: DividersView | undefined): ReadonlyMap<string, readonly StreamDivider[]> {
    const result = new Map<string, StreamDivider[]>();
    const add = (group: readonly MessageView[], divider: StreamDivider): void => {
        const key = group[0]!.id;
        const list = result.get(key);
        if (list === undefined) result.set(key, [divider]);
        else list.push(divider);
    };
    const day = dividers?.day === true;
    const unreadFrom = dividers?.unreadFrom ?? null;
    let previousDay: number | null = null;
    for (const group of groups) {
        if (group.length === 0) continue;
        if (day) {
            const own = dayOf(group);
            if (own !== null && own.day !== previousDay) {
                add(group, {kind: "day", at: own.at});
                previousDay = own.day;
            }
        }
        if (unreadFrom !== null && group.some((message) => message.id === unreadFrom)) add(group, {kind: "unread"});
    }
    return result;
}
