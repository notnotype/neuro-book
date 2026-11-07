/**
 * 一棵树的拖放（docs/specs/ui/workbench-layout.md 输出 24 到 32）：手势是 nb-layout 的拖动会话，落点规则是 `resolveLayoutDrop`，这里读 DOM 给它矩形，把结果换成反馈要画的东西。
 *
 * 拖动源：标签（`data-panel-tab`，工具视图与编辑器标签都是，侧栏这一列的标题也是）、活动栏条目（`data-tool-entry`）。整块面板不能拖（输出 24）。`data-no-drag` 里的按钮既不起拖也不接收，
 * `data-no-drag-start` 只是不起拖（标签上的关闭按钮：拖动经过时它还在标签条里），被菜单、对话框挡住的不接收。编辑组的标签条写 `data-panel-strip`，它的多行、固定分区由编辑器量（`editorTabs`）。
 *
 * 活动栏上段（`data-tool-band`）是侧栏的标签条：工具视图放上去进 `sidebar`，位置按条目量（输出 22）。这段不走库的落点规则：条不是面板。
 *
 * 判定是纯读：预览用提交时的同一个函数（`applyLayoutDrop`）算，放回原处的落点只显示、不提交。结构键变了整场取消（输出 32），放下时提交再验一次接受矩阵（领域操作自己验）。
 */

import {applyLayoutDrop, enumerateDropCandidates, findTab, layoutDropPanelAt, layoutDropSectors, previewEdgeDrop, previewRevealRects, removeTab, resolveLayoutDrop, sourceTabs, tabKey, treeLeaves} from "@notnotype/nb-layout";
import type {GridDropPoint, GridDropRect, GridExtent, GridOrientation, LayoutDoc, LayoutDropAction, LayoutDropCandidate, LayoutDropInput, LayoutDropPanelGeometry, LayoutDropSector, LayoutDropSectorId, LayoutPolicy, LayoutProjectionOptions, LayoutSource, TabRef} from "@notnotype/nb-layout";
import {createDragSession, layoutMotionMs, measureTabStrip, resolveTabStripInsertion, tabStripInsertionIn, tabStripStops} from "@notnotype/nb-layout/vue";
import type {DragSession, TabStripSnapshot} from "@notnotype/nb-layout/vue";

import {createLiveDrag} from "./live-drag";
import type {LiveDrag} from "./live-drag";

import {editorTabIdOf} from "../shared/editor-panels";
import type {EditorTabDrag} from "./contracts";
import {layoutStructureKey, viewIdOf, viewKey} from "./state/layout-present";
import type {ViewCatalog} from "./views/registry";

/** 被拖的东西：一个标签。库还能拖整块面板（浮动窗要用），工作台不用（输出 24）。 */
export type LayoutTabSource = Extract<LayoutSource, {readonly kind: "tab"}>;

/** 拖动中要画的东西，矩形都是视口坐标。 */
export interface LayoutDropPreview {
    /** 真实结果的矩形；标签条的插入没有它。 */
    readonly areaRect: GridDropRect | null;
    /** 标签条的插入线。 */
    readonly indicator: GridDropRect | null;
    readonly orientation: GridOrientation;
}

/** 这一刻要画的落点分区（docs/specs/ui/workbench-layout.md“落点分区”）。 */
export interface LayoutDragSectors {
    /** 这块面板正文的矩形（视口坐标）。 */
    readonly rect: GridDropRect;
    readonly items: ReadonlyArray<LayoutDropSector>;
    /** 这次落点是哪块；落点不是这块面板的分区时为 null。 */
    readonly active: LayoutDropSectorId | null;
}

export interface LayoutDragDrop {
    readonly action: LayoutDropAction;
    /** 编辑组标签条的分区（`EditorTabInsertion.part`）。 */
    readonly part?: string;
    /** 放下去和现在一样（输出 28）：只显示“原位”，不提交。 */
    readonly inPlace: boolean;
    readonly preview: LayoutDropPreview;
    /** 没有分区（标签条、预备区、活动栏上，或设置关了）时不写。 */
    readonly sectors?: LayoutDragSectors;
    /** 实时布局下不摆预览（活动栏：条目不跟预览，判定才稳）。 */
    readonly noPreview?: boolean;
}

