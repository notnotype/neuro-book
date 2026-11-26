/**
 * 布局文档（docs/specs/ui/workbench-layout.md）：工作台的一棵树与树上的面板。文档是用户的布局，隐藏的面板也在里面；交给 `createGrid` 的
 * 呈现树由 `layout-project.ts` 算。
 *
 * 操作都是纯函数：失败返回问题码，文档不变；结果和现状一样（结构、顺序、标签、活动标签都相同）时返回原对象，调用方据此不提交。
 * 结构操作的出口统一过一次规范形（`normalizeTree`）。规范形是这里自己的规则，不借 `createGrid` 的结构操作（`splitLeaf`、`removeLeaf` 等）：
 * 工作台只把投影出来的树交给 `createGrid`，不在网格上增删移动，网格那边展平与并入的规则改了也不影响这里。
 *
 * 尺寸意图统一是 CSS px，只从呈现尺寸写回（`intent-writeback.ts` 的两个入口：手势落账后、结构操作之前），不读 `grid.serialize()`：那里的 `weight` 是反解出来的比例，
 * 不是 px。所以展平不用换算单位，`fixed` 与 `weight` 之间切换也不用。收起的面板和呈现为零的轴不写，那就是它展开时的尺寸。
 * 例外只有 `setSiblingShares`：结构操作把一组面板搬到别处之后，按搬之前的比例重分它们在新位置合占的那一份，不引入新的单位。
 *
 * 输入可以是 Vue 的响应式代理（`ref`、`reactive`）：操作按 JSON 形状整份复制文档，不用 `structuredClone`，结果是新的普通对象；结果和现状一样时返回原对象。
 * 只改一处的几个操作（改尺寸意图、改分支比例这类）沿用输入里没改的子对象，传进来的面板记录也原样放进结果：输入是代理时这几处仍是代理，
 * 要深拷贝结果用 JSON 拷贝，不要对它 `structuredClone`。
 */

import {GRID_MAX_DEPTH, GRID_MAX_NODES, GRID_SNAPSHOT_VERSION} from "@notnotype/nb-layout";
import type {GridExtent, GridFailure, GridOrientation, GridRect, GridSnapshot, GridSnapshotBranch, GridSnapshotLeaf, GridSnapshotNode} from "@notnotype/nb-layout";

export const LAYOUT_DOC_VERSION = 1;

export type LayoutBar = "activitybar" | "statusbar";
export type PanelName = "sidebar" | "auxiliarybar" | "panel";
export type PanelRole = "tool" | "editor";
export type LayoutEdge = "left" | "right" | "top" | "bottom";

export type TabRef =
    | {readonly kind: "view"; readonly viewId: string}
    | {readonly kind: "tab"; readonly type: string; readonly tabId: string};

export interface PanelRecord {
    readonly role: PanelRole;
    readonly name?: PanelName;
    /** 顺序就是显示顺序。 */
    readonly tabs: ReadonlyArray<TabRef>;
    /** 活动标签的 `tabKey`。 */
    readonly active: string | null;
    /** 只有具名面板会隐藏。具名面板是区域的锚时，隐藏的是整个区域。 */
    readonly hidden?: boolean;
    /** 分节上是收成标题行；区域的锚上是整个区域拖到零（docs/specs/ui/workbench-layout.md 输出 11）。 */
    readonly collapsed?: boolean;
    /** 分节属于哪个容器（输出 40）。只在工具面板上；id 的含义归宿主，库只比较相不相等。 */
    readonly container?: string;
    /** 区域里各容器入口的先后（输出 41）。只在具名面板上；带着它、又没有标签的具名面板是区域的锚（`isContainerAnchor`）。 */
    readonly entries?: ReadonlyArray<string>;
    /** 区域此刻显示的容器（输出 42），在 `entries` 里，或 null。只在具名面板上。不叫 `active`：那是活动标签，每块面板都有。 */
    readonly activeContainer?: string | null;
    /** 各容器的侧轨展开意图（输出 50），键是容器 id、都在 `entries` 里。只在区域的锚上；跟着容器的分节走（`settleRails`）。 */
    readonly rail?: Readonly<Record<string, RailIntent>>;
}

/**
 * 侧轨的展开意图（docs/specs/ui/workbench-layout.md 输出 50、51）：只写偏离缺省的部分，收着、缺省宽度时整项不写。
 * `width` 是卡片宽，读入只认有限正数；呈现时按视图段声明的范围夹取，夹取不写回。
 */
export interface RailIntent {
    readonly expanded?: true;
    readonly width?: number;
}

/** 浮动窗的矩形：卡片本身，相对树区域的 CSS 像素。写入时取整，所以比较不用容差，也不落在半个像素上。拉边与夹取在 nb-layout 的 `grid-rects.ts`（`clampFloatRect`、`resizeFloatRect`）。 */
export type LayoutFloatRect = GridRect;

/** 浮动窗：一块不在树里的面板。 */
export interface LayoutFloat {
    readonly panel: string;
    /** 呈现时夹取（`clampFloatRect`），夹取不写回：窗口变小再变大，窗还在原处。侧轨展开时这是收着的矩形，呈现加上展开的差值（输出 51）。 */
    readonly rect: LayoutFloatRect;
    /** 窗里视图段的展开意图（输出 51）：浮出时从锚上那个容器的项带过来，回到树里时带回去（`settleRails`）。 */
    readonly rail?: RailIntent;
}

/** 浮动窗的上限：每次松手没有落点都开一个窗，不封顶的话记录与 DOM 跟着涨。 */
export const LAYOUT_MAX_FLOATS = 16;

export interface LayoutDoc {
    readonly version: typeof LAYOUT_DOC_VERSION;
    readonly tree: GridSnapshot;
    /** 树里的面板和浮动的面板都在这里。 */
    readonly panels: Readonly<Record<string, PanelRecord>>;
    /** 后面的压在前面的上面。 */
    readonly floats: ReadonlyArray<LayoutFloat>;
    readonly hiddenBars: ReadonlyArray<LayoutBar>;
    readonly currentEditor: string | null;
}

export type LayoutFailureCode = "not-found" | "rejected" | "limit-exceeded";
/** 失败与 nb-layout 同一个形状（Spec `ui/nested-grid` 失败 5）：`message` 是英文，只给日志看；这一层不带 `params`。 */
export type LayoutResult = {readonly ok: true; readonly doc: LayoutDoc} | GridFailure<LayoutFailureCode>;

/** 被拖的东西：一个标签，或整个面板。 */
export type LayoutSource =
    | {readonly kind: "tab"; readonly tab: string}
    | {readonly kind: "panel"; readonly panel: string};

export type LayoutDropRegion = "strip" | "center" | "edge";

/** 宿主给的策略：库不知道角色的含义。 */
export interface LayoutPolicy {
    /** 接受矩阵。`tabs` 是被拖的全部标签（整个面板时不止一个）。 */
    accepts(tabs: ReadonlyArray<TabRef>, target: PanelRecord, region: LayoutDropRegion): boolean;
    /**
     * 这条边是不是落点、落到哪。缺省 `edgeTargetOf`。`null` 表示这块面板在这条边上没有窄带，指针在那里算中央：
     * 宿主用它限定方向（工具面板只能上下拆）和往这个方向怎么分。提交时不再问它，宿主要在写入的出口兜底。
     */
    edgeTarget?(doc: LayoutDoc, tabs: ReadonlyArray<TabRef>, panel: string, edge: LayoutEdge): LayoutEdgeTarget | null;
    /** 这条缝（同一分支里相邻的两个子节点）是不是落点。缺省没有缝落点：缝归最近的面板，按它的外缘判。提交时不再问它。 */
    seamAccepts?(doc: LayoutDoc, tabs: ReadonlyArray<TabRef>, before: string, after: string): boolean;
    /** 分区限制（固定标签）；缺省都可以。 */
    canInsert?(tab: TabRef, target: PanelRecord, index: number): boolean;
    /** 新节点的 id：由宿主给，保证唯一。 */
    newId(kind: "panel" | "branch"): string;
}

const BAR_PREFIX = "bar:";
const PANEL_PREFIX = "panel:";

export const panelRef = (id: string): string => `${PANEL_PREFIX}${id}`;
export const barRef = (bar: LayoutBar): string => `${BAR_PREFIX}${bar}`;
export const barOfRef = (ref: string): LayoutBar | null => (ref.startsWith(BAR_PREFIX) ? (ref.slice(BAR_PREFIX.length) as LayoutBar) : null);
export const panelOfRef = (ref: string): string | null => (ref.startsWith(PANEL_PREFIX) ? ref.slice(PANEL_PREFIX.length) : null);
export const tabKey = (tab: TabRef): string => (tab.kind === "view" ? `view:${tab.viewId}` : `tab:${tab.tabId}`);

const failure = (code: LayoutFailureCode, message: string): LayoutResult => ({ok: false, code, message});

type MutableDoc = {
    version: typeof LAYOUT_DOC_VERSION;
    tree: {version: typeof GRID_SNAPSHOT_VERSION; root: GridSnapshotNode};
    panels: Record<string, PanelRecord>;
    floats: LayoutFloat[];
    hiddenBars: LayoutBar[];
    currentEditor: string | null;
};

/**
 * 按 JSON 形状深拷贝：文档只有对象、数组与原始值。对象用 `Object.fromEntries` 重建，键是 `__proto__` 也是自有键，不会改到原型。
 * 规模：2000 个标签的文档做一次外缘移动（含这次拷贝）约 1.2ms（`layout-doc.test.ts` 的规模用例，2026-11-18 量），拖动预览每次落点各做一次。
 */
function copyJson<T>(value: T): T {
    if (Array.isArray(value)) return value.map(copyJson) as T;
    if (value !== null && typeof value === "object") {
        const record = value as Record<string, unknown>;
        return Object.fromEntries(Object.keys(record).map((key) => [key, copyJson(record[key])])) as T;
    }
    return value;
}

const editable = (doc: LayoutDoc): MutableDoc => copyJson(doc) as unknown as MutableDoc;
/** 改到一半的文档当只读的看：`MutableDoc` 只是把 `LayoutDoc` 的只读去掉。 */
const asDoc = (next: MutableDoc): LayoutDoc => next as unknown as LayoutDoc;

/** 这个 id 在文档里已被用过：面板记录（浮动窗也有记录）或树上的节点（含分支）。 */
const idTaken = (doc: LayoutDoc | MutableDoc, id: string): boolean => doc.panels[id] !== undefined || findTreeNode(doc.tree.root as GridSnapshotNode, id) !== null;

