/**
 * 一棵树的拖放（docs/specs/ui/workbench-layout.md 输出 24 到 32）：手势是 nb-layout 的拖动会话，落点规则是 `resolveLayoutDrop`，这里读 DOM 给它矩形，把结果换成反馈要画的东西。
 *
 * 拖动源：标签（`data-panel-tab`，工具视图与编辑器标签都是，侧栏这一列的标题也是）、活动栏条目（`data-tool-entry`）、浮动窗的头（标签条空白，或它唯一的标签：整窗移动，输出 39）。树里整块面板不能拖（输出 24）。`data-no-drag` 里的按钮既不起拖也不接收，
 * `data-no-drag-start` 只是不起拖（标签上的关闭按钮：拖动经过时它还在标签条里），被菜单、对话框挡住的不接收。编辑组的标签条写 `data-panel-strip`，它的多行、固定分区由编辑器量（`editorTabs`）。
 *
 * 活动栏上段（`data-tool-band`）是侧栏的标签条：工具视图放上去进 `sidebar`，位置按条目量（输出 22）。这段不走库的落点规则：条不是面板。
 *
 * 判定是纯读：预览用提交时的同一个函数（`applyLayoutDrop`）算，放回原处的落点只显示、不提交。结构键变了整场取消（输出 32），放下时提交再验一次接受矩阵（领域操作自己验）。
 */

import {applyLayoutDrop, clampFloatRect, enumerateDropCandidates, findTab, isFloating, LAYOUT_FLOAT_EDGE_RATIO, LAYOUT_MAX_FLOATS, layoutDropKey, layoutDropPanelAt, layoutDropSectors, previewEdgeDrop, previewRevealRects, removeTab, resolveLayoutDrop, sourceTabs, tabKey, treeLeaves} from "@notnotype/nb-layout";
import type {GridDropPoint, GridDropRect, GridExtent, GridFloatInput, GridOrientation, LayoutDoc, LayoutDropAction, LayoutDropCandidate, LayoutDropInput, LayoutDropPanelGeometry, LayoutDropSector, LayoutDropSectorId, LayoutDropSource, LayoutFloatRect, LayoutPolicy, LayoutProjectionOptions, LayoutSource, TabRef} from "@notnotype/nb-layout";
import {createDragSession, layoutMotionMs, measureTabStrip, resolveTabStripInsertion, tabStripInsertionIn, tabStripStops} from "@notnotype/nb-layout/vue";
import type {DragSession, TabStripSnapshot} from "@notnotype/nb-layout/vue";

import {nextTick} from "vue";

import {createLiveDrag} from "./live-drag";
import type {LiveDrag} from "./live-drag";

import {EDITOR_TAB_TYPE, editorTabIdOf} from "../shared/editor-panels";
import type {EditorTabDrag} from "./contracts";
import {defaultFloatRect, EDITOR_GROUP_MINIMUM, FLOAT_KEEP_WIDTH, floatRectAt, PANEL_HEAD_HEIGHT} from "./state/layout-constraints";
import {layoutStructureKey, viewIdOf, viewKey} from "./state/layout-present";
import type {ViewCatalog} from "./views/registry";

/** 被拖的是一个标签。实时布局只有这一种：整个浮动窗本身就在跟手。 */
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
    /** 画出来的浮动窗（夹取之后）：整窗拖动从这个矩形开始。 */
    floats(): ReadonlyArray<GridFloatInput>;
    /** 整窗跟手的矩形；null 回到记录里的。只有矩形在变，不换文档。 */
    previewFloat(panel: string | null, rect?: LayoutFloatRect): void;
    /** 这个来源浮出来的最小尺寸。 */
    floatMinimum(source: LayoutTabSource): GridExtent;
    commit(source: LayoutSource, action: LayoutDropAction, part: string | undefined, keyboard: boolean): void;
}

