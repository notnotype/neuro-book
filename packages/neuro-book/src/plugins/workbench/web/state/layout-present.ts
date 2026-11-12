/**
 * 由文档算出这一刻怎么呈现（docs/specs/ui/workbench-layout.md“渲染”“面板头与活动栏”）：内容项、有效可见、活动栏列哪些入口与点了做什么、焦点丢了去哪。纯模块，不碰 DOM 与记录。
 */

import {findTab, isFloating, isPanelShown, isSectionCollapsed, regionNodeOf, regionOf, tabKey, treeLeaves} from "@notnotype/nb-layout";
import type {GridContentInput, GridExtent, LayoutDoc, PanelName, PanelRecord} from "@notnotype/nb-layout";

import type {DisplayText} from "nbook/shared/localized-text";

import {workbenchText} from "../../shared/text";
import type {ViewCatalog} from "../views/registry";
import {containerLabel, NO_CONTAINERS, regionAnchor, regionContainers, regionSections, viewHome, viewSection} from "./containers";
import type {ContainerCatalog, ContainerLabel} from "./containers";
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
    const floating = new Set(doc.floats.map((float) => float.panel));
    for (const [id, panel] of Object.entries(doc.panels)) {
        // 浮动窗不在呈现尺寸里：活动标签就算可见，被别的窗盖住、别的面板最大化时也算（提案第 6 节）。
        if (panel.active !== null && floating.has(id)) {
            visible.add(panel.active);
            continue;
        }
        if (panel.active === null || !isPanelShown(doc, id) || facts.removed.has(id)) continue;
        if (facts.maximized !== null && facts.maximized !== id) continue;
        // 分节所在的区域拖到零记在锚上（输出 17）：命令写了它之后，呈现尺寸要到下一次布局才跟上，所以不只看尺寸。
        const region = regionOf(doc, id);
        const anchor = region === null ? undefined : doc.panels[regionNodeOf(doc, region)?.anchor ?? ""];
        const committed = !isSectionCollapsed(doc, id) && anchor?.collapsed !== true && hasRoom(panel, facts.sizes[id]);
        const pulledOut = facts.preview !== null && hasRoom(panel, facts.preview[id]);
        // 最大化盖在上面，矩形不来自布局结果。
        if (committed || pulledOut || facts.maximized === id) visible.add(panel.active);
    }
    return visible;
}

/**
 * 区域此刻占不占地方（输出 36）：区域隐藏、拖到零、被最大化盖住、显示着的分节都放不下被收走，都不算；分节收成标题行算。
 * 隐藏与拖到零记在锚上；别的都按区域里显示着的分节问：锚自己不进呈现树。
 */
export function regionOccupied(doc: LayoutDoc, region: PanelName, facts: Pick<VisibilityFacts, "removed" | "maximized">): boolean {
    const anchor = doc.panels[regionAnchor(doc, region) ?? ""];
    if (anchor === undefined || anchor.hidden === true || anchor.collapsed === true) return false;
    const shown = regionSections(doc, region).map((section) => section.panel).filter((id) => isPanelShown(doc, id));
    if (facts.maximized !== null) return shown.includes(facts.maximized);
    return shown.some((id) => !facts.removed.has(id));
}

/**
 * 活动栏说的“侧栏可见”（输出 22 的按下态与点击）：侧栏占着地方，或者正从零拉回来。后一种文档里还记着拖到零，
 * 内容却已经按拖动中的几何可见了（输出 12、17），入口跟着内容走，不等松手。
 */
export function sidebarVisible(doc: LayoutDoc, facts: Pick<VisibilityFacts, "removed" | "maximized">, visible: ReadonlySet<string>): boolean {
    return regionOccupied(doc, "sidebar", facts) || regionSections(doc, "sidebar").some((section) => section.viewId !== null && visible.has(viewKey(section.viewId)));
}

/** 活动栏的一个入口（输出 22、41）：侧栏里一个有成员的容器。 */
export interface ContainerEntry {
    /** 容器 id。 */
    readonly id: string;
    readonly label: ContainerLabel;
    /** 成员视图，按分节的先后；声明不在的也在里面。 */
    readonly views: ReadonlyArray<string>;
    /** 是不是侧栏的当前容器。 */
    readonly current: boolean;
}

