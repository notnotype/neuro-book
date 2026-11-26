/**
 * 渲染序与过渡的起点（docs/specs/ui/nested-grid.md 的“按矩形摆放”“过渡”）：摆放（`grid-rects.ts`）之后，决定 DOM 里叶与分隔线的次序、
 * 要不要动、新出现的项从哪里开始。纯函数，不碰 DOM。消费者是 `useRenderOrder`、`useGridMotion`。
 */

import {hasSize, rectsIntersect, unionRects, type GridContentPlacement, type GridLayerItem, type GridLeafPlacement, type GridPathStep, type GridPlacementItem, type GridRect} from "./grid-rects";
import type {GridAxis} from "./grid-types";

/** 新叶第一帧的矩形：主轴宽度为 0，贴在不动的那条边上；内容已经是最终尺寸，外框长出来时露出它。 */
export function grownRect(rect: GridRect, grow: GridLeafPlacement<unknown>["grow"]): GridRect {
    if (grow === null) return rect;
    if (grow.axis === "width") return {...rect, x: grow.edge === "start" ? rect.x : rect.x + rect.width, width: 0};
    return {...rect, y: grow.edge === "start" ? rect.y : rect.y + rect.height, height: 0};
}

/** 差不到这么多算没动：外壳落账后还有第二次发布，矩形可能差一两个取整。 */
const MOTION_TOLERANCE_PX = 1;

function nearlyEqual(left: GridRect, right: GridRect): boolean {
    return Math.abs(left.x - right.x) <= MOTION_TOLERANCE_PX && Math.abs(left.y - right.y) <= MOTION_TOLERANCE_PX
        && Math.abs(left.width - right.width) <= MOTION_TOLERANCE_PX && Math.abs(left.height - right.height) <= MOTION_TOLERANCE_PX;
}

const rectOf = (item: GridLayerItem<unknown>): GridRect | null => item.rect;

/**
 * 这次变化相对上一次有没有东西要动：叶与分隔线多了、少了，或矩形差得超过容差；活动的内容项换了矩形。内容项算进来，所以标签并入已有面板时两块叶都不动，内容也滑过去。
 * 内容项的多少不算：切标签、开新标签不是布局变化。只有上边因为 inset 变了也不算：编辑组的头高了一行（标签折行），内容要立刻让开，不是 470ms 的布局变化。
 */
export function placementMoved(items: ReadonlyArray<GridLayerItem<unknown>>, previous: ReadonlyArray<GridLayerItem<unknown>>): boolean {
    const structural = (list: ReadonlyArray<GridLayerItem<unknown>>): number => list.filter((item) => item.kind !== "content").length;
    if (structural(items) !== structural(previous)) return true;
    const before = new Map(previous.map((item) => [item.key, item]));
    /** inset 变了时只比左右与下边：上边让给头。 */
    const withoutTop = (rect: GridRect): GridRect => ({x: rect.x, y: rect.y + rect.height, width: rect.width, height: 0});
    return items.some((item) => {
        const old = before.get(item.key);
        const oldRect = old === undefined ? null : rectOf(old);
        if (item.kind === "content") {
            const rect = rectOf(item);
            if (!item.active || rect === null || oldRect == null) return false;
            const insetChanged = old?.kind === "content" && old.insetTop !== item.insetTop;
            return insetChanged ? !nearlyEqual(withoutTop(oldRect), withoutTop(rect)) : !nearlyEqual(oldRect, rect);
        }
        return oldRect == null || !nearlyEqual(oldRect, item.rect);
    });
}

/**
 * 只有浮动窗的矩形变了不算布局变化（移动、缩放是手势，不过渡）：同一块浮动窗和它还在里面的内容，矩形按上一次的算，判定就认不出变化。浮动窗出现、消失，内容进出浮动窗不在这里，照常过渡。
 * `animated` 里的窗（节点 id）不压：宿主标了 `animate`、这一次与上一次都不在手势里、不是刚松手的（docs/specs/ui/nested-grid.md 输出 105），它的矩形变化照常算布局变化。集合由 `NestedGrid` 算。
 */
