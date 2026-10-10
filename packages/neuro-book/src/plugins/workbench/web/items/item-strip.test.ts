/** 条目的溢出预算（docs/specs/ui/workbench-shell.md 外壳四输出 34）。 */

import {describe, expect, it} from "bun:test";

import {layoutStrip} from "./item-strip";
import type {StripItem} from "./item-strip";

const item = (id: string, width: number, priority = 0, order = 0): StripItem => ({id, width, priority, order});

describe("溢出预算", () => {
    const items = [item("a", 40, 10, 1), item("b", 60, 30, 2), item("c", 50, 20, 3)];

    it("恰好装下时全部摆出来，不画“更多”", () => {
        expect(layoutStrip(items, 150, 30)).toEqual({shown: ["a", "b", "c"], hidden: []});
    });

    it("差一点装不下：先给“更多”留位，再按优先级放；结果按显示顺序", () => {
        // 149 装不下 150；留出“更多”30 后预算 119：b(60) + c(50) = 110，a 收起。
        expect(layoutStrip(items, 149, 30)).toEqual({shown: ["b", "c"], hidden: ["a"]});
    });

    it("“更多”的位要先留出来：不留时恰好装得下的两项，留了之后只装得下一项", () => {
        const tight = [item("b", 60, 30, 1), item("c", 50, 20, 2), item("a", 30, 10, 3)];
        // 可用 130：b + c = 110 装得下，但要先给“更多”留 30，预算 100，c 就放不下了。
        expect(layoutStrip(tight, 130, 30)).toEqual({shown: ["b"], hidden: ["c", "a"]});
    });

    it("第一个放不下的高优先级条目之后都收起，窄的低优先级条目不越过它", () => {
        const wide = [item("narrow", 10, 1, 1), item("wide", 200, 50, 2), item("mid", 40, 40, 3)];
        // 预算 100 - 20 = 80：wide 放不下，之后的 mid、narrow 也收起。
        expect(layoutStrip(wide, 100, 20)).toEqual({shown: [], hidden: ["narrow", "wide", "mid"]});
    });

    it("同优先级按 order 再按 id 决定先放谁", () => {
        const tied = [item("y", 50, 5, 2), item("x", 50, 5, 2), item("z", 50, 5, 1)];
        // 预算 130 - 30 = 100：z(order 1) 先，然后 x（id 小）。
        expect(layoutStrip(tied, 130, 30)).toEqual({shown: ["x", "z"], hidden: ["y"]});
    });

    it("连“更多”都放不下时全部收起，只剩“更多”", () => {
        expect(layoutStrip(items, 20, 30)).toEqual({shown: [], hidden: ["a", "b", "c"]});
    });
});

describe("间距按实际项数算", () => {
    const items = [item("a", 40, 10, 1), item("b", 60, 30, 2), item("c", 50, 20, 3)];

    it("全部摆出来时三项之间只有两个间距：158 装下，157 装不下", () => {
        expect(layoutStrip(items, 158, 30, 4)).toEqual({shown: ["a", "b", "c"], hidden: []});
        expect(layoutStrip(items, 157, 30, 4)).toEqual({shown: ["b", "c"], hidden: ["a"]});
    });

    it("收起时“更多”算一项：b、c 加“更多”是 60 + 50 + 30 加两个间距 148，147 只放得下 b", () => {
        expect(layoutStrip(items, 148, 30, 4)).toEqual({shown: ["b", "c"], hidden: ["a"]});
        expect(layoutStrip(items, 147, 30, 4)).toEqual({shown: ["b"], hidden: ["a", "c"]});
    });
});
