/**
 * 一棵树的拖放里判定用的几何与标签条里排序的位移（docs/specs/ui/workbench-layout.md 输出 25、38）：类型与纯计算，不读 DOM。
 * 量 DOM 的在 `layout-drag`：它把量到的矩形交给这里，这里按文档与投影换算。坐标都是视口坐标，除了浮动窗的矩形（相对树区域）。
 */

import {previewPanelRects, projectLayoutDoc, rectContains, tabKey, treeLeaves} from "@notnotype/nb-workbench-layout";
import type {GridDropPoint, GridDropRect, GridExtent} from "@notnotype/nb-layout";
import type {LayoutDoc, LayoutDropPanelGeometry, LayoutFloatRect, LayoutProjectionOptions, PanelName} from "@notnotype/nb-workbench-layout";
import {translateTabStrip} from "@notnotype/nb-workbench-layout/vue";
import type {TabStripHeld, TabStripSnapshot} from "@notnotype/nb-workbench-layout/vue";

import {entryStripOf} from "./entry-drop";
import type {BarEntryRect} from "./entry-drop";
import {regionContainers} from "./state/containers";
import {keepVisible} from "./state/layout-constraints";

/** 一次判定要的矩形。 */
export interface DragGeometry {
    readonly panels: ReadonlyArray<LayoutDropPanelGeometry>;
    /** 浮动窗，上面的在前。整窗拖动时它自己不算。 */
    readonly floats: ReadonlyArray<LayoutDropPanelGeometry>;
    /** 条与标题栏：不是落点（规则 1）。 */
    readonly excluded: ReadonlyArray<GridDropRect>;
    /** 三条入口条，看得见的才有。 */
    readonly bands: ReadonlyArray<EntryBand>;
    /** 树区域的左上角。 */
    readonly origin: GridDropPoint;
}

/** 一条入口条在判定里的样子：侧轨的入口带（活动栏、右轨）竖着排，底部面板的入口条横着排。 */
export interface EntryBand {
    readonly region: PanelName;
    readonly axis: "x" | "y";
    /** 整条：活动栏是上段，入口条是卡片顶上那一行。 */
    readonly row: GridDropRect;
    /** 入口这一组（含“更多”）的末端，沿入口条的方向。 */
    readonly groupEnd: number;
    /** 并进这一行的那一节；没有是 null。 */
    readonly merged: string | null;
    /** 是落点的那一段：整条；并进来了一节时只到入口这一组为止，后面那段头是那一节的标题行。 */
    readonly rect: GridDropRect;
    /** 看得见的入口，沿入口条的方向；收进“更多”的不在 DOM 里。 */
    readonly entries: ReadonlyArray<BarEntryRect>;
}

/** 实时布局判定用的矩形：拿起后量一次，收起与展开来源时换一份。 */
export interface FrozenGeometry {
    readonly geometry: DragGeometry;
    readonly strips: ReadonlyMap<string, TabStripSnapshot>;
    /** 被拖的标签拿起时的宽度与按下的点占它的比例：在标签条里跟手时判定按它的前缘（输出 38“标签条上”）。量不到（键盘、没有按下的点）是 null，按指针判。 */
    readonly heldTab: TabStripHeld | null;
}

/** 整窗拖动：抓住的点相对窗的偏移；窗拿起时呈现的位置与大小（夹位置用）；记录里的大小（提交用：夹取不写回）。 */
export interface WindowDrag {
    readonly panel: string;
    readonly grab: GridDropPoint;
    readonly origin: GridDropPoint;
    readonly from: GridDropPoint;
    readonly shown: GridExtent;
    readonly size: GridExtent;
}

/** 收起前后一块面板的四条边各挪了多少。 */
type EdgeMoves = {readonly left: number; readonly top: number; readonly right: number; readonly bottom: number};

export const offset = (rect: GridDropRect, by: GridDropPoint): GridDropRect => ({left: rect.left + by.x, top: rect.top + by.y, right: rect.right + by.x, bottom: rect.bottom + by.y});
export const centerOf = (rect: GridDropRect): GridDropPoint => ({x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2});

/**
 * 来源收起之后判定用的几何（输出 38）：按收起后的文档算每块面板挪到哪，不读 DOM，预览怎么摆都不变，判定和预览不会互相牵着来回换。
 * 拿起时量的卡片、头、标签条和面板之间的内外边距不变，所以每块面板按它在两份文档里的矩形差平移、伸缩。收起后不在的面板（来源是它最后一个标签）不再是落点；
 * 回到原处时引擎换回拿起时的几何（nb-layout 的实时布局）。容器还没量到（`extent` 为 null）时照旧用拿起时的。
 */
