/**
 * 面板的约束（docs/specs/ui/workbench-layout.md 输出 5、6）：工作台给 nb-layout 的策略。库不知道角色与名字的含义。
 */

import {clampFloatRect, GRID_UNBOUNDED} from "@notnotype/nb-layout";
import {findTreeNode, railLeafId, REGION_ORIENTATION, regionNodeOf, regionOf, treeLeaves} from "@notnotype/nb-workbench-layout";
import type {GridExtent, GridLayoutResult, GridNodeInput, GridOrientation} from "@notnotype/nb-layout";
import type {LayoutDoc, LayoutEdge, LayoutEdgeTarget, LayoutFloatRect, LayoutPolicy, LayoutProjection, LayoutProjectionOptions, PanelName, PanelRecord, TabRef} from "@notnotype/nb-workbench-layout";

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
    SHELL_RAIL_WIDTH,
    SHELL_SIDEBAR_MAX_WIDTH,
    SHELL_SIDEBAR_MIN_WIDTH,
    SHELL_STATUSBAR_HEIGHT,
} from "../shell/sizes";
import type {ViewCatalog} from "../views/registry";
import {cardInsetPx} from "../shell/adjacency";

export const PANEL_HEAD_HEIGHT = SHELL_PANEL_COLLAPSED_HEIGHT;
export const EDITOR_GROUP_MINIMUM: GridExtent = {width: 220, height: 120};
/** 新浮动窗的大小：不小于角色的最小尺寸，不大于树区域。 */
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

/** 拖窗时夹回树区域：至少留一段头在里面，抓得到。容器还没量到时不夹。 */
export const keepVisible = (rect: LayoutFloatRect, extent: GridExtent | null): LayoutFloatRect => (extent === null ? rect : clampFloatRect(rect, extent, {width: FLOAT_KEEP_WIDTH, height: PANEL_HEAD_HEIGHT}));

/** 新开的窗整个夹回树区域：在状态栏上松手时，只留头在里面就等于开到了屏幕外。拖窗不一样，用户自己摆的，`keepVisible` 只保证抓得到。 */
export const wholeInTree = (rect: LayoutFloatRect, extent: GridExtent | null): LayoutFloatRect => (extent === null ? rect : clampFloatRect(rect, extent));

/** 放不下时先收哪个区域（输出 10）。 */
const COLLAPSE_REGIONS: ReadonlyArray<PanelName> = ["auxiliarybar", "panel", "sidebar"];

/**
 * 放不下时收走的先后（输出 10）：按右栏、底部面板、侧栏，各区域里的面板按树序。不显示的在里面也无妨，收走的只从显示着的里面挑：
 * 锚只在区域空着时显示（ADR 0050），那时这块空面板按它的区域排。不在这张表里的工具面板排在后面。
 */
export function collapseOrder(doc: LayoutDoc): ReadonlyArray<string> {
    return COLLAPSE_REGIONS.flatMap((region) => {
        const hit = regionNodeOf(doc, region);
        return hit === null ? [] : treeLeaves(hit.node).map((leaf) => leaf.id);
    });
}

/**
 * 一块面板的约束（输出 6）。`region` 是它所在的区域（`regionOf`），不在区域里（浮动窗）是 null，用“其它工具面板”那一行。
 * 区域里的分节各取“区域那一行与自己视图声明的并”；同一列（排）的分节共用交叉轴，求解器把它们并起来，就是区域实际的约束：当前容器里各视图声明的并。
 * 不显示的分节不进呈现树，所以别的容器的声明不参与。
 */