export function settleFloatMoves<R>(items: ReadonlyArray<GridLayerItem<R>>, previous: ReadonlyArray<GridLayerItem<R>>, animated: ReadonlySet<string> = new Set()): ReadonlyArray<GridLayerItem<R>> {
    const before = new Map(previous.map((item) => [item.key, item]));
    const stayed = new Set(items.flatMap((item) => {
        const old = before.get(item.key);
        return item.kind === "leaf" && item.float === true && old?.kind === "leaf" && old.float === true && !animated.has(item.node.id) ? [item.node.id] : [];
    }));
    if (stayed.size === 0) return items;
    return items.map((item) => {
        const old = before.get(item.key);
        if (item.kind === "leaf" && old?.kind === "leaf" && stayed.has(item.node.id)) return {...item, rect: old.rect};
        if (item.kind === "content" && old?.kind === "content" && old.leaf === item.leaf && stayed.has(item.leaf)) return {...item, rect: old.rect, leafRect: old.leafRect};
        return item;
    });
}

/**
 * 这一次改了矩形、又不过渡的浮动窗（节点 id）：前后都是浮动窗、不在 `animated` 里（同 `settleFloatMoves` 压回去的那些），矩形真的变了。
 * 压回去只让判定认不出它的变化；别的窗或树这一轮在过渡时，过渡标记是整个网格的，它的新矩形照样会滑过去，所以 `NestedGrid` 拿这份名单让它这一次不带标记。
 */
export function floatRectJumps(items: ReadonlyArray<GridLayerItem<unknown>>, previous: ReadonlyArray<GridLayerItem<unknown>>, animated: ReadonlySet<string> = new Set()): ReadonlySet<string> {
    const before = new Map(previous.map((item) => [item.key, item]));
    const sameRect = (left: GridRect, right: GridRect): boolean => left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
    return new Set(items.flatMap((item) => {
        const old = before.get(item.key);
        return item.kind === "leaf" && item.float === true && old?.kind === "leaf" && old.float === true && !animated.has(item.node.id) && !sameRect(old.rect, item.rect) ? [item.node.id] : [];
    }));
}

/**
 * 这次过渡里内容跟着外框逐帧变化的项（`key`）：前后都有尺寸的叶与活动的内容项。新叶与从零出来的叶内容已经是最终尺寸，外框长出来时露出它，第一次摆放不用在零宽里排版；
 * 降到零的叶内容停放（`shrinkingLeaves`：过渡结束前还画着）。
 */
export function followingLeaves(items: ReadonlyArray<GridLayerItem<unknown>>, previous: ReadonlyArray<GridLayerItem<unknown>>): ReadonlySet<string> {
    const before = new Map(previous.map((item) => [item.key, rectOf(item)]));
    const following = new Set<string>();
    for (const item of items) {
        if (item.kind === "sash") continue;
        if (item.kind === "content" && !item.active) continue;
        if (hasSize(before.get(item.key)) && hasSize(rectOf(item))) following.add(item.key);
    }
    return following;
}

/**
 * 这次过渡里降到零的叶（节点 id）：上一帧有尺寸、这一帧为零，例如宿主把区域拖到零或隐藏（按拖到零画）。它们停放、不可交互，
 * 但过渡结束前头与内容还画着，跟着外框缩到零（贴着在动的那条边平移，`rightAnchored`），不是一开始就成了一张空卡片缩回去，和留着缩回去的离开的叶一样。
 * 按叶的矩形判：收成标题行的叶还有面板头那么高，不算。
 */
export function shrinkingLeaves(items: ReadonlyArray<GridLayerItem<unknown>>, previous: ReadonlyArray<GridLayerItem<unknown>>): ReadonlySet<string> {
    const before = new Map(previous.map((item) => [item.key, rectOf(item)]));
    const shrinking = new Set<string>();
    for (const item of items) if (item.kind === "leaf" && hasSize(before.get(item.key)) && !hasSize(item.rect)) shrinking.add(item.node.id);
    return shrinking;
}

/** 这一帧为零的叶（节点 id）：上一轮还在缩的叶，这一轮仍为零的接着画到过渡结束（`useGridMotion`），又长出来的不再算。 */
export function zeroLeaves(items: ReadonlyArray<GridLayerItem<unknown>>): ReadonlySet<string> {
    return new Set(items.flatMap((item) => (item.kind === "leaf" && !hasSize(item.rect) ? [item.node.id] : [])));
}

/**
 * 这次过渡里要压在别的面板上面的项（`key`）：换了叶的内容项，新旧矩形不相交的叶和内容项（整块面板移到别处时叶没换，但一样飞过别的面板），
 * 以及从浮动窗回到树里的叶和它的内容（窗盖在它要回去的位置上时新旧矩形相交，但它是从别的面板上面落下来的）。原地变宽变窄的不算。
 */