export interface LayoutRevealZone {
    readonly panel: string;
    readonly rect: GridDropRect;
}

export interface LayoutDragOptions {
    readonly root: HTMLElement;
    doc(): LayoutDoc;
    catalog(): ViewCatalog;
    policy(): LayoutPolicy;
    /** 投影选项，含此刻放不下被收走的面板：预览要和真实结果同一个呈现树。 */
    projection(): LayoutProjectionOptions;
    extent(): GridExtent | null;
    maximized(): string | null;
    /** 布局可写时为真；否则不起拖。 */
    enabled(): boolean;
    /** 编辑器标签的拖动；编辑器还没交付时是 null。 */
    editorTabs(): EditorTabDrag | null;
    /** 这块面板的头只写标题，没有插入位（输出 20）。 */
    titleOnly(panel: string): boolean;
    /** 要不要算落点分区（设置 `nbook.workbench/dropSectors`）。 */
    sectors(): boolean;
    /** 手感（设置 `nbook.workbench/dragFeel`）；键盘、减少动效、最大化时一律落点指示。 */
    feel(): "live" | "indicator";
    /** 把进行中的过渡直接送到终点：拿起后要量矩形。 */
    settleMotion(): void;
    /** 摆预览；null 回到已提交的布局。 */
    showPreview(doc: LayoutDoc | null): void;
    commit(source: LayoutTabSource, action: LayoutDropAction, part: string | undefined, keyboard: boolean): void;
}

export interface LayoutDrag {
    readonly session: DragSession<LayoutTabSource, LayoutDragDrop>;
    /** 这一场浮出的预备区。 */
    zones(): ReadonlyArray<LayoutRevealZone>;
    readonly live: LiveDrag;
    dispose(): void;
}

/** 键盘能去的区域：一块面板或一块预备区，里面的位置是几个落点。 */
interface KeyboardRegion {
    readonly id: string;
    readonly candidates: ReadonlyArray<LayoutDropCandidate>;
}

const rectOf = (element: Element | null | undefined): GridDropRect | null => {
    if (element === null || element === undefined) return null;
    const {left, top, right, bottom} = element.getBoundingClientRect();
    return right > left && bottom > top ? {left, top, right, bottom} : null;
};
const offset = (rect: GridDropRect, by: DOMRect): GridDropRect => ({left: rect.left + by.left, top: rect.top + by.top, right: rect.right + by.left, bottom: rect.bottom + by.top});
const centerOf = (rect: GridDropRect): GridDropPoint => ({x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2});
const escape = (value: string): string => CSS.escape(value);
const contains = (rect: GridDropRect, point: GridDropPoint): boolean => point.x >= rect.left && point.x < rect.right && point.y >= rect.top && point.y < rect.bottom;

/** 活动栏这个键盘区域的 id；面板 id 是随机串或名字，撞不上。 */
const BAR_REGION = "activitybar";
const SIDEBAR = "sidebar";
/** 按整数比：亚像素的抖动不算容器变了。 */
const extentKey = (extent: GridExtent | null): string => (extent === null ? "" : `${String(Math.round(extent.width))}x${String(Math.round(extent.height))}`);

