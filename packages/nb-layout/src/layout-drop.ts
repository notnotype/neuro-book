/**
 * 工作台的落点规则（docs/specs/ui/workbench-layout.md 输出 25 到 29）：按这一刻的矩形判定指针落在哪，判定与提交共用同一份动作。纯函数；遮挡（被菜单挡住、
 * `data-no-drop`）由宿主读 DOM 之后不把那块传进来。
 *
 * 动作的身份就是它的内容：同一个落点无论从这条边、缝还是对面那块的边进来，得到的是同一个 `between`，会话按它判断“和上次显示的是不是同一个”。
 */

import type {GridDropPoint, GridDropRect} from "./grid-drop";
import {placeGrid} from "./grid-rects";
import {createGrid} from "./grid";
import {edgeTargetOf, findTab, findTreeNode, isNodeShown, movePanelToEdge, movePanelToStrip, moveTabToEdge, moveTabToStrip, setPanelHidden, showPanelAndInsert, treeLeaves} from "./layout-doc";
import type {LayoutDoc, LayoutEdge, LayoutEdgeTarget, LayoutPolicy, LayoutResult, LayoutSource, PanelRecord, TabRef} from "./layout-doc";
import {projectLayoutDoc} from "./layout-project";
import type {LayoutProjectionOptions} from "./layout-project";
import type {GridExtent} from "./grid-types";

/** 外缘窄带占这一块的比例。 */
export const LAYOUT_EDGE_RATIO = 0.28;
/** 指针离一块这么近时算这一块：卡片之间的缝与分隔线都不超过这么宽。条与标题栏经 `excluded` 排除，不靠这个数。 */
const SEAM_PX = 4;

export type LayoutDropAction =
    /** `activate: false` 只换位置（活动栏里换序）。缺省成为活动标签。 */
    | {readonly kind: "strip"; readonly panel: string; readonly index: number; readonly activate?: boolean}
    | {readonly kind: "center"; readonly panel: string}
    | {readonly kind: "edge"; readonly target: LayoutEdgeTarget}
    /** `index` 缺省插到最后。 */
    | {readonly kind: "reveal"; readonly panel: string; readonly index?: number};

export interface LayoutDropPanelGeometry {
    readonly id: string;
    readonly body: GridDropRect;
    /** 标签条的矩形；编辑组与工具面板都有。 */
    readonly strip: GridDropRect | null;
    /** 指针在标签条里时的插入位，由标签条自己量（两种标签条都能给）。 */
    readonly insertionAt?: (point: GridDropPoint) => number;
}

export interface LayoutDropInput {
    readonly doc: LayoutDoc;
    readonly source: LayoutSource;
    readonly point: GridDropPoint;
    readonly panels: ReadonlyArray<LayoutDropPanelGeometry>;
    /** 不是落点的区域：条、标题栏（规则 1）。先判。 */
    readonly excluded?: ReadonlyArray<GridDropRect>;
    /** 预备区：此刻没显示的具名面板浮出的矩形。指针在真实落点上时不算。 */
    readonly zones?: ReadonlyArray<{readonly panel: string; readonly rect: GridDropRect}>;
    readonly policy: LayoutPolicy;
    readonly edgeRatio?: number;
}

const contains = (rect: GridDropRect, point: GridDropPoint): boolean => point.x >= rect.left && point.x < rect.right && point.y >= rect.top && point.y < rect.bottom;

function distanceTo(rect: GridDropRect, point: GridDropPoint): number {
    const dx = Math.max(rect.left - point.x, 0, point.x - rect.right);
    const dy = Math.max(rect.top - point.y, 0, point.y - rect.bottom);
    return Math.hypot(dx, dy);
}

