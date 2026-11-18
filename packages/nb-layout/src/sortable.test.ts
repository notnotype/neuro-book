/**
 * 可排序列表的位置判定（docs/specs/ui/sortable-list.md 输出 3）：被拖的后沿过下一个邻居的中线、前沿过上一个邻居的中线才换，
 * 分区头算一个邻居，空分区的第 0 位拖得进；一次可以连换几位。布局按这一刻量的给，来源在它此刻的位置上。
 */

import {describe, expect, it} from "bun:test";

import {moveInSections, slotOfKey, sortableSlotIn, sortableSlots} from "./sortable";
import type {SortableLayout} from "./sortable";

const span = (start: number, end: number) => ({start, end});
const member = (key: string, start: number, end: number) => ({key, span: span(start, end)});

/** 左边 k1、k2、k3（行高 20，间距 2），右边的头在 74 到 92，右边 k4。 */
const twoSections = (left: readonly string[]): SortableLayout => ({
    sections: [
        {id: "left", head: null, members: left.map((key, index) => member(key, index * 22, index * 22 + 20))},
        {id: "right", head: span(74, 92), members: [member("k4", 96, 116)]},
    ],
});

describe("拖动的判定", () => {
    it("往下：后沿过了下一行的中线才换；没过就留在原处", () => {
        const layout = twoSections(["k1", "k2", "k3"]);
        expect(sortableSlotIn(layout, "k1", span(10, 30))).toEqual({section: "left", index: 0});
        expect(sortableSlotIn(layout, "k1", span(13, 33))).toEqual({section: "left", index: 1});
    });

    it("往上：前沿过了上一行的中线才换（刚换过来时往回挪一点不会马上换回去）", () => {
        const layout = twoSections(["k2", "k1", "k3"]);
        expect(sortableSlotIn(layout, "k1", span(18, 38))).toEqual({section: "left", index: 1});
        expect(sortableSlotIn(layout, "k1", span(9, 29))).toEqual({section: "left", index: 0});
    });

    it("分区头算一个邻居：过了它的中线就进了那一区的第 0 位", () => {
        const layout = twoSections(["k1", "k2", "k3"]);
        expect(sortableSlotIn(layout, "k3", span(60, 80))).toEqual({section: "left", index: 2});
        expect(sortableSlotIn(layout, "k3", span(64, 84))).toEqual({section: "right", index: 0});
    });

    it("一次移得远时连换几位，停在过不去的那个邻居前面", () => {
        expect(sortableSlotIn(twoSections(["k1", "k2", "k3"]), "k1", span(60, 80))).toEqual({section: "left", index: 2});
        expect(sortableSlotIn(twoSections(["k1", "k2", "k3"]), "k1", span(100, 120))).toEqual({section: "right", index: 1});
    });

    it("最后一个分区是空的：过了它的头就是它的第 0 位", () => {
        const layout: SortableLayout = {sections: [
            {id: "left", head: null, members: [member("k1", 0, 20), member("k2", 22, 42)]},
            {id: "right", head: span(52, 70), members: []},
        ]};
        expect(sortableSlotIn(layout, "k2", span(40, 60))).toEqual({section: "left", index: 1});
        expect(sortableSlotIn(layout, "k2", span(50, 70))).toEqual({section: "right", index: 0});
    });

    it("来源是一区唯一的一项：拖出去那一区就空了，再往上拖回空区的第 0 位", () => {
        const before: SortableLayout = {sections: [
            {id: "left", head: null, members: [member("k1", 0, 20)]},
            {id: "right", head: span(30, 48), members: [member("k2", 52, 72), member("k3", 74, 94)]},
        ]};
        expect(sortableSlotIn(before, "k1", span(15, 35))).toEqual({section: "left", index: 0});
        expect(sortableSlotIn(before, "k1", span(20, 40))).toEqual({section: "right", index: 0});
        // 预览排好之后：左边只剩占位（不是邻居），k1 在右边第一位。
        const after: SortableLayout = {sections: [
            {id: "left", head: null, members: []},
            {id: "right", head: span(38, 56), members: [member("k1", 60, 80), member("k2", 82, 102), member("k3", 104, 124)]},
        ]};
        expect(sortableSlotIn(after, "k1", span(50, 70))).toEqual({section: "right", index: 0});
        expect(sortableSlotIn(after, "k1", span(40, 60))).toEqual({section: "left", index: 0});
    });

    it("来源不在布局里时交回 null", () => {
        expect(sortableSlotIn(twoSections(["k1"]), "nope", span(0, 20))).toBeNull();
    });
});

describe("键盘的停靠位置与次序", () => {
    it("按呈现顺序列出来源能去的每个位置，空分区的第 0 位也在", () => {
        expect(sortableSlots([{id: "left", keys: ["k1", "k2", "k3"]}, {id: "right", keys: ["k4"]}], "k1")).toEqual([
            {section: "left", index: 0}, {section: "left", index: 1}, {section: "left", index: 2},
            {section: "right", index: 0}, {section: "right", index: 1},
        ]);
        const emptyRight = [{id: "left", keys: ["a", "b"]}, {id: "right", keys: []}];
        expect(sortableSlots(emptyRight, "b")).toEqual([{section: "left", index: 0}, {section: "left", index: 1}, {section: "right", index: 0}]);
    });

    it("移动：从原处摘下、放到目标位置；位置不变时交回同一份", () => {
        const sections = [{id: "left", keys: ["a", "b"]}, {id: "right", keys: ["c"]}];
        expect(moveInSections(sections, "a", {section: "right", index: 1})).toEqual([{id: "left", keys: ["b"]}, {id: "right", keys: ["c", "a"]}]);
        expect(moveInSections(sections, "b", {section: "left", index: 0})).toEqual([{id: "left", keys: ["b", "a"]}, {id: "right", keys: ["c"]}]);
        expect(moveInSections(sections, "b", {section: "left", index: 1})).toBe(sections);
        expect(moveInSections(sections, "c", {section: "left", index: 99})).toEqual([{id: "left", keys: ["a", "b", "c"]}, {id: "right", keys: []}]);
        expect(slotOfKey(sections, "c")).toEqual({section: "right", index: 0});
        expect(slotOfKey(sections, "x")).toBeNull();
    });
});
