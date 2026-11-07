/**
 * 工作台的落点规则（docs/specs/ui/workbench-layout.md 输出 25 到 29）：按这一刻的矩形判定指针落在哪，判定与提交共用同一份动作。纯函数；遮挡（被菜单挡住、
 * `data-no-drop`）由宿主读 DOM 之后不把那块传进来。
 *
 * 动作的身份就是它的内容，会话按它判断“和上次显示的是不是同一个”。缝和外缘是两个落点：缝放到两块之间，外缘往这一块的这个方向分。
 */

import type {GridDropPoint, GridDropRect} from "./grid-drop";
import {placeGrid} from "./grid-rects";
import {createGrid} from "./grid";
import {edgeTargetOf, edgeTargetTouches, findTab, findTreeNode, firstPanelIn, floatTab, insertTab, isNodeShown, movePanelToEdge, movePanelToStrip, moveTabToEdge, moveTabToStrip, openFloatPanel, openPanelAtEdge, setFloatRect, showPanelAndInsert, tabKey, treeLeaves} from "./layout-doc";
import type {LayoutDoc, LayoutEdge, LayoutEdgeTarget, LayoutFloatRect, LayoutPolicy, LayoutResult, LayoutSource, PanelRecord, TabRef} from "./layout-doc";
import {projectLayoutDoc} from "./layout-project";
import type {LayoutProjectionOptions} from "./layout-project";
import type {GridExtent, GridOrientation, GridSnapshotNode} from "./grid-types";

/** 外缘窄带占这一块的比例。 */
export const LAYOUT_EDGE_RATIO = 0.28;
/** 整个浮动窗拖动时的窄带：只有贴着边才停靠，经过中央继续浮着（提案第 3 节）。 */
export const LAYOUT_FLOAT_EDGE_RATIO = 0.14;
/** 指针离一块这么近时算这一块：卡片之间的缝与分隔线都不超过这么宽。条与标题栏经 `excluded` 排除，不靠这个数。 */
const SEAM_PX = 4;
/** 指针离缝的中线这么近时是这条缝（输出 25）。我们的缝只有 1px，要有一条带子才指得中。 */
export const LAYOUT_SEAM_HIT_PX = 6;

export type LayoutDropAction =
    /** `activate: false` 只换位置（活动栏里换序）。缺省成为活动标签。 */
    | {readonly kind: "strip"; readonly panel: string; readonly index: number; readonly activate?: boolean}
    | {readonly kind: "center"; readonly panel: string}
    | {readonly kind: "edge"; readonly target: LayoutEdgeTarget}
    /** 显示这块面板并接收（活动栏放进隐藏的侧栏，输出 22）。`index` 缺省插到最后。 */
    | {readonly kind: "reveal"; readonly panel: string; readonly index?: number}
    /** 浮动：标签浮出来，整个浮动窗是移动。矩形每帧变，比较落点时只看种类（`layoutDropKey`）。 */
    | {readonly kind: "float"; readonly rect: LayoutFloatRect};

/**
 * 判定的来源：文档里的东西（`LayoutSource`），或文档里还没有的一个标签（资源树拖来的文件）。后者只判定、只预览，提交归持有它的人。
 */
export type LayoutDropSource = LayoutSource | {readonly kind: "new"; readonly tab: TabRef};

export interface LayoutDropPanelGeometry {
    readonly id: string;
    /** 整块面板。缺省是 `body` 与 `strip` 的并集；头里还有别的东西（编辑组的提示条）时要给，缝才在对的地方。 */
    readonly frame?: GridDropRect;
    readonly body: GridDropRect;
    /** 标签条的矩形；编辑组与工具面板都有。 */
    readonly strip: GridDropRect | null;
    /** 指针在标签条里时的插入位，由标签条自己量（两种标签条都能给）。 */
    readonly insertionAt?: (point: GridDropPoint) => number;
}

