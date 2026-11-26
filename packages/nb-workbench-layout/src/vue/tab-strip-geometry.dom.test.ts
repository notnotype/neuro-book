import {describe, expect, it} from "vitest";

import {measureTabStrip, resolveTabStripInsertion, tabStripInsertionIn, tabStripStopInsertions, tabStripStops} from "./tab-strip-geometry";

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

    it("单行、普通区的标签滚出了行尾：过了最后一个看得见的固定标签，是固定区的末尾，不插到滚出去的普通标签前面", () => {
        // 行宽 200：p1、p2 看得见，n1 在 200 到 300、整个滚出去了。共享算法会把这个位置换成“插到 n1 前面”，那就进了普通区。
        const snapshot = measureTabStrip(stripOf([{tabs: [pinned("p1"), pinned("p2"), normal("n1")]}], 200));
        expect(tabStripInsertionIn(snapshot, {x: 180, y: 10})).toMatchObject({before: null, after: "p2", partition: "pinned"});
    });

    it("单行、来源不在行尾：行尾的分区看最后一个标签", () => {
        const snapshot = measureTabStrip(stripOf([{tabs: [pinned("p1"), normal("s"), normal("n")]}]), "s");
        expect(tabStripInsertionIn(snapshot, {x: 800, y: 10})).toMatchObject({before: null, after: "n", partition: "normal"});
    });

    it("多行、来源是这一行唯一的标签：空行整行是一个插入位，分区是这一行的", () => {
        const snapshot = measureTabStrip(stripOf([{partition: "pinned", tabs: [pinned("p1")]}, {partition: "normal", tabs: [normal("s")]}]), "s");
        expect(tabStripInsertionIn(snapshot, {x: 400, y: HEIGHT + 10})).toMatchObject({before: null, after: null, partition: "normal"});
    });

    it("行里有标签但都在行尾之外（行首留白比行还宽）：没有插入位，不当成空行", () => {
        // 行宽 200，宿主在行首留了 210 的白，两个标签都还没滚进来。
        const strip = stripOfBoxes([[0, 0, 200, HEIGHT]], [{id: "a", row: 0, box: [210, 0, WIDTH, HEIGHT]}, {id: "b", row: 0, box: [310, 0, WIDTH, HEIGHT]}], 200);
        expect(resolveTabStripInsertion(strip, {x: 100, y: 10})).toBeNull();
    });

    it("整条只有来源：还有一个插入位，放回去是原来的分区", () => {
        const snapshot = measureTabStrip(stripOf([{tabs: [normal("s")]}]), "s");
        expect(tabStripInsertionIn(snapshot, {x: 400, y: 10})).toMatchObject({before: null, after: null, partition: "normal"});
    });
});

/** 一个标签的外框：`row` 是它在第几个 `data-tab-row`，`box` 是外框矩形（左、上、宽、高），DOM 顺序就是数组顺序。 */
interface BoxSpec {
    readonly id: string;
    readonly row: number;
    readonly box: readonly [left: number, top: number, width: number, height: number];
}

/** 按每个标签自己的外框摆：标签高矮不一时同一视觉行里 `top` 各不相同，DOM 顺序也就不是按 `top` 排的顺序。 */
function stripOfBoxes(rowBoxes: ReadonlyArray<readonly [left: number, top: number, width: number, height: number]>, tabs: ReadonlyArray<BoxSpec>, stripWidth = 1000): HTMLElement {
    const strip = document.createElement("div");
    place(strip, 0, 0, stripWidth, 100);
    const rows = rowBoxes.map(([left, top, width, height], at) => {
        const row = document.createElement("div");
        row.dataset.tabRow = String(at);
        place(row, left, top, width, height);
        strip.append(row);
        return row;
    });
    for (const {id, row, box} of tabs) {
        const frame = document.createElement("div");
        place(frame, ...box);
        const button = document.createElement("button");
        button.dataset.panelTab = id;
        button.dataset.tabPartition = "normal";
        frame.append(button);
        (rows[row] as HTMLElement).append(frame);
    }
    return strip;
}

