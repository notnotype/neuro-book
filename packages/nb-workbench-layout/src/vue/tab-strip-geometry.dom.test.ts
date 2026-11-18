import {describe, expect, it} from "vitest";

import {measureTabStrip, tabStripInsertionIn} from "./tab-strip-geometry";

/**
 * 标签条的插入判定（docs/specs/ui/workbench-layout.md 输出 25）。happy-dom 没有布局，矩形由夹具写在元素上；结构与 `TabStrip` 写的属性一致。真实标签条在 e2e/editor-area.e2e.ts。
 */

const HEIGHT = 30;
const WIDTH = 100;

function place(element: HTMLElement, left: number, top: number, width: number, height: number): void {
    Object.defineProperty(element, "getBoundingClientRect", {value: () => ({left, top, right: left + width, bottom: top + height, width, height, x: left, y: top})});
}

interface RowSpec {
    readonly partition?: string;
    readonly tabs: ReadonlyArray<{readonly id: string; readonly partition: string; readonly width?: number}>;
}

/** 一行一个 `RowSpec`，标签从左到右紧挨着（缺省宽 `WIDTH`），行宽缺省 1000。 */
function stripOf(rows: ReadonlyArray<RowSpec>, rowWidth = 1000): HTMLElement {
    const strip = document.createElement("div");
    place(strip, 0, 0, rowWidth, HEIGHT * rows.length);
    for (const [at, spec] of rows.entries()) {
        const top = at * HEIGHT;
        const row = document.createElement("div");
        row.dataset.tabRow = String(at);
        if (spec.partition !== undefined) row.dataset.tabRowPartition = spec.partition;
        place(row, 0, top, rowWidth, HEIGHT);
        let left = 0;
        for (const tab of spec.tabs) {
            const frame = document.createElement("div");
            const width = tab.width ?? WIDTH;
            place(frame, left, top, width, HEIGHT);
            left += width;
            const button = document.createElement("button");
            button.dataset.panelTab = tab.id;
            button.dataset.tabPartition = tab.partition;
            frame.append(button);
            row.append(frame);
        }
        strip.append(row);
    }
    return strip;
}

const normal = (id: string) => ({id, partition: "normal"});
const pinned = (id: string) => ({id, partition: "pinned"});

describe("摘掉来源之后的插入位", () => {
    it("来源在中间：邻居是摘掉之后的，后面的补上它的空位；来源原来的分区与矩形记下来", () => {
        const strip = stripOf([{tabs: [normal("a"), normal("s"), normal("c")]}]);
        const snapshot = measureTabStrip(strip, "s");
        expect(snapshot.members.map((member) => member.id)).toEqual(["a", "c"]);
        expect(snapshot.excludedPartition).toBe("normal");
        expect(snapshot.excludedRect).toMatchObject({left: 100, right: 200});
        // c 补到 100 到 200：左半边是插到 c 前面，右半边已经在 c 后面。
        expect(tabStripInsertionIn(snapshot, {x: 140, y: 10})).toMatchObject({before: "c", after: "a", partition: "normal"});
        expect(tabStripInsertionIn(snapshot, {x: 160, y: 10})).toMatchObject({before: null, after: "c", partition: "normal"});
    });

    it("不摘来源时 `excludedPartition` 没有值；行尾是分区末尾", () => {
        const snapshot = measureTabStrip(stripOf([{tabs: [normal("a"), normal("b")]}]));
        expect(snapshot.excludedPartition).toBeUndefined();
        expect(tabStripInsertionIn(snapshot, {x: 800, y: 10})).toMatchObject({before: null, after: "b", partition: "normal"});
    });

    it("单行、来源是唯一的普通标签：行尾的空白还是普通区，不把它钉进固定区", () => {
        const snapshot = measureTabStrip(stripOf([{tabs: [pinned("p1"), pinned("p2"), normal("s")]}]), "s");
        expect(tabStripInsertionIn(snapshot, {x: 800, y: 10})).toMatchObject({before: null, after: "p2", partition: "normal"});
    });

    it("单行、来源不在行尾：行尾的分区看最后一个标签", () => {
        const snapshot = measureTabStrip(stripOf([{tabs: [pinned("p1"), normal("s"), normal("n")]}]), "s");
        expect(tabStripInsertionIn(snapshot, {x: 800, y: 10})).toMatchObject({before: null, after: "n", partition: "normal"});
    });

    it("多行、来源是这一行唯一的标签：空行整行是一个插入位，分区是这一行的", () => {
        const snapshot = measureTabStrip(stripOf([{partition: "pinned", tabs: [pinned("p1")]}, {partition: "normal", tabs: [normal("s")]}]), "s");
        expect(tabStripInsertionIn(snapshot, {x: 400, y: HEIGHT + 10})).toMatchObject({before: null, after: null, partition: "normal"});
    });

    it("整条只有来源：还有一个插入位，放回去是原来的分区", () => {
        const snapshot = measureTabStrip(stripOf([{tabs: [normal("s")]}]), "s");
        expect(tabStripInsertionIn(snapshot, {x: 400, y: 10})).toMatchObject({before: null, after: null, partition: "normal"});
    });
});