export function flyingContents(items: ReadonlyArray<GridLayerItem<unknown>>, previous: ReadonlyArray<GridLayerItem<unknown>>): ReadonlySet<string> {
    const before = new Map(previous.map((item) => [item.key, item]));
    const floatsOf = (list: ReadonlyArray<GridLayerItem<unknown>>): Set<string> => new Set(list.flatMap((item) => (item.kind === "leaf" && item.float === true ? [item.node.id] : [])));
    const wasFloat = floatsOf(previous);
    const isFloat = floatsOf(items);
    const docked = (leaf: string): boolean => wasFloat.has(leaf) && !isFloat.has(leaf);
    const flying = new Set<string>();
    for (const item of items) {
        if (item.kind === "sash" || (item.kind === "content" && !item.active)) continue;
        const old = before.get(item.key);
        const oldRect = old === undefined ? null : rectOf(old);
        const rect = rectOf(item);
        if (old === undefined || oldRect == null || rect === null || oldRect.width <= 0 || oldRect.height <= 0 || rect.width <= 0 || rect.height <= 0) continue;
        const leaf = item.kind === "leaf" ? item.node.id : item.leaf;
        if ((item.kind === "content" && old.kind === "content" && old.leaf !== item.leaf) || !rectsIntersect(oldRect, rect) || docked(leaf)) flying.add(item.key);
    }
    return flying;
}

/**
 * 这一次从浮动窗回到树里的叶（外框的 `key`）：上一帧是浮动窗、这一帧是树里的同一块叶。它们的投影、底色与圆角随这一轮的过渡淡去（docs/specs/ui/nested-grid.md 输出 110），
 * 要在带着过渡标记的那一次渲染里摘掉浮动窗的样子，见 `useGridMotion` 的 `docking`。
 */
export function dockedLeaves(items: ReadonlyArray<GridLayerItem<unknown>>, previous: ReadonlyArray<GridLayerItem<unknown>>): ReadonlySet<string> {
    const wasFloat = new Set(previous.flatMap((item) => (item.kind === "leaf" && item.float === true ? [item.key] : [])));
    return new Set(items.flatMap((item) => (item.kind === "leaf" && item.float !== true && wasFloat.has(item.key) ? [item.key] : [])));
}

/**
 * 松手的起点（docs/specs/ui/nested-grid.md 输出 172）：宿主拖动中用 `placeFloat` 挪过、刚放开的窗（`released`：id 到最后一次的偏移），这一次离开了 `floats`
 * （回到树里、并进别的叶、关掉）时，它要过渡的部分从松手时画着的位置出发：上一帧的外框矩形加偏移，上一帧属于它的活动内容同样加偏移（`key` 到矩形）。
 * 偏移在 `translate` 上、不在布局里，`placeFloat(id, null)` 清掉它之后，不给起点的话过渡从记录矩形（按下之前的位置）出发，窗先跳回去再飞。
 *
 * 这一次它还是浮动窗时不给，不比较矩形：`settleFloatMoves` 已把留在原处的浮动窗压回上一帧的矩形，按“等于上一帧加偏移”判永远不成立，
 * 移动的提交正好是这一种（窗停在拖到的位置，不过渡）。上一帧它不是浮动窗、偏移为零的也不给。
 */
export function releaseStarts(items: ReadonlyArray<GridLayerItem<unknown>>, previous: ReadonlyArray<GridLayerItem<unknown>>, released: ReadonlyMap<string, {readonly x: number; readonly y: number}>): Map<string, GridRect> {
    const starts = new Map<string, GridRect>();
    if (released.size === 0) return starts;
    const before = new Map(previous.map((item) => [item.key, item]));
    const floating = new Set(items.flatMap((item) => (item.kind === "leaf" && item.float === true ? [item.node.id] : [])));
    for (const [id, offset] of released) {
        if (offset.x === 0 && offset.y === 0) continue;
        const old = before.get(`leaf:${id}`);
        if (old?.kind !== "leaf" || old.float !== true || floating.has(id)) continue;
        const shifted = (rect: GridRect): GridRect => ({...rect, x: rect.x + offset.x, y: rect.y + offset.y});
        starts.set(old.key, shifted(old.rect));
        for (const item of previous) if (item.kind === "content" && item.leaf === id && item.active && item.rect !== null) starts.set(item.key, shifted(item.rect));
    }
    return starts;
}

