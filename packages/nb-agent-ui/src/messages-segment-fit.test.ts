import {describe, expect, test} from "bun:test";

import {fitSegment, SEGMENT_DIVIDER, SEGMENT_ITEM_STEP} from "./messages-segment-fit";

const bots = ["b1", "b2", "b3", "b4", "b5"];
const sessions = ["s1", "s2", "s3", "s4", "s5", "s6"];
/** 正好放得下 `items` 项（含“新对话”）的高度。 */
const heightFor = (items: number): number => items * SEGMENT_ITEM_STEP - 4 + SEGMENT_DIVIDER;
const fit = (height: number | null, current: {bot?: string; session?: string} = {}, input: {bots?: string[]; sessions?: string[]} = {}) => fitSegment({
    height,
    bots: input.bots ?? bots,
    sessions: input.sessions ?? sessions,
    isCurrentBot: (bot) => bot === current.bot,
    isCurrentSession: (session) => session === current.session,
});

describe("视图段收着时放几项（conversation 输出 57 的“收着”）", () => {
    test("高度还没量到时全放", () => {
        expect(fit(null)).toEqual({bots, more: 0, sessions});
    });

    test("放得下全部时全放；高一点也不多出东西", () => {
        expect(fit(heightFor(1 + 5 + 6))).toEqual({bots, more: 0, sessions});
        expect(fit(heightFor(1 + 5 + 6) + 39)).toEqual({bots, more: 0, sessions});
    });

    test("变矮时最近会话只在末尾减少，bot 先给会话留两个位置，再放不下才并成“+N”", () => {
        expect(fit(heightFor(1 + 5 + 4))).toEqual({bots, more: 0, sessions: ["s1", "s2", "s3", "s4"]});
        expect(fit(heightFor(1 + 5 + 2))).toEqual({bots, more: 0, sessions: ["s1", "s2"]});
        // 少一项：bot 让出最后一个位置给“+N”，会话还是两个。
        expect(fit(heightFor(1 + 4 + 2))).toEqual({bots: ["b1", "b2", "b3"], more: 2, sessions: ["s1", "s2"]});
        // 差一点点不够：按少一项排。
        expect(fit(heightFor(1 + 5 + 2) - 1)).toEqual({bots: ["b1", "b2", "b3"], more: 2, sessions: ["s1", "s2"]});
    });

    test("当前的会话与 bot 永远占位：排在外面时顶替最后一个", () => {
        expect(fit(heightFor(1 + 5 + 3), {session: "s6"}).sessions).toEqual(["s1", "s2", "s6"]);
        expect(fit(heightFor(1 + 4 + 2), {bot: "b5"})).toEqual({bots: ["b1", "b2", "b5"], more: 2, sessions: ["s1", "s2"]});
    });

    test("极矮：bot 一组至少一个位置（全收进“+N”），当前会话仍在", () => {
        expect(fit(heightFor(2), {session: "s4"})).toEqual({bots: [], more: 5, sessions: ["s4"]});
        expect(fit(0)).toEqual({bots: [], more: 5, sessions: []});
    });

    test("没有 bot 时会话用满剩下的位置；会话不到两个时 bot 只给它们留实际的数", () => {
        expect(fit(heightFor(1 + 3), {}, {bots: []})).toEqual({bots: [], more: 0, sessions: ["s1", "s2", "s3"]});
        expect(fit(heightFor(1 + 5), {}, {sessions: ["s1"]})).toEqual({bots: ["b1", "b2", "b3"], more: 2, sessions: ["s1"]});
    });
});
