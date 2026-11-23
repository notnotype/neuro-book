/**
 * 交换（docs/specs/ui/nested-grid.md 的“交换”）：一组叶换成另一组时，像胶片一样沿轴整块平移，不按“过渡”的长出来、消失。纯函数，不碰 DOM。
 *
 * 带（`GridSwapBand`）上排着几组，每组记着它在原位的各项（偏移为零时的矩形，就是它在树里时的矩形）和这一轮的终点偏移；在树里的那组终点偏移是零。
 * 每一次交换（第一次，或交换进行中又来一次）都从每组此刻的偏移出发，要换上的那组落回原位，所有组平移同一段，所以只会同向一起走、不穿过彼此。
 * 此刻的偏移由调用方从 DOM 读好传进来（`useGridMotion`），一律写成起点重新开始过渡：不靠浏览器对改了终点的过渡怎样接着走（反向时它按已走的比例缩短时长）。
 */

import {rectsIntersect, unionRects, type GridLayerItem, type GridPlacementItem, type GridRect} from "./grid-rects";
import {gridIssue} from "./grid-issue";
import type {GridAxis, GridIssue} from "./grid-types";

/**
 * 裁切窗：两组外接矩形的四边内缩（px：上、右、下、左）与四个角（CSS 长度：左上、右上、右下、左下）。
 * @experimental
 */
export interface GridSwapWindow {
    readonly inset: readonly [number, number, number, number];
    readonly radius?: readonly [string, string, string, string];
}

/**
 * 宿主给的交换（`NestedGrid` 的 `swap`）。
 * @experimental
 */
export interface GridSwap {
    /** 变了才算一次新的交换。 */
    readonly token: number;
    /** 这次变化里离开的叶与换上来的叶（叶 id）。 */
    readonly leaving: ReadonlyArray<string>;
    readonly entering: ReadonlyArray<string>;
    readonly axis: GridAxis;
    /** 1：换上来的从终点那边（右、下）进来，离开的往起点那边出去。 */
    readonly direction: 1 | -1;
    /** 相邻两组之间多隔的距离（px）。 */
    readonly gap: number;
    /** 不给就是两组的外接矩形本身。 */
    readonly window?: GridSwapWindow;
}

export interface GridSwapGroup {
    readonly leaves: ReadonlySet<string>;
    /** 原位的项：组里的叶、两侧都在组里的分隔线、叶里的内容项。 */
    readonly home: ReadonlyArray<GridLayerItem<unknown>>;
    /** 这一轮的终点偏移（沿轴，px）。 */
    readonly offset: number;
}

export interface GridSwapBand {
    readonly axis: GridAxis;
    /** 两组外框的外接矩形（相对网格根），裁切窗按 `GridSwap.window.inset` 从它内缩；静止的底（`swap-backdrop`）画在它上面。整个交换里不动。 */
    readonly outer: GridRect;
    /** 裁切窗（相对网格根）：整个交换里不动。 */
    readonly window: GridRect;
    readonly radius: readonly [string, string, string, string] | null;
    /** 相邻两组的距离：窗口沿轴的长度加间距。 */
    readonly step: number;
    readonly groups: ReadonlyArray<GridSwapGroup>;
    /** 在树里的那组（`groups` 的下标）。 */
    readonly target: number;
}

/** 留在过渡里滑出去的项：叶与分隔线，矩形是终点。内容项随它的叶，由内容层摆。 */
export type GridSwapLeavingItem = GridPlacementItem<unknown> & {readonly leaving: true};

export type GridSwapPlan =
    | {readonly kind: "skip"; readonly issue: GridIssue<"swap-skipped">}
    | {
        readonly kind: "swap";
        readonly band: GridSwapBand;
        /** 第一帧写的矩形（键到矩形）：带上每一项此刻的位置。 */
        readonly starts: ReadonlyMap<string, GridRect>;
        readonly leaving: ReadonlyArray<GridSwapLeavingItem>;
    };

const along = (axis: GridAxis, rect: GridRect): number => (axis === "width" ? rect.width : rect.height);
const shifted = (rect: GridRect, axis: GridAxis, offset: number): GridRect => (axis === "width" ? {...rect, x: rect.x + offset} : {...rect, y: rect.y + offset});

const leafIdOf = (item: GridLayerItem<unknown>): string | null => (item.kind === "leaf" ? item.node.id : null);