/**
 * 这一次用掉了松手偏移的窗（docs/specs/ui/nested-grid.md 输出 172，`released` 里的 id）：离开了 `floats`（回到树里、并进别的叶、关掉，起点由 `releaseStarts` 给），
 * 或仍是浮动窗、矩形变了（宿主发布了整窗移动的结果，窗就停在拖到的位置，偏移已经在矩形里）。别的变化不算：只撤了手势、别的窗或树变了，
 * 同一帧里稍后发布的停靠还要从松手处出发；后一种也不能留着，不然之后同一帧的停靠在已经挪过去的矩形上再加一次偏移。
 */
export function consumedReleases(items: ReadonlyArray<GridLayerItem<unknown>>, previous: ReadonlyArray<GridLayerItem<unknown>>, released: ReadonlyMap<string, unknown>): ReadonlySet<string> {
    const leafOf = (list: ReadonlyArray<GridLayerItem<unknown>>, id: string) => list.find((item) => item.kind === "leaf" && item.key === `leaf:${id}`);
    const sameRect = (left: GridRect, right: GridRect): boolean => left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
    const consumed = new Set<string>();
    for (const id of released.keys()) {
        const now = leafOf(items, id);
        const old = leafOf(previous, id);
        if (now?.kind !== "leaf" || now.float !== true || (old?.kind === "leaf" && !sameRect(old.rect, now.rect))) consumed.add(id);
    }
    return consumed;
}

type LeafItem<R> = Extract<GridPlacementItem<R>, {readonly kind: "leaf"}>;

/** 整棵新子树一起长时的起点：沿 `axis` 压成零，压在 `at` 这条线上，另一个方向保持终点。 */
interface Collapse {
    readonly axis: GridAxis;
    readonly at: number;
}

function collapsed(rect: GridRect, collapse: Collapse): GridRect {
    return collapse.axis === "width" ? {...rect, x: collapse.at, width: 0} : {...rect, y: collapse.at, height: 0};
}

/** 每个节点（叶与分支）的矩形：它下面的叶的外接矩形。 */
function nodeRectsOf(items: ReadonlyArray<GridLayerItem<unknown>>): Map<string, GridRect> {
    const rects = new Map<string, GridRect>();
    for (const item of items) {
        if (item.kind !== "leaf") continue;
        for (const id of [item.node.id, ...item.path.map((step) => step.id)]) {
            const rect = rects.get(id);
            rects.set(id, rect === undefined ? item.rect : unionRects([rect, item.rect]));
        }
    }
    return rects;
}

const startOf = (rect: GridRect, axis: GridAxis): number => (axis === "width" ? rect.x : rect.y);
const endOf = (rect: GridRect, axis: GridAxis): number => (axis === "width" ? rect.x + rect.width : rect.y + rect.height);

/**
 * 分支一头的节点（`step` 只有一个兄弟）和那个兄弟在 `axis` 上是不是一头挨着另一头的边：兄弟的矩形 `neighbor` 伸到了 `rect` 远的那条边。
 * 按矩形判，不按分隔线：节点出现、消失时它所在的分支可能被建出来或摊平（底部面板和编辑区的纵向分支，只剩编辑区时摊进横向那一行），
 * 兄弟换了分支，它在新分支里挨着谁和这里无关。
 */
function reachesEnd(step: GridPathStep, neighbor: GridRect | undefined, rect: GridRect): boolean {
    if (neighbor === undefined) return false;
    if (step.after === null) return endOf(neighbor, step.axis) >= endOf(rect, step.axis) - MOTION_TOLERANCE_PX;
    return startOf(neighbor, step.axis) <= startOf(rect, step.axis) + MOTION_TOLERANCE_PX;
}

/**
 * 新出现的项第一帧的矩形（`key` 到矩形），过渡从这里开始。
 *
 * 新叶按“最外层的新子树”长：从根往下找第一个新开出来的节点（上一帧没有、下面也没有一块旧叶、也不是顶替了上一帧同一个位置上的
 * 别的节点），它和它下面的叶、分隔线作为一块，沿它在父分支里的主轴从零长出来，另一个方向一开始就是终点。所以区域展开时
 * 整列从挨着的兄弟之间横着长出来，列里的几节不各自竖着长（各自竖着长时整列一开始就是全宽，压在还没让开的编辑区上）。
 * 往下找的几种情形：拆分时包住旧叶的新分支下面有旧叶，新叶照旧从旧叶那边长；切换侧栏的容器时整列上一帧就在，或者一节换成一列
 * （顶替），换上来的几节各自在原来的位置里长。
 * 从哪条线长：上一帧它前后的兄弟挨着，就从那道缝（另一条边跟着让位的那一个走，不管让位的是前面的还是后面的）；否则不动的那条边
 * 按 `grownRect`：第一块的起点、其余的终点。新叶里的内容项不在这里：它按叶的矩形摆，起点就是叶的（`keptSizeStarts`）。
 *
 * 分隔线的身份是前后节点，结构一变就是新元素，没有上一帧可接：新子树里面的跟着子树压成零；挨着同一个节点的旧分隔线在哪就从哪出发；
 * 否则从挨着的新叶的起点出发，这样线跟着外框的边走，不会一开始就压在内容上。
 */
