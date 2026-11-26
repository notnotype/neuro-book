/**
 * 由文档算出这一刻怎么呈现（docs/specs/ui/workbench-layout.md“渲染”“面板头与活动栏”）：内容项、有效可见、活动栏列哪些入口与点了做什么、焦点丢了去哪。纯模块，不碰 DOM 与记录。
 */

import {findTab, hiddenRegionsAtZero, isFloating, isPanelShown, isSectionCollapsed, regionNodeOf, regionOf, tabKey, treeLeaves} from "@notnotype/nb-workbench-layout";
import type {GridContentInput, GridExtent} from "@notnotype/nb-layout";
import type {LayoutDoc, LayoutProjection, PanelName, PanelRecord} from "@notnotype/nb-workbench-layout";

import type {DisplayText} from "nbook/shared/localized-text";

import {workbenchText} from "../../shared/text";
import {VIEW_LOCATIONS} from "../../shared/views";
import type {ViewCatalog} from "../views/registry";
import {containerLabel, NO_CONTAINERS, regionAnchor, regionContainers, regionSections, viewHome, viewSection} from "./containers";
import type {ContainerCatalog, ContainerLabel} from "./containers";
import {PANEL_HEAD_HEIGHT} from "./layout-constraints";

const VIEW_KEY_PREFIX = "view:";
const NO_PANELS: ReadonlySet<string> = new Set();

/**
 * 内容项：一个标签一项，`key` 就是标签键，所以标签换面板时内容跟着走，实例不重建。
 * 头都在外框里，内容从头下面开始。工具面板的头是固定高度；编辑组的头一到三行（标签折行、提示条），是实测的，没有头时是 0。
 * `headless` 是此刻叶里不画头的工具面板，内容从叶的上边开始：画成并成一行的分节（头在区域的入口条里，输出 47），以及视图自绘头的浮动窗
 * （docs/specs/workbench/views.md 输出 19 的“自绘头”，头是视图画在内容顶上的）。由表面给，它决定离开、最大化过渡里画成什么。
 */
