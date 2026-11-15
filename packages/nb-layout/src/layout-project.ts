/**
 * 呈现树（docs/specs/ui/workbench-layout.md 的“尺寸”）：由文档和呈现事实算出这一刻交给 `createGrid` 的树。
 *
 * 放不下被收走的面板、不用容器的文档里隐藏的具名面板不进呈现树：它们的零宽缝如果夹在两个可见面板之间，拖那条缝改的是它们，不是两边。文档树不动，
 * 单子分支在呈现里塌陷时用 `collapsedTo` 记下它由谁代表，`rebaseIntents` 据此把尺寸写回文档树。
 *
 * 带容器的区域（ADR 0046）：锚和不在当前容器里的分节不进呈现树（`isPanelShown`）；整个区域拖到零的收起策略配在区域在呈现树里的那个节点上，
 * 状态记在锚上（`regionAnchors`）。区域隐藏着时按拖到零画（`hiddenRegionsAtZero`）：区域挨着条或窗口边，零宽缝只有一个可见邻居，上面那条理由不成立；
 * 留着这条缝才能从它拉开，它和挨着的缝才有交汇处。
 */

import {UNBOUNDED_EXTENT} from "./grid-geometry";
import {barOfRef, hiddenRegionsAtZero, isContainerAnchor, isFixedChild, isPanelShown, isSectionCollapsed, REGION_ORIENTATION, regionNodeOf, treeLeaves} from "./layout-doc";
import type {LayoutBar, LayoutDoc, PanelName, PanelRecord} from "./layout-doc";
import type {GridExtent, GridNodeInput, GridOrientation, GridSizing, GridSnapshotNode, SashCollapseState} from "./grid-types";

export interface PanelConstraints {
    readonly minimumSize: GridExtent;
    readonly maximumSize: GridExtent;
}

export interface LayoutProjectionOptions {
    /** 面板的约束（工作台给）。 */
    constraints(id: string, panel: PanelRecord): PanelConstraints;
    /** 条的厚度。 */
    barThickness(bar: LayoutBar): number;
    /** 面板头高度：纵向分支里收起的面板占这么高，横向分支里收起是 0。 */
    readonly headHeight: number;
    readonly collapseThreshold: number;
    /** 普通缝的主轴占用。条两侧恒为 0。 */
    readonly sashSize: number;
    /** 呈现里去掉的面板：放不下被收走的。 */
    readonly removed?: ReadonlySet<string>;
}

export interface LayoutProjection {
    readonly input: GridNodeInput<string>;
    readonly sashSize: (branchId: string, index: number) => number;
    /** 呈现里塌陷掉的文档分支 → 代表它的节点。 */
    readonly collapsedTo: ReadonlyMap<string, string>;
    /**
     * 呈现树里代表一个带容器的区域的节点 → 这个区域的锚（面板 id）。节点是当前容器那一列（排）的分支；只显示一个分节时分支塌陷，就是那个分节的叶；
     * 区域空着、打开着时是锚自己这片叶（ADR 0050）。这个节点上的收起是整个区域拖到零：手势报告它收起或展开时，宿主要写到锚的 `collapsed` 上，
     * 不写到这个节点同名的面板上；区域是隐藏着的（按拖到零画）时，展开还要清掉锚的 `hidden`。不用容器的文档里是空的。
     */
    readonly regionAnchors: ReadonlyMap<string, string>;
}

const axisOf = (orientation: GridOrientation): keyof GridExtent => (orientation === "horizontal" ? "width" : "height");

const isBarInput = (node: GridNodeInput<string>): boolean => node.kind === "leaf" && barOfRef(node.ref) !== null;

/**
 * 按所在分支写运行约束。呈现里的单子分支已经塌陷，所以这里看到的才是真实的父分支。
 *
 * - 谁吸收余量：`isFixedChild`。所以和编辑区并排的工具面板保留像素，全是工具面板的一列按比例分，分支里总有人吸收余量，不留白。
 * - 收起：横向分支里拖到零，纵向分支里收成标题行。编辑组不可收起。
 * - 带容器的区域（docs/specs/ui/workbench-layout.md 输出 11、12）：代表区域的节点（`regionAnchors`）收起是整个区域拖到零，沿它所在的骨架分支那一轴为 0，状态读锚的；
 *   这个节点是分节的叶时，一个节点只有一份收起策略，给区域用；这个分节自己这时不算收起（`isSectionCollapsed`，输出 11：区域只显示一个分节时它不收成标题行）。区域里的分节（`region` 非空）只会收成标题行：
 *   只有一列的区域（侧栏、右栏）里直接排在纵向分支里的分节有；底部面板里的、区域里被左右拆开的没有收起策略，它们之间的边界停在最小尺寸。
 */