export interface LayoutDrag {
    readonly session: DragSession<LayoutSource, LayoutDragDrop>;
    /** 这一场浮出的预备区。 */
    zones(): ReadonlyArray<LayoutRevealZone>;
    readonly live: LiveDrag;
    /** 资源树的文件在树外能落到哪（输出 39）：这一场是资源树自己的会话，这里只判定。`top` 是指针处最上层的元素，窗口外是 null。 */
    fileDrop(point: GridDropPoint, top: Element | null): LayoutDragDrop | null;
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
/** 键盘的“浮动”区域：没有指针，无落点要明确选。 */
const FLOAT_REGION = "float";
const SIDEBAR = "sidebar";
/** 文件还不是文档里的标签：判定按一个编辑器标签问接受矩阵，提交归编辑器。 */
const FILE_SOURCE: LayoutDropSource = {kind: "new", tab: {kind: "tab", type: EDITOR_TAB_TYPE, tabId: "file"}};

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
    let frozen: {readonly panels: LayoutDropPanelGeometry[]; readonly floats: LayoutDropPanelGeometry[]; readonly strips: ReadonlyMap<string, TabStripSnapshot>} | null = null;
    /** 这一场是整窗拖动：抓住的点相对窗的偏移；窗呈现的大小（夹位置用）与记录里的大小（提交用：夹取不写回）。 */
    let windowDrag: {readonly panel: string; readonly grab: GridDropPoint; readonly shown: GridExtent; readonly size: GridExtent} | null = null;

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
            // 浮动的预览是来源收起：窗此刻就是跟手的卡片，松手才落到矩形上。
            const result = drop.action.kind === "float" ? removeTab(doc, source.tab) : applyLayoutDrop(doc, source, drop.action, options.policy());
            return result.ok ? result.doc : null;
        },
        sourceRemovedDoc: (source) => {
            const result = removeTab(options.doc(), source.tab);
            return result.ok ? result.doc : null;
        },
        homeOf: (source, shown) => findTab(shown ?? options.doc(), source.tab)?.panel ?? null,
        show: (doc) => options.showPreview(doc),
        panelRect: (panel) => rectOf(root.querySelector(`[data-shell-card="${escape(panel)}"]`)),
        gridOrigin: () => {
            const box = root.querySelector("[data-workbench-surface] > [data-grid-scope]")?.getBoundingClientRect();
            return {x: box?.left ?? 0, y: box?.top ?? 0};
        },
        trackPointer: (listener) => {
            const onMove = (event: PointerEvent): void => listener({x: event.clientX, y: event.clientY});
            view?.addEventListener("pointermove", onMove, true);
            return () => view?.removeEventListener("pointermove", onMove, true);
        },
    });
    const stripOf = (panel: string): Element | null => root.querySelector(`[data-panel-strip="${escape(panel)}"] [data-tab-strip]`);

    function geometryOf(doc: LayoutDoc, id: string): LayoutDropPanelGeometry | null {
        // 拖到零的面板，卡片还停在最后的非零尺寸（内容不重排），量的是外框。
        if (rectOf(root.querySelector(`[data-leaf="${escape(id)}"]`)) === null) return null;
        const card = rectOf(root.querySelector(`[data-shell-card="${escape(id)}"]`));
        if (card === null) return null;
        // 工具面板整个头都算标签条（动作区经 `data-no-drag` 不接收）；编辑组的头里还有提示条，只有标签条那一行算，头以下是正文。
        const editor = doc.panels[id]?.role === "editor";
        const strip = rectOf(root.querySelector(editor ? `[data-panel-strip="${escape(id)}"]` : `[data-panel-head="${escape(id)}"]`));
        return {id, body: strip === null ? card : {...card, top: strip.bottom}, strip};
    }

    function panelGeometry(doc: LayoutDoc): LayoutDropPanelGeometry[] {
        const maximized = options.maximized();
        return treeLeaves(doc.tree.root).flatMap((leaf) => {
            if (doc.panels[leaf.id] === undefined || (maximized !== null && maximized !== leaf.id)) return [];
            return geometryOf(doc, leaf.id) ?? [];
        });
    }

    /** 浮动窗，上面的在前。整窗拖动时它自己不算。 */
    function floatGeometry(doc: LayoutDoc): LayoutDropPanelGeometry[] {
        return doc.floats.toReversed().flatMap(({panel}) => (panel === windowDrag?.panel ? [] : (geometryOf(doc, panel) ?? [])));
    }

    /** 条与标题栏不是落点（规则 1）。 */
    function excludedRects(): GridDropRect[] {
        const rects = [root.querySelector("[data-shell-card='activitybar']"), root.querySelector("[data-leaf='statusbar']"), root.querySelector("[data-shell-titlebar]")];
        return rects.flatMap((element) => rectOf(element) ?? []);
    }

    /** 此刻没显示的具名面板显示出来会在的矩形（输出 29）。接受矩阵不让进的不浮：编辑器标签进不了工具面板。 */
    function revealZones(source: LayoutSource): ReadonlyArray<LayoutRevealZone> {
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
    function barDrop(source: LayoutTabSource | Extract<LayoutSource, {readonly kind: "panel"}>, point: GridDropPoint, band: GridDropRect): LayoutDragDrop | null {
        const doc = options.doc();
        const sidebar = doc.panels[SIDEBAR];
        const tools = source.kind === "tab" ? viewIdOf(source.tab) !== null : doc.panels[source.panel]?.role === "tool";
        if (sidebar === undefined || !tools || options.maximized() !== null) return null;
        const entries = sidebarEntries(doc);
        const next = entries.find((entry) => {
            const {top, bottom} = entry.getBoundingClientRect();
            return point.y < (top + bottom) / 2;
        });
        const tabs = sidebar.tabs.map(tabKey);
        const index = next === undefined ? tabs.length : tabs.indexOf(viewKey(next.dataset.toolEntry ?? ""));
        const inside = source.kind === "tab" && findTab(doc, source.tab)?.panel === SIDEBAR;
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

    function previewOf(doc: LayoutDoc, source: LayoutDropSource, action: Exclude<LayoutDropAction, {readonly kind: "strip"}>, inPlace: boolean, panels: ReadonlyArray<LayoutDropPanelGeometry>): LayoutDropPreview {
        const none: LayoutDropPreview = {areaRect: null, indicator: null, orientation: "horizontal"};
        // 文件不在文档里，不会是原位。
        if (inPlace && source.kind !== "new") {
            const home = source.kind === "tab" ? findTab(doc, source.tab)?.panel : source.panel;
            return {...none, areaRect: panels.find((geometry) => geometry.id === home)?.body ?? null};
        }
        switch (action.kind) {
            case "float":
                return none;
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
    function stripDrop(doc: LayoutDoc, source: LayoutDropSource, panel: string, point: GridDropPoint): LayoutDragDrop | null {
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
            if (source.kind !== "tab") return {action, ...(part === undefined ? {} : {part}), inPlace: false, preview};
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

    function freeze(doc: LayoutDoc, source: LayoutTabSource): void {
        frozen = {
            panels: panelGeometry(doc),
            floats: floatGeometry(doc),
            strips: new Map([...treeLeaves(doc.tree.root).map((leaf) => leaf.id), ...doc.floats.map((float) => float.panel)].flatMap((panel) => {
                const strip = stripOf(panel);
                return strip === null ? [] : [[panel, measureTabStrip(strip, source.tab)] as const];
            })),
        };
    }

    /** 这个来源能浮出来吗（输出 39）：视图可以声明不许；窗数到了上限不行；已经独占一个窗的标签再浮还是它（键盘不列这个落点）。 */
    function canFloat(doc: LayoutDoc, source: LayoutTabSource): boolean {
        const found = findTab(doc, source.tab);
        if (found === null || doc.floats.length >= LAYOUT_MAX_FLOATS) return false;
        const viewId = viewIdOf(source.tab);
        return viewId === null || options.catalog().get(viewId)?.floatable !== false;
    }

    const toGrid = (point: GridDropPoint): GridDropPoint => {
        const origin = surface()?.getBoundingClientRect();
        return {x: point.x - (origin?.left ?? 0), y: point.y - (origin?.top ?? 0)};
    };
    const keepVisible = (rect: LayoutFloatRect): LayoutFloatRect => {
        const extent = options.extent();
        return extent === null ? rect : clampFloatRect(rect, extent, {width: FLOAT_KEEP_WIDTH, height: PANEL_HEAD_HEIGHT});
    };

    /**
     * 明确的无落点：标签在松手处浮动打开（输出 39），反馈画这个矩形。不进预览缓存，矩形每帧变。键盘没有指针，矩形按树区域居中。
     */
    function floatDrop(doc: LayoutDoc, minimum: GridExtent, point: GridDropPoint | null): LayoutDragDrop {
        const rect = point === null ? defaultFloatRect(options.extent(), minimum, doc.floats.length) : keepVisible(floatRectAt(toGrid(point), options.extent(), minimum));
        const origin = surface()?.getBoundingClientRect();
        const areaRect = origin === undefined ? null : offset({left: rect.x, top: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height}, origin);
        return {action: {kind: "float", rect}, inPlace: false, preview: {areaRect, indicator: null, orientation: "horizontal"}};
    }

    /** 整窗此刻的矩形：抓住的点在指针下，位置按呈现的大小夹，大小还是记录里的。 */
    function windowRect(drag: NonNullable<typeof windowDrag>, point: GridDropPoint): LayoutFloatRect {
        const at = toGrid(point);
        const {x, y} = keepVisible({x: at.x - drag.grab.x, y: at.y - drag.grab.y, ...drag.shown});
        return {x, y, ...drag.size};
    }

    /** 有落点时的这一份：动作、原位、反馈。标签与整窗共用。 */
    function dropFor(doc: LayoutDoc, source: LayoutDropSource, resolved: LayoutDropAction, point: GridDropPoint, panels: ReadonlyArray<LayoutDropPanelGeometry>): LayoutDragDrop | null {
        if (resolved.kind === "strip" && !options.titleOnly(resolved.panel)) return stripDrop(doc, source, resolved.panel, point);
        // 头只写标题的面板没有插入位：落在标题上就是添加为标签。
        const action = resolved.kind === "strip" ? ({kind: "center", panel: resolved.panel} as const) : resolved;
        // 缓存跟着外壳的一场拖动清（`activate`）。文件拖动是资源树的会话，没有这个清理点：每次算。
        const key = source.kind === "new" ? null : JSON.stringify([source, action, options.extent()]);
        const cached = key === null ? undefined : previews.get(key);
        if (cached !== undefined) return cached;
        const result = applyLayoutDrop(doc, source, action, options.policy());
        if (!result.ok) return null;
        const inPlace = result.doc === doc;
        const drop = {action, inPlace, preview: previewOf(doc, source, action, inPlace, panels)};
        if (key !== null) previews.set(key, drop);
        return drop;
    }

    const dropOrigin = (doc: LayoutDoc): void => {
        if (doc === previewsOf) return;
        previewsOf = doc;
        previews.clear();
    };

    /**
     * 整窗的判定：窗一直在跟手，所以“放不进”都是移动（输出 39），反馈不画。只有标签条和窄带能停靠，经过中央继续浮着。
     */
    function windowDrop(drag: NonNullable<typeof windowDrag>, source: Extract<LayoutSource, {readonly kind: "panel"}>, point: GridDropPoint): LayoutDragDrop {
        const doc = options.doc();
        const moved: LayoutDragDrop = {action: {kind: "float", rect: windowRect(drag, point)}, inPlace: false, preview: {areaRect: null, indicator: null, orientation: "horizontal"}};
        const band = rectOf(toolBand());
        if (band !== null && contains(band, point)) return barDrop(source, point, band) ?? moved;
        dropOrigin(doc);
        const panels = panelGeometry(doc);
        const input: LayoutDropInput = {doc, source, point, panels, floats: floatGeometry(doc), excluded: excludedRects(), zones: frozenZones.map((zone) => ({panel: zone.panel, rect: zone.rect})), policy: options.policy(), noCenter: true, edgeRatio: LAYOUT_FLOAT_EDGE_RATIO};
        const resolved = resolveLayoutDrop(input);
        if (resolved === null) return moved;
        const drop = dropFor(doc, source, resolved, point, panels);
        return drop === null ? moved : sectored(drop, resolved, input);
    }

    function dropAt(source: LayoutTabSource, point: GridDropPoint, region: KeyboardRegion | null): LayoutDragDrop | null {
        const doc = options.doc();
        if (region?.id === FLOAT_REGION) return canFloat(doc, source) ? floatDrop(doc, options.floatMinimum(source), null) : null;
        const band = rectOf(toolBand());
        if (band !== null && contains(band, point)) return barDrop(source, point, band);
        dropOrigin(doc);
        if (live.active.value && frozen === null) freeze(doc, source);
        const panels = frozen?.panels ?? panelGeometry(doc);
        const allFloats = frozen?.floats ?? floatGeometry(doc);
        // 键盘的区域是明确选的，不按坐标判预备区：编辑组的外缘候选就在预备区底下。别的窗盖着的落点也要能选。
        const zones = region === null ? frozenZones.map((zone) => ({panel: zone.panel, rect: zone.rect})) : [];
        const floats = region === null ? allFloats : allFloats.filter((geometry) => geometry.id === region.id);
        // 键盘停在预备区上就是它：预备区可能叠在真实落点上，按坐标会落到下面去。
        const input: LayoutDropInput = {doc, source, point, panels, floats, excluded: excludedRects(), zones, policy: options.policy()};
        const kept = live.stickyDrop(point);
        if (kept !== null) return withSectors(kept, input);
        const resolved = region?.id.startsWith("reveal:") === true
            ? ({kind: "reveal", panel: region.id.slice("reveal:".length)} as const)
            : resolveLayoutDrop(input);
        // 只有这里是“明确的无落点”：别的 null 是被挡住、算不出或出错，不该开窗。键盘的无落点要明确选“浮动”区域。
        if (resolved === null) return region === null && canFloat(doc, source) ? floatDrop(doc, options.floatMinimum(source), point) : null;
        const drop = dropFor(doc, source, resolved, point, panels);
        return drop === null ? null : sectored(drop, resolved, input);
    }

    /**
     * 文件的判定（输出 39）：同一份规则与反馈；预备区、实时布局的冻结都是外壳那一场的，这里没有。按钮区、活动栏不开窗；没有编辑器时没有落点。
     */
    function fileDrop(point: GridDropPoint, top: Element | null): LayoutDragDrop | null {
        const doc = options.doc();
        if (options.editorTabs() === null || top?.closest("[data-no-drag]") != null) return null;
        const band = rectOf(toolBand());
        if (band !== null && contains(band, point)) return null;
        const panels = panelGeometry(doc);
        const input: LayoutDropInput = {doc, source: FILE_SOURCE, point, panels, floats: floatGeometry(doc), excluded: excludedRects(), policy: options.policy()};
        const resolved = resolveLayoutDrop(input);
        if (resolved === null) return doc.floats.length < LAYOUT_MAX_FLOATS ? floatDrop(doc, EDITOR_GROUP_MINIMUM, point) : null;
        const drop = dropFor(doc, FILE_SOURCE, resolved, point, panels);
        return drop === null ? null : sectored(drop, resolved, input);
    }

    /** 标签条上是一条插入线，没有分区；头只写标题的面板没有插入位，算中央。 */
    function sectored(drop: LayoutDragDrop, resolved: LayoutDropAction, input: LayoutDropInput): LayoutDragDrop {
        return resolved.kind === "strip" && !options.titleOnly(resolved.panel) ? drop : withSectors(drop, input);
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
        if (action.kind === "float") return null;
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
        if (region.id === FLOAT_REGION) {
            const box = rectOf(surface());
            return {axis: "both", points: box === null ? [] : [centerOf(box)]};
        }
        const doc = options.doc();
        const panels = [...panelGeometry(doc), ...floatGeometry(doc)];
        const points = region.candidates.flatMap((candidate) => pointOfCandidate(candidate, doc, panels) ?? []);
        if (points.length > 0 || region.candidates.length > 0) return {axis: "both", points};
        const body = panels.find((geometry) => geometry.id === region.id)?.body;
        return {axis: "both", points: body === undefined ? [] : [centerOf(body)]};
    }

    const fromElement = (element: Element): LayoutSource | null => {
        const entry = element.closest<HTMLElement>("[data-tool-entry]")?.dataset.toolEntry;
        if (entry !== undefined) return {kind: "tab", tab: viewKey(entry)};
        const tab = element.closest<HTMLElement>("[data-panel-tab]")?.dataset.panelTab;
        // 浮动窗的头：标签条空白，或它唯一的标签，拖的是整个窗；多标签时拖标签是撕下（输出 39）。
        const floating = element.closest<HTMLElement>("[data-leaf][data-float]")?.dataset.leaf;
        if (floating !== undefined && options.doc().panels[floating] !== undefined) {
            const onHead = element.closest("[data-panel-strip], [data-panel-head]") !== null;
            if (tab === undefined ? onHead : options.doc().panels[floating]?.tabs.length === 1) return {kind: "panel", panel: floating};
        }
        return tab === undefined ? null : {kind: "tab", tab};
    };

    /** 声明 `movable: false` 的视图不起拖：不出现“拿起了却落不下去”。 */
    function movable(source: LayoutSource): boolean {
        if (source.kind === "panel") return isFloating(options.doc(), source.panel);
        if (findTab(options.doc(), source.tab) === null) return false;
        const viewId = viewIdOf(source.tab);
        return viewId === null || options.catalog().get(viewId)?.movable !== false;
    }

    /** 手势拿起时的指针：`activate` 不带坐标，卡片要一开始就在指针下。 */
    let lastPointer: GridDropPoint | null = null;
    /** 按下的地方：过门槛时指针已经离开它几个像素，整窗抓住的是按下的那一点。 */
    let pressedAt: GridDropPoint | null = null;
    const onPointerSeen = (event: PointerEvent): void => {
        lastPointer = {x: event.clientX, y: event.clientY};
        if (event.type === "pointerdown") pressedAt = lastPointer;
    };
    view?.addEventListener("pointermove", onPointerSeen, true);
    view?.addEventListener("pointerdown", onPointerSeen, true);

    const sourceAt = (target: Element): LayoutSource | null => {
        if (!options.enabled() || target.closest("[data-no-drag], [data-no-drag-start]") !== null) return null;
        const source = fromElement(target);
        return source !== null && movable(source) ? source : null;
    };

    const session = createDragSession<LayoutSource, LayoutDragDrop, KeyboardRegion>({
        root,
        sourceAt,
        activate: (source, keyboard) => {
            frozenZones = revealZones(source);
            previews.clear();
            frozen = null;
            windowDrag = null;
            if (source.kind === "panel") {
                // 窗本身就在跟手，不走实时布局：它没有卡片可缩，候选文档里它已经没了。
                const rect = options.floats().find((float) => float.id === source.panel)?.rect;
                const recorded = options.doc().floats.find((float) => float.panel === source.panel)?.rect;
                if (rect === undefined || recorded === undefined || pressedAt === null) return false;
                const at = toGrid(pressedAt);
                windowDrag = {panel: source.panel, grab: {x: at.x - rect.x, y: at.y - rect.y}, shown: {width: rect.width, height: rect.height}, size: {width: recorded.width, height: recorded.height}};
                return true;
            }
            // 键盘没有指针可跟；减少动效时邻居瞬移看不出去了哪；最大化时别的面板盖着，预览看不见。
            if (!keyboard && options.feel() === "live" && options.maximized() === null && options.extent() !== null && layoutMotionMs(root) > 0) {
                options.settleMotion();
                live.begin(source, lastPointer);
                // 送到终点要等渲染才落到 DOM（摘掉过渡标记、写终点矩形）。手势紧接着在同一个同步段里做第一次判定，那次量到的是过渡中间的矩形：渲染之后马上重量。
                // 不能留给下一次判定去量：帧循环这时已经开始摆预览，再量就是预览里的矩形。
                void nextTick(() => {
                    if (live.active.value) freeze(options.doc(), source);
                });
            }
            return true;
        },
        // 实时布局的判定基准是拿起时的矩形，容器变了就没了，也没法从预览里量回来：整场取消。落点指示按当前位置重算（输出 32）。
        structure: () => JSON.stringify([layoutStructureKey(options.doc()), options.editorTabs()?.structure() ?? null, live.active.value ? extentKey(options.extent()) : null]),
        resolve: ({source, point, top, region}) => {
            // 被菜单、对话框挡住的不接收；键盘没有指针下的元素。指针在窗口外没有元素，算无落点。
            const covered = region === null && top !== null && !root.contains(top);
            if (source.kind === "panel") {
                if (windowDrag === null) return null;
                // 窗一直跟着指针，放不下也跟。别的窗的按钮区、活动栏放不进都是移动。
                options.previewFloat(windowDrag.panel, windowRect(windowDrag, point));
                return covered ? null : windowDrop(windowDrag, source, point);
            }
            const onButtons = region === null && top?.closest("[data-no-drag]") != null;
            const drop = covered || onButtons ? null : dropAt(source, point, region);
            live.offer(drop);
            return drop;
        },
        commitsUnderPointer: (keyboard) => !keyboard && (live.active.value || windowDrag !== null),
        actionKey: (drop) => (drop.inPlace ? null : JSON.stringify([layoutDropKey(drop.action), drop.part ?? null])),
        commit: (drop, source, keyboard) => options.commit(source, drop.action, drop.part, keyboard),
        // 拖动中的光标与禁选在全局样式里按这个标记生效。
        onActiveChange: (active) => {
            root.ownerDocument.documentElement.toggleAttribute("data-workbench-dragging", active);
            if (active) return;
            // 放下、取消、中止都经过这里，并且先于提交：撤预览和提交在同一个同步段，不闪。
            live.end();
            frozen = null;
            windowDrag = null;
            options.previewFloat(null);
        },
        keyboard: {
            // 焦点要在拖动源本身：标签或条目；面板头里别的控件保留自己的空格。
            // 键盘的来源总是标签：整窗移动有自己的把手（`FloatWindowHandles`）。
            sourceAt: (target) => {
                if (!target.matches("[data-panel-tab], [data-tool-entry]") || sourceAt(target) === null) return null;
                const entry = (target as HTMLElement).dataset.toolEntry;
                return {kind: "tab", tab: entry === undefined ? ((target as HTMLElement).dataset.panelTab as string) : viewKey(entry)};
            },
            regions: (from) => {
                const doc = options.doc();
                if (from.kind === "panel") return [];
                const source = from;
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
                const panels = [...treeLeaves(doc.tree.root).map((leaf) => leaf.id), ...doc.floats.map((float) => float.panel)].filter((id) => byRegion.has(id) || id === home);
                const reveals = [...byRegion.keys()].filter((id) => id.startsWith("reveal:"));
                // 工具视图的第一站是活动栏（输出 31）；最大化时它不接收（`barDrop`）。
                const bar = viewIdOf(source.tab) !== null && options.maximized() === null ? [BAR_REGION] : [];
                // 无落点没有指针可以指，排在最后明确选。已经独占一个窗的标签浮出来还是原样，不列。
                const alone = home !== undefined && isFloating(doc, home) && doc.panels[home]?.tabs.length === 1;
                const float = canFloat(doc, source) && !alone ? [FLOAT_REGION] : [];
                const regions = [...bar, ...panels, ...reveals, ...float].map((id) => ({id, candidates: byRegion.get(id) ?? []}));
                // 手势跳不过没有位置的区域，Tab 会卡在那里：来源隐藏着（从活动栏拿起）时它的面板量不出来，不列。
                return regions.filter((region) => stopsOf(region).points.length > 0);
            },
            stops: stopsOf,
            // 从来源自己的位置开始，直接 Enter 不移动（输出 31）。
            start: (source, regions, origin) => {
                // 从标签拿起：原位是它自己。从活动栏拿起：区域就是活动栏，起点是条目，放回去也是原位（它在面板里的标签可能看不见：面板隐藏、头只写别的视图的标题）。
                const fromBar = origin.closest("[data-tool-entry]") !== null;
                const tab = source.kind === "tab" ? source.tab : "";
                const home = fromBar ? BAR_REGION : findTab(options.doc(), tab)?.panel;
                const region = Math.max(0, regions.findIndex((candidate) => candidate.id === home));
                const own = fromBar ? null : root.querySelector(`[data-panel-tab="${escape(tab)}"]`);
                return {region, at: centerOf(rectOf(own) ?? rectOf(origin) ?? {left: 0, top: 0, right: 0, bottom: 0})};
            },
            refocus: (source) => {
                const tab = source.kind === "tab" ? source.tab : "";
                return root.querySelector<HTMLElement>(`[data-panel-tab="${escape(tab)}"]`) ?? root.querySelector<HTMLElement>(`[data-tool-entry="${escape(viewIdOf(tab) ?? "")}"]`);
            },
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

    return {session, zones: () => frozenZones, live, fileDrop, dispose: () => {
        view?.removeEventListener("pointermove", onPointerSeen, true);
        view?.removeEventListener("pointerdown", onPointerSeen, true);
        session.dispose();
    }};
}