export function createLayoutDrag(options: LayoutDragOptions): LayoutDrag {
    const {root} = options;
    const surface = (): HTMLElement | null => root.querySelector("[data-workbench-surface]");
    let frozenZones: ReadonlyArray<LayoutRevealZone> = [];
    /** 同一个落点的预览只算一次：判定每次指针移动都跑。键里带着容器尺寸：一场里窗口变了，矩形要重算（输出 32）。 */
    const previews = new Map<string, LayoutDragDrop>();
    /** 预览是按这份文档算的：一场拖动中文档被命令改了（快捷键移动视图），缓存作废。 */
    let previewsOf: LayoutDoc | null = null;
    /** 实时布局判定用的矩形：拿起后第一次判定时量。之后邻居在让位，读 DOM 的话预览会把自己换掉。 */
    let frozen: {readonly panels: LayoutDropPanelGeometry[]; readonly strips: ReadonlyMap<string, TabStripSnapshot>} | null = null;

    const dpr = (): number => root.ownerDocument.defaultView?.devicePixelRatio ?? 1;
    const view = root.ownerDocument.defaultView;
    const live = createLiveDrag({
        requestFrame: (run) => view?.requestAnimationFrame(run) ?? 0,
        cancelFrame: (frame) => view?.cancelAnimationFrame(frame),
        candidateDoc: (source, drop) => {
            if (drop.inPlace || drop.noPreview === true) return null;
            const doc = options.doc();
            const editorTab = editorTabIdOf(source.tab);
            // 放下走编辑器的动作，结果可能和布局层算的不同（并到同一标签、被拒绝）：摆不出提交后的样子就不摆。
            if (editorTab !== null && options.editorTabs()?.previewable(editorTab, drop.action) === false) return null;
            const result = applyLayoutDrop(doc, source, drop.action, options.policy());
            return result.ok ? result.doc : null;
        },
        sourceRemovedDoc: (source) => {
            const result = removeTab(options.doc(), source.tab);
            return result.ok ? result.doc : null;
        },
        homeOf: (source) => findTab(options.doc(), source.tab)?.panel ?? null,
        show: (doc) => options.showPreview(doc),
    });
    const stripOf = (panel: string): Element | null => root.querySelector(`[data-panel-strip="${escape(panel)}"] [data-tab-strip]`);

    function panelGeometry(doc: LayoutDoc): LayoutDropPanelGeometry[] {
        const maximized = options.maximized();
        return treeLeaves(doc.tree.root).flatMap((leaf): LayoutDropPanelGeometry[] => {
            if (doc.panels[leaf.id] === undefined || (maximized !== null && maximized !== leaf.id)) return [];
            // 拖到零的面板，卡片还停在最后的非零尺寸（内容不重排），量的是外框。
            if (rectOf(root.querySelector(`[data-leaf="${escape(leaf.id)}"]`)) === null) return [];
            const card = rectOf(root.querySelector(`[data-shell-card="${escape(leaf.id)}"]`));
            if (card === null) return [];
            // 工具面板整个头都算标签条（动作区经 `data-no-drag` 不接收）；编辑组的头里还有提示条，只有标签条那一行算，头以下是正文。
            const editor = doc.panels[leaf.id]?.role === "editor";
            const strip = rectOf(root.querySelector(editor ? `[data-panel-strip="${escape(leaf.id)}"]` : `[data-panel-head="${escape(leaf.id)}"]`));
            return [{id: leaf.id, body: strip === null ? card : {...card, top: strip.bottom}, strip}];
        });
    }

    /** 条与标题栏不是落点（规则 1）。 */
    function excludedRects(): GridDropRect[] {
        const rects = [root.querySelector("[data-shell-card='activitybar']"), root.querySelector("[data-leaf='statusbar']"), root.querySelector("[data-shell-titlebar]")];
        return rects.flatMap((element) => rectOf(element) ?? []);
    }

    /** 此刻没显示的具名面板显示出来会在的矩形（输出 29）。接受矩阵不让进的不浮：编辑器标签进不了工具面板。 */
    function revealZones(source: LayoutTabSource): ReadonlyArray<LayoutRevealZone> {
        const doc = options.doc();
        const tabs = sourceTabs(doc, source);
        const extent = options.extent();
        const origin = surface()?.getBoundingClientRect();
        if (extent === null || origin === undefined || options.maximized() !== null) return [];
        const panels = treeLeaves(doc.tree.root).map((leaf) => leaf.id).filter((id) => {
            const panel = doc.panels[id];
            // 隐藏的不在树里没有外框；拖到零的外框宽 0。收成标题行的还看得见，不算。
            return panel?.name !== undefined && rectOf(root.querySelector(`[data-leaf="${escape(id)}"]`)) === null && options.policy().accepts(tabs, panel, "center");
        });
        const rects = previewRevealRects(doc, panels, options.projection(), extent, dpr());
        return panels.flatMap((panel): LayoutRevealZone[] => {
            const rect = rects[panel];
            return rect === undefined ? [] : [{panel, rect: offset(rect, origin)}];
        });
    }

    const toolBand = (): Element | null => root.querySelector("[data-tool-band]");
    /** 活动栏上 `sidebar` 的条目，从上到下：这一列别的面板的条目不是插入位，收进“更多”的不在 DOM 里。 */
    function sidebarEntries(doc: LayoutDoc): ReadonlyArray<HTMLElement> {
        const tabs = new Set(doc.panels[SIDEBAR]?.tabs.map(tabKey));
        return [...(toolBand()?.querySelectorAll<HTMLElement>("[data-tool-entry]") ?? [])].filter((entry) => tabs.has(viewKey(entry.dataset.toolEntry ?? "")));
    }

    /** 放到活动栏上段（输出 22）。不进预览缓存：缓存只认动作，这里每次按条目量。 */
    function barDrop(source: LayoutTabSource, point: GridDropPoint, band: GridDropRect): LayoutDragDrop | null {
        const doc = options.doc();
        const sidebar = doc.panels[SIDEBAR];
        if (sidebar === undefined || viewIdOf(source.tab) === null || options.maximized() !== null) return null;
        const entries = sidebarEntries(doc);
        const next = entries.find((entry) => {
            const {top, bottom} = entry.getBoundingClientRect();
            return point.y < (top + bottom) / 2;
        });
        const tabs = sidebar.tabs.map(tabKey);
        const index = next === undefined ? tabs.length : tabs.indexOf(viewKey(next.dataset.toolEntry ?? ""));
        const inside = findTab(doc, source.tab)?.panel === SIDEBAR;
        const shown = sidebar.hidden !== true && sidebar.collapsed !== true;
        // 在这一块里只换序，不改活动标签与显隐；从别处放进来要看得见它。
        const action: LayoutDropAction = inside ? {kind: "strip", panel: SIDEBAR, index, activate: false} : (shown ? {kind: "strip", panel: SIDEBAR, index} : {kind: "reveal", panel: SIDEBAR, index});
        const result = applyLayoutDrop(doc, source, action, options.policy());
        if (!result.ok) return null;
        const anchor = (next ?? entries.at(-1))?.getBoundingClientRect();
        const y = anchor === undefined ? band.top + 4 : (next === undefined ? anchor.bottom + 2 : anchor.top - 2);
        return {action, inPlace: result.doc === doc, noPreview: true, preview: {areaRect: null, indicator: {left: band.left + 6, right: band.right - 6, top: y - 1, bottom: y + 1}, orientation: "vertical"}};
    }

    /** 键盘在活动栏上的停靠点：每个 `sidebar` 条目的上方，和最后一个的下方。 */
    function barStops(band: GridDropRect): ReadonlyArray<GridDropPoint> {
        const x = (band.left + band.right) / 2;
        const entries = sidebarEntries(options.doc()).map((entry) => entry.getBoundingClientRect());
        const last = entries.at(-1);
        return [...entries.map((box) => ({x, y: box.top + 1})), {x, y: Math.min(band.bottom - 1, (last?.bottom ?? band.top) + 1)}];
    }

    function previewOf(doc: LayoutDoc, source: LayoutTabSource, action: Exclude<LayoutDropAction, {readonly kind: "strip"}>, inPlace: boolean, panels: ReadonlyArray<LayoutDropPanelGeometry>): LayoutDropPreview {
        const none: LayoutDropPreview = {areaRect: null, indicator: null, orientation: "horizontal"};
        if (inPlace) {
            const home = findTab(doc, source.tab)?.panel;
            return {...none, areaRect: panels.find((geometry) => geometry.id === home)?.body ?? null};
        }
        switch (action.kind) {
            case "center":
                return {...none, areaRect: panels.find((geometry) => geometry.id === action.panel)?.body ?? null};
            case "reveal":
                return {...none, areaRect: frozenZones.find((zone) => zone.panel === action.panel)?.rect ?? null};
            case "edge": {
                const extent = options.extent();
                const origin = surface()?.getBoundingClientRect();
                if (extent === null || origin === undefined) return none;
                const rect = previewEdgeDrop(doc, source, action, options.policy(), options.projection(), extent, dpr());
                return {...none, areaRect: rect === null ? null : offset(rect, origin)};
            }
        }
    }

    /**
     * 这个位置在文档里是第几个：量出来的是邻居，收进“更多”的标签不在 DOM 里，下标要按文档算。分区末尾插在它最后一个看得见的标签之后。
     */
    function stripIndex(doc: LayoutDoc, panel: string, measured: {readonly before: string | null; readonly after: string | null}): number {
        const tabs = doc.panels[panel]?.tabs.map(tabKey) ?? [];
        if (measured.before !== null) return tabs.indexOf(measured.before);
        return measured.after !== null ? tabs.indexOf(measured.after) + 1 : tabs.length;
    }

    /** 落在标签条上（工具面板与编辑组同一条路径）：不进预览缓存，每次按标签量。原位按文档判。 */
    function stripDrop(doc: LayoutDoc, source: LayoutTabSource, panel: string, point: GridDropPoint): LayoutDragDrop | null {
        const strip = stripOf(panel);
        // 实时布局用拿起时量的那份（摘掉了来源）：预览里来源已经挪了，标签也在滑。
        const snapshot = frozen?.strips.get(panel) ?? null;
        const measured = snapshot !== null ? tabStripInsertionIn(snapshot, point) : strip === null ? null : resolveTabStripInsertion(strip, point);
        if (measured === null) return null;
        const index = stripIndex(doc, panel, measured);
        const action: LayoutDropAction = {kind: "strip", panel, index};
        const preview: LayoutDropPreview = {areaRect: null, indicator: measured.indicator, orientation: "horizontal"};
        const part = measured.partition ?? undefined;
        if (doc.panels[panel]?.role === "editor") {
            // 放下走编辑器的动作（要先结算输入），这里只判是不是紧挨着它自己：同一个分区，插在它前面或后面。
            const own = doc.panels[panel]?.tabs.findIndex((tab) => tabKey(tab) === source.tab) ?? -1;
            const ownPartition = (snapshot !== null ? snapshot.excludedPartition : strip?.querySelector(`[data-panel-tab="${escape(source.tab)}"]`)?.getAttribute("data-tab-partition")) ?? null;
            return {action, ...(part === undefined ? {} : {part}), inPlace: own >= 0 && ownPartition === measured.partition && (index === own || index === own + 1), preview};
        }
        const result = applyLayoutDrop(doc, source, action, options.policy());
        if (!result.ok) return null;
        // 工具面板放回原处：预览画来源自己所在的位置（输出 28）。
        const inPlace = result.doc === doc;
        return {action, inPlace, preview: inPlace ? previewOf(doc, source, {kind: "center", panel}, true, panelGeometry(doc)) : preview};
    }

    /** 键盘在这块标签条上能停的位置：看得见的标签之间。 */
    function stripStopsOf(doc: LayoutDoc, panel: string): ReadonlyArray<{readonly point: GridDropPoint; readonly index: number}> {
        const strip = stripOf(panel);
        if (strip === null || options.titleOnly(panel)) return [];
        return tabStripStops(strip).flatMap((point) => {
            const measured = resolveTabStripInsertion(strip, point);
            return measured === null ? [] : [{point, index: stripIndex(doc, panel, measured)}];
        });
    }

    function dropAt(source: LayoutTabSource, point: GridDropPoint, region: KeyboardRegion | null): LayoutDragDrop | null {
        const doc = options.doc();
        const band = rectOf(toolBand());
        if (band !== null && contains(band, point)) return barDrop(source, point, band);
        if (doc !== previewsOf) {
            previewsOf = doc;
            previews.clear();
        }
        if (live.active.value && frozen === null) {
            frozen = {
                panels: panelGeometry(doc),
                strips: new Map(treeLeaves(doc.tree.root).flatMap((leaf) => {
                    const strip = stripOf(leaf.id);
                    return strip === null ? [] : [[leaf.id, measureTabStrip(strip, source.tab)] as const];
                })),
            };
        }
        const panels = frozen?.panels ?? panelGeometry(doc);
        // 键盘的区域是明确选的，不按坐标判预备区：编辑组的外缘候选就在预备区底下。
        const zones = region === null ? frozenZones.map((zone) => ({panel: zone.panel, rect: zone.rect})) : [];
        // 键盘停在预备区上就是它：预备区可能叠在真实落点上，按坐标会落到下面去。
        const input: LayoutDropInput = {doc, source, point, panels, excluded: excludedRects(), zones, policy: options.policy()};
        const kept = live.stickyDrop(point);
        if (kept !== null) return withSectors(kept, input);
        const resolved = region?.id.startsWith("reveal:") === true
            ? ({kind: "reveal", panel: region.id.slice("reveal:".length)} as const)
            : resolveLayoutDrop(input);
        if (resolved === null) return null;
        if (resolved.kind === "strip" && !options.titleOnly(resolved.panel)) return stripDrop(doc, source, resolved.panel, point);
        // 头只写标题的面板没有插入位：落在标题上就是添加为标签。
        const action = resolved.kind === "strip" ? ({kind: "center", panel: resolved.panel} as const) : resolved;
        const key = JSON.stringify([source, action, options.extent()]);
        const cached = previews.get(key);
        if (cached !== undefined) return withSectors(cached, input);
        const result = applyLayoutDrop(doc, source, action, options.policy());
        if (!result.ok) return null;
        const inPlace = result.doc === doc;
        const drop = {action, inPlace, preview: previewOf(doc, source, action, inPlace, panels)};
        previews.set(key, drop);
        return withSectors(drop, input);
    }

    /** 分区不进预览缓存：缓存按动作存，同一个“放到两块之间”可以从两块面板进来，画的是指针所在的那块。 */
    function withSectors(drop: LayoutDragDrop, input: LayoutDropInput): LayoutDragDrop {
        if (!options.sectors() || drop.action.kind === "reveal") return drop;
        const panel = layoutDropPanelAt(input);
        const items = panel === null ? null : layoutDropSectors(input, panel);
        if (panel === null || items === null) return drop;
        const wanted = JSON.stringify(drop.action);
        return {...drop, sectors: {rect: panel.body, items, active: items.find((item) => JSON.stringify(item.action) === wanted)?.id ?? null}};
    }

    /** 这个落点放回 `dropAt` 能算出它的那个点（键盘用）。 */
    function pointOfCandidate(candidate: LayoutDropCandidate, doc: LayoutDoc, panels: ReadonlyArray<LayoutDropPanelGeometry>): GridDropPoint | null {
        const {action} = candidate;
        if (action.kind === "reveal") {
            const zone = frozenZones.find((item) => item.panel === action.panel);
            return zone === undefined ? null : centerOf(zone.rect);
        }
        const panelId = action.kind === "edge" ? (action.target.kind === "split" ? action.target.panel : candidate.region) : action.panel;
        const geometry = panels.find((item) => item.id === panelId);
        if (geometry === undefined) return null;
        // 同一个下标可能有两个位置（固定行的行尾、普通行的行首）：取后一个，放下去是普通标签。
        if (action.kind === "strip") return stripStopsOf(doc, panelId).findLast((stop) => stop.index === action.index)?.point ?? null;
        const {body} = geometry;
        const center = centerOf(body);
        if (action.kind === "center") return center;
        const edge = action.target.kind === "split" ? action.target.edge
            : action.target.before === panelId ? (branchOrientation(doc, action.target.branch) === "horizontal" ? "right" : "bottom")
                : (branchOrientation(doc, action.target.branch) === "horizontal" ? "left" : "top");
        const inset = 2;
        if (edge === "left") return {x: body.left + inset, y: center.y};
        if (edge === "right") return {x: body.right - inset, y: center.y};
        if (edge === "top") return {x: center.x, y: body.top + inset};
        return {x: center.x, y: body.bottom - inset};
    }

    /** 区域里能停的位置。来源那块面板只剩原位时停在它的中央：放下去还是原样。 */
    function stopsOf(region: KeyboardRegion): {readonly axis: "both"; readonly points: ReadonlyArray<GridDropPoint>} {
        if (region.id === BAR_REGION) {
            const band = rectOf(toolBand());
            return {axis: "both", points: band === null ? [] : barStops(band)};
        }
        const doc = options.doc();
        const panels = panelGeometry(doc);
        const points = region.candidates.flatMap((candidate) => pointOfCandidate(candidate, doc, panels) ?? []);
        if (points.length > 0 || region.candidates.length > 0) return {axis: "both", points};
        const body = panels.find((geometry) => geometry.id === region.id)?.body;
        return {axis: "both", points: body === undefined ? [] : [centerOf(body)]};
    }

    const fromElement = (element: Element): LayoutTabSource | null => {
        const entry = element.closest<HTMLElement>("[data-tool-entry]")?.dataset.toolEntry;
        if (entry !== undefined) return {kind: "tab", tab: viewKey(entry)};
        const tab = element.closest<HTMLElement>("[data-panel-tab]")?.dataset.panelTab;
        return tab === undefined ? null : {kind: "tab", tab};
    };

    /** 声明 `movable: false` 的视图不起拖：不出现“拿起了却落不下去”。 */
    function movable(source: LayoutTabSource): boolean {
        if (findTab(options.doc(), source.tab) === null) return false;
        const viewId = viewIdOf(source.tab);
        return viewId === null || options.catalog().get(viewId)?.movable !== false;
    }

    const sourceAt = (target: Element): LayoutTabSource | null => {
        if (!options.enabled() || target.closest("[data-no-drag], [data-no-drag-start]") !== null) return null;
        const source = fromElement(target);
        return source !== null && movable(source) ? source : null;
    };

    const session = createDragSession<LayoutTabSource, LayoutDragDrop, KeyboardRegion>({
        root,
        sourceAt,
        activate: (source, keyboard) => {
            frozenZones = revealZones(source);
            previews.clear();
            frozen = null;
            // 键盘没有指针可跟；减少动效时邻居瞬移看不出去了哪；最大化时别的面板盖着，预览看不见。
            if (!keyboard && options.feel() === "live" && options.maximized() === null && options.extent() !== null && layoutMotionMs(root) > 0) {
                options.settleMotion();
                live.begin(source);
            }
            return true;
        },
        // 实时布局的判定基准是拿起时的矩形，容器变了就没了，也没法从预览里量回来：整场取消。落点指示按当前位置重算（输出 32）。
        structure: () => JSON.stringify([layoutStructureKey(options.doc()), options.editorTabs()?.structure() ?? null, live.active.value ? extentKey(options.extent()) : null]),
        resolve: ({source, point, top, region}) => {
            // 被菜单、对话框挡住的、按钮区都不接收；键盘没有指针下的元素。
            const drop = region === null && (top === null || !root.contains(top) || top.closest("[data-no-drag]") !== null) ? null : dropAt(source, point, region);
            live.offer(drop);
            return drop;
        },
        commitsUnderPointer: (keyboard) => !keyboard && live.active.value,
        actionKey: (drop) => (drop.inPlace ? null : JSON.stringify([drop.action, drop.part ?? null])),
        commit: (drop, source, keyboard) => options.commit(source, drop.action, drop.part, keyboard),
        // 拖动中的光标与禁选在全局样式里按这个标记生效。
        onActiveChange: (active) => {
            root.ownerDocument.documentElement.toggleAttribute("data-workbench-dragging", active);
            if (active) return;
            // 放下、取消、中止都经过这里，并且先于提交：撤预览和提交在同一个同步段，不闪。
            live.end();
            frozen = null;
        },
        keyboard: {
            // 焦点要在拖动源本身：标签或条目；面板头里别的控件保留自己的空格。
            sourceAt: (target) => (target.matches("[data-panel-tab], [data-tool-entry]") ? sourceAt(target) : null),
            regions: (source) => {
                const doc = options.doc();
                const candidates = enumerateDropCandidates({
                    doc,
                    source,
                    policy: options.policy(),
                    stripIndexes: (panel) => stripStopsOf(doc, panel).map((stop) => stop.index),
                    reveal: frozenZones.map((zone) => zone.panel),
                });
                const byRegion = new Map<string, LayoutDropCandidate[]>();
                for (const candidate of candidates) byRegion.set(candidate.region, [...(byRegion.get(candidate.region) ?? []), candidate]);
                // 按树序，预备区在后。来源所在的面板就算没有候选也要有一个区域：拿起时停在原位。
                const home = findTab(doc, source.tab)?.panel;
                const panels = treeLeaves(doc.tree.root).map((leaf) => leaf.id).filter((id) => byRegion.has(id) || id === home);
                const reveals = [...byRegion.keys()].filter((id) => id.startsWith("reveal:"));
                // 工具视图的第一站是活动栏（输出 31）；最大化时它不接收（`barDrop`）。
                const bar = viewIdOf(source.tab) !== null && options.maximized() === null ? [BAR_REGION] : [];
                const regions = [...bar, ...panels, ...reveals].map((id) => ({id, candidates: byRegion.get(id) ?? []}));
                // 手势跳不过没有位置的区域，Tab 会卡在那里：来源隐藏着（从活动栏拿起）时它的面板量不出来，不列。
                return regions.filter((region) => stopsOf(region).points.length > 0);
            },
            stops: stopsOf,
            // 从来源自己的位置开始，直接 Enter 不移动（输出 31）。
            start: (source, regions, origin) => {
                // 从标签拿起：原位是它自己。从活动栏拿起：区域就是活动栏，起点是条目，放回去也是原位（它在面板里的标签可能看不见：面板隐藏、头只写别的视图的标题）。
                const fromBar = origin.closest("[data-tool-entry]") !== null;
                const home = fromBar ? BAR_REGION : findTab(options.doc(), source.tab)?.panel;
                const region = Math.max(0, regions.findIndex((candidate) => candidate.id === home));
                const own = fromBar ? null : root.querySelector(`[data-panel-tab="${escape(source.tab)}"]`);
                return {region, at: centerOf(rectOf(own) ?? rectOf(origin) ?? {left: 0, top: 0, right: 0, bottom: 0})};
            },
            refocus: (source) => root.querySelector<HTMLElement>(`[data-panel-tab="${escape(source.tab)}"]`)
                ?? root.querySelector<HTMLElement>(`[data-tool-entry="${escape(viewIdOf(source.tab) ?? "")}"]`),
        },
    });

    function branchOrientation(doc: LayoutDoc, branchId: string): GridOrientation | null {
        const visit = (node: LayoutDoc["tree"]["root"]): GridOrientation | null => {
            if (node.kind === "leaf") return null;
            if (node.id === branchId) return node.orientation;
            for (const child of node.children) {
                const found = visit(child);
                if (found !== null) return found;
            }
            return null;
        };
        return visit(doc.tree.root);
    }

    return {session, zones: () => frozenZones, live, dispose: () => session.dispose()};
}
