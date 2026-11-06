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

import {applyLayoutDrop, enumerateDropCandidates, findTab, previewEdgeDrop, previewRevealRects, resolveLayoutDrop, sourceTabs, tabKey, treeLeaves} from "@notnotype/nb-layout";
import type {GridDropPoint, GridDropRect, GridExtent, GridOrientation, LayoutDoc, LayoutDropAction, LayoutDropCandidate, LayoutDropPanelGeometry, LayoutPolicy, LayoutProjectionOptions, LayoutSource, TabRef} from "@notnotype/nb-layout";
import {createDragSession} from "@notnotype/nb-layout/vue";
import type {DragSession} from "@notnotype/nb-layout/vue";

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

export interface LayoutDragDrop {
    readonly action: LayoutDropAction;
    /** 编辑组标签条的分区（`EditorTabInsertion.part`）。 */
    readonly part?: string;
    /** 放下去和现在一样（输出 28）：只显示“原位”，不提交。 */
    readonly inPlace: boolean;
    readonly preview: LayoutDropPreview;
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
    commit(source: LayoutTabSource, action: LayoutDropAction, part: string | undefined): void;
}

export interface LayoutDrag {
    readonly session: DragSession<LayoutTabSource, LayoutDragDrop>;
    /** 这一场浮出的预备区。 */
    zones(): ReadonlyArray<LayoutRevealZone>;
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

/** 这块标签条的插入位：按看得见的标签的中线分，收进“更多”的排在最后一个看得见的后面。 */
function insertionIn(strip: Element, doc: LayoutDoc, panel: string, point: GridDropPoint): number {
    const tabs = doc.panels[panel]?.tabs.map(tabKey) ?? [];
    const shown = [...strip.querySelectorAll<HTMLElement>("[data-panel-tab]")];
    for (const element of shown) {
        const {left, right} = element.getBoundingClientRect();
        if (point.x < (left + right) / 2) {
            const at = tabs.indexOf(element.dataset.panelTab ?? "");
            if (at >= 0) return at;
        }
    }
    const last = shown.at(-1)?.dataset.panelTab;
    const at = last === undefined ? -1 : tabs.indexOf(last);
    return at < 0 ? tabs.length : at + 1;
}

export function createLayoutDrag(options: LayoutDragOptions): LayoutDrag {
    const {root} = options;
    const surface = (): HTMLElement | null => root.querySelector("[data-workbench-surface]");
    let frozenZones: ReadonlyArray<LayoutRevealZone> = [];
    /** 同一个落点的预览只算一次：判定每次指针移动都跑。键里带着容器尺寸：一场里窗口变了，矩形要重算（输出 32）。 */
    const previews = new Map<string, LayoutDragDrop>();
    /** 预览是按这份文档算的：一场拖动中文档被命令改了（快捷键移动视图），缓存作废。 */
    let previewsOf: LayoutDoc | null = null;

    const dpr = (): number => root.ownerDocument.defaultView?.devicePixelRatio ?? 1;
    const tabElement = (tab: TabRef | undefined): Element | null => (tab === undefined ? null : root.querySelector(`[data-panel-tab="${escape(tabKey(tab))}"]`));

    function panelGeometry(doc: LayoutDoc): LayoutDropPanelGeometry[] {
        const maximized = options.maximized();
        return treeLeaves(doc.tree.root).flatMap((leaf): LayoutDropPanelGeometry[] => {
            if (doc.panels[leaf.id] === undefined || (maximized !== null && maximized !== leaf.id)) return [];
            // 拖到零的面板，卡片还停在最后的非零尺寸（内容不重排），量的是外框。
            if (rectOf(root.querySelector(`[data-leaf="${escape(leaf.id)}"]`)) === null) return [];
            const card = rectOf(root.querySelector(`[data-shell-card="${escape(leaf.id)}"]`));
            if (card === null) return [];
            // 编辑组的标签条在它自己的内容里，插入位由编辑器量（`editorStripDrop`）。
            const editor = doc.panels[leaf.id]?.role === "editor";
            const head = root.querySelector(editor ? `[data-panel-strip="${escape(leaf.id)}"]` : `[data-panel-head="${escape(leaf.id)}"]`);
            const strip = rectOf(head);
            return [{
                id: leaf.id,
                body: strip === null ? card : {...card, top: strip.bottom},
                strip,
                ...(head === null || editor ? {} : {insertionAt: (point: GridDropPoint) => insertionIn(head, doc, leaf.id, point)}),
            }];
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
        return {action, inPlace: result.doc === doc, preview: {areaRect: null, indicator: {left: band.left + 6, right: band.right - 6, top: y - 1, bottom: y + 1}, orientation: "vertical"}};
    }

    /** 键盘在活动栏上的停靠点：每个 `sidebar` 条目的上方，和最后一个的下方。 */
    function barStops(band: GridDropRect): ReadonlyArray<GridDropPoint> {
        const x = (band.left + band.right) / 2;
        const entries = sidebarEntries(options.doc()).map((entry) => entry.getBoundingClientRect());
        const last = entries.at(-1);
        return [...entries.map((box) => ({x, y: box.top + 1})), {x, y: Math.min(band.bottom - 1, (last?.bottom ?? band.top) + 1)}];
    }

    function previewOf(doc: LayoutDoc, source: LayoutTabSource, action: LayoutDropAction, inPlace: boolean, panels: ReadonlyArray<LayoutDropPanelGeometry>, point: GridDropPoint): LayoutDropPreview {
        const none: LayoutDropPreview = {areaRect: null, indicator: null, orientation: "horizontal"};
        if (inPlace) {
            const home = findTab(doc, source.tab)?.panel;
            return {...none, areaRect: panels.find((geometry) => geometry.id === home)?.body ?? null};
        }
        switch (action.kind) {
            case "strip": {
                const strip = panels.find((geometry) => geometry.id === action.panel)?.strip ?? null;
                if (strip === null) return none;
                const tabs = doc.panels[action.panel]?.tabs ?? [];
                const element = tabElement(tabs[action.index]);
                const before = tabElement(tabs[action.index - 1]);
                const x = element?.getBoundingClientRect().left ?? before?.getBoundingClientRect().right ?? strip.left + 8;
                return {...none, indicator: {left: x - 1, right: x + 1, top: strip.top + 4, bottom: strip.bottom - 4}, orientation: "horizontal"};
            }
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

    /** 编辑器标签进编辑组的标签条：多行、固定分区只有编辑器知道，位置、原位和插入线都由它量。 */
    function editorStripDrop(source: LayoutTabSource, panel: string, point: GridDropPoint): LayoutDragDrop | null {
        const tabId = editorTabIdOf(source.tab);
        const measured = tabId === null ? null : (options.editorTabs()?.insertion(panel, point, tabId) ?? null);
        if (measured === null) return null;
        return {action: {kind: "strip", panel, index: measured.index}, part: measured.part, inPlace: measured.inPlace, preview: {areaRect: null, indicator: measured.indicator, orientation: "horizontal"}};
    }

    function dropAt(source: LayoutTabSource, point: GridDropPoint, region: KeyboardRegion | null): LayoutDragDrop | null {
        const doc = options.doc();
        const band = rectOf(toolBand());
        if (band !== null && contains(band, point)) return barDrop(source, point, band);
        if (doc !== previewsOf) {
            previewsOf = doc;
            previews.clear();
        }
        const panels = panelGeometry(doc);
        // 键盘的区域是明确选的，不按坐标判预备区：编辑组的外缘候选就在预备区底下。
        const zones = region === null ? frozenZones.map((zone) => ({panel: zone.panel, rect: zone.rect})) : [];
        // 键盘停在预备区上就是它：预备区可能叠在真实落点上，按坐标会落到下面去。
        const resolved = region?.id.startsWith("reveal:") === true
            ? ({kind: "reveal", panel: region.id.slice("reveal:".length)} as const)
            : resolveLayoutDrop({doc, source, point, panels, excluded: excludedRects(), zones, policy: options.policy()});
        if (resolved === null) return null;
        if (resolved.kind === "strip" && doc.panels[resolved.panel]?.role === "editor") return editorStripDrop(source, resolved.panel, point);
        // 头只写标题的面板没有插入位：落在标题上就是添加为标签。
        const action: LayoutDropAction = resolved.kind === "strip" && options.titleOnly(resolved.panel) ? {kind: "center", panel: resolved.panel} : resolved;
        const key = JSON.stringify([source, action, options.extent()]);
        const cached = previews.get(key);
        if (cached !== undefined) return cached;
        const result = applyLayoutDrop(doc, source, action, options.policy());
        if (!result.ok) return null;
        const inPlace = result.doc === doc;
        const drop = {action, inPlace, preview: previewOf(doc, source, action, inPlace, panels, point)};
        previews.set(key, drop);
        return drop;
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
        if (action.kind === "strip") {
            if (geometry.strip === null) return null;
            const tabs = doc.panels[panelId]?.tabs ?? [];
            // 纵向取标签自己的中线：编辑组的标签条可能有几行。
            const box = tabElement(tabs[action.index])?.getBoundingClientRect();
            if (box !== undefined) return {x: box.left + 1, y: (box.top + box.bottom) / 2};
            const before = tabElement(tabs[action.index - 1])?.getBoundingClientRect();
            return {x: (before?.right ?? geometry.strip.left) + 1, y: before === undefined ? (geometry.strip.top + geometry.strip.bottom) / 2 : (before.top + before.bottom) / 2};
        }
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
        activate: (source) => {
            frozenZones = revealZones(source);
            previews.clear();
            return true;
        },
        structure: () => JSON.stringify([layoutStructureKey(options.doc()), options.editorTabs()?.structure() ?? null]),
        resolve: ({source, point, top, region}) => {
            // 被菜单、对话框挡住的、按钮区都不接收；键盘没有指针下的元素。
            if (region === null && (top === null || !root.contains(top) || top.closest("[data-no-drag]") !== null)) return null;
            return dropAt(source, point, region);
        },
        actionKey: (drop) => (drop.inPlace ? null : JSON.stringify([drop.action, drop.part ?? null])),
        commit: (drop, source) => options.commit(source, drop.action, drop.part),
        // 拖动中的光标与禁选在全局样式里按这个标记生效。
        onActiveChange: (active) => root.ownerDocument.documentElement.toggleAttribute("data-workbench-dragging", active),
        keyboard: {
            // 焦点要在拖动源本身：标签或条目；面板头里别的控件保留自己的空格。
            sourceAt: (target) => (target.matches("[data-panel-tab], [data-tool-entry]") ? sourceAt(target) : null),
            regions: (source) => {
                const doc = options.doc();
                const candidates = enumerateDropCandidates({
                    doc,
                    source,
                    policy: options.policy(),
                    // 工具面板的标签可能收进“更多”，只算看得见的；编辑组的标签条多行时都看得见。
                    stripCount: (panel) => (options.titleOnly(panel) ? 0 : (doc.panels[panel]?.role === "editor" ? doc.panels[panel].tabs.length : root.querySelectorAll(`[data-panel-head="${escape(panel)}"] [data-panel-tab]`).length) + 1),
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
                const home = findTab(options.doc(), source.tab)?.panel;
                const region = Math.max(0, regions.findIndex((candidate) => candidate.id === home));
                // 从标签拿起：原位是它自己。从活动栏拿起：它在面板里的标签可能看不见（面板隐藏、头只写别的视图的标题），起点就是条目，放回去也是原位。
                const own = origin.closest("[data-tool-entry]") === null ? root.querySelector(`[data-panel-tab="${escape(source.tab)}"]`) : null;
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

    return {session, zones: () => frozenZones, dispose: () => session.dispose()};
}
