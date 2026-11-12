/**
 * 活动栏上段的落点（docs/specs/ui/workbench-layout.md 输出 45、46）：指针算在哪个入口上或哪两个入口之间，放下去文档变成什么。纯函数，不碰 DOM；
 * 入口的矩形由 `layout-drag` 量好传进来。活动栏不是面板，不走库的落点规则：它是侧栏的入口条，结果是容器层面的（新建、并入、换序），库不知道容器的含义。
 *
 * 预览与提交用同一个函数（`applyEntryDrop`），差别只在放下时要不要显示侧栏、切到这个容器：预览里不切（输出 38，ADR 0046 决策 5）。
 * 预览不过 `settleContainers`，所以入口顺序在这里自己排好，不靠归整往后补。
 */

import {findTab, layoutDropKey, moveTabToEdge, sameLayoutShape, setActiveContainer, setContainerEntries, setPanelHidden} from "@notnotype/nb-layout";
import type {LayoutDoc, LayoutDropAction, LayoutPolicy, LayoutResult, LayoutSource} from "@notnotype/nb-layout";

import {regionAnchor, regionContainers, regionSections, sectionLanding} from "./state/containers";

/** 活动栏这条入口条的 id：键盘区域、实时布局的“吸收它的标签条”都用它。面板 id 是随机串或名字，撞不上。 */
export const BAR_STRIP = "activitybar";

/** 活动栏只是侧栏的入口条（第一步，右栏、底部面板的入口条在第二步）。 */
const REGION = "sidebar";

/** 拖的是一个含几个视图的入口（输出 46）：只能在入口条里换序。 */
export interface ContainerSource {
    readonly kind: "container";
    readonly container: string;
}

/** 工作台的一场拖动拖的是什么：文档里的标签或整个浮动窗（`LayoutSource`），或活动栏上的一个容器入口。 */
export type WorkbenchDragSource = LayoutSource | ContainerSource;

/**
 * 活动栏上段的落点。入口之间的位置写成“排在哪个容器的入口前面”（`before`，null 是最后），不写下标：锚的入口顺序里还留着没有成员的容器，
 * 来源收起之后量到的入口也少了它自己那一个，下标在这几份列表之间对不上。
 */
export type EntryDropAction =
    /** 新建一个只含来源的用户容器，入口排在这里（`container` 是这一场拖动起头时定的 id：落点每帧比较，不能每次判定都换）。 */
    | {readonly kind: "new-container"; readonly container: string; readonly before: string | null}
    /** 并入这个容器，成为它最后一个分节。 */
    | {readonly kind: "join-container"; readonly container: string}
    /** 只给这个容器的入口换位置：容器、显隐与当前容器都不变。 */
    | {readonly kind: "move-entry"; readonly container: string; readonly before: string | null};

export type WorkbenchDropAction = LayoutDropAction | EntryDropAction;

export const isEntryAction = (action: WorkbenchDropAction): action is EntryDropAction => action.kind === "new-container" || action.kind === "join-container" || action.kind === "move-entry";

/** 落点的比较键：库的落点按库的规则（浮动只看种类），入口的落点就是它的内容。 */
export const workbenchDropKey = (action: WorkbenchDropAction): string => (isEntryAction(action) ? JSON.stringify(action) : layoutDropKey(action));

/**
 * 这个落点算落在哪条标签条上（实时布局：标签条吸收来源，卡片收回）；不是标签条为 null。活动栏的入口之间是一条标签条（输出 38“标签条上”）；
 * 入口上不吸收（并入，入口高亮），和中央一样。
 */
export function dropStripOf(action: WorkbenchDropAction): string | null {
    if (action.kind === "strip") return action.panel;
    return action.kind === "new-container" || action.kind === "move-entry" ? BAR_STRIP : null;
}

