/**
 * 视图容器的求值（docs/specs/ui/workbench-layout.md 输出 4、41、43；docs/specs/workbench/views.md 输出 15、16）。纯函数，不碰 DOM 与记录。
 *
 * 文档里只存两样：分节记录上的归属（`container`），锚记录上的入口顺序与当前容器。容器出不出现、叫什么、图标是什么都不存，每次从文档与声明现算；
 * 活动栏、“移动到”菜单读的是这里的同一个结果。
 */

import {findTreeNode, isContainerAnchor, movePanelToEdge, REGION_ORIENTATION, regionNodeOf, setActiveContainer, setContainerEntries, setPanelCollapsed, setPanelHidden, setSiblingShares, treeLeaves} from "@notnotype/nb-workbench-layout";
import type {LayoutDoc, LayoutEdge, LayoutEdgeTarget, LayoutPolicy, LayoutResult, PanelName} from "@notnotype/nb-workbench-layout";

import {CUSTOM_CONTAINER_PREFIX, IMPLICIT_CONTAINER_PREFIX, VIEW_LOCATIONS} from "../../shared/views";
import type {ViewContainerDeclaration, ViewDeclaration, ViewLocation} from "../../shared/views";
import type {ViewCatalog} from "../views/registry";

/** 容器声明目录：容器 id 到声明。只含已接受的声明；第三方没写的 `order` 已经补上（`viewContainerCatalog`）。 */
export type ContainerCatalog = ReadonlyMap<string, ViewContainerDeclaration>;

export const NO_CONTAINERS: ContainerCatalog = new Map();

/** 没写 `container` 的视图自己的容器（输出 41）。 */
export const implicitContainerOf = (viewId: string): string => `${IMPLICIT_CONTAINER_PREFIX}${viewId}`;

/** 视图按声明该在哪：第一次放进布局与“重置位置”时用，之后它在哪由文档决定（views.md 输出 16）。 */
export interface ViewHome {
    readonly container: string;
    /** 容器第一次放进布局时去的区域：声明的容器看容器的 `location`，隐式容器看视图的。 */
    readonly location: ViewLocation;
    /** 容器的入口在区域里的先后；同值按 `key`。 */
    readonly order: number;
    /** 同 `order` 时比它：声明的容器是容器 id，隐式容器是视图 id（所以只有隐式容器时，入口的先后就是视图按 (order, id) 的先后）。 */
    readonly key: string;
}

/**
 * 视图该进哪个容器：声明里写的容器有已接受的声明时是它；没写、或写的容器没有声明时是视图自己的隐式容器。视图没有声明时是 null。
 */
export function viewHome(viewId: string, views: ViewCatalog, containers: ContainerCatalog): ViewHome | null {
    const view = views.get(viewId);
    if (view === undefined) return null;
    const declared = view.container === undefined ? undefined : containers.get(view.container);
    if (view.container !== undefined && declared !== undefined) return {container: view.container, location: declared.location, order: declared.order ?? 0, key: view.container};
    return {container: implicitContainerOf(viewId), location: view.location, order: view.order ?? 0, key: viewId};
}

/** 声明里写了容器、这个容器却没有已接受的声明的视图（views.md 输出 16）：它们落回隐式容器，调用方为每一条记一次诊断。 */
export function unresolvedContainerRefs(views: ViewCatalog, containers: ContainerCatalog): ReadonlyArray<{readonly viewId: string; readonly container: string}> {
    return [...views].flatMap(([viewId, view]) => (view.container !== undefined && !containers.has(view.container) ? [{viewId, container: view.container}] : []));
}

/** 区域的锚的面板 id；树里没有这片具名面板时是 null。 */
export const regionAnchor = (doc: LayoutDoc, region: PanelName): string | null => regionNodeOf(doc, region)?.anchor ?? null;

export interface RegionSection {
    readonly panel: string;
    readonly container: string;
    /** 分节里的视图；分节里不是视图（校验不拦、结构操作不会产生）时是 null。 */
    readonly viewId: string | null;
}