export function panelConstraints(panel: PanelRecord, region: PanelName | null, catalog: ViewCatalog, viewportWidth: number, squeezed = false): {readonly minimumSize: GridExtent; readonly maximumSize: GridExtent} {
    // 工具面板全收走了还放不下：只压编辑组（输出 10）。它们的最小值还在的话约束解不出来，求解器会连条一起按比例压。
    if (panel.role === "editor") return {minimumSize: squeezed ? {width: 0, height: 0} : EDITOR_GROUP_MINIMUM, maximumSize: {width: GRID_UNBOUNDED, height: GRID_UNBOUNDED}};
    const minimumWidth = region === "sidebar" ? SHELL_SIDEBAR_MIN_WIDTH : (region === "auxiliarybar" ? SHELL_AUXILIARYBAR_MIN_WIDTH : SHELL_PANEL_MIN_WIDTH);
    const maximumWidth = region === "sidebar" ? SHELL_SIDEBAR_MAX_WIDTH : (region === "auxiliarybar" ? Math.max(SHELL_AUXILIARYBAR_MAX_FLOOR_WIDTH, viewportWidth * SHELL_AUXILIARYBAR_MAX_VIEWPORT_RATIO) : GRID_UNBOUNDED);
    // 取所有标签的并（最大的最小值、最小的最大值）：切标签不改布局。
    const declared = panel.tabs.flatMap((tab) => (tab.kind === "view" ? [catalog.get(tab.viewId)] : [])).filter((declaration) => declaration !== undefined);
    const minWidth = Math.max(minimumWidth, ...declared.map((view) => view.minimumSize?.width ?? 0));
    const minHeight = Math.max(SHELL_PANEL_MIN_HEIGHT, ...declared.map((view) => view.minimumSize?.height ?? 0));
    const maxWidth = Math.max(minWidth, Math.min(maximumWidth, ...declared.map((view) => view.maximumSize?.width ?? GRID_UNBOUNDED)));
    const maxHeight = Math.max(minHeight, Math.min(GRID_UNBOUNDED, ...declared.map((view) => view.maximumSize?.height ?? GRID_UNBOUNDED)));
    return {minimumSize: {width: minWidth, height: minHeight}, maximumSize: {width: maxWidth, height: maxHeight}};
}

/**
 * 入口条叶顶上被卡片缩掉的那一截（输出 47）：卡片在叶里按主题的缝往里缩，入口条叶只有这一行，缩掉的要加回叶上，卡片里才是完整的一行头高
 * （分节的叶比头高，缩掉的是正文那段，不用加）。只有底部面板有入口条：它顶上挨着编辑区、隔一条分隔线，缩半条缝减半条线，
 * 和别的卡片同一套规则（`shell/adjacency.ts` 的 `cardInsetPx`，隔着分隔线的内边）。
 */
function stripTopInset(gap: number): number {
    return cardInsetPx({kind: "inner", occupied: SASH_PX}, gap);
}

/**
 * `doc` 是要投影的那份文档：约束按面板所在的区域取，区域要从树里问。拿它去投影别的文档（拖动的预览）时，在这份文档里没有的面板按“不在区域里”算。
 */
export function layoutProjectionOptions(input: {
    readonly doc: LayoutDoc;
    readonly catalog: ViewCatalog;
    readonly viewportWidth: number;
    readonly removed?: ReadonlySet<string>;
    readonly cardGap?: number;
    readonly squeezed?: boolean;
    /** 右轨这一次生效的卡片宽（预算的结果，`railBudget`）；不给是收着的。放不下收走（`presentationCollapse`）与基线都按收着算，不给它。 */
    readonly railWidth?: number;
    /** 右栏这一次按预算呈现的宽（`railBudget` 的 `regionWidth`）。 */
    readonly regionWidth?: number;
}): LayoutProjectionOptions {
    // 一次投影里每块面板都问一遍，`regionOf` 要从根找祖先：同一份文档只算一次。
    const regions = new Map<string, PanelName | null>();
    const regionFor = (id: string): PanelName | null => {
        if (!regions.has(id)) regions.set(id, regionOf(input.doc, id));
        return regions.get(id) ?? null;
    };
    return {
        constraints: (id, panel) => panelConstraints(panel, regionFor(id), input.catalog, input.viewportWidth, input.squeezed),
        // 主题的缝宽进几何：活动栏的卡片宽不变，叶宽要加上它和窗体、侧栏之间的缝。
        barThickness: (bar) => (bar === "activitybar" ? SHELL_ACTIVITYBAR_WIDTH + Math.max(0, input.cardGap ?? 0) : SHELL_STATUSBAR_HEIGHT),
        headHeight: PANEL_HEAD_HEIGHT,
        collapseThreshold: SHELL_DRAG_COLLAPSE_THRESHOLD,
        sashSize: SASH_PX,
        // 底部面板卡片顶上一行是入口条，当前容器只有一节时那一节的头并进这一行（输出 47）；侧栏、右栏的入口在各自的侧轨上（输出 22、50）。
        regionStrip: (region) => (region === "panel" ? {height: PANEL_HEAD_HEIGHT + stripTopInset(input.cardGap ?? 0), mergeSole: true} : null),
        // 右栏外侧的右轨（输出 50）：叶厚同活动栏，卡片宽加上它和窗体、右栏之间的缝。展开的宽度由预算给。
        rail: (region) => (region === "auxiliarybar" ? (input.railWidth ?? SHELL_RAIL_WIDTH) + Math.max(0, input.cardGap ?? 0) : null),
        ...(input.regionWidth === undefined ? {} : {regionWidth: {auxiliarybar: input.regionWidth}}),
        ...(input.removed === undefined ? {} : {removed: input.removed}),
    };
}