function assignByParent(doc: LayoutDoc, node: GridNodeInput<string>, options: LayoutProjectionOptions, regionAnchors: ReadonlyMap<string, string>, region: PanelName | null = null): void {
    if (node.kind === "leaf") return;
    const main = axisOf(node.orientation);
    // 按比例分的子节点，意图只记兄弟之间的比例（`rebaseIntents`：有收起、隐藏的兄弟或区域的锚时不写像素），当不了 `restoreSize`：
    // 让 Enter 回到它按比例该得的那一份，和改了收起记录再呈现（按钮、命令）一样（输出 12）。保留像素的节点意图就是像素，照旧。
    const collapseOf = (child: GridNodeInput<string>, collapsed: boolean, collapsedSize: number): SashCollapseState => ({
        collapsed,
        collapsedSize,
        restoreSize: Math.max(child.size?.[main] ?? 0, child.minimumSize?.[main] ?? 0),
        collapseThreshold: options.collapseThreshold,
        expandThreshold: options.collapseThreshold,
        ...(child.sizing === "weight" ? {restoreToShare: true} : {}),
    });
    for (const child of node.children) {
        const sizing: GridSizing = isFixedChild(doc, node.children, child) ? "fixed" : "weight";
        child.sizing = sizing;
        const anchor = doc.panels[regionAnchors.get(child.id) ?? ""];
        if (anchor?.name !== undefined) {
            child.collapse = collapseOf(child, anchor.collapsed === true, 0);
            if (child.kind === "branch") assignByParent(doc, child, options, regionAnchors, anchor.name);
            continue;
        }
        if (child.kind === "branch") {
            assignByParent(doc, child, options, regionAnchors, region);
            continue;
        }
        const panel = doc.panels[child.id];
        if (panel?.role !== "tool") continue;
        if (region !== null && (REGION_ORIENTATION[region] !== "vertical" || node.orientation !== "vertical")) continue;
        child.collapse = collapseOf(child, isSectionCollapsed(doc, child.id), node.orientation === "vertical" ? options.headHeight : 0);
    }
}

/** 呈现树里保留像素的节点：它们的呈现尺寸小于意图，只可能是放不下被压缩了（输出 7、8）。 */
export function fixedNodesOf(root: GridNodeInput<string>): ReadonlySet<string> {
    const fixed = new Set<string>();
    const visit = (node: GridNodeInput<string>): void => {
        if (node.kind === "leaf") return;
        for (const child of node.children) {
            if (child.sizing === "fixed") fixed.add(child.id);
            visit(child);
        }
    };
    visit(root);
    return fixed;
}

export function projectLayoutDoc(recorded: LayoutDoc, options: LayoutProjectionOptions): LayoutProjection {
    const doc = hiddenRegionsAtZero(recorded);
    const collapsedTo = new Map<string, string>();
    const sashes = new Map<string, number[]>();
    const regionAnchors = new Map<string, string>();
    // 带容器的区域在文档树里的节点 → 锚。
    const regionRoots = new Map<string, string>();
    for (const panel of Object.values(doc.panels)) {
        const region = panel.name === undefined || !isContainerAnchor(panel) ? null : regionNodeOf(doc, panel.name);
        if (region !== null) regionRoots.set(region.node.id, region.anchor);
    }
    /** 文档树的 `node` 呈现成了 `presented`：它是区域的节点时按呈现后的 id 记下（分支可能已经塌陷成一片叶）。 */
    const presentedAs = (node: GridSnapshotNode, presented: GridNodeInput<string>): GridNodeInput<string> => {
        const anchor = regionRoots.get(node.id);
        if (anchor !== undefined) regionAnchors.set(presented.id, anchor);
        return presented;
    };

    const project = (node: GridSnapshotNode, parentOrientation: GridOrientation | null): GridNodeInput<string> | null => {
        if (node.kind === "branch") {
            const children = node.children.map((child) => project(child, node.orientation)).filter((child): child is GridNodeInput<string> => child !== null);
            if (children.length === 0) return null;
            if (children.length === 1) {
                const survivor = children[0] as GridNodeInput<string>;
                collapsedTo.set(node.id, survivor.id);
                return presentedAs(node, {...survivor, size: {...node.size}});
            }
            sashes.set(node.id, children.slice(0, -1).map((child, index) => (isBarInput(child) || isBarInput(children[index + 1] as GridNodeInput<string>) ? 0 : options.sashSize)));
            return presentedAs(node, {kind: "branch", id: node.id, orientation: node.orientation, size: {...node.size}, children});
        }
        const bar = barOfRef(node.ref);
        if (bar !== null) {
            if (doc.hiddenBars.includes(bar)) return null;
            const thickness = options.barThickness(bar);
            const main = axisOf(parentOrientation ?? "horizontal");
            const fixed: GridExtent = {width: 0, height: 0, [main]: thickness};
            return {kind: "leaf", id: node.id, ref: node.ref, size: fixed, minimumSize: fixed, maximumSize: {...UNBOUNDED_EXTENT, [main]: thickness}, sizing: "fixed"};
        }
        const panel = doc.panels[node.id];
        if (panel === undefined || !isPanelShown(doc, node.id) || options.removed?.has(node.id) === true) return null;
        const {minimumSize, maximumSize} = options.constraints(node.id, panel);
        // 空区域里锚自己就是区域的节点（ADR 0050）：同分支一样登记，拖到零才读得到锚上的 `collapsed`。
        return presentedAs(node, {kind: "leaf", id: node.id, ref: node.ref, size: {...node.size}, minimumSize, maximumSize});
    };

    const input = project(doc.tree.root, null);
    if (input === null) throw new Error("布局文档的树里没有可呈现的节点：校验应该已经拒绝");
    assignByParent(doc, input, options, regionAnchors);
    return {input, collapsedTo, regionAnchors, sashSize: (branchId, index) => sashes.get(branchId)?.[index] ?? 0};
}

