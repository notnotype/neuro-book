/**
 * 面板的约束（docs/specs/ui/workbench-layout.md 输出 5、6）：工作台给 nb-layout 的策略。库不知道角色与名字的含义。
 */

import {GRID_UNBOUNDED} from "@notnotype/nb-layout";
import type {GridExtent, LayoutPolicy, LayoutProjectionOptions, PanelRecord, TabRef} from "@notnotype/nb-layout";

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
import type {ViewCatalog} from "../views/placement";

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

/** 接受矩阵（输出 26）：工具视图与编辑器标签不进同一组标签，外缘都接受。 */
export function layoutAccepts(tabs: ReadonlyArray<TabRef>, target: PanelRecord, region: "strip" | "center" | "edge"): boolean {
    if (region === "edge") return true;
    return tabs.every((tab) => (tab.kind === "view" ? target.role === "tool" : target.role === "editor"));
}

export function createLayoutPolicy(overrides: {readonly canInsert?: LayoutPolicy["canInsert"]} = {}): LayoutPolicy {
    return {
        accepts: layoutAccepts,
        newId: (kind) => `${kind === "panel" ? "p" : "b"}-${crypto.randomUUID()}`,
        ...overrides,
    };
}