/**
 * 侧轨展开前的基线（输出 50 的“预算”）：所有侧轨都收着时求解出的编辑组宽、编辑组的最小宽、右栏宽与右栏此刻的有效最小宽（求解器执行的那个：
 * 区域那一行与当前容器里各视图声明的并，`panelConstraints`）。
 */
export interface RailBaseline {
    readonly editor: number;
    readonly editorMinimum: number;
    readonly region: number;
    readonly regionMinimum: number;
}

/** 视图段声明的宽度范围与展开时聊天区的下限（docs/specs/workbench/views.md 输出 21 的 `VIEW_RAIL`）。都是卡片宽。 */
export interface RailSegmentBounds {
    readonly minimum: number;
    readonly maximum: number;
    readonly chatMinimum: number;
}

/**
 * 预算的结果：`width` 是这一次生效的卡片宽（被拒时是收着的宽）；`regionWidth` 是区域这一次要按它呈现的宽（只在要压区域时有，不写意图）。
 * 被拒（`too-narrow`）时用户意图不改，窗口变化时重算。
 */
export type RailBudget =
    | {readonly result: "done"; readonly width: number; readonly regionWidth?: number}
    | {readonly result: "too-narrow"; readonly width: number};

/**
 * 从按收着求解的一次布局里取预算的基线（输出 50 的“预算”）：右栏是代表它的那个呈现节点，编辑组是和右栏同在一个横向分支里、装着编辑组的那个孩子；
 * 宽与有效最小宽都取求解器的（`layout.constraints`），和展开时求解器执行的同一套。右栏不在呈现里（放不下收走）时它的宽与最小都是 0。
 * 找不到编辑组（没有装着编辑组的并排孩子）时是 null：没有可让的编辑组，调用方按不能展开处理。
 */
export function railBaseline(doc: LayoutDoc, projection: LayoutProjection, layout: GridLayoutResult): RailBaseline | null {
    const regionNode = [...projection.regionAnchors].find(([, anchor]) => anchor === "auxiliarybar")?.[0] ?? null;
    const holdsEditor = (node: GridNodeInput<string>): boolean => (node.kind === "leaf" ? doc.panels[node.id]?.role === "editor" : node.children.some(holdsEditor));
    // 和右栏（或右轨）并排的那个横向分支：右轨总在它里面，右栏被收走时也找得到。
    const anchorLeaf = regionNode ?? railLeafId("auxiliarybar");
    const parent = parentOf(projection.input, anchorLeaf);
    const editor = parent?.kind === "branch" && parent.orientation === "horizontal" ? parent.children.find(holdsEditor) : undefined;
    if (editor === undefined) return null;
    const width = (id: string | null): number => (id === null ? 0 : layout.sizes[id]?.width ?? 0);
    const minimum = (id: string | null): number => (id === null ? 0 : layout.constraints[id]?.minimumSize.width ?? 0);
    return {editor: width(editor.id), editorMinimum: minimum(editor.id), region: width(regionNode), regionMinimum: minimum(regionNode)};
}

function parentOf(node: GridNodeInput<string>, id: string): GridNodeInput<string> | null {
    if (node.kind === "leaf") return null;
    for (const child of node.children) {
        if (child.id === id) return node;
        const found = parentOf(child, id);
        if (found !== null) return found;
    }
    return null;
}

/**
 * 展开的侧轨要多少宽、从哪里来（docs/specs/ui/workbench-layout.md 输出 50 的“预算”）：先压编辑组到最小，再压区域到聊天区的下限（不低于区域的有效最小宽），还不够就按能给的展开，
 * 能给的比视图段的下限还窄就不展开。请求宽先夹进视图段声明的范围。纯函数：只看基线，所以结果不随这次展开本身的呈现变化来回翻。
 */