export interface LayoutDropInput {
    readonly doc: LayoutDoc;
    readonly source: LayoutDropSource;
    readonly point: GridDropPoint;
    readonly panels: ReadonlyArray<LayoutDropPanelGeometry>;
    /** 浮动窗，已按叠放从上到下排好。比条、面板都先判：它盖在它们上面，命中了就只看这一块，不穿透。 */
    readonly floats?: ReadonlyArray<LayoutDropPanelGeometry>;
    /** 整个浮动窗拖动：经过中央继续浮着，只有标签条和窄带能停靠。 */
    readonly noCenter?: boolean;
    /** 不是落点的区域：条、标题栏（规则 1）。先判。 */
    readonly excluded?: ReadonlyArray<GridDropRect>;
    readonly policy: LayoutPolicy;
    readonly edgeRatio?: number;
}

const contains = (rect: GridDropRect, point: GridDropPoint): boolean => point.x >= rect.left && point.x < rect.right && point.y >= rect.top && point.y < rect.bottom;

const inGeometry = (geometry: LayoutDropPanelGeometry, point: GridDropPoint): boolean => contains(geometry.body, point) || (geometry.strip !== null && contains(geometry.strip, point));

/** 落点的比较键：会话判断“和上次显示的是不是同一个”、实时布局判断候选稳定不稳定都用它。`float` 的矩形每帧变，只看种类。 */
export const layoutDropKey = (action: LayoutDropAction): string => (action.kind === "float" ? "float" : JSON.stringify(action));

function distanceTo(rect: GridDropRect, point: GridDropPoint): number {
    const dx = Math.max(rect.left - point.x, 0, point.x - rect.right);
    const dy = Math.max(rect.top - point.y, 0, point.y - rect.bottom);
    return Math.hypot(dx, dy);
}

/** 被拖的全部标签。 */
export function sourceTabs(doc: LayoutDoc, source: LayoutDropSource): ReadonlyArray<TabRef> {
    if (source.kind === "new") return [source.tab];
    if (source.kind === "panel") return doc.panels[source.panel]?.tabs ?? [];
    const found = findTab(doc, source.tab);
    return found === null ? [] : [found.tab];
}

function resolveInPanel(input: LayoutDropInput, geometry: LayoutDropPanelGeometry, panel: PanelRecord, tabs: ReadonlyArray<TabRef>): LayoutDropAction | null {
    // 交界那一行算正文：标签条要真的在里面，或者指针在缝上且离标签条更近。
    const strip = geometry.strip;
    if (strip !== null && (contains(strip, input.point) || (!contains(geometry.body, input.point) && distanceTo(strip, input.point) < distanceTo(geometry.body, input.point)))) {
        if (!input.policy.accepts(tabs, panel, "strip")) return null;
        return {kind: "strip", panel: geometry.id, index: geometry.insertionAt?.(input.point) ?? panel.tabs.length};
    }
    const takesCenter = input.noCenter !== true && input.policy.accepts(tabs, panel, "center");
    if (!takesCenter && !input.policy.accepts(tabs, panel, "edge")) return null;
    // 指针可能在缝上（这块之外），夹回来再判。空面板整块都是中央；进不了中央的仍按外缘判。
    const point = {x: Math.min(Math.max(input.point.x, geometry.body.left), geometry.body.right - 1), y: Math.min(Math.max(input.point.y, geometry.body.top), geometry.body.bottom - 1)};
    const centered = panel.tabs.length === 0 && takesCenter;
    const edge = centered || !input.policy.accepts(tabs, panel, "edge") ? null : nearestEdge(input, geometry, tabs, point);
    if (edge !== null) return {kind: "edge", target: edge};
    return takesCenter ? {kind: "center", panel: geometry.id} : null;
}

const edgeTargetFor = (policy: LayoutPolicy, doc: LayoutDoc, tabs: ReadonlyArray<TabRef>, panel: string, edge: LayoutEdge): LayoutEdgeTarget | null => (policy.edgeTarget === undefined ? edgeTargetOf(doc, panel, edge) : policy.edgeTarget(doc, tabs, panel, edge));

const hasArea = (rect: GridDropRect): boolean => rect.right > rect.left && rect.bottom > rect.top;

