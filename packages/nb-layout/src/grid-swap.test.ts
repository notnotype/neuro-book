import {describe, expect, it} from "bun:test";

import {createGrid} from "./grid";
import {layerItems, placeContents, placeGrid} from "./grid-rects";
import type {GridLayerItem, GridRect} from "./grid-rects";
import {planSwap, swapSides, swapWindowClip} from "./grid-swap";
import type {GridSwap, GridSwapBand} from "./grid-swap";
import type {GridNodeInput} from "./grid-types";

/** 交换（docs/specs/ui/nested-grid.md 的“交换”）：一列里一组叶换成另一组，按真实的摆放算。 */

const EXTENT = {width: 1000, height: 600};
const GAP = 8;
/** 窗口是整列（300 × 600），相邻两组相距窗口高度加间距。 */
const STEP = 600 + GAP;

const leaf = (id: string): GridNodeInput<string> => ({kind: "leaf", id, ref: id, size: {width: 300, height: 300}});
/** 侧栏一列放一组叶，右边是主区；只有一块叶时它就是那一列。 */
function frame(...group: string[]): ReadonlyArray<GridLayerItem<unknown>> {
    const side: GridNodeInput<string> = group.length === 1 ? {...leaf(group[0] as string), size: {width: 300, height: 600}} : {kind: "branch", id: "side", orientation: "vertical", size: {width: 300, height: 600}, children: group.map(leaf)};
    const instance = createGrid<string>({kind: "branch", id: "root", orientation: "horizontal", children: [side, {kind: "leaf", id: "main", ref: "main", size: {width: 696, height: 600}}]}, {sashSize: 4});
    const items = placeGrid(instance.root()!, instance.layout(EXTENT), EXTENT, 1).items;
    const contents = [...group, "main"].map((id) => ({key: `view-${id}`, leaf: id, insetTop: 30, active: true}));
    return layerItems(items, placeContents(items, contents, 1));
}

const rectOf = (list: ReadonlyArray<GridLayerItem<unknown>>, key: string): GridRect => {
    const item = list.find((candidate) => candidate.key === key);
    if (item?.rect == null) throw new Error(`没有 ${key}`);
    return item.rect;
};
const down = (rect: GridRect, by: number): GridRect => ({...rect, y: rect.y + by});
const swap = (leaving: string[], entering: string[], direction: 1 | -1 = 1, extra: Partial<GridSwap> = {}): GridSwap => ({token: 1, leaving, entering, axis: "height", direction, gap: GAP, ...extra});

function planned(input: Parameters<typeof planSwap>[0]) {
    const plan = planSwap(input);
    if (plan.kind !== "swap") throw new Error(plan.reason);
    return plan;
}

/** 各组此刻（偏移为 `offsets`）沿轴的区间。 */
const spans = (band: GridSwapBand, offsets: readonly number[]) => band.groups.map((group, index) => {
    const ys = group.home.flatMap((item) => (item.kind === "leaf" ? [item.rect.y, item.rect.y + item.rect.height] : []));
    return [Math.min(...ys) + (offsets[index] ?? 0), Math.max(...ys) + (offsets[index] ?? 0)] as const;
});
const disjoint = (list: ReadonlyArray<readonly [number, number]>): boolean => list.every(([start, end], index) => list.every(([otherStart, otherEnd], other) => other === index || end <= otherStart || otherEnd <= start));

describe("第一次交换", () => {
    const previous = frame("a1", "a2");
    const items = frame("b1");
    const plan = planned({swap: swap(["a1", "a2"], ["b1"]), items, previous, band: null, now: [], busy: new Set()});

    it("换上来的一组从终点那边整块滑进来，叶、内容同一段偏移、尺寸不变；离开的从原位出发", () => {
        expect(plan.starts.get("leaf:b1")).toEqual(down(rectOf(items, "leaf:b1"), STEP));
        expect(plan.starts.get("content:view-b1")).toEqual(down(rectOf(items, "content:view-b1"), STEP));
        expect(plan.starts.get("leaf:a1")).toEqual(rectOf(previous, "leaf:a1"));
        expect(plan.starts.get("content:view-a2")).toEqual(rectOf(previous, "content:view-a2"));
        // 主区与挨着它的那条线不在带上。
        expect(plan.starts.has("leaf:main")).toBe(false);
        expect([...plan.starts.keys()].some((key) => key.includes("main"))).toBe(false);
    });

    it("离开的叶与它们之间的分隔线往起点那边滑出去；分隔线两侧的尺寸冻结在离开前", () => {
        const byKey = new Map(plan.leaving.map((item) => [item.key, item]));
        expect(byKey.get("leaf:a1")?.rect).toEqual(down(rectOf(previous, "leaf:a1"), -STEP));
        expect(byKey.get("leaf:a2")?.rect).toEqual(down(rectOf(previous, "leaf:a2"), -STEP));
        const sash = plan.leaving.find((item) => item.kind === "sash");
        if (sash?.kind !== "sash") throw new Error("组里的分隔线没有留下");
        expect(sash.rect).toEqual(down(rectOf(previous, sash.key), -STEP));
        expect(sash.frozen).toEqual({beforePx: rectOf(previous, "leaf:a1").height, afterPx: rectOf(previous, "leaf:a2").height});
        expect(plan.leaving.every((item) => item.leaving)).toBe(true);
    });

    it("窗口是两组的外接矩形；终点时两组不相交，相距一个间距", () => {
        expect(plan.band.window).toEqual({x: 0, y: 0, width: 300, height: 600});
        expect(plan.band.groups.map((group) => group.offset)).toEqual([-STEP, 0]);
        expect(swapSides(plan.band).get("leaf:b1")).toBe("in");
        expect(swapSides(plan.band).get("leaf:a2")).toBe("out");
        const [left, entered] = spans(plan.band, plan.band.groups.map((group) => group.offset));
        expect(entered![0] - left![1]).toBe(GAP);
    });

    it("方向为 -1：换上来的从起点那边进来", () => {
        const back = planned({swap: swap(["a1", "a2"], ["b1"], -1), items, previous, band: null, now: [], busy: new Set()});
        expect(back.starts.get("leaf:b1")).toEqual(down(rectOf(items, "leaf:b1"), -STEP));
        expect(back.band.groups.map((group) => group.offset)).toEqual([STEP, 0]);
    });

    it("裁切窗按给的内缩缩小，间距跟着窗口的长度", () => {
        const inset = planned({swap: swap(["a1", "a2"], ["b1"], 1, {window: {inset: [10, 0, 0, 0], radius: ["0px", "0px", "12px", "12px"]}}), items, previous, band: null, now: [], busy: new Set()});
        expect(inset.band.window).toEqual({x: 0, y: 10, width: 300, height: 590});
        expect(inset.band.step).toBe(590 + GAP);
        expect(swapWindowClip(inset.band, {x: 0, y: 600, width: 300, height: 600})).toBe("inset(-590px 0px 600px 0px round 0px 0px 12px 12px)");
    });
});

