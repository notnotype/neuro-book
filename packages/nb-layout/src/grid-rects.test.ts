import {describe, expect, it} from "bun:test";

import {createGrid} from "./grid";
import {nextFocusStop, placeGrid, stableOrder} from "./grid-rects";
import type {GridLeafPlacement, GridPlacement, GridSashPlacement} from "./grid-rects";
import type {GridLayoutResult, GridNode, GridNodeInput} from "./grid-types";

/** 布局结果 → 矩形（docs/specs/ui/nested-grid.md 的“按矩形摆放”“取整”）。布局结果都来自真实的 `createGrid().layout()`。 */

function leaf(id: string, width = 100, height = 100): GridNodeInput<string> {
    return {kind: "leaf", id, ref: id, size: {width, height}};
}

function grid(root: GridNodeInput<string>, sashSize: number, extent: {width: number; height: number}): {node: GridNode<string>; layout: GridLayoutResult} {
    const instance = createGrid<string>(root, {sashSize});
    return {node: instance.root() as GridNode<string>, layout: instance.layout(extent)};
}

function leaves(placement: GridPlacement<string>): GridLeafPlacement<string>[] {
    return placement.items.filter((item) => item.kind === "leaf");
}

function sashes(placement: GridPlacement<string>): GridSashPlacement<string>[] {
    return placement.items.filter((item) => item.kind === "sash");
}

const THREE = (): GridNodeInput<string> => ({kind: "branch", id: "root", orientation: "horizontal", children: [leaf("a"), leaf("b"), leaf("c")]});
const NESTED = (): GridNodeInput<string> => ({
    kind: "branch",
    id: "root",
    orientation: "horizontal",
    children: [leaf("left", 300), {kind: "branch", id: "right", orientation: "vertical", size: {width: 700, height: 0}, children: [leaf("top", 0, 100), leaf("bottom", 0, 100)]}],
});

describe("按矩形摆放", () => {
    it("一层：叶与分隔线交替，首尾贴容器，合计守恒", () => {
        const {node, layout} = grid(THREE(), 1, {width: 302, height: 200});
        const placement = placeGrid(node, layout, {width: 302, height: 200}, 1);
        expect(placement.items.map((item) => item.key)).toEqual(["leaf:a", "sash:a|b", "leaf:b", "sash:b|c", "leaf:c"]);
        expect(leaves(placement).map((item) => item.rect)).toEqual([
            {x: 0, y: 0, width: 100, height: 200},
            {x: 101, y: 0, width: 100, height: 200},
            {x: 202, y: 0, width: 100, height: 200},
        ]);
        expect(sashes(placement).map((item) => item.rect)).toEqual([
            {x: 100, y: 0, width: 1, height: 200},
            {x: 201, y: 0, width: 1, height: 200},
        ]);
    });

    it("嵌套：内层的矩形相对 grid 根，外层分隔线的身份不变", () => {
        const {node, layout} = grid(NESTED(), 1, {width: 1000, height: 401});
        const placement = placeGrid(node, layout, {width: 1000, height: 401}, 1);
        const rects = Object.fromEntries(leaves(placement).map((item) => [item.node.id, item.rect]));
        expect(rects.left).toEqual({x: 0, y: 0, width: 300, height: 401});
        expect(rects.top).toEqual({x: 301, y: 0, width: 699, height: 200});
        expect(rects.bottom).toEqual({x: 301, y: 201, width: 699, height: 200});
        expect(sashes(placement).map((item) => [item.sashKey, item.axis, item.rect])).toEqual([
            ["root:0", "width", {x: 300, y: 0, width: 1, height: 401}],
            ["right:0", "height", {x: 301, y: 200, width: 699, height: 1}],
        ]);
    });

    it("只有一个叶：铺满", () => {
        const {node, layout} = grid(leaf("only"), 1, {width: 640, height: 480});
        expect(leaves(placeGrid(node, layout, {width: 640, height: 480}, 1))[0]?.rect).toEqual({x: 0, y: 0, width: 640, height: 480});
    });

    it("交叉轴拉满父分支，不用叶自己的（叶带交叉轴上限时 sizes 比容器小）", () => {
        const root: GridNodeInput<string> = {kind: "branch", id: "root", orientation: "horizontal", children: [{...leaf("a"), maximumSize: {width: 600, height: 100}}, {...leaf("b"), maximumSize: {width: 600, height: 100}}]};
        const {node, layout} = grid(root, 1, {width: 600, height: 400});
        expect(leaves(placeGrid(node, layout, {width: 600, height: 400}, 1)).map((item) => item.rect.height)).toEqual([400, 400]);
    });

    it("主轴放不满时留空：不把最后一块拉长", () => {
        const root: GridNodeInput<string> = {kind: "branch", id: "root", orientation: "horizontal", children: [{...leaf("a"), maximumSize: {width: 100, height: 400}}, {...leaf("b"), maximumSize: {width: 100, height: 400}}]};
        const {node, layout} = grid(root, 1, {width: 600, height: 400});
        const last = leaves(placeGrid(node, layout, {width: 600, height: 400}, 1)).at(-1);
        expect((last?.rect.x ?? 0) + (last?.rect.width ?? 0)).toBeLessThan(300);
    });

    it("空布局（还没量到容器）：树还在，尺寸是 0，缺的缝按 1px，不是 NaN", () => {
        const {node} = grid(THREE(), 1, {width: 300, height: 200});
        const empty: GridLayoutResult = {sizes: {}, constraints: {}, sashSizes: {}, issues: []};
        const placement = placeGrid(node, empty, {width: 0, height: 0}, 1);
        expect(leaves(placement).map((item) => item.rect.width)).toEqual([0, 0, 0]);
        for (const item of placement.items) expect(Number.isFinite(item.rect.x) && Number.isFinite(item.rect.width)).toBe(true);
    });

    it("宿主传来非有限或负的尺寸：当 0，不产生 NaN 的矩形", () => {
        const {node, layout} = grid(THREE(), 1, {width: 302, height: 200});
        const broken: GridLayoutResult = {...layout, sizes: {...layout.sizes, a: {width: Number.NaN, height: 200}, b: {width: -5, height: 200}}};
        for (const item of placeGrid(node, broken, {width: 302, height: 200}, Number.NaN).items) {
            expect(Number.isFinite(item.rect.x) && item.rect.width >= 0).toBe(true);
        }
    });

    it("尺寸是 0 的叶矩形就是 0：不因为取整多出一个设备像素", () => {
        const {node, layout} = grid(THREE(), 1, {width: 302, height: 200});
        const zeroed: GridLayoutResult = {...layout, sizes: {...layout.sizes, b: {width: 0, height: 200}}};
        expect(leaves(placeGrid(node, zeroed, {width: 302, height: 200}, 1.5))[1]?.rect.width).toBe(0);
    });
});