export function collapsedGeometry(kept: FrozenGeometry, doc: LayoutDoc, base: LayoutDoc, layout: {readonly extent: GridExtent | null; readonly projection: LayoutProjectionOptions; readonly dpr: number}): FrozenGeometry {
    const {extent, projection, dpr} = layout;
    if (extent === null) return kept;
    // 入口条叶与右轨叶只在呈现里，不在文档的树里：按投影一起量（入口条跟着区域挪、缩没了；右栏空了右轨也不在）。活动栏是条，一直在。
    const stripLeaves = kept.geometry.bands.flatMap((band) => (band.region === "sidebar" ? [] : [entryStripOf(band.region)]));
    const ids = [...treeLeaves(doc.tree.root).map((leaf) => leaf.id), ...stripLeaves];
    const before = previewPanelRects(doc, ids, projection, extent, dpr);
    const after = previewPanelRects(base, ids, projection, extent, dpr);
    // 收起后哪一节并进了入口条（同一个容器剩一节时并进来，第一轮第 2 条后半）：按收起后的投影，不按拿起时的头。
    const mergedAfter = new Map(projectLayoutDoc(base, projection).strips.map((strip) => [strip.region, strip.merged] as const));
    const moves = new Map<string, EdgeMoves>();
    for (const id of ids) {
        const from = before[id];
        const to = after[id];
        if (from !== undefined && to !== undefined) moves.set(id, {left: to.left - from.left, top: to.top - from.top, right: to.right - from.right, bottom: to.bottom - from.bottom});
    }
    const bands = bandsAfterCollapse(kept.geometry.bands, base, moves, mergedAfter);
    const panels = kept.geometry.panels.flatMap((item) => {
        const move = moves.get(item.id);
        if (move === undefined) return [];
        const across = (rect: GridDropRect): GridDropRect => ({...rect, left: rect.left + move.left, right: rect.right + move.right});
        // 收起后头在入口条里的那一节：头是入口之后那一段，正文是它整张卡片，外框是两者的并集（拿起时头在它自己叶里的，不平移旧的头）。
        const band = bands.find((candidate) => candidate.merged === item.id);
        if (band !== undefined) {
            // 它的卡片：拿起时就并着的，正文就是卡片；拿起时头在自己叶里的，外框是卡片（正文在头下面），收起后头搬走了，正文是整张卡片。
            const wasMerged = kept.geometry.bands.some((candidate) => candidate.merged === item.id);
            const card = wasMerged || item.frame === undefined ? item.body : item.frame;
            const top = card.top + move.top;
            const body = {...across(card), top, bottom: Math.max(top, card.bottom + move.bottom)};
            const strip = {left: band.groupEnd, right: band.row.right, top: band.row.top, bottom: band.row.bottom};
            return [{...item, body, strip, frame: {left: Math.min(band.row.left, body.left), top: band.row.top, right: Math.max(band.row.right, body.right), bottom: body.bottom}}];
        }
        // 头的高度不变：标签条跟着上沿走；正文的下沿跟着下沿走。
        const strip = item.strip === null ? null : {...across(item.strip), top: item.strip.top + move.top, bottom: item.strip.bottom + move.top};
        const bodyTop = item.body.top + move.top;
        const body = {...across(item.body), top: bodyTop, bottom: Math.max(bodyTop, item.body.bottom + move.bottom)};
        const frame = item.frame === undefined ? undefined : {...across(item.frame), top: item.frame.top + move.top, bottom: Math.max(item.frame.top + move.top, item.frame.bottom + move.bottom)};
        return [{...item, body, strip, ...(frame === undefined ? {} : {frame})}];
    });
    const strips = new Map([...kept.strips].flatMap(([id, snapshot]) => {
        const move = moves.get(id);
        if (move === undefined) return base.floats.some((float) => float.panel === id) ? [[id, snapshot] as const] : [];
        return [[id, translateTabStrip(snapshot, {x: move.left, y: move.top}, move.right - move.left)] as const];
    }));
    const floats = kept.geometry.floats.filter((item) => base.floats.some((float) => float.panel === item.id));
    return {geometry: {...kept.geometry, panels, floats, bands}, strips, heldTab: kept.heldTab};
}

/**
 * 来源收起之后的入口条（输出 38）。来源是它容器唯一的成员时那个入口没了，后面的都往前补一格（一格是这个入口到下一个入口的距离，最后一个是它自己的长度）；
 * 入口还在的不动：容器少一个分节，入口不变。底部面板的入口条跟着它的入口条叶挪、右轨跟着右轨叶挪；区域里的分节都收走了、叶不在了，这条就不是落点；
 * 收起后并进来了一节（`mergedAfter`），落点那一段只到入口这一组为止（只有横着排的入口条会并）。
 */
