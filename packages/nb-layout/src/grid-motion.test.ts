import {describe, expect, it} from "bun:test";

import {createGrid} from "./grid";
import {enteringRects, flyingContents, followingLeaves, grownRect, placementMoved, stableOrder} from "./grid-motion";
import {layerItems, placeContents, placeGrid} from "./grid-rects";
import type {GridNodeInput} from "./grid-types";

/** 渲染序与过渡的起点（docs/specs/ui/nested-grid.md 的“按矩形摆放”“过渡”）。 */

function leaf(id: string, width = 100, height = 100): GridNodeInput<string> {
    return {kind: "leaf", id, ref: id, size: {width, height}};
}

function grid(root: GridNodeInput<string>, sashSize: number, extent: {width: number; height: number}) {
    const instance = createGrid<string>(root, {sashSize});
    return {node: instance.root()!, layout: instance.layout(extent)};
}

const THREE = (): GridNodeInput<string> => ({kind: "branch", id: "root", orientation: "horizontal", children: [leaf("a"), leaf("b"), leaf("c")]});

describe("新出现的项从哪里开始", () => {
    const placeOf = (root: GridNodeInput<string>) => {
        const {node, layout} = grid(root, 4, {width: 1000, height: 300});
        return placeGrid(node, layout, {width: 1000, height: 300}, 1).items;
    };
    const branch = (...children: GridNodeInput<string>[]): GridNodeInput<string> => ({kind: "branch", id: "root", orientation: "horizontal", children});

    it("第一块的起点不动，其余的终点不动：另一条边跟着让位的兄弟走，中间不露空白", () => {
        const items = placeOf(branch(leaf("n"), leaf("a")));
        const [first, , second] = items;
        if (first?.kind !== "leaf" || second?.kind !== "leaf") throw new Error("树序不对");
        expect(first.grow).toEqual({axis: "width", edge: "start"});
        expect(second.grow).toEqual({axis: "width", edge: "end"});
        expect(grownRect(first.rect, first.grow)).toEqual({...first.rect, width: 0});
        expect(grownRect(second.rect, second.grow)).toEqual({...second.rect, x: second.rect.x + second.rect.width, width: 0});
    });

    it("纵向分支按高度长", () => {
        const items = placeOf({kind: "branch", id: "root", orientation: "vertical", children: [leaf("n"), leaf("a")]});
        const second = items[2];
        if (second?.kind !== "leaf") throw new Error("树序不对");
        expect(second.grow).toEqual({axis: "height", edge: "end"});
        expect(grownRect(second.rect, second.grow)).toEqual({...second.rect, y: second.rect.y + second.rect.height, height: 0});
    });

    it("根上的叶没有兄弟，第一帧就是终点", () => {
        const only = placeOf(leaf("only"))[0];
        if (only?.kind !== "leaf") throw new Error("树序不对");
        expect(grownRect(only.rect, only.grow)).toEqual(only.rect);
    });

    it("分隔线从挨着同一个节点的旧分隔线出发", () => {
        const before = placeOf(branch(leaf("a"), leaf("b"), leaf("c")));
        const after = placeOf(branch(leaf("a"), leaf("c")));
        const old = before.find((item) => item.kind === "sash" && item.before === "a");
        const sash = after.find((item) => item.kind === "sash");
        expect(enteringRects(after, before).get(sash?.key ?? "")?.x).toBe(old?.rect.x);
    });

    it("没有旧分隔线可接时从新叶的起点出发：线一开始就在外框的边上", () => {
        const before = placeOf(leaf("a"));
        const after = placeOf(branch(leaf("n"), leaf("a")));
        const entering = enteringRects(after, before);
        const newLeaf = entering.get("leaf:n");
        const sash = after.find((item) => item.kind === "sash");
        expect(newLeaf).toEqual({...after[0]?.rect, width: 0});
        expect(entering.get(sash?.key ?? "")?.x).toBe(0);

        const appended = placeOf(branch(leaf("a"), leaf("n")));
        const appendedSash = appended.find((item) => item.kind === "sash");
        const appendedEntering = enteringRects(appended, before);
        expect(appendedEntering.get(appendedSash?.key ?? "")?.x).toBe(1000 - 4);
    });

    it("已有的项不在里面", () => {
        const items = placeOf(branch(leaf("a"), leaf("b")));
        expect(enteringRects(items, items).size).toBe(0);
    });
});

describe("过渡中内容跟着外框的叶", () => {
    const placeOf = (widths: Record<string, number>) => {
        const children = Object.entries(widths).map(([id, width]) => leaf(id, width));
        const {node, layout} = grid({kind: "branch", id: "root", orientation: "horizontal", children}, 4, {width: 1000, height: 300});
        return placeGrid(node, layout, {width: 1000, height: 300}, 1).items;
    };

    it("前后都有尺寸的跟；新叶不跟：内容一开始就是最终尺寸，外框长出来时露出它", () => {
        expect([...followingLeaves(placeOf({a: 500, b: 200, n: 300}), placeOf({a: 700, b: 300}))]).toEqual(["leaf:a", "leaf:b"]);
    });

    it("离开的叶不在里面", () => {
        expect([...followingLeaves(placeOf({a: 1000}), placeOf({a: 500, b: 500}))]).toEqual(["leaf:a"]);
    });

    it("从零出来、降到零的不跟：前者已是最终尺寸，后者内容停放", () => {
        const open = placeOf({a: 500, b: 500});
        const closed = placeOf({a: 1000, b: 0});
        expect(closed.find((item) => item.key === "leaf:b")?.rect.width).toBe(0);
        expect([...followingLeaves(open, closed)]).toEqual(["leaf:a"]);
        expect([...followingLeaves(closed, open)]).toEqual(["leaf:a"]);
    });
});