/**
 * 向宿主要一个新 id（`LayoutPolicy.newId`），写入前核对没被用过；用过了是 null，调用方拒绝这次操作，不覆盖别的面板或节点。
 * 宿主的 `newId` 本该给不重复的，但计数器式的实现在重新载入文档后会从头数，库不靠这一点。
 */
function freshId(next: MutableDoc, policy: LayoutPolicy, kind: "panel" | "branch"): string | null {
    const id = policy.newId(kind);
    return idTaken(next, id) ? null : id;
}

export const axisOf = (orientation: GridOrientation): keyof GridExtent => (orientation === "horizontal" ? "width" : "height");
const crossOf = (orientation: GridOrientation): keyof GridExtent => (orientation === "horizontal" ? "height" : "width");
const orientationOfEdge = (edge: LayoutEdge): GridOrientation => (edge === "left" || edge === "right" ? "horizontal" : "vertical");
const isBeforeEdge = (edge: LayoutEdge): boolean => edge === "left" || edge === "top";

export interface TreeHit {
    readonly node: GridSnapshotNode;
    readonly parent: GridSnapshotBranch | null;
    readonly index: number;
}

export function findTreeNode(root: GridSnapshotNode, id: string): TreeHit | null {
    if (root.id === id) return {node: root, parent: null, index: 0};
    if (root.kind === "leaf") return null;
    for (const [index, child] of root.children.entries()) {
        if (child.id === id) return {node: child, parent: root, index};
        const found = findTreeNode(child, id);
        if (found !== null) return found;
    }
    return null;
}

/** 树序的全部叶。 */
export function treeLeaves(node: GridSnapshotNode): GridSnapshotLeaf[] {
    return node.kind === "leaf" ? [node] : node.children.flatMap(treeLeaves);
}

/**
 * 区域的方向（docs/specs/ui/workbench-layout.md 术语“区域”）：侧栏、右栏是一列，底部面板是一排。
 */
export const REGION_ORIENTATION: Readonly<Record<PanelName, GridOrientation>> = {sidebar: "vertical", auxiliarybar: "vertical", panel: "horizontal"};

/**
 * 这片具名面板是不是带容器的区域的锚（ADR 0046）：没有标签，带入口顺序。“这份文档用不用容器”全库只问这一个函数。
 * 两个条件都要：没有新字段的文档里，空的具名面板是一块能显示的普通面板（默认树就是这样起步的），有标签的具名面板也是普通面板，它们的行为都不能变。
 */
export function isContainerAnchor(panel: PanelRecord): boolean {
    return panel.name !== undefined && panel.entries !== undefined && panel.tabs.length === 0;
}

/** 从近到远的祖先分支；节点不在树里是 null。 */
function ancestorsOf(root: GridSnapshotNode, id: string): GridSnapshotBranch[] | null {
    if (root.id === id) return [];
    if (root.kind === "leaf") return null;
    for (const child of root.children) {
        const below = ancestorsOf(child, id);
        if (below !== null) return [...below, root];
    }
    return null;
}

/**
 * 这块面板属于哪个区域：和哪片具名面板同一列（底部面板是同一排）。具名面板是自己那个区域；编辑组、浮动窗不属于任何区域。
 *
 * “同一列”要核对分支的方向：区域里只剩具名面板自己时，那一列在规范形里塌掉，具名面板直接是骨架分支的子节点，和活动栏、编辑区是兄弟。
 * 规范形保证骨架分支的方向和区域相反（同方向早就展平了），所以方向对不上的分支不算，这时区域里只有具名面板自己。
 */
export function regionOf(doc: LayoutDoc, panelId: string): PanelName | null {
    const panel = doc.panels[panelId];
    if (panel === undefined || panel.role !== "tool") return null;
    if (panel.name !== undefined) return panel.name;
    for (const branch of ancestorsOf(doc.tree.root, panelId) ?? []) {
        for (const child of branch.children) {
            const name = child.kind === "leaf" ? doc.panels[child.id]?.name : undefined;
            if (name !== undefined && REGION_ORIENTATION[name] === branch.orientation) return name;
        }
    }
    return null;
}

/** 区域的锚：面板 id 与记录。 */
function anchorOf(doc: LayoutDoc, region: PanelName): {readonly id: string; readonly panel: PanelRecord} | null {
    // 每片分节判可见都要问一次：不用 `Object.entries`，那样每次都新建一份整表的数组。
    for (const id in doc.panels) {
        const panel = doc.panels[id] as PanelRecord;
        if (panel.name === region) return {id, panel};
    }
    return null;
}

/**
 * 区域在文档树里的那个节点：具名面板所在的那一列（排）；区域里只剩它自己时就是它这片叶（见 `regionOf`）。
 * `anchor` 是具名面板的 id。树里没有这片具名面板时是 null。
 */
export function regionNodeOf(doc: LayoutDoc, region: PanelName): {readonly anchor: string; readonly node: GridSnapshotNode} | null {
    const anchor = anchorOf(doc, region);
    const hit = anchor === null ? null : findTreeNode(doc.tree.root, anchor.id);
    if (anchor === null || hit === null) return null;
    return {anchor: anchor.id, node: hit.parent !== null && hit.parent.orientation === REGION_ORIENTATION[region] ? hit.parent : hit.node};
}

/** 区域里有没有分节（锚以外带归属的面板）。没有时锚就是这块区域：显示着就画成一块空面板（ADR 0050）。 */
export function regionHasSections(doc: LayoutDoc, region: PanelName): boolean {
    const hit = regionNodeOf(doc, region);
    return hit !== null && treeLeaves(hit.node).some((leaf) => leaf.id !== hit.anchor && doc.panels[leaf.id]?.container !== undefined);
}

/**
 * 这块面板此刻显示不显示：“面板看不看得见”只有这一个判定，别处不直接读 `hidden`、`container`（ADR 0046 决策 3）。
 * 不管放不放得下、有没有被最大化盖住：那些是呈现的事。
 *
 * - 区域的锚只在区域里一个分节都没有时显示，那时它就是这块空区域（ADR 0050）；有分节时它只记区域的状态，不进呈现树。
 * - 分节（有 `container`）另要所在区域没隐藏、区域的当前容器是它的容器。区域的隐藏直接读锚的 `hidden`，不问“锚显示不显示”：锚自己永远不显示。
 * - 有 `container` 却不在带容器的区域里（不在任何区域里，或区域的具名面板是一块普通面板、不是锚）：归属不起作用，照常显示。“区域用不用容器”和写入路径问的是同一个
 *   `containerAnchorOf`；结构操作不会留下这种记录，这里只是不让它变成找不回来的面板（没有锚就没有能让它显示的操作）。
 */
export function isPanelShown(doc: LayoutDoc, panelId: string): boolean {
    const panel = doc.panels[panelId];
    if (panel === undefined || panel.hidden === true) return false;
    if (panel.name !== undefined) return !isContainerAnchor(panel) || !regionHasSections(doc, panel.name);
    if (panel.container === undefined) return true;
    const anchor = containerAnchorOf(doc, panelId);
    if (anchor === null) return true;
    return anchor.hidden !== true && anchor.activeContainer === panel.container;
}

/** 这个节点此刻占不占地方：隐藏的面板、隐藏的条不占；分支看它的子节点。 */
export function isNodeShown(doc: LayoutDoc, node: GridSnapshotNode): boolean {
    if (node.kind === "branch") return node.children.some((child) => isNodeShown(doc, child));
    const bar = barOfRef(node.ref);
    if (bar !== null) return !doc.hiddenBars.includes(bar);
    return isPanelShown(doc, node.id);
}

/**
 * 呈现用的文档：带容器的区域隐藏着时按拖到零画（docs/specs/ui/workbench-layout.md 输出 11）。锚换成拖到零（去掉 `hidden`、`collapsed` 为真），
 * 区域就进呈现树、为零、留着能拉开的边界，挨着它的缝照常有交汇处。没有隐藏的区域时返回原对象。
 *
 * 只给几何用：投影（`projectLayoutDoc`）、宿主按尺寸算看不看得见。记录不变，“显示”与拉开边界清掉的仍是锚的 `hidden`；
 * `isPanelShown` 照旧按隐藏算，焦点、键盘落点不落到零宽的面板上。不用容器的文档里隐藏的具名面板不换：它可能夹在两个可见面板之间，零宽缝拖的是它。
 */
export function hiddenRegionsAtZero(doc: LayoutDoc): LayoutDoc {
    let panels: Record<string, PanelRecord> | null = null;
    for (const [id, panel] of Object.entries(doc.panels)) {
        if (panel.hidden !== true || !isContainerAnchor(panel)) continue;
        const {hidden: _hidden, ...shown} = panel;
        panels ??= {...doc.panels};
        panels[id] = {...shown, collapsed: true};
    }
    return panels === null ? doc : {...doc, panels};
}

/**
 * 带容器的区域里，这个分节此刻为什么不能收成标题行（docs/specs/ui/workbench-layout.md 输出 11、20）；能收，或者它不是带容器的区域里的分节时是 null。
 *
 * - `"row-region"`：底部面板的分节不折叠。
 * - `"lone-section"`：它是所在区域此刻唯一显示的分节；区域隐藏着时按拖到零算（`hiddenRegionsAtZero`）。那一列在呈现里塌成它这一片叶，叶上唯一的一份收起策略给了“整个区域拖到零”（`projectLayoutDoc`）。
 *
 * 按文档判，不看放不下被收走的：那是呈现的事，窗口变大就回来。
 */
export type SectionCollapseBlock = "row-region" | "lone-section";

export function sectionCollapseBlock(doc: LayoutDoc, panelId: string): SectionCollapseBlock | null {
    const anchor = containerAnchorOf(doc, panelId);
    const region = anchor === null ? null : regionOf(doc, panelId);
    const column = region === null ? null : regionNodeOf(doc, region);
    if (anchor === null || region === null || column === null) return null;
    if (REGION_ORIENTATION[region] !== "vertical") return "row-region";
    // 按呈现数：隐藏的区域按拖到零画（`hiddenRegionsAtZero`），这一列还是那几节。按记录数的话隐藏的那一刻唯一的分节就成了“能收”，
    // 正在缩回去的面板头上多出收起按钮，投影也会把区域的收起策略和这一节自己的收起混在同一片叶上。
    const presented = anchor.hidden === true ? hiddenRegionsAtZero(doc) : doc;
    const shown = treeLeaves(column.node).filter((leaf) => isPanelShown(presented, leaf.id));
    return shown.length === 1 && shown[0]?.id === panelId ? "lone-section" : null;
}

/**
 * 这块面板是带容器的区域里的分节时是它的区域，否则是 null（锚、普通面板、浮动窗、带着残留归属却不在带容器的区域里的）。
 * 落点按分节另判（docs/specs/ui/workbench-layout.md 输出 25 第 7 行）：判定、分区、键盘候选都问这一个函数，和写入路径的“用不用容器”同一个条件。
 */
