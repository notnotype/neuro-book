/**
 * 呈现树（docs/specs/ui/workbench-layout.md 的“尺寸”）：由文档和呈现事实算出这一刻交给 `createGrid` 的树。
 *
 * 隐藏的、放不下被收走的面板不进呈现树：它们的零宽缝如果夹在两个可见面板之间，拖那条缝改的是隐藏面板，不是两边。文档树不动，
 * 单子分支在呈现里塌陷时用 `collapsedTo` 记下它由谁代表，`rebaseIntents` 据此把尺寸写回文档树。
 */

import {UNBOUNDED_EXTENT} from "./grid-geometry";
import {barOfRef, panelOfRef, treeLeaves} from "./layout-doc";
import type {LayoutBar, LayoutDoc, PanelRecord} from "./layout-doc";
import type {GridExtent, GridNodeInput, GridOrientation, GridSizing, GridSnapshotNode} from "./grid-types";

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
}

const axisOf = (orientation: GridOrientation): keyof GridExtent => (orientation === "horizontal" ? "width" : "height");

/** 这个节点含编辑组吗。 */
function holdsEditor(doc: LayoutDoc, node: GridNodeInput<string>): boolean {
    if (node.kind === "branch") return node.children.some((child) => holdsEditor(doc, child));
    const panel = panelOfRef(node.ref);
    return panel !== null && doc.panels[panel]?.role === "editor";
}

const isBarInput = (node: GridNodeInput<string>): boolean => node.kind === "leaf" && barOfRef(node.ref) !== null;

/**
 * 按所在分支写运行约束。呈现里的单子分支已经塌陷，所以这里看到的才是真实的父分支。
 *
 * - 谁吸收余量：子节点是 `weight`，当且仅当它含编辑组，或它的兄弟都不含编辑组；条永远 `fixed`。所以和编辑区并排的工具面板保留像素，全是工具面板的一列按比例分，
 *   分支里总有人吸收余量，不留白。
 * - 收起：横向分支里拖到零，纵向分支里收成标题行。编辑组不可收起。
 */
function assignByParent(doc: LayoutDoc, node: GridNodeInput<string>, options: LayoutProjectionOptions): void {
    if (node.kind === "leaf") return;
    const anyEditor = node.children.some((child) => holdsEditor(doc, child));
    const main = axisOf(node.orientation);
    for (const child of node.children) {
        const sizing: GridSizing = isBarInput(child) ? "fixed" : (!anyEditor || holdsEditor(doc, child) ? "weight" : "fixed");
        child.sizing = sizing;
        if (child.kind === "branch") {
            assignByParent(doc, child, options);
            continue;
        }
        const panel = doc.panels[child.id];
        if (panel?.role !== "tool") continue;
        child.collapse = {
            collapsed: panel.collapsed === true,
            collapsedSize: node.orientation === "vertical" ? options.headHeight : 0,
            restoreSize: Math.max(child.size?.[main] ?? 0, child.minimumSize?.[main] ?? 0),
            collapseThreshold: options.collapseThreshold,
            expandThreshold: options.collapseThreshold,
        };
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

export function projectLayoutDoc(doc: LayoutDoc, options: LayoutProjectionOptions): LayoutProjection {
    const collapsedTo = new Map<string, string>();
    const sashes = new Map<string, number[]>();

    const project = (node: GridSnapshotNode, parentOrientation: GridOrientation | null): GridNodeInput<string> | null => {
        if (node.kind === "branch") {
            const children = node.children.map((child) => project(child, node.orientation)).filter((child): child is GridNodeInput<string> => child !== null);
            if (children.length === 0) return null;
            if (children.length === 1) {
                const survivor = children[0] as GridNodeInput<string>;
                collapsedTo.set(node.id, survivor.id);
                return {...survivor, size: {...node.size}};
            }
            sashes.set(node.id, children.slice(0, -1).map((child, index) => (isBarInput(child) || isBarInput(children[index + 1] as GridNodeInput<string>) ? 0 : options.sashSize)));
            return {kind: "branch", id: node.id, orientation: node.orientation, size: {...node.size}, children};
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
        if (panel === undefined || panel.hidden === true || options.removed?.has(node.id) === true) return null;
        const {minimumSize, maximumSize} = options.constraints(node.id, panel);
        return {kind: "leaf", id: node.id, ref: node.ref, size: {...node.size}, minimumSize, maximumSize};
    };

    const input = project(doc.tree.root, null);
    if (input === null) throw new Error("布局文档的树里没有可呈现的节点：校验应该已经拒绝");
    assignByParent(doc, input, options);
    return {input, collapsedTo, sashSize: (branchId, index) => sashes.get(branchId)?.[index] ?? 0};
}

function minimumOf(node: GridNodeInput<string>, axis: keyof GridExtent, parentAxis: keyof GridExtent | null, sashSize: (branchId: string, index: number) => number): number {
    if (node.kind === "leaf") {
        if (node.collapse?.collapsed === true && axis === parentAxis) return node.collapse.collapsedSize;
        return node.minimumSize?.[axis] ?? 0;
    }
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
    const shown = new Set(treeLeaves(doc.tree.root).map((leaf) => leaf.id).filter((id) => doc.panels[id]?.role === "tool" && doc.panels[id]?.hidden !== true));
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