/** 指针落在哪条边的窄带里：四角归最近的边；策略不给的边没有窄带，那一块算中央。形状画在 `layoutDropSectors` 里，两边要一起改。 */
function nearestEdge(input: LayoutDropInput, geometry: LayoutDropPanelGeometry, tabs: ReadonlyArray<TabRef>, point: GridDropPoint): LayoutEdgeTarget | null {
    const {body} = geometry;
    // 收成标题行的面板正文是零面积：算比例会除零。
    if (!hasArea(body)) return null;
    const ratio = input.edgeRatio ?? LAYOUT_EDGE_RATIO;
    const relativeX = (point.x - body.left) / (body.right - body.left);
    const relativeY = (point.y - body.top) / (body.bottom - body.top);
    const depths: ReadonlyArray<readonly [LayoutEdge, number]> = [["left", relativeX], ["right", 1 - relativeX], ["top", relativeY], ["bottom", 1 - relativeY]];
    const within = depths.filter(([, depth]) => depth < ratio).sort((left, right) => left[1] - right[1]);
    for (const [edge] of within) {
        const target = edgeTargetFor(input.policy, input.doc, tabs, geometry.id, edge);
        if (target !== null) return target;
    }
    return null;
}

/** 这一刻指针算哪块面板，含标签条与缝；条、标题栏与面板之外是 null。浮动窗盖在最上面，外缘不是缝。 */
export function layoutDropPanelAt(input: LayoutDropInput): LayoutDropPanelGeometry | null {
    const floated = input.floats?.find((geometry) => inGeometry(geometry, input.point));
    if (floated !== undefined) return floated;
    if (input.excluded?.some((rect) => contains(rect, input.point)) === true) return null;
    const tabs = sourceTabs(input.doc, input.source);
    const accepted = (geometry: LayoutDropPanelGeometry): boolean => {
        const panel = input.doc.panels[geometry.id];
        return panel !== undefined && (["strip", "center", "edge"] as const).some((region) => input.policy.accepts(tabs, panel, region));
    };
    const inside = input.panels.find((geometry) => inGeometry(geometry, input.point));
    // 缝不是落点：归最近的能接收的那块，按它继续判。不看接收的话，两块之间的缝有一半是死区。
    return inside ?? [...input.panels]
        .filter(accepted)
        .map((geometry) => ({geometry, distance: Math.min(distanceTo(geometry.body, input.point), geometry.strip === null ? Number.POSITIVE_INFINITY : distanceTo(geometry.strip, input.point))}))
        .filter(({distance}) => distance <= SEAM_PX)
        .sort((left, right) => left.distance - right.distance)[0]?.geometry ?? null;
}

/** 一条缝：同一分支里相邻的两个看得见的子节点之间。 */
export interface LayoutSeam {
    readonly branch: string;
    readonly orientation: GridOrientation;
    readonly before: string;
    readonly after: string;
    /** 中线沿分支主轴的坐标。 */
    readonly at: number;
    /** 在交叉轴上的范围：整个分支那么长。 */
    readonly from: number;
    readonly to: number;
}

const unionOf = (left: GridDropRect, right: GridDropRect): GridDropRect => ({left: Math.min(left.left, right.left), top: Math.min(left.top, right.top), right: Math.max(left.right, right.right), bottom: Math.max(left.bottom, right.bottom)});

const frameOf = (geometry: LayoutDropPanelGeometry): GridDropRect => geometry.frame ?? (geometry.strip === null ? geometry.body : unionOf(geometry.strip, geometry.body));

/**
 * 这一刻有哪些缝，缝的位置按几何算。没有几何的叶（隐藏的、拖到零的）不算：`H[A, 拖到零的 Z, B]` 看得见的只有 A|B 这一条缝。
 */
export function layoutSeamsOf(doc: LayoutDoc, panels: ReadonlyArray<LayoutDropPanelGeometry>): ReadonlyArray<LayoutSeam> {
    const frames = new Map(panels.map((geometry) => [geometry.id, frameOf(geometry)]));
    const seams: LayoutSeam[] = [];
    const visit = (node: GridSnapshotNode): GridDropRect | null => {
        if (node.kind === "leaf") return frames.get(node.id) ?? null;
        const shown = node.children.flatMap((child) => {
            const rect = visit(child);
            return rect === null ? [] : [{id: child.id, rect}];
        });
        const first = shown[0];
        if (first === undefined) return null;
        const whole = shown.reduce((sum, item) => unionOf(sum, item.rect), first.rect);
        const horizontal = node.orientation === "horizontal";
        for (let index = 1; index < shown.length; index += 1) {
            const before = shown[index - 1] as (typeof shown)[number];
            const after = shown[index] as (typeof shown)[number];
            seams.push({
                branch: node.id,
                orientation: node.orientation,
                before: before.id,
                after: after.id,
                at: horizontal ? (before.rect.right + after.rect.left) / 2 : (before.rect.bottom + after.rect.top) / 2,
                from: horizontal ? whole.top : whole.left,
                to: horizontal ? whole.bottom : whole.right,
            });
        }
        return whole;
    };
    visit(doc.tree.root);
    return seams;
}