export function sectionRegionOf(doc: LayoutDoc, panelId: string): PanelName | null {
    if (doc.panels[panelId]?.container === undefined || containerAnchorOf(doc, panelId) === null) return null;
    return regionOf(doc, panelId);
}

/**
 * 这块面板此刻是不是收起着：“收没收起”只有这一个判定，别处不直接读分节的 `collapsed`，和 `isPanelShown` 之于 `hidden` 一样。
 *
 * 记录里的 `collapsed` 是用户的意图，留着；此刻收不成标题行的分节（`sectionCollapseBlock`）按没收起算，区域里又显示两个以上分节时它重新起作用（输出 11）。
 * 不在带容器的区域里的面板（没有容器的文档、浮动窗）只看 `collapsed`。区域的锚恒为 false：它的 `collapsed` 是整个区域拖到零，读锚的记录。
 */
export function isSectionCollapsed(doc: LayoutDoc, panelId: string): boolean {
    const panel = doc.panels[panelId];
    // 先看记录：没收起的面板（绝大多数）不去找区域。
    if (panel === undefined || panel.collapsed !== true || isContainerAnchor(panel)) return false;
    return sectionCollapseBlock(doc, panelId) === null;
}

/** 这个节点占不占主轴的份额：隐藏的不占，收起的只占面板头。 */
export function countsInShare(doc: LayoutDoc, node: GridSnapshotNode): boolean {
    if (node.kind === "branch") return node.children.some((child) => countsInShare(doc, child));
    return isNodeShown(doc, node) && !isSectionCollapsed(doc, node.id);
}

/** 文档树和呈现树都能问：只看结构与 `ref`。 */
export type LayoutTreeNode = {readonly kind: "leaf"; readonly ref: string} | {readonly kind: "branch"; readonly children: ReadonlyArray<LayoutTreeNode>};

export const isBarLeaf = (node: LayoutTreeNode): boolean => node.kind === "leaf" && barOfRef(node.ref) !== null;

/** 这个节点含编辑组吗。 */
export function holdsEditor(doc: LayoutDoc, node: LayoutTreeNode): boolean {
    if (node.kind === "branch") return node.children.some((child) => holdsEditor(doc, child));
    const panel = panelOfRef(node.ref);
    return panel !== null && doc.panels[panel]?.role === "editor";
}

/**
 * 这个子节点保留像素吗（docs/specs/ui/workbench-layout.md 输出 7）：条总是；兄弟里有含编辑组的时，不含编辑组的也是。其余按比例分。
 * 文档树和呈现树的答案相同：呈现里去掉的只有工具面板，不改变“含编辑组”。
 */
export function isFixedChild(doc: LayoutDoc, siblings: ReadonlyArray<LayoutTreeNode>, child: LayoutTreeNode): boolean {
    if (child.kind === "leaf" && barOfRef(child.ref) !== null) return true;
    return siblings.some((sibling) => holdsEditor(doc, sibling)) && !holdsEditor(doc, child);
}

function collapseInto(branch: GridSnapshotBranch, survivor: GridSnapshotNode): GridSnapshotNode {
    return {...survivor, size: {...branch.size}};
}

/**
 * 规范形：同轴嵌套展平，单子分支塌陷。子分支展平时，把占着地方的孙节点的主轴意图放大到等于子分支的外部分配，展平前后每块的尺寸不变；隐藏、收起的孙节点按同一比例，
 * 回来时份额不变。`counts` 是“这个节点占不占主轴的份额”。
 */
export function normalizeTree(node: GridSnapshotNode, counts: (node: GridSnapshotNode) => boolean = () => true): GridSnapshotNode {
    if (node.kind === "leaf") return node;
    const main = axisOf(node.orientation);
    const cross = crossOf(node.orientation);
    const children: GridSnapshotNode[] = [];
    for (const raw of node.children) {
        const child = normalizeTree(raw, counts);
        if (child.kind === "leaf" || child.orientation !== node.orientation) {
            children.push(child);
            continue;
        }
        const total = child.children.filter(counts).reduce((sum, grand) => sum + grand.size[main], 0);
        const scale = total > 0 ? child.size[main] / total : 1;
        for (const grand of child.children) children.push({...grand, size: {...grand.size, [main]: grand.size[main] * scale, [cross]: child.size[cross]}});
    }
    if (children.length === 1) return collapseInto(node, children[0] as GridSnapshotNode);
    return {...node, children};
}

/** 摘掉一个节点；空分支一起摘，单子分支塌陷。`aliases` 记下塌陷掉的分支现在由谁代表，后面的操作按 id 找目标时要用。 */
function detachNode(root: GridSnapshotNode, id: string, aliases: Map<string, string>): GridSnapshotNode | null {
    if (root.id === id) return null;
    if (root.kind === "leaf") return root;
    const children: GridSnapshotNode[] = [];
    for (const child of root.children) {
        const next = detachNode(child, id, aliases);
        if (next !== null) children.push(next);
    }
    if (children.length === 0) return null;
    if (children.length === 1 && children.length !== root.children.length) {
        const survivor = children[0] as GridSnapshotNode;
        aliases.set(root.id, survivor.id);
        return collapseInto(root, survivor);
    }
    return {...root, children};
}

const resolveAlias = (aliases: ReadonlyMap<string, string>, id: string): string => {
    let current = id;
    while (aliases.has(current)) current = aliases.get(current) as string;
    return current;
};

function countScale(node: GridSnapshotNode, depth = 1): {nodes: number; depth: number} {
    if (node.kind === "leaf") return {nodes: 1, depth};
    let nodes = 1;
    let deepest = depth;
    for (const child of node.children) {
        const inner = countScale(child, depth + 1);
        nodes += inner.nodes;
        deepest = Math.max(deepest, inner.depth);
    }
    return {nodes, depth: deepest};
}

/** 树的结构、方向与叶序一样吗。 */
export function sameTreeShape(left: LayoutDoc, right: LayoutDoc): boolean {
    const shape = (node: GridSnapshotNode): unknown => (node.kind === "leaf" ? node.id : {o: node.orientation, c: node.children.map(shape)});
    return JSON.stringify(shape(left.tree.root)) === JSON.stringify(shape(right.tree.root));
}

/** 侧轨意图的比较形：键序与没写的字段不影响结果。 */
const railIntentKey = (intent: RailIntent | undefined): unknown => (intent === undefined ? null : [intent.expanded === true, intent.width ?? null]);
const railKey = (rail: Readonly<Record<string, RailIntent>> | undefined): unknown => (rail === undefined ? [] : Object.keys(rail).sort().map((container) => [container, railIntentKey(rail[container])]));
const floatKey = (float: LayoutFloat): unknown => [float.panel, float.rect.x, float.rect.y, float.rect.width, float.rect.height, railIntentKey(float.rail)];

/**
 * 结果和现状一样吗：结构、方向、叶序、标签、活动标签、显隐与收起，分节的归属、区域的入口顺序与当前容器（输出 28），浮动窗的次序与矩形，
 * 锚与浮动窗上的侧轨意图（输出 50）。不比尺寸意图：摘出再放回，比例舍入后不会相等；也不比分支 id。当前容器没写和 null 是一回事；入口顺序没写和空的不是一回事（`isContainerAnchor`）。
 */
export function sameLayoutShape(left: LayoutDoc, right: LayoutDoc): boolean {
    if (!sameTreeShape(left, right) || JSON.stringify(left.floats.map(floatKey)) !== JSON.stringify(right.floats.map(floatKey))) return false;
    const leftIds = Object.keys(left.panels).sort();
    const rightIds = Object.keys(right.panels).sort();
    if (JSON.stringify(leftIds) !== JSON.stringify(rightIds)) return false;
    const record = (panel: PanelRecord): unknown => [panel.name ?? null, panel.tabs.map(tabKey), panel.active, panel.hidden === true, panel.collapsed === true, panel.container ?? null, panel.entries ?? null, panel.activeContainer ?? null, railKey(panel.rail)];
    return leftIds.every((id) => JSON.stringify(record(left.panels[id] as PanelRecord)) === JSON.stringify(record(right.panels[id] as PanelRecord)))
        && JSON.stringify([...left.hiddenBars].sort()) === JSON.stringify([...right.hiddenBars].sort())
        && left.currentEditor === right.currentEditor;
}

/**
 * 收起是按所在分支的方向呈现的：纵向是标题行，横向是零宽。一块面板的方向因为结构变了（挨着它开新面板、同一列的兄弟没了），就不再是用户收起时看到的样子，
 * 而且标题行变零宽之后连头都没了：方向变了就展开。
 */
function expandWhereAxisChanged(original: LayoutDoc, next: MutableDoc): void {
    for (const [id, panel] of Object.entries(next.panels)) {
        // 锚的收起是整个区域拖到零，不按它所在分支的方向呈现：区域的第一个分节进来、最后一个分节走掉时它的父分支会换，零宽不该跟着清掉。
        if (panel.collapsed !== true || isContainerAnchor(panel)) continue;
        const before = findTreeNode(original.tree.root, id);
        if (before !== null && before.parent?.orientation !== findTreeNode(next.tree.root, id)?.parent?.orientation) {
            const {collapsed: _collapsed, ...expanded} = panel;
            next.panels[id] = expanded;
        }
    }
}

/**
 * 这一次操作把区域拖空了（原来有分节、现在没有）就隐藏它的锚：拖走区域最后一个视图，区域收起（ADR 0050 决策 3）。用户打开的空区域没有“拖空”这一步，不动它。
 * 放在每个结构操作的出口：提交、预览、判定几何都经过这里，拖空的区域在哪份文档里都一样收起。同一次操作先拖空又放回同一区域的复合操作要自己显示区域。
 */
function hideEmptiedRegions(original: LayoutDoc, next: MutableDoc): void {
    const doc = asDoc(next);
    for (const region of Object.keys(REGION_ORIENTATION) as PanelName[]) {
        const anchor = anchorOf(doc, region);
        if (anchor === null || !isContainerAnchor(anchor.panel) || anchor.panel.hidden === true) continue;
        if (regionHasSections(original, region) && !regionHasSections(doc, region)) next.panels[anchor.id] = {...anchor.panel, hidden: true};
    }
}

/** 去掉锚上一个容器的侧轨意图；去完是空的就整个字段不写。 */
function withoutRail(panel: PanelRecord, container: string): PanelRecord {
    if (panel.rail?.[container] === undefined) return panel;
    const {[container]: _removed, ...rest} = panel.rail;
    const {rail: _rail, ...bare} = panel;
    return Object.keys(rest).length === 0 ? bare : {...bare, rail: rest};
}

