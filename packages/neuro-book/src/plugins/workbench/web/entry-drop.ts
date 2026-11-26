/**
 * 入口条上的落点（docs/specs/ui/workbench-layout.md 输出 45、46、47）：活动栏上段是侧栏的入口条，右栏、底部面板的入口条在各自卡片顶上。
 * 指针算在哪个入口上或哪两个入口之间，放下去文档变成什么。纯函数，不碰 DOM；入口的矩形由 `layout-drag` 量好传进来。
 * 入口条不是面板，不走库的落点规则：结果是容器层面的（新建、并入、换序、整个容器搬过来），库不知道容器的含义。
 *
 * 预览与提交用同一个函数（`applyEntryDrop`），差别只在放下时要不要显示区域、切到这个容器：预览里不切（输出 38，ADR 0046 决策 5）。
 * 预览不过 `settleContainers`，所以入口顺序在这里自己排好，不靠归整往后补。
 */

import {findTab, layoutDropKey, moveTabToEdge, railLeafId, regionOfRailLeaf, regionOfStripLeaf, regionStripLeafId, sameLayoutShape, setActiveContainer, setContainerEntries, setPanelHidden} from "@notnotype/nb-workbench-layout";
import type {LayoutDoc, LayoutDropAction, LayoutPolicy, LayoutResult, LayoutSource, PanelName} from "@notnotype/nb-workbench-layout";

import {VIEW_LOCATIONS} from "../shared/views";
import {containerRegion, moveContainerTo, regionAnchor, regionContainers, regionSections, sectionLanding} from "./state/containers";

/** 活动栏这条入口条的 id：键盘区域、实时布局的“吸收它的标签条”都用它。面板 id 是随机串或名字，撞不上。 */
const BAR_STRIP = "activitybar";

/**
 * 一个区域的入口条的 id：侧栏是活动栏，右栏是右轨的叶（docs/specs/ui/workbench-layout.md 输出 50），底部面板是它的入口条叶（都只在呈现里，不是面板，撞不上面板 id）。
 */
export function entryStripOf(region: PanelName): string {
    if (region === "sidebar") return BAR_STRIP;
    return region === "auxiliarybar" ? railLeafId(region) : regionStripLeafId(region);
}

/** 入口条的 id → 区域；不是入口条是 null。 */
export const regionOfEntryStrip = (strip: string): PanelName | null => (strip === BAR_STRIP ? "sidebar" : regionOfRailLeaf(strip) ?? regionOfStripLeaf(strip));

/** 拖的是一个含几个视图的入口（输出 46）：只能在入口条上换序，或整个搬到另一个区域。 */
export interface ContainerSource {
    readonly kind: "container";
    readonly container: string;
}

/** 工作台的一场拖动拖的是什么：文档里的标签或整个浮动窗（`LayoutSource`），或入口条上的一个容器入口。 */
export type WorkbenchDragSource = LayoutSource | ContainerSource;

/**
 * 入口条上的落点，`region` 是落在哪个区域的入口条上。入口之间的位置写成“排在哪个容器的入口前面”（`before`，null 是最后），不写下标：
 * 锚的入口顺序里还留着没有成员的容器，来源收起之后量到的入口也少了它自己那一个，下标在这几份列表之间对不上。
 */
export type EntryDropAction =
    /** 新建一个只含来源的用户容器，入口排在这里（`container` 是这一场拖动起头时定的 id：落点每帧比较，不能每次判定都换）。 */
    | {readonly kind: "new-container"; readonly region: PanelName; readonly container: string; readonly before: string | null}
    /** 并入这个容器，成为它最后一个分节。 */
    | {readonly kind: "join-container"; readonly region: PanelName; readonly container: string}
    /** 只给这个容器的入口换位置：容器就在这个区域，显隐与当前容器都不变。 */
    | {readonly kind: "move-entry"; readonly region: PanelName; readonly container: string; readonly before: string | null}
    /** 整个容器从别的区域搬过来，入口排在这里（输出 44 的“移到”、输出 46）：分节的先后、大小、收成标题行都带着，放下时目标区域切到它。 */
    | {readonly kind: "move-container"; readonly region: PanelName; readonly container: string; readonly before: string | null};

export type WorkbenchDropAction = LayoutDropAction | EntryDropAction;

export const isEntryAction = (action: WorkbenchDropAction): action is EntryDropAction => action.kind === "new-container" || action.kind === "join-container" || action.kind === "move-entry" || action.kind === "move-container";

/** 落点的比较键：库的落点按库的规则（浮动只看种类），入口的落点就是它的内容。 */
export const workbenchDropKey = (action: WorkbenchDropAction): string => (isEntryAction(action) ? JSON.stringify(action) : layoutDropKey(action));

/** 落点加编辑组的分区（`part`）在判定里的键：同一个键就是画出来一样的落点（实时布局的缓存、放下时的去重、文件拖动的比较都用它）。 */
export const dropKeyOf = (action: WorkbenchDropAction, part: string | undefined): string => JSON.stringify([workbenchDropKey(action), part ?? null]);