/** 节点（叶或分支）下面的叶：叶自己，或路径经过它的叶。 */
function leavesUnder(list: ReadonlyArray<GridLayerItem<unknown>>, id: string): Array<Extract<GridLayerItem<unknown>, {kind: "leaf"}>> {
    return list.flatMap((item) => (item.kind === "leaf" && (item.node.id === id || item.path.some((step) => step.id === id)) ? [item] : []));
}

/** 一组在这一帧（或上一帧）里的项：它的叶、两侧下面全是它的叶的分隔线、属于它的叶的内容项。 */
function groupItems(list: ReadonlyArray<GridLayerItem<unknown>>, leaves: ReadonlySet<string>): Array<GridLayerItem<unknown>> {
    const inGroup = (id: string): boolean => {
        const under = leavesUnder(list, id);
        return under.length > 0 && under.every((leaf) => leaves.has(leaf.node.id));
    };
    return list.filter((item) => {
        if (item.kind === "leaf") return leaves.has(item.node.id);
        if (item.kind === "content") return leaves.has(item.leaf) && item.rect !== null;
        return inGroup(item.before) && inGroup(item.after);
    });
}

const overlaps = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => [...a].some((id) => b.has(id));

interface Live {
    readonly leaves: ReadonlySet<string>;
    readonly home: ReadonlyArray<GridLayerItem<unknown>>;
    /** 此刻的偏移。 */
    readonly now: number;
}

/**
 * 这一次布局变化按交换怎么走。`items`、`previous` 是这一帧与上一帧（都不含留着的离开项）；`band` 是进行中的交换，`now` 是带上每组此刻的偏移
 * （下标同 `band.groups`，读不到的按它的终点偏移）；`busy` 是正在别的过渡里的叶（长出来、缩回去）。
 */