const withRail = (panel: PanelRecord, container: string, intent: RailIntent): PanelRecord => ({...panel, rail: {...panel.rail, [container]: intent}});

/**
 * 意图该在哪片锚上：容器还有分节在 `current` 那个区域里就是它（整容器搬家的中间几步，分节分在两个区域里，意图等最后一节走了再搬）；
 * 否则是有它的分节的那片锚；一个分节也不在树里时是 null。
 */
function railHolderOf(doc: LayoutDoc, container: string, current: string | null): string | null {
    let found: string | null = null;
    for (const id in doc.panels) {
        const panel = doc.panels[id] as PanelRecord;
        if (panel.container !== container || isFloating(doc, id)) continue;
        const region = regionOf(doc, id);
        const anchor = region === null ? null : anchorOf(doc, region);
        if (anchor === null || !isContainerAnchor(anchor.panel)) continue;
        if (anchor.id === current) return current;
        found ??= anchor.id;
    }
    return found;
}

/**
 * 侧轨意图跟着它的东西走（输出 50 的“展开”、输出 51）。放在每个结构操作的出口，所以浮出、归位、整容器换区域、拖放、模板与放弃恢复走的都是这一条规则，
 * 不在各个操作里各写一份：
 *
 * - 锚上容器 C 的项：C 的分节去了别的区域，项搬到那里的锚；C 一个分节也不在树里了、它原来的视图成了一个新浮动窗的唯一标签（浮出），项搬到那个窗上。
 *   别的情况（C 只是暂时没有成员）留在原处：声明的与隐式的容器 id 一直在入口顺序里，成员回来时意图还在。用户容器被删时由 `setContainerEntries` 清掉。
 * - 浮动窗上的项：窗没了、它的标签回到树里某个容器的分节（归位、拖回），项写到那个容器的锚上；并进别的浮动窗而那个窗没有项时给它。
 *
 * 操作自己写过或删过的项不动：只看 `original` 有、`next` 里还原样在原处的。
 */
function settleRails(original: LayoutDoc, next: MutableDoc): void {
    const doc = asDoc(next);
    for (const [anchorId, anchor] of Object.entries(original.panels)) {
        if (anchor.rail === undefined) continue;
        for (const [container, intent] of Object.entries(anchor.rail)) {
            const here = next.panels[anchorId];
            if (here?.rail?.[container] === undefined) continue;
            const holder = railHolderOf(doc, container, anchorId);
            if (holder === anchorId) continue;
            if (holder !== null) {
                next.panels[anchorId] = withoutRail(here, container);
                next.panels[holder] = withRail(next.panels[holder] as PanelRecord, container, intent);
                continue;
            }
            const views = new Set(Object.entries(original.panels).flatMap(([id, panel]) => (panel.container === container && !isFloating(original, id) ? panel.tabs.map(tabKey) : [])));
            const floated = next.floats.findIndex((float) => !isFloating(original, float.panel) && float.rail === undefined && (next.panels[float.panel]?.tabs ?? []).length === 1 && views.has(tabKey(next.panels[float.panel]?.tabs[0] as TabRef)));
            if (floated === -1) continue;
            next.panels[anchorId] = withoutRail(here, container);
            next.floats[floated] = {...(next.floats[floated] as LayoutFloat), rail: intent};
        }
    }
    for (const float of original.floats) {
        if (float.rail === undefined || isFloating(doc, float.panel)) continue;
        const tabs = original.panels[float.panel]?.tabs ?? [];
        const landed = tabs.map((tab) => findTab(doc, tabKey(tab))).find((found) => found !== null);
        if (landed === undefined || landed === null) continue;
        const panel = next.panels[landed.panel] as PanelRecord;
        if (isFloating(doc, landed.panel)) {
            const at = next.floats.findIndex((candidate) => candidate.panel === landed.panel);
            if (at !== -1 && next.floats[at]?.rail === undefined) next.floats[at] = {...(next.floats[at] as LayoutFloat), rail: float.rail};
            continue;
        }
        const holder = panel.container === undefined ? null : railHolderOf(doc, panel.container, null);
        if (holder !== null && panel.container !== undefined) next.panels[holder] = withRail(next.panels[holder] as PanelRecord, panel.container, float.rail);
    }
}

/** 改到一半的文档过规范形：占不占份额按这份文档当前的显隐与收起判。 */
const normalizeDoc = (next: MutableDoc): void => {
    next.tree.root = normalizeTree(next.tree.root, (node) => countsInShare(asDoc(next), node));
};

/** 出口：过规范形、查规模；结果和现状一样时返回原对象。 */
function finish(original: LayoutDoc, next: MutableDoc): LayoutResult {
    normalizeDoc(next);
    hideEmptiedRegions(original, next);
    expandWhereAxisChanged(original, next);
    settleRails(original, next);
    const scale = countScale(next.tree.root);
    if (scale.nodes > GRID_MAX_NODES || scale.depth > GRID_MAX_DEPTH) return failure("limit-exceeded", `${String(scale.nodes)} nodes, ${String(scale.depth)} levels deep`);
    const doc = asDoc(next);
    return {ok: true, doc: sameLayoutShape(original, doc) ? original : doc};
}

/**
 * 按给定的比例重分一组兄弟节点合占的主轴意图：它们的和不变，彼此之比换成 `share` 之比；别的兄弟与交叉轴不动。
 *
 * 给“搬一组面板还要保住彼此比例”用：外缘放置每次从落点那块取一半（`placeLeaf`），连放几块之后的比例是 1/2、1/4、1/4 这样的，和搬之前无关。
 * 这些节点必须是同一个分支的子节点，否则“合占的那一份”没有定义。只改意图、形状不变，所以不经 `finish`：那里按形状判“和现状一样”，会把结果丢掉。
 */
export function setSiblingShares(doc: LayoutDoc, shares: ReadonlyArray<{readonly node: string; readonly share: number}>): LayoutResult {
    if (shares.length === 0) return {ok: true, doc};
    if (shares.some((item) => !Number.isFinite(item.share) || item.share <= 0)) return failure("rejected", "Shares must be positive finite numbers");
    if (new Set(shares.map((item) => item.node)).size !== shares.length) return failure("rejected", "A node was given a share twice");
    const hits = shares.map((item) => findTreeNode(doc.tree.root, item.node));
    const parent = hits[0]?.parent ?? null;
    if (parent === null || hits.some((hit) => hit === null || hit.parent !== parent)) return failure("rejected", "The nodes are not children of the same branch");
    const main = axisOf(parent.orientation);
    const total = hits.reduce((sum, hit) => sum + (hit as TreeHit).node.size[main], 0);
    const weight = shares.reduce((sum, item) => sum + item.share, 0);
    if (total <= 0) return failure("rejected", "The nodes together have no main-axis intent to share");
    const shareOf = new Map(shares.map((item) => [item.node, item.share]));
    const resize = (child: GridSnapshotNode): GridSnapshotNode => {
        const share = shareOf.get(child.id);
        return share === undefined ? child : {...child, size: {...child.size, [main]: total * share / weight}};
    };
    const write = (node: GridSnapshotNode): GridSnapshotNode => (node.kind === "leaf" ? node : {...node, children: node.children.map(node.id === parent.id ? resize : write)});
    return {ok: true, doc: {...doc, tree: {...doc.tree, root: write(doc.tree.root)}}};
}

// ── 标签 ──

export function findTab(doc: LayoutDoc, key: string): {readonly panel: string; readonly index: number; readonly tab: TabRef} | null {
    // `for…in` 不为整张面板表分配 `Object.entries` 的数组：这里在每次指针移动的判定里调。`doc.panels` 是 `copyJson` 出来的普通对象，没有继承来的可枚举键。
    for (const panel in doc.panels) {
        const record = doc.panels[panel] as PanelRecord;
        const index = record.tabs.findIndex((tab) => tabKey(tab) === key);
        if (index !== -1) return {panel, index, tab: record.tabs[index] as TabRef};
    }
    return null;
}

/** 活动标签被拿走：优先后一个，没有就前一个。 */
function neighbourActive(tabs: ReadonlyArray<TabRef>, removedIndex: number): string | null {
    const next = tabs[removedIndex] ?? tabs[removedIndex - 1];
    return next === undefined ? null : tabKey(next);
}

function takeTab(next: MutableDoc, panelId: string, index: number): void {
    const panel = next.panels[panelId] as PanelRecord;
    const tabs = panel.tabs.filter((_, at) => at !== index);
    const removedKey = tabKey(panel.tabs[index] as TabRef);
    next.panels[panelId] = {...panel, tabs, active: panel.active === removedKey ? neighbourActive(tabs, index) : panel.active};
}

function removePanelNode(next: MutableDoc, id: string): void {
    if (next.floats.some((float) => float.panel === id)) {
        next.floats = next.floats.filter((float) => float.panel !== id);
    } else {
        const root = detachNode(next.tree.root, id, new Map());
        if (root !== null) next.tree.root = root;
    }
    delete next.panels[id];
}

/** 这块面板浮动着吗。 */
export const isFloating = (doc: Pick<LayoutDoc, "floats">, panel: string): boolean => doc.floats.some((float) => float.panel === panel);

/** 树序的编辑组。浮动的不在里面：“树里至少一个编辑组”只数这些。 */
function treeEditors(doc: Pick<LayoutDoc, "tree" | "panels">): string[] {
    return treeLeaves(doc.tree.root).map((leaf) => leaf.id).filter((id) => doc.panels[id]?.role === "editor");
}

/**
 * 浮动窗没有相邻：它要一块树里的编辑组时（在侧边打开、拆分、关到空后的焦点、回到停靠）落到这里，树序最后一个。校验保证有。
 */
export function treeEditorAnchor(doc: Pick<LayoutDoc, "tree" | "panels">): string | null {
    return treeEditors(doc).at(-1) ?? null;
}

/** 面板空了之后（不变量）：具名面板隐藏，无名工具面板与浮动窗移除，编辑组移除但树里最后一个留着。 */
function settleEmptyPanel(next: MutableDoc, id: string): void {
    const panel = next.panels[id];
    if (panel === undefined || panel.tabs.length > 0) return;
    if (panel.name !== undefined) {
        next.panels[id] = {...panel, hidden: true};
        return;
    }
    const order = treeEditors(next);
    if (panel.role === "editor" && order.length <= 1 && order[0] === id) return;
    // 活动编辑组没了换到相邻的（树序里它后面的，没有时前面的），不是第一个：焦点不该跳过半个窗口。浮动窗没有相邻。
    const at = order.indexOf(id);
    removePanelNode(next, id);
    if (next.currentEditor !== id) return;
    const rest = order.filter((candidate) => candidate !== id);
    next.currentEditor = at === -1 ? (rest.at(-1) ?? null) : (rest[Math.min(at, rest.length - 1)] ?? null);
}