describe("宿主列的叶对不上呈现", () => {
    const previous = frame("a1", "a2");
    const items = frame("b1");

    it("不在呈现里的 id 忽略，照剩下的交换", () => {
        const plan = planned({swap: swap(["a1", "a2", "hidden"], ["b1", "ghost"]), items, previous, band: null, now: [], busy: new Set()});
        expect(plan.band.groups.map((group) => [...group.leaves])).toEqual([["a1", "a2"], ["b1"]]);
    });

    it("忽略之后有一边为空，或离开的叶还在别的过渡里：不交换，交回原因", () => {
        expect(planSwap({swap: swap(["hidden"], ["b1"]), items, previous, band: null, now: [], busy: new Set()})).toMatchObject({kind: "skip"});
        // a1 上一帧就在：不是换上来的。
        expect(planSwap({swap: swap(["a2"], ["a1"]), items: frame("a1"), previous, band: null, now: [], busy: new Set()})).toMatchObject({kind: "skip"});
        const busy = planSwap({swap: swap(["a1", "a2"], ["b1"]), items, previous, band: null, now: [], busy: new Set(["a2"])});
        expect(busy.kind === "skip" && busy.reason.includes("a2")).toBe(true);
    });
});

describe("交换进行中又来一次", () => {
    const first = planned({swap: swap(["a1", "a2"], ["b1"]), items: frame("b1"), previous: frame("a1", "a2"), band: null, now: [], busy: new Set()});
    /** 滑了四成：A 在上面出去一半不到，B 还在下面。 */
    const midway = [-0.4 * STEP, 0.6 * STEP];

    it("点回正在滑出去的那组：它从此刻的位置往回走，不重排；整条带平移同一段，各组不相交", () => {
        const plan = planned({swap: swap(["b1"], ["a1", "a2"], -1), items: frame("a1", "a2"), previous: frame("b1"), band: first.band, now: midway, busy: new Set()});
        expect(plan.starts.get("leaf:a1")).toEqual(down(rectOf(frame("a1", "a2"), "leaf:a1"), -0.4 * STEP));
        expect(plan.starts.get("leaf:b1")).toEqual(down(rectOf(frame("b1"), "leaf:b1"), 0.6 * STEP));
        const offsets = plan.band.groups.map((group) => group.offset);
        expect(plan.band.groups[plan.band.target]?.offset).toBe(0);
        expect(plan.leaving.find((item) => item.key === "leaf:b1")?.rect).toEqual(down(rectOf(frame("b1"), "leaf:b1"), STEP));
        expect(disjoint(spans(plan.band, offsets))).toBe(true);
        // 带上的次序不变（A、B），重新开始的那一刻也不相交。
        expect(plan.band.groups.map((group) => [...group.leaves])).toEqual([["a1", "a2"], ["b1"]]);
        expect(disjoint(spans(plan.band, midway))).toBe(true);
    });

    it("换到带上没有的一组：接在方向那头最外面那组后面，三组同向一起走", () => {
        const plan = planned({swap: swap(["b1"], ["c1", "c2"]), items: frame("c1", "c2"), previous: frame("b1"), band: first.band, now: midway, busy: new Set()});
        expect(plan.starts.get("leaf:c1")?.y).toBeCloseTo(rectOf(frame("c1", "c2"), "leaf:c1").y + 1.6 * STEP);
        const offsets = plan.band.groups.map((group) => group.offset);
        [-2 * STEP, -STEP, 0].forEach((expected, index) => expect(offsets[index]).toBeCloseTo(expected));
        expect(disjoint(spans(plan.band, [-0.4 * STEP, 0.6 * STEP, 1.6 * STEP]))).toBe(true);
    });

    it("此刻与终点都在窗口外的组摘掉，此刻看得见的留着滑出去", () => {
        const plan = planned({swap: swap(["b1"], ["c1", "c2"]), items: frame("c1", "c2"), previous: frame("b1"), band: first.band, now: [-STEP, 0], busy: new Set()});
        expect(plan.band.groups.map((group) => [...group.leaves])).toEqual([["b1"], ["c1", "c2"]]);
        expect(plan.leaving.some((item) => item.key === "leaf:a1")).toBe(false);
        expect(plan.starts.has("leaf:a1")).toBe(false);
    });
});
