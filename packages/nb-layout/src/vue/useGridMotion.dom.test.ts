import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {defineComponent, ref} from "vue";

import {createGrid} from "../grid";
import {floatPlacements, layerItems, placeContents, placeGrid} from "../grid-rects";
import type {GridContentPlacement, GridLayerItem, GridPlacementItem} from "../grid-rects";
import type {GridNodeInput} from "../grid-types";
import {EMPTY_GRID_MOTION_MEMORY, decideMotion, useGridMotion} from "./useGridMotion";
import type {GridMotionFrame, GridMotionMemory} from "./useGridMotion";

/**
 * 要不要过渡（docs/specs/ui/nested-grid.md 输出 35）：判定是纯函数，不碰布局，表驱动测。真实布局里的过渡、内容跟不跟外框
 * 在 e2e/lab-grid-structure.e2e.ts。
 */

const leaf = (id: string, width: number): GridNodeInput<string> => ({kind: "leaf", id, ref: id, size: {width, height: 0}});

function items(widths: number[], extent = {width: 700, height: 300}): GridPlacementItem<unknown>[] {
    const root: GridNodeInput<string> = {kind: "branch", id: "root", orientation: "horizontal", children: widths.map((width, index) => leaf(`l${index}`, width))};
    const grid = createGrid<string>(root, {sashSize: 1});
    return [...placeGrid(grid.root()!, grid.layout(extent), extent, 1).items];
}

const EXTENT = {width: 700, height: 300};

/** 指定 id 的一行叶（宽度按给的分）。 */
function row(entries: Array<[string, number]>): GridPlacementItem<unknown>[] {
    const root: GridNodeInput<string> = {kind: "branch", id: "root", orientation: "horizontal", children: entries.map(([id, width]) => leaf(id, width))};
    const grid = createGrid<string>(root, {sashSize: 1});
    return [...placeGrid(grid.root()!, grid.layout(EXTENT), EXTENT, 1).items];
}

function frame(over: Partial<GridMotionFrame> & Pick<GridMotionFrame, "items">): GridMotionFrame {
    return {previous: null, rootSize: EXTENT, extent: EXTENT, dpr: 1, previewing: false, ...over};
}

/** 先喂一次第一帧，让记忆里有真实布局。 */
function warmed(): {memory: GridMotionMemory; base: GridPlacementItem<unknown>[]} {
    const memory = EMPTY_GRID_MOTION_MEMORY();
    const base = items([300, 200, 200]);
    expect(decideMotion(frame({items: base}), memory).kind).toBe("none");
    return {memory, base};
}