// ── 分节与容器 ──
//
// “一个分节一个标签”“归属跟着面板记录走”（docs/specs/ui/workbench-layout.md 输出 40）是文档的不变量，由这里的操作保证，不做成 `LayoutPolicy` 的钩子：
// 触发条件是文档自己的字段（`container`、锚的 `entries`），不是宿主才知道的事；`isPanelShown` 已经按这些字段判可见，写入的每条路径都要守同一条规则。
// 没有这些字段的文档里，下面的函数都是空操作。

/** 这块面板所在的带容器的区域的锚；不在区域里、区域不用容器、它自己是具名面板时是 null。 */
function containerAnchorOf(doc: LayoutDoc, panelId: string): PanelRecord | null {
    if (doc.panels[panelId]?.name !== undefined) return null;
    const region = regionOf(doc, panelId);
    const anchor = region === null ? null : anchorOf(doc, region);
    return anchor !== null && isContainerAnchor(anchor.panel) ? anchor.panel : null;
}

/** 这块面板不能再多放标签的理由：锚没有标签，分节只有一个。能放时是 null。 */
function refusesMoreTabs(target: PanelRecord): string | null {
    if (isContainerAnchor(target)) return "A region anchor holds no tabs";
    return target.container === undefined ? null : "A section holds only one tab";
}

/**
 * 目标是分节时，“并进它的标签条”改成紧挨着它新建分节：插入位在最前是它前面，其余是它后面；新分节跟它同一个容器。
 * 目标不是分节、或不在树里（浮动窗上的归属不起作用）时是 null，照原来的并入。
 * 目标带着归属却不在带容器的区域里（残留的记录）时不点名容器：新块落下后和它一样没有归属，`settleLanding` 不会因为点了名而拒绝。
 */
function besideSection(doc: LayoutDoc, panelId: string, index: number | undefined): {readonly target: LayoutEdgeTarget; readonly container?: string} | null {
    const container = doc.panels[panelId]?.container;
    const parent = container === undefined ? null : (findTreeNode(doc.tree.root, panelId)?.parent ?? null);
    if (container === undefined || parent === null) return null;
    const before = index !== undefined && index <= 0;
    const edge: LayoutEdge = parent.orientation === "vertical" ? (before ? "top" : "bottom") : (before ? "left" : "right");
    return {target: {kind: "split", panel: panelId, edge}, ...(containerAnchorOf(doc, panelId) === null ? {} : {container})};
}

/**
 * 树里一块多标签的面板原地拆成几块单标签的：沿所在分支的方向排，按原来的标签顺序，平分它原来的份额，记录的其余字段（归属）照抄，都展开。
 * 第一块沿用原来的 id。返回问题说明；没有问题是 null。
 */
function splitPanelInPlace(next: MutableDoc, id: string, newId: () => string): string | null {
    const panel = next.panels[id] as PanelRecord;
    if (panel.tabs.length <= 1) return null;
    const hit = findTreeNode(next.tree.root, id);
    if (hit === null || hit.parent === null) return `Panel ${id} is not in the tree`;
    const main = axisOf(hit.parent.orientation);
    const share = hit.node.size[main] / panel.tabs.length;
    const {collapsed: _collapsed, ...base} = panel;
    const leaves: GridSnapshotNode[] = [];
    for (const [index, tab] of panel.tabs.entries()) {
        const sectionId = index === 0 ? id : newId();
        if (index > 0 && idTaken(next, sectionId)) return `Panel already exists: ${sectionId}`;
        next.panels[sectionId] = {...base, tabs: [tab], active: tabKey(tab)};
        leaves.push({kind: "leaf", id: sectionId, ref: panelRef(sectionId), size: {...hit.node.size, [main]: share}});
    }
    const children = [...hit.parent.children];
    children.splice(hit.index, 1, ...leaves);
    replaceChildren(next, hit.parent.id, children);
    return null;
}

/**
 * 一块面板放到外缘之后，按它落在哪定归属（输出 40）。落在带容器的区域里：写上 `wanted`，没给就是区域的当前容器；区域没有当前容器又没给时不放
 * （没有归属的分节哪个容器都不显示它）；带着几个标签时拆成一个标签一节。落在别处：清掉它原来的归属；调用方点名了容器（`wanted`）时不放，
 * 不把点名的容器悄悄丢掉。返回问题说明；没有问题是 null。
 *
 * `wanted` 不要求已经在锚的入口顺序里：新建容器时入口顺序由调用方在同一次提交里补（`setContainerEntries`），库不规定两步的先后。
 */
function settleLanding(next: MutableDoc, id: string, wanted: string | undefined, policy: LayoutPolicy): string | null {
    const panel = next.panels[id] as PanelRecord;
    const anchor = containerAnchorOf(asDoc(next), id);
    if (anchor === null) {
        if (wanted !== undefined) return `The drop target is not in a region with containers; cannot put it into container ${wanted}`;
        const {container: _container, ...plain} = panel;
        if (panel.container !== undefined) next.panels[id] = plain;
        return null;
    }
    const container = wanted ?? anchor.activeContainer ?? null;
    if (container === null) return "The region has no active container; name the container to put it into";
    next.panels[id] = {...panel, container};
    // 区域没有当前容器（空区域）：落进来的容器就是当前容器，排进入口顺序，不然这一节哪个容器都不显示它。这不是切换当前容器：没有从哪个容器切走（ADR 0050 决策 4）。
    const located = anchor.name === undefined ? null : anchorOf(asDoc(next), anchor.name);
    if ((anchor.activeContainer ?? null) === null && located !== null) {
        const entries = anchor.entries ?? [];
        next.panels[located.id] = {...anchor, entries: entries.includes(container) ? entries : [...entries, container], activeContainer: container};
    }
    return splitPanelInPlace(next, id, () => policy.newId("panel"));
}

/**
 * 换区域的当前容器（输出 42）：同一次写入清掉区域的拖到零；不改区域的隐藏，不改任何尺寸意图。`anchor` 是具名面板的 id；`container` 要在它的入口顺序里，
 * null 是区域里没有容器。已经是这个容器、区域也没拖到零时返回原对象。
 */
export function setActiveContainer(doc: LayoutDoc, anchor: string, container: string | null): LayoutResult {
    const panel = doc.panels[anchor];
    if (panel === undefined) return failure("not-found", `Panel ${anchor}`);
    if (!isContainerAnchor(panel)) return failure("rejected", `Panel ${anchor} is not a region anchor`);
    if (container !== null && panel.entries?.includes(container) !== true) return failure("rejected", `Container ${container} is not in the entry order`);
    const next = editable(doc);
    const {collapsed: _collapsed, ...expanded} = panel;
    next.panels[anchor] = {...expanded, activeContainer: container};
    return finish(doc, next);
}

/**
 * 写区域的入口顺序（输出 41）：整份替换。库不管哪些容器该在里面（有没有成员归宿主算），只守记录自己的规则：不重复、不为空串，当前容器还在里面。
 * 要拿掉当前容器的入口，先用 `setActiveContainer` 换走。
 *
 * 没有标签的具名面板第一次写入口顺序，就成了区域的锚（`isContainerAnchor`）。还有标签的不收：不然它现在照旧是普通面板，标签搬空的那一刻悄悄变成锚。
 */
export function setContainerEntries(doc: LayoutDoc, anchor: string, entries: ReadonlyArray<string>): LayoutResult {
    const panel = doc.panels[anchor];
    if (panel === undefined) return failure("not-found", `Panel ${anchor}`);
    if (panel.name === undefined) return failure("rejected", "Only named panels anchor a region");
    if (panel.tabs.length > 0) return failure("rejected", `Panel ${anchor} still has tabs and cannot anchor a region`);
    if (entries.some((entry) => entry === "") || new Set(entries).size !== entries.length) return failure("rejected", "The entry order has an empty or repeated container");
    const active = panel.activeContainer ?? null;
    if (active !== null && !entries.includes(active)) return failure("rejected", `The active container ${active} is not in the new entry order`);
    const next = editable(doc);
    // 侧轨意图只给入口顺序里的容器：用户容器没有成员、从入口里删掉时，它的意图一起去掉。
    const kept = Object.keys(panel.rail ?? {}).filter((container) => !entries.includes(container)).reduce(withoutRail, panel);
    next.panels[anchor] = {...kept, entries: [...entries], activeContainer: active};
    return finish(doc, next);
}

/**
 * 写一个容器的侧轨意图（输出 50 的“展开”“轨宽手柄”）：`intent` 为 null 或没有字段时去掉这一项。容器要在这片锚的入口顺序里。
 * 只改这一项、不碰树，结果和现状一样时返回原对象（回到原状零写入）。
 */
export function setContainerRail(doc: LayoutDoc, input: {readonly anchor: string; readonly container: string; readonly intent: RailIntent | null}): LayoutResult {
    const panel = doc.panels[input.anchor];
    if (panel === undefined) return failure("not-found", `Panel ${input.anchor}`);
    if (!isContainerAnchor(panel) || !(panel.entries ?? []).includes(input.container)) return failure("rejected", `Container ${input.container} is not in the entry order of ${input.anchor}`);
    if (!validRailWidth(input.intent)) return failure("rejected", `Rail width must be a finite positive number: ${String(input.intent?.width)}`);
    const next = editable(doc);
    next.panels[input.anchor] = input.intent === null || isEmptyRail(input.intent) ? withoutRail(panel, input.container) : withRail(panel, input.container, railIntentOf(input.intent));
    return finish(doc, next);
}

/** 写一个浮动窗的侧轨意图（输出 51）：`intent` 为 null 或没有字段时去掉。 */
export function setFloatRail(doc: LayoutDoc, input: {readonly panel: string; readonly intent: RailIntent | null}): LayoutResult {
    if (!isFloating(doc, input.panel)) return failure("not-found", `Floating window ${input.panel}`);
    if (!validRailWidth(input.intent)) return failure("rejected", `Rail width must be a finite positive number: ${String(input.intent?.width)}`);
    const next = editable(doc);
    next.floats = next.floats.map((float) => {
        if (float.panel !== input.panel) return float;
        const {rail: _rail, ...bare} = float;
        return input.intent === null || isEmptyRail(input.intent) ? bare : {...bare, rail: railIntentOf(input.intent)};
    });
    return finish(doc, next);
}