/** 区域里的分节，按树序：容器里分节的先后就是它们在树里的先后（输出 40）。区域不用容器时是空的。 */
export function regionSections(doc: LayoutDoc, region: PanelName): ReadonlyArray<RegionSection> {
    const hit = regionNodeOf(doc, region);
    const anchor = hit === null ? undefined : doc.panels[hit.anchor];
    if (hit === null || anchor === undefined || !isContainerAnchor(anchor)) return [];
    return treeLeaves(hit.node).flatMap((leaf): RegionSection[] => {
        const panel = doc.panels[leaf.id];
        if (leaf.id === hit.anchor || panel?.container === undefined) return [];
        const tab = panel.tabs[0];
        return [{panel: leaf.id, container: panel.container, viewId: tab?.kind === "view" ? tab.viewId : null}];
    });
}

export interface RegionContainer {
    readonly id: string;
    /** 成员分节的面板 id，按树序。 */
    readonly sections: ReadonlyArray<string>;
    /** 成员视图，按分节的先后。 */
    readonly views: ReadonlyArray<string>;
}

/** 区域里出现的容器（输出 41）：按锚的入口顺序，只列此刻有成员的。 */
export function regionContainers(doc: LayoutDoc, region: PanelName): ReadonlyArray<RegionContainer> {
    const hit = regionNodeOf(doc, region);
    const sections = regionSections(doc, region);
    return (hit === null ? [] : (doc.panels[hit.anchor]?.entries ?? [])).flatMap((id): RegionContainer[] => {
        const members = sections.filter((section) => section.container === id);
        return members.length === 0 ? [] : [{id, sections: members.map((member) => member.panel), views: members.flatMap((member) => member.viewId ?? [])}];
    });
}

/** 这个容器此刻在哪个区域：有成员分节的那个；没有成员时是 null。 */
export function containerRegion(doc: LayoutDoc, container: string): PanelName | null {
    return VIEW_LOCATIONS.find((region) => regionSections(doc, region).some((section) => section.container === container)) ?? null;
}

/** 视图此刻所在的分节、区域与容器；不在任何区域里（浮动、不在文档里）时是 null。 */
export function viewSection(doc: LayoutDoc, viewId: string): (RegionSection & {readonly region: PanelName}) | null {
    for (const region of VIEW_LOCATIONS) {
        const section = regionSections(doc, region).find((candidate) => candidate.viewId === viewId);
        if (section !== undefined) return {...section, region};
    }
    return null;
}

export interface ContainerLabel {
    readonly title: ViewDeclaration["title"];
    /** 成员视图的声明都不在时没有图标可取，是 null：画什么占位由界面定。 */
    readonly icon: string | null;
}

/**
 * 容器的标题与图标（输出 41 的顺序）：声明的容器用声明的；隐式容器、用户拖出来的容器、声明不在了的容器取第一个成员视图的（按分节的先后，跳过声明不在的视图）；
 * 成员的声明都不在时写第一个成员的视图 id。没有成员的容器没有入口，这里是 null。
 */
export function containerLabel(container: RegionContainer, views: ViewCatalog, containers: ContainerCatalog): ContainerLabel | null {
    const declared = containers.get(container.id);
    if (declared !== undefined) return {title: declared.title, icon: declared.icon};
    for (const viewId of container.views) {
        const view = views.get(viewId);
        if (view !== undefined) return {title: view.title, icon: view.icon};
    }
    const first = container.views[0];
    return first === undefined ? null : {title: first, icon: null};
}

const AFTER_EDGE: Readonly<Record<PanelName, LayoutEdge>> = {sidebar: "bottom", auxiliarybar: "bottom", panel: "right"};

/**
 * 往区域的一个容器里放分节时的外缘目标：成为这个容器最后一个分节（输出 4、23），从它前面那个分节取一半。容器在这个区域里还没有成员时挂在锚后面：
 * 锚不占地方，取它的一半不动别的容器的分节（切换容器不改尺寸意图，输出 8）。区域不用容器、树里没有锚时是 null。
 */
export function sectionLanding(doc: LayoutDoc, region: PanelName, container: string): LayoutEdgeTarget | null {
    const hit = regionNodeOf(doc, region);
    const anchor = hit === null ? undefined : doc.panels[hit.anchor];
    if (hit === null || anchor === undefined || !isContainerAnchor(anchor)) return null;
    const last = regionSections(doc, region).filter((section) => section.container === container).at(-1);
    return {kind: "split", panel: last?.panel ?? hit.anchor, edge: AFTER_EDGE[region]};
}

