import {describe, expect, it} from "bun:test";

import {createGrid} from "./grid";
import {enteringRects, floatLiftStarts, flyingContents, followingLeaves, grownRect, keptSizeStarts, leavingContents, leavingPlacements, placementMoved, releaseStarts, rightAnchored, settleFloatMoves, stableOrder} from "./grid-motion";
import {floatPlacements, layerItems, placeContents, placeGrid} from "./grid-rects";
import type {GridLayerItem} from "./grid-rects";
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

    const column = (...children: GridNodeInput<string>[]): GridNodeInput<string> => ({kind: "branch", id: "col", orientation: "vertical", children});
    const leafRect = (items: ReturnType<typeof placeOf>, id: string) => {
        const found = items.find((item) => item.kind === "leaf" && item.node.id === id);
        if (found === undefined) throw new Error(`没有叶 ${id}`);
        return found.rect;
    };

    it("整列一起出现（区域展开）：列里的几节与分隔线作为一块，从上一帧两个兄弟之间的缝横着长出来，一开始就是全高", () => {
        const before = placeOf(branch(leaf("a"), leaf("c")));
        const after = placeOf(branch(leaf("a"), column(leaf("b1"), leaf("b2")), leaf("c")));
        const seam = before.find((item) => item.kind === "sash");
        if (seam?.kind !== "sash") throw new Error("没有缝");
        const at = seam.rect.x + seam.size;
        const entering = enteringRects(after, before);
        for (const id of ["b1", "b2"]) expect(entering.get(`leaf:${id}`)).toEqual({...leafRect(after, id), x: at, width: 0});
        const inner = after.find((item) => item.kind === "sash" && item.branch.id === "col");
        if (inner === undefined) throw new Error("列里没有分隔线");
        expect(entering.get(inner.key)).toEqual({...inner.rect, x: at, width: 0});
    });

    it("列上一帧就在（切换侧栏的容器）：换上来的几节各自在列里竖着长", () => {
        const before = placeOf(branch(leaf("a"), column(leaf("x1"), leaf("x2")), leaf("c")));
        const after = placeOf(branch(leaf("a"), column(leaf("b1"), leaf("b2")), leaf("c")));
        const entering = enteringRects(after, before);
        expect(entering.get("leaf:b1")).toEqual({...leafRect(after, "b1"), height: 0});
        const b2 = leafRect(after, "b2");
        expect(entering.get("leaf:b2")).toEqual({...b2, y: b2.y + b2.height, height: 0});
    });

    it("一节换成一列（切换侧栏的容器）：新列顶替了原来的位置，不是新开的缝；换上来的几节各自在列里竖着长", () => {
        const before = placeOf(branch(leaf("a"), leaf("x"), leaf("c")));
        const after = placeOf(branch(leaf("a"), column(leaf("b1"), leaf("b2")), leaf("c")));
        const entering = enteringRects(after, before);
        expect(entering.get("leaf:b1")).toEqual({...leafRect(after, "b1"), height: 0});
        const b2 = leafRect(after, "b2");
        expect(entering.get("leaf:b2")).toEqual({...b2, y: b2.y + b2.height, height: 0});
    });

    it("底部面板出现（编辑区被包进新建的纵向分支，后面还有右栏）：面板作为一块从底边竖着长，里面并排的几节一开始就是终点宽度，不各自横着长", () => {
        const center = (...children: GridNodeInput<string>[]): GridNodeInput<string> => ({kind: "branch", id: "center", orientation: "vertical", size: {width: 600, height: 300}, children});
        const panel = (...children: GridNodeInput<string>[]): GridNodeInput<string> => ({kind: "branch", id: "panel", orientation: "horizontal", size: {width: 600, height: 100}, children});
        const before = placeOf(branch(leaf("a", 200), leaf("e", 600), leaf("r", 192)));
        const after = placeOf(branch(leaf("a", 200), center(leaf("e", 600, 196), panel(leaf("p1", 300), leaf("p2", 296))), leaf("r", 192)));
        const entering = enteringRects(after, before);
        const bottom = Math.max(...["p1", "p2"].map((id) => leafRect(after, id).y + leafRect(after, id).height));
        for (const id of ["p1", "p2"]) expect(entering.get(`leaf:${id}`)).toEqual({...leafRect(after, id), y: bottom, height: 0});
    });

    it("拆分时包住旧叶的新分支不算新子树：新叶从旧叶那边长出来", () => {
        const before = placeOf(branch(leaf("a"), leaf("b")));
        const after = placeOf(branch(leaf("a"), column(leaf("b"), leaf("d"))));
        const d = leafRect(after, "d");
        expect(enteringRects(after, before).get("leaf:d")).toEqual({...d, y: d.y + d.height, height: 0});
    });
});