/** 写入守和读入同一条（`normalizeRailIntent`）：宽度只收有限正数，不然写进去的记录下次读入就被修掉、还报一条诊断。 */
const validRailWidth = (intent: RailIntent | null): boolean => intent?.width === undefined || (Number.isFinite(intent.width) && intent.width > 0);
const isEmptyRail = (intent: RailIntent): boolean => intent.expanded !== true && intent.width === undefined;
/** 只留认得的字段：调用方传进来的对象可能多带别的键。 */
const railIntentOf = (intent: RailIntent): RailIntent => ({...(intent.expanded === true ? {expanded: true as const} : {}), ...(intent.width === undefined ? {} : {width: intent.width})});

export function insertTab(doc: LayoutDoc, input: {readonly panel: string; readonly tab: TabRef; readonly index?: number; readonly activate?: boolean}): LayoutResult {
    const panel = doc.panels[input.panel];
    if (panel === undefined) return failure("not-found", `Panel ${input.panel}`);
    if (findTab(doc, tabKey(input.tab)) !== null) return failure("rejected", `Tab already exists: ${tabKey(input.tab)}`);
    // 这里没有 `policy`，拿不到新面板的 id，转不成新分节：往区域里加视图用 `openPanelAtEdge`。
    const refusal = refusesMoreTabs(panel);
    if (refusal !== null) return failure("rejected", refusal);
    const next = editable(doc);
    const tabs = [...panel.tabs];
    tabs.splice(Math.min(input.index ?? tabs.length, tabs.length), 0, input.tab);
    next.panels[input.panel] = {...panel, tabs, active: input.activate === false ? (panel.active ?? tabKey(input.tab)) : tabKey(input.tab)};
    if (panel.role === "editor" && input.activate !== false) next.currentEditor = input.panel;
    return finish(doc, next);
}

/** preview 替换：一次写完，没有“旧的没了、新的还没来”的中间态。 */
export function replaceTab(doc: LayoutDoc, input: {readonly tab: string; readonly next: TabRef}): LayoutResult {
    const found = findTab(doc, input.tab);
    if (found === null) return failure("not-found", `Tab ${input.tab}`);
    const nextKey = tabKey(input.next);
    if (nextKey !== input.tab && findTab(doc, nextKey) !== null) return failure("rejected", `Tab already exists: ${nextKey}`);
    const next = editable(doc);
    const panel = next.panels[found.panel] as PanelRecord;
    const tabs = [...panel.tabs];
    tabs[found.index] = input.next;
    next.panels[found.panel] = {...panel, tabs, active: panel.active === input.tab ? tabKey(input.next) : panel.active};
    return finish(doc, next);
}

export function removeTab(doc: LayoutDoc, key: string): LayoutResult {
    const found = findTab(doc, key);
    if (found === null) return failure("not-found", `Tab ${key}`);
    const next = editable(doc);
    takeTab(next, found.panel, found.index);
    settleEmptyPanel(next, found.panel);
    return finish(doc, next);
}

export function activateTab(doc: LayoutDoc, key: string): LayoutResult {
    const found = findTab(doc, key);
    if (found === null) return failure("not-found", `Tab ${key}`);
    const next = editable(doc);
    next.panels[found.panel] = {...(next.panels[found.panel] as PanelRecord), active: key};
    if (next.panels[found.panel]?.role === "editor") next.currentEditor = found.panel;
    return finish(doc, next);
}

/** 活动编辑组换到这一块：最近获得焦点或执行过打开的那块。 */
export function setCurrentEditor(doc: LayoutDoc, panel: string): LayoutResult {
    if (doc.panels[panel]?.role !== "editor") return failure("not-found", `Editor group ${panel}`);
    if (doc.currentEditor === panel) return {ok: true, doc};
    const next = editable(doc);
    next.currentEditor = panel;
    return finish(doc, next);
}

/**
 * 移到一个面板的标签条。同一面板就是换顺序；`index` 是摘掉来源之前的插入位。缺省成为活动标签、编辑组成为活动编辑组；`activate: false` 只换位置（固定、键盘排序）：
 * 活动标签不变，进了空面板时它是那块唯一的标签，所以还是它。
 */
export function moveTabToStrip(doc: LayoutDoc, input: {readonly tab: string; readonly panel: string; readonly index: number; readonly activate?: boolean}, policy: LayoutPolicy): LayoutResult {
    const found = findTab(doc, input.tab);
    const target = doc.panels[input.panel];
    if (found === null || target === undefined) return failure("not-found", `Tab ${input.tab} or panel ${input.panel}`);
    if (found.panel !== input.panel && !policy.accepts([found.tab], target, "strip")) return failure("rejected", "Refused by the acceptance matrix");
    if (found.panel !== input.panel) {
        if (isContainerAnchor(target)) return failure("rejected", "A region anchor holds no tabs");
        const beside = besideSection(doc, input.panel, input.index);
        if (beside !== null) return moveTabToEdge(doc, {tab: input.tab, ...beside}, policy);
    }
    const at = Math.max(0, found.panel === input.panel && found.index < input.index ? input.index - 1 : input.index);
    if (policy.canInsert?.(found.tab, target, at) === false) return failure("rejected", "Refused by the insertion policy");
    const next = editable(doc);
    takeTab(next, found.panel, found.index);
    const panel = next.panels[input.panel] as PanelRecord;
    const tabs = [...panel.tabs];
    tabs.splice(Math.min(at, tabs.length), 0, found.tab);
    const activate = input.activate !== false;
    // 同一面板时 `takeTab` 可能已经把活动标签换走了（被移动的就是活动标签），要看摘之前的。
    next.panels[input.panel] = {...panel, tabs, active: activate ? tabKey(found.tab) : (target.active ?? tabKey(found.tab)), ...(panel.collapsed === true && found.panel !== input.panel ? {collapsed: false} : {})};
    if (target.role === "editor" && activate) next.currentEditor = input.panel;
    settleEmptyPanel(next, found.panel);
    return finish(doc, next);
}

/** 整个面板并入另一面板的标签条：全部标签一起，保持顺序。来源按“拖空”处理。 */
export function movePanelToStrip(doc: LayoutDoc, input: {readonly panel: string; readonly target: string; readonly index?: number}, policy: LayoutPolicy): LayoutResult {
    const source = doc.panels[input.panel];
    const target = doc.panels[input.target];
    if (source === undefined || target === undefined) return failure("not-found", `Panel ${input.panel} or ${input.target}`);
    if (input.panel === input.target) return {ok: true, doc};
    // 锚恒为空：照“空的具名面板并进别处”处理，就成了隐藏整个区域的一个意外入口（输出 40：锚不移动）。
    if (isContainerAnchor(source)) return failure("rejected", "A region anchor does not move");
    if (!policy.accepts(source.tabs, target, "strip")) return failure("rejected", "Refused by the acceptance matrix");
    if (isContainerAnchor(target)) return failure("rejected", "A region anchor holds no tabs");
    const beside = besideSection(doc, input.target, input.index);
    if (beside !== null) {
        if (source.name !== undefined) return failure("rejected", "Named panels do not move");
        return movePanelToEdge(doc, {panel: input.panel, ...beside}, policy);
    }
    const at = Math.min(Math.max(0, input.index ?? target.tabs.length), target.tabs.length);
    if (source.tabs.some((tab, offset) => policy.canInsert?.(tab, target, at + offset) === false)) return failure("rejected", "Refused by the insertion policy");
    const next = editable(doc);
    next.panels[input.panel] = {...source, tabs: [], active: null};
    const tabs = [...target.tabs];
    tabs.splice(at, 0, ...source.tabs);
    next.panels[input.target] = {...target, tabs, active: source.active ?? target.active, ...(target.collapsed === true ? {collapsed: false} : {})};
    if (target.role === "editor") next.currentEditor = input.target;
    settleEmptyPanel(next, input.panel);
    return finish(doc, next);
}

// ── 外缘 ──

/**
 * 新块放到哪：放到两块之间，只从这两块取；或者往这块面板的这条边分（输出 27）。`split` 只分这一块；`spread` 和所在分支同方向时整个分支一起分。
 * 两种都只记面板和边，不记分支：摘掉来源之后分支可能塌陷，提交时按这块面板此刻的父分支算。
 */
export type LayoutEdgeTarget =
    | {readonly kind: "between"; readonly branch: string; readonly before: string; readonly after: string}
    | {readonly kind: "split"; readonly panel: string; readonly edge: LayoutEdge}
    | {readonly kind: "spread"; readonly panel: string; readonly edge: LayoutEdge};

/** 这条边对面是同一分支的相邻兄弟吗（规则 4、5）。隐藏的兄弟不算，跳过去找下一个；条不算。 */
export function edgeTargetOf(doc: LayoutDoc, panel: string, edge: LayoutEdge): LayoutEdgeTarget | null {
    const hit = findTreeNode(doc.tree.root, panel);
    if (hit === null) return null;
    const {parent, index} = hit;
    if (parent === null || parent.orientation !== orientationOfEdge(edge)) return {kind: "split", panel, edge};
    const step = isBeforeEdge(edge) ? -1 : 1;
    for (let at = index + step; at >= 0 && at < parent.children.length; at += step) {
        const sibling = parent.children[at] as GridSnapshotNode;
        if (isBarLeaf(sibling)) break;
        if (!isNodeShown(doc, sibling)) continue;
        return step === 1 ? {kind: "between", branch: parent.id, before: panel, after: sibling.id} : {kind: "between", branch: parent.id, before: sibling.id, after: panel};
    }
    return {kind: "split", panel, edge};
}

/** 放一片叶的结果：放好了；目标已不在（`not-found`）；要新建的分支拿到的 id 已被占用（`rejected`）。 */
type Placement = "placed" | "missing" | "taken";

const placementFailure = (placement: Exclude<Placement, "placed">): LayoutResult => (placement === "missing" ? failure("not-found", "The target no longer exists") : failure("rejected", "The id of the new branch is taken"));

/**
 * 把一片叶放到外缘目标（来源已经摘掉）。`between` 新块只从两块取、各让三分之一；`split` 新块取目标的一半；`spread` 见下。
 */