/**
 * 这个落点算落在哪条标签条上（实时布局：标签条吸收来源，卡片收回）；不是标签条为 null。入口条的入口之间是一条标签条（输出 38“标签条上”）；
 * 入口上不吸收（并入，入口高亮），和中央一样。
 */
export function dropStripOf(action: WorkbenchDropAction): string | null {
    if (action.kind === "strip") return action.panel;
    return action.kind === "new-container" || action.kind === "move-entry" || action.kind === "move-container" ? entryStripOf(action.region) : null;
}

/**
 * 这个落点在哪条标签条上，用来问“是不是来源自己的标签条”（实时布局：在自己的标签条里不收起来源）；不在标签条上为 null。
 * 和 `dropStripOf` 只差在入口上的并入：并入不吸收来源，但它也在入口条上。来源是一个区域里一个容器唯一的视图时，那个区域的入口条是它自己的入口条（输出 45），
 * 停在别的入口上也不算离开：收起来源的话它的入口跟着没了，后面的入口补上来，被高亮的那个就滑离了指针。
 */
export const homeStripOf = (action: WorkbenchDropAction): string | null => (isEntryAction(action) ? entryStripOf(action.region) : dropStripOf(action));

/** 量到的一个入口，沿入口条的方向（活动栏从上到下，入口条从左到右）。 */
export interface BarEntryRect {
    /** 容器 id。 */
    readonly container: string;
    readonly start: number;
    readonly end: number;
}

/** 指针在入口条的哪：一个入口上，或两个入口之间（`before` 是后面那个入口的容器，null 是最后一个之后）。 */
export type BarSpot = {readonly kind: "gap"; readonly before: string | null} | {readonly kind: "entry"; readonly container: string};

/**
 * 入口中间这么大的一段（占入口长度的比例）算“入口上”，两头各剩的一段算它和邻居之间（输出 45）。Spec 没写比例：取一半，两头各四分之一，
 * 入口之间的空位（几像素的间距）加上两边各四分之一个入口，和中间那段差不多好指。
 */
export const BAR_ENTRY_CORE = 0.5;

/** 指针沿入口条的坐标 `along` 算哪（`entries` 是这一刻看得见的入口，按入口条的方向）。`entries: false`：入口上也算空位（拖含几个视图的入口只能换序或搬，输出 46），按入口的中线分前后。 */
export function barSpotAt(entries: ReadonlyArray<BarEntryRect>, along: number, options: {readonly entries: boolean}): BarSpot {
    if (options.entries) {
        const over = entries.find((entry) => {
            const margin = ((entry.end - entry.start) * (1 - BAR_ENTRY_CORE)) / 2;
            return along >= entry.start + margin && along < entry.end - margin;
        });
        if (over !== undefined) return {kind: "entry", container: over.container};
    }
    const next = entries.find((entry) => along < (entry.start + entry.end) / 2);
    return {kind: "gap", before: next?.container ?? null};
}

/** 键盘在入口条上能停的点（沿入口条的坐标）：每个空位一个（入口的前沿、最后一个的后面），`entries` 时每个入口的中点再一个；放回 `barSpotAt` 就是这个位置。 */
export function barStopsOf(entries: ReadonlyArray<BarEntryRect>, bandEnd: number, options: {readonly entries: boolean}): ReadonlyArray<number> {
    const stops = entries.flatMap((entry) => (options.entries ? [entry.start + 1, (entry.start + entry.end) / 2] : [entry.start + 1]));
    const last = entries.at(-1);
    return [...stops, Math.min(bandEnd - 1, (last?.end ?? 0) + 1)];
}

/** 来源（标签）所在的分节是它容器唯一的分节时，是那个容器与它所在的区域；否则 null（浮动窗、编辑组里的标签不在任何区域的分节里）。 */
function soleContainerOf(doc: LayoutDoc, source: WorkbenchDragSource): {readonly container: string; readonly region: PanelName} | null {
    if (source.kind !== "tab") return null;
    const panel = findTab(doc, source.tab)?.panel;
    for (const region of VIEW_LOCATIONS) {
        const sections = regionSections(doc, region);
        const own = sections.find((section) => section.panel === panel);
        if (own !== undefined) return sections.filter((section) => section.container === own.container).length === 1 ? {container: own.container, region} : null;
    }
    return null;
}

/**
 * 来源是这个区域里一个容器唯一的视图时是那个容器（输出 45）：落在这条入口条的入口之间只是给它换位置，这条入口条就是它自己的（实时布局里是“自己的标签条”）。
 */
export function soleRegionContainer(doc: LayoutDoc, source: WorkbenchDragSource, region: PanelName): string | null {
    const sole = soleContainerOf(doc, source);
    return sole !== null && sole.region === region ? sole.container : null;
}

/**
 * 入口条上的指针位置换成落点；放不进时 null。`newContainer` 是这一场新建容器要用的 id。
 * 落在另一个区域的入口之间：含几个视图的入口整个容器搬过来；视图是它容器唯一的成员时也是整个容器搬过来、id 不变，否则新建只含它的用户容器（输出 46）。
 */