const seamAccepted = (input: Pick<LayoutDropInput, "doc" | "policy">, tabs: ReadonlyArray<TabRef>, seam: LayoutSeam): boolean => {
    if (input.policy.seamAccepts?.(input.doc, tabs, seam.before, seam.after) !== true) return false;
    const anchor = firstPanelIn(input.doc, seam.before);
    return anchor !== null && input.policy.accepts(tabs, anchor, "edge");
};

/** 指针下的缝：最近的胜出，放不进去的缝不算。 */
function seamAt(input: LayoutDropInput, tabs: ReadonlyArray<TabRef>): LayoutSeam | null {
    if (input.policy.seamAccepts === undefined) return null;
    const {x, y} = input.point;
    let found: LayoutSeam | null = null;
    let nearest = Number.POSITIVE_INFINITY;
    for (const seam of layoutSeamsOf(input.doc, input.panels)) {
        const [along, across] = seam.orientation === "horizontal" ? [x, y] : [y, x];
        const distance = Math.abs(along - seam.at);
        if (across < seam.from || across >= seam.to || distance > LAYOUT_SEAM_HIT_PX || distance >= nearest || !seamAccepted(input, tabs, seam)) continue;
        found = seam;
        nearest = distance;
    }
    return found;
}

const seamTarget = (seam: LayoutSeam): LayoutEdgeTarget => ({kind: "between", branch: seam.branch, before: seam.before, after: seam.after});

/**
 * 指针在面板上吗（不管接不接收）：浮动窗，或任一面板整块（头里的提示条也算），以及它 `SEAM_PX` 内的缝。在面板上却没有落点就是被拒绝，松手取消；不在面板上才算无落点（输出 39）。
 * 不用 `layoutDropPanelAt`：它在缝里只找能接收的那块，两块都不接收的缝会被当成不在面板上。
 */
export function layoutDropOverPanel(input: LayoutDropInput): boolean {
    if (input.floats?.some((geometry) => inGeometry(geometry, input.point)) === true) return true;
    if (input.excluded?.some((rect) => contains(rect, input.point)) === true) return false;
    return input.panels.some((geometry) => distanceTo(frameOf(geometry), input.point) <= SEAM_PX);
}

/** 这一刻指针落在哪；`null` 是没有落点（工作台外、标题栏、条、被接受矩阵拒绝）。 */
export function resolveLayoutDrop(input: LayoutDropInput): LayoutDropAction | null {
    const tabs = sourceTabs(input.doc, input.source);
    if (tabs.length === 0 && input.source.kind === "tab") return null;
    // 浮动窗盖住的地方：它不接收就是没有落点，不穿透到底下的面板与条。
    const floated = input.floats?.find((geometry) => inGeometry(geometry, input.point));
    if (floated !== undefined) {
        const panel = input.doc.panels[floated.id];
        return panel === undefined ? null : resolveInPanel(input, floated, panel, tabs);
    }
    if (input.excluded?.some((rect) => contains(rect, input.point)) === true) return null;
    const seam = seamAt(input, tabs);
    if (seam !== null) return {kind: "edge", target: seamTarget(seam)};
    const hit = layoutDropPanelAt(input) ?? undefined;
    const panel = hit === undefined ? undefined : input.doc.panels[hit.id];
    return hit === undefined || panel === undefined ? null : resolveInPanel(input, hit, panel, tabs);
}

export type LayoutDropSectorId = LayoutEdge | "center";

/** 落点分区的一块（docs/specs/ui/workbench-layout.md“落点分区”）：指针落在这个多边形里，`resolveLayoutDrop` 给的就是 `action`。 */
export interface LayoutDropSector {
    readonly id: LayoutDropSectorId;
    /** 多边形的顶点，相对这块正文的比例（0 到 1）。 */
    readonly points: ReadonlyArray<readonly [number, number]>;
    readonly action: LayoutDropAction;
}