function placeLeaf(next: MutableDoc, target: LayoutEdgeTarget, leaf: GridSnapshotLeaf, aliases: ReadonlyMap<string, string>, newBranchId: () => string | null): Placement {
    const root = next.tree.root;
    if (target.kind === "between") {
        const before = resolveAlias(aliases, target.before);
        const after = resolveAlias(aliases, target.after);
        const beforeHit = findTreeNode(root, before);
        const afterHit = findTreeNode(root, after);
        if (beforeHit === null || afterHit === null || beforeHit.parent === null || beforeHit.parent !== afterHit.parent) return "missing";
        const parent = beforeHit.parent;
        const main = axisOf(parent.orientation);
        const cross = crossOf(parent.orientation);
        const share = (beforeHit.node.size[main] + afterHit.node.size[main]) / 3;
        const children = parent.children.map((child) => (child.id === before || child.id === after ? {...child, size: {...child.size, [main]: child.size[main] * (2 / 3)}} : child));
        const placed: GridSnapshotLeaf = {...leaf, size: {...leaf.size, [main]: share, [cross]: beforeHit.node.size[cross]}};
        children.splice(beforeHit.index + 1, 0, placed);
        replaceChildren(next, parent.id, children);
        return "placed";
    }
    const panel = resolveAlias(aliases, target.panel);
    const hit = findTreeNode(root, panel);
    if (hit === null) return "missing";
    const orientation = orientationOfEdge(target.edge);
    const main = axisOf(orientation);
    const cross = crossOf(orientation);
    if (target.kind === "spread" && hit.parent !== null && hit.parent.orientation === orientation) {
        // 占份额、不保留像素的 n 块一起分：新块占 1/(n+1)，它们按原比例缩，其余不动。摘掉来源之后才算：来源的份额已经还给了分支。
        const parent = hit.parent;
        const view = asDoc(next);
        const sharing = new Set(parent.children.filter((child) => countsInShare(view, child) && !isFixedChild(view, parent.children, child)).map((child) => child.id));
        if (sharing.size > 0) {
            const total = parent.children.reduce((sum, child) => (sharing.has(child.id) ? sum + child.size[main] : sum), 0);
            const scale = sharing.size / (sharing.size + 1);
            const children = parent.children.map((child) => (sharing.has(child.id) ? {...child, size: {...child.size, [main]: child.size[main] * scale}} : child));
            const placed: GridSnapshotLeaf = {...leaf, size: {...leaf.size, [main]: total / (sharing.size + 1), [cross]: hit.node.size[cross]}};
            children.splice(hit.index + (isBeforeEdge(target.edge) ? 0 : 1), 0, placed);
            replaceChildren(next, parent.id, children);
            return "placed";
        }
    }
    const half = hit.node.size[main] / 2;
    const kept = {...hit.node, size: {...hit.node.size, [main]: half}};
    const placed: GridSnapshotLeaf = {...leaf, size: {...leaf.size, [main]: half, [cross]: hit.node.size[cross]}};
    const pair = isBeforeEdge(target.edge) ? [placed, kept] : [kept, placed];
    if (hit.parent !== null && hit.parent.orientation === orientation) {
        const children = [...hit.parent.children];
        children.splice(hit.index, 1, ...pair);
        replaceChildren(next, hit.parent.id, children);
        return "placed";
    }
    const branchId = newBranchId();
    if (branchId === null) return "taken";
    const branch: GridSnapshotBranch = {kind: "branch", id: branchId, orientation, size: {...hit.node.size}, children: pair};
    if (hit.parent === null) {
        next.tree.root = branch;
        return "placed";
    }
    const children = [...hit.parent.children];
    children.splice(hit.index, 1, branch);
    replaceChildren(next, hit.parent.id, children);
    return "placed";
}

function replaceChildren(next: MutableDoc, branchId: string, children: GridSnapshotNode[]): void {
    const write = (node: GridSnapshotNode): GridSnapshotNode => {
        if (node.kind === "leaf") return node;
        if (node.id === branchId) return {...node, children};
        return {...node, children: node.children.map(write)};
    };
    next.tree.root = write(next.tree.root);
}

/** 一个节点里的第一块真实面板：`before`、`after` 可能是分支。 */
export function firstPanelIn(doc: LayoutDoc, nodeId: string): PanelRecord | null {
    const hit = findTreeNode(doc.tree.root, nodeId);
    if (hit === null) return null;
    const first = treeLeaves(hit.node).find((leaf) => doc.panels[leaf.id] !== undefined);
    return first === undefined ? null : (doc.panels[first.id] as PanelRecord);
}

/** 外缘目标里的一块真实面板，接受矩阵问它。 */
const edgeAnchorOf = (doc: LayoutDoc, target: LayoutEdgeTarget): PanelRecord | null => firstPanelIn(doc, target.kind === "between" ? target.before : target.panel);

/**
 * 这个目标是不是锚的交叉方向外缘（侧栏、右栏的锚的左右，底部面板的锚的上下）。往那里放会把锚和新块包进一层交叉方向的分支：锚不再是那一列（排）的直接子叶，
 * `regionOf` 认不出区域，各容器的分节一起显示，结果还过得了校验。所以外缘操作在 `placeLeaf` 之前拒绝它。往区域里加分节用锚沿区域方向的外缘。
 */
function crossesAnchor(doc: LayoutDoc, target: LayoutEdgeTarget): boolean {
    if (target.kind === "between") return false;
    const panel = doc.panels[target.panel];
    return panel?.name !== undefined && isContainerAnchor(panel) && orientationOfEdge(target.edge) !== REGION_ORIENTATION[panel.name];
}

const ANCHOR_CROSS_EDGE = "Cannot drop on the outer edge across a region anchor";

/** 这个目标紧贴着这块面板：放下去还在原处（输出 28）。隐藏的兄弟不算挨着，跳过去看下一个。 */
export function edgeTargetTouches(doc: LayoutDoc, target: LayoutEdgeTarget, panel: string): boolean {
    if (target.kind === "between") return target.before === panel || target.after === panel;
    if (target.panel === panel) return true;
    const hit = findTreeNode(doc.tree.root, target.panel);
    if (hit === null || hit.parent === null || hit.parent.orientation !== orientationOfEdge(target.edge)) return false;
    const step = isBeforeEdge(target.edge) ? -1 : 1;
    for (let at = hit.index + step; at >= 0 && at < hit.parent.children.length; at += step) {
        const sibling = hit.parent.children[at] as GridSnapshotNode;
        if (isNodeShown(doc, sibling)) return sibling.id === panel;
    }
    return false;
}

/**
 * 整块面板移到外缘：同一块叶，id 不变，内容不重建。这也让“放回原处”自然是原对象。
 * 落进带容器的区域时写归属：`container`，没给就是那个区域的当前容器；多标签的拆成一个标签一节（`settleLanding`）。点名了 `container`、落点却不在带容器的区域里时拒绝。
 * `container` 不要求已经在入口顺序里：入口顺序由调用方在同一次提交里补（`setContainerEntries`）。区域的锚不移动（输出 40）。
 */
export function movePanelToEdge(doc: LayoutDoc, input: {readonly panel: string; readonly target: LayoutEdgeTarget; readonly container?: string}, policy: LayoutPolicy): LayoutResult {
    const source = doc.panels[input.panel];
    if (source === undefined) return failure("not-found", `Panel ${input.panel}`);
    if (isContainerAnchor(source)) return failure("rejected", "A region anchor does not move");
    // 浮动窗没有叶，现造一片：尺寸由落点分（`placeLeaf`）。
    const floating = isFloating(doc, input.panel);
    const leaf = floating ? {kind: "leaf" as const, id: input.panel, ref: panelRef(input.panel), size: {width: 0, height: 0}} : findTreeNode(doc.tree.root, input.panel)?.node;
    if (leaf === undefined || leaf.kind !== "leaf") return failure("not-found", `Panel ${input.panel}`);
    if (edgeTargetTouches(doc, input.target, input.panel)) {
        // 位置是原处，但指定了另一个容器（“移动到”那个容器，而它的最后一节正好挨着来源）：只换归属。原处不在带容器的区域里时和 `settleLanding` 一样拒绝。
        if (input.container === undefined || input.container === source.container) return {ok: true, doc};
        if (containerAnchorOf(doc, input.panel) === null) return failure("rejected", `The drop target is not in a region with containers; cannot put it into container ${input.container}`);
        const moved = editable(doc);
        moved.panels[input.panel] = {...source, container: input.container};
        return finish(doc, moved);
    }
    const anchor = edgeAnchorOf(doc, input.target);
    if (anchor === null) return failure("not-found", "The target no longer exists");
    if (crossesAnchor(doc, input.target)) return failure("rejected", ANCHOR_CROSS_EDGE);
    if (!policy.accepts(source.tabs, anchor, "edge")) return failure("rejected", "Refused by the acceptance matrix");
    const next = editable(doc);
    // 放下去的东西要看得见：同一方向移动也展开。
    const {collapsed: _collapsed, ...expanded} = source;
    next.panels[input.panel] = expanded;
    const aliases = new Map<string, string>();
    if (floating) {
        next.floats = next.floats.filter((float) => float.panel !== input.panel);
    } else {
        const root = detachNode(next.tree.root, input.panel, aliases);
        if (root === null) return failure("rejected", "Cannot detach the whole tree");
        next.tree.root = root;
    }
    const placed = placeLeaf(next, input.target, {...leaf, size: {...leaf.size}}, aliases, () => freshId(next, policy, "branch"));
    if (placed !== "placed") return placementFailure(placed);
    const problem = settleLanding(next, input.panel, input.container, policy);
    if (problem !== null) return failure("rejected", problem);
    if (floating && source.role === "editor") next.currentEditor = input.panel;
    return finish(doc, next);
}

/**
 * 标签移到外缘。来源只有这一个标签时是同一块面板移动；否则拆出新面板，继承来源的角色。具名面板不移动：它的位置就是默认位置，标签拆出去，它拖空隐藏（布局提案 2026-11-06 的决策记录）。
 * 工具视图的内容项跟着 `key` 走、不重建；编辑器标签的视图由编辑器决定。`container` 同 `movePanelToEdge`：入口顺序由调用方在同一次提交里补。
 */
export function moveTabToEdge(doc: LayoutDoc, input: {readonly tab: string; readonly target: LayoutEdgeTarget; readonly container?: string}, policy: LayoutPolicy): LayoutResult {
    const found = findTab(doc, input.tab);
    if (found === null) return failure("not-found", `Tab ${input.tab}`);
    const source = doc.panels[found.panel] as PanelRecord;
    if (source.tabs.length === 1) {
        // 原处的判定在 `movePanelToEdge` 里：位置不动时它还要看归属换没换。
        if (source.name === undefined) return movePanelToEdge(doc, {panel: found.panel, target: input.target, ...(input.container === undefined ? {} : {container: input.container})}, policy);
        if (edgeTargetTouches(doc, input.target, found.panel)) return {ok: true, doc};
    }
    const anchor = edgeAnchorOf(doc, input.target);
    if (anchor === null) return failure("not-found", "The target no longer exists");
    if (crossesAnchor(doc, input.target)) return failure("rejected", ANCHOR_CROSS_EDGE);
    if (!policy.accepts([found.tab], anchor, "edge")) return failure("rejected", "Refused by the acceptance matrix");
    const next = editable(doc);
    takeTab(next, found.panel, found.index);
    // 来源拖空的先隐藏，再放：`spread` 按占份额的块分，它不该算在里面。
    settleEmptyPanel(next, found.panel);
    const id = freshId(next, policy, "panel");
    if (id === null) return failure("rejected", "The id of the new panel is taken");
    next.panels[id] = {role: source.role, tabs: [found.tab], active: input.tab};
    const leaf: GridSnapshotLeaf = {kind: "leaf", id, ref: panelRef(id), size: {width: 0, height: 0}};
    const placed = placeLeaf(next, input.target, leaf, new Map(), () => freshId(next, policy, "branch"));
    if (placed !== "placed") return placementFailure(placed);
    const problem = settleLanding(next, id, input.container, policy);
    if (problem !== null) return failure("rejected", problem);
    if (source.role === "editor") next.currentEditor = id;
    return finish(doc, next);
}

