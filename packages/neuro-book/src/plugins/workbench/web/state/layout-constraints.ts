/**
 * 面板的约束（docs/specs/ui/workbench-layout.md 输出 5、6）：工作台给 nb-layout 的策略。库不知道角色与名字的含义。
 */

import {edgeTargetOf, findTreeNode, GRID_UNBOUNDED, treeLeaves} from "@notnotype/nb-layout";
import type {GridExtent, GridOrientation, LayoutDoc, LayoutEdge, LayoutEdgeTarget, LayoutPolicy, LayoutProjectionOptions, PanelRecord, TabRef} from "@notnotype/nb-layout";

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

const onlyEditors = (doc: LayoutDoc, nodeId: string): boolean => {
    const hit = findTreeNode(doc.tree.root, nodeId);
    return hit !== null && treeLeaves(hit.node).every((leaf) => doc.panels[leaf.id]?.role === "editor");
};

/**
 * 这条边是不是落点、落到哪（输出 25、26）。规则都是为了守住骨架（输出 1）：工具面板只有所在方向上的两条边；编辑组的对面不是编辑组时（下面挨着面板）是拆这一组，不从工具面板取空间。
 */
export function layoutEdgeTarget(doc: LayoutDoc, _tabs: ReadonlyArray<TabRef>, panelId: string, edge: LayoutEdge): LayoutEdgeTarget | null {
    const panel = doc.panels[panelId];
    if (panel === undefined) return null;
    if (panel.role === "tool") {
        const axis: GridOrientation = edge === "left" || edge === "right" ? "horizontal" : "vertical";
        return axis === toolPanelAxis(doc, panelId) ? edgeTargetOf(doc, panelId, edge) : null;
    }
    const target = edgeTargetOf(doc, panelId, edge);
    if (target?.kind !== "between") return target;
    return onlyEditors(doc, target.before === panelId ? target.after : target.before) ? target : {kind: "split", panel: panelId, edge};
}

export function createLayoutPolicy(overrides: {readonly canInsert?: LayoutPolicy["canInsert"]} = {}): LayoutPolicy {
    return {
        accepts: layoutAccepts,
        edgeTarget: layoutEdgeTarget,
        newId: (kind) => `${kind === "panel" ? "p" : "b"}-${crypto.randomUUID()}`,
        ...overrides,
    };
}
