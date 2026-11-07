/**
 * 面板的约束（docs/specs/ui/workbench-layout.md 输出 5、6）：工作台给 nb-layout 的策略。库不知道角色与名字的含义。
 */

import {edgeTargetOf, findTreeNode, GRID_UNBOUNDED, treeLeaves} from "@notnotype/nb-layout";
import type {GridExtent, GridOrientation, LayoutDoc, LayoutEdge, LayoutEdgeTarget, LayoutFloatRect, LayoutPolicy, LayoutProjectionOptions, PanelRecord, TabRef} from "@notnotype/nb-layout";

import {
    SASH_PX,
    SHELL_ACTIVITYBAR_WIDTH,
    SHELL_AUXILIARYBAR_MAX_FLOOR_WIDTH,
    SHELL_AUXILIARYBAR_MAX_VIEWPORT_RATIO,
    SHELL_AUXILIARYBAR_MIN_WIDTH,
    SHELL_DRAG_COLLAPSE_THRESHOLD,
    SHELL_PANEL_COLLAPSED_HEIGHT,
    SHELL_PANEL_MIN_HEIGHT,
    SHELL_PANEL_MIN_WIDTH,
    SHELL_SIDEBAR_MAX_WIDTH,
    SHELL_SIDEBAR_MIN_WIDTH,
    SHELL_STATUSBAR_HEIGHT,
} from "../shell/sizes";
import type {ViewCatalog} from "../views/registry";

export const PANEL_HEAD_HEIGHT = SHELL_PANEL_COLLAPSED_HEIGHT;
export const EDITOR_GROUP_MINIMUM: GridExtent = {width: 220, height: 120};
/** 新浮动窗的大小（原型试过的手感），不小于角色的最小尺寸，不大于树区域。 */
export const FLOAT_DEFAULT: GridExtent = {width: 460, height: 340};
/** 窗至少这么宽留在树区域里：加上头的高度，标签条总能抓到。 */
export const FLOAT_KEEP_WIDTH = 80;
/** 指针落在新窗的这一点：头上，靠左。 */
const FLOAT_GRAB = {x: 40, y: 14};
/** 命令开窗时按窗数错开。 */
const FLOAT_CASCADE = 24;

function floatSize(extent: GridExtent | null, minimum: GridExtent): GridExtent {
    const width = Math.max(FLOAT_DEFAULT.width, minimum.width);
    const height = Math.max(FLOAT_DEFAULT.height, minimum.height);
    return {width: extent === null ? width : Math.min(width, extent.width), height: extent === null ? height : Math.min(height, extent.height)};
}

/** 拖出来的窗：指针落在头上（`point` 相对树区域）。 */
export function floatRectAt(point: {readonly x: number; readonly y: number}, extent: GridExtent | null, minimum: GridExtent): LayoutFloatRect {
    return {x: point.x - FLOAT_GRAB.x, y: point.y - FLOAT_GRAB.y, ...floatSize(extent, minimum)};
}

/** 命令与键盘开的窗：树区域居中，按已有的窗数错开。 */
export function defaultFloatRect(extent: GridExtent | null, minimum: GridExtent, existing: number): LayoutFloatRect {
    const size = floatSize(extent, minimum);
    const offset = FLOAT_CASCADE * (existing % 8);
    return {x: Math.max(0, ((extent?.width ?? size.width) - size.width) / 2) + offset, y: Math.max(0, ((extent?.height ?? size.height) - size.height) / 2) + offset, ...size};
}

/** 放不下时收走的先后（输出 10）。别的工具面板排在后面。 */
export const COLLAPSE_ORDER: ReadonlyArray<string> = ["auxiliarybar", "panel", "sidebar"];

export function panelConstraints(panel: PanelRecord, catalog: ViewCatalog, viewportWidth: number, squeezed = false): {readonly minimumSize: GridExtent; readonly maximumSize: GridExtent} {
    // 工具面板全收走了还放不下：只压编辑组（输出 10）。它们的最小值还在的话约束解不出来，求解器会连条一起按比例压。
    if (panel.role === "editor") return {minimumSize: squeezed ? {width: 0, height: 0} : EDITOR_GROUP_MINIMUM, maximumSize: {width: GRID_UNBOUNDED, height: GRID_UNBOUNDED}};
    const minimumWidth = panel.name === "sidebar" ? SHELL_SIDEBAR_MIN_WIDTH : (panel.name === "auxiliarybar" ? SHELL_AUXILIARYBAR_MIN_WIDTH : SHELL_PANEL_MIN_WIDTH);
    const maximumWidth = panel.name === "sidebar" ? SHELL_SIDEBAR_MAX_WIDTH : (panel.name === "auxiliarybar" ? Math.max(SHELL_AUXILIARYBAR_MAX_FLOOR_WIDTH, viewportWidth * SHELL_AUXILIARYBAR_MAX_VIEWPORT_RATIO) : GRID_UNBOUNDED);
    // 取所有标签的并（最大的最小值、最小的最大值）：切标签不改布局。
    const declared = panel.tabs.flatMap((tab) => (tab.kind === "view" ? [catalog.get(tab.viewId)] : [])).filter((declaration) => declaration !== undefined);
    const minWidth = Math.max(minimumWidth, ...declared.map((view) => view.minimumSize?.width ?? 0));
    const minHeight = Math.max(SHELL_PANEL_MIN_HEIGHT, ...declared.map((view) => view.minimumSize?.height ?? 0));
    const maxWidth = Math.max(minWidth, Math.min(maximumWidth, ...declared.map((view) => view.maximumSize?.width ?? GRID_UNBOUNDED)));
    const maxHeight = Math.max(minHeight, Math.min(GRID_UNBOUNDED, ...declared.map((view) => view.maximumSize?.height ?? GRID_UNBOUNDED)));
    return {minimumSize: {width: minWidth, height: minHeight}, maximumSize: {width: maxWidth, height: maxHeight}};
}