export function layoutContents(doc: LayoutDoc, editorHeadHeight: (panel: string) => number = () => 0, headless: ReadonlySet<string> = NO_PANELS): GridContentInput[] {
    return Object.entries(doc.panels).flatMap(([id, panel]): GridContentInput[] => {
        const insetTop = panel.role === "editor" ? editorHeadHeight(id) : headless.has(id) ? 0 : PANEL_HEAD_HEIGHT;
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
    /** 垫底的分节（投影的 `fillers`）：收着、外框拉到了底，预览里也不算拉出来。 */
    readonly fillers?: ReadonlySet<string>;
    /** 并成一行的分节（投影的 `strips`）：头在入口条里，叶里没有头，有高度就有地方放内容。 */
    readonly merged?: ReadonlySet<string>;
}

/** 投影里并进入口条的分节（输出 47）：它们的头在区域的入口条里。 */
export function mergedSections(projection: Pick<LayoutProjection, "strips">): ReadonlySet<string> {
    return new Set(projection.strips.flatMap((strip) => (strip.merged === null ? [] : [strip.merged])));
}

function hasRoom(id: string, panel: PanelRecord, size: GridExtent | undefined, merged: ReadonlySet<string> | undefined): boolean {
    if (size === undefined) return false;
    return size.width > 0 && size.height > (panel.role === "tool" && merged?.has(id) !== true ? PANEL_HEAD_HEIGHT : 0);
}

/**
 * 有效可见的标签键（输出 17）。手势预览不改已经可见的面板：往零拖过阈值又拖回来，视图不闪；只有从零拉回时才按拖动中的几何算，内容在拖动中就出现（输出 12）。
 */
export function effectiveVisibleTabs(recorded: LayoutDoc, facts: VisibilityFacts): ReadonlySet<string> {
    // 按呈现算：隐藏的区域按拖到零画，从零拉开时内容同样在拖动中出现（输出 11、12）。
    const doc = hiddenRegionsAtZero(recorded);
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
        const committed = !isSectionCollapsed(doc, id) && anchor?.collapsed !== true && hasRoom(id, panel, facts.sizes[id], facts.merged);
        const pulledOut = facts.preview !== null && facts.fillers?.has(id) !== true && hasRoom(id, panel, facts.preview[id], facts.merged);
        // 最大化盖在上面，矩形不来自布局结果。
        if (committed || pulledOut || facts.maximized === id) visible.add(panel.active);
    }
    return visible;
}

/**
 * 区域此刻占不占地方（输出 36）：区域隐藏、拖到零、被最大化盖住、显示着的东西都放不下被收走，都不算；分节收成标题行算，打开着的空区域（锚画成的空面板，ADR 0050）也算。
 * 隐藏与拖到零记在锚上；别的按区域里显示着的面板问：有分节时锚不显示，空着时只有锚显示。
 */
export function regionOccupied(doc: LayoutDoc, region: PanelName, facts: Pick<VisibilityFacts, "removed" | "maximized">): boolean {
    const anchorId = regionAnchor(doc, region);
    const anchor = doc.panels[anchorId ?? ""];
    if (anchorId === null || anchor === undefined || anchor.hidden === true || anchor.collapsed === true) return false;
    const shown = [...regionSections(doc, region).map((section) => section.panel), anchorId].filter((id) => isPanelShown(doc, id));
    if (facts.maximized !== null) return shown.includes(facts.maximized);
    return shown.some((id) => !facts.removed.has(id));
}

/**
 * 入口说的“区域可见”（输出 22、47 的按下态与点击）：区域占着地方，或者正从零拉回来。后一种文档里还记着拖到零，
 * 内容却已经按拖动中的几何可见了（输出 12、17），入口跟着内容走，不等松手。
 */
export function regionVisible(doc: LayoutDoc, region: PanelName, facts: Pick<VisibilityFacts, "removed" | "maximized">, visible: ReadonlySet<string>): boolean {
    return regionOccupied(doc, region, facts) || regionSections(doc, region).some((section) => section.viewId !== null && visible.has(viewKey(section.viewId)));
}

/** 活动栏的一个入口（输出 22、41）：侧栏里一个有成员的容器。 */
export interface ContainerEntry {
    /** 容器 id。 */
    readonly id: string;
    readonly label: ContainerLabel;
    /** 成员视图，按分节的先后；声明不在的也在里面。 */
    readonly views: ReadonlyArray<string>;
    /** 是不是这个区域的当前容器。 */
    readonly current: boolean;
}

/**
 * 一个区域的入口条列什么：区域里有成员的容器，按入口顺序。侧栏的入口在活动栏上段（输出 22），右栏、底部面板的在各自卡片顶上的入口条（输出 47）；
 * 搬到别的区域的容器不在这里。
 */
export function regionEntries(doc: LayoutDoc, region: PanelName, views: ViewCatalog, containers: ContainerCatalog = NO_CONTAINERS): ReadonlyArray<ContainerEntry> {
    const current = doc.panels[regionAnchor(doc, region) ?? ""]?.activeContainer ?? null;
    return regionContainers(doc, region).flatMap((container): ContainerEntry[] => {
        const label = containerLabel(container, views, containers);
        return label === null ? [] : [{id: container.id, label, views: container.views, current: container.id === current}];
    });
}

/**
 * 入口点了做什么（输出 22、47，三个区域一样）：不是当前容器就切到它，区域隐藏或拖到零时同一次写入展开；是当前容器时，区域可见就隐藏区域，不可见就展开。
 * 所以只有两种动作：`show` 是“区域显示并切到这个容器”，`hide` 是隐藏区域。容器不在这个区域里（没有成员、在别的区域）时什么都不做。
 */
export type RegionEntryIntent =
    | {readonly kind: "show"; readonly container: string}
    | {readonly kind: "hide"}
    | {readonly kind: "none"};

export function regionEntryIntent(doc: LayoutDoc, region: PanelName, container: string, facts: {readonly regionVisible: boolean}): RegionEntryIntent {
    const entry = regionContainers(doc, region).find((candidate) => candidate.id === container);
    if (entry === undefined) return {kind: "none"};
    const current = doc.panels[regionAnchor(doc, region) ?? ""]?.activeContainer === container;
    return current && facts.regionVisible ? {kind: "hide"} : {kind: "show", container};
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
 * - `entry`：去它那个容器的入口：侧栏、右栏的在侧轨上（活动栏、右轨，输出 50），区域隐藏、拖到零、放不下被收走时侧轨都在，一直看得见；
 *   底部面板的在区域卡片顶上的入口条里（输出 47），区域隐藏或拖到零时入口条跟着缩没了，不算落点。
 */
/** 这个区域的容器入口在侧轨上（侧栏在活动栏、右栏在右轨，输出 50），不在区域卡片顶上的入口条里：区域看不见时入口也还在。 */
export const entriesOnRail = (region: PanelName): boolean => region !== "panel";

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
    // 缩没了的入口条里的按钮还在 DOM 里、也不 inert，调用方按“画出来了”筛不掉它，所以在这里按文档排除。
    if (entriesOnRail(region) || (anchor.hidden !== true && anchor.collapsed !== true)) landings.push({kind: "entry", container: panel.container});
    return landings;
}

/** 标签与它控制的内容互相引用的 DOM id：标签在面板头（外框里），内容在内容层，两边各算出同一个。 */
export const panelTabDomId = (prefix: string, key: string): string => `${prefix}-tab-${key}`;
export const panelTabpanelDomId = (prefix: string, key: string): string => `${prefix}-tabpanel-${key}`;
/**
 * 只写标题的面板里隐藏的声明标题（输出 20）：内容 `region` 的名称指向它，不指向标题按钮。视图接管了标题区时按钮写的是视图的内容
 * （对话写会话标题），区域的名称仍是声明标题。
 */
export const panelTitleDomId = (prefix: string, key: string): string => `${prefix}-title-${key}`;

/**
 * “移动到”的一项（输出 23）：移进别的容器（`label` 与活动栏的入口是同一个求值，输出 41），在一个区域里新建容器，或回到声明的容器。
 * 执行都是 `nbook.view.move-view`：前两种给 `{container}` 与 `{newContainerIn}`，重置位置给 `{container: 声明的容器}`。
 */
export type MoveTarget =
    | {readonly kind: "container"; readonly container: string; readonly region: PanelName; readonly label: ContainerLabel}
    | {readonly kind: "new-container"; readonly region: PanelName}
    | {readonly kind: "reset"; readonly container: string};

/**
 * “移动到”菜单与命令面板第二步的目标表，两处读同一份；视图不在文档里时是 null。按区域（侧栏、右栏、底部面板）、区域里按入口顺序列有成员的容器，跳过视图此刻所在的那个；
 * 然后三个区域的新容器；视图不在它声明的容器（没声明的是隐式容器）时最后是“重置位置”（浮动着的不在任何容器里，也有）。可不可以移动由调用方按声明判。
 */
export function moveTargetsOf(doc: LayoutDoc, viewId: string, views: ViewCatalog, containers: ContainerCatalog = NO_CONTAINERS): ReadonlyArray<MoveTarget> | null {
    if (findTab(doc, viewKey(viewId)) === null) return null;
    const here = viewSection(doc, viewId)?.container ?? null;
    const into = VIEW_LOCATIONS.flatMap((region) => regionContainers(doc, region).flatMap((container): MoveTarget[] => {
        const label = container.id === here ? null : containerLabel(container, views, containers);
        return label === null ? [] : [{kind: "container", container: container.id, region, label}];
    }));
    const fresh = VIEW_LOCATIONS.map((region): MoveTarget => ({kind: "new-container", region}));
    const home = viewHome(viewId, views, containers);
    const reset: MoveTarget[] = home !== null && canResetView(doc, views, viewId, containers) ? [{kind: "reset", container: home.container}] : [];
    return [...into, ...fresh, ...reset];
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
    const viewId = active === null ? null : viewIdOf(active);
    return (viewId === null ? undefined : catalog.get(viewId)?.title) ?? panelId;
}

/** 视图不在它声明的容器（没声明的是它的隐式容器）时才能“重置位置”（输出 23）；浮动着的不在任何容器里。 */
export function canResetView(doc: LayoutDoc, catalog: ViewCatalog, viewId: string, containers: ContainerCatalog = NO_CONTAINERS): boolean {
    const found = findTab(doc, viewKey(viewId));
    const home = viewHome(viewId, catalog, containers);
    return found !== null && home !== null && viewSection(doc, viewId)?.container !== home.container;
}

/** 这块面板已经是独占一个浮动窗的（只有一个标签）：它的标签再浮出来还是原样。`home` 是标签所在的面板，没找到标签时是 null 或 undefined。 */
export const isSoleWindow = (doc: LayoutDoc, home: string | null | undefined): boolean => home != null && isFloating(doc, home) && doc.panels[home]?.tabs.length === 1;

/** 视图的标签键。 */
export const viewKey = (viewId: string): string => tabKey({kind: "view", viewId});

/** 视图 id；不是视图的标签键是 null。 */
export const viewIdOf = (key: string): string | null => (key.startsWith(VIEW_KEY_PREFIX) ? key.slice(VIEW_KEY_PREFIX.length) : null);

/** 按文档的对象身份记住结构键：文档不可变（操作返回新对象），拖动每帧都问一次，文档一场里不变。 */
const structureKeys = new WeakMap<LayoutDoc, string>();

/**
 * 拖动的结构键（输出 32）：树的拓扑、标签集合与各区域的当前容器。尺寸、活动标签变了不算。
 * 当前容器在里面：判定的几何是拿起时量的（ADR 0046 决策 5），命令切走容器之后看得见的分节换了，旧几何指着的已经不是屏幕上的东西。
 */
export function layoutStructureKey(doc: LayoutDoc): string {
    const known = structureKeys.get(doc);
    if (known !== undefined) return known;
    const shape = (node: LayoutDoc["tree"]["root"]): unknown => (node.kind === "leaf" ? node.id : [node.id, node.children.map(shape)]);
    const active = Object.values(doc.panels).flatMap((panel) => (panel.name === undefined || panel.entries === undefined ? [] : [[panel.name, panel.activeContainer ?? null]])).sort();
    const key = JSON.stringify([shape(doc.tree.root), doc.floats.map((float) => float.panel).sort(), Object.values(doc.panels).flatMap((panel) => panel.tabs.map(tabKey)).sort(), active]);
    structureKeys.set(doc, key);
    return key;
}