export function railBudget(input: {readonly baseline: RailBaseline; readonly request: number; readonly segment: RailSegmentBounds}): RailBudget {
    const {baseline, segment} = input;
    const request = Math.min(segment.maximum, Math.max(segment.minimum, input.request));
    const wanted = request - SHELL_RAIL_WIDTH;
    if (wanted <= 0) return {result: "done", width: request};
    const fromEditor = Math.max(0, baseline.editor - baseline.editorMinimum);
    // 区域压不过求解器的最小宽：只按聊天下限算的话，预算以为右栏让出了，求解器却压别的固定节点（左侧栏）。
    const fromRegion = Math.max(0, baseline.region - Math.max(segment.chatMinimum, baseline.regionMinimum));
    if (wanted <= fromEditor) return {result: "done", width: request};
    if (wanted <= fromEditor + fromRegion) return {result: "done", width: request, regionWidth: baseline.region - (wanted - fromEditor)};
    const available = SHELL_RAIL_WIDTH + fromEditor + fromRegion;
    if (available < segment.minimum) return {result: "too-narrow", width: SHELL_RAIL_WIDTH};
    return {result: "done", width: available, regionWidth: baseline.region - fromRegion};
}

/**
 * 这一刻侧轨最多能展开到多宽（卡片宽）：编辑组压到最小、区域压到聊天区下限（不低于有效最小宽）之后能给的，再夹进声明的上限。
 * 轨宽手柄按它触界即停（输出 50 的“轨宽手柄”）：拖过它的那段预算给不出，落账写进去意图就比呈现的宽，窗口变宽后侧轨会自己涨。
 */
export function railLimit(baseline: RailBaseline, segment: RailSegmentBounds): number {
    const fromEditor = Math.max(0, baseline.editor - baseline.editorMinimum);
    const fromRegion = Math.max(0, baseline.region - Math.max(segment.chatMinimum, baseline.regionMinimum));
    return Math.min(segment.maximum, SHELL_RAIL_WIDTH + fromEditor + fromRegion);
}

/** 接受矩阵（输出 26）：工具视图只进工具面板，编辑器标签只进编辑组，哪个区域都一样。哪条边算落点归 `layoutEdgeTarget`。 */
export function layoutAccepts(tabs: ReadonlyArray<TabRef>, target: PanelRecord): boolean {
    return tabs.every((tab) => (tab.kind === "view" ? target.role === "tool" : target.role === "editor"));
}

/** 工具面板往哪个方向分（输出 1）：侧栏、右栏这一列上下分，面板这一排左右分，按面板所在的区域问。不在区域里的看父分支的方向。 */
export function toolPanelAxis(doc: LayoutDoc, panelId: string): GridOrientation {
    const region = regionOf(doc, panelId);
    if (region !== null) return REGION_ORIENTATION[region];
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
export function layoutEdgeTarget(doc: LayoutDoc, panelId: string, edge: LayoutEdge, split: DropSplit = "half"): LayoutEdgeTarget | null {
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
export function layoutSeamAccepts(doc: LayoutDoc, before: string, after: string): boolean {
    if (onlyRole(doc, before, "editor") && onlyRole(doc, after, "editor")) return true;
    if (!onlyRole(doc, before, "tool") || !onlyRole(doc, after, "tool")) return false;
    const parent = findTreeNode(doc.tree.root, before)?.parent;
    const first = treeLeaves(findTreeNode(doc.tree.root, before)?.node ?? doc.tree.root)[0];
    return parent != null && first !== undefined && parent.orientation === toolPanelAxis(doc, first.id);
}

export function createLayoutPolicy(overrides: {readonly canInsert?: LayoutPolicy["canInsert"]; readonly dropSplit?: () => DropSplit} = {}): LayoutPolicy {
    const {dropSplit, ...rest} = overrides;
    return {
        accepts: layoutAccepts,
        // 库把被拖的标签也传给这两个回调；工作台的规则只看目标的位置，用不上。
        edgeTarget: (doc, _tabs, panel, edge) => layoutEdgeTarget(doc, panel, edge, dropSplit?.() ?? "half"),
        seamAccepts: (doc, _tabs, before, after) => layoutSeamAccepts(doc, before, after),
        newId: (kind) => `${kind === "panel" ? "p" : "b"}-${crypto.randomUUID()}`,
        ...rest,
    };
}