describe("离开的叶留着缩回去（ui/nested-grid 输出 44 到 48）", () => {
    const branch = (...children: GridNodeInput<string>[]): GridNodeInput<string> => ({kind: "branch", id: "root", orientation: "horizontal", children});
    const column = (...children: GridNodeInput<string>[]): GridNodeInput<string> => ({kind: "branch", id: "col", orientation: "vertical", children});
    /** 摆好的叶、分隔线，加上 `mounted` 里每块叶一个内容项（叶不在这一帧里时它停放着）。 */
    const frameOf = (root: GridNodeInput<string>, mounted: string[]): GridLayerItem<string>[] => {
        const {node, layout} = grid(root, 4, {width: 1000, height: 300});
        const items = placeGrid(node, layout, {width: 1000, height: 300}, 1).items;
        return layerItems(items, placeContents(items, mounted.map((id) => ({key: id, leaf: id, insetTop: 0, active: true})), 1));
    };
    const leafRect = (items: GridLayerItem<string>[], id: string) => {
        const found = items.find((item) => item.kind === "leaf" && item.node.id === id);
        if (found?.kind !== "leaf") throw new Error(`没有叶 ${id}`);
        return found.rect;
    };
    const ALL = ["a", "b1", "b2", "c", "x", "x1", "x2"];

    it("整列离开（区域隐藏）：列里的几节作为一块留着，缩回这一帧两个兄弟相接的那道缝，一直是全高", () => {
        const before = frameOf(branch(leaf("a"), column(leaf("b1"), leaf("b2")), leaf("c")), ALL);
        const after = frameOf(branch(leaf("a"), leaf("c")), ALL);
        const seam = after.find((item) => item.kind === "sash");
        if (seam?.kind !== "sash") throw new Error("没有缝");
        const leaving = leavingPlacements(after, before, false);
        expect(leaving.map((item) => item.node.id)).toEqual(["b1", "b2"]);
        for (const item of leaving) {
            expect(item.leaving).toBe(true);
            expect(item.rect).toEqual({...leafRect(before, item.node.id), x: seam.rect.x + seam.size, width: 0});
        }
    });

    it("在分支一头、挨着的兄弟这一帧到了头：缩向那一头", () => {
        const before = frameOf(branch(leaf("a"), leaf("b1"), leaf("c")), ALL);
        const after = frameOf(branch(leaf("a"), leaf("b1")), ALL);
        const c = leafRect(before, "c");
        expect(leavingPlacements(after, before, false).map((item) => item.rect)).toEqual([{...c, x: c.x + c.width, width: 0}]);
    });

    it("底部面板隐藏（纵向分支只剩编辑区、被摊进横向那一行，编辑区后面还有右栏）：面板作为一块留着，缩向底边；起点是上一帧的矩形", () => {
        const center = (...children: GridNodeInput<string>[]): GridNodeInput<string> => ({kind: "branch", id: "center", orientation: "vertical", size: {width: 600, height: 300}, children});
        const panel = (...children: GridNodeInput<string>[]): GridNodeInput<string> => ({kind: "branch", id: "panel", orientation: "horizontal", size: {width: 600, height: 100}, children});
        const mounted = ["a", "e", "r", "p1", "p2"];
        const shown = frameOf(branch(leaf("a", 200), center(leaf("e", 600, 196), panel(leaf("p1", 300), leaf("p2", 296))), leaf("r", 192)), mounted);
        const hidden = frameOf(branch(leaf("a", 200), leaf("e", 600), leaf("r", 192)), mounted);
        const leaving = leavingPlacements(hidden, shown, false);
        expect(leaving.map((item) => item.node.id)).toEqual(["p1", "p2"]);
        for (const item of leaving) {
            const old = leafRect(shown, item.node.id);
            expect(item.rect).toEqual({...old, y: old.y + old.height, height: 0});
        }
        const entering = enteringRects(hidden, shown);
        const following = followingLeaves(hidden, shown);
        const kept = keptSizeStarts({items: hidden, previous: shown, entering, following, leaving});
        for (const id of ["p1", "p2"]) expect(kept.get(`leaf:${id}`)).toEqual(leafRect(shown, id));
    });

    it("内容卸了（关掉，不是隐藏）：照旧立即消失", () => {
        const before = frameOf(branch(leaf("a"), column(leaf("b1"), leaf("b2")), leaf("c")), ALL);
        expect(leavingPlacements(frameOf(branch(leaf("a"), leaf("c")), ["a", "c"]), before, false)).toEqual([]);
    });

    it("兄弟没合拢（切换容器：列还在、几节全换了；一节换成一列）：照旧立即消失，不和长出来的叠在一起", () => {
        const before = frameOf(branch(leaf("a"), column(leaf("b1"), leaf("b2")), leaf("c")), ALL);
        expect(leavingPlacements(frameOf(branch(leaf("a"), column(leaf("x1"), leaf("x2")), leaf("c")), ALL), before, false)).toEqual([]);
        const single = frameOf(branch(leaf("a"), leaf("x"), leaf("c")), ALL);
        expect(leavingPlacements(frameOf(branch(leaf("a"), column(leaf("b1"), leaf("b2")), leaf("c")), ALL), single, false)).toEqual([]);
    });

    it("拿起内容拖动中：一个都不留", () => {
        const before = frameOf(branch(leaf("a"), column(leaf("b1"), leaf("b2")), leaf("c")), ALL);
        expect(leavingPlacements(frameOf(branch(leaf("a"), leaf("c")), ALL), before, true)).toEqual([]);
    });
});

