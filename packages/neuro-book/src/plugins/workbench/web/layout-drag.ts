/**
 * 一棵树的拖放（docs/specs/ui/workbench-layout.md 输出 24 到 32）：手势是 nb-layout 的拖动会话，落点规则是 `resolveLayoutDrop`，这里读 DOM 给它矩形，把结果换成反馈要画的东西。
 *
 * 拖动源：视图标签（`data-panel-tab`）、活动栏条目（`data-tool-entry`）、面板头的空白处（`data-panel-head`）。`data-no-drag` 里的按钮既不起拖也不接收，被菜单、对话框挡住的不接收。
 *
 * 判定是纯读：预览用提交时的同一个函数（`applyLayoutDrop`）算，放回原处的落点只显示、不提交。结构键变了整场取消（输出 32），放下时提交再验一次接受矩阵（领域操作自己验）。
 */

import {applyLayoutDrop, enumerateDropCandidates, findTab, previewEdgeDrop, previewRevealRect, resolveLayoutDrop, tabKey, treeLeaves} from "@notnotype/nb-layout";
import type {GridDropPoint, GridDropRect, GridExtent, GridOrientation, LayoutDoc, LayoutDropAction, LayoutDropCandidate, LayoutDropPanelGeometry, LayoutPolicy, LayoutProjectionOptions, LayoutSource} from "@notnotype/nb-layout";
import {createDragSession} from "@notnotype/nb-layout/vue";
import type {DragSession} from "@notnotype/nb-layout/vue";

import {layoutStructureKey, viewIdOf} from "./state/layout-present";
import type {ViewCatalog} from "./views/placement";

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
    commit(source: LayoutSource, action: LayoutDropAction): void;
}

export interface LayoutDrag {
    readonly session: DragSession<LayoutSource, LayoutDragDrop>;
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

    function panelGeometry(doc: LayoutDoc): LayoutDropPanelGeometry[] {
        const maximized = options.maximized();
        return treeLeaves(doc.tree.root).flatMap((leaf): LayoutDropPanelGeometry[] => {
            if (doc.panels[leaf.id] === undefined || (maximized !== null && maximized !== leaf.id)) return [];
            // 拖到零的面板，卡片还停在最后的非零尺寸（内容不重排），量的是外框。
            if (rectOf(root.querySelector(`[data-leaf="${escape(leaf.id)}"]`)) === null) return [];
            const card = rectOf(root.querySelector(`[data-shell-card="${escape(leaf.id)}"]`));
            if (card === null) return [];
            const head = root.querySelector(`[data-panel-head="${escape(leaf.id)}"]`);
            const strip = rectOf(head);
            return [{
                id: leaf.id,
                body: strip === null ? card : {...card, top: strip.bottom},
                strip,
                ...(head === null ? {} : {insertionAt: (point: GridDropPoint) => insertionIn(head, doc, leaf.id, point)}),
            }];
        });
    }

    /** 条与标题栏不是落点（规则 1）。 */
    function excludedRects(): GridDropRect[] {
        const rects = [root.querySelector("[data-shell-card='activitybar']"), root.querySelector("[data-leaf='statusbar']"), root.querySelector("[data-shell-titlebar]")];
        return rects.flatMap((element) => rectOf(element) ?? []);
    }

    /** 此刻没显示的具名面板显示出来会在的矩形（输出 29）。 */
    function revealZones(): ReadonlyArray<LayoutRevealZone> {
        const doc = options.doc();
        const extent = options.extent();
        const origin = surface()?.getBoundingClientRect();
        if (extent === null || origin === undefined || options.maximized() !== null) return [];
        return treeLeaves(doc.tree.root).flatMap((leaf): LayoutRevealZone[] => {
            const panel = doc.panels[leaf.id];
            // 隐藏的不在树里没有外框；拖到零的外框宽 0。收成标题行的还看得见，不算。
            if (panel?.name === undefined || rectOf(root.querySelector(`[data-leaf="${escape(leaf.id)}"]`)) !== null) return [];
            const rect = previewRevealRect(doc, leaf.id, options.projection(), extent, dpr());
            return rect === null ? [] : [{panel: leaf.id, rect: offset(rect, origin)}];
        });
    }

