/**
 * 布局结果 → 矩形（docs/specs/ui/nested-grid.md 的“按矩形摆放”“取整”）：`NestedGrid` 把叶与分隔线放在同一父元素下，
 * 它们的位置都从这里来。纯函数，不碰 DOM。坐标是相对 grid 根的 CSS px。
 *
 * 取整在设备像素上做，不对每条边各自取整：缝宽乘设备像素比不是整数时，各自取整会让相邻两条缝差一个设备像素（缝 1px 在
 * dpr 1.25 下约 58% 的容器宽度不等）。所以沿主轴累加：叶的终点取整，缝宽取整后固定，下一块从“上一块的终点加缝宽”开始。
 * 前提是 grid 根的左上角在设备像素格上：外壳的根是窗口原点，内层 grid 的外框已经取过整。
 */

import type {GridAxis, GridBranch, GridExtent, GridLayoutResult, GridLeaf, GridNode} from "./grid-types";

export interface GridRect {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/** 分隔线在长轴两端挨着的外层分隔线（`<分支 id>:<序号>`）；挨着的是 grid 外缘或自由端时为 null。 */
export interface GridSashEnds {
    readonly start: string | null;
    readonly end: string | null;
}

export interface GridLeafPlacement<R> {
    /** 渲染序列里的身份。 */
    readonly key: string;
    readonly node: GridLeaf<R>;
    readonly rect: GridRect;
    /** 新出现时不动的那条边：另一条边跟着让位的兄弟走。根上的叶没有兄弟，为 null。 */
    readonly grow: {readonly axis: GridAxis; readonly edge: "start" | "end"} | null;
}

export interface GridSashPlacement<R> {
    /** 渲染序列里的身份：前后节点 id。序号会随插入与删除变，按序号做 key 会让元素滑到别的边界上。 */
    readonly key: string;
    /** 手势与 `data-sash` 的身份：`<分支 id>:<序号>`。 */
    readonly sashKey: string;
    readonly branch: GridBranch<R>;
    readonly index: number;
    readonly axis: GridAxis;
    readonly rect: GridRect;
    /** 这条缝的占用（CSS px），已取整；0 是不可交互的接缝。 */
    readonly size: number;
    readonly before: string;
    readonly after: string;
    /** 前一块里最后一个叶：`aria-controls` 指向它的外框。 */
    readonly controls: string;
    readonly ends: GridSashEnds;
    /** 所属分支的主轴长度：`aria-valuemax` 的上限。 */
    readonly branchLength: number;
}

export type GridPlacementItem<R> = ({readonly kind: "leaf"} & GridLeafPlacement<R>) | ({readonly kind: "sash"} & GridSashPlacement<R>);

export interface GridPlacement<R> {
    /** 树序：叶与分隔线交替。 */
    readonly items: ReadonlyArray<GridPlacementItem<R>>;
}

/** 与 `Splitter` 的缺省相同：空布局（还没量到容器）时树已经在，`sashSizes` 没有这个分支。 */
const DEFAULT_SASH_SIZE = 1;

/** 分支四边挨着的外层分隔线键；挨着 grid 外缘时为 null。 */
interface BranchEdges {
    readonly top: string | null;
    readonly right: string | null;
    readonly bottom: string | null;
    readonly left: string | null;
}

const NO_EDGES: BranchEdges = {top: null, right: null, bottom: null, left: null};

/** 设备像素上的盒，加上它在主轴累加时用的理想起点（CSS px，没取整）。 */
interface DeviceBox {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly idealLeft: number;
    readonly idealTop: number;
}

const clean = (value: number | undefined): number => (value !== undefined && Number.isFinite(value) && value > 0 ? value : 0);

function lastLeafOf<R>(node: GridNode<R>): string {
    let current = node;
    while (current.kind === "branch") {
        const last = current.children.at(-1);
        if (last === undefined) return current.id;
        current = last;
    }
    return current.id;
}

export function placeGrid<R>(node: GridNode<R>, layout: GridLayoutResult, extent: GridExtent, dpr: number): GridPlacement<R> {
    const scale = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    const items: Array<GridPlacementItem<R>> = [];
    const toRect = (left: number, top: number, right: number, bottom: number): GridRect => ({x: left / scale, y: top / scale, width: (right - left) / scale, height: (bottom - top) / scale});

    const place = (current: GridNode<R>, box: DeviceBox, edges: BranchEdges, grow: GridLeafPlacement<R>["grow"]): void => {
        if (current.kind === "leaf") {
            items.push({kind: "leaf", key: `leaf:${current.id}`, node: current, rect: toRect(box.left, box.top, box.right, box.bottom), grow});
            return;
        }
        placeBranch(current, box, edges);
    };

    const placeBranch = (branch: GridBranch<R>, box: DeviceBox, edges: BranchEdges): void => {
        const horizontal = branch.orientation === "horizontal";
        const axis: GridAxis = horizontal ? "width" : "height";
        const sashes = layout.sashSizes[branch.id] ?? [];
        const sashSize = (index: number): number => clean(sashes[index] ?? DEFAULT_SASH_SIZE);
        const mainOf = (child: GridNode<R>): number => clean(layout.sizes[child.id]?.[axis]);
        const boxStart = horizontal ? box.left : box.top;
        const boxEnd = horizontal ? box.right : box.bottom;
        const {children} = branch;

        // 0px 的边界没有线、也不会亮：它和它那一侧的兄弟都是 0 时，子节点这条边其实就是分支的边，沿用外层的；那一侧的兄弟有
        // 尺寸时，挨着的是兄弟的内容，这一端是自由端。
        const edgeOf = (sash: number, siblings: ReadonlyArray<GridNode<R>>, outer: string | null): string | null => {
            if (sashSize(sash) > 0) return `${branch.id}:${sash}`;
            return siblings.every((sibling) => mainOf(sibling) <= 0) ? outer : null;
        };
        const outerBefore = horizontal ? edges.left : edges.top;
        const outerAfter = horizontal ? edges.right : edges.bottom;
        const childEdges = (index: number): BranchEdges => {
            const before = index > 0 ? edgeOf(index - 1, children.slice(0, index), outerBefore) : outerBefore;
            const after = index < children.length - 1 ? edgeOf(index, children.slice(index + 1), outerAfter) : outerAfter;
            return horizontal ? {...edges, left: before, right: after} : {...edges, top: before, bottom: after};
        };
        const ends: GridSashEnds = horizontal ? {start: edges.top, end: edges.bottom} : {start: edges.left, end: edges.right};

        let ideal = horizontal ? box.idealLeft : box.idealTop;
        let position = boxStart;
        children.forEach((child, index) => {
            const size = mainOf(child);
            const idealEnd = ideal + size;
            const isLast = index === children.length - 1;
            // 尺寸是 0 的叶不因为取整多出一个设备像素，否则停放判不出来。
            let end = size <= 0 ? position : Math.max(position, Math.round(idealEnd * scale));
            // 布局的合计有浮点误差：差不到一个设备像素时算贴边，放不满（诊断在 `issues` 里）才留空。
            if (isLast && size > 0 && Math.abs(end - boxEnd) <= 1) end = boxEnd;
            end = Math.min(end, boxEnd);
            const childBox: DeviceBox = horizontal
                ? {left: position, right: end, top: box.top, bottom: box.bottom, idealLeft: ideal, idealTop: box.idealTop}
                : {left: box.left, right: box.right, top: position, bottom: end, idealLeft: box.idealLeft, idealTop: ideal};
            // 第一块让后面的兄弟往后退，起点不动；其余的让前面的兄弟往前退，终点不动。反过来中间会露出一块空白。
            place(child, childBox, childEdges(index), {axis, edge: index === 0 ? "start" : "end"});
            if (isLast) return;

            const next = children[index + 1] as GridNode<R>;
            const sash = sashSize(index);
            const gap = sash > 0 ? Math.max(1, Math.round(sash * scale)) : 0;
            const gapEnd = Math.min(end + gap, boxEnd);
            items.push({
                kind: "sash",
                key: `sash:${JSON.stringify([child.id, next.id])}`,
                sashKey: `${branch.id}:${index}`,
                branch,
                index,
                axis,
                rect: horizontal ? toRect(end, box.top, gapEnd, box.bottom) : toRect(box.left, end, box.right, gapEnd),
                size: (gapEnd - end) / scale,
                before: child.id,
                after: next.id,
                controls: lastLeafOf(child),
                ends,
                branchLength: (boxEnd - boxStart) / scale,
            });
            ideal = idealEnd + sash;
            position = gapEnd;
        });
    };

    const width = Math.round(clean(extent.width) * scale);
    const height = Math.round(clean(extent.height) * scale);
    place(node, {left: 0, top: 0, right: width, bottom: height, idealLeft: 0, idealTop: 0}, NO_EDGES, null);
    return {items};
}

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

/**
 * 按树序找下一个能停的项：跳过没有可聚焦元素的。`wrap` 为假时走到头返回 null（Tab 离开这个 grid）；为真时绕回（最外层的
 * `moveGridFocus`），都没有返回 null。
 */
export function nextFocusStop(input: {readonly count: number; readonly from: number; readonly direction: 1 | -1; readonly wrap: boolean; focusable(index: number): boolean}): number | null {
    const {count, from, direction, wrap, focusable} = input;
    for (let step = 1; step <= count; step += 1) {
        const raw = from + direction * step;
        if (!wrap && (raw < 0 || raw >= count)) return null;
        const index = ((raw % count) + count) % count;
        if (focusable(index)) return index;
    }
    return null;
}