describe("decideMotion", () => {
    it("留着缩回去的叶加上、摘掉都不算布局变化：不然摘掉时又判成离开，停不下来", () => {
        const {memory} = warmed();
        const settled = items([350, 350]);
        const gone = items([300, 200, 200]).find((item) => item.kind === "leaf" && item.node.id === "l2");
        if (gone?.kind !== "leaf") throw new Error("没有叶 l2");
        const held = [...settled, {...gone, rect: {...gone.rect, width: 0}, leaving: true as const}];
        expect(decideMotion(frame({items: held, previous: settled}), memory).kind).toBe("none");
        expect(decideMotion(frame({items: settled, previous: held}), memory).kind).toBe("none");
    });

    it("留着缩回去的叶，过渡中又来一次别的变化：接着留着缩完，不是缩到一半就没了；又回到树里的不再留", () => {
        const {memory} = warmed();
        const gone = items([300, 200, 200]).find((item) => item.kind === "leaf" && item.node.id === "l2");
        if (gone?.kind !== "leaf") throw new Error("没有叶 l2");
        const held = {...gone, rect: {...gone.rect, width: 0}, leaving: true as const};
        const hidden = items([350, 350]);
        // 别的两块又变了一次（例如接着隐藏另一个区域），l2 还在缩。
        const moved = items([250, 450]);
        const again = decideMotion(frame({items: [...moved, held], previous: [...hidden, held]}), memory);
        expect(again.kind === "move" ? again.leaving.map((item) => item.key) : again.kind).toEqual(["leaf:l2"]);
        // 又显示回来：树里有 l2 了。
        const shown = decideMotion(frame({items: [...items([300, 200, 200]), held], previous: [...moved, held]}), memory);
        expect(shown.kind === "move" ? shown.leaving : shown.kind).toEqual([]);
    });

    it("第一次有真实布局：不过渡", () => {
        const memory = EMPTY_GRID_MOTION_MEMORY();
        expect(decideMotion(frame({items: items([300, 200, 200]), previous: items([0, 0, 0])}), memory).kind).toBe("none");
    });

    it("程序改了尺寸：过渡；矩形没变：什么都不做", () => {
        const {memory, base} = warmed();
        expect(decideMotion(frame({items: base, previous: base}), memory).kind).toBe("none");
        expect(decideMotion(frame({items: items([400, 100, 200]), previous: base}), memory).kind).toBe("move");
    });

    it("多了一个叶：过渡，给出新叶第一帧的矩形；还在的叶内容跟外框，新叶不跟", () => {
        const {memory, base} = warmed();
        const decision = decideMotion(frame({items: items([200, 200, 150, 150]), previous: base}), memory);
        expect(decision.kind).toBe("move");
        if (decision.kind !== "move") return;
        expect(decision.entering.has("leaf:l3")).toBe(true);
        expect([...decision.following]).toEqual(["leaf:l0", "leaf:l1", "leaf:l2"]);
    });

    it("新开的浮动窗：外框从内容原来的叶出发、跟外框（头逐帧重排，不按最终尺寸裁）；拖动中不用，落地另给起点", () => {
        const window = {x: 100, y: 50, width: 300, height: 200};
        const scene = (tree: GridPlacementItem<unknown>[], leafId: string, floats: ReadonlyArray<string> = []) => {
            const all = [...tree, ...floatPlacements(floats.map((id) => ({id, rect: window})))];
            return layerItems(all, placeContents(all, [{key: "v", leaf: leafId, insetTop: 32, active: true}], 1));
        };
        const before = scene(items([300, 200, 200]), "l2");
        const after = scene(items([400, 300]), "w", ["w"]);
        const source = before.find((item) => item.kind === "leaf" && item.node.id === "l2")?.rect;
        const {memory} = warmed();
        const decision = decideMotion(frame({items: after, previous: before}), memory);
        if (decision.kind !== "move") throw new Error("应当过渡");
        expect(decision.entering.get("leaf:w")).toEqual(source);
        expect(decision.following.has("leaf:w")).toBe(true);
        expect(decision.keptSize.has("leaf:w")).toBe(false);
        const dragged = decideMotion(frame({items: after, previous: before, holding: true}), warmed().memory);
        if (dragged.kind !== "move") throw new Error("应当过渡");
        expect(dragged.entering.get("leaf:w")).toEqual(window);
    });

    it("刚放开的窗回到树里（输出 172）：外框与内容从松手处出发，跟外框照旧；拖动还没收场（holding）也给；没给 released 时从记录矩形出发", () => {
        const window = {x: 100, y: 50, width: 300, height: 200};
        const offset = {x: 220, y: 40};
        const scene = (tree: GridPlacementItem<unknown>[], floats: ReadonlyArray<string> = []) => {
            const all = [...tree, ...floatPlacements(floats.map((id) => ({id, rect: window})))];
            return layerItems(all, placeContents(all, [{key: "v", leaf: "l2", insetTop: 32, active: true}], 1));
        };
        const before = scene(items([400, 300]), ["l2"]);
        const after = scene(items([300, 200, 200]));
        const released = new Map([["l2", offset]]);
        for (const holding of [false, true]) {
            const decision = decideMotion(frame({items: after, previous: before, holding, released}), warmed().memory);
            if (decision.kind !== "move") throw new Error("应当过渡");
            expect(decision.entering.get("leaf:l2")).toEqual({...window, x: 320, y: 90});
            expect(decision.entering.get("content:v")).toEqual({x: 320, y: 122, width: 300, height: 168});
            expect(decision.following.has("leaf:l2")).toBe(true);
            expect(decision.keptSize.has("leaf:l2")).toBe(false);
            // 回到树里的窗：外框在起点那次渲染里还画成窗（输出 110 的淡去，`docking`）。
            expect(decision.docked).toEqual(new Set(["leaf:l2"]));
        }
        const plain = decideMotion(frame({items: after, previous: before}), warmed().memory);
        if (plain.kind !== "move") throw new Error("应当过渡");
        expect(plain.entering.has("leaf:l2")).toBe(false);
    });

    it("容器尺寸变了（宿主的根尺寸或自己量到的盒，两个来源晚一拍到）：不过渡，进行中的直接到终点", () => {
        const {memory, base} = warmed();
        const smaller = {width: 700, height: 250};
        // 第一拍：宿主先发布新布局，自己的盒还是旧的。
        expect(decideMotion(frame({items: items([300, 200, 200], smaller), previous: base, rootSize: smaller}), memory).kind).toBe("stop");
        // 第二拍：自己的盒才更新，矩形又变了（交叉轴）。这一拍不能被当成程序变化。
        const second = decideMotion(frame({items: items([300, 200, 200], smaller), previous: items([300, 200, 200], {width: 700, height: 300}), rootSize: smaller, extent: smaller}), memory);
        expect(second.kind).toBe("stop");
        // 之后稳定了，再来的程序变化照常过渡。
        const settled = items([300, 200, 200], smaller);
        expect(decideMotion(frame({items: items([400, 100, 200], smaller), previous: settled, rootSize: smaller, extent: smaller}), memory).kind).toBe("move");
    });

    it("根尺寸只差舍入（子项加出来的 699.9999999999999）：不算容器变了，照常过渡", () => {
        const {memory, base} = warmed();
        expect(decideMotion(frame({items: items([400, 100, 200]), previous: base, rootSize: {width: 699.9999999999999, height: 300}}), memory).kind).toBe("move");
    });

    it("设备像素比变了：不过渡", () => {
        const {memory, base} = warmed();
        expect(decideMotion(frame({items: items([400, 100, 200]), previous: base, dpr: 1.25}), memory).kind).toBe("stop");
    });

    it("手势预览进行中：不过渡", () => {
        const {memory, base} = warmed();
        expect(decideMotion(frame({items: items([400, 100, 200]), previous: base, previewing: true}), memory).kind).toBe("none");
    });

    it("预览撤下的那一次（松手、取消、被拒）：不过渡；再下一次程序变化照常过渡，不被吞", () => {
        const {memory, base} = warmed();
        const dragged = items([400, 100, 200]);
        decideMotion(frame({items: dragged, previous: base, previewing: true}), memory);
        // 松手落账，预览撤下，布局回到宿主发布的。
        expect(decideMotion(frame({items: dragged, previous: dragged, previewing: false}), memory).kind).toBe("none");
        expect(decideMotion(frame({items: items([200, 300, 200]), previous: dragged}), memory).kind).toBe("move");
    });

    it("预览中发生的结构变化被当成手势：代价只是这一次不过渡，不会残留", () => {
        const {memory, base} = warmed();
        expect(decideMotion(frame({items: items([200, 200, 150, 150]), previous: base, previewing: true}), memory).kind).toBe("none");
        const now = items([200, 200, 150, 150]);
        expect(decideMotion(frame({items: now, previous: now}), memory).kind).toBe("none");
        expect(decideMotion(frame({items: items([300, 100, 150, 150]), previous: now}), memory).kind).toBe("move");
    });
});

