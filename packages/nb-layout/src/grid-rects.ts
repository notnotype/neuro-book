/**
 * 布局结果 → 矩形（docs/specs/ui/nested-grid.md 的“按矩形摆放”“取整”）：`NestedGrid` 把叶与分隔线放在同一父元素下，
 * 它们的位置都从这里来。纯函数，不碰 DOM。坐标是相对 grid 根的 CSS px。
 *
 * 取整在设备像素上做，不对每条边各自取整：缝宽乘设备像素比不是整数时，各自取整会让相邻两条缝差一个设备像素（缝 1px 在
 * dpr 1.25 下约 58% 的容器宽度不等）。所以沿主轴累加：叶的终点取整，缝宽取整后固定，下一块从“上一块的终点加缝宽”开始。
 * 前提是 grid 根的左上角在设备像素格上：外壳的根是窗口原点，内层 grid 的外框已经取过整。
 */

import {sashKey} from "./sash-gesture";
import type {GridAxis, GridBranch, GridExtent, GridLayoutResult, GridLeaf, GridNode} from "./grid-types";

/** @experimental */
export interface GridRect {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/** 外接矩形；没有矩形时是 null。包内共用（最大化、交换、过渡各自要算一组矩形的外框），不从入口导出。 */
export function unionRects(rects: readonly [GridRect, ...GridRect[]]): GridRect;
export function unionRects(rects: ReadonlyArray<GridRect>): GridRect | null;
export function unionRects(rects: ReadonlyArray<GridRect>): GridRect | null {
    if (rects.length === 0) return null;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const rect of rects) {
        left = Math.min(left, rect.x);
        top = Math.min(top, rect.y);
        right = Math.max(right, rect.x + rect.width);
        bottom = Math.max(bottom, rect.y + rect.height);
    }
    return {x: left, y: top, width: right - left, height: bottom - top};
}

