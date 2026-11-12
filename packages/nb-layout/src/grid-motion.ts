/**
 * 渲染序与过渡的起点（docs/specs/ui/nested-grid.md 的“按矩形摆放”“过渡”）：摆放（`grid-rects.ts`）之后，决定 DOM 里叶与分隔线的次序、
 * 要不要动、新出现的项从哪里开始。纯函数，不碰 DOM。消费者是 `useRenderOrder`、`useGridMotion`。
 */

import type {GridLayerItem, GridLeafPlacement, GridPathStep, GridPlacementItem, GridRect} from "./grid-rects";
import type {GridAxis} from "./grid-types";

/** 新叶第一帧的矩形：主轴宽度为 0，贴在不动的那条边上；内容已经是最终尺寸，外框长出来时露出它。 */
export function grownRect(rect: GridRect, grow: GridLeafPlacement<unknown>["grow"]): GridRect {
    if (grow === null) return rect;
    if (grow.axis === "width") return {...rect, x: grow.edge === "start" ? rect.x : rect.x + rect.width, width: 0};
    return {...rect, y: grow.edge === "start" ? rect.y : rect.y + rect.height, height: 0};
}

function unionRect(left: GridRect, right: GridRect): GridRect {
    const x = Math.min(left.x, right.x);
    const y = Math.min(left.y, right.y);
    return {x, y, width: Math.max(left.x + left.width, right.x + right.width) - x, height: Math.max(left.y + left.height, right.y + right.height) - y};
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
 */
export function settleFloatMoves<R>(items: ReadonlyArray<GridLayerItem<R>>, previous: ReadonlyArray<GridLayerItem<R>>): ReadonlyArray<GridLayerItem<R>> {
    const before = new Map(previous.map((item) => [item.key, item]));
    const stayed = new Set(items.flatMap((item) => {
        const old = before.get(item.key);
        return item.kind === "leaf" && item.float === true && old?.kind === "leaf" && old.float === true ? [item.node.id] : [];
    }));
    if (stayed.size === 0) return items;
    return items.map((item) => {
        const old = before.get(item.key);
        if (item.kind === "leaf" && old?.kind === "leaf" && stayed.has(item.node.id)) return {...item, rect: old.rect};
        if (item.kind === "content" && old?.kind === "content" && old.leaf === item.leaf && stayed.has(item.leaf)) return {...item, rect: old.rect};
        return item;
    });
}

/**
 * 这次过渡里内容跟着外框逐帧变化的项（`key`）：前后都有尺寸的叶与活动的内容项。新叶与从零出来的叶内容已经是最终尺寸，外框长出来时露出它，第一次摆放不用在零宽里排版；
 * 降到零的叶内容停放。
 */
export function followingLeaves(items: ReadonlyArray<GridLayerItem<unknown>>, previous: ReadonlyArray<GridLayerItem<unknown>>): ReadonlySet<string> {
    const hasSize = (rect: GridRect | null | undefined): boolean => rect != null && rect.width > 0 && rect.height > 0;
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
 * 这次过渡里要压在别的面板上面的项（`key`）：换了叶的内容项，以及新旧矩形不相交的叶和内容项（整块面板移到别处时叶没换，但一样飞过别的面板）。原地变宽变窄的不算。
 */
export function flyingContents(items: ReadonlyArray<GridLayerItem<unknown>>, previous: ReadonlyArray<GridLayerItem<unknown>>): ReadonlySet<string> {
    const before = new Map(previous.map((item) => [item.key, item]));
    const overlaps = (left: GridRect, right: GridRect): boolean => left.x < right.x + right.width && right.x < left.x + left.width && left.y < right.y + right.height && right.y < left.y + left.height;
    const flying = new Set<string>();
    for (const item of items) {
        if (item.kind === "sash" || (item.kind === "content" && !item.active)) continue;
        const old = before.get(item.key);
        const oldRect = old === undefined ? null : rectOf(old);
        const rect = rectOf(item);
        if (old === undefined || oldRect == null || rect === null || oldRect.width <= 0 || oldRect.height <= 0 || rect.width <= 0 || rect.height <= 0) continue;
        if ((item.kind === "content" && old.kind === "content" && old.leaf !== item.leaf) || !overlaps(oldRect, rect)) flying.add(item.key);
    }
    return flying;
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

/**
 * 新出现的项第一帧的矩形（`key` 到矩形），过渡从这里开始。
 *
 * 新叶按“最外层的新子树”长：从根往下找第一个新开出来的节点（上一帧没有、下面也没有一块旧叶、也不是顶替了上一帧同一个位置上的
 * 别的节点），它和它下面的叶、分隔线、内容作为一块，沿它在父分支里的主轴从零长出来，另一个方向一开始就是终点。所以区域展开时
 * 整列从挨着的兄弟之间横着长出来，列里的几节不各自竖着长（各自竖着长时整列一开始就是全宽，压在还没让开的编辑区上）。
 * 往下找的几种情形：拆分时包住旧叶的新分支下面有旧叶，新叶照旧从旧叶那边长；切换侧栏的容器时整列上一帧就在，或者一节换成一列
 * （顶替），换上来的几节各自在原来的位置里长。
 * 从哪条线长：上一帧它前后的兄弟挨着，就从那道缝（另一条边跟着让位的那一个走，不管让位的是前面的还是后面的）；否则不动的那条边
 * 按 `grownRect`：第一块的起点、其余的终点。
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
    /** 上一帧这两个兄弟之间夹着别的节点：它顶替了那个位置，不是新开出来的缝。分支一头的节点只看另一头。 */
    const replaces = (step: GridPathStep): boolean => (step.before !== null || step.after !== null) && seamBetween(step) === undefined
        && (step.before === null || oldSashes.some((sash) => sash.before === step.before))
        && (step.after === null || oldSashes.some((sash) => sash.after === step.after));
    /** 节点的终点矩形：它下面的叶的外接矩形。 */
    const nodeRects = new Map<string, GridRect>();
    for (const item of leaves) {
        for (const step of item.path) {
            const rect = nodeRects.get(step.id);
            nodeRects.set(step.id, rect === undefined ? item.rect : unionRect(rect, item.rect));
        }
    }
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
    // 新内容项、上一帧停放着的内容项（叶不在呈现里，或是切走的标签）跟着它的新叶从边上长出来：停放的内容早就挂着，不跟的话一显示就整块在终点，
    // 外框还在长（切回容器、区域展开）。上一帧显示着、换了叶的内容项不在这里：它从旧矩形飞过来。
    const before = new Map(previous.map((item) => [item.key, item]));
    for (const item of items) {
        if (item.kind !== "content" || item.rect === null) continue;
        const old = before.get(item.key);
        if (old !== undefined && old.kind === "content" && old.active && old.rect !== null) continue;
        const leaf = entering.get(`leaf:${item.leaf}`);
        if (leaf !== undefined) entering.set(item.key, {x: leaf.x, y: leaf.y + Math.min(item.insetTop, leaf.height), width: leaf.width, height: Math.max(0, leaf.height - item.insetTop)});
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
 * 离开的叶里要在过渡里留着缩回去的那些（docs/specs/ui/nested-grid.md 的“过渡”）：上一帧的叶，矩形换成缩到的终点，带 `leaving`。
 * 与 `enteringRects` 对称：从根往下找第一个这一帧没有、下面也没有留下的叶的节点，它和它下面的叶作为一块，沿它在父分支里的主轴缩回
 * 这一帧它前后兄弟相接的那道缝；它在分支一头、挨着的兄弟这一帧到了那一头时，缩向那一头。
 *
 * 只留这一种，其余照旧立即消失：兄弟没有合拢的（被顶替：切换容器时旧的几节缩、新的几节长，会叠在同一块地方）；下面一个挂着的内容项
 * 都没有的（关掉的编辑组，内容已经卸了，留着只是一张空卡片）。拖动中（`holding`：拿起了内容，或宿主说拖动在进行，例如视图被活动栏吸收、内容没拿起）
 * 一个都不留：来源的叶离开是拖动的一部分，留着的外框会被命中判定撞上，放下时又从缩回去的半路飞过来。
 */
export function leavingPlacements<R>(items: ReadonlyArray<GridLayerItem<R>>, previous: ReadonlyArray<GridLayerItem<R>>, holding: boolean): Array<LeafItem<R>> {
    if (holding) return [];
    const present = new Set(items.map((item) => item.key));
    const sashes = items.filter((item) => item.kind === "sash");
    const oldLeaves = previous.filter((item) => item.kind === "leaf");
    /** 这一帧的节点。 */
    const now = new Set(items.flatMap((item) => (item.kind === "leaf" ? [item.node.id, ...item.path.map((step) => step.id)] : [])));
    /** 这一帧还在的节点，以及上一帧下面有留下的叶的节点：都不算离开的子树，要往下找。 */
    const staying = new Set([...now, ...oldLeaves.filter((item) => present.has(item.key)).flatMap((item) => item.path.map((step) => step.id))]);
    /** 内容项还挂着的叶：停放（区域隐藏），不是卸掉（关掉）。 */
    const mounted = new Set(items.flatMap((item) => (item.kind === "content" ? [item.leaf] : [])));
    const seamNow = (step: GridPathStep) => sashes.find((sash) => sash.before === step.before && sash.after === step.after);
    /** 它离开后兄弟合拢了：前后的兄弟这一帧相接；或它在一头，挨着的兄弟还在、这一帧到了那一头。 */
    const closesUp = (step: GridPathStep): boolean => {
        if (seamNow(step) !== undefined) return true;
        if (step.after === null && step.before !== null) return now.has(step.before) && !sashes.some((sash) => sash.before === step.before);
        if (step.before === null && step.after !== null) return now.has(step.after) && !sashes.some((sash) => sash.after === step.after);
        return false;
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
        if (!leaves.some((leaf) => mounted.has(leaf.node.id))) continue;
        const seam = seamNow(step);
        let at: number;
        if (seam !== undefined) {
            at = step.axis === "width" ? seam.rect.x + seam.size : seam.rect.y + seam.size;
        } else {
            const rect = leaves.map((leaf) => leaf.rect).reduce(unionRect);
            const edge = grownRect(rect, {axis: step.axis, edge: step.before === null ? "start" : "end"});
            at = step.axis === "width" ? edge.x : edge.y;
        }
        for (const leaf of leaves) result.push({...leaf, rect: collapsed(leaf.rect, {axis: step.axis, at}), leaving: true});
    }
    return result;
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