export function enteringRects(items: ReadonlyArray<GridLayerItem<unknown>>, previous: ReadonlyArray<GridLayerItem<unknown>>): ReadonlyMap<string, GridRect> {
    const known = new Set(previous.map((item) => item.key));
    const oldSashes = previous.filter((item) => item.kind === "sash");
    const entering = new Map<string, GridRect>();

    const leaves = items.filter((item) => item.kind === "leaf");
    /** 上一帧就在的节点，以及下面还有旧叶的节点。 */
    const settled = new Set([...previous, ...leaves.filter((item) => known.has(item.key))].flatMap((item) => (item.kind === "leaf" ? item.path.map((step) => step.id) : [])));
    const seamBetween = (step: GridPathStep) => oldSashes.find((sash) => sash.before === step.before && sash.after === step.after);
    /** 节点的终点矩形与上一帧的矩形。 */
    const nodeRects = nodeRectsOf(leaves);
    const oldNodeRects = nodeRectsOf(previous);
    /**
     * 它顶替了上一帧同一个位置上的别的节点，不是新开出来的：两头都有兄弟时，上一帧两个兄弟之间夹着别的节点（没有直接相接的缝）；
     * 在分支一头时，挨着的兄弟上一帧没伸到它现在的远边（那里本来有别的东西）。兄弟上一帧不在的不算。
     */
    const replaces = (step: GridPathStep): boolean => {
        if (step.before === null && step.after === null) return false;
        if (step.before !== null && step.after !== null) {
            return seamBetween(step) === undefined && oldSashes.some((sash) => sash.before === step.before) && oldSashes.some((sash) => sash.after === step.after);
        }
        const neighbor = oldNodeRects.get((step.before ?? step.after) as string);
        return neighbor !== undefined && !reachesEnd(step, neighbor, nodeRects.get(step.id) as GridRect);
    };
    /** 新子树里的节点（子树的根与它下面的分支、叶）到它们共同的起点。 */
    const collapseOf = new Map<string, Collapse>();
    const seamOf = (step: GridPathStep): Collapse => {
        const seam = seamBetween(step);
        if (seam !== undefined) return {axis: step.axis, at: step.axis === "width" ? seam.rect.x + seam.size : seam.rect.y + seam.size};
        const fixed = grownRect(nodeRects.get(step.id) as GridRect, {axis: step.axis, edge: step.before === null ? "start" : "end"});
        return {axis: step.axis, at: step.axis === "width" ? fixed.x : fixed.y};
    };
    for (const item of leaves) {
        if (known.has(item.key)) continue;
        const top = item.path.findIndex((step) => !settled.has(step.id) && !replaces(step));
        if (top < 0) {
            // 叶自己顶替了别的叶（位置里本来有东西），或是根上的叶（没有兄弟，第一帧就是终点）。
            entering.set(item.key, grownRect(item.rect, item.grow));
            continue;
        }
        const root = item.path[top] as GridPathStep;
        const collapse = collapseOf.get(root.id) ?? seamOf(root);
        for (const step of item.path.slice(top)) collapseOf.set(step.id, collapse);
        entering.set(item.key, collapsed(item.rect, collapse));
    }
    for (const item of items) {
        if (item.kind !== "sash" || known.has(item.key)) continue;
        const inside = collapseOf.get(item.branch.id);
        if (inside !== undefined) {
            entering.set(item.key, collapsed(item.rect, inside));
            continue;
        }
        const old = oldSashes.find((sash) => sash.before === item.before) ?? oldSashes.find((sash) => sash.after === item.after);
        const position = (rect: GridRect, offset: number): GridRect => (item.axis === "width" ? {...item.rect, x: rect.x + offset} : {...item.rect, y: rect.y + offset});
        if (old !== undefined) {
            entering.set(item.key, position(old.rect, 0));
            continue;
        }
        const beforeLeaf = entering.get(`leaf:${item.before}`);
        const afterLeaf = entering.get(`leaf:${item.after}`);
        if (beforeLeaf !== undefined) entering.set(item.key, position(beforeLeaf, item.axis === "width" ? beforeLeaf.width : beforeLeaf.height));
        else if (afterLeaf !== undefined) entering.set(item.key, position(afterLeaf, -item.size));
    }
    return entering;
}

