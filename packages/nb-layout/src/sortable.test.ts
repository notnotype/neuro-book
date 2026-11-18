/**
 * 可排序列表的位置判定（docs/specs/ui/sortable-list.md 输出 3）：被拖的后沿过下一个邻居的中线、前沿过上一个邻居的中线才换，
 * 分区头算一个邻居，空分区的第 0 位拖得进；一次可以连换几位。布局按这一刻量的给，来源在它此刻的位置上。
 */

import {describe, expect, it} from "bun:test";

import {moveInSections, slotOfKey, sortableSlotIn, sortableSlots} from "./sortable";
import type {SortableLayout, SortableSection, SortableSlot, SortableSwitch} from "./sortable";

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

/**
 * 按 SortableList 的版式排一份布局：分区头（第一个分区也有，高 20，第二个起多 14 的上边距），行（各自的高），空分区一行占位（高 30），
 * 相邻元素之间 2px。来源在 `sections` 里它此刻的位置上。
 */
function layOut(sections: readonly SortableSection[], heights: Readonly<Record<string, number>>): SortableLayout {
    let at = 0;
    const take = (size: number) => {
        const span = {start: at, end: at + size};
        at += size + 2;
        return span;
    };
    return {sections: sections.map((section, index) => {
        const head = take(index === 0 ? 20 : 34);
        const members = section.keys.map((key) => ({key, span: take(heights[key] ?? 28)}));
        if (section.keys.length === 0) take(30);
        return {id: section.id, head, members};
    })};
}

/** 被拖的行从 `from` 一像素一像素扫到 `to`（前沿的位置），每一步按上一次的结果重排再判，交回途经的位置。 */
function sweep(initial: readonly SortableSection[], heights: Readonly<Record<string, number>>, source: string, from: number, to: number): string[] {
    let sections = initial;
    let last: SortableSwitch | null = null;
    const visited: string[] = [];
    const size = heights[source] ?? 28;
    const step = Math.sign(to - from);
    for (let start = from; step > 0 ? start <= to : start >= to; start += step) {
        const layout = layOut(sections, heights);
        const current = slotOfKey(sections, source)!;
        const slot: SortableSlot = sortableSlotIn(layout, source, {start, end: start + size}, last)!;
        if (slot.section !== current.section || slot.index !== current.index) {
            last = {from: current, to: slot, at: start};
            sections = moveInSections(sections, source, slot);
        }
        const name = `${slot.section}${String(slot.index)}`;
        if (visited.at(-1) !== name) visited.push(name);
    }
    return visited;
}
const ordinal = (sections: readonly SortableSection[], source: string) => (name: string): number =>
    sortableSlots(sections, source).findIndex((slot: SortableSlot) => `${slot.section}${String(slot.index)}` === name);

describe("一路拖过去不来回翻（重排之后再判，带着上一次的换位）", () => {
    const heights = {a: 36, b: 28, c: 28, d: 28, e: 28};

    it("来源是一区唯一的一项：往下拖过分区头，经过的位置只往前走，不在头附近来回换", () => {
        const sections = [{id: "L", keys: ["a"]}, {id: "R", keys: ["b", "c", "d"]}];
        const visited = sweep(sections, heights, "a", 22, 200);
        const order = visited.map(ordinal(sections, "a"));
        expect(order).toEqual([...order].sort((x, y) => x - y));
        expect(visited.at(-1)).toBe("R3");
        // 再拖回去：同样只往回走，最后回到左边。
        const back = sweep([{id: "L", keys: []}, {id: "R", keys: ["b", "c", "d", "a"]}], heights, "a", 200, 0);
        const backOrder = back.map(ordinal(sections, "a"));
        expect(backOrder).toEqual([...backOrder].sort((x, y) => y - x));
        expect(back.at(-1)).toBe("L0");
    });

    it("拖进、拖出中间的空分区：同样不来回换", () => {
        const sections = [{id: "A", keys: ["a", "b"]}, {id: "B", keys: []}, {id: "C", keys: ["c", "d"]}];
        const visited = sweep(sections, heights, "a", 22, 260);
        const order = visited.map(ordinal(sections, "a"));
        expect(order).toEqual([...order].sort((x, y) => x - y));
        expect(visited).toContain("B0");
        expect(visited.at(-1)).toBe("C2");
    });

    it("刚换过去时，往前接着拖、往回挪不到粘滞的距离都不换回来，往回挪够了才换", () => {
        const sections = [{id: "L", keys: ["a"]}, {id: "R", keys: ["b"]}];
        const before = layOut(sections, heights);
        // 静止时 a 在 22 到 58，右边的头在 60 到 94（中线 77）：后沿过了 77 才换过去。
        expect(sortableSlotIn(before, "a", {start: 40, end: 76})).toEqual({section: "L", index: 0});
        const crossed = sortableSlotIn(before, "a", {start: 44, end: 80})!;
        expect(crossed).toEqual({section: "R", index: 0});
        // 换过去以后左边成了占位，右边的头上移到 54 到 88（中线 71）：前沿 44 已在中线上面，没有粘滞就会马上换回去。
        const after = layOut(moveInSections(sections, "a", crossed), heights);
        const last: SortableSwitch = {from: {section: "L", index: 0}, to: crossed, at: 44};
        expect(sortableSlotIn(after, "a", {start: 44, end: 80}, last)).toEqual({section: "R", index: 0});
        expect(sortableSlotIn(after, "a", {start: 60, end: 96}, last)).toEqual({section: "R", index: 0});
        expect(sortableSlotIn(after, "a", {start: 33, end: 69}, last)).toEqual({section: "R", index: 0});
        expect(sortableSlotIn(after, "a", {start: 32, end: 68}, last)).toEqual({section: "L", index: 0});
    });
});
