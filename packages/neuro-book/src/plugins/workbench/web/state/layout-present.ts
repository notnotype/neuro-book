/**
 * 由文档算出这一刻怎么呈现（docs/specs/ui/workbench-layout.md“渲染”“面板头与活动栏”）：内容项、有效可见、活动栏条目点了做什么。纯模块，不碰 DOM 与记录。
 */

import {findTab, findTreeNode, tabKey, treeLeaves} from "@notnotype/nb-layout";
import type {GridContentInput, GridExtent, LayoutDoc, PanelRecord} from "@notnotype/nb-layout";

import type {DisplayText} from "nbook/shared/localized-text";

import {workbenchText} from "../../shared/text";
import type {ViewCatalog} from "../views/registry";
import {PANEL_HEAD_HEIGHT} from "./layout-constraints";

const VIEW_KEY_PREFIX = "view:";

/**
 * 内容项：工具视图一个标签一项，`key` 就是标签键，所以视图换面板时内容跟着走。编辑组一块面板一项：一个组现在还是一个控件（每标签一实例见 w00026 t17）。
 * 头都在外框里，内容从头下面开始。工具面板的头是固定高度；编辑组的头一到三行（标签折行、提示条），是实测的，没有头时是 0。
 */
export function layoutContents(doc: LayoutDoc, editorHeadHeight: (panel: string) => number = () => 0): GridContentInput[] {
    return Object.entries(doc.panels).flatMap(([id, panel]): GridContentInput[] => {
        const insetTop = panel.role === "editor" ? editorHeadHeight(id) : PANEL_HEAD_HEIGHT;
        // 空的编辑组也要一块内容：空态的提示在里面。
        if (panel.role === "editor" && panel.tabs.length === 0) return [{key: `editor:${id}`, leaf: id, insetTop, active: true}];
        return panel.tabs.map((tab) => ({key: tabKey(tab), leaf: id, insetTop, active: panel.active === tabKey(tab)}));
    });
}

export interface VisibilityFacts {
    /** 已提交的呈现尺寸。 */
    readonly sizes: Readonly<Record<string, GridExtent>>;
    /** 手势进行中的预览尺寸；没有手势时是 null。 */
    readonly preview: Readonly<Record<string, GridExtent>> | null;
    /** 放不下被收走的面板。 */
    readonly removed: ReadonlySet<string>;
    readonly maximized: string | null;
}

function hasRoom(panel: PanelRecord, size: GridExtent | undefined): boolean {
    if (size === undefined) return false;
    return size.width > 0 && size.height > (panel.role === "tool" ? PANEL_HEAD_HEIGHT : 0);
}

/**
 * 有效可见的标签键（输出 17）。手势预览不改已经可见的面板：往零拖过阈值又拖回来，视图不闪；只有从零拉回时才按拖动中的几何算，内容在拖动中就出现（输出 12）。
 */
export function effectiveVisibleTabs(doc: LayoutDoc, facts: VisibilityFacts): ReadonlySet<string> {
    const visible = new Set<string>();
    for (const [id, panel] of Object.entries(doc.panels)) {
        if (panel.active === null || panel.hidden === true || facts.removed.has(id)) continue;
        if (facts.maximized !== null && facts.maximized !== id) continue;
        const committed = panel.collapsed !== true && hasRoom(panel, facts.sizes[id]);
        const pulledOut = facts.preview !== null && hasRoom(panel, facts.preview[id]);
        // 最大化盖在上面，矩形不来自布局结果。
        if (committed || pulledOut || facts.maximized === id) visible.add(panel.active);
    }
    return visible;
}

/** 活动栏条目点了做什么（输出 22）：不可见就显示，可见就隐藏；无名面板没有隐藏，是收起。 */
export type ToolEntryIntent =
    | {readonly kind: "reveal" | "hide" | "collapse"; readonly panel: string}
    | {readonly kind: "none"};

export function toolEntryIntent(doc: LayoutDoc, viewId: string, facts: {readonly visible: ReadonlySet<string>}): ToolEntryIntent {
    const key = tabKey({kind: "view", viewId});
    for (const [id, panel] of Object.entries(doc.panels)) {
        if (!panel.tabs.some((tab) => tabKey(tab) === key)) continue;
        if (!facts.visible.has(key)) return {kind: "reveal", panel: id};
        return {kind: panel.name === undefined ? "collapse" : "hide", panel: id};
    }
    return {kind: "none"};
}

