/**
 * 默认树与视图的第一次落位（docs/specs/ui/workbench-layout.md 输出 1、4）。纯函数。
 */

import {GRID_SNAPSHOT_VERSION} from "@notnotype/nb-layout";
import {barOfRef, barRef, findTreeNode, isContainerAnchor, openPanelAtEdge, panelRef, REGION_ORIENTATION, removeTab, setActiveContainer, setContainerEntries, tabKey, treeLeaves} from "@notnotype/nb-workbench-layout";
import type {GridExtent, GridOrientation} from "@notnotype/nb-layout";
import type {LayoutBar, LayoutDoc, PanelName, PanelRecord} from "@notnotype/nb-workbench-layout";

import {IMPLICIT_CONTAINER_PREFIX} from "../../shared/views";
import type {ViewCatalog} from "../views/registry";
import {SHELL_ACTIVITYBAR_WIDTH, SHELL_SIZE_DEFAULTS, SHELL_STATUSBAR_HEIGHT} from "../shell/sizes";
import {containerRegion, NO_CONTAINERS, regionAnchor, sectionLanding, settleContainers, viewHome} from "./containers";
import type {ContainerCatalog, ViewHome} from "./containers";
import {createLayoutPolicy} from "./layout-constraints";
import {viewKey} from "./layout-present";
import {settlePlacements} from "./placement";

/** 第一个编辑组的面板 id。 */
export const INITIAL_EDITOR_PANEL = "g0";

/** 尺寸意图是 CSS px；窗口不是这么大时按 `fixed`、`weight` 分配，不用在这里量。 */
const BASE = {width: 1440, height: 900};

type TreeNode = LayoutDoc["tree"]["root"];

/**
 * 分节的面板 id 由视图 id 定，区域那一列（排）的分支 id 由区域名定：同一份声明要算出同一棵树（输出 1），store 在没有记录时每次重算默认布局、
 * 读记录时每次补后来才出现的视图，id 是随机的话同一份文档每算一次就换一批面板。撞了已有的 id 时按序号往后找，仍是确定的。
 */
function freeId(doc: LayoutDoc, base: string): string {
    const taken = (id: string): boolean => doc.panels[id] !== undefined || findTreeNode(doc.tree.root, id) !== null;
    if (!taken(base)) return base;
    for (let serial = 2; ; serial += 1) {
        const id = `${base}#${String(serial)}`;
        if (!taken(id)) return id;
    }
}
const sectionIdBase = (viewId: string): string => `section:${viewId}`;
const regionBranchBase = (region: PanelName): string => `region:${region}`;

const byOrder = <T extends {readonly order: number; readonly key: string}>(left: T, right: T): number => left.order - right.order || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0);

/** 目录里的视图按声明该在哪，按视图的 (order, id) 排好：容器里分节的先后（docs/specs/workbench/views.md 输出 13）。 */
function homesOf(viewIds: ReadonlyArray<string>, catalog: ViewCatalog, containers: ContainerCatalog): ReadonlyArray<{readonly viewId: string; readonly home: ViewHome}> {
    return viewIds
        .flatMap((viewId) => {
            const home = viewHome(viewId, catalog, containers);
            return home === null ? [] : [{viewId, home, order: catalog.get(viewId)?.order ?? 0, key: viewId}];
        })
        .sort(byOrder);
}

/** 一个区域第一次生成时的容器：入口顺序按容器的 (order, key)，容器里的视图按 (order, id)。 */
function regionPlan(region: PanelName, catalog: ViewCatalog, containers: ContainerCatalog): ReadonlyArray<{readonly container: string; readonly views: ReadonlyArray<string>}> {
    const groups = new Map<string, {readonly home: ViewHome; readonly views: string[]}>();
    for (const {viewId, home} of homesOf([...catalog.keys()], catalog, containers)) {
        if (home.location !== region) continue;
        const group = groups.get(home.container) ?? {home, views: []};
        group.views.push(viewId);
        groups.set(home.container, group);
    }
    return [...groups.values()].sort((left, right) => byOrder(left.home, right.home)).map((group) => ({container: group.home.container, views: group.views}));
}

