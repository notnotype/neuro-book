/**
 * 轮与轮之间的分隔线（ui/agent-conversation-view.md 的“分轮视图”、验收 43）：放在哪一轮之前、写什么日子。时间都按本地时区构造：
 * 线按本地的日历日分，写死 UTC 毫秒的话换个时区跑结果就变了。
 */
import {describe, expect, test} from "bun:test";

import {dayDividerLabel, localDayIndex} from "./format";
import {dividersBefore} from "./stream-dividers";
import type {MessageView} from "./types";

const local = (month: number, day: number, hour: number, minute = 0, year = 2026): number => new Date(year, month - 1, day, hour, minute).getTime();
const user = (id: string, timestamp: number): MessageView => ({kind: "user", id, timestamp, intent: "normal", blocks: [{kind: "text", text: id}], contentOmitted: false});
const reply = (id: string, timestamp: number): MessageView => ({kind: "assistant", id, timestamp, status: "done", text: id, thinking: "", model: "", toolCalls: [], contentOmitted: false});

describe("dividersBefore", () => {
    // 前天 23:50 开始、昨天 00:10 才答完的一轮；昨天一轮；今天两轮。
    const groups = [
        [user("u1", local(11, 20, 23, 50)), reply("a1", local(11, 21, 0, 10))],
        [user("u2", local(11, 21, 9)), reply("a2", local(11, 21, 9, 1))],
        [user("u3", local(11, 22, 8)), reply("a3", local(11, 22, 8, 1))],
        [user("u4", local(11, 22, 10)), reply("a4", local(11, 22, 10, 1))],
    ];

    test("按天：第一轮之前总有；跨零点的一轮按开头算、只在轮前；与上一轮同一天的不画", () => {
        const result = dividersBefore(groups, {day: true});
        expect([...result.keys()]).toEqual(["u1", "u2", "u3"]);
        expect(result.get("u1")).toEqual([{kind: "day", at: local(11, 20, 23, 50)}]);
        expect(result.get("u2")).toEqual([{kind: "day", at: local(11, 21, 9)}]);
    });

    test("一轮开头的消息没有时间（正在生成的为 0）按下一条有时间的算；整轮都没有的不画、也不改变下一轮的比较", () => {
        const result = dividersBefore([
            [user("u1", local(11, 21, 9))],
            [reply("live", 0), reply("a2", local(11, 22, 8))],
            [reply("empty", 0)],
            [user("u4", local(11, 22, 9))],
        ], {day: true});
        expect([...result.keys()]).toEqual(["u1", "live"]);
        expect(result.get("live")).toEqual([{kind: "day", at: local(11, 22, 8)}]);
    });

    test("未读：线在含起点的那一轮之前；同一轮之前日子在上、未读在下；起点不在已加载的消息里时没有", () => {
        expect(dividersBefore(groups, {day: true, unreadFrom: "a3"}).get("u3")).toEqual([{kind: "day", at: local(11, 22, 8)}, {kind: "unread"}]);
        expect(dividersBefore(groups, {unreadFrom: "a4"})).toEqual(new Map([["u4", [{kind: "unread"}]]]));
        expect(dividersBefore(groups, {day: false, unreadFrom: "gone"}).size).toBe(0);
    });

    test("不给 dividers 时没有线", () => {
        expect(dividersBefore(groups, undefined).size).toBe(0);
        expect(dividersBefore(groups, {}).size).toBe(0);
    });
});

describe("dayDividerLabel", () => {
    const today = localDayIndex(local(11, 22, 12));

    test("今天、昨天、同一年写月日、别的年加上年", () => {
        expect(dayDividerLabel(local(11, 22, 0, 1), today, "zh-CN")).toEqual({kind: "today"});
        expect(dayDividerLabel(local(11, 21, 23, 59), today, "zh-CN")).toEqual({kind: "yesterday"});
        expect(dayDividerLabel(local(11, 18, 9), today, "zh-CN")).toEqual({kind: "date", text: "11月18日"});
        expect(dayDividerLabel(local(11, 18, 9, 0, 2025), today, "zh-CN")).toEqual({kind: "date", text: "2025年11月18日"});
        expect(dayDividerLabel(local(11, 18, 9), today, "en-US")).toEqual({kind: "date", text: "Nov 18"});
        expect(dayDividerLabel(local(11, 18, 9, 0, 2025), today, "en-US")).toEqual({kind: "date", text: "Nov 18, 2025"});
    });

    test("消息时间晚于今天（多机时钟差）也写今天", () => {
        expect(dayDividerLabel(local(11, 23, 0, 3), today, "zh-CN")).toEqual({kind: "today"});
    });

    test("一年的头一天：昨天是去年最后一天，再往前的是去年、带上年", () => {
        const newYear = localDayIndex(local(1, 1, 9, 0, 2027));
        expect(dayDividerLabel(local(12, 31, 22, 0, 2026), newYear, "zh-CN")).toEqual({kind: "yesterday"});
        expect(dayDividerLabel(local(12, 30, 22, 0, 2026), newYear, "zh-CN")).toEqual({kind: "date", text: "2026年12月30日"});
    });
});