/** 两个矩形的内部是否相交；只挨着边不算。 */
export function rectsIntersect(a: GridRect, b: GridRect): boolean {
    return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** 矩形有没有面积；没有矩形（null、undefined）也算没有。 */
export function hasSize(rect: GridRect | null | undefined): rect is GridRect {
    return rect != null && rect.width > 0 && rect.height > 0;
}

/** 叶在树里的一层：这一层的节点（叶自己或它的一个祖先）、它所在分支的主轴、它前后的兄弟。 */
export interface GridPathStep {
    readonly id: string;
    readonly axis: GridAxis;
    readonly before: string | null;
    readonly after: string | null;
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
    /** 从根往下到这块叶的每一层（不含根）：整棵子树一起出现时按最外层新出现的那个节点长（`enteringRects`）。浮动窗为空。 */
    readonly path: ReadonlyArray<GridPathStep>;
    /** 已经离开、在过渡里留着缩回去的叶（`leavingPlacements`）：矩形是它缩到的终点，过渡结束就摘掉。 */
    readonly leaving?: true;
    /** 不在树里的叶（`floatPlacements`）：矩形由宿主给。 */
    readonly float?: boolean;
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
    /**
     * 交换里离开的一组中的分隔线（`planSwap`）：矩形是它滑到的终点，过渡结束就摘掉。两侧的节点已经不在布局里，两侧的尺寸冻结在离开前的
     * （`frozen`），不然按新布局取到零、判成“一侧为零”把线藏掉。
     */
    readonly leaving?: true;
    readonly frozen?: {readonly beforePx: number; readonly afterPx: number};
}

export type GridPlacementItem<R> = ({readonly kind: "leaf"} & GridLeafPlacement<R>) | ({readonly kind: "sash"} & GridSashPlacement<R>);

/**
 * 宿主给的内容项（docs/specs/ui/nested-grid.md 输出 80）。
 * @experimental
 */
export interface GridContentInput {
    /** 身份：不变就不重建、不换父元素。换 `leaf` 是在叶之间移动。 */
    readonly key: string;
    readonly leaf: string;
    /** 叶顶部留给面板头的高度（CSS px）。 */
    readonly insetTop: number;
    /** 不活动的（切走的标签）停放，不卸载。 */
    readonly active: boolean;
    /**
     * 宿主把它从 `contents` 去掉时怎样（docs/specs/ui/nested-grid.md 输出 155）：缺省 `"unmount"`，当即卸载；`"retain"`，它的叶这一轮在过渡里缩回去
     * （离开的叶留着缩回、或降到零）时，库用它最后一次的渲染留到过渡结束，宿主不用自己留数据。
     */
    readonly leave?: "unmount" | "retain";
}

/**
 * 宿主在叶的外框里画成的卡片：相对外框四边的内缩（上、右、下、左）与四个角的圆角（左上、右上、右下、左下），都是 CSS 长度。
 * 过渡中外框露出、盖住保持尺寸的内层时按它裁（docs/specs/ui/nested-grid.md 输出 51）。
 * @experimental
 */
export interface GridLeafShape {
    readonly inset: readonly [string, string, string, string];
    readonly radius: readonly [string, string, string, string];
    /**
     * 形状伸出外框时（某一边的内缩为负）伸出去那部分的颜色。外框里的东西照旧裁在外框里，伸出去的部分只画这个颜色；这块外框整块画在别的外框下面，
     * 所以伸到邻居那里的部分被邻居盖住，只在邻居的空处（缝、圆角外面）露出来。不写时形状不伸出外框，负的内缩画不出东西。
     */
    readonly fill?: string;
}

export interface GridContentPlacement {
    readonly kind: "content";
    /** 渲染序列里的身份。 */
    readonly key: string;
    readonly contentKey: string;
    readonly leaf: string;
    readonly insetTop: number;
    readonly active: boolean;
    /** 所属的叶不在这次的呈现里时为 null（叶被隐藏、文档与树的发布不同步的瞬间）：按停放处理。 */
    readonly rect: GridRect | null;
    /** 所属的叶的矩形（含面板头），找不到叶时为 null。过渡中叶从零长出来、缩到零时内容按它摆（见 `NestedGrid` 的内容层）。 */
    readonly leafRect: GridRect | null;
    /** 宿主给了 `leave: "retain"`。 */
    readonly retain?: true;
    /** 宿主已经去掉、库留到过渡结束的内容项（输出 155）：不在宿主的 `contents` 里，插槽停在最后一次渲染。 */
    readonly leaving?: true;
}

/** 渲染层的一项：叶、分隔线或内容。 */
export type GridLayerItem<R> = GridPlacementItem<R> | GridContentPlacement;

export interface GridPlacement<R> {
    /** 树序：叶与分隔线交替。 */
    readonly items: ReadonlyArray<GridPlacementItem<R>>;
}

/**
 * 把窗夹进一块区域（相对网格根）：窗口变小时呈现用夹取之后的矩形，记录不改。比区域还宽或高时缩到区域。
 *
 * - `area` 带原点（`x`、`y`）时夹进这块矩形；只给宽高时原点是 0。
 * - `keep` 是至少留在区域里的宽与高（例如只保证标签条抓得到）：不给时是整扇窗；给了也不超过窗缩后的尺寸，比区域大的窗不会被推出区域。
 * - 窗的上边总在区域里。
 * @experimental
 */
export function clampFloatRect(rect: GridRect, area: GridRect | GridExtent, keep?: {readonly width: number; readonly height: number}): GridRect {
    const ox = "x" in area && Number.isFinite(area.x) ? area.x : 0;
    const oy = "y" in area && Number.isFinite(area.y) ? area.y : 0;
    const width = Math.min(rect.width, area.width);
    const height = Math.min(rect.height, area.height);
    const keepWidth = Math.min(keep?.width ?? width, width);
    const keepHeight = Math.min(keep?.height ?? height, height);
    return {
        x: ox + Math.min(Math.max(rect.x - ox, keepWidth - width), area.width - keepWidth),
        y: oy + Math.min(Math.max(rect.y - oy, 0), area.height - keepHeight),
        width,
        height,
    };
}

/**
 * 缩放的方向：正号是右、下边跟着指针，负号是左、上边跟着指针，同时改写 `x`、`y`。
 * @experimental
 */
export interface LayoutFloatResize {
    readonly width: -1 | 0 | 1;
    readonly height: -1 | 0 | 1;
}

/**
 * 缩放之后的矩形。到了尺寸的上下限时对边不动；最小尺寸优先。`min`、`max`、`area` 只作用于方向不为 0 的轴，另一轴的位置与尺寸照搬 `start`。
 *
 * - `max` 是尺寸上限，不给时不限。
 * - `area` 是边界（相对网格根的矩形）：跟着指针的边不越过它。起点就在区域外的边不再往外拉，也不往里跳；不动的边不变。
 * @experimental
 */
export function resizeFloatRect(start: GridRect, direction: LayoutFloatResize, delta: {readonly x: number; readonly y: number}, bounds: {readonly min: GridExtent; readonly max?: GridExtent; readonly area?: GridRect}): GridRect {
    const clamp = (value: number, low: number, high: number): number => Math.min(Math.max(value, low), Math.max(low, high));
    let maxWidth = bounds.max?.width ?? Number.POSITIVE_INFINITY;
    let maxHeight = bounds.max?.height ?? Number.POSITIVE_INFINITY;
    const {area} = bounds;
    // 边界折成那一轴的尺寸上限：动的边最远到区域边缘，起点已在区域外时最远到起点（不往外，也不往里跳）。
    if (area !== undefined) {
        if (direction.width === 1) maxWidth = Math.min(maxWidth, Math.max(area.x + area.width, start.x + start.width) - start.x);
        if (direction.width === -1) maxWidth = Math.min(maxWidth, start.x + start.width - Math.min(area.x, start.x));
        if (direction.height === 1) maxHeight = Math.min(maxHeight, Math.max(area.y + area.height, start.y + start.height) - start.y);
        if (direction.height === -1) maxHeight = Math.min(maxHeight, start.y + start.height - Math.min(area.y, start.y));
    }
    // 方向为 0 的轴原样沿用起点：起点可能是宿主夹进小区域之后比最小尺寸还小的呈现矩形，横拖右边时不该把高度撑回最小尺寸。
    const width = direction.width === 0 ? start.width : clamp(start.width + direction.width * delta.x, bounds.min.width, maxWidth);
    const height = direction.height === 0 ? start.height : clamp(start.height + direction.height * delta.y, bounds.min.height, maxHeight);
    return {
        x: direction.width === -1 ? start.x + start.width - width : start.x,
        y: direction.height === -1 ? start.y + start.height - height : start.y,
        width,
        height,
    };
}

/**
 * 宿主给的浮动窗：一块不在树里的叶，内容项照常归属它，所以进出浮动窗内容不换父元素。
 * @experimental
 */
export interface GridFloatInput {
    readonly id: string;
    readonly rect: GridRect;
    /** 手势进行中：跟手，不过渡。`move` 还不接指针，判定才看得到底下。 */
    readonly gesture?: "move" | "resize";
    /**
     * 这扇窗的矩形变化走布局过渡（例如最大化与还原、窗里的视图段展开与收起）。不标时只有矩形变了不过渡。这一次或上一次渲染里它带着 `gesture`，
     * 或这次变化是松手放开（`placeFloat(id, null)` 之后），照旧不过渡。标了的窗每次矩形变化都走完整的布局时长，只标在要动的那一次上。
     * @experimental
     */
    readonly animate?: boolean;
}

/** 浮动窗的摆放，排在树的后面（Tab 与读屏也是）。不在树里，约束与收起都没有意义。 */
export function floatPlacements(floats: ReadonlyArray<GridFloatInput>): GridPlacementItem<unknown>[] {
    return floats.map(({id, rect}) => ({
        kind: "leaf" as const,
        key: `leaf:${id}`,
        node: {kind: "leaf", id, ref: id, size: {width: rect.width, height: rect.height}, minimumSize: {width: 0, height: 0}, maximumSize: {width: Number.POSITIVE_INFINITY, height: Number.POSITIVE_INFINITY}, sizing: "weight" as const},
        rect,
        grow: null,
        path: [],
        float: true,
    }));
}

/** 与 `Splitter` 的缺省相同：空布局（还没量到容器）时树已经在，`sashSizes` 没有这个分支。 */
export const DEFAULT_SASH_SIZE = 1;

/**
 * 内容项的矩形：叶减去面板头。面板头高度先按设备像素取整，否则 32 CSS px 在 dpr 1.1 这类缩放下落在半个设备像素上，内容和面板头之间出现发丝缝。
 */
export function placeContents<R>(items: ReadonlyArray<GridPlacementItem<R>>, contents: ReadonlyArray<GridContentInput>, dpr: number): GridContentPlacement[] {
    const leaves = new Map<string, GridRect>();
    for (const item of items) {
        if (item.kind === "leaf") leaves.set(item.node.id, item.rect);
    }
    const scale = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
    return contents.map((content) => {
        const leaf = leaves.get(content.leaf);
        const inset = Number.isFinite(content.insetTop) ? Math.round(Math.max(0, content.insetTop) * scale) / scale : 0;
        return {
            kind: "content",
            key: `content:${content.key}`,
            contentKey: content.key,
            leaf: content.leaf,
            insetTop: inset,
            active: content.active,
            ...(content.leave === "retain" ? {retain: true as const} : {}),
            rect: leaf === undefined ? null : {x: leaf.x, y: leaf.y + Math.min(inset, leaf.height), width: leaf.width, height: Math.max(0, leaf.height - inset)},
            leafRect: leaf ?? null,
        };
    });
}

/**
 * 最大化（docs/specs/ui/nested-grid.md 输出 97、98）：这块叶的矩形换成除 `exclude`（条）以外全部叶的外接矩形，其余的项不动。它盖在上面，别的面板不摘出布局，
 * 所以最大化和还原时它们什么都不变。
 */
export function maximizePlacement<R>(items: ReadonlyArray<GridPlacementItem<R>>, leaf: string, exclude: ReadonlyArray<string>): GridPlacementItem<R>[] {
    const rects = items.flatMap((item) => (item.kind === "leaf" && !exclude.includes(item.node.id) ? [item.rect] : []));
    const box = unionRects(rects);
    if (box === null) return [...items];
    return items.map((item) => (item.kind === "leaf" && item.node.id === leaf ? {...item, rect: box} : item));
}

/** 树序：每块叶后面紧跟属于它的内容项；找不到叶的排在最后。 */
export function layerItems<R>(items: ReadonlyArray<GridPlacementItem<R>>, contents: ReadonlyArray<GridContentPlacement>): GridLayerItem<R>[] {
    if (contents.length === 0) return [...items];
    const byLeaf = new Map<string, GridContentPlacement[]>();
    for (const content of contents) {
        const list = byLeaf.get(content.leaf);
        if (list === undefined) byLeaf.set(content.leaf, [content]);
        else list.push(content);
    }
    const result: GridLayerItem<R>[] = [];
    for (const item of items) {
        result.push(item);
        if (item.kind !== "leaf") continue;
        result.push(...(byLeaf.get(item.node.id) ?? []));
        byLeaf.delete(item.node.id);
    }
    for (const rest of byLeaf.values()) result.push(...rest);
    return result;
}

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

/** @experimental */
export function placeGrid<R>(node: GridNode<R>, layout: GridLayoutResult, extent: GridExtent, dpr: number): GridPlacement<R> {
    const scale = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    const items: Array<GridPlacementItem<R>> = [];
    const toRect = (left: number, top: number, right: number, bottom: number): GridRect => ({x: left / scale, y: top / scale, width: (right - left) / scale, height: (bottom - top) / scale});

    const place = (current: GridNode<R>, box: DeviceBox, edges: BranchEdges, grow: GridLeafPlacement<R>["grow"], path: ReadonlyArray<GridPathStep>): void => {
        if (current.kind === "leaf") {
            items.push({kind: "leaf", key: `leaf:${current.id}`, node: current, rect: toRect(box.left, box.top, box.right, box.bottom), grow, path});
            return;
        }
        placeBranch(current, box, edges, path);
    };

    const placeBranch = (branch: GridBranch<R>, box: DeviceBox, edges: BranchEdges, path: ReadonlyArray<GridPathStep>): void => {
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
            if (sashSize(sash) > 0) return sashKey(branch.id, sash);
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
            const step: GridPathStep = {id: child.id, axis, before: children[index - 1]?.id ?? null, after: children[index + 1]?.id ?? null};
            place(child, childBox, childEdges(index), {axis, edge: index === 0 ? "start" : "end"}, [...path, step]);
            if (isLast) return;

            const next = children[index + 1] as GridNode<R>;
            const sash = sashSize(index);
            const gap = sash > 0 ? Math.max(1, Math.round(sash * scale)) : 0;
            const gapEnd = Math.min(end + gap, boxEnd);
            items.push({
                kind: "sash",
                key: `sash:${JSON.stringify([child.id, next.id])}`,
                sashKey: sashKey(branch.id, index),
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
    place(node, {left: 0, top: 0, right: width, bottom: height, idealLeft: 0, idealTop: 0}, NO_EDGES, null, []);
    return {items};
}