/**
 * 新开的浮动窗从哪里出发（docs/specs/ui/nested-grid.md 输出 107）：窗的叶上一帧没有，它的活动内容上一帧活动着、有尺寸，在另一块叶里；
 * 起点是那块叶上一帧的矩形（`key` 到矩形），整张卡片从原来的位置拿起来，和内容同一个起点、同一个终点。
 * 按 `enteringRects`，浮动窗没有兄弟，第一帧就画在终点，内容从旧矩形单独飞过去，两张卡片错开。
 *
 * 只管浮动窗：回到树里的窗沿用同一块叶（宿主不换 id），本来就从窗的位置飞回去。内容上一帧停放着、没有尺寸的不算（收成标题行的分节），
 * 那时内容不跟外框，外框从标题行长出来、内容一下子在终点。拖动中不用（`decideMotion`）：落地的起点是卡片的矩形（`useGridMotion` 的 `land`）。
 * 起点是布局里的矩形，不是此刻画着的位置：别的过渡还没走完时开窗，内容从它半路的位置出发，外框从终点出发，一路错开，随过渡收拢。
 */
export function floatLiftStarts(items: ReadonlyArray<GridLayerItem<unknown>>, previous: ReadonlyArray<GridLayerItem<unknown>>): ReadonlyMap<string, GridRect> {
    const known = new Set(previous.map((item) => item.key));
    const floats = new Set(items.flatMap((item) => (item.kind === "leaf" && item.float === true && !known.has(item.key) ? [item.node.id] : [])));
    const before = new Map(previous.flatMap((item) => (item.kind === "content" ? [[item.key, item] as const] : [])));
    const starts = new Map<string, GridRect>();
    for (const item of items) {
        if (item.kind !== "content" || !item.active || !floats.has(item.leaf)) continue;
        const old = before.get(item.key);
        if (old === undefined || !old.active || !hasSize(old.rect) || !hasSize(old.leafRect)) continue;
        starts.set(`leaf:${item.leaf}`, old.leafRect);
    }
    return starts;
}

/**
 * 离开的叶里要在过渡里留着缩回去的那些（docs/specs/ui/nested-grid.md 输出 45、46）：上一帧的叶，矩形换成缩到的终点，带 `leaving`。
 * 与 `enteringRects` 对称：从根往下找第一个这一帧没有、下面也没有留下的叶的节点，它和它下面的叶作为一块，沿它在父分支里的主轴缩回
 * 这一帧它前后兄弟相接的那道缝；它在分支一头、挨着的兄弟这一帧到了那一头时，缩向那一头。
 *
 * 只留这一种，其余照旧立即消失：兄弟没有合拢的（被顶替：切换容器时旧的几节缩、新的几节长，会叠在同一块地方）；下面一个挂着的内容项
 * 都没有的（关掉的编辑组，内容已经卸了，留着只是一张空卡片），除非宿主把它列进 `keepEmpty`（没有内容、但外框本身就是要看的东西，例如侧轨：
 * 它随区域收走时也要缩到零再摘，docs/specs/ui/nested-grid.md 输出 45）。拖动中（`holding`：拿起了内容，或宿主说拖动在进行，例如视图被活动栏吸收、内容没拿起）
 * 一个都不留：来源的叶离开是拖动的一部分，留着的外框会被命中判定撞上，放下时又从缩回去的半路飞过来。
 */