describe("decideMotion 与留着的内容（docs/specs/ui/nested-grid.md 输出 155）", () => {
    /** 一行叶加每块叶一个内容项；`retained` 里的标了 `leave: "retain"`。 */
    function layersOf(ids: string[], retained: readonly string[] = ids, extra: GridLayerItem<unknown>[] = []): GridLayerItem<unknown>[] {
        const tree = row(ids.map((id) => [id, 1] as [string, number]));
        const placed = [...tree, ...extra.filter((item): item is GridPlacementItem<unknown> => item.kind !== "content")];
        const live = placeContents(placed, ids.map((id) => ({key: id, leaf: id, insetTop: 0, active: true, ...(retained.includes(id) ? {leave: "retain" as const} : {})})), 1);
        return layerItems(placed, [...live, ...extra.filter((item): item is GridContentPlacement => item.kind === "content")]);
    }
    function warmedRow(ids: string[]): GridMotionMemory {
        const memory = EMPTY_GRID_MOTION_MEMORY();
        expect(decideMotion(frame({items: layersOf(ids)}), memory).kind).toBe("none");
        return memory;
    }
    const keys = (decision: ReturnType<typeof decideMotion>): string[] => (decision.kind === "move" ? decision.leavingContents.map((item) => item.key) : []);

    it("关一张：叶与内容一起留；下一轮别处又关一张，上一轮留下的接着留、这一轮的也留", () => {
        const memory = warmedRow(["a", "b", "c", "d"]);
        const first = decideMotion(frame({items: layersOf(["a", "c", "d"]), previous: layersOf(["a", "b", "c", "d"])}), memory);
        if (first.kind !== "move") throw new Error("应当过渡");
        expect(keys(first)).toEqual(["content:b"]);
        // 第二轮的渲染层里带着上一轮留下的叶与内容项（NestedGrid 并进去的）。
        const withLeft = layersOf(["a", "c", "d"], ["a", "c", "d"], [...first.leaving, ...first.leavingContents]);
        expect(decideMotion(frame({items: withLeft, previous: layersOf(["a", "c", "d"])}), memory).kind).toBe("none");
        const second = decideMotion(frame({items: layersOf(["a", "d"], ["a", "d"], [...first.leaving, ...first.leavingContents]), previous: withLeft}), memory);
        expect(keys(second).sort()).toEqual(["content:b", "content:c"]);
    });

    it("宿主在过渡中又给回同一个 key：不再留", () => {
        const memory = warmedRow(["a", "b", "c", "d"]);
        const first = decideMotion(frame({items: layersOf(["a", "c", "d"]), previous: layersOf(["a", "b", "c", "d"])}), memory);
        if (first.kind !== "move") throw new Error("应当过渡");
        const withLeft = layersOf(["a", "c", "d"], ["a", "c", "d"], [...first.leaving, ...first.leavingContents]);
        const back = decideMotion(frame({items: layersOf(["a", "b", "c", "d"], ["a", "b", "c", "d"], [...first.leaving, ...first.leavingContents]), previous: withLeft}), memory);
        expect(keys(back)).toEqual([]);
    });

    it("过渡中叶回到树里、宿主给了别的内容：上一轮留着的那项摘掉，不叠在活的叶上", () => {
        const memory = warmedRow(["a", "b", "c", "d"]);
        const first = decideMotion(frame({items: layersOf(["a", "c", "d"]), previous: layersOf(["a", "b", "c", "d"])}), memory);
        if (first.kind !== "move") throw new Error("应当过渡");
        const withLeft = layersOf(["a", "c", "d"], ["a", "c", "d"], [...first.leaving, ...first.leavingContents]);
        const tree = row([["a", 1], ["b", 1], ["c", 1], ["d", 1]]);
        const live = placeContents(tree, ["a", "c", "d"].map((id) => ({key: id, leaf: id, insetTop: 0, active: true})).concat([{key: "b2", leaf: "b", insetTop: 0, active: true}]), 1);
        const back = decideMotion(frame({items: layerItems(tree, [...live, ...first.leavingContents]), previous: withLeft}), memory);
        expect(keys(back)).toEqual([]);
    });

    it("拖动中：新去掉的不留；上一轮留下的只在它的叶接着留时才留，叶与内容一起", () => {
        expect(keys(decideMotion(frame({items: layersOf(["a", "c", "d"]), previous: layersOf(["a", "b", "c", "d"]), holding: true}), warmedRow(["a", "b", "c", "d"])))).toEqual([]);
        const memory = warmedRow(["a", "b", "c", "d"]);
        const first = decideMotion(frame({items: layersOf(["a", "c", "d"]), previous: layersOf(["a", "b", "c", "d"])}), memory);
        if (first.kind !== "move") throw new Error("应当过渡");
        const withLeft = layersOf(["a", "c", "d"], ["a", "c", "d"], [...first.leaving, ...first.leavingContents]);
        const dragged = decideMotion(frame({items: layersOf(["a", "d"], ["a", "d"], [...first.leaving, ...first.leavingContents]), previous: withLeft, holding: true}), memory);
        if (dragged.kind !== "move") throw new Error("应当过渡");
        // 拖动中这一轮不新判离开的叶（c 当即消失、内容不留）；上一轮的 b 接着缩完，它的内容跟着。
        expect(dragged.leaving.flatMap((item) => (item.kind === "leaf" ? [item.node.id] : []))).toEqual(["b"]);
        expect(keys(dragged)).toEqual(["content:b"]);
    });
});