describe("离开的内容由库留到过渡结束（ui/nested-grid 输出 45、155）", () => {
    /** 一行叶，每个内容项默认挂在同名的叶上；`retain` 是宿主给了 `leave: "retain"`。 */
    type ContentSpec = {readonly id: string; readonly leaf?: string; readonly retain?: boolean; readonly active?: boolean};
    const frameOf = (ids: string[], contents: ContentSpec[]): GridLayerItem<string>[] => {
        const {node, layout} = grid({kind: "branch", id: "root", orientation: "horizontal", children: ids.map((id) => leaf(id))}, 4, {width: 1000, height: 300});
        const items = placeGrid(node, layout, {width: 1000, height: 300}, 1).items;
        const inputs = contents.map((content) => ({key: content.id, leaf: content.leaf ?? content.id, insetTop: 0, active: content.active ?? true, ...(content.retain === true ? {leave: "retain" as const} : {})}));
        return layerItems(items, placeContents(items, inputs, 1));
    };
    const closedB = (): GridLayerItem<string>[] => frameOf(["a", "c"], [{id: "a"}, {id: "c"}]);

    it("叶与标了留住的活动内容同一轮被删：叶留着缩回；没标的、不活动的照旧立即消失", () => {
        expect(leavingPlacements(closedB(), frameOf(["a", "b", "c"], [{id: "a"}, {id: "b", retain: true}, {id: "c"}]), false).map((item) => item.node.id)).toEqual(["b"]);
        expect(leavingPlacements(closedB(), frameOf(["a", "b", "c"], [{id: "a"}, {id: "b"}, {id: "c"}]), false)).toEqual([]);
        expect(leavingPlacements(closedB(), frameOf(["a", "b", "c"], [{id: "a"}, {id: "b", retain: true, active: false}, {id: "c"}]), false)).toEqual([]);
    });

    it("要留的内容项：叶在缩回去才留，带 leaving；叶不动、宿主还给着同一个 key、不活动、拖动中都不留", () => {
        const before = frameOf(["a", "b", "c"], [{id: "a"}, {id: "b", retain: true}, {id: "c"}]);
        expect(leavingContents(closedB(), before, new Set(["b"]), false).map((item) => [item.key, item.leaving])).toEqual([["content:b", true]]);
        expect(leavingContents(closedB(), before, new Set(), false)).toEqual([]);
        expect(leavingContents(frameOf(["a", "c"], [{id: "a"}, {id: "c"}, {id: "b", leaf: "c"}]), before, new Set(["b"]), false)).toEqual([]);
        expect(leavingContents(closedB(), frameOf(["a", "b", "c"], [{id: "a"}, {id: "b", retain: true, active: false}, {id: "c"}]), new Set(["b"]), false)).toEqual([]);
        expect(leavingContents(closedB(), before, new Set(["b"]), true)).toEqual([]);
    });
});