/**
 * 第一次生成文档（输出 1）：每个有成员的容器放进它的区域，一个视图一个分节；有容器的区域显示，没有的、只有不让区域显示的视图的（输出 18）隐藏。直接构造，已经是规范形：
 * 没有容器的区域只有锚这一片叶，有容器的是锚带着分节的一列（底部面板是一排）。锚不占地方，它的意图只在第一个分节挂到它后面时用到（`sectionLanding`）。
 */
export function defaultLayoutDoc(catalog: ViewCatalog, containers: ContainerCatalog = NO_CONTAINERS): LayoutDoc {
    const {sidebarWidth, auxiliarybarWidth, panelHeight} = SHELL_SIZE_DEFAULTS;
    const bodyHeight = BASE.height - SHELL_STATUSBAR_HEIGHT;
    const centerWidth = BASE.width - SHELL_ACTIVITYBAR_WIDTH - sidebarWidth - auxiliarybarWidth;
    const panels: Record<string, PanelRecord> = {[INITIAL_EDITOR_PANEL]: {role: "editor", tabs: [], active: null}};
    const leaf = (id: string, size: GridExtent): TreeNode => ({kind: "leaf", id, ref: panelRef(id), size});

    function regionNode(region: PanelName, size: GridExtent): TreeNode {
        const plan = regionPlan(region, catalog, containers);
        const entries = plan.map((group) => group.container);
        // 区域里有视图才显示；只有声明了 `revealRegion: false` 的视图（后台任务、通知）时也保持隐藏（views.md 输出 18），入口照样有。
        const reveals = plan.some((group) => group.views.some((viewId) => catalog.get(viewId)?.revealRegion !== false));
        panels[region] = {role: "tool", name: region, tabs: [], active: null, entries, activeContainer: entries[0] ?? null, ...(reveals ? {} : {hidden: true})};
        if (plan.length === 0) return leaf(region, size);
        const orientation = REGION_ORIENTATION[region];
        const main = orientation === "vertical" ? "height" : "width";
        // 一个区域只显示当前容器的分节，所以每个容器的分节各自平分整列。
        const sections = plan.flatMap((group) => group.views.map((viewId) => {
            const id = sectionIdBase(viewId);
            const tab = {kind: "view" as const, viewId};
            panels[id] = {role: "tool", tabs: [tab], active: tabKey(tab), container: group.container};
            return leaf(id, {...size, [main]: size[main] / group.views.length});
        }));
        return {kind: "branch", id: regionBranchBase(region), orientation, size, children: [leaf(region, size), ...sections]};
    }

    const tree: LayoutDoc["tree"] = {
        version: GRID_SNAPSHOT_VERSION,
        root: {kind: "branch", id: "root", orientation: "vertical", size: BASE, children: [
            {kind: "branch", id: "body", orientation: "horizontal", size: {width: BASE.width, height: bodyHeight}, children: [
                {kind: "leaf", id: "activitybar", ref: barRef("activitybar"), size: {width: SHELL_ACTIVITYBAR_WIDTH, height: bodyHeight}},
                regionNode("sidebar", {width: sidebarWidth, height: bodyHeight}),
                {kind: "branch", id: "center", orientation: "vertical", size: {width: centerWidth, height: bodyHeight}, children: [
                    leaf(INITIAL_EDITOR_PANEL, {width: centerWidth, height: bodyHeight - panelHeight}),
                    regionNode("panel", {width: centerWidth, height: panelHeight}),
                ]},
                regionNode("auxiliarybar", {width: auxiliarybarWidth, height: bodyHeight}),
            ]},
            {kind: "leaf", id: "statusbar", ref: barRef("statusbar"), size: {width: BASE.width, height: SHELL_STATUSBAR_HEIGHT}},
        ]},
    };
    return {version: 1, tree, panels, floats: [], hiddenBars: [], currentEditor: INITIAL_EDITOR_PANEL};
}