describe("decideMotion 与交换（docs/specs/ui/nested-grid.md 的“交换”）", () => {
    /** 左边一列放一组叶，右边是主区。 */
    function column(group: readonly string[]): GridPlacementItem<unknown>[] {
        const side: GridNodeInput<string> = group.length === 1
            ? {kind: "leaf", id: group[0] as string, ref: group[0] as string, size: {width: 300, height: 0}}
            : {kind: "branch", id: "side", orientation: "vertical", size: {width: 300, height: 0}, children: group.map((id) => ({kind: "leaf" as const, id, ref: id, size: {width: 0, height: 150}}))};
        const grid = createGrid<string>({kind: "branch", id: "root", orientation: "horizontal", children: [side, leaf("main", 399)]}, {sashSize: 1});
        return [...placeGrid(grid.root()!, grid.layout(EXTENT), EXTENT, 1).items];
    }
    const swap = (leaving: string[], entering: string[]) => ({token: 1, leaving, entering, axis: "height" as const, direction: 1 as const, gap: 8});
    function warmedColumn(): GridMotionMemory {
        const memory = EMPTY_GRID_MOTION_MEMORY();
        expect(decideMotion(frame({items: column(["a1", "a2"])}), memory).kind).toBe("none");
        return memory;
    }

    it("带上的项整块平移，不按别的规则长、跟外框；离开的一组与组里的分隔线留着，矩形是终点", () => {
        const memory = warmedColumn();
        const decision = decideMotion(frame({items: column(["b1"]), previous: column(["a1", "a2"]), swap: swap(["a1", "a2"], ["b1"])}), memory);
        if (decision.kind !== "move" || decision.swap === undefined) throw new Error("应当按交换走");
        const b1 = column(["b1"]).find((item) => item.key === "leaf:b1")!;
        expect(decision.entering.get("leaf:b1")).toEqual({...b1.rect, y: b1.rect.y + EXTENT.height + 8});
        expect(decision.keptSize.has("leaf:b1")).toBe(false);
        expect(decision.following.has("leaf:b1")).toBe(false);
        expect(decision.leaving.map((item) => [item.kind, item.leaving])).toEqual([["leaf", true], ["sash", true], ["leaf", true]]);
        // 主区不在带上：照常（这次它没动）；侧栏与主区之间那条线换了两侧节点，照已有的规则从旧线的位置出发。
        expect(decision.entering.has("leaf:main")).toBe(false);
    });

    it("离开的叶还在别的过渡里：不交换，交回原因，照常过渡；拖动中不交换也不报", () => {
        const busy = decideMotion(frame({items: column(["b1"]), previous: column(["a1", "a2"]), swap: swap(["a1", "a2"], ["b1"]), busy: new Set(["a1"])}), warmedColumn());
        expect(busy.kind === "move" && busy.swap === undefined ? busy.swapSkipped?.params : null).toEqual({cause: "busy", id: "a1"});
        const holding = decideMotion(frame({items: column(["b1"]), previous: column(["a1", "a2"]), swap: swap(["a1", "a2"], ["b1"]), holding: true}), warmedColumn());
        expect(holding.kind === "move" && holding.swap === undefined && holding.swapSkipped === undefined).toBe(true);
    });

    it("手势预览中、矩形没变时带着交换：静默放弃，不交换也不报 swap-skipped（时序“swap”）", () => {
        const silent = (decision: ReturnType<typeof decideMotion>): boolean => decision.kind !== "move" || (decision.swap === undefined && decision.swapSkipped === undefined);
        // 预览中：这一帧照样能换（两组都对得上），但不交换。
        const previewing = decideMotion(frame({items: column(["b1"]), previous: column(["a1", "a2"]), swap: swap(["a1", "a2"], ["b1"]), previewing: true}), warmedColumn());
        expect(silent(previewing)).toBe(true);
        // 矩形没变：宿主列的叶对不上这一帧（a1、a2 还在），真去规划会报 no-leaving；这里什么都不做。
        const unchanged = decideMotion(frame({items: column(["a1", "a2"]), previous: column(["a1", "a2"]), swap: swap(["a1", "a2"], ["b1"])}), warmedColumn());
        expect(unchanged.kind).toBe("none");
        expect(silent(unchanged)).toBe(true);
    });

    /** 左右两列各放一组叶，中间是主区：两个区域各自的交换。 */
    function columns(left: readonly string[], right: readonly string[]): GridPlacementItem<unknown>[] {
        const side = (id: string, group: readonly string[]): GridNodeInput<string> => (group.length === 1
            ? {kind: "leaf", id: group[0] as string, ref: group[0] as string, size: {width: 200, height: 0}}
            : {kind: "branch", id, orientation: "vertical", size: {width: 200, height: 0}, children: group.map((child) => ({kind: "leaf" as const, id: child, ref: child, size: {width: 0, height: 150}}))});
        const grid = createGrid<string>({kind: "branch", id: "root", orientation: "horizontal", children: [side("left", left), leaf("main", 298), side("right", right)]}, {sashSize: 1});
        return [...placeGrid(grid.root()!, grid.layout(EXTENT), EXTENT, 1).items];
    }

    it("交换进行中别处又来一次交换（和带不相交）：先把进行中的送到终点，这一次按空带规划，只带这一次的两组，上一轮滑出去的项不带进来", () => {
        const memory = EMPTY_GRID_MOTION_MEMORY();
        expect(decideMotion(frame({items: columns(["a1"], ["x1"])}), memory).kind).toBe("none");
        const first = decideMotion(frame({items: columns(["b1"], ["x1"]), previous: columns(["a1"], ["x1"]), swap: swap(["a1"], ["b1"])}), memory);
        if (first.kind !== "move" || first.swap === undefined) throw new Error("应当按交换走");
        expect(first.settleFirst).toBeUndefined();
        const second = decideMotion(frame({
            items: [...columns(["b1"], ["y1"]), ...first.leaving],
            previous: [...columns(["b1"], ["x1"]), ...first.leaving],
            swap: {...swap(["x1"], ["y1"]), token: 2, axis: "width"},
            band: first.swap,
            bandNow: [-200, 200],
            busy: new Set(["b1"]),
        }), memory);
        if (second.kind !== "move" || second.swap === undefined) throw new Error("应当按交换走");
        expect(second.settleFirst).toBe(true);
        expect(second.swap.axis).toBe("width");
        expect(second.swap.groups.map((group) => [...group.leaves])).toEqual([["x1"], ["y1"]]);
        expect(second.leaving.some((item) => item.key === "leaf:a1")).toBe(false);
    });

    /** 渲染层：叶与分隔线加每块给出的叶一个内容项，都标了留住。 */
    const withRetained = (items: GridPlacementItem<unknown>[], leaves: readonly string[]): GridLayerItem<unknown>[] =>
        layerItems(items, placeContents(items, leaves.map((id) => ({key: id, leaf: id, insetTop: 0, active: true, leave: "retain" as const})), 1));

    it("交换里滑出去的叶不留内容（输出 155）：宿主同一轮去掉了它们标了留住的内容项，照样当即卸载", () => {
        const decision = decideMotion(frame({items: withRetained(column(["b1"]), ["b1"]), previous: withRetained(column(["a1", "a2"]), ["a1", "a2"]), swap: swap(["a1", "a2"], ["b1"])}), warmedColumn());
        if (decision.kind !== "move" || decision.swap === undefined) throw new Error("应当按交换走");
        expect(decision.leavingContents).toEqual([]);
    });

    it("先把进行中的过渡送到终点（另一处交换）：上一轮的叶不留，上一轮留着的内容也摘掉", () => {
        const memory = EMPTY_GRID_MOTION_MEMORY();
        expect(decideMotion(frame({items: columns(["a1"], ["x1"])}), memory).kind).toBe("none");
        const first = decideMotion(frame({items: columns(["b1"], ["x1"]), previous: columns(["a1"], ["x1"]), swap: swap(["a1"], ["b1"])}), memory);
        if (first.kind !== "move" || first.swap === undefined) throw new Error("应当按交换走");
        // 上一轮留着的一项内容（它的叶是正滑出去的 a1）：settle 时 a1 不再留，它也不留。
        const kept = {...placeContents(columns(["a1"], ["x1"]), [{key: "a1", leaf: "a1", insetTop: 0, active: true, leave: "retain"}], 1)[0]!, leaving: true as const};
        const second = decideMotion(frame({
            items: [...columns(["b1"], ["y1"]), ...first.leaving, kept],
            previous: [...columns(["b1"], ["x1"]), ...first.leaving],
            swap: {...swap(["x1"], ["y1"]), token: 2, axis: "width"},
            band: first.swap,
            bandNow: [-200, 200],
            busy: new Set(["b1"]),
        }), memory);
        if (second.kind !== "move" || second.settleFirst !== true) throw new Error("应当先送到终点");
        expect(second.leavingContents).toEqual([]);
    });

    it("交换进行中点回正在滑出去的那组（和带相交）：不收尾，从此刻接着走，带上还是这两组", () => {
        const memory = EMPTY_GRID_MOTION_MEMORY();
        expect(decideMotion(frame({items: columns(["a1"], ["x1"])}), memory).kind).toBe("none");
        const first = decideMotion(frame({items: columns(["b1"], ["x1"]), previous: columns(["a1"], ["x1"]), swap: swap(["a1"], ["b1"])}), memory);
        if (first.kind !== "move" || first.swap === undefined) throw new Error("应当按交换走");
        const back = decideMotion(frame({
            items: [...columns(["a1"], ["x1"]), ...first.leaving],
            previous: [...columns(["b1"], ["x1"]), ...first.leaving],
            swap: {...swap(["b1"], ["a1"]), token: 2},
            band: first.swap,
            bandNow: [-200, 200],
        }), memory);
        if (back.kind !== "move" || back.swap === undefined) throw new Error("应当按交换走");
        expect(back.settleFirst).toBeUndefined();
        expect(back.swap.groups.map((group) => [...group.leaves]).sort()).toEqual([["a1"], ["b1"]]);
    });

    it("交换进行中来了一次不是交换的布局变化：滑出去的那组接着留着、终点不变，带不换", () => {
        const memory = warmedColumn();
        const first = decideMotion(frame({items: column(["b1"]), previous: column(["a1", "a2"]), swap: swap(["a1", "a2"], ["b1"])}), memory);
        if (first.kind !== "move") throw new Error("应当过渡");
        // 主区窄了一点（第二次发布）：这一帧的项里带着上一轮留着的离开项。
        const wider = createGrid<string>({kind: "branch", id: "root", orientation: "horizontal", children: [{kind: "leaf", id: "b1", ref: "b1", size: {width: 320, height: 0}}, leaf("main", 379)]}, {sashSize: 1});
        const next = [...placeGrid(wider.root()!, wider.layout(EXTENT), EXTENT, 1).items];
        const second = decideMotion(frame({items: [...next, ...first.leaving], previous: [...column(["b1"]), ...first.leaving]}), memory);
        if (second.kind !== "move") throw new Error("应当过渡");
        expect(second.swap).toBeUndefined();
        expect(second.leaving).toEqual(first.leaving);
    });
});