/** 活动栏上段列什么（输出 22）：侧栏里有成员的容器，按入口顺序。搬到右栏、底部面板的容器不在这里。 */
export function containerEntries(doc: LayoutDoc, views: ViewCatalog, containers: ContainerCatalog = NO_CONTAINERS): ReadonlyArray<ContainerEntry> {
    const current = doc.panels[regionAnchor(doc, "sidebar") ?? ""]?.activeContainer ?? null;
    return regionContainers(doc, "sidebar").flatMap((container): ContainerEntry[] => {
        const label = containerLabel(container, views, containers);
        return label === null ? [] : [{id: container.id, label, views: container.views, current: container.id === current}];
    });
}

/**
 * 活动栏入口点了做什么（输出 22）：不是当前容器就切到它，侧栏隐藏或拖到零时同一次写入展开；是当前容器时，侧栏可见就隐藏侧栏，不可见就展开。
 * 所以只有两种动作：`show` 是“侧栏显示并切到这个容器”，`hide` 是隐藏侧栏。容器不在侧栏里（没有成员、在别的区域）时什么都不做。
 */
export type ToolEntryIntent =
    | {readonly kind: "show"; readonly container: string}
    | {readonly kind: "hide"}
    | {readonly kind: "none"};

export function toolEntryIntent(doc: LayoutDoc, container: string, facts: {readonly sidebarVisible: boolean}): ToolEntryIntent {
    const entry = regionContainers(doc, "sidebar").find((candidate) => candidate.id === container);
    if (entry === undefined) return {kind: "none"};
    const current = doc.panels[regionAnchor(doc, "sidebar") ?? ""]?.activeContainer === container;
    return current && facts.sidebarVisible ? {kind: "hide"} : {kind: "show", container};
}

/**
 * 头只写标题的面板（输出 20）：只有一个标签的工具面板。区域里的分节恰一个标签（输出 40），所以都在里面；几个标签的只有工具视图的浮动窗。
 * 按已提交的文档算：拖动中来源少了一个标签，头不跟着变。预览里新长出来的块不在这里，它不画头。
 */
export function titleOnlyPanels(doc: LayoutDoc): ReadonlySet<string> {
    return new Set(Object.entries(doc.panels).flatMap(([id, panel]) => (panel.role === "tool" && panel.tabs.length <= 1 ? [id] : [])));
}

/**
 * 焦点所在的内容或面板头看不见之后焦点去哪（输出 16、42），按先后试：调用方取第一个在界面上找得到的，都找不到时去外壳根。
 *
 * - `tab`：面板还显示着，只是内容被停放（收成标题行、被最大化盖住），去它头上的标签。
 * - `section`：面板不显示了，区域还显示着、只是切走了容器，去新容器的第一个分节（输出 42）。
 * - `entry`：面板在侧栏里，去活动栏上它那个容器的入口；别的区域的容器没有入口。
 */
export type FocusLanding =
    | {readonly kind: "tab" | "section"; readonly panel: string}
    | {readonly kind: "entry"; readonly container: string};

export function focusLandings(doc: LayoutDoc, panelId: string): ReadonlyArray<FocusLanding> {
    const panel = doc.panels[panelId];
    if (panel === undefined) return [];
    const shown = isPanelShown(doc, panelId);
    const landings: FocusLanding[] = shown ? [{kind: "tab", panel: panelId}] : [];
    const region = regionOf(doc, panelId);
    const anchor = region === null ? undefined : doc.panels[regionAnchor(doc, region) ?? ""];
    if (region === null || anchor === undefined || panel.container === undefined) return landings;
    const current = anchor.activeContainer ?? null;
    const first = shown || anchor.hidden === true || current === null || current === panel.container ? undefined : regionContainers(doc, region).find((container) => container.id === current)?.sections[0];
    if (first !== undefined) landings.push({kind: "section", panel: first});
    if (region === "sidebar") landings.push({kind: "entry", container: panel.container});
    return landings;
}

/** 标签与它控制的内容互相引用的 DOM id：标签在面板头（外框里），内容在内容层，两边各算出同一个。 */
export const panelTabDomId = (prefix: string, key: string): string => `${prefix}-tab-${key}`;
export const panelTabpanelDomId = (prefix: string, key: string): string => `${prefix}-tabpanel-${key}`;