/** 侧栏这一列的面板，按树序（输出 22）：活动栏只列这里的视图，这些面板的头只写标题。 */
export function sidebarColumnPanels(doc: LayoutDoc): ReadonlyArray<string> {
    const hit = findTreeNode(doc.tree.root, "sidebar");
    if (hit === null) return [];
    return hit.parent?.orientation === "vertical" ? treeLeaves(hit.parent).map((leaf) => leaf.id) : ["sidebar"];
}

/** 标签与它控制的内容互相引用的 DOM id：标签在面板头（外框里），内容在内容层，两边各算出同一个。 */
export const panelTabDomId = (prefix: string, key: string): string => `${prefix}-tab-${key}`;
export const panelTabpanelDomId = (prefix: string, key: string): string => `${prefix}-tabpanel-${key}`;

/** “移动到”的目标（输出 23）：别的工具面板，或挨着一块工具面板开新面板。 */
export type MoveTarget =
    | {readonly kind: "panel"; readonly panel: string}
    | {readonly kind: "new-panel"; readonly nextTo: string};

/** 按树序列目标；视图不在树上时是 null。只有这一个标签的面板挨着自己开新面板等于原位，不列。 */
export function moveTargetsOf(doc: LayoutDoc, viewId: string): ReadonlyArray<MoveTarget> | null {
    const from = findTab(doc, tabKey({kind: "view", viewId}));
    if (from === null) return null;
    const alone = doc.panels[from.panel]?.tabs.length === 1;
    const leaves = treeLeaves(doc.tree.root).filter((leaf) => doc.panels[leaf.id] !== undefined);
    const into = leaves.filter((leaf) => leaf.id !== from.panel && doc.panels[leaf.id]?.role === "tool").map((leaf): MoveTarget => ({kind: "panel", panel: leaf.id}));
    const beside = leaves.filter((leaf) => doc.panels[leaf.id]?.role === "tool" && doc.panels[leaf.id]?.hidden !== true && !(alone && leaf.id === from.panel)).map((leaf): MoveTarget => ({kind: "new-panel", nextTo: leaf.id}));
    return [...into, ...beside];
}

const PANEL_NAMES: Readonly<Record<string, DisplayText>> = {
    sidebar: workbenchText("viewCommands.parts.sidebar"),
    auxiliarybar: workbenchText("viewCommands.parts.auxiliarybar"),
    panel: workbenchText("viewCommands.parts.panel"),
};

/** 面板写给人看的名字（输出 23）：具名面板写它的名字，无名面板写它活动标签的标题。 */
export function panelTitle(doc: LayoutDoc, catalog: ViewCatalog, panelId: string): DisplayText {
    const panel = doc.panels[panelId];
    const named = panel?.name === undefined ? undefined : PANEL_NAMES[panel.name];
    if (named !== undefined) return named;
    if (panel?.role === "editor") {
        // 几块编辑组都叫“编辑区”就分不出来了：按树序写序号。
        const editors = treeLeaves(doc.tree.root).map((leaf) => leaf.id).filter((id) => doc.panels[id]?.role === "editor");
        return editors.length > 1 ? workbenchText("viewCommands.parts.editorAt", {index: editors.indexOf(panelId) + 1}) : workbenchText("viewCommands.parts.editor");
    }
    const active = panel?.active ?? null;
    const viewId = active !== null && active.startsWith(VIEW_KEY_PREFIX) ? active.slice(VIEW_KEY_PREFIX.length) : null;
    return (viewId === null ? undefined : catalog.get(viewId)?.title) ?? panelId;
}

/** 视图不在第一次放的具名面板时才能“重置位置”（输出 23）。 */
export function canResetView(doc: LayoutDoc, catalog: ViewCatalog, viewId: string): boolean {
    const found = findTab(doc, tabKey({kind: "view", viewId}));
    const location = catalog.get(viewId)?.location;
    return found !== null && location !== undefined && doc.panels[found.panel]?.name !== location;
}

/** 视图的标签键。 */
export const viewKey = (viewId: string): string => tabKey({kind: "view", viewId});

/** 视图 id；不是视图的标签键是 null。 */
export const viewIdOf = (key: string): string | null => (key.startsWith(VIEW_KEY_PREFIX) ? key.slice(VIEW_KEY_PREFIX.length) : null);

/** 拖动的结构键（输出 32）：树的拓扑和标签集合。尺寸、活动标签变了不算。 */
export function layoutStructureKey(doc: LayoutDoc): string {
    const shape = (node: LayoutDoc["tree"]["root"]): unknown => (node.kind === "leaf" ? node.id : [node.id, node.children.map(shape)]);
    return JSON.stringify([shape(doc.tree.root), Object.values(doc.panels).flatMap((panel) => panel.tabs.map(tabKey)).sort()]);
}