describe("过渡中内容贴着外框的右边（ui/nested-grid 输出 39）", () => {
    const branch = (...children: GridNodeInput<string>[]): GridNodeInput<string> => ({kind: "branch", id: "root", orientation: "horizontal", children});
    const column = (...children: GridNodeInput<string>[]): GridNodeInput<string> => ({kind: "branch", id: "col", orientation: "vertical", size: {width: 300, height: 300}, children});
    const frameOf = (root: GridNodeInput<string>): GridLayerItem<string>[] => {
        const {node, layout} = grid(root, 4, {width: 1000, height: 300});
        const items = placeGrid(node, layout, {width: 1000, height: 300}, 1).items;
        return layerItems(items, placeContents(items, ["b1", "b2", "e", "r"].map((id) => ({key: id, leaf: id, insetTop: 32, active: true})), 1));
    };
    /** 同 `decideMotion` 的组合。 */
    const anchorsOf = (after: GridLayerItem<string>[], before: GridLayerItem<string>[]) => {
        const entering = enteringRects(after, before);
        const following = followingLeaves(after, before);
        const flying = flyingContents(after, before);
        const leaving = leavingPlacements(after, before, false);
        const starts = keptSizeStarts({items: after, previous: before, entering, following, leaving});
        return rightAnchored({items: after, leaving, starts, following, flying});
    };
    const SIDE = ["leaf:b1", "leaf:b2", "content:b1", "content:b2"];

    it("在分支起点一头展开、缩回那一头（侧栏）：外框只有右边在动，列里的叶与内容都贴右边，整块平移进出；被推开的兄弟跟外框，不贴", () => {
        const hidden = frameOf(branch(leaf("e", 700), leaf("r", 296)));
        const shown = frameOf(branch(column(leaf("b1"), leaf("b2")), leaf("e", 396), leaf("r", 296)));
        expect([...anchorsOf(shown, hidden)].sort()).toEqual([...SIDE].sort());
        expect([...anchorsOf(hidden, shown)].sort()).toEqual([...SIDE].sort());
    });

    it("在分支终点一头长出来、缩回那一头（右栏）：近的那条边在动，贴起点本来就跟着它走，不记", () => {
        const hidden = frameOf(branch(leaf("b1"), leaf("e")));
        const shown = frameOf(branch(leaf("b1"), leaf("e"), leaf("r")));
        expect([...anchorsOf(shown, hidden)]).toEqual([]);
        expect([...anchorsOf(hidden, shown)]).toEqual([]);
    });

    it("纵向不贴：从上边长出来时内容的裁切框上边比叶低一个面板头，贴下边会在面板头下面露出一条空白", () => {
        const stack = (...children: GridNodeInput<string>[]): GridNodeInput<string> => ({kind: "branch", id: "root", orientation: "vertical", children});
        const below = frameOf(stack(leaf("e", 1000, 300)));
        const split = frameOf(stack(leaf("b1", 1000, 100), leaf("e", 1000, 196)));
        expect(enteringRects(split, below).get("leaf:b1")).toMatchObject({y: 0, height: 0});
        expect([...anchorsOf(split, below)]).toEqual([]);
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

describe("内容项的过渡（ui/nested-grid 输出 81、85、86、92）", () => {
    const layers = (widths: Record<string, number>, contents: ReadonlyArray<{key: string; leaf: string; active?: boolean; insetTop?: number}>) => {
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

    it("只有 inset 变了（头高了一行）：不是布局变化，内容立刻让开；同时叶也变了照常算", () => {
        const at = (widths: Record<string, number>, insetTop: number) => layers(widths, [{key: "x", leaf: "a", insetTop}]);
        expect(placementMoved(at({a: 500, b: 500}, 68), at({a: 500, b: 500}, 34))).toBe(false);
        expect(placementMoved(at({a: 400, b: 600}, 68), at({a: 500, b: 500}, 34))).toBe(true);
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

    /** 同 `decideMotion` 的组合。 */
    const keptOf = (after: GridLayerItem<unknown>[], before: GridLayerItem<unknown>[]) => {
        const entering = enteringRects(after, before);
        const following = followingLeaves(after, before);
        return {entering, following, kept: keptSizeStarts({items: after, previous: before, entering, following, leaving: leavingPlacements(after, before, false)})};
    };

    it("新叶的内容不跟外框、是最终尺寸，按叶的矩形摆：第一帧就是叶的起点，跟着外框从边上长出来", () => {
        const before = layers({a: 1000}, [{key: "x", leaf: "a"}]);
        const after = layers({a: 500, n: 500}, [{key: "x", leaf: "a"}, {key: "y", leaf: "n"}]);
        const {entering, following, kept} = keptOf(after, before);
        expect(kept.get("leaf:n")).toEqual(entering.get("leaf:n"));
        expect(kept.get("leaf:n")?.width).toBe(0);
        expect(kept.has("leaf:a")).toBe(false);
        expect(following.has("content:y")).toBe(false);
        expect(following.has("content:x")).toBe(true);
    });

    it("停放过的内容随它刚长出来的叶一起长（切回容器、区域展开）：它早就挂着，不跟的话一显示就整块在终点，外框还在长", () => {
        // 叶 n 不在上一帧的呈现里，它的内容 y 停放着（没有矩形）。
        const before = layers({a: 1000}, [{key: "x", leaf: "a"}, {key: "y", leaf: "n"}]);
        const after = layers({a: 500, n: 500}, [{key: "x", leaf: "a"}, {key: "y", leaf: "n"}]);
        const {kept, following} = keptOf(after, before);
        expect(kept.get("leaf:n")?.width).toBe(0);
        expect(following.has("content:y")).toBe(false);
        // 叶没有新长出来（同一块叶里切标签）就不从边上长。
        const tabs = layers({a: 500, b: 500}, [{key: "x", leaf: "a"}, {key: "y", leaf: "a", active: false}]);
        const switched = layers({a: 500, b: 500}, [{key: "x", leaf: "a", active: false}, {key: "y", leaf: "a"}]);
        expect(keptOf(switched, tabs).kept.size).toBe(0);
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

    it("从零展开的不算飞：它不是在飞过别的面板", () => {
        const before = layers({a: 0, b: 1000}, [{key: "x", leaf: "a"}]);
        const after = layers({a: 500, b: 500}, [{key: "x", leaf: "a"}]);
        expect(flyingContents(after, before).has("leaf:a")).toBe(false);
        expect(flyingContents(after, before).has("content:x")).toBe(false);
    });

    it("不活动的内容跟着叶变矩形，不算动，不跟外框逐帧排版", () => {
        const before = layers({a: 500, b: 500}, [{key: "x", leaf: "a", active: false}]);
        const after = layers({a: 500, b: 500}, [{key: "x", leaf: "b", active: false}]);
        expect(placementMoved(after, before)).toBe(false);
        expect(followingLeaves(after, before).has("content:x")).toBe(false);
    });
});

describe("只有浮动窗的矩形变了", () => {
    const rect = (x: number) => ({x, y: 0, width: 100, height: 100});
    const windowAt = (x: number, id = "f"): GridLayerItem<unknown>[] => [
        ...(floatPlacements([{id, rect: rect(x)}]) as GridLayerItem<unknown>[]),
        {kind: "content", key: "content:v", contentKey: "v", leaf: id, insetTop: 0, active: true, rect: rect(x), leafRect: rect(x)},
    ];

    it("同一块窗和它里面的内容按上一次的矩形算：判定认不出变化", () => {
        const before = windowAt(0);
        const settled = settleFloatMoves(windowAt(500), before);
        expect(placementMoved(settled, before)).toBe(false);
        expect(placementMoved(windowAt(500), before)).toBe(true);
    });

    it("窗出现、内容换了窗：照常是变化", () => {
        const before: GridLayerItem<unknown>[] = [];
        expect(placementMoved(settleFloatMoves(windowAt(0), before), before)).toBe(true);
        const swapped = windowAt(500, "g");
        const settled = settleFloatMoves(swapped, windowAt(0));
        expect(settled.find((item) => item.kind === "content")?.rect).toEqual(rect(500));
    });

    const rectAt = (list: ReadonlyArray<GridLayerItem<unknown>>, key: string) => list.find((item) => item.key === key)?.rect;

    it("宿主标了 animate 的窗（集合里的）不压：矩形变了算布局变化，它的内容按这一次的矩形；不在集合里的窗照旧压", () => {
        const before = [...windowAt(0), ...windowAt(0, "g").map((item) => (item.kind === "content" ? {...item, key: "content:w", contentKey: "w"} : item))];
        const after = [...windowAt(500), ...windowAt(300, "g").map((item) => (item.kind === "content" ? {...item, key: "content:w", contentKey: "w"} : item))];
        const settled = settleFloatMoves(after, before, new Set(["f"]));
        expect(placementMoved(settled, before)).toBe(true);
        expect(rectAt(settled, "leaf:f")).toEqual(rect(500));
        expect(rectAt(settled, "content:v")).toEqual(rect(500));
        // g 没标：压回上一帧，只有它变时认不出变化。
        expect(rectAt(settled, "leaf:g")).toEqual(rect(0));
        expect(rectAt(settled, "content:w")).toEqual(rect(0));
        expect(placementMoved(settleFloatMoves(after, before, new Set(["x"])), before)).toBe(false);
    });
});

describe("松手的起点（ui/nested-grid 输出 172）", () => {
    const WINDOW = {x: 300, y: 40, width: 400, height: 200};
    const OFFSET = {x: -260, y: 30};
    /** 一行叶，加上 `windows` 里的浮动窗（都在 `WINDOW`），内容项面板头 32。 */
    const scene = (widths: Record<string, number>, contents: ReadonlyArray<{key: string; leaf: string; active?: boolean}>, windows: ReadonlyArray<string> = []) => {
        const children = Object.entries(widths).map(([id, width]) => leaf(id, width));
        const {node, layout} = grid({kind: "branch", id: "root", orientation: "horizontal", children}, 4, {width: 1000, height: 300});
        const items = [...placeGrid(node, layout, {width: 1000, height: 300}, 1).items, ...floatPlacements(windows.map((id) => ({id, rect: WINDOW})))];
        return layerItems(items, placeContents(items, contents.map((content) => ({insetTop: 32, active: true, ...content})), 1));
    };
    const shifted = (rect: {x: number; y: number; width: number; height: number}) => ({...rect, x: rect.x + OFFSET.x, y: rect.y + OFFSET.y});
    const released = new Map([["f", OFFSET]]);

    it("松手进树（叶不换）：外框与它的活动内容从上一帧的矩形加偏移出发，不活动的内容与别的叶不给", () => {
        const before = scene({a: 1000}, [{key: "x", leaf: "f"}, {key: "z", leaf: "f", active: false}, {key: "y", leaf: "a"}], ["f"]);
        const after = scene({f: 300, a: 700}, [{key: "x", leaf: "f"}, {key: "z", leaf: "f", active: false}, {key: "y", leaf: "a"}]);
        const starts = releaseStarts(after, before, released);
        expect(starts.get("leaf:f")).toEqual(shifted(WINDOW));
        expect(starts.get("content:x")).toEqual(shifted({...WINDOW, y: WINDOW.y + 32, height: WINDOW.height - 32}));
        expect([...starts.keys()].sort()).toEqual(["content:x", "leaf:f"]);
    });

    it("松手并进别的叶（窗没了，内容换了叶）：内容从松手处出发", () => {
        const before = scene({a: 1000}, [{key: "x", leaf: "f"}, {key: "y", leaf: "a"}], ["f"]);
        const after = scene({a: 1000}, [{key: "x", leaf: "a", active: true}, {key: "y", leaf: "a", active: false}]);
        const starts = releaseStarts(after, before, released);
        expect(starts.get("content:x")).toEqual(shifted({...WINDOW, y: WINDOW.y + 32, height: WINDOW.height - 32}));
    });

    it("不给：这一次还是浮动窗（移动的提交，窗停在拖到的位置）；偏移为零；上一帧它不是浮动窗；没有放开的窗", () => {
        const before = scene({a: 1000}, [{key: "x", leaf: "f"}], ["f"]);
        const moved = scene({a: 1000}, [{key: "x", leaf: "f"}], ["f"]).map((item) => (item.kind === "leaf" && item.node.id === "f" ? {...item, rect: shifted(WINDOW)} : item));
        expect(releaseStarts(moved, before, released).size).toBe(0);
        const docked = scene({f: 300, a: 700}, [{key: "x", leaf: "f"}]);
        expect(releaseStarts(docked, before, new Map([["f", {x: 0, y: 0}]])).size).toBe(0);
        const tiled = scene({f: 300, a: 700}, [{key: "x", leaf: "f"}]);
        expect(releaseStarts(scene({f: 500, a: 500}, [{key: "x", leaf: "f"}]), tiled, released).size).toBe(0);
        expect(releaseStarts(docked, before, new Map()).size).toBe(0);
    });
});

describe("新开的浮动窗从内容原来的叶出发（ui/nested-grid 输出 107、108）", () => {
    const WINDOW = {x: 300, y: 40, width: 400, height: 200};
    /** 一行叶，加上 `windows` 里的浮动窗（都在 `WINDOW`），内容项面板头 32。 */
    const scene = (widths: Record<string, number>, contents: ReadonlyArray<{key: string; leaf: string; active?: boolean; insetTop?: number}>, windows: ReadonlyArray<string> = []) => {
        const children = Object.entries(widths).map(([id, width]) => leaf(id, width));
        const {node, layout} = grid({kind: "branch", id: "root", orientation: "horizontal", children}, 4, {width: 1000, height: 300});
        const items = [...placeGrid(node, layout, {width: 1000, height: 300}, 1).items, ...floatPlacements(windows.map((id) => ({id, rect: WINDOW})))];
        return layerItems(items, placeContents(items, contents.map((content) => ({insetTop: 32, active: true, ...content})), 1));
    };
    const rectOfLeaf = (items: ReadonlyArray<GridLayerItem<unknown>>, id: string) => items.find((item): item is Extract<GridLayerItem<unknown>, {kind: "leaf"}> => item.kind === "leaf" && item.node.id === id)?.rect;

    it("视图浮出来、原来那一节没了：窗的起点是那一节上一帧的矩形，整张卡片从原处拿起来；按新叶的规则它没有兄弟，第一帧就在终点", () => {
        const before = scene({a: 500, b: 500}, [{key: "x", leaf: "a"}, {key: "y", leaf: "b"}]);
        const after = scene({b: 1000}, [{key: "x", leaf: "f"}, {key: "y", leaf: "b"}], ["f"]);
        expect(floatLiftStarts(after, before).get("leaf:f")).toEqual(rectOfLeaf(before, "a"));
        expect(enteringRects(after, before).get("leaf:f")).toEqual(WINDOW);
    });

    it("多标签的面板里浮出一个、来源还在：同样从来源的矩形出发", () => {
        const before = scene({a: 500, b: 500}, [{key: "x", leaf: "a"}, {key: "z", leaf: "a", active: false}]);
        const after = scene({a: 500, b: 500}, [{key: "x", leaf: "f"}, {key: "z", leaf: "a"}], ["f"]);
        expect(floatLiftStarts(after, before).get("leaf:f")).toEqual(rectOfLeaf(before, "a"));
    });

    it("窗回到树里（叶不换），盖在它要回去的位置上：新旧矩形相交，叶和内容照样压在上面飞，它是从别的面板上面落下来的", () => {
        const before = scene({a: 1000}, [{key: "x", leaf: "f"}], ["f"]);
        const after = scene({a: 300, f: 700}, [{key: "x", leaf: "f"}]);
        const flying = flyingContents(after, before);
        expect(flying.has("leaf:f")).toBe(true);
        expect(flying.has("content:x")).toBe(true);
        expect(flying.has("leaf:a")).toBe(false);
    });

    it("不算：窗上一帧就在（并进已有的窗）；新叶不是窗（拆分出来的）；内容上一帧不活动、没有尺寸（收成标题行）", () => {
        const into = scene({a: 500, b: 500}, [{key: "x", leaf: "a"}, {key: "y", leaf: "f"}], ["f"]);
        expect(floatLiftStarts(scene({b: 1000}, [{key: "x", leaf: "f"}, {key: "y", leaf: "f", active: false}], ["f"]), into).size).toBe(0);
        const split = scene({a: 500, b: 250, n: 250}, [{key: "x", leaf: "n"}]);
        expect(floatLiftStarts(split, scene({a: 500, b: 500}, [{key: "x", leaf: "a"}])).size).toBe(0);
        const hidden = scene({a: 500, b: 500}, [{key: "x", leaf: "a", active: false}, {key: "z", leaf: "a"}]);
        expect(floatLiftStarts(scene({a: 500, b: 500}, [{key: "x", leaf: "f"}, {key: "z", leaf: "a"}], ["f"]), hidden).size).toBe(0);
        // 收成标题行：叶还有一个面板头高，内容是零。
        const titleOnly = scene({a: 500, b: 500}, [{key: "x", leaf: "a", insetTop: 300}]);
        expect(floatLiftStarts(scene({b: 1000}, [{key: "x", leaf: "f"}], ["f"]), titleOnly).size).toBe(0);
    });
});