describe("取整：同一占用的缝宽度相同", () => {
    for (const sash of [1, 4, 7]) {
        for (const dpr of [1, 1.25, 1.5, 2]) {
            it(`缝 ${sash}px，dpr ${dpr}：600 到 2000 的每个容器宽度，三块等分的两条缝都一样宽，边都在设备像素上`, () => {
                const expected = Math.max(1, Math.round(sash * dpr));
                for (let width = 600; width <= 2000; width += 1) {
                    const extent = {width, height: 300};
                    const {node, layout} = grid(THREE(), sash, extent);
                    const placement = placeGrid(node, layout, extent, dpr);
                    for (const item of sashes(placement)) {
                        expect(Math.round(item.rect.width * dpr)).toBe(expected);
                    }
                    const last = leaves(placement).at(-1);
                    expect(Math.round(((last?.rect.x ?? 0) + (last?.rect.width ?? 0)) * dpr)).toBe(Math.round(width * dpr));
                    for (const item of placement.items) {
                        const device = item.rect.x * dpr;
                        expect(Math.abs(device - Math.round(device))).toBeLessThan(1e-6);
                    }
                }
            });
        }
    }

    it("占用为 0 的接缝没有宽度", () => {
        const {node, layout} = grid(THREE(), 0, {width: 300, height: 200});
        expect(sashes(placeGrid(node, layout, {width: 300, height: 200}, 1.25)).map((item) => item.rect.width)).toEqual([0, 0]);
    });
});