describe("在条里跟手排序（held）：按被拖的标签的位置判，不按指针", () => {
    /** 抓住的点在指针下、夹在行里时，标签前缘的位置换算成指针：`left + grab * width`。 */
    const pointerFor = (left: number, held: {readonly width: number; readonly grab: number}) => ({x: left + held.grab * held.width, y: 10});

    it("A | B、拖 B、抓在 B 靠右的地方：B 的左沿过了 A 的中线 A 就让到后面，指针还在 A 的中线右边", () => {
        const snapshot = measureTabStrip(stripOf([{tabs: [normal("a"), normal("b")]}]), "b");
        const held = {width: WIDTH, grab: 0.9};
        const point = pointerFor(40, held);
        expect(point.x).toBeGreaterThan(WIDTH / 2);
        expect(tabStripInsertionIn(snapshot, point, held)).toMatchObject({before: "a", after: null});
        // 还没过中线：原位（插在 a 后面，b 本来就在那）。
        expect(tabStripInsertionIn(snapshot, pointerFor(60, held), held)).toMatchObject({before: null, after: "a"});
    });

    it("往右：被拖的标签右沿过了右边邻居画出来的中线才换（邻居让出了一格，比它量到的位置靠右一格）", () => {
        const snapshot = measureTabStrip(stripOf([{tabs: [normal("a"), normal("s"), normal("c")]}]), "s");
        const held = {width: WIDTH, grab: 0.1};
        // s 原位时 c 画在 200 到 300，中线 250：s 的右沿过 250 即左沿过 150。
        expect(tabStripInsertionIn(snapshot, pointerFor(140, held), held)).toMatchObject({before: "c", after: "a"});
        expect(tabStripInsertionIn(snapshot, pointerFor(160, held), held)).toMatchObject({before: null, after: "c"});
    });

    // 夹在行的两端时，抓在哪一点、来源比邻居宽还是窄、行里有没有空白，第一个与最后一个位置都到得了；没动就是原位。
    const cases = [0, 0.5, 1].flatMap((grab) => [60, 160].flatMap((width) => [0, 1, 2].flatMap((at) => [true, false].map((full) => ({grab, width, at, full})))));
    it.each(cases)("抓在 $grab、来源宽 $width、来源是第 $at 个、行刚好放满 $full", ({grab, width, at, full}) => {
        const ids = ["x", "y", "z"];
        const source = ids[at] as string;
        const tabs: RowSpec["tabs"] = ids.map((id) => (id === source ? {...normal(id), width} : normal(id)));
        const total = tabs.reduce((sum, tab) => sum + (tab.width ?? WIDTH), 0);
        const snapshot = measureTabStrip(stripOf([{tabs}], full ? total : 1000), source);
        const held = {width, grab};
        const others = ids.filter((id) => id !== source);
        expect(tabStripInsertionIn(snapshot, {x: -5000, y: 10}, held)).toMatchObject({before: others[0]});
        expect(tabStripInsertionIn(snapshot, {x: 5000, y: 10}, held)).toMatchObject({before: null, after: others.at(-1)});
        const rest = snapshot.excludedRect?.left ?? Number.NaN;
        expect(tabStripInsertionIn(snapshot, pointerFor(rest, held), held)).toMatchObject({before: ids[at + 1] ?? null, after: ids[at - 1] ?? null});
    });
});