/** 被拖的全部标签。 */
export function sourceTabs(doc: LayoutDoc, source: LayoutSource): ReadonlyArray<TabRef> {
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
    if (!input.policy.accepts(tabs, panel, "center") && !input.policy.accepts(tabs, panel, "edge")) return null;
    // 指针可能在缝上（这块之外），夹回来再判。空面板整块都是中央；进不了中央的仍按外缘判。
    const point = {x: Math.min(Math.max(input.point.x, geometry.body.left), geometry.body.right - 1), y: Math.min(Math.max(input.point.y, geometry.body.top), geometry.body.bottom - 1)};
    const centered = panel.tabs.length === 0 && input.policy.accepts(tabs, panel, "center");
    const edge = centered || !input.policy.accepts(tabs, panel, "edge") ? null : nearestEdge(input, geometry, tabs, point);
    if (edge !== null) return {kind: "edge", target: edge};
    return input.policy.accepts(tabs, panel, "center") ? {kind: "center", panel: geometry.id} : null;
}

const edgeTargetFor = (policy: LayoutPolicy, doc: LayoutDoc, tabs: ReadonlyArray<TabRef>, panel: string, edge: LayoutEdge): LayoutEdgeTarget | null => (policy.edgeTarget === undefined ? edgeTargetOf(doc, panel, edge) : policy.edgeTarget(doc, tabs, panel, edge));

/** 指针落在哪条边的窄带里：四角归最近的边；策略不给的边没有窄带，那一块算中央。 */
function nearestEdge(input: LayoutDropInput, geometry: LayoutDropPanelGeometry, tabs: ReadonlyArray<TabRef>, point: GridDropPoint): LayoutEdgeTarget | null {
    const {body} = geometry;
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

/** 这一刻指针落在哪；`null` 是没有落点（工作台外、标题栏、条、被接受矩阵拒绝）。 */
export function resolveLayoutDrop(input: LayoutDropInput): LayoutDropAction | null {
    const tabs = sourceTabs(input.doc, input.source);
    if (tabs.length === 0 && input.source.kind === "tab") return null;
    if (input.excluded?.some((rect) => contains(rect, input.point)) === true) return null;
    const accepted = (geometry: LayoutDropPanelGeometry): boolean => {
        const panel = input.doc.panels[geometry.id];
        return panel !== undefined && (["strip", "center", "edge"] as const).some((region) => input.policy.accepts(tabs, panel, region));
    };
    const inside = input.panels.find((geometry) => contains(geometry.body, input.point) || (geometry.strip !== null && contains(geometry.strip, input.point)));
    // 缝不是落点：归最近的能接收的那块，按它继续判。不看接收的话，两块之间的缝有一半是死区。
    const hit = inside ?? [...input.panels]
        .filter(accepted)
        .map((geometry) => ({geometry, distance: Math.min(distanceTo(geometry.body, input.point), geometry.strip === null ? Number.POSITIVE_INFINITY : distanceTo(geometry.strip, input.point))}))
        .filter(({distance}) => distance <= SEAM_PX)
        .sort((left, right) => left.distance - right.distance)[0]?.geometry;
    const panel = hit === undefined ? undefined : input.doc.panels[hit.id];
    const action = hit === undefined || panel === undefined ? null : resolveInPanel(input, hit, panel, tabs);
    if (action !== null) return action;
    // 预备区只在没有真实落点时算：它叠在当前布局上，可能盖住别的面板。
    const zone = input.zones?.find((candidate) => contains(candidate.rect, input.point));
    const target = zone === undefined ? undefined : input.doc.panels[zone.panel];
    return zone !== undefined && target !== undefined && input.policy.accepts(tabs, target, "center") ? {kind: "reveal", panel: zone.panel} : null;
}

/** 提交落点。结果和现状一样时返回原文档对象（放回原处），宿主据此不提交。 */
export function applyLayoutDrop(doc: LayoutDoc, source: LayoutSource, action: LayoutDropAction, policy: LayoutPolicy): LayoutResult {
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
    }
}