export function layoutProjectionOptions(input: {readonly catalog: ViewCatalog; readonly viewportWidth: number; readonly removed?: ReadonlySet<string>; readonly cardGap?: number; readonly squeezed?: boolean}): LayoutProjectionOptions {
    return {
        constraints: (_id, panel) => panelConstraints(panel, input.catalog, input.viewportWidth, input.squeezed),
        // 主题的缝宽进几何：活动栏的卡片宽不变，叶宽要加上它和窗体、侧栏之间的缝。
        barThickness: (bar) => (bar === "activitybar" ? SHELL_ACTIVITYBAR_WIDTH + Math.max(0, input.cardGap ?? 0) : SHELL_STATUSBAR_HEIGHT),
        headHeight: PANEL_HEAD_HEIGHT,
        collapseThreshold: SHELL_DRAG_COLLAPSE_THRESHOLD,
        sashSize: SASH_PX,
        ...(input.removed === undefined ? {} : {removed: input.removed}),
    };
}

/** 接受矩阵（输出 26）：工具视图只进工具面板，编辑器标签只进编辑组，哪个区域都一样。哪条边算落点归 `layoutEdgeTarget`。 */
export function layoutAccepts(tabs: ReadonlyArray<TabRef>, target: PanelRecord): boolean {
    return tabs.every((tab) => (tab.kind === "view" ? target.role === "tool" : target.role === "editor"));
}

/** 工具面板往哪个方向分（输出 1）：侧栏、右栏这一列上下分，面板这一排左右分。无名面板是从它们分出来的，看父分支的方向。 */
export function toolPanelAxis(doc: LayoutDoc, panelId: string): GridOrientation {
    const name = doc.panels[panelId]?.name;
    if (name === "panel") return "horizontal";
    if (name !== undefined) return "vertical";
    return findTreeNode(doc.tree.root, panelId)?.parent?.orientation ?? "vertical";
}

/** 往一个方向分（输出 27）：只分本窗口，或同方向的窗口一起分。 */
export type DropSplit = "half" | "shared";

const onlyRole = (doc: LayoutDoc, nodeId: string, role: PanelRecord["role"]): boolean => {
    const hit = findTreeNode(doc.tree.root, nodeId);
    return hit !== null && treeLeaves(hit.node).every((leaf) => doc.panels[leaf.id]?.role === role);
};

/**
 * 这条边是不是落点、怎么分（输出 25 到 27）。工具面板只有所在方向上的两条边，别的边没有窄带，算中央。固定的面板不参与一起分，规则在 `placeLeaf`，所以编辑区分屏不分走侧栏、面板的空间。
 */
export function layoutEdgeTarget(doc: LayoutDoc, _tabs: ReadonlyArray<TabRef>, panelId: string, edge: LayoutEdge, split: DropSplit = "half"): LayoutEdgeTarget | null {
    const panel = doc.panels[panelId];
    if (panel === undefined) return null;
    if (panel.role === "tool") {
        const axis: GridOrientation = edge === "left" || edge === "right" ? "horizontal" : "vertical";
        if (axis !== toolPanelAxis(doc, panelId)) return null;
    }
    return {kind: split === "shared" ? "spread" : "split", panel: panelId, edge};
}

/**
 * 这条缝是不是落点（输出 26）：两边同类才是。编辑组之间，或同一列、同一排的工具面板之间；所以活动栏、侧栏、编辑区、右栏之间，编辑区与面板之间都没有缝落点，骨架插不进东西。
 */
export function layoutSeamAccepts(doc: LayoutDoc, _tabs: ReadonlyArray<TabRef>, before: string, after: string): boolean {
    if (onlyRole(doc, before, "editor") && onlyRole(doc, after, "editor")) return true;
    if (!onlyRole(doc, before, "tool") || !onlyRole(doc, after, "tool")) return false;
    const parent = findTreeNode(doc.tree.root, before)?.parent;
    const first = treeLeaves(findTreeNode(doc.tree.root, before)?.node ?? doc.tree.root)[0];
    return parent != null && first !== undefined && parent.orientation === toolPanelAxis(doc, first.id);
}

/** “移动到”的“新面板（挨着 X）”（输出 23）：明确的命令，不跟拖动的设置走，从相邻两块取空间。 */
export const newPanelEdgeTarget = (doc: LayoutDoc, beside: string): LayoutEdgeTarget | null => edgeTargetOf(doc, beside, toolPanelAxis(doc, beside) === "vertical" ? "bottom" : "right");

export function createLayoutPolicy(overrides: {readonly canInsert?: LayoutPolicy["canInsert"]; readonly dropSplit?: () => DropSplit} = {}): LayoutPolicy {
    const {dropSplit, ...rest} = overrides;
    return {
        accepts: layoutAccepts,
        edgeTarget: (doc, tabs, panel, edge) => layoutEdgeTarget(doc, tabs, panel, edge, dropSplit?.() ?? "half"),
        seamAccepts: layoutSeamAccepts,
        newId: (kind) => `${kind === "panel" ? "p" : "b"}-${crypto.randomUUID()}`,
        ...rest,
    };
}