function minimumOf(node: GridNodeInput<string>, axis: keyof GridExtent, parentAxis: keyof GridExtent | null, sashSize: (branchId: string, index: number) => number): number {
    // 收起为零的节点（整个区域拖到零、横向分支里拖到零的面板）没有看得见的内容，两根轴都不占最小尺寸（docs/specs/ui/nested-grid.md 的“分支的收起”）：
    // 不然窗口窄了、矮了，会把看不见的分节“收走”。收成标题行的还占着面板头，只在父分支主轴上换成面板头的高度。
    if (node.collapse?.collapsed === true && (node.collapse.collapsedSize === 0 || axis === parentAxis)) return node.collapse.collapsedSize;
    if (node.kind === "leaf") return node.minimumSize?.[axis] ?? 0;
    const own = axisOf(node.orientation);
    const inner = node.children.map((child) => minimumOf(child, axis, own, sashSize));
    if (own !== axis) return Math.max(...inner);
    return inner.reduce((sum, value) => sum + value, 0) + node.children.slice(0, -1).reduce((sum, _, index) => sum + sashSize(node.id, index), 0);
}

export interface PresentationCollapse {
    readonly removed: ReadonlySet<string>;
    /** 收走了几块；全收走还放不下时 `squeezed` 为真，编辑组也要压。 */
    readonly squeezed: boolean;
}

/**
 * 放不下时收走哪些工具面板（docs/specs/ui/workbench-layout.md 输出 10）。先由 grid 压到最小，这里只判最小值都放不下的情况：按 `order` 一块块收走，放得下就停；
 * 焦点所在的面板最后收。结果只影响呈现，不写文档。
 */
export function presentationCollapse(doc: LayoutDoc, extent: GridExtent, options: LayoutProjectionOptions & {readonly order: ReadonlyArray<string>; readonly focused?: string | null}): PresentationCollapse {
    /** 最小值超出窗口多少；0 是放得下。 */
    const overflowOf = (removed: ReadonlySet<string>): number => {
        const {input, sashSize} = projectLayoutDoc(doc, {...options, removed});
        return Math.max(0, minimumOf(input, "width", null, sashSize) - extent.width) + Math.max(0, minimumOf(input, "height", null, sashSize) - extent.height);
    };
    const removed = new Set<string>();
    if (overflowOf(removed) === 0) return {removed, squeezed: false};
    const shown = new Set(treeLeaves(doc.tree.root).map((leaf) => leaf.id).filter((id) => doc.panels[id]?.role === "tool" && isPanelShown(doc, id)));
    const queue = [...options.order.filter((id) => shown.has(id)), ...[...shown].filter((id) => !options.order.includes(id))];
    const ordered = [...queue.filter((id) => id !== options.focused), ...queue.filter((id) => id === options.focused)];
    let squeezed = true;
    for (const id of ordered) {
        removed.add(id);
        if (overflowOf(removed) === 0) {
            squeezed = false;
            break;
        }
    }
    // 前面收走的不一定帮上了忙（窄的时候，收走纵向的那块不省宽度）：从后往前放回来，放回来不更挤的就不收。全收走还放不下时也一样，不然窗口再窄一点底部面板反而不见了。
    for (const back of [...removed].reverse()) {
        const before = overflowOf(removed);
        removed.delete(back);
        if (overflowOf(removed) > before) removed.add(back);
    }
    return {removed, squeezed};
}