export function entryDropAt(doc: LayoutDoc, source: WorkbenchDragSource, spot: BarSpot, newContainer: string, region: PanelName): EntryDropAction | null {
    if (source.kind === "container") {
        if (spot.kind !== "gap") return null;
        return {kind: containerRegion(doc, source.container) === region ? "move-entry" : "move-container", region, container: source.container, before: spot.before};
    }
    if (source.kind !== "tab") return null;
    if (spot.kind === "entry") return {kind: "join-container", region, container: spot.container};
    const sole = soleContainerOf(doc, source);
    if (sole === null) return {kind: "new-container", region, container: newContainer, before: spot.before};
    return {kind: sole.region === region ? "move-entry" : "move-container", region, container: sole.container, before: spot.before};
}

const failure = (message: string): LayoutResult => ({ok: false, code: "rejected", message});

/** 入口顺序里把 `container` 放到 `before` 前面（`before` 不在里面、或是 null 时放最后）。`before` 是它自己时不动。 */
function placeEntry(entries: ReadonlyArray<string>, container: string, before: string | null): ReadonlyArray<string> {
    if (before === container) return entries.includes(container) ? entries : [...entries, container];
    const rest = entries.filter((id) => id !== container);
    const at = before === null ? -1 : rest.indexOf(before);
    return at < 0 ? [...rest, container] : [...rest.slice(0, at), container, ...rest.slice(at)];
}

/**
 * 入口条上的落点放下去（`commit`）或预览的文档。`commit` 时区域显示（清掉隐藏与拖到零）并切到这个容器；预览不切（输出 38）。换序只改入口顺序。
 * 结果和现状一样时返回原对象（输出 28）：连着几步库操作，每一步都返回新对象，最后再比一次。
 */
export function applyEntryDrop(doc: LayoutDoc, source: WorkbenchDragSource, action: EntryDropAction, policy: LayoutPolicy, options: {readonly commit: boolean}): LayoutResult {
    const {region} = action;
    const anchor = regionAnchor(doc, region);
    if (anchor === null) return failure("The region does not use containers");
    let next = doc;
    const run = (step: (current: LayoutDoc) => LayoutResult): LayoutResult | null => {
        const result = step(next);
        if (!result.ok) return result;
        next = result.doc;
        return null;
    };
    const place = (container: string, before: string | null) => run((current) => setContainerEntries(current, anchor, placeEntry(current.panels[anchor]?.entries ?? [], container, before)));
    if (action.kind === "move-entry") {
        // 看得见的入口顺序不变就是原处（输出 28）：紧挨着它的两个空位。锚的入口顺序里还夹着没有成员的容器，不能按整份入口顺序比。
        const shown = regionContainers(doc, region).map((container) => container.id);
        if (JSON.stringify(placeEntry(shown, action.container, action.before)) === JSON.stringify(shown)) return {ok: true, doc};
        const failed = place(action.container, action.before);
        if (failed !== null) return failed;
        return {ok: true, doc: sameLayoutShape(doc, next) ? doc : next};
    }
    if (action.kind === "move-container") {
        // 放下：同“移到”（带着分节的先后、大小与收成标题行，目标区域显示并切到它），再把入口挪到落下的空位。
        // 预览不切（输出 38）：只能是单视图的来源（含几个视图的入口不走实时布局，输出 46），把它连同容器 id 挪进目标区域的这个容器，入口让出位置，区域还是原来的容器。
        const failed = options.commit
            ? (run((current) => moveContainerTo(current, action.container, region, policy)) ?? place(action.container, action.before))
            : source.kind !== "tab"
                ? failure("An entry with several views has no preview")
                : (run((current) => {
                    const target = sectionLanding(current, region, action.container);
                    return target === null ? failure("The region does not use containers") : moveTabToEdge(current, {tab: source.tab, target, container: action.container}, policy);
                }) ?? place(action.container, action.before));
        if (failed !== null) return failed;
        return {ok: true, doc: sameLayoutShape(doc, next) ? doc : next};
    }
    if (source.kind !== "tab") return failure("An entry only takes views");
    const own = soleRegionContainer(doc, source, region);
    // 落在它自己唯一视图所在的入口上：原处（输出 45），不切也不展开。
    if (action.kind === "join-container" && own === action.container) return {ok: true, doc};
    const members = regionSections(doc, region).filter((section) => section.container === action.container);
    const alreadyLast = action.kind === "join-container" && members.at(-1)?.panel === findTab(doc, source.tab)?.panel;
    if (!alreadyLast) {
        const target = sectionLanding(next, region, action.container);
        if (target === null) return failure("The region does not use containers");
        const failed = run((current) => moveTabToEdge(current, {tab: source.tab, target, container: action.container}, policy));
        if (failed !== null) return failed;
    }
    if (action.kind === "new-container") {
        const failed = place(action.container, action.before);
        if (failed !== null) return failed;
    }
    if (options.commit) {
        const failed = run((current) => setPanelHidden(current, anchor, false)) ?? run((current) => setActiveContainer(current, anchor, action.container));
        if (failed !== null) return failed;
    }
    return {ok: true, doc: sameLayoutShape(doc, next) ? doc : next};
}