/**
 * 被别的视图声明 `replaces` 点名、此刻目录里又没有声明的旧视图（views.md 输出 20）：标签从所在面板拿掉（分节、别的面板里的标签、浮动窗、
 * 用户拖出的容器都一样，`removeTab` 收空面板），它的隐式容器 `view:<旧 id>` 从入口顺序里清掉。后者是 `settleContainers`“声明的与隐式容器的 id
 * 留着、成员回来时回到原位”的例外：被取代的视图不会回来。没有改动时返回原对象。
 */
function retireReplacedViews(doc: LayoutDoc, catalog: ViewCatalog): LayoutDoc {
    const retired = new Set([...catalog.values()].flatMap((declaration) => declaration.replaces ?? []).filter((old) => !catalog.has(old)));
    if (retired.size === 0) return doc;
    let next = doc;
    for (const old of retired) {
        const key = viewKey(old);
        for (let removed = removeTab(next, key); removed.ok; removed = removeTab(next, key)) next = removed.doc;
        // 它是当前容器时先让 `settleContainers` 换到相邻的（成员没了），再从入口顺序里删；区域里只剩它一个时当前容器清空。
        next = settleContainers(next);
        const implicit = `${IMPLICIT_CONTAINER_PREFIX}${old}`;
        for (const [anchor, panel] of Object.entries(next.panels)) {
            if (panel.entries?.includes(implicit) !== true) continue;
            if (panel.activeContainer === implicit) {
                const cleared = setActiveContainer(next, anchor, null);
                if (cleared.ok) next = cleared.doc;
            }
            const cleaned = setContainerEntries(next, anchor, panel.entries.filter((entry) => entry !== implicit));
            if (cleaned.ok) next = cleaned.doc;
        }
    }
    return next;
}

/**
 * 目录里有、文档里还没有的视图放进它的容器（输出 4）：成为容器最后一个分节。容器已经有成员时加在容器此刻所在的区域；还没有成员时容器放进声明的区域，
 * 入口排在那个区域入口顺序的最后。同时出现的几个之间按 `order`。区域隐藏着就保持隐藏，当前容器也不换；区域原来没有容器时它成为当前容器（`settleContainers`）。
 * 没有改动时返回原对象。
 *
 * 区域不用容器（锚上有标签）的文档不补：那种记录读不进来（`fitsSkeleton`），这里只会遇到默认布局与合骨架的记录。
 */
export function reconcileViews(original: LayoutDoc, catalog: ViewCatalog, containers: ContainerCatalog = NO_CONTAINERS): LayoutDoc {
    // 先摘掉被取代的旧视图、把旧记录里违反位置限制的受限视图分离出来（views.md 输出 22），再补缺的：不然没有缺失视图时直接返回，这两样永远留着。
    const doc = settlePlacements(retireReplacedViews(original, catalog), catalog, createLayoutPolicy());
    const present = new Set(Object.values(doc.panels).flatMap((panel) => panel.tabs.map(tabKey)));
    const missing = homesOf([...catalog.keys()].filter((id) => !present.has(viewKey(id))), catalog, containers);
    if (missing.length === 0) return doc === original ? doc : settleContainers(doc);
    let next = doc;
    /** 这一次才出现的容器，按区域：补完分节之后按 (order, key) 排进入口顺序。 */
    const arrived = new Map<PanelName, ViewHome[]>();
    for (const {viewId, home} of missing) {
        const region = containerRegion(next, home.container) ?? home.location;
        const target = sectionLanding(next, region, home.container);
        if (target === null) continue;
        const anchor = regionAnchor(next, region);
        const known = (anchor !== null && next.panels[anchor]?.entries?.includes(home.container) === true) || arrived.get(region)?.some((other) => other.container === home.container) === true;
        const tab = {kind: "view" as const, viewId};
        const current = next;
        // 区域只剩锚时，分节挂上去要新建那一列的分支：id 和默认布局里的一样由区域名定。
        const policy = {...createLayoutPolicy(), newId: (kind: "panel" | "branch"): string => freeId(current, kind === "branch" ? regionBranchBase(region) : sectionIdBase(viewId))};
        const opened = openPanelAtEdge(next, {id: freeId(next, sectionIdBase(viewId)), panel: {role: "tool", tabs: [tab], active: tabKey(tab), container: home.container}, target}, policy);
        if (!opened.ok) continue;
        next = opened.doc;
        if (!known) arrived.set(region, [...(arrived.get(region) ?? []), home]);
    }
    for (const [region, homes] of arrived) {
        const anchor = regionAnchor(next, region);
        if (anchor === null) continue;
        const listed = setContainerEntries(next, anchor, [...(next.panels[anchor]?.entries ?? []), ...[...homes].sort(byOrder).map((home) => home.container)]);
        if (listed.ok) next = listed.doc;
    }
    return settleContainers(next);
}

