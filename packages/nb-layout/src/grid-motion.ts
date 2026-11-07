/**
 * 渲染序与过渡的起点（docs/specs/ui/nested-grid.md 的“按矩形摆放”“过渡”）：摆放（`grid-rects.ts`）之后，决定 DOM 里叶与分隔线的次序、
 * 要不要动、新出现的项从哪里开始。纯函数，不碰 DOM。消费者是 `useRenderOrder`、`useGridMotion`。
 */

import type {GridLayerItem, GridLeafPlacement, GridRect} from "./grid-rects";
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

/**
 * 新出现的项第一帧的矩形（`key` 到矩形），过渡从这里开始。新叶从不动的那条边长出来。分隔线的身份是前后节点，结构一变就是新元素，
 * 没有上一帧可接：挨着同一个节点的旧分隔线在哪就从哪出发，否则从挨着的新叶的起点出发，这样线跟着外框的边走，不会一开始就压在内容上。
 */
export function enteringRects(items: ReadonlyArray<GridLayerItem<unknown>>, previous: ReadonlyArray<GridLayerItem<unknown>>): ReadonlyMap<string, GridRect> {
    const known = new Set(previous.map((item) => item.key));
    const oldSashes = previous.filter((item) => item.kind === "sash");
    const entering = new Map<string, GridRect>();
    for (const item of items) {
        if (item.kind === "leaf" && !known.has(item.key)) entering.set(item.key, grownRect(item.rect, item.grow));
    }
    // 新内容项跟着它的新叶从边上长出来。换了叶的内容项不在这里：它有上一帧，从旧矩形飞过来。
    for (const item of items) {
        if (item.kind !== "content" || known.has(item.key) || item.rect === null) continue;
        const leaf = entering.get(`leaf:${item.leaf}`);
        if (leaf !== undefined) entering.set(item.key, {x: leaf.x, y: leaf.y + Math.min(item.insetTop, leaf.height), width: leaf.width, height: Math.max(0, leaf.height - item.insetTop)});
    }
    for (const item of items) {
        if (item.kind !== "sash" || known.has(item.key)) continue;
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
