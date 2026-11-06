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

/** 宿主给的内容项（docs/specs/ui/nested-grid.md 的“内容层”）。 */
export interface GridContentInput {
    /** 身份：不变就不重建、不换父元素。换 `leaf` 是在叶之间移动。 */
    readonly key: string;
    readonly leaf: string;
    /** 叶顶部留给面板头的高度（CSS px）。 */
    readonly insetTop: number;
    /** 不活动的（切走的标签）停放，不卸载。 */
    readonly active: boolean;
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
}

/** 渲染层的一项：叶、分隔线或内容。 */
export type GridLayerItem<R> = GridPlacementItem<R> | GridContentPlacement;

export interface GridPlacement<R> {
    /** 树序：叶与分隔线交替。 */
    readonly items: ReadonlyArray<GridPlacementItem<R>>;
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
            rect: leaf === undefined ? null : {x: leaf.x, y: leaf.y + Math.min(inset, leaf.height), width: leaf.width, height: Math.max(0, leaf.height - inset)},
        };
    });
}

/**
 * 最大化（docs/specs/ui/nested-grid.md 的“最大化”）：这块叶的矩形换成除 `exclude`（条）以外全部叶的外接矩形，其余的项不动。它盖在上面，别的面板不摘出布局，
 * 所以最大化和还原时它们什么都不变。
 */
export function maximizePlacement<R>(items: ReadonlyArray<GridPlacementItem<R>>, leaf: string, exclude: ReadonlyArray<string>): GridPlacementItem<R>[] {
    const rects = items.flatMap((item) => (item.kind === "leaf" && !exclude.includes(item.node.id) ? [item.rect] : []));
    if (rects.length === 0) return [...items];
    const left = Math.min(...rects.map((rect) => rect.x));
    const top = Math.min(...rects.map((rect) => rect.y));
    const right = Math.max(...rects.map((rect) => rect.x + rect.width));
    const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
    return items.map((item) => (item.kind === "leaf" && item.node.id === leaf ? {...item, rect: {x: left, y: top, width: right - left, height: bottom - top}} : item));
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