export function leavingPlacements<R>(items: ReadonlyArray<GridLayerItem<R>>, previous: ReadonlyArray<GridLayerItem<R>>, holding: boolean, keepEmpty: ReadonlySet<string> = new Set()): Array<LeafItem<R>> {
    if (holding) return [];
    const present = new Set(items.map((item) => item.key));
    const sashes = items.filter((item) => item.kind === "sash");
    const oldLeaves = previous.filter((item) => item.kind === "leaf");
    /** 这一帧的节点。 */
    const now = new Set(items.flatMap((item) => (item.kind === "leaf" ? [item.node.id, ...item.path.map((step) => step.id)] : [])));
    /** 这一帧还在的节点，以及上一帧下面有留下的叶的节点：都不算离开的子树，要往下找。 */
    const staying = new Set([...now, ...oldLeaves.filter((item) => present.has(item.key)).flatMap((item) => item.path.map((step) => step.id))]);
    /**
     * 内容项还挂着的叶：停放（区域隐藏），不是卸掉（关掉）。宿主这一轮去掉、标了留住的活动内容项也算（输出 155）：叶与内容同一轮被删时，
     * 内容要等叶留下才留得住，所以这里按上一帧的内容项判，不等内容层。
     */
    const mounted = new Set(items.flatMap((item) => (item.kind === "content" ? [item.leaf] : [])));
    for (const item of previous) if (item.kind === "content" && item.retain === true && item.active && !present.has(item.key)) mounted.add(item.leaf);
    const seamNow = (step: GridPathStep) => sashes.find((sash) => sash.before === step.before && sash.after === step.after);
    const nowRects = nodeRectsOf(items);
    const oldRects = nodeRectsOf(previous);
    /** 它离开后兄弟合拢了：前后的兄弟这一帧相接；或它在一头，挨着的兄弟这一帧伸到了它原来的远边。 */
    const closesUp = (step: GridPathStep): boolean => {
        if (seamNow(step) !== undefined) return true;
        if ((step.before === null) === (step.after === null)) return false;
        return reachesEnd(step, nowRects.get((step.before ?? step.after) as string), oldRects.get(step.id) as GridRect);
    };

    /** 离开的子树（最外层节点的 id）到它下面离开的叶。 */
    const groups = new Map<string, {step: GridPathStep; leaves: Array<LeafItem<R>>}>();
    for (const item of oldLeaves) {
        if (present.has(item.key) || item.leaving === true) continue;
        const top = item.path.find((step) => !staying.has(step.id));
        if (top === undefined || !closesUp(top)) continue;
        const group = groups.get(top.id) ?? {step: top, leaves: []};
        group.leaves.push(item);
        groups.set(top.id, group);
    }
    const result: Array<LeafItem<R>> = [];
    for (const {step, leaves} of groups.values()) {
        if (!leaves.some((leaf) => mounted.has(leaf.node.id) || keepEmpty.has(leaf.node.id))) continue;
        const seam = seamNow(step);
        let at: number;
        if (seam !== undefined) {
            at = step.axis === "width" ? seam.rect.x + seam.size : seam.rect.y + seam.size;
        } else {
            // 组里至少有一片叶（上面按叶建的组）。
            const rect = unionRects(leaves.map((leaf) => leaf.rect))!;
            const edge = grownRect(rect, {axis: step.axis, edge: step.before === null ? "start" : "end"});
            at = step.axis === "width" ? edge.x : edge.y;
        }
        for (const leaf of leaves) result.push({...leaf, rect: collapsed(leaf.rect, {axis: step.axis, at}), leaving: true});
    }
    return result;
}

/**
 * 宿主这一轮去掉、要留到过渡结束的内容项（docs/specs/ui/nested-grid.md 输出 155）：上一帧的内容项，标了留住（`retain`），这一帧不在，
 * 它的叶这一轮在缩回去（`outgoing`：留着缩回的离开的叶、降到零的叶）。返回上一帧的那一项，带 `leaving`；矩形由内容层按这一帧的叶重算。
 * 只留活动的：不活动的本来就藏着，留着只是推迟宿主组件的卸载。拖动中一个都不留（同 `leavingPlacements`）。
 */
export function leavingContents(items: ReadonlyArray<GridLayerItem<unknown>>, previous: ReadonlyArray<GridLayerItem<unknown>>, outgoing: ReadonlySet<string>, holding: boolean): GridContentPlacement[] {
    if (holding) return [];
    const present = new Set(items.map((item) => item.key));
    return previous.flatMap((item) => (item.kind === "content" && item.retain === true && item.active && !present.has(item.key) && outgoing.has(item.leaf) ? [{...item, leaving: true as const}] : []));
}

