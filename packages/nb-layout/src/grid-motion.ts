/**
 * 渲染序与过渡的起点（docs/specs/ui/nested-grid.md 的“按矩形摆放”“过渡”）：摆放（`grid-rects.ts`）之后，决定 DOM 里叶与分隔线的次序、
 * 要不要动、新出现的项从哪里开始。纯函数，不碰 DOM。消费者是 `useRenderOrder`、`useGridMotion`。
 */

import type {GridLeafPlacement, GridPlacementItem, GridRect} from "./grid-rects";
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

/** 这次变化相对上一次有没有东西要动：多了、少了，或矩形差得超过容差。 */
export function placementMoved(items: ReadonlyArray<GridPlacementItem<unknown>>, previous: ReadonlyArray<GridPlacementItem<unknown>>): boolean {
    if (items.length !== previous.length) return true;
    const before = new Map(previous.map((item) => [item.key, item.rect]));
    return items.some((item) => {
        const old = before.get(item.key);
        return old === undefined || !nearlyEqual(old, item.rect);
    });
}

/**
 * 新出现的项第一帧的矩形（`key` 到矩形），过渡从这里开始。新叶从不动的那条边长出来。分隔线的身份是前后节点，结构一变就是新元素，
 * 没有上一帧可接：挨着同一个节点的旧分隔线在哪就从哪出发，否则从挨着的新叶的起点出发，这样线跟着外框的边走，不会一开始就压在内容上。
 */
export function enteringRects(items: ReadonlyArray<GridPlacementItem<unknown>>, previous: ReadonlyArray<GridPlacementItem<unknown>>): ReadonlyMap<string, GridRect> {
    const known = new Set(previous.map((item) => item.key));
    const oldSashes = previous.filter((item) => item.kind === "sash");
    const entering = new Map<string, GridRect>();
    for (const item of items) {
        if (item.kind === "leaf" && !known.has(item.key)) entering.set(item.key, grownRect(item.rect, item.grow));
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