describe("分隔线的身份与两端", () => {
    it("aria-controls 指向前一块里最后一个叶：前面是分支时是分支里的", () => {
        const root: GridNodeInput<string> = {
            kind: "branch",
            id: "root",
            orientation: "horizontal",
            children: [{kind: "branch", id: "left", orientation: "vertical", size: {width: 500, height: 0}, children: [leaf("a", 0, 100), leaf("b", 0, 100)]}, leaf("c", 500)],
        };
        const {node, layout} = grid(root, 1, {width: 1001, height: 401});
        const placed = sashes(placeGrid(node, layout, {width: 1001, height: 401}, 1));
        expect(placed.find((item) => item.sashKey === "root:0")?.controls).toBe("b");
        expect(placed.find((item) => item.sashKey === "left:0")?.controls).toBe("a");
    });

    it("悬停线两端：内层的线挨着外层的线时相连，挨着 grid 外缘时是自由端", () => {
        const {node, layout} = grid(NESTED(), 1, {width: 1000, height: 401});
        const placed = sashes(placeGrid(node, layout, {width: 1000, height: 401}, 1));
        expect(placed.find((item) => item.sashKey === "root:0")?.ends).toEqual({start: null, end: null});
        expect(placed.find((item) => item.sashKey === "right:0")?.ends).toEqual({start: "root:0", end: null});
    });

    it("0px 的边界没有线：那一侧的兄弟都是 0 时沿用外层的，有尺寸时是自由端", () => {
        const root: GridNodeInput<string> = {
            kind: "branch",
            id: "root",
            orientation: "horizontal",
            children: [leaf("left", 300), {kind: "branch", id: "right", orientation: "horizontal", size: {width: 700, height: 0}, children: [leaf("zero", 0), {kind: "branch", id: "stack", orientation: "vertical", size: {width: 700, height: 0}, children: [leaf("top", 0, 100), leaf("bottom", 0, 100)]}]}],
        };
        const instance = createGrid<string>(root, {sashSize: 1});
        const layout = instance.layout({width: 1000, height: 401});
        const zeroGap: GridLayoutResult = {
            ...layout,
            sizes: {...layout.sizes, zero: {width: 0, height: 401}},
            sashSizes: {...layout.sashSizes, right: [0]},
        };
        const free: GridLayoutResult = {...zeroGap, sizes: {...zeroGap.sizes, zero: {width: 50, height: 401}}};
        const endsOf = (result: GridLayoutResult) => sashes(placeGrid(instance.root() as GridNode<string>, result, {width: 1000, height: 401}, 1)).find((item) => item.sashKey === "stack:0")?.ends;
        expect(endsOf(zeroGap)).toEqual({start: "root:0", end: null});
        expect(endsOf(free)).toEqual({start: null, end: null});
    });
});

describe("stableOrder", () => {
    it("第一次就是树序", () => {
        expect(stableOrder([], ["a", "s", "b"])).toEqual(["a", "s", "b"]);
    });

    it("拆分：新项紧接在树序的前一项之后，已有的不动，结果仍等于树序", () => {
        expect(stableOrder(["a", "a|b", "b"], ["a", "a|n", "n", "n|b", "b"])).toEqual(["a", "a|n", "n", "n|b", "b"]);
    });

    it("在最前面拆分：新项排在最前", () => {
        expect(stableOrder(["a"], ["n", "n|a", "a"])).toEqual(["n", "n|a", "a"]);
    });

    it("关闭：只去掉它", () => {
        expect(stableOrder(["a", "a|b", "b", "b|c", "c"], ["a", "a|c", "c"])).toEqual(["a", "a|c", "c"]);
    });

    it("换位置：已有的保持原来的相对次序，不搬 DOM", () => {
        expect(stableOrder(["a", "a|b", "b"], ["b", "b|a", "a"])).toEqual(["a", "b", "b|a"]);
    });
});

describe("nextFocusStop", () => {
    const focusable = (...indexes: number[]) => (index: number): boolean => indexes.includes(index);

    it("跳过没有可聚焦元素的项", () => {
        expect(nextFocusStop({count: 5, from: 0, direction: 1, wrap: false, focusable: focusable(0, 3)})).toBe(3);
        expect(nextFocusStop({count: 5, from: 4, direction: -1, wrap: false, focusable: focusable(1, 4)})).toBe(1);
    });

    it("不绕回：走到头返回 null", () => {
        expect(nextFocusStop({count: 3, from: 2, direction: 1, wrap: false, focusable: focusable(0, 1, 2)})).toBeNull();
        expect(nextFocusStop({count: 3, from: 0, direction: -1, wrap: false, focusable: focusable(0, 1, 2)})).toBeNull();
    });

    it("绕回：回到另一头；只有自己能停时停在自己；都不能停返回 null", () => {
        expect(nextFocusStop({count: 3, from: 2, direction: 1, wrap: true, focusable: focusable(0, 1, 2)})).toBe(0);
        expect(nextFocusStop({count: 3, from: 1, direction: 1, wrap: true, focusable: focusable(1)})).toBe(1);
        expect(nextFocusStop({count: 3, from: 1, direction: 1, wrap: true, focusable: focusable()})).toBeNull();
    });
});