/**
 * 这个落点在哪条标签条上，用来问“是不是来源自己的标签条”（实时布局：在自己的标签条里不收起来源）；不在标签条上为 null。
 * 和 `dropStripOf` 只差在入口上的并入：并入不吸收来源，但它也在活动栏上。来源是侧栏里一个容器唯一的视图时活动栏是它自己的入口条（输出 45），
 * 停在别的入口上也不算离开：收起来源的话它的入口跟着没了，下面的入口上移，被高亮的那个就滑离了指针。
 */
export const homeStripOf = (action: WorkbenchDropAction): string | null => (isEntryAction(action) ? BAR_STRIP : dropStripOf(action));

/** 量到的一个入口，从上到下。 */
export interface BarEntryRect {
    /** 容器 id。 */
    readonly container: string;
    readonly top: number;
    readonly bottom: number;
}

/** 指针在活动栏上段的哪：一个入口上，或两个入口之间（`before` 是下面那个入口的容器，null 是最后一个之后）。 */
export type BarSpot = {readonly kind: "gap"; readonly before: string | null} | {readonly kind: "entry"; readonly container: string};

/**
 * 入口中间这么大的一段（占入口高度的比例）算“入口上”，上下各剩的一段算它和邻居之间（输出 45）。Spec 没写比例：取一半，上下各四分之一，
 * 入口之间的空位（几像素的间距）加上两边各四分之一个入口，和中间那段差不多好指。
 */
export const BAR_ENTRY_CORE = 0.5;

/** 指针纵坐标 `y` 在活动栏上段算哪（`entries` 是这一刻看得见的入口，从上到下）。`entries: false`：入口上也算空位（拖含几个视图的入口只能换序，输出 46），按入口的中线分上下。 */
export function barSpotAt(entries: ReadonlyArray<BarEntryRect>, y: number, options: {readonly entries: boolean}): BarSpot {
    if (options.entries) {
        const over = entries.find((entry) => {
            const margin = ((entry.bottom - entry.top) * (1 - BAR_ENTRY_CORE)) / 2;
            return y >= entry.top + margin && y < entry.bottom - margin;
        });
        if (over !== undefined) return {kind: "entry", container: over.container};
    }
    const next = entries.find((entry) => y < (entry.top + entry.bottom) / 2);
    return {kind: "gap", before: next?.container ?? null};
}

/** 键盘在活动栏上能停的点：每个空位一个（入口的上沿、最后一个的下面），`entries` 时每个入口的中点再一个；放回 `barSpotAt` 就是这个位置。 */
export function barStopsOf(entries: ReadonlyArray<BarEntryRect>, bandBottom: number, options: {readonly entries: boolean}): ReadonlyArray<number> {
    const stops = entries.flatMap((entry) => (options.entries ? [entry.top + 1, (entry.top + entry.bottom) / 2] : [entry.top + 1]));
    const last = entries.at(-1);
    return [...stops, Math.min(bandBottom - 1, (last?.bottom ?? 0) + 1)];
}

/**
 * 来源是侧栏里一个容器唯一的视图时是那个容器（输出 45）：落在入口之间只是给它换位置，它的入口条就是活动栏（实时布局里是“自己的标签条”）。
 */
export function soleSidebarContainer(doc: LayoutDoc, source: WorkbenchDragSource): string | null {
    if (source.kind !== "tab") return null;
    const panel = findTab(doc, source.tab)?.panel;
    const owner = regionSections(doc, REGION).find((section) => section.panel === panel)?.container;
    const members = owner === undefined ? undefined : regionContainers(doc, REGION).find((container) => container.id === owner);
    return members !== undefined && members.sections.length === 1 ? members.id : null;
}