describe("placementMoved", () => {
    const items = () => {
        const {node, layout} = grid(THREE(), 1, {width: 302, height: 200});
        return placeGrid(node, layout, {width: 302, height: 200}, 1).items;
    };

    it("完全相同、差不到 1px：没动；差得更多、多了少了：动了", () => {
        const base = items();
        expect(placementMoved(base, base)).toBe(false);
        const shift = (dx: number) => base.map((item) => ({...item, rect: {...item.rect, x: item.rect.x + dx}}));
        expect(placementMoved(shift(1), base)).toBe(false);
        expect(placementMoved(shift(2), base)).toBe(true);
        expect(placementMoved(base.slice(0, 3), base)).toBe(true);
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

describe("内容项的过渡（输出“内容层”）", () => {
    const layers = (widths: Record<string, number>, contents: ReadonlyArray<{key: string; leaf: string; active?: boolean}>) => {
        const children = Object.entries(widths).map(([id, width]) => leaf(id, width));
        const {node, layout} = grid({kind: "branch", id: "root", orientation: "horizontal", children}, 4, {width: 1000, height: 300});
        const items = placeGrid(node, layout, {width: 1000, height: 300}, 1).items;
        return layerItems(items, placeContents(items, contents.map((content) => ({insetTop: 32, active: true, ...content})), 1));
    };

    it("标签并入已有面板，两块叶都不动：内容换了矩形也算动，这个内容在飞、也跟外框", () => {
        const before = layers({a: 500, b: 500}, [{key: "x", leaf: "a"}, {key: "y", leaf: "b"}]);
        const after = layers({a: 500, b: 500}, [{key: "x", leaf: "b"}, {key: "y", leaf: "b", active: false}]);
        expect(placementMoved(after, before)).toBe(true);
        expect(flyingContents(after, before).has("content:x")).toBe(true);
        expect(flyingContents(after, before).has("leaf:a")).toBe(false);
        expect(followingLeaves(after, before).has("content:x")).toBe(true);
    });

    it("切标签：不是布局变化", () => {
        const before = layers({a: 500, b: 500}, [{key: "x", leaf: "a"}, {key: "y", leaf: "a", active: false}]);
        const after = layers({a: 500, b: 500}, [{key: "x", leaf: "a", active: false}, {key: "y", leaf: "a"}]);
        expect(placementMoved(after, before)).toBe(false);
        expect([...flyingContents(after, before)]).toEqual([]);
    });

    it("开新标签：不是布局变化，也不从边上长出来", () => {
        const before = layers({a: 500, b: 500}, [{key: "x", leaf: "a"}]);
        const after = layers({a: 500, b: 500}, [{key: "x", leaf: "a", active: false}, {key: "y", leaf: "a"}]);
        expect(placementMoved(after, before)).toBe(false);
        expect(enteringRects(after, before).has("content:y")).toBe(false);
    });

    it("新内容跟新叶从边上长出来，面板头的高度留给外框；不跟外框，内容是最终尺寸", () => {
        const before = layers({a: 1000}, [{key: "x", leaf: "a"}]);
        const after = layers({a: 500, n: 500}, [{key: "x", leaf: "a"}, {key: "y", leaf: "n"}]);
        const entering = enteringRects(after, before).get("content:y");
        expect(entering?.width).toBe(0);
        expect(entering?.y).toBe(32);
        expect(followingLeaves(after, before).has("content:y")).toBe(false);
        expect(followingLeaves(after, before).has("content:x")).toBe(true);
    });

    it("换了叶的内容不算新项：它有上一帧，从旧矩形飞过来", () => {
        const before = layers({a: 500, b: 500}, [{key: "x", leaf: "a"}]);
        const after = layers({a: 250, b: 250, n: 500}, [{key: "x", leaf: "n"}]);
        expect(enteringRects(after, before).has("content:x")).toBe(false);
        expect(flyingContents(after, before).has("content:x")).toBe(true);
    });

    it("整块面板移到别处：叶没换，但叶和内容都飞过别的面板；原地变宽的不算", () => {
        const before = layers({a: 300, b: 300, c: 400}, [{key: "x", leaf: "a"}, {key: "y", leaf: "c"}]);
        const after = layers({b: 300, c: 400, a: 300}, [{key: "x", leaf: "a"}, {key: "y", leaf: "c"}]);
        const flying = flyingContents(after, before);
        expect(flying.has("leaf:a")).toBe(true);
        expect(flying.has("content:x")).toBe(true);
        const wider = layers({a: 500, b: 100, c: 400}, [{key: "x", leaf: "a"}]);
        expect(flyingContents(wider, layers({a: 300, b: 300, c: 400}, [{key: "x", leaf: "a"}])).size).toBe(0);
    });

    it("不活动的内容跟着叶变矩形，不算动，不跟外框逐帧排版", () => {
        const before = layers({a: 500, b: 500}, [{key: "x", leaf: "a", active: false}]);
        const after = layers({a: 500, b: 500}, [{key: "x", leaf: "b", active: false}]);
        expect(placementMoved(after, before)).toBe(false);
        expect(followingLeaves(after, before).has("content:x")).toBe(false);
    });
});