/**
 * 外缘落点放下去的真实矩形（相对树的根）：指示画真实结果，用提交时的同一个函数算。没有变化时是 `null`。标签条与中央的预览由宿主画（插入线、整块）。
 * `newId` 用占位 id 也行：只取被拖内容落到的那块的矩形。
 */
export function previewEdgeDrop(doc: LayoutDoc, source: LayoutSource, action: Extract<LayoutDropAction, {kind: "edge"}>, policy: LayoutPolicy, projection: LayoutProjectionOptions, extent: GridExtent, dpr: number): GridDropRect | null {
    const result = applyLayoutDrop(doc, source, action, policy);
    if (!result.ok || result.doc === doc) return null;
    const placed = source.kind === "panel" ? source.panel : (() => {
        const found = findTab(result.doc, source.tab);
        return found === null ? null : found.panel;
    })();
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
 * 这几块此刻没显示的面板显示出来会在的矩形（相对树的根）：预备区按它浮出（输出 29）。几块一起显示后再算，所以彼此不重叠：一块一块单独算的话，面板会占满侧栏和右栏的位置。
 * 放不进呈现树的不在结果里。
 */
export function previewRevealRects(doc: LayoutDoc, panels: ReadonlyArray<string>, projection: LayoutProjectionOptions, extent: GridExtent, dpr: number): Readonly<Record<string, GridDropRect>> {
    let shown = doc;
    for (const panel of panels) {
        const result = setPanelHidden(shown, panel, false);
        if (result.ok) shown = result.doc;
    }
    const {input, sashSize} = projectLayoutDoc(shown, projection);
    const grid = createGrid<string>(input, {sashSize});
    const root = grid.root();
    if (root === null) return {};
    const wanted = new Set(panels);
    return Object.fromEntries(placeGrid(root, grid.layout(extent), extent, dpr).items.flatMap((item) => (item.kind === "leaf" && wanted.has(item.node.id)
        ? [[item.node.id, {left: item.rect.x, top: item.rect.y, right: item.rect.x + item.rect.width, bottom: item.rect.y + item.rect.height}] as const]
        : [])));
}

export interface LayoutDropCandidate {
    /** 落点所属的区域（键盘 Tab 在区域之间循环）：面板 id，预备区是 `reveal:<面板 id>`。 */
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
            return whole !== null && (action.target.kind === "split" ? action.target.panel === whole : action.target.before === whole || action.target.after === whole);
        case "reveal":
            return false;
    }
}

/**
 * 键盘拖动能去的落点：和指针同一套规则，按树序列出；接受矩阵拒绝的和放回原处的不列。原位不在这里：拿起时停在原位由会话管，直接 Enter 不移动。
 * `stripCount` 是这块标签条有几个插入位（看得见的标签数加一）。
 */
export function enumerateDropCandidates(input: {
    readonly doc: LayoutDoc;
    readonly source: LayoutSource;
    readonly policy: LayoutPolicy;
    readonly stripCount: (panel: string) => number;
    readonly reveal?: ReadonlyArray<string>;
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
        if (policy.accepts(tabs, panel, "strip")) for (let index = 0; index < input.stripCount(leaf.id); index += 1) add(leaf.id, {kind: "strip", panel: leaf.id, index});
        if (policy.accepts(tabs, panel, "center")) add(leaf.id, {kind: "center", panel: leaf.id});
        if (policy.accepts(tabs, panel, "edge")) {
            for (const edge of ["left", "right", "top", "bottom"] as const) {
                const target = edgeTargetFor(policy, doc, tabs, leaf.id, edge);
                if (target !== null) add(leaf.id, {kind: "edge", target});
            }
        }
    }
    for (const panel of input.reveal ?? []) {
        const record = doc.panels[panel];
        if (record !== undefined && findTreeNode(doc.tree.root, panel) !== null && policy.accepts(tabs, record, "center")) add(`reveal:${panel}`, {kind: "reveal", panel});
    }
    return candidates;
}