/** “移动到”的目标（输出 23）：别的区域，或挨着一块工具面板开新面板。 */
export type MoveTarget =
    | {readonly kind: "panel"; readonly panel: string}
    | {readonly kind: "new-panel"; readonly nextTo: string};

/**
 * 按树序列目标；视图不在树上时是 null。只有这一个标签的面板挨着自己开新面板等于原位，不列。
 * 放进去的目标只列别的区域（目标是它的锚，放进那个区域的当前容器）：分节不收第二个标签（输出 40），所以分节自己不是“放进去”的目标。
 */
export function moveTargetsOf(doc: LayoutDoc, viewId: string): ReadonlyArray<MoveTarget> | null {
    const from = findTab(doc, tabKey({kind: "view", viewId}));
    if (from === null) return null;
    const alone = doc.panels[from.panel]?.tabs.length === 1;
    const leaves = treeLeaves(doc.tree.root).filter((leaf) => doc.panels[leaf.id] !== undefined);
    const home = regionOf(doc, from.panel);
    const into = leaves.filter((leaf) => doc.panels[leaf.id]?.name !== undefined && doc.panels[leaf.id]?.name !== home).map((leaf): MoveTarget => ({kind: "panel", panel: leaf.id}));
    const beside = leaves.filter((leaf) => doc.panels[leaf.id]?.role === "tool" && isPanelShown(doc, leaf.id) && !(alone && leaf.id === from.panel)).map((leaf): MoveTarget => ({kind: "new-panel", nextTo: leaf.id}));
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
        if (isFloating(doc, panelId)) return workbenchText("viewCommands.parts.editorFloat");
        // 几块编辑组都叫“编辑区”就分不出来了：按树序写序号。
        const editors = treeLeaves(doc.tree.root).map((leaf) => leaf.id).filter((id) => doc.panels[id]?.role === "editor");
        return editors.length > 1 ? workbenchText("viewCommands.parts.editorAt", {index: editors.indexOf(panelId) + 1}) : workbenchText("viewCommands.parts.editor");
    }
    const active = panel?.active ?? null;
    const viewId = active !== null && active.startsWith(VIEW_KEY_PREFIX) ? active.slice(VIEW_KEY_PREFIX.length) : null;
    return (viewId === null ? undefined : catalog.get(viewId)?.title) ?? panelId;
}

/** 视图不在它声明的容器（没声明的是它的隐式容器）时才能“重置位置”（输出 23）；浮动着的不在任何容器里。 */
export function canResetView(doc: LayoutDoc, catalog: ViewCatalog, viewId: string, containers: ContainerCatalog = NO_CONTAINERS): boolean {
    const found = findTab(doc, tabKey({kind: "view", viewId}));
    const home = viewHome(viewId, catalog, containers);
    return found !== null && home !== null && viewSection(doc, viewId)?.container !== home.container;
}

/** 视图的标签键。 */
export const viewKey = (viewId: string): string => tabKey({kind: "view", viewId});

/** 视图 id；不是视图的标签键是 null。 */
export const viewIdOf = (key: string): string | null => (key.startsWith(VIEW_KEY_PREFIX) ? key.slice(VIEW_KEY_PREFIX.length) : null);

/**
 * 拖动的结构键（输出 32）：树的拓扑、标签集合与各区域的当前容器。尺寸、活动标签变了不算。
 * 当前容器在里面：判定的几何是拿起时量的（ADR 0046 决策 5），命令切走容器之后看得见的分节换了，旧几何指着的已经不是屏幕上的东西。
 */
export function layoutStructureKey(doc: LayoutDoc): string {
    const shape = (node: LayoutDoc["tree"]["root"]): unknown => (node.kind === "leaf" ? node.id : [node.id, node.children.map(shape)]);
    const active = Object.values(doc.panels).flatMap((panel) => (panel.name === undefined || panel.entries === undefined ? [] : [[panel.name, panel.activeContainer ?? null]])).sort();
    return JSON.stringify([shape(doc.tree.root), doc.floats.map((float) => float.panel).sort(), Object.values(doc.panels).flatMap((panel) => panel.tabs.map(tabKey)).sort(), active]);
}