    function previewOf(doc: LayoutDoc, source: LayoutSource, action: LayoutDropAction, inPlace: boolean, panels: ReadonlyArray<LayoutDropPanelGeometry>, point: GridDropPoint): LayoutDropPreview {
        const none: LayoutDropPreview = {areaRect: null, indicator: null, orientation: "horizontal"};
        if (inPlace) {
            const home = source.kind === "panel" ? source.panel : findTab(doc, source.tab)?.panel;
            return {...none, areaRect: panels.find((geometry) => geometry.id === home)?.body ?? null};
        }
        switch (action.kind) {
            case "strip": {
                const strip = panels.find((geometry) => geometry.id === action.panel)?.strip ?? null;
                if (strip === null) return none;
                const tabs = doc.panels[action.panel]?.tabs ?? [];
                const next = tabs[action.index];
                const element = next === undefined ? null : root.querySelector(`[data-panel-head="${escape(action.panel)}"] [data-panel-tab="${escape(tabKey(next))}"]`);
                const previous = tabs[action.index - 1];
                const before = previous === undefined ? null : root.querySelector(`[data-panel-head="${escape(action.panel)}"] [data-panel-tab="${escape(tabKey(previous))}"]`);
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

    function dropAt(source: LayoutSource, point: GridDropPoint, region: KeyboardRegion | null): LayoutDragDrop | null {
        const doc = options.doc();
        if (doc !== previewsOf) {
            previewsOf = doc;
            previews.clear();
        }
        const panels = panelGeometry(doc);
        // 键盘的区域是明确选的，不按坐标判预备区：编辑组的外缘候选就在预备区底下。
        const zones = region === null ? frozenZones.map((zone) => ({panel: zone.panel, rect: zone.rect})) : [];
        // 键盘停在预备区上就是它：预备区可能叠在真实落点上，按坐标会落到下面去。
        const action = region?.id.startsWith("reveal:") === true
            ? ({kind: "reveal", panel: region.id.slice("reveal:".length)} as const)
            : resolveLayoutDrop({doc, source, point, panels, excluded: excludedRects(), zones, policy: options.policy()});
        if (action === null) return null;
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
            const next = tabs[action.index];
            const element = next === undefined ? null : root.querySelector(`[data-panel-head="${escape(panelId)}"] [data-panel-tab="${escape(tabKey(next))}"]`);
            const box = element?.getBoundingClientRect();
            const y = (geometry.strip.top + geometry.strip.bottom) / 2;
            if (box !== undefined) return {x: box.left + 1, y};
            const previous = tabs[action.index - 1];
            const before = previous === undefined ? null : root.querySelector(`[data-panel-head="${escape(panelId)}"] [data-panel-tab="${escape(tabKey(previous))}"]`);
            return {x: (before?.getBoundingClientRect().right ?? geometry.strip.left) + 1, y};
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
        const doc = options.doc();
        const panels = panelGeometry(doc);
        const points = region.candidates.flatMap((candidate) => pointOfCandidate(candidate, doc, panels) ?? []);
        if (points.length > 0 || region.candidates.length > 0) return {axis: "both", points};
        const body = panels.find((geometry) => geometry.id === region.id)?.body;
        return {axis: "both", points: body === undefined ? [] : [centerOf(body)]};
    }

    const fromElement = (element: Element): LayoutSource | null => {
        const entry = element.closest<HTMLElement>("[data-tool-entry]")?.dataset.toolEntry;
        if (entry !== undefined) return {kind: "tab", tab: tabKey({kind: "view", viewId: entry})};
        const tab = element.closest<HTMLElement>("[data-panel-tab]")?.dataset.panelTab;
        if (tab !== undefined) return {kind: "tab", tab};
        const panel = element.closest<HTMLElement>("[data-panel-head]")?.dataset.panelHead;
        return panel === undefined ? null : {kind: "panel", panel};
    };

    /** 声明 `movable: false` 的视图不起拖，整块面板里有它也不起拖：不出现“拿起了却落不下去”。 */
    function movable(source: LayoutSource): boolean {
        const doc = options.doc();
        const keys = source.kind === "tab" ? [source.tab] : (doc.panels[source.panel]?.tabs.map(tabKey) ?? []);
        if (source.kind === "tab" && findTab(doc, source.tab) === null) return false;
        return keys.every((key) => {
            const viewId = viewIdOf(key);
            return viewId === null || options.catalog().get(viewId)?.movable !== false;
        });
    }

    const sourceAt = (target: Element): LayoutSource | null => {
        if (!options.enabled() || target.closest("[data-no-drag]") !== null) return null;
        const source = fromElement(target);
        return source !== null && movable(source) ? source : null;
    };

    const session = createDragSession<LayoutSource, LayoutDragDrop, KeyboardRegion>({
        root,
        sourceAt,
        activate: () => {
            frozenZones = revealZones();
            previews.clear();
            return true;
        },
        structure: () => layoutStructureKey(options.doc()),
        resolve: ({source, point, top, region}) => {
            // 被菜单、对话框挡住的、按钮区都不接收；键盘没有指针下的元素。
            if (region === null && (top === null || !root.contains(top) || top.closest("[data-no-drag]") !== null)) return null;
            return dropAt(source, point, region);
        },
        actionKey: (drop) => (drop.inPlace ? null : JSON.stringify(drop.action)),
        commit: (drop, source) => options.commit(source, drop.action),
        // 拖动中的光标与禁选在全局样式里按这个标记生效。
        onActiveChange: (active) => root.ownerDocument.documentElement.toggleAttribute("data-workbench-dragging", active),
        keyboard: {
            // 焦点要在拖动源本身：标签、条目或面板头；面板头里别的控件保留自己的空格。
            sourceAt: (target) => (target.matches("[data-panel-tab], [data-tool-entry], [data-panel-head]") ? sourceAt(target) : null),
            regions: (source) => {
                const doc = options.doc();
                const candidates = enumerateDropCandidates({
                    doc,
                    source,
                    policy: options.policy(),
                    stripCount: (panel) => root.querySelectorAll(`[data-panel-head="${escape(panel)}"] [data-panel-tab]`).length + 1,
                    reveal: frozenZones.map((zone) => zone.panel),
                });
                const byRegion = new Map<string, LayoutDropCandidate[]>();
                for (const candidate of candidates) byRegion.set(candidate.region, [...(byRegion.get(candidate.region) ?? []), candidate]);
                // 按树序，预备区在后。来源所在的面板就算没有候选也要有一个区域：拿起时停在原位。
                const home = source.kind === "panel" ? source.panel : findTab(doc, source.tab)?.panel;
                const panels = treeLeaves(doc.tree.root).map((leaf) => leaf.id).filter((id) => byRegion.has(id) || id === home);
                const reveals = [...byRegion.keys()].filter((id) => id.startsWith("reveal:"));
                const regions = [...panels, ...reveals].map((id) => ({id, candidates: byRegion.get(id) ?? []}));
                // 手势跳不过没有位置的区域，Tab 会卡在那里：来源隐藏着（从活动栏拿起）时它的面板量不出来，不列。
                return regions.filter((region) => stopsOf(region).points.length > 0);
            },
            stops: stopsOf,
            // 从来源自己的位置开始，直接 Enter 不移动（输出 31）。
            start: (source, regions, origin) => {
                const doc = options.doc();
                const home = source.kind === "panel" ? source.panel : findTab(doc, source.tab)?.panel;
                const region = Math.max(0, regions.findIndex((candidate) => candidate.id === home));
                // 从活动栏拿起：原位是它在面板里的那个标签，提示“原位”；标签看不见（收进“更多”、面板隐藏）时就是条目自己，没有落点，Enter 同样不动。
                const own = source.kind === "tab" ? root.querySelector(`[data-panel-tab="${escape(source.tab)}"]`) : null;
                return {region, at: centerOf(rectOf(own) ?? rectOf(origin) ?? {left: 0, top: 0, right: 0, bottom: 0})};
            },
            refocus: (source) => {
                if (source.kind === "panel") return root.querySelector<HTMLElement>(`[data-panel-head="${escape(source.panel)}"]`);
                return root.querySelector<HTMLElement>(`[data-panel-tab="${escape(source.tab)}"]`)
                    ?? root.querySelector<HTMLElement>(`[data-tool-entry="${escape(viewIdOf(source.tab) ?? "")}"]`);
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

    return {session, zones: () => frozenZones, dispose: () => session.dispose()};
}