describe("标签高矮不一的多行条", () => {
    // 第 0 个 `data-tab-row` 里 a、c 的 top 是 5、b 的 top 是 0（高度不同，居中对齐），按 top 分成两条折行 [b] 与 [a, c]；第 1 个 `data-tab-row` 是 d、e。
    const tabs: ReadonlyArray<BoxSpec> = [
        {id: "a", row: 0, box: [0, 5, 100, 20]},
        {id: "b", row: 0, box: [100, 0, 100, 30]},
        {id: "c", row: 0, box: [200, 5, 100, 20]},
        {id: "d", row: 1, box: [0, 40, 100, 30]},
        {id: "e", row: 1, box: [100, 40, 100, 30]},
    ];
    const rowBoxes = [[0, 0, 1000, 30], [0, 40, 1000, 30]] as const;

    it("`members` 按 DOM 顺序（不是按折行的顺序），摘掉的来源只在 `excludedRect` 里，后面的补上它的空位", () => {
        const snapshot = measureTabStrip(stripOfBoxes(rowBoxes, tabs), "a");
        expect(snapshot.members.map((member) => member.id)).toEqual(["b", "c", "d", "e"]);
        // c 与 a 同一条折行：补上 a 的空位（一格 200）；b 在另一条折行，不动。
        expect(snapshot.members.map((member) => member.rect)).toEqual([
            {left: 100, top: 0, right: 200, bottom: 30},
            {left: 0, top: 5, right: 100, bottom: 25},
            {left: 0, top: 40, right: 100, bottom: 70},
            {left: 100, top: 40, right: 200, bottom: 70},
        ]);
        expect(snapshot.excludedRect).toEqual({left: 0, top: 5, right: 100, bottom: 25});
        expect(snapshot.excludedPartition).toBe("normal");
        // 行：先按 `data-tab-row`，行内按 top 从上到下。
        expect(snapshot.lines.map((line) => line.members.map((member) => member.id))).toEqual([["b"], ["c"], ["d", "e"]]);
        expect(snapshot.lines.map((line) => line.rect)).toEqual([
            {left: 0, top: 0, right: 1000, bottom: 30},
            {left: 0, top: 5, right: 1000, bottom: 25},
            {left: 0, top: 40, right: 1000, bottom: 70},
        ]);
        expect(snapshot.lines.map((line) => line.endedWithExcluded)).toEqual([false, false, false]);
    });

    it("不摘来源：`members` 仍按 DOM 顺序，原始矩形一个不动，行按 top 排", () => {
        const snapshot = measureTabStrip(stripOfBoxes(rowBoxes, tabs));
        expect(snapshot.members.map((member) => member.id)).toEqual(["a", "b", "c", "d", "e"]);
        expect(snapshot.members.map((member) => member.rect)).toEqual(tabs.map(({box: [left, top, width, height]}) => ({left, top, right: left + width, bottom: top + height})));
        expect(snapshot.excludedRect).toBeUndefined();
        expect(snapshot.lines.map((line) => line.members.map((member) => member.id))).toEqual([["b"], ["a", "c"], ["d", "e"]]);
    });

    it("来源是折行里排在后面的：它前面的不动，行尾的空白是它的位置", () => {
        const snapshot = measureTabStrip(stripOfBoxes(rowBoxes, tabs), "c");
        expect(snapshot.members.map((member) => member.id)).toEqual(["a", "b", "d", "e"]);
        expect(snapshot.members.map((member) => member.rect.left)).toEqual([0, 100, 0, 100]);
        expect(snapshot.excludedRect).toEqual({left: 200, top: 5, right: 300, bottom: 25});
        expect(snapshot.lines.map((line) => line.endedWithExcluded)).toEqual([false, true, false]);
    });
});

describe("键盘的停靠点", () => {
    it("`tabStripStopInsertions` 和对每个停靠点单独 `resolveTabStripInsertion` 的结果一样（多行、分区、折行高矮不一）", () => {
        const strips = [
            stripOf([{partition: "pinned", tabs: [pinned("p1"), pinned("p2")]}, {partition: "normal", tabs: [normal("a"), normal("b"), normal("c")]}]),
            stripOf([{tabs: [pinned("p"), normal("a"), normal("b")]}]),
            stripOfBoxes(
                [[0, 0, 1000, 30], [0, 40, 1000, 30]],
                [
                    {id: "a", row: 0, box: [0, 5, 100, 20]},
                    {id: "b", row: 0, box: [100, 0, 100, 30]},
                    {id: "c", row: 0, box: [200, 5, 100, 20]},
                    {id: "d", row: 1, box: [0, 40, 100, 30]},
                ],
            ),
        ];
        for (const strip of strips) {
            const stops = tabStripStops(strip);
            expect(stops.length).toBeGreaterThan(0);
            const expected = stops.flatMap((point) => {
                const insertion = resolveTabStripInsertion(strip, point);
                return insertion === null ? [] : [{point, insertion}];
            });
            expect(tabStripStopInsertions(strip)).toEqual(expected);
        }
    });

    it("没有行的条没有停靠点；有一个空行时整行是一个", () => {
        expect(tabStripStopInsertions(stripOf([]))).toEqual([]);
        expect(tabStripStopInsertions(stripOf([{tabs: []}]))).toMatchObject([{point: {x: 1}, insertion: {before: null, after: null}}]);
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