/** 活动栏上的指针位置换成落点；放不进时 null。`newContainer` 是这一场新建容器要用的 id。 */
export function entryDropAt(doc: LayoutDoc, source: WorkbenchDragSource, spot: BarSpot, newContainer: string): EntryDropAction | null {
    if (source.kind === "container") return spot.kind === "gap" ? {kind: "move-entry", container: source.container, before: spot.before} : null;
    if (source.kind !== "tab") return null;
    if (spot.kind === "entry") return {kind: "join-container", container: spot.container};
    const sole = soleSidebarContainer(doc, source);
    return sole === null ? {kind: "new-container", container: newContainer, before: spot.before} : {kind: "move-entry", container: sole, before: spot.before};
}

const failure = (detail: string): LayoutResult => ({ok: false, code: "rejected", detail});

/** 入口顺序里把 `container` 放到 `before` 前面（`before` 不在里面、或是 null 时放最后）。`before` 是它自己时不动。 */
function placeEntry(entries: ReadonlyArray<string>, container: string, before: string | null): ReadonlyArray<string> {
    if (before === container) return entries.includes(container) ? entries : [...entries, container];
    const rest = entries.filter((id) => id !== container);
    const at = before === null ? -1 : rest.indexOf(before);
    return at < 0 ? [...rest, container] : [...rest.slice(0, at), container, ...rest.slice(at)];
}

/**
 * 活动栏上段的落点放下去（`commit`）或预览的文档。`commit` 时侧栏显示（清掉隐藏与拖到零）并切到这个容器；预览不切（输出 38）。换序只改入口顺序。
 * 结果和现状一样时返回原对象（输出 28）：连着几步库操作，每一步都返回新对象，最后再比一次。
 */
export function applyEntryDrop(doc: LayoutDoc, source: WorkbenchDragSource, action: EntryDropAction, policy: LayoutPolicy, options: {readonly commit: boolean}): LayoutResult {
    const anchor = regionAnchor(doc, REGION);
    if (anchor === null) return failure("侧栏不用容器");
    let next = doc;
    const run = (step: (current: LayoutDoc) => LayoutResult): LayoutResult | null => {
        const result = step(next);
        if (!result.ok) return result;
        next = result.doc;
        return null;
    };
    if (action.kind === "move-entry") {
        // 看得见的入口顺序不变就是原处（输出 28）：紧挨着它的两个空位。锚的入口顺序里还夹着没有成员的容器，不能按整份入口顺序比。
        const shown = regionContainers(doc, REGION).map((container) => container.id);
        if (JSON.stringify(placeEntry(shown, action.container, action.before)) === JSON.stringify(shown)) return {ok: true, doc};
        const failed = run((current) => setContainerEntries(current, anchor, placeEntry(current.panels[anchor]?.entries ?? [], action.container, action.before)));
        if (failed !== null) return failed;
        return {ok: true, doc: sameLayoutShape(doc, next) ? doc : next};
    }
    if (source.kind !== "tab") return failure("活动栏的入口上只收视图");
    const own = soleSidebarContainer(doc, source);
    // 落在它自己唯一视图所在的入口上：原处（输出 45），不切也不展开。
    if (action.kind === "join-container" && own === action.container) return {ok: true, doc};
    const members = regionSections(doc, REGION).filter((section) => section.container === action.container);
    const alreadyLast = action.kind === "join-container" && members.at(-1)?.panel === findTab(doc, source.tab)?.panel;
    if (!alreadyLast) {
        const target = sectionLanding(next, REGION, action.container);
        if (target === null) return failure("侧栏不用容器");
        const failed = run((current) => moveTabToEdge(current, {tab: source.tab, target, container: action.container}, policy));
        if (failed !== null) return failed;
    }
    if (action.kind === "new-container") {
        const failed = run((current) => setContainerEntries(current, anchor, placeEntry(current.panels[anchor]?.entries ?? [], action.container, action.before)));
        if (failed !== null) return failed;
    }
    if (options.commit) {
        const failed = run((current) => setPanelHidden(current, anchor, false)) ?? run((current) => setActiveContainer(current, anchor, action.container));
        if (failed !== null) return failed;
    }
    return {ok: true, doc: sameLayoutShape(doc, next) ? doc : next};
}