/**
 * 容器声明的区域（输出 44 的“重置”）：声明的容器看容器的 `location`，隐式容器看它那个视图的。用户拖出来的容器没有声明的区域；
 * 声明不在了的（容器的声明、隐式容器那个视图的声明）也没有，是 null。
 */
export function containerHomeRegion(container: string, views: ViewCatalog, containers: ContainerCatalog): ViewLocation | null {
    const declared = containers.get(container);
    if (declared !== undefined) return declared.location;
    return container.startsWith(IMPLICIT_CONTAINER_PREFIX) ? (views.get(container.slice(IMPLICIT_CONTAINER_PREFIX.length))?.location ?? null) : null;
}

/** 入口的右键菜单里“移到”哪几个区域（输出 44）：容器此刻所在区域之外的两个，按侧栏、右栏、底部面板的先后；容器没有成员时没有。 */
export function containerMoveTargets(doc: LayoutDoc, container: string): ReadonlyArray<PanelName> {
    const here = containerRegion(doc, container);
    return here === null ? [] : VIEW_LOCATIONS.filter((region) => region !== here);
}

/** 入口的右键菜单里有没有“重置”（输出 44）：容器有声明的区域，此刻不在那里。 */
export function canResetContainer(doc: LayoutDoc, container: string, views: ViewCatalog, containers: ContainerCatalog): boolean {
    const home = containerHomeRegion(container, views, containers);
    const here = containerRegion(doc, container);
    return home !== null && here !== null && here !== home;
}

/**
 * 把整个容器搬到另一个区域（输出 44 的“移到”“重置”）：分节的先后、彼此的大小、收成标题行都带着，入口排到目标区域入口顺序的最后，
 * 目标区域显示（清掉隐藏与拖到零）并切到它。来源区域的当前容器换谁由 `settleContainers` 收尾（调用方提交时过它）；来源区域被搬空时由布局库隐藏（ADR 0050 决策 3）。
 *
 * - 大小：各分节沿区域方向的意图之比不变。来源与目标方向不同（侧栏、右栏是一列，底部面板是一排）时原来的高度之比没有对应，平分。
 * - 收成标题行：只带进一列的区域；底部面板的分节不折叠，搬进去就是展开的。
 *
 * 容器已经在目标区域时返回原对象。中间哪一步被库拒绝，整个动作失败，文档不变。
 */
export function moveContainerTo(doc: LayoutDoc, container: string, to: PanelName, policy: LayoutPolicy): LayoutResult {
    const from = containerRegion(doc, container);
    if (from === null) return {ok: false, code: "not-found", message: `Container ${container}`};
    if (from === to) return {ok: true, doc};
    const members = regionSections(doc, from).filter((section) => section.container === container).map((section) => section.panel);
    const sameAxis = REGION_ORIENTATION[from] === REGION_ORIENTATION[to];
    const main = REGION_ORIENTATION[from] === "vertical" ? "height" : "width";
    // 意图取搬之前的：收成标题行的分节，意图就是它展开时的尺寸（`rebaseIntents` 不写收起的面板）。
    const shares = members.map((panel) => ({node: panel, share: sameAxis ? (findTreeNode(doc.tree.root, panel)?.node.size[main] ?? 0) : 1}));
    const collapsed = REGION_ORIENTATION[to] === "vertical" ? members.filter((panel) => doc.panels[panel]?.collapsed === true) : [];

    let next = doc;
    for (const panel of members) {
        const target = sectionLanding(next, to, container);
        if (target === null) return {ok: false, code: "not-found", message: `Region ${to}`};
        const moved = movePanelToEdge(next, {panel, target, container}, policy);
        if (!moved.ok) return moved;
        next = moved.doc;
    }
    // 外缘放置每次从前一块取一半，连放几块之后的比例和搬之前无关：按搬之前的重分它们合占的那一份。只有一个分节时没有比例可言。
    if (members.length > 1) {
        const shared = setSiblingShares(next, shares);
        if (!shared.ok) return shared;
        next = shared.doc;
    }
    // 外缘放置会展开搬的面板。趁容器还没显示写回去：显示着的唯一一个分节收不成标题行（`sectionCollapseBlock`），记录里的意图却要留着。
    for (const panel of collapsed) {
        const folded = setPanelCollapsed(next, panel, true);
        if (!folded.ok) return folded;
        next = folded.doc;
    }
    // 先归整，入口顺序里才有它；声明的容器与隐式容器以前来过这个区域时 id 还留在原来的位置，这里挪到最后。
    next = settleContainers(next);
    const anchor = regionAnchor(next, to);
    if (anchor === null) return {ok: false, code: "not-found", message: `Region ${to}`};
    const entries = next.panels[anchor]?.entries ?? [];
    const steps = [
        (current: LayoutDoc) => setContainerEntries(current, anchor, [...entries.filter((id) => id !== container), container]),
        (current: LayoutDoc) => setPanelHidden(current, anchor, false),
        (current: LayoutDoc) => setActiveContainer(current, anchor, container),
    ];
    for (const step of steps) {
        const result = step(next);
        if (!result.ok) return result;
        next = result.doc;
    }
    return {ok: true, doc: next};
}