/**
 * 这块面板正文上的分区；正文零面积或什么都放不进去时为 null。形状由 `nearestEdge` 的规则推出来：一条边的窄带是“离这条边的相对距离小于比例，且不比别的可用边
 * 更远”，所以相邻的边也可用时这个角按对角线切，不可用时窄带占满这个角。比例相对正文的宽高，所以对角线在像素上是斜的。
 */
export function layoutDropSectors(input: LayoutDropInput, geometry: LayoutDropPanelGeometry): ReadonlyArray<LayoutDropSector> | null {
    const panel = input.doc.panels[geometry.id];
    if (panel === undefined || !hasArea(geometry.body)) return null;
    const tabs = sourceTabs(input.doc, input.source);
    const centerAction: LayoutDropAction = {kind: "center", panel: geometry.id};
    const takesCenter = input.noCenter !== true && input.policy.accepts(tabs, panel, "center");
    if (panel.tabs.length === 0 && takesCenter) return [{id: "center", points: [[0, 0], [1, 0], [1, 1], [0, 1]], action: centerAction}];
    const targets = new Map<LayoutEdge, LayoutEdgeTarget>();
    if (input.policy.accepts(tabs, panel, "edge")) {
        for (const edge of ["left", "right", "top", "bottom"] as const) {
            const target = edgeTargetFor(input.policy, input.doc, tabs, geometry.id, edge);
            if (target !== null) targets.set(edge, target);
        }
    }
    const near = input.edgeRatio ?? LAYOUT_EDGE_RATIO;
    const far = 1 - near;
    const [left, right, top, bottom] = [targets.has("left"), targets.has("right"), targets.has("top"), targets.has("bottom")];
    const shapes: Readonly<Record<LayoutEdge, ReadonlyArray<readonly [number, number]>>> = {
        left: [[0, 0], top ? [near, near] : [near, 0], bottom ? [near, far] : [near, 1], [0, 1]],
        right: [[1, 0], top ? [far, near] : [far, 0], bottom ? [far, far] : [far, 1], [1, 1]],
        top: [[0, 0], [1, 0], right ? [far, near] : [1, near], left ? [near, near] : [0, near]],
        bottom: [[0, 1], [1, 1], right ? [far, far] : [1, far], left ? [near, far] : [0, far]],
    };
    const sectors: LayoutDropSector[] = [...targets].map(([edge, target]) => ({id: edge, points: shapes[edge], action: {kind: "edge", target}}));
    if (takesCenter) {
        const [x0, x1, y0, y1] = [left ? near : 0, right ? far : 1, top ? near : 0, bottom ? far : 1];
        sectors.push({id: "center", points: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], action: centerAction});
    }
    return sectors.length === 0 ? null : sectors;
}

/** 文档里还没有的标签放下去的样子：只给预览（放回原处恒为假、外缘的真实矩形）。 */
function applyNewTab(doc: LayoutDoc, tab: TabRef, action: LayoutDropAction, policy: LayoutPolicy): LayoutResult {
    const panel: PanelRecord = {role: tab.kind === "view" ? "tool" : "editor", tabs: [tab], active: tabKey(tab)};
    switch (action.kind) {
        case "strip":
            return insertTab(doc, {panel: action.panel, tab, index: action.index});
        case "center":
            return insertTab(doc, {panel: action.panel, tab});
        case "edge":
            return openPanelAtEdge(doc, {id: policy.newId("panel"), panel, target: action.target}, policy);
        case "float":
            return openFloatPanel(doc, {id: policy.newId("panel"), panel, rect: action.rect});
        case "reveal":
            return {ok: false, code: "rejected", detail: "新标签不显示隐藏的面板"};
    }
}

