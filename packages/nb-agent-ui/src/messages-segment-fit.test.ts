import {describe, expect, test} from "bun:test";

import {fitSegment, SEGMENT_DIVIDER, SEGMENT_ITEM_STEP, SEGMENT_PADDING} from "./messages-segment-fit";

const bots = ["b1", "b2", "b3", "b4", "b5"];
const sessions = ["s1", "s2", "s3", "s4", "s5", "s6"];
/**
 * 正好放得下 `items` 项（含“新对话”）的中段 `clientHeight`：n 项加一条短线、n 个间距、上下内边距。审查在真实浏览器里按同样的样式量过
 * 3、5、8 项是 137、217、337（`w00043 t19 evidences/impl-review-7-sonnet.txt` 第 1 条）。
 */
const heightFor = (items: number): number => items * SEGMENT_ITEM_STEP + SEGMENT_DIVIDER + SEGMENT_PADDING;
const fit = (height: number | null, current: {bot?: string; session?: string} = {}, input: {bots?: string[]; sessions?: string[]; fixed?: number} = {}) => fitSegment({
    height,
    ...(input.fixed === undefined ? {} : {fixed: input.fixed}),
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

    test("真实布局量到的高度（3、5、8 项）正好放得下这么多项", () => {
        expect([heightFor(3), heightFor(5), heightFor(8)]).toEqual([137, 217, 337]);
        expect(fit(137, {}, {bots: ["b1"], sessions: ["s1", "s2", "s3"]})).toEqual({bots: ["b1"], more: 0, sessions: ["s1"]});
        expect(fit(136, {}, {bots: ["b1"], sessions: ["s1", "s2", "s3"]})).toEqual({bots: ["b1"], more: 0, sessions: []});
    });

    test("当前的会话与 bot 永远占位：排在外面时顶替最后一个", () => {
        expect(fit(heightFor(1 + 5 + 3), {session: "s6"}).sessions).toEqual(["s1", "s2", "s6"]);
        expect(fit(heightFor(1 + 4 + 2), {bot: "b5"})).toEqual({bots: ["b1", "b2", "b5"], more: 2, sessions: ["s1", "s2"]});
    });

    test("极矮：bot 一组至少一个位置（全收进“+N”，当前 bot 也收进去），当前会话仍在", () => {
        expect(fit(heightFor(2), {session: "s4", bot: "b3"})).toEqual({bots: [], more: 5, sessions: ["s4"]});
        expect(fit(0)).toEqual({bots: [], more: 5, sessions: []});
    });

    test("总在的项多一个（展开按钮）时，同样的高度少放一项，从最近会话的末尾减", () => {
        expect(fit(heightFor(2 + 5 + 4), {}, {fixed: 2})).toEqual({bots, more: 0, sessions: ["s1", "s2", "s3", "s4"]});
        expect(fit(heightFor(1 + 5 + 4), {}, {fixed: 2})).toEqual({bots, more: 0, sessions: ["s1", "s2", "s3"]});
    });

    test("没有 bot 时会话用满剩下的位置；会话不到两个时 bot 只给它们留实际的数", () => {
        expect(fit(heightFor(1 + 3), {}, {bots: []})).toEqual({bots: [], more: 0, sessions: ["s1", "s2", "s3"]});
        expect(fit(heightFor(1 + 5), {}, {sessions: ["s1"]})).toEqual({bots: ["b1", "b2", "b3"], more: 2, sessions: ["s1"]});
    });
});
