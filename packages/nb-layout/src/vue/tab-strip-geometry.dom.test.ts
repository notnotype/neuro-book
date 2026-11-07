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
    readonly tabs: ReadonlyArray<{readonly id: string; readonly partition: string}>;
}

/** 一行一个 `RowSpec`，标签从左到右紧挨着，行宽 1000。 */
function stripOf(rows: ReadonlyArray<RowSpec>): HTMLElement {
    const strip = document.createElement("div");
    place(strip, 0, 0, 1000, HEIGHT * rows.length);
    for (const [at, spec] of rows.entries()) {
        const top = at * HEIGHT;
        const row = document.createElement("div");
        row.dataset.tabRow = String(at);
        if (spec.partition !== undefined) row.dataset.tabRowPartition = spec.partition;
        place(row, 0, top, 1000, HEIGHT);
        for (const [index, tab] of spec.tabs.entries()) {
            const frame = document.createElement("div");
            place(frame, index * WIDTH, top, WIDTH, HEIGHT);
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
    it("来源在中间：邻居是摘掉之后的，来源原来的分区记下来", () => {
        const strip = stripOf([{tabs: [normal("a"), normal("s"), normal("c")]}]);
        const snapshot = measureTabStrip(strip, "s");
        expect(snapshot.members.map((member) => member.id)).toEqual(["a", "c"]);
        expect(snapshot.excludedPartition).toBe("normal");
        // c 的矩形还是量到的（x 200 到 300）：左半边是插到 c 前面。
        expect(tabStripInsertionIn(snapshot, {x: 210, y: 10})).toMatchObject({before: "c", after: "a", partition: "normal"});
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