/** 提交落点。结果和现状一样时返回原文档对象（放回原处），宿主据此不提交。 */
export function applyLayoutDrop(doc: LayoutDoc, source: LayoutDropSource, action: LayoutDropAction, policy: LayoutPolicy): LayoutResult {
    if (source.kind === "new") return applyNewTab(doc, source.tab, action, policy);
    switch (action.kind) {
        case "strip":
            if (source.kind === "tab") return moveTabToStrip(doc, {tab: source.tab, panel: action.panel, index: action.index, ...(action.activate === undefined ? {} : {activate: action.activate})}, policy);
            return movePanelToStrip(doc, {panel: source.panel, target: action.panel, index: action.index}, policy);
        case "center": {
            const panel = doc.panels[action.panel];
            if (panel === undefined) return {ok: false, code: "not-found", detail: `面板 ${action.panel}`};
            const inPlace = source.kind === "tab" && findTab(doc, source.tab)?.panel === action.panel;
            if (inPlace || (source.kind === "panel" && source.panel === action.panel)) return {ok: true, doc};
            if (source.kind === "tab") return moveTabToStrip(doc, {tab: source.tab, panel: action.panel, index: panel.tabs.length}, policy);
            return movePanelToStrip(doc, {panel: source.panel, target: action.panel}, policy);
        }
        case "edge":
            if (source.kind === "tab") return moveTabToEdge(doc, {tab: source.tab, target: action.target}, policy);
            return movePanelToEdge(doc, {panel: source.panel, target: action.target}, policy);
        case "reveal":
            return showPanelAndInsert(doc, {panel: action.panel, source, ...(action.index === undefined ? {} : {index: action.index})}, policy);
        case "float":
            return source.kind === "tab" ? floatTab(doc, {tab: source.tab, rect: action.rect}, policy) : setFloatRect(doc, {panel: source.panel, rect: action.rect});
    }
}

/**
 * 外缘落点放下去的真实矩形（相对树的根）：指示画真实结果，用提交时的同一个函数算。没有变化时是 `null`。标签条与中央的预览由宿主画（插入线、整块）。
 * `newId` 用占位 id 也行：只取被拖内容落到的那块的矩形。
 */
export function previewEdgeDrop(doc: LayoutDoc, source: LayoutDropSource, action: Extract<LayoutDropAction, {kind: "edge"}>, policy: LayoutPolicy, projection: LayoutProjectionOptions, extent: GridExtent, dpr: number): GridDropRect | null {
    const result = applyLayoutDrop(doc, source, action, policy);
    if (!result.ok || result.doc === doc) return null;
    const key = source.kind === "panel" ? null : (source.kind === "new" ? tabKey(source.tab) : source.tab);
    const placed = source.kind === "panel" ? source.panel : (findTab(result.doc, key as string)?.panel ?? null);
    if (placed === null) return null;
    const {input, sashSize} = projectLayoutDoc(result.doc, projection);
    const grid = createGrid<string>(input, {sashSize});
    const root = grid.root();
    if (root === null) return null;
    const placement = placeGrid(root, grid.layout(extent), extent, dpr);
    const item = placement.items.find((candidate) => candidate.kind === "leaf" && candidate.node.id === placed);
    if (item === undefined) return null;
    return {left: item.rect.x, top: item.rect.y, right: item.rect.x + item.rect.width, bottom: item.rect.y + item.rect.height};
}

/**
 * 这几块面板在这份文档里的矩形（相对树的根），显隐与收起都按文档：收成标题行的就是那一行。实时布局的并入盖层按它画（输出 38）。放不进呈现树的不在结果里；浮动窗不在树里，由宿主取它的矩形。
 */
export function previewPanelRects(doc: LayoutDoc, panels: ReadonlyArray<string>, projection: LayoutProjectionOptions, extent: GridExtent, dpr: number): Readonly<Record<string, GridDropRect>> {
    const {input, sashSize} = projectLayoutDoc(doc, projection);
    const grid = createGrid<string>(input, {sashSize});
    const root = grid.root();
    if (root === null) return {};
    const wanted = new Set(panels);
    return Object.fromEntries(placeGrid(root, grid.layout(extent), extent, dpr).items.flatMap((item) => (item.kind === "leaf" && wanted.has(item.node.id)
        ? [[item.node.id, {left: item.rect.x, top: item.rect.y, right: item.rect.x + item.rect.width, bottom: item.rect.y + item.rect.height}] as const]
        : [])));
}

export interface LayoutDropCandidate {
    /** 落点所属的区域（键盘 Tab 在区域之间循环）：面板 id。 */
    readonly region: string;
    readonly action: LayoutDropAction;
}