describe("过渡中内容跟外框的叶", () => {
    const cleanups: Array<() => void> = [];
    afterEach(() => {
        for (const cleanup of cleanups.splice(0)) cleanup();
    });

    /** 挂一个带令牌的根，喂第一帧。 */
    function started(duration = "470ms", root = document.createElement("div")) {
        root.style.setProperty("--nb-layout-motion-layout", duration);
        document.body.append(root);
        let motion!: ReturnType<typeof useGridMotion>;
        const wrapper = mount(defineComponent({
            setup() {
                motion = useGridMotion({root: ref(root), onSettled: () => undefined});
                return () => null;
            },
        }));
        cleanups.push(() => {
            wrapper.unmount();
            root.remove();
        });
        const base = items([300, 200, 200]);
        motion.update(frame({items: base}));
        return {motion, base};
    }
    const followingOf = (motion: ReturnType<typeof useGridMotion>) => [...motion.following.value];

    it("拆分：还在的叶跟，新叶不跟；结束后清空", () => {
        const {motion, base} = started();
        motion.update(frame({items: items([200, 200, 150, 150]), previous: base}));
        expect(motion.moving.value).toBe(true);
        expect(followingOf(motion)).toEqual(["leaf:l0", "leaf:l1", "leaf:l2"]);
        motion.stop();
        expect(motion.moving.value).toBe(false);
        expect(followingOf(motion)).toEqual([]);
    });

    it("过渡中又来一次变化：上一轮的新叶继续不跟；过渡结束之后的变化才跟", () => {
        const {motion, base} = started();
        const split = items([200, 200, 150, 150]);
        motion.update(frame({items: split, previous: base}));
        const again = items([100, 300, 150, 150]);
        motion.update(frame({items: again, previous: split}));
        expect(followingOf(motion)).toEqual(["leaf:l0", "leaf:l1", "leaf:l2"]);
        motion.stop();
        motion.update(frame({items: split, previous: again}));
        expect(followingOf(motion)).toEqual(["leaf:l0", "leaf:l1", "leaf:l2", "leaf:l3"]);
    });

    it("内容不跟外框、贴着右边的叶：过渡中又来一次变化、这一轮它没动时接着按叶的矩形摆、接着贴（外框还在走上一轮的过渡）；结束后清空", () => {
        const {motion, base} = started();
        // 最前面多出一块：它从左边长出来，内容贴着在动的右边。
        const shown = row([["s", 100], ["l0", 299], ["l1", 149], ["l2", 149]]);
        motion.update(frame({items: shown, previous: base}));
        expect(motion.keptSize.value.has("leaf:s")).toBe(true);
        expect(motion.anchoredRight.value.has("leaf:s")).toBe(true);
        const again = row([["s", 100], ["l0", 199], ["l1", 249], ["l2", 149]]);
        motion.update(frame({items: again, previous: shown}));
        expect(motion.keptSize.value.has("leaf:s")).toBe(true);
        expect(motion.anchoredRight.value.has("leaf:s")).toBe(true);
        motion.stop();
        expect(motion.keptSize.value.size).toBe(0);
        expect(motion.anchoredRight.value.size).toBe(0);
    });

    it("降到零的叶：这一轮记下；过渡中又来一次变化、它仍为零时接着记（不然缩到一半就没了），又长出来的不算；结束后清空", () => {
        const {motion, base} = started();
        const open = row([["s", 100], ["l0", 299], ["l1", 149], ["l2", 149]]);
        motion.update(frame({items: open, previous: base}));
        motion.stop();
        const zero = row([["s", 0], ["l0", 399], ["l1", 149], ["l2", 149]]);
        motion.update(frame({items: zero, previous: open}));
        expect([...motion.shrinking.value]).toEqual(["s"]);
        const again = row([["s", 0], ["l0", 299], ["l1", 249], ["l2", 149]]);
        motion.update(frame({items: again, previous: zero}));
        expect([...motion.shrinking.value]).toEqual(["s"]);
        motion.update(frame({items: open, previous: again}));
        expect(motion.shrinking.value.size).toBe(0);
        motion.update(frame({items: zero, previous: open}));
        motion.stop();
        expect(motion.shrinking.value.size).toBe(0);
    });

    it("容差之内的第二次发布不改名单", () => {
        const {motion, base} = started();
        const split = items([200, 200, 150, 150]);
        motion.update(frame({items: split, previous: base}));
        motion.update(frame({items: split, previous: split}));
        expect(motion.moving.value).toBe(true);
        expect(followingOf(motion)).toEqual(["leaf:l0", "leaf:l1", "leaf:l2"]);
    });

    it("落地的内容项：不跟外框、压在上面；先后于这一轮布局都一样，结束后清空", () => {
        const after = started();
        after.motion.update(frame({items: items([200, 200, 150, 150]), previous: after.base}));
        after.motion.land("leaf:l0");
        expect(followingOf(after.motion)).toEqual(["leaf:l1", "leaf:l2"]);
        expect(after.motion.flying.value.has("leaf:l0")).toBe(true);

        const before = started();
        before.motion.land("leaf:l0");
        before.motion.update(frame({items: items([200, 200, 150, 150]), previous: before.base}));
        expect(followingOf(before.motion)).toEqual(["leaf:l1", "leaf:l2"]);
        expect(before.motion.flying.value.has("leaf:l0")).toBe(true);

        before.motion.stop();
        expect(before.motion.moving.value).toBe(false);
        expect(before.motion.flying.value.size).toBe(0);
    });

    it("减少动态效果时落地不过渡：卡片直接到叶上", () => {
        const {motion} = started("0ms");
        motion.land("leaf:l0");
        expect(motion.moving.value).toBe(false);
    });

    it("过渡中切到减少动态效果、又来一次变化：不开新一轮，进行中的直接到终点、名单清空", () => {
        const root = document.createElement("div");
        const {motion, base} = started("470ms", root);
        const split = items([200, 200, 150, 150]);
        motion.update(frame({items: split, previous: base}));
        expect(motion.moving.value).toBe(true);
        root.style.setProperty("--nb-layout-motion-layout", "0ms");
        motion.update(frame({items: items([100, 300, 150, 150]), previous: split}));
        expect(motion.moving.value).toBe(false);
        expect([followingOf(motion), [...motion.keptSize.value], motion.leaving.value]).toEqual([[], [], []]);
    });

    it("减少动态效果（令牌为零）：没有过渡，内容直接是最终尺寸", () => {
        const {motion, base} = started("0ms");
        motion.update(frame({items: items([200, 200, 150, 150]), previous: base}));
        expect(motion.moving.value).toBe(false);
        expect(followingOf(motion)).toEqual([]);
    });
});