/**
 * 在外缘开一块新面板（`"side"` 打开、移动到“新面板”）。`activate: false` 只建组、不改活动编辑组：“在侧边打开”到打开时才切过去。
 * 落进带容器的区域时归属取 `panel.container`，没写就是那个区域的当前容器（`settleLanding`）；写了 `panel.container`、落点却不在带容器的区域里时拒绝。
 * `panel.container` 不要求已经在入口顺序里：入口顺序由调用方在同一次提交里补（`setContainerEntries`）。
 */
export function openPanelAtEdge(doc: LayoutDoc, input: {readonly id: string; readonly panel: PanelRecord; readonly target: LayoutEdgeTarget; readonly activate?: boolean}, policy: LayoutPolicy): LayoutResult {
    if (idTaken(doc, input.id)) return failure("rejected", `Panel already exists: ${input.id}`);
    if (crossesAnchor(doc, input.target)) return failure("rejected", ANCHOR_CROSS_EDGE);
    const next = editable(doc);
    next.panels[input.id] = input.panel;
    const leaf: GridSnapshotLeaf = {kind: "leaf", id: input.id, ref: panelRef(input.id), size: {width: 0, height: 0}};
    const placed = placeLeaf(next, input.target, leaf, new Map(), () => freshId(next, policy, "branch"));
    if (placed !== "placed") return placementFailure(placed);
    const problem = settleLanding(next, input.id, input.panel.container, policy);
    if (problem !== null) return failure("rejected", problem);
    if (input.panel.role === "editor" && input.activate !== false) next.currentEditor = input.id;
    return finish(doc, next);
}

// ── 浮动 ──

export const roundFloatRect = (rect: LayoutFloatRect): LayoutFloatRect => ({x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height)});

/**
 * 标签浮出来：新的无名面板，继承来源的角色。来源是只有这一个标签的浮动窗时只改矩形：同一块面板，不换 id。具名面板不移动，标签拆出去、它拖空隐藏（同 `moveTabToEdge`）。
 */
export function floatTab(doc: LayoutDoc, input: {readonly tab: string; readonly rect: LayoutFloatRect}, policy: LayoutPolicy): LayoutResult {
    const found = findTab(doc, input.tab);
    if (found === null) return failure("not-found", `Tab ${input.tab}`);
    const source = doc.panels[found.panel] as PanelRecord;
    if (source.tabs.length === 1 && isFloating(doc, found.panel)) return setFloatRect(doc, {panel: found.panel, rect: input.rect});
    if (doc.floats.length >= LAYOUT_MAX_FLOATS) return failure("limit-exceeded", `${String(doc.floats.length)} floating windows`);
    const next = editable(doc);
    takeTab(next, found.panel, found.index);
    const id = freshId(next, policy, "panel");
    if (id === null) return failure("rejected", "The id of the new panel is taken");
    next.panels[id] = {role: source.role, tabs: [found.tab], active: input.tab};
    next.floats.push({panel: id, rect: roundFloatRect(input.rect)});
    if (source.role === "editor") next.currentEditor = id;
    settleEmptyPanel(next, found.panel);
    return finish(doc, next);
}

export function setFloatRect(doc: LayoutDoc, input: {readonly panel: string; readonly rect: LayoutFloatRect}): LayoutResult {
    if (!isFloating(doc, input.panel)) return failure("not-found", `Floating window ${input.panel}`);
    const next = editable(doc);
    next.floats = next.floats.map((float) => (float.panel === input.panel ? {...float, rect: roundFloatRect(input.rect)} : float));
    return finish(doc, next);
}

/** 提到最前；已在最前时返回原对象。 */
export function raiseFloat(doc: LayoutDoc, panel: string): LayoutResult {
    const float = doc.floats.find((candidate) => candidate.panel === panel);
    if (float === undefined) return failure("not-found", `Floating window ${panel}`);
    const next = editable(doc);
    next.floats = [...next.floats.filter((candidate) => candidate.panel !== panel), float];
    return finish(doc, next);
}

/**
 * 开一个空的浮动窗（文件拖到没有落点的地方：窗先有，文件再打开进去）。`activate: false` 同 `openPanelAtEdge`。
 * 记录里的 `container` 不写进去：浮动窗不属于任何容器（输出 40），带着它的话“分节只有一个标签”在这块窗上各个入口答案不一。
 */
export function openFloatPanel(doc: LayoutDoc, input: {readonly id: string; readonly panel: PanelRecord; readonly rect: LayoutFloatRect; readonly activate?: boolean}): LayoutResult {
    if (idTaken(doc, input.id)) return failure("rejected", `Panel already exists: ${input.id}`);
    if (doc.floats.length >= LAYOUT_MAX_FLOATS) return failure("limit-exceeded", `${String(doc.floats.length)} floating windows`);
    const next = editable(doc);
    const {container: _container, ...record} = input.panel;
    next.panels[input.id] = record;
    next.floats.push({panel: input.id, rect: roundFloatRect(input.rect)});
    if (input.panel.role === "editor" && input.activate !== false) next.currentEditor = input.id;
    return finish(doc, next);
}

// ── 显隐与收起 ──

export function setPanelHidden(doc: LayoutDoc, panelId: string, hidden: boolean): LayoutResult {
    const panel = doc.panels[panelId];
    if (panel === undefined) return failure("not-found", `Panel ${panelId}`);
    if (hidden && panel.name === undefined) return failure("rejected", "Only named panels can be hidden");
    const next = editable(doc);
    const {hidden: _hidden, collapsed: _collapsed, ...rest} = panel;
    next.panels[panelId] = hidden ? {...panel, hidden: true} : rest;
    return finish(doc, next);
}

/**
 * 收起或展开。区域的锚上是整个区域拖到零。带容器的区域里，此刻收不成标题行的分节（`sectionCollapseBlock`：底部面板的、区域唯一显示的）不收：
 * 呈现里没有它的标题行，写了只会让文档说收起、界面是展开。展开总是允许，记录里留着的 `collapsed` 由它清掉。
 */
export function setPanelCollapsed(doc: LayoutDoc, panelId: string, collapsed: boolean): LayoutResult {
    const panel = doc.panels[panelId];
    if (panel === undefined) return failure("not-found", `Panel ${panelId}`);
    if (collapsed && panel.role === "editor") return failure("rejected", "Editor groups cannot collapse");
    if (collapsed && isFloating(doc, panelId)) return failure("rejected", "Floating windows cannot collapse");
    const block = collapsed ? sectionCollapseBlock(doc, panelId) : null;
    if (block !== null) return failure("rejected", block === "row-region" ? "Sections in the bottom panel do not fold" : "The region shows only this section; it does not fold into a title row");
    const next = editable(doc);
    const {collapsed: _collapsed, ...rest} = panel;
    next.panels[panelId] = collapsed ? {...panel, collapsed: true} : rest;
    return finish(doc, next);
}

export function setBarHidden(doc: LayoutDoc, bar: LayoutBar, hidden: boolean): LayoutResult {
    const next = editable(doc);
    const rest = next.hiddenBars.filter((candidate) => candidate !== bar);
    next.hiddenBars = hidden ? [...rest, bar] : rest;
    return finish(doc, next);
}

/** 存盘前去掉动态标签（未绑定项目的窗口与新项目的模板）：只留工具面板与一个空编辑组。 */
export function stripDynamicTabs(doc: LayoutDoc): LayoutDoc {
    const next = editable(doc);
    for (const [id, panel] of Object.entries(next.panels)) {
        const tabs = panel.tabs.filter((tab) => tab.kind === "view");
        if (tabs.length === panel.tabs.length) continue;
        const active = tabs.some((tab) => tabKey(tab) === panel.active) ? panel.active : (tabs[0] === undefined ? null : tabKey(tabs[0]));
        next.panels[id] = {...panel, tabs, active};
        settleEmptyPanel(next, id);
    }
    normalizeDoc(next);
    return next as unknown as LayoutDoc;
}

/**
 * 放弃布局的改动时用：结构回到 `target`，动态标签以 `from` 为准。动态标签背后是开着的文档，它们的属性和引用不归布局管，只回滚布局这一边就对不上了：`target` 里有、已经关掉的标签拿掉；
 * 开着、`target` 里没有的放回原来那块，那块不在了放进活动编辑组。活动标签与活动编辑组也按 `from`。
 */
export function carryDynamicTabs(target: LayoutDoc, from: LayoutDoc): LayoutDoc {
    const open = Object.entries(from.panels).flatMap(([panel, record]) => record.tabs.flatMap((tab) => (tab.kind === "tab" ? [{panel, tab}] : [])));
    const openKeys = new Set(open.map(({tab}) => tabKey(tab)));
    let next = target;
    const step = (result: LayoutResult): void => {
        if (result.ok) next = result.doc;
    };
    for (const record of Object.values(target.panels)) {
        for (const tab of record.tabs) if (tab.kind === "tab" && !openKeys.has(tabKey(tab))) step(removeTab(next, tabKey(tab)));
    }
    for (const {panel, tab} of open) {
        if (findTab(next, tabKey(tab)) !== null) continue;
        const home = next.panels[panel]?.role === "editor" ? panel : (next.currentEditor ?? treeEditors(next)[0]);
        if (home !== undefined) step(insertTab(next, {panel: home, tab, activate: false}));
    }
    for (const [panel, record] of Object.entries(from.panels)) {
        if (record.active !== null && editorTabInPanel(next, panel, record.active)) step(activateTab(next, record.active));
    }
    if (from.currentEditor !== null) step(setCurrentEditor(next, from.currentEditor));
    return next;
}

function editorTabInPanel(doc: LayoutDoc, panel: string, key: string): boolean {
    const record = doc.panels[panel];
    return record?.role === "editor" && record.tabs.some((tab) => tabKey(tab) === key);
}