export function bandsAfterCollapse(kept: ReadonlyArray<EntryBand>, base: LayoutDoc, moves: ReadonlyMap<string, EdgeMoves>, mergedAfter: ReadonlyMap<PanelName, string | null>): ReadonlyArray<EntryBand> {
    return kept.flatMap((band): EntryBand[] => {
        const present = new Set(regionContainers(base, band.region).map((container) => container.id));
        let shift = 0;
        const entries = band.entries.flatMap((entry, index) => {
            if (!present.has(entry.container)) {
                shift += (band.entries[index + 1]?.start ?? entry.end) - entry.start;
                return [];
            }
            return [shift === 0 ? entry : {...entry, start: entry.start - shift, end: entry.end - shift}];
        });
        if (band.region === "sidebar") return [{...band, entries}];
        const move = moves.get(entryStripOf(band.region));
        if (move === undefined) return [];
        if (band.axis === "y") {
            // 右轨：竖着排，整条挪，入口沿纵轴跟着上沿挪。
            const row = {left: band.row.left + move.left, right: band.row.right + move.right, top: band.row.top + move.top, bottom: band.row.bottom + move.bottom};
            return [{...band, row, rect: row, groupEnd: band.groupEnd + move.top - shift, entries: entries.map((entry) => ({...entry, start: entry.start + move.top, end: entry.end + move.top}))}];
        }
        const row = {left: band.row.left + move.left, right: band.row.right + move.right, top: band.row.top + move.top, bottom: band.row.bottom + move.top};
        const groupEnd = band.groupEnd + move.left - shift;
        const merged = mergedAfter.get(band.region) ?? null;
        return [{...band, row, groupEnd, merged, rect: merged === null ? row : {...row, right: groupEnd}, entries: entries.map((entry) => ({...entry, start: entry.start + move.left, end: entry.end + move.left}))}];
    });
}

/**
 * 被拖的标签在标签条里跟手时怎么判（`rect` 是它拿起时的矩形）：宽度取它拿起时量到的，按下的点在它上面的比例。
 * 拖到别的标签条里它画出来的宽度可能不同（只写标题的头换成标签），判定仍按拿起时的宽度：只差在离两端很近的那一点。
 * 只认按下的点落在里面的那个矩形：从活动栏拖入口时同一个视图的标题在侧栏里，按下的点不在它上面，量它会把抓点夹成 0。
 * 这时是 null，判定按指针，抓点照旧在第一次排序时定（`sortedOffset`）。
 */
export function heldTabIn(rect: GridDropRect | null, pressedAt: GridDropPoint): TabStripHeld | null {
    const width = rect === null ? 0 : rect.right - rect.left;
    if (rect === null || width <= 0 || !rectContains(rect, pressedAt)) return null;
    return {width, grab: (pressedAt.x - rect.left) / width};
}

/**
 * 这个位置在文档里是第几个：量出来的是邻居，收进“更多”的标签不在 DOM 里，下标要按文档算。分区末尾插在它最后一个看得见的标签之后。
 */
export function stripIndex(doc: LayoutDoc, panel: string, measured: {readonly before: string | null; readonly after: string | null}): number {
    const tabs = doc.panels[panel]?.tabs.map(tabKey) ?? [];
    if (measured.before !== null) return tabs.indexOf(measured.before);
    return measured.after !== null ? tabs.indexOf(measured.after) + 1 : tabs.length;
}

/** 整窗此刻的矩形（相对树区域）：抓住的点在指针下，位置按呈现的大小夹，大小还是记录里的。 */
export function windowRect(drag: WindowDrag, point: GridDropPoint, extent: GridExtent | null): LayoutFloatRect {
    const at = {x: point.x - drag.origin.x, y: point.y - drag.origin.y};
    const {x, y} = keepVisible({x: at.x - drag.grab.x, y: at.y - drag.grab.y, ...drag.shown}, extent);
    return {x, y, ...drag.size};
}

/**
 * 标签条里排序时被拖的标签写多少位移（输出 38“标签条上”）：沿条跟着指针，抓住的点在指针下，夹在条的两端之间。
 * `rect` 是它此刻画出来的矩形，`translate` 是此刻写在它上面的位移（Vue 重渲染可能整个换掉 style，所以按元素上的值算，不按记下的）。
 * `grab` 是这一场已经定下的抓点；null 时按此刻指针在它上面的比例定，交回去由调用方记下。
 * 位移写成浏览器读回来的同一个样子（只有横向时省掉 y）：调用方按字符串比较，对不上才重写，不然每帧都重写。
 */
export function sortedOffset(input: {
    readonly rect: {readonly left: number; readonly top: number; readonly width: number; readonly height: number};
    readonly translate: string;
    readonly bounds: GridDropRect;
    readonly vertical: boolean;
    readonly point: GridDropPoint;
    readonly grab: number | null;
}): {readonly grab: number; readonly translate: string} {
    const {rect, bounds, vertical, point} = input;
    const written = input.translate.split(" ").map((part) => Number.parseFloat(part));
    const along0 = vertical ? written[1] : written[0];
    const shifted = along0 !== undefined && Number.isFinite(along0) ? along0 : 0;
    const size = vertical ? rect.height : rect.width;
    const resting = (vertical ? rect.top : rect.left) - shifted;
    const along = vertical ? point.y : point.x;
    const grab = input.grab ?? (size > 0 ? Math.min(1, Math.max(0, (along - resting) / size)) : 0.5);
    const [start, end] = vertical ? [bounds.top, bounds.bottom] : [bounds.left, bounds.right];
    const wanted = Math.min(Math.max(along - grab * size, start), Math.max(start, end - size));
    const next = Math.round((wanted - resting) * 100) / 100;
    return {grab, translate: vertical ? `0px ${String(next)}px` : `${String(next)}px`};
}