/**
 * 这一轮内容不跟外框的叶（新叶、从零出来的、降到零的、留着缩回去的）和它们第一帧的矩形（`key` 到矩形）。
 *
 * 这些叶的内容项按叶的矩形摆，内容体往下挪一个面板头（`NestedGrid` 的内容层）：内容外层的上边就是外框的上边，叶从零长出来、缩到零时
 * 内容也一直紧贴面板头下面。按内容自己的矩形（叶减去面板头）过渡不行：叶比面板头矮时那个矩形贴在叶的底边，两头之间线性插值，
 * 上边比外框慢一个面板头，内容先压住面板头再追上去。
 * 换成这种摆法的那一帧不能带过渡，否则内容体一下子挪下去、外层的上边慢慢走，内容先掉一个面板头再飘回来。所以每块都要有起点：
 * 新叶是 `enteringRects` 的起点，别的是上一帧的矩形（外框画在原处，没有变化）。
 */
export function keptSizeStarts(input: {
    readonly items: ReadonlyArray<GridLayerItem<unknown>>;
    readonly previous: ReadonlyArray<GridLayerItem<unknown>>;
    readonly entering: ReadonlyMap<string, GridRect>;
    readonly following: ReadonlySet<string>;
    readonly leaving: ReadonlyArray<GridLayerItem<unknown>>;
}): ReadonlyMap<string, GridRect> {
    const before = new Map(input.previous.map((item) => [item.key, rectOf(item)]));
    const starts = new Map<string, GridRect>();
    // 留着缩回去的叶的起点是上一帧的矩形，终点是它缩成的那条线。
    for (const item of [...input.items, ...input.leaving]) {
        if (item.kind !== "leaf" || input.following.has(item.key)) continue;
        const from = input.entering.get(item.key) ?? before.get(item.key);
        if (from != null) starts.set(item.key, from);
    }
    return starts;
}

/**
 * 过渡中内容贴着外框右边的项（docs/specs/ui/nested-grid.md 输出 39）：`keptSizeStarts` 里的叶和它们的内容项，外框只有右边在动时
 * （从左边长出来、缩向左边）贴着右边，整块跟着平移进出，不是被外框像幕布一样拉开、盖上。左边在动时（从右边长出来、缩向右边）贴左边
 * 本来就跟着它走，两条边都动的也贴左边，都不用记。
 *
 * 只管横向。纵向贴下边要在面板头那一条里也画内容（叶从上边长出来、比内容矮的时候），而那一条要裁掉才不挡面板头的指针；切换容器时
 * 换上来的第一节、往上拆分照旧从上往下露出来，留给切换容器的动画一起定。
 *
 * 内容项随它的叶。换了叶、正飞过去的内容项不随：它从旧矩形整块飞过来。
 */
export function rightAnchored(input: {
    readonly items: ReadonlyArray<GridLayerItem<unknown>>;
    readonly leaving: ReadonlyArray<GridLayerItem<unknown>>;
    readonly starts: ReadonlyMap<string, GridRect>;
    readonly following: ReadonlySet<string>;
    readonly flying: ReadonlySet<string>;
}): ReadonlySet<string> {
    const near = (left: number, right: number): boolean => Math.abs(left - right) <= MOTION_TOLERANCE_PX;
    /** 左边不动、右边在动。 */
    const rightMoves = (from: GridRect, to: GridRect): boolean => near(from.x, to.x) && !near(from.x + from.width, to.x + to.width);
    const anchored = new Set<string>();
    for (const item of [...input.items, ...input.leaving]) {
        const from = item.kind === "leaf" ? input.starts.get(item.key) : undefined;
        if (from !== undefined && rightMoves(from, item.rect as GridRect)) anchored.add(item.key);
    }
    for (const item of input.items) {
        if (item.kind === "content" && !input.following.has(item.key) && !input.flying.has(item.key) && anchored.has(`leaf:${item.leaf}`)) anchored.add(item.key);
    }
    return anchored;
}


/**
 * 渲染序列：已有的保持相对次序，新的紧接在树序里排在它前面的已有项之后。Vue 带 key 的 `v-for` 在中间插入不搬已有节点，只有
 * 已有项相对次序变了才会搬（搬一次滚动就丢），所以拆分与关闭之后这个序列仍等于树序，只有换位置之后才不等。
 */
export function stableOrder(previous: ReadonlyArray<string>, treeOrder: ReadonlyArray<string>): string[] {
    const alive = new Set(treeOrder);
    const result = previous.filter((key) => alive.has(key));
    const placed = new Set(result);
    treeOrder.forEach((key, index) => {
        if (placed.has(key)) return;
        let at = 0;
        for (let before = index - 1; before >= 0; before -= 1) {
            const found = result.indexOf(treeOrder[before] as string);
            if (found !== -1) {
                at = found + 1;
                break;
            }
        }
        result.splice(at, 0, key);
        placed.add(key);
    });
    return result;
}