const isBar = (node: TreeNode | undefined, bar: LayoutBar): boolean => node?.kind === "leaf" && barOfRef(node.ref) === bar;

/** 区域里别的工具面板是不是分节（输出 40）：恰一个标签，写着归属。 */
const isSection = (panel: PanelRecord | undefined): boolean => panel !== undefined && panel.role === "tool" && panel.name === undefined && panel.tabs.length === 1 && panel.container !== undefined;

/**
 * 这一列（这一排）：这个具名面板自己，或按这个方向分开的几块工具面板，其中恰有它。`sections` 为真时另要它是锚（没有标签、带入口顺序），其余的都是分节。
 */
function isToolRun(doc: LayoutDoc, node: TreeNode | undefined, orientation: GridOrientation, name: PanelName, sections: boolean): boolean {
    if (node === undefined) return false;
    const isAnchor = (id: string): boolean => {
        const panel = doc.panels[id];
        return panel?.name === name && (!sections || isContainerAnchor(panel));
    };
    if (node.kind === "leaf") return isAnchor(node.id);
    return node.orientation === orientation
        && node.children.every((child) => child.kind === "leaf" && doc.panels[child.id]?.role === "tool")
        && node.children.filter((child) => doc.panels[child.id]?.name === name).length === 1
        && node.children.every((child) => (doc.panels[child.id]?.name === name ? isAnchor(child.id) : (!sections || isSection(doc.panels[child.id]))));
}

/** 按具名面板的位置判的那一半骨架；`sections` 为真时加上锚与分节的规则。 */
function fitsFrame(doc: LayoutDoc, sections: boolean): boolean {
    const {root} = doc.tree;
    if (root.kind !== "branch" || root.orientation !== "vertical" || root.children.length !== 2 || !isBar(root.children[1], "statusbar")) return false;
    const body = root.children[0];
    if (body?.kind !== "branch" || body.orientation !== "horizontal" || body.children.length !== 4 || !isBar(body.children[0], "activitybar")) return false;
    if (!isToolRun(doc, body.children[1], "vertical", "sidebar", sections) || !isToolRun(doc, body.children[3], "vertical", "auxiliarybar", sections)) return false;
    const middle = body.children[2];
    if (middle?.kind !== "branch" || middle.orientation !== "vertical" || middle.children.length < 2) return false;
    if (!isToolRun(doc, middle.children.at(-1), "horizontal", "panel", sections)) return false;
    return middle.children.slice(0, -1).every((child) => treeLeaves(child).every((leaf) => doc.panels[leaf.id]?.role === "editor"));
}

/**
 * 树合不合骨架（输出 1）：`V[H[活动栏, 侧栏这一列, V[编辑项…, 面板这一排], 右栏这一列], 状态栏]`，编辑项是编辑组或只含编辑组的分支；骨架按锚的位置判，
 * 并要求三片具名面板都是锚（没有标签、带入口顺序）、区域里别的工具面板都是分节（恰一个标签、写着归属）。文档的校验（`validateLayoutDoc`）不管这个：
 * 骨架是工作台的规则，库不知道。store 读记录时用它决定回落，写入的出口也过它。
 */
export function fitsSkeleton(doc: LayoutDoc): boolean {
    return fitsFrame(doc, true);
}

/**
 * 有容器之前存的记录（“状态与转换”）：位置合骨架，但锚上有标签、区域里有多标签的面板或分节没有归属。它和别的不合骨架的记录一样回落默认布局，
 * 区别只在回落时带上开着的编辑器标签。
 */
export function predatesContainers(doc: LayoutDoc): boolean {
    return fitsFrame(doc, false) && !fitsFrame(doc, true);
}