/** 放下去还在原处吗（便宜的判定，键盘列落点时每个候选都问）。规范形相等这类不容易看出来的情况留给提交时判。 */
function isInPlace(doc: LayoutDoc, source: LayoutSource, action: LayoutDropAction): boolean {
    const found = source.kind === "tab" ? findTab(doc, source.tab) : null;
    const whole = source.kind === "panel" ? source.panel : (found !== null && doc.panels[found.panel]?.tabs.length === 1 ? found.panel : null);
    switch (action.kind) {
        case "strip":
            if (source.kind === "panel") return source.panel === action.panel;
            return found !== null && found.panel === action.panel && (action.index === found.index || action.index === found.index + 1);
        case "center":
            return found !== null ? found.panel === action.panel : source.kind === "panel" && source.panel === action.panel;
        case "edge":
            return whole !== null && edgeTargetTouches(doc, action.target, whole);
        case "reveal":
            return false;
        case "float":
            return false;
    }
}

/**
 * 键盘拖动能去的落点：和指针同一套规则，按树序列出；接受矩阵拒绝的和放回原处的不列。原位不在这里：拿起时停在原位由会话管，直接 Enter 不移动。
 * `stripIndexes` 是这块标签条里看得见的插入位，写成文档里的下标：滚出视口、收进“更多”的标签之间没有位置。
 */
export function enumerateDropCandidates(input: {
    readonly doc: LayoutDoc;
    readonly source: LayoutSource;
    readonly policy: LayoutPolicy;
    readonly stripIndexes: (panel: string) => ReadonlyArray<number>;
    /** 这一刻的缝（`layoutSeamsOf`）；不给就没有缝落点。 */
    readonly seams?: ReadonlyArray<LayoutSeam>;
}): ReadonlyArray<LayoutDropCandidate> {
    const {doc, source, policy} = input;
    const tabs = sourceTabs(doc, source);
    const candidates: LayoutDropCandidate[] = [];
    const seen = new Set<string>();
    const add = (region: string, action: LayoutDropAction): void => {
        const key = JSON.stringify(action);
        if (seen.has(key) || isInPlace(doc, source, action)) return;
        seen.add(key);
        candidates.push({region, action});
    };
    for (const leaf of treeLeaves(doc.tree.root)) {
        const panel = doc.panels[leaf.id];
        if (panel === undefined || !isNodeShown(doc, leaf)) continue;
        if (policy.accepts(tabs, panel, "strip")) for (const index of input.stripIndexes(leaf.id)) add(leaf.id, {kind: "strip", panel: leaf.id, index});
        if (policy.accepts(tabs, panel, "center")) add(leaf.id, {kind: "center", panel: leaf.id});
        // 接受中央的空面板整块都是中央（`resolveInPanel`）：边上没有另外的落点。
        if (policy.accepts(tabs, panel, "edge") && !(panel.tabs.length === 0 && policy.accepts(tabs, panel, "center"))) {
            for (const edge of ["left", "right", "top", "bottom"] as const) {
                const target = edgeTargetFor(policy, doc, tabs, leaf.id, edge);
                if (target !== null) add(leaf.id, {kind: "edge", target});
            }
        }
    }
    // 缝归树序靠前的那块：键盘在区域之间循环，缝不单独成一个区域。
    for (const seam of input.seams ?? []) {
        if (!seamAccepted({doc, policy}, tabs, seam)) continue;
        const hit = findTreeNode(doc.tree.root, seam.before);
        const leaf = hit === null ? undefined : treeLeaves(hit.node).findLast((candidate) => doc.panels[candidate.id] !== undefined && isNodeShown(doc, candidate));
        if (leaf !== undefined) add(leaf.id, {kind: "edge", target: seamTarget(seam)});
    }
    // 浮动窗排在树后面（Tab 也是）：只有标签条和中央。
    for (const {panel: id} of doc.floats) {
        const panel = doc.panels[id];
        if (panel === undefined) continue;
        if (policy.accepts(tabs, panel, "strip")) for (const index of input.stripIndexes(id)) add(id, {kind: "strip", panel: id, index});
        if (policy.accepts(tabs, panel, "center")) add(id, {kind: "center", panel: id});
    }
    return candidates;
}