export function planSwap(input: {
    readonly swap: GridSwap;
    readonly items: ReadonlyArray<GridLayerItem<unknown>>;
    readonly previous: ReadonlyArray<GridLayerItem<unknown>>;
    readonly band: GridSwapBand | null;
    readonly now: ReadonlyArray<number>;
    readonly busy: ReadonlySet<string>;
}): GridSwapPlan {
    const {swap, items, previous, band} = input;
    const axis = band?.axis ?? swap.axis;
    const present = new Set(items.flatMap((item) => leafIdOf(item) ?? []));
    const before = new Set(previous.flatMap((item) => leafIdOf(item) ?? []));
    const sized = new Set(previous.flatMap((item) => (item.kind === "leaf" && item.rect.width > 0 && item.rect.height > 0 ? [item.node.id] : [])));
    // 只认真的离开、真的换上来的：宿主按文档列，被放不下收走的、没呈现出来的分节不在呈现里。
    const leaving = new Set(swap.leaving.filter((id) => sized.has(id) && !present.has(id)));
    const entering = new Set(swap.entering.filter((id) => present.has(id) && !before.has(id)));
    if (leaving.size === 0) {
        return {kind: "skip", issue: gridIssue("swap-skipped", `Swap skipped: none of the leaving leaves (${swap.leaving.join(", ") || "none"}) had a size last frame and left this frame`, {cause: "no-leaving"})};
    }
    if (entering.size === 0) {
        return {kind: "skip", issue: gridIssue("swap-skipped", `Swap skipped: none of the entering leaves (${swap.entering.join(", ") || "none"}) is new this frame`, {cause: "no-entering"})};
    }
    const busy = [...leaving].find((id) => input.busy.has(id));
    if (busy !== undefined) return {kind: "skip", issue: gridIssue("swap-skipped", `Swap skipped: leaving leaf ${busy} is still in another transition`, {cause: "busy", id: busy})};

    const leavingHome = groupItems(previous, leaving);
    const enteringHome = groupItems(items, entering);
    const rectsOf = (list: ReadonlyArray<GridLayerItem<unknown>>): GridRect[] => list.flatMap((item) => (item.kind === "leaf" ? [item.rect] : []));
    const outer = band?.outer ?? (unionRects([...rectsOf(leavingHome), ...rectsOf(enteringHome)]) as GridRect);
    let window = band?.window;
    if (window === undefined) {
        const [top, right, bottom, left] = swap.window?.inset ?? [0, 0, 0, 0];
        window = {x: outer.x + left, y: outer.y + top, width: Math.max(0, outer.width - left - right), height: Math.max(0, outer.height - top - bottom)};
    }
    const step = band?.step ?? along(axis, window) + swap.gap;

    // 带上的几组，此刻的偏移：进行中的交换里的照旧；刚离开树的那组（第一次交换时是唯一的一组）与要换上的那组的项按这两帧的重取。
    const banded: Live[] = (band?.groups ?? []).map((group, index) => {
        const now = input.now[index] ?? group.offset;
        if (overlaps(group.leaves, leaving)) return {leaves: leaving, home: leavingHome, now};
        if (overlaps(group.leaves, entering)) return {leaves: entering, home: enteringHome, now};
        return {leaves: group.leaves, home: group.home, now};
    });
    const live = banded.some((group) => group.leaves === leaving) ? banded : [...banded, {leaves: leaving, home: leavingHome, now: 0}];
    // 要换上的那组已经在带上（滑出去一半又被点回来）：从它此刻的位置往回走；否则接在方向那头最外面那组的后面。
    let target = live.find((group) => group.leaves === entering);
    if (target === undefined) {
        const outermost = Math.max(...live.map((group) => swap.direction * group.now));
        target = {leaves: entering, home: enteringHome, now: swap.direction * (outermost + step)};
        live.push(target);
    }
    const delta = -target.now;
    const outside = (group: Live, offset: number): boolean => {
        const rect = unionRects(rectsOf(group.home));
        return rect === null || !rectsIntersect(shifted(rect, axis, offset), window as GridRect);
    };
    // 此刻与终点都在窗外的组摘掉；此刻看得见、终点在窗外的留着滑出去，过渡结束才摘。
    const kept = live.filter((group) => group === target || !(outside(group, group.now) && outside(group, group.now + delta)));

    const starts = new Map<string, GridRect>();
    const leavingItems: GridSwapLeavingItem[] = [];
    for (const group of kept) {
        const end = group.now + delta;
        for (const item of group.home) {
            if (item.rect === null) continue;
            starts.set(item.key, shifted(item.rect, axis, group.now));
            if (group === target || item.kind === "content") continue;
            if (item.kind === "leaf") {
                leavingItems.push({...item, rect: shifted(item.rect, axis, end), leaving: true});
                continue;
            }
            const sideLength = (id: string): number => {
                const rect = unionRects(leavesUnder(group.home, id).map((leaf) => leaf.rect));
                return rect === null ? 0 : along(item.axis, rect);
            };
            leavingItems.push({...item, rect: shifted(item.rect, axis, end), leaving: true, frozen: {beforePx: sideLength(item.before), afterPx: sideLength(item.after)}});
        }
    }
    return {
        kind: "swap",
        band: {
            axis,
            outer,
            window,
            radius: band?.radius ?? swap.window?.radius ?? null,
            step,
            groups: kept.map((group) => ({leaves: group.leaves, home: group.home, offset: group.now + delta})),
            target: kept.indexOf(target),
        },
        starts,
        leaving: leavingItems,
    };
}

/**
 * 新给的交换碰不碰进行中的带：离开或换上来的叶有一片在带的某一组里。碰的是重定向（滑到一半点回来、换到第三组）；不碰的是别处的另一次交换，
 * 网格同时只有一条带，要先把进行中的送到终点（`decideMotion` 的 `settleFirst`）。
 */
export function swapTouchesBand(swap: GridSwap, band: GridSwapBand): boolean {
    const ids = [...swap.leaving, ...swap.entering];
    return band.groups.some((group) => ids.some((id) => group.leaves.has(id)));
}

/** 元素在 `rect` 时裁切窗在它自己坐标里的位置（`clip-path`）。内缩可以为负：窗比元素大的那边不裁。 */
export function swapWindowClip(band: GridSwapBand, rect: GridRect): string {
    const {window} = band;
    const inset = [window.y - rect.y, rect.x + rect.width - (window.x + window.width), rect.y + rect.height - (window.y + window.height), window.x - rect.x];
    const round = band.radius === null ? "" : ` round ${band.radius.join(" ")}`;
    return `inset(${inset.map((value) => `${String(value)}px`).join(" ")}${round})`;
}

/** 这一项在交换里是换上来的（`in`）还是离开的（`out`）；不在带上为 undefined。 */
export function swapSides(band: GridSwapBand | null): ReadonlyMap<string, "in" | "out"> {
    const sides = new Map<string, "in" | "out">();
    band?.groups.forEach((group, index) => {
        for (const item of group.home) sides.set(item.key, index === band.target ? "in" : "out");
    });
    return sides;
}