/** 当前容器没有成员了换到谁（输出 43）：入口顺序里它前面最近的有成员的，前面没有就后面最近的；原来就没有当前容器时是第一个有成员的。 */
function successorOf(entries: ReadonlyArray<string>, active: string | null, present: ReadonlySet<string>): string | null {
    const at = active === null ? -1 : entries.indexOf(active);
    if (at === -1) return entries.find((id) => present.has(id)) ?? null;
    return entries.slice(0, at).reverse().find((id) => present.has(id)) ?? entries.slice(at + 1).find((id) => present.has(id)) ?? null;
}

/**
 * 结构操作之后把锚归整到和分节一致（输出 41、43）。库的结构操作只写分节的归属，入口顺序与当前容器由工作台维护，每次提交都过这里：
 *
 * - 有成员、入口顺序里还没有的容器排到最后（按树序）。
 * - 用户拖出来的容器（`custom:`）没有成员了，id 从入口顺序里删掉。声明的容器与隐式容器的 id 留着：成员回来时入口回到原来的位置。
 * - 当前容器没有成员了换到相邻的；换容器同时清掉区域的拖到零（输出 42），不改区域的隐藏。
 *
 * 不隐藏区域：区域被拖空时由布局库在那次结构操作里隐藏（ADR 0050 决策 3），用户打开的空区域留着；这里在 store 的文档每次重算时都跑，隐藏放在这里会把它马上藏起来。
 *
 * 不改树、不改任何尺寸意图。没有要改的时返回原对象。拖动的预览不过这里（输出 38：预览里不切）。
 */
export function settleContainers(doc: LayoutDoc): LayoutDoc {
    let next = doc;
    for (const region of VIEW_LOCATIONS) {
        const hit = regionNodeOf(next, region);
        const anchor = hit === null ? undefined : next.panels[hit.anchor];
        if (hit === null || anchor === undefined || !isContainerAnchor(anchor)) continue;
        const present = new Set(regionSections(next, region).map((section) => section.container));
        const entries = anchor.entries ?? [];
        // 先补入口再换当前容器，最后才删：`setActiveContainer` 只收入口顺序里的容器，`setContainerEntries` 不许拿掉当前容器。
        const listed = [...entries, ...[...present].filter((id) => !entries.includes(id))];
        const active = anchor.activeContainer ?? null;
        const successor = active !== null && present.has(active) ? active : successorOf(listed, active, present);
        const kept = listed.filter((id) => present.has(id) || !id.startsWith(CUSTOM_CONTAINER_PREFIX));
        const steps = [
            (current: LayoutDoc) => (listed.length === entries.length ? null : setContainerEntries(current, hit.anchor, listed)),
            (current: LayoutDoc) => (successor === active ? null : setActiveContainer(current, hit.anchor, successor)),
            (current: LayoutDoc) => (kept.length === listed.length ? null : setContainerEntries(current, hit.anchor, kept)),
        ];
        for (const step of steps) {
            const result = step(next);
            if (result?.ok === true) next = result.doc;
        }
    }
    return next;
}
