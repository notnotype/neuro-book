/**
 * 一棵树的拖放（docs/specs/ui/workbench-layout.md 输出 24 到 32）：手势是 nb-layout 的拖动会话，落点规则是 `resolveLayoutDrop`，这里读 DOM 给它矩形，把结果换成反馈要画的东西。
 *
 * 拖动源：标签（`data-panel-tab`，工具视图与编辑器标签都是，分节的标题也是）、活动栏的入口（`data-tool-entry`；只含一个视图的另有 `data-tool-view`，拖的是那个视图；含几个视图的拖的是容器，只能在入口条里换序，输出 46）、浮动窗的头（标签条空白，或它唯一的标签：整窗移动，输出 39）、视图自绘头的浮动窗里视图标出的拖动区（`data-window-drag`，中间隔着可交互元素的不算，`windowDragRegion`；整窗移动，docs/specs/workbench/views.md 输出 19 的“自绘头”）。树里整块面板不能拖（输出 24）。`data-no-drag` 里的按钮既不起拖也不接收，
 * `data-no-drag-start` 只是不起拖（标签上的关闭按钮：拖动经过时它还在标签条里），被菜单、对话框挡住的不接收。编辑组的标签条写 `data-panel-strip`，它的多行、固定分区由编辑器量（`editorTabs`）。
 *
 * 入口条（输出 45、47）：活动栏上段（`data-tool-band`）是侧栏的，右栏、底部面板的在各自卡片顶上（`data-region-strip`）。入口之间新建容器、换序或整个容器搬过来，入口上并入；
 * 判定与放下的结果在 `entry-drop`，这里量入口给它。入口条不走库的落点规则：条不是面板。入口条里并进来的那一节的头不算入口条，是那一节的标题行（输出 25 第 7 行）。
 *
 * 判定是纯读：预览用提交时的同一个函数（`applyLayoutDrop`）算，放回原处的落点只显示、不提交。结构键变了整场取消（输出 32），放下时提交再验一次接受矩阵（领域操作自己验）。
 */

import {applyLayoutDrop, enumerateDropCandidates, findTab, isFloating, isPanelShown, isSectionCollapsed, LAYOUT_FLOAT_EDGE_RATIO, LAYOUT_MAX_FLOATS, layoutDropOverPanel, layoutDropPanelAt, layoutDropSectors, layoutSeamsOf, previewEdgeDrop, previewPanelRects, rectContains, removeTab, resolveLayoutDrop, tabKey, treeLeaves} from "@notnotype/nb-workbench-layout";
import type {GridDropPoint, GridDropRect, GridExtent, GridFloatInput, GridOrientation, GridRect} from "@notnotype/nb-layout";
import type {LayoutDoc, LayoutDropAction, LayoutDropCandidate, LayoutDropInput, LayoutDropPanelGeometry, LayoutDropSector, LayoutDropSectorId, LayoutDropSource, LayoutFloatRect, LayoutPolicy, LayoutProjectionOptions, LayoutSource, PanelName, TabRef} from "@notnotype/nb-workbench-layout";
import {createLiveDragSession} from "@notnotype/nb-layout/vue";
import {measureTabStrip, tabStripInsertionIn, tabStripStopInsertions} from "@notnotype/nb-workbench-layout/vue";
import type {DragSession, LiveDrag, LiveDragHost, LiveDragState, LiveGrid} from "@notnotype/nb-layout/vue";
import type {TabStripHeld, TabStripSnapshot} from "@notnotype/nb-workbench-layout/vue";

import {nextTick, readonly, shallowRef} from "vue";
import type {Ref} from "vue";

import {centerOf, collapsedGeometry, heldTabIn, offset, sortedOffset, stripIndex, windowRect} from "./drag-geometry";
import type {DragGeometry, EntryBand, FrozenGeometry, WindowDrag} from "./drag-geometry";
import {barStops, pointOfCandidate} from "./drag-keyboard";
import {applyEntryDrop, barSpotAt, dropKeyOf, dropStripOf, entryDropAt, entryStripOf, homeStripOf, isEntryAction, regionOfEntryStrip, soleRegionContainer} from "./entry-drop";
import type {BarEntryRect, ContainerSource, EntryDropAction, WorkbenchDragSource, WorkbenchDropAction} from "./entry-drop";

import {EDITOR_TAB_TYPE, editorTabIdOf} from "../shared/editor-panels";
import {CUSTOM_CONTAINER_PREFIX} from "../shared/views";
import type {EditorTabDrag} from "./contracts";
import {defaultFloatRect, EDITOR_GROUP_MINIMUM, floatRectAt, wholeInTree} from "./state/layout-constraints";
import {isSoleWindow, layoutStructureKey, viewIdOf, viewKey} from "./state/layout-present";
import type {ViewCatalog} from "./views/registry";

/** 卡片的尺寸多久写一次：跟随屏幕每帧写，或每秒至多 60、30 次（设置 `nbook.workbench/dragCardRefresh`）。 */
export type LiveCardRefresh = "display" | "60" | "30";
const CARD_REFRESH_MS: Readonly<Record<LiveCardRefresh, number>> = {"display": 0, "60": 1000 / 60, "30": 1000 / 30};

/** 外壳读的实时布局状态：nb-layout 引擎的状态换成工作台的形状，只在拿起、换预览、卡片拿起收回时变。 */
export interface LayoutLiveView {
    /** 这一场是实时布局。 */
    readonly active: Readonly<Ref<boolean>>;
    /** 此刻预览的是什么：`none`、`source-removed` 或候选的键。e2e 等它，不按时长等。 */
    readonly previewKey: Readonly<Ref<string>>;
    /** 拿起的内容项；被标签条吸收、没拿起时为 null。 */
    readonly card: Readonly<Ref<{readonly key: string} | null>>;
    /** 已显示的空位（相对网格根）；没有新面板时为 null。 */
    readonly slot: Readonly<Ref<GridRect | null>>;
    /** 已显示的落点动作；预览的是别的（来源收起、没有、摆不出来）时为 null。 */
    readonly shownAction: Readonly<Ref<WorkbenchDropAction | null>>;
}

/** 被拖的是一个标签。实时布局只有这一种：整个浮动窗本身就在跟手。 */
export type LayoutTabSource = Extract<LayoutSource, {readonly kind: "tab"}>;

/** 拖动中要画的东西，矩形都是视口坐标。 */
export interface LayoutDropPreview {
    /** 真实结果的矩形；标签条的插入没有它。 */
    readonly areaRect: GridDropRect | null;
    /** 标签条的插入线。 */
    readonly indicator: GridDropRect | null;
    readonly orientation: GridOrientation;
    /** 活动栏上接收的那个入口（并入，或来源自己的入口即原处，输出 45）；只有落点指示画，实时布局由外壳在入口上盖并入的高亮。缺省没有。 */
    readonly entryRect?: GridDropRect | null;
}

/** 这一刻要画的落点分区（docs/specs/ui/workbench-layout.md“落点分区”）。 */
export interface LayoutDragSectors {
    /** 这块面板正文的矩形（视口坐标）。 */
    readonly rect: GridDropRect;
    readonly items: ReadonlyArray<LayoutDropSector>;
    /** 这次落点是哪块；落点不是这块面板的分区时为 null。 */
    readonly active: LayoutDropSectorId | null;
}

/** `A` 收窄到库的落点：资源树的文件、编辑器标签的落点不会在活动栏上。 */
export interface LayoutDragDrop<A extends WorkbenchDropAction = WorkbenchDropAction> {
    readonly action: A;
    /** 编辑组标签条的分区（`EditorTabInsertion.part`）。 */
    readonly part?: string;
    /** 放下去和现在一样（输出 28）：只显示“原位”，不提交。 */
    readonly inPlace: boolean;
    readonly preview: LayoutDropPreview;
    /** 没有分区（标签条、活动栏上，或设置关了）时不写。 */
    readonly sectors?: LayoutDragSectors;
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
    /** 这块浮动窗的视图自绘头（docs/specs/workbench/views.md 输出 19 的“自绘头”）：头在内容里，视图标出的可拖元素拖的是整个窗。 */
    ownHead(panel: string): boolean;
    /** 要不要算落点分区（设置 `nbook.workbench/dropSectors`）。 */
    sectors(): boolean;
    /** 手感（设置 `nbook.workbench/dragFeel`）；键盘、减少动效、最大化时一律落点指示。 */
    feel(): "live" | "indicator";
    /** 卡片什么时候缩小（设置 `nbook.workbench/dragCardShrink`）。 */
    cardShrink(): "strip" | "panel";
    /** 卡片的尺寸多久写一次（设置 `nbook.workbench/dragCardRefresh`）。 */
    cardRefresh(): LiveCardRefresh;
    /** 网格（外壳的 `WorkbenchSurface`）：实时布局从它取网格根的位置、写拿起的内容、拿起前送过渡到终点、判减少动效。 */
    grid(): LiveGrid | null;
    /** 摆预览；null 回到已提交的布局。 */
    showPreview(doc: LayoutDoc | null): void;
    /** 写拖影的位置（视口坐标）。这一帧的判定读完 DOM 才调。 */
    moveGhost(point: GridDropPoint): void;
    /** 画出来的浮动窗（夹取之后）：整窗拖动从这个矩形开始。 */
    floats(): ReadonlyArray<GridFloatInput>;
    /** 这块窗开始、结束整窗拖动（一场各一次）：`rect` 是记录里的矩形，`null` 结束。窗这时不接指针、不带过渡。 */
    markFloatMove(panel: string | null, rect?: LayoutFloatRect): void;
    /** 写窗相对开始时挪了多少；`null` 回到原处。跟手的东西直接写元素，不走渲染。 */
    placeFloat(panel: string, offset: GridDropPoint | null): void;
    /** 这个来源浮出来的最小尺寸。 */
    floatMinimum(source: LayoutTabSource): GridExtent;
    commit(source: WorkbenchDragSource, action: WorkbenchDropAction, part: string | undefined, keyboard: boolean): void;
}

export interface LayoutDrag {
    readonly session: DragSession<WorkbenchDragSource, LayoutDragDrop>;
    readonly live: LayoutLiveView;
    /** 指针在面板上但放不进去（输出 39）：松手取消。 */
    readonly rejected: Readonly<Ref<boolean>>;
    /** 这块面板在这份文档里的矩形（相对网格根）：并入盖层按它画。 */
    panelRectIn(doc: LayoutDoc, panel: string): GridDropRect | null;
    /** 资源树的文件在树外能落到哪（输出 39）：这一场是资源树自己的会话，这里只判定。`top` 是指针处最上层的元素，窗口外是 null。 */
    fileDrop(point: GridDropPoint, top: Element | null): LayoutDragDrop<LayoutDropAction> | null;
    dispose(): void;
}

/** 键盘能去的区域：一块面板，里面的位置是几个落点。 */
interface KeyboardRegion {
    readonly id: string;
    readonly candidates: ReadonlyArray<LayoutDropCandidate>;
    /** 入口条：入口上也是位置（拖视图：并入）；拖含几个视图的入口时只有入口之间（输出 31、46）。 */
    readonly entries?: boolean;
}

const rectOf = (element: Element | null | undefined): GridDropRect | null => {
    if (element === null || element === undefined) return null;
    const {left, top, right, bottom} = element.getBoundingClientRect();
    return right > left && bottom > top ? {left, top, right, bottom} : null;
};
const escape = (value: string): string => CSS.escape(value);

/**
 * 视图自绘头里不起拖的元素（docs/specs/workbench/views.md 输出 19 的“自绘头”）：点了有自己的事做的，按住拖它不该挪窗口。漏判的后果只是拖它会挪窗口
 * （起拖有门槛，单击照常），所以按常见的可交互元素与角色列，不求穷尽。
 */
const INTERACTIVE = [
    "button", "a[href]", "input", "textarea", "select", "label", "summary", "[contenteditable]:not([contenteditable='false'])",
    "[role='button']", "[role='tab']", "[role='link']", "[role='menuitem']", "[role='checkbox']", "[role='switch']", "[role='option']",
    "[tabindex]:not([tabindex='-1'])",
].join(", ");

/** 按下的元素所在的拖动区（视图写的 `data-window-drag`）；从它往上到拖动区之间有可交互的元素时不算，是 null。只在拖动区里面查，外面的祖先不管。 */
export function windowDragRegion(element: Element): Element | null {
    const region = element.closest("[data-window-drag]");
    if (region === null) return null;
    for (let current: Element | null = element; current !== null && current !== region; current = current.parentElement) {
        if (current.matches(INTERACTIVE)) return null;
    }
    return region;
}

/** 键盘的“浮动”区域：没有指针，无落点要明确选。 */
const FLOAT_REGION = "float";
/** 文件还不是文档里的标签：判定按一个编辑器标签问接受矩阵，提交归编辑器。 */
const FILE_SOURCE: LayoutDropSource = {kind: "new", tab: {kind: "tab", type: EDITOR_TAB_TYPE, tabId: "file"}};

/**
 * 摘掉这个标签之后它那块面板还在、还显示着：还有别的标签，或是最后一个编辑组留成空组（`removeTab`）。这时放回它那块的中央是添加为标签，不是原位；
 * 实时布局拿起卡片时就把它撕下来（输出 38）。单个标签的面板、分节摘掉就没了，它的整块是原位。
 */
function homeStays(doc: LayoutDoc, tab: string): boolean {
    const home = findTab(doc, tab)?.panel;
    if (home === undefined) return false;
    const result = removeTab(doc, tab);
    return result.ok && isPanelShown(result.doc, home);
}

/** 按整数比：亚像素的抖动不算容器变了。 */
const extentKey = (extent: GridExtent | null): string => (extent === null ? "" : `${String(Math.round(extent.width))}x${String(Math.round(extent.height))}`);

/** 编辑器不让放的落点：哪个标签、放到哪（`answeredByEditor` 答拒绝的那一个）。 */
interface EditorRefusal {
    readonly tab: string;
    readonly drop: LayoutDragDrop<LayoutDropAction>;
}

/** 一次判定的结果：落点，以及指针在面板上却放不进（光标是禁止）、编辑器不让放的是哪一个。 */
interface Judgement {
    readonly drop: LayoutDragDrop | null;
    readonly rejected: boolean;
    /** 在它上面松手时仍交给编辑器，由它在同一处拒绝并在组顶部写提示（`onEnd`）。 */
    readonly refusal: EditorRefusal | null;
}

const NOT_JUDGED: Judgement = {drop: null, rejected: false, refusal: null};
const judgementOf = (drop: LayoutDragDrop | null): Judgement => (drop === null ? NOT_JUDGED : {drop, rejected: false, refusal: null});

/**
 * 一场拖动的状态。拿起时新建（`activate`），收场时换成空闲的一份（`onActiveChange(false)`）：复位只靠新建，每场的字段收场后自动不在了。
 * 空闲的那份只带着最后一次判定：会话收场时先调 `onActiveChange(false)`、紧接着调 `onEnd`，`onEnd` 要读编辑器的拒绝。
 * 键盘拿起时没有区域、会话不起拖，不收场：这一份留到下一次拿起被换掉，它没有冻结的几何与整窗，没人读到旧值。
 */
interface DragRun {
    /** 同一个落点的预览只算一次：判定每次指针移动都跑。键里带着容器尺寸：一场里窗口变了，矩形要重算（输出 32）。 */
    readonly previews: Map<string, LayoutDragDrop<LayoutDropAction>>;
    /** 预览是按这份文档算的：一场拖动中文档被命令改了（快捷键移动视图），缓存作废。 */
    previewsOf: LayoutDoc | null;
    /** 预览是按这份判定几何算的：引擎换了几何（量到、收起、展开），缓存作废。 */
    previewsAt: FrozenGeometry | null;
    /**
     * 这一次判定现量的几何：实时布局拿起后、引擎量到之前（同一个同步段里的第一次判定）用它，判定完就丢，不存。
     * 引擎量到之后判定读引擎的（`frozen()`）：邻居在让位，读 DOM 的话预览会把自己换掉。落点指示每次现量（`geometry`）。
     */
    transient: FrozenGeometry | null;
    /** 这一场按下的点（视口坐标）：键盘拿起是 null。 */
    readonly pressedAt: GridDropPoint | null;
    /** 这一场新建容器要用的 id（输出 45）：拿起时定，落点每帧比较，判定一次换一个的话落点永远不稳定。 */
    readonly newContainer: string;
    windowDrag: WindowDrag | null;
    /** 最后一次判定。 */
    judged: Judgement;
    /** 标签条里排序：正在跟手的标签的外框元素；抓住的点占标签的比例，第一次排序时定，这一场不变，换到别的标签条里也一样。 */
    readonly sort: {element: HTMLElement | null; grab: number | null};
    /** 上一次的落点：画出来一样就还给它同一个对象（`stableDrop`）。 */
    shown: {readonly drop: LayoutDragDrop | null; readonly key: string};
}

/** 空闲的一份：还没拿起过，或这一场收场了（带着最后一次判定）。 */
const idleRun = (judged: Judgement): DragRun => ({
    previews: new Map(),
    previewsOf: null,
    previewsAt: null,
    transient: null,
    pressedAt: null,
    newContainer: "",
    windowDrag: null,
    judged,
    sort: {element: null, grab: null},
    shown: {drop: null, key: ""},
});

/** 拿起时新建的一份：只有按下的点与新建容器的 id 是拿起时定的，别的都从空开始。 */
const freshRun = (pressedAt: GridDropPoint | null, newContainer: string): DragRun => ({...idleRun(NOT_JUDGED), pressedAt, newContainer});

export function createLayoutDrag(options: LayoutDragOptions): LayoutDrag {
    const {root} = options;
    const surface = (): HTMLElement | null => root.querySelector("[data-workbench-surface]");
    let run = idleRun(NOT_JUDGED);
    /**
     * 放进空区域时归哪个容器（ADR 0050 决策 2）：来源是它容器唯一的成员时整个容器搬过去，id 不变（同输出 44 的“移到”、输出 45 的“只换位置”）；
     * 否则是这一场的新容器，和活动栏入口之间新建的是同一个 id。
     */
    const emptyRegionContainer = (doc: LayoutDoc, source: LayoutTabSource): string => {
        const hit = findTab(doc, source.tab);
        const container = hit === null ? undefined : doc.panels[hit.panel]?.container;
        if (container === undefined) return run.newContainer;
        return Object.values(doc.panels).filter((panel) => panel.container === container).length === 1 ? container : run.newContainer;
    };

    const dpr = (): number => root.ownerDocument.defaultView?.devicePixelRatio ?? 1;
    const rejected = shallowRef(false);
    /** 光标在全局样式里按根元素上的标记生效（`WorkbenchDragFeedback`）：拖动中的抓手是 `!important`，写在别处压不过。 */
    function setRejected(next: boolean): void {
        if (rejected.value === next) return;
        rejected.value = next;
        root.ownerDocument.documentElement.toggleAttribute("data-drop-rejected", next);
    }
    /** 外壳读的实时布局状态：引擎的状态变了才写（`changed`）。 */
    const liveActive = shallowRef(false);
    const previewKey = shallowRef("none");
    const card = shallowRef<{readonly key: string} | null>(null);
    const slot = shallowRef<GridRect | null>(null);
    const shownAction = shallowRef<WorkbenchDropAction | null>(null);
    const liveView: LayoutLiveView = {active: readonly(liveActive), previewKey: readonly(previewKey), card, slot, shownAction};
    function showLive(state: LiveDragState, engine: LiveDrag<LayoutTabSource, LayoutDragDrop, FrozenGeometry>): void {
        liveActive.value = state.active;
        previewKey.value = state.preview.kind === "candidate" ? state.preview.key : state.preview.kind;
        if (card.value?.key !== state.lifted?.key) card.value = state.lifted;
        slot.value = state.slotInGrid;
        shownAction.value = engine.previewedDrop()?.action ?? null;
    }

    /** 实时布局判定用的几何：引擎量到的那份，或这一次判定现量的那份；不在实时布局时为 null（落点指示每次现量）。 */
    const frozen = (): FrozenGeometry | null => live.geometry() ?? run.transient;

    const sourceRemovedDoc = (source: LayoutTabSource): LayoutDoc | null => {
        const result = removeTab(options.doc(), source.tab);
        return result.ok ? result.doc : null;
    };
    /** 按这个落点摆的文档；null 是放回原处或算不出。编辑器标签的并入、拒绝在判定里已经换成中央、被拒绝（`answeredByEditor`）。 */
    function candidateDoc(source: LayoutTabSource, drop: LayoutDragDrop, collapsed: boolean): LayoutDoc | null {
        if (drop.inPlace) return null;
        const doc = options.doc();
        const {action} = drop;
        // 活动栏的入口之间：入口滑开，来源在空位上显示成入口，侧栏不切（输出 38、45）。入口上不吸收，同中央。
        if (isEntryAction(action) && action.kind !== "join-container") {
            const result = applyEntryDrop(doc, source, action, options.policy(), {commit: false});
            return result.ok ? result.doc : null;
        }
        // 入口上的并入，来源是这个区域里一个容器唯一的视图：这条入口条是它自己的，来源不收起（`homeStripOf`），预览也不拿掉它，入口都不动，只高亮目标。
        // 已经在别处收起过就不行：判定的入口已经上移，已提交的文档会把来源的入口和分节画回来，高亮的入口就不在指针下了。
        if (action.kind === "join-container" && !collapsed && soleRegionContainer(doc, source, action.region) !== null) return doc;
        // 预览不摆真实结果的落点（输出 38）。浮动：窗此刻就是跟手的卡片。中央：目标不动，只盖一层；放下才换标签。这两种都是来源收起，内容靠拿起留着。
        if (action.kind === "float" || action.kind === "center" || action.kind === "join-container") return sourceRemovedDoc(source);
        const result = applyLayoutDrop(doc, source, action, options.policy());
        return result.ok ? result.doc : null;
    }
    // 一个区域里一个容器唯一的视图：那个区域的入口条就是它自己的，在里面换位、停在别的入口上都不收起来源（输出 45）。
    function isHomeStrip(source: LayoutTabSource, strip: string | null): boolean {
        if (strip === null) return false;
        if (strip === findTab(options.doc(), source.tab)?.panel) return true;
        const region = regionOfEntryStrip(strip);
        return region !== null && soleRegionContainer(options.doc(), source, region) !== null;
    }
    /** 这块面板在判定几何里的外框（视口坐标）。 */
    const frameIn = (seen: FrozenGeometry | null, panel: string | null | undefined): GridDropRect | null =>
        (seen === null || panel == null ? undefined : (seen.geometry.panels.find((item) => item.id === panel) ?? seen.geometry.floats.find((item) => item.id === panel))?.frame) ?? null;

    const sortAtOf = (at: {readonly point: GridDropPoint; readonly container: string} | null): {readonly point: GridDropPoint; readonly panel: string} | null => (at === null ? null : {point: at.point, panel: at.container});

    /** 实时布局的领域判断（nb-layout 的 `LiveDragHost`）：落点长什么样、预览摆什么、几何怎么量。什么时候做由引擎定。 */
    const liveHost = (engine: LiveDrag<LayoutTabSource, LayoutDragDrop, FrozenGeometry>): LiveDragHost<LayoutTabSource, LayoutDragDrop, FrozenGeometry> => ({
        facts: (source, drop) => {
            const container = dropStripOf(drop.action);
            return {
                // 原位的落点结果都一样，键也一样；只有标签条里的原位分开：来源收起之后它是排序（已提交的样子），别的原位是来源收起的样子。
                key: drop.inPlace ? (container === null ? "in-place" : "in-place-strip") : dropKeyOf(drop.action, drop.part),
                inPlace: drop.inPlace,
                // 落到别处才收起来源：自己的标签条里换序、放回原处都还没离开（活动栏是自己的入口条时，停在别的入口上也是，`homeStripOf`）。
                home: isHomeStrip(source, homeStripOf(drop.action)),
                // 只有长出新面板的落点有空位：并进已有面板时空位就是它的整块正文，粘住了它自己的外缘就选不到了。
                slotOnScreen: drop.action.kind === "edge" ? drop.preview.areaRect : null,
                container,
            };
        },
        show: (target, {source, collapsed}) => {
            if (target === null) {
                options.showPreview(null);
                return false;
            }
            if (target.kind === "source-removed") {
                options.showPreview(sourceRemovedDoc(source));
                return false;
            }
            const doc = candidateDoc(source, target.drop, collapsed);
            // 来源收起着时，算不出的仍是来源收起的样子：已提交的文档里来源还在原处，换回它就是又展开。
            options.showPreview(doc ?? (collapsed ? sourceRemovedDoc(source) : null));
            return doc !== null;
        },
        measure: (source) => freeze(options.doc(), source),
        collapsed: (source, before) => {
            // 来源不在文档里是拖动中被命令关掉了：下一次判定看到结构变了，整场取消。
            const result = removeTab(options.doc(), source.tab);
            return result.ok ? collapsedGeometry(before, options.doc(), result.doc, {extent: options.extent(), projection: options.projection(), dpr: dpr()}) : null;
        },
        staysWithoutSource: (source) => homeStays(options.doc(), source.tab),
        card: {
            key: (source) => source.tab,
            rect: (source, container, seen) => frameIn(seen, container ?? findTab(options.doc(), source.tab)?.panel),
            keepSizeInsideHome: () => options.cardShrink() === "panel",
            refreshMs: () => CARD_REFRESH_MS[options.cardRefresh()],
        },
        follow: {
            read: (at) => measureSorted(sortAtOf(at)),
            afterRender: (at) => {
                void nextTick(() => {
                    if (engine.state().active) measureSorted(sortAtOf(at))();
                });
            },
        },
    });

    /** 指针此刻所在的标签条（或入口条）里被拖标签的外框、条的范围与方向；指针不在能排序的条上是 null。 */
    function sortTargetOf(at: {readonly point: GridDropPoint; readonly panel: string}, tab: string): {readonly frame: HTMLElement; readonly bounds: GridDropRect; readonly vertical: boolean} | null {
        const band = bandAt(geometry(options.doc()).bands, at.point);
        const viewId = viewIdOf(tab);
        if (band !== undefined) {
            if (viewId === null) return null;
            const frame = bandElement(band.region)?.querySelector<HTMLElement>(`[data-tool-view="${escape(viewId)}"]`)?.closest<HTMLElement>("[data-entry-frame]") ?? null;
            return frame === null ? null : {frame, bounds: band.rect, vertical: band.axis === "y"};
        }
        if (options.titleOnly(at.panel)) return null;
        const container = tabHeadOf(at.panel, options.doc().panels[at.panel]?.role === "editor");
        const element = container?.querySelector<HTMLElement>(`[data-panel-tab="${escape(tab)}"]`) ?? null;
        const frame = element?.parentElement ?? null;
        const bounds = rectOf(element?.closest("[data-tab-row]"));
        return frame === null || bounds === null ? null : {frame, bounds, vertical: false};
    }
    function releaseSorted(frame: HTMLElement): void {
        frame.style.removeProperty("translate");
        frame.style.removeProperty("visibility");
        frame.style.removeProperty("z-index");
    }
    /**
     * 标签条里排序（输出 38“标签条上”）：被拖的那个标签就是它留着的位置，邻居按预览滑开；它自己显示出来，沿条跟着指针，夹在条的两端之间，不另画拖影。
     * 位置直接写元素的 `translate`（跟手的东西不走渲染）；标签条的换位过渡用 `transform`，两者不打架，占位的那个标签不参与换位过渡（样式里压掉）。
     * 正在跟手的元素与抓点在这一场的 `run.sort` 里。
     *
     * 读这一次要写什么，返回写的那一步：调用方把写放在这一帧别的读（判定）之后。
     */
    function measureSorted(at: {readonly point: GridDropPoint; readonly panel: string} | null): () => void {
        // 写的那一步写进量的时候那一场：放回原位（引擎的 `end`）在收场换掉 `run` 之前调。
        const {sort} = run;
        const source = session.state.value?.source;
        const target = at === null || source?.kind !== "tab" ? null : sortTargetOf(at, source.tab);
        const rect = target === null ? null : target.frame.getBoundingClientRect();
        if (target === null || rect === null || at === null) {
            return () => {
                if (sort.element !== null) releaseSorted(sort.element);
                sort.element = null;
            };
        }
        const {frame, bounds, vertical} = target;
        // 此刻写在它上面的位移按元素上的值算，不按记下的：Vue 重渲染可能把整个 style 换掉。
        const placed = sortedOffset({rect, translate: frame.style.translate, bounds, vertical, point: at.point, grab: sort.grab});
        sort.grab = placed.grab;
        // Vue 重渲染这个标签时可能整个换掉 style：值对不上就重写，不只看上一次写了什么。
        const value = placed.translate;
        return () => {
            if (sort.element !== null && sort.element !== frame) releaseSorted(sort.element);
            if (frame.style.translate !== value) frame.style.translate = value;
            if (frame.style.visibility !== "visible") frame.style.visibility = "visible";
            if (frame.style.zIndex !== "1") frame.style.zIndex = "1";
            sort.element = frame;
        };
    }
    /** 面板里画标签的那一块：编辑组是标签条那一行（头里还有提示条），工具面板是整个头。 */
    const tabHeadOf = (panel: string, editor: boolean): Element | null => root.querySelector(editor ? `[data-panel-strip="${escape(panel)}"]` : `[data-panel-head="${escape(panel)}"]`);
    const stripOf = (panel: string): Element | null => root.querySelector(`[data-panel-strip="${escape(panel)}"] [data-tab-strip]`);

    function geometryOf(doc: LayoutDoc, id: string): LayoutDropPanelGeometry | null {
        // 拖到零的面板，卡片还停在最后的非零尺寸（内容不重排），量的是外框：外框为零，量不到矩形，不是落点。隐藏的区域按拖到零画，同样。
        // 离开了、还在过渡里缩回去的（`data-leaving`）外框还在，也不算：它已经不在布局里，不是落点（docs/specs/ui/nested-grid.md 输出 46、48）。
        const frame = root.querySelector(`[data-leaf="${escape(id)}"]`);
        if (rectOf(frame) === null || frame?.hasAttribute("data-leaving") === true) return null;
        const card = rectOf(root.querySelector(`[data-shell-card="${escape(id)}"]`));
        if (card === null) return null;
        // 工具面板整个头都算标签条（动作区经 `data-no-drag` 不接收）；编辑组的头里还有提示条，只有标签条那一行算，头以下是正文。
        const editor = doc.panels[id]?.role === "editor";
        const head = tabHeadOf(id, editor);
        const strip = rectOf(head);
        // 头并在入口条里的那一节（输出 47）：外框是入口条那一行与它自己的叶的并集，头是入口之后那一段，正文是它整张卡片。
        const row = rectOf(head?.closest("[data-region-strip]"));
        if (strip !== null && row !== null) return {id, frame: {left: Math.min(row.left, card.left), top: row.top, right: Math.max(row.right, card.right), bottom: card.bottom}, body: card, strip};
        // 收成标题行的分节只有标题那一行，正文零面积（docs/specs/ui/workbench-layout.md 输出 25 第 7 行）：一列全部收起时垫底的那一节外框拉到了底，
        // 下面那片卡片底照旧不是落点，指针与键盘的候选一致。
        if (strip !== null && !editor && isSectionCollapsed(doc, id)) return {id, frame: {...card, bottom: strip.bottom}, body: {...card, top: strip.bottom, bottom: strip.bottom}, strip};
        return {id, frame: card, body: strip === null ? card : {...card, top: strip.bottom}, strip};
    }

    function measureGeometry(doc: LayoutDoc): DragGeometry {
        const maximized = options.maximized();
        const panels = treeLeaves(doc.tree.root).flatMap((leaf) => {
            if (doc.panels[leaf.id] === undefined || (maximized !== null && maximized !== leaf.id)) return [];
            return geometryOf(doc, leaf.id) ?? [];
        });
        const floats = doc.floats.toReversed().flatMap(({panel}) => (panel === run.windowDrag?.panel ? [] : (geometryOf(doc, panel) ?? [])));
        const excluded = [root.querySelector("[data-shell-card='activitybar']"), root.querySelector("[data-leaf='statusbar']"), root.querySelector("[data-shell-titlebar]")].flatMap((element) => rectOf(element) ?? []);
        return {panels, floats, excluded, bands: measureBands(), origin: treeOrigin()};
    }

    function treeOrigin(): GridDropPoint {
        const box = surface()?.getBoundingClientRect();
        return {x: box?.left ?? 0, y: box?.top ?? 0};
    }

    /** 这一次判定的几何。实时布局用拿起时量的那份（`frozen`）：预览里入口在滑。 */
    const geometry = (doc: LayoutDoc): DragGeometry => frozen()?.geometry ?? measureGeometry(doc);

    /** 标签条的量取：实时布局用拿起时量的那份（摘掉了来源：预览里来源已经挪了，标签也在滑）。 */
    function stripSnapshot(panel: string): TabStripSnapshot | null {
        const kept = frozen()?.strips.get(panel);
        if (kept !== undefined) return kept;
        const strip = stripOf(panel);
        return strip === null ? null : measureTabStrip(strip);
    }

    /** 一个区域的入口条元素：侧栏是活动栏上段，右栏、底部面板是卡片顶上那一行。 */
    const bandElement = (region: PanelName): Element | null => root.querySelector(region === "sidebar" ? "[data-tool-band]" : `[data-region-strip="${region}"]`);

    /** 看得见的入口，沿入口条的方向：收进“更多”的不在 DOM 里。 */
    function entriesIn(band: Element, axis: "x" | "y"): ReadonlyArray<BarEntryRect> {
        return [...band.querySelectorAll<HTMLElement>("[data-tool-entry]")].map((entry) => {
            const {top, bottom, left, right} = entry.getBoundingClientRect();
            return {container: entry.dataset.toolEntry ?? "", start: axis === "y" ? top : left, end: axis === "y" ? bottom : right};
        });
    }

    function measureBands(): ReadonlyArray<EntryBand> {
        return (["sidebar", "auxiliarybar", "panel"] as const).flatMap((region): EntryBand[] => {
            const element = bandElement(region);
            const row = rectOf(element);
            // 被最大化的面板盖住的（叶 `inert`）、正在离开的入口条不是落点：指针下是盖在上面的那块面板，不是它。
            if (element === null || row === null || element.closest("[inert], [data-leaving]") !== null) return [];
            if (region === "sidebar") return [{region, axis: "y", row, groupEnd: row.bottom, merged: null, rect: row, entries: entriesIn(element, "y")}];
            const groupEnd = rectOf(element.querySelector("[data-region-entries]"))?.right ?? row.left;
            const merged = element.querySelector<HTMLElement>("[data-panel-head]")?.dataset.panelHead ?? null;
            return [{region, axis: "x", row, groupEnd, merged, rect: merged === null ? row : {...row, right: groupEnd}, entries: entriesIn(element, "x")}];
        });
    }

    const bandAt = (bands: ReadonlyArray<EntryBand>, point: GridDropPoint): EntryBand | undefined => bands.find((band) => rectContains(band.rect, point));
    /** 键盘区域的 id 是入口条的 id（`entryStripOf`）。 */
    const bandOfRegion = (id: string): EntryBand | undefined => geometry(options.doc()).bands.find((band) => entryStripOf(band.region) === id);

    /** 入口条这个来源放不放得进（输出 45、46）：视图与容器入口能，编辑器标签、整个浮动窗不能；有面板最大化时都不能。 */
    function barAccepts(source: WorkbenchDragSource): boolean {
        if (options.maximized() !== null) return false;
        return source.kind === "container" || (source.kind === "tab" && viewIdOf(source.tab) !== null);
    }

    /**
     * 放到入口条上（输出 45、46、47）。不进预览缓存：缓存只认动作，这里每次按入口判。原处按放下的那一份判：只切换容器的放下也是一次写入（输出 28）。
     * 含几个视图的入口只换序或整个搬过来，入口上也算空位。
     */
    function entryDrop(source: WorkbenchDragSource, point: GridDropPoint, band: EntryBand): LayoutDragDrop<EntryDropAction> | null {
        if (!barAccepts(source)) return null;
        const doc = options.doc();
        const {entries, rect, axis} = band;
        const spot = barSpotAt(entries, axis === "y" ? point.y : point.x, {entries: source.kind !== "container"});
        const action = entryDropAt(doc, source, spot, run.newContainer, band.region);
        if (action === null) return null;
        const result = applyEntryDrop(doc, source, action, options.policy(), {commit: true});
        if (!result.ok) return null;
        // 横跨入口条的那一段：活动栏两边各缩 6px，入口条上下各缩 4px。
        const across = (start: number, end: number): GridDropRect => (axis === "y" ? {left: rect.left + 6, right: rect.right - 6, top: start, bottom: end} : {left: start, right: end, top: rect.top + 4, bottom: rect.bottom - 4});
        const orientation = axis === "y" ? "vertical" : "horizontal";
        // 入口上：落点指示把接收的入口框出来（并入，或落在来源自己的入口上即原处，输出 45），提示跟着它（输出 28、30），没有形状时提示不显示；
        // 实时布局不画指示，由外壳在入口上盖并入的高亮（`presentDrag` 的 `mergeEntry`）。入口之间是一条和入口条垂直的线，画在两个入口的间距中间。
        if (spot.kind === "entry") {
            const over = entries.find((entry) => entry.container === spot.container);
            return {action, inPlace: result.doc === doc, preview: {areaRect: null, indicator: null, orientation, entryRect: over === undefined ? null : across(over.start, over.end)}};
        }
        const at = spot.before === null ? -1 : entries.findIndex((entry) => entry.container === spot.before);
        const before = at < 0 ? entries.at(-1) : entries[at - 1];
        const after = at < 0 ? undefined : entries[at];
        const first = axis === "y" ? rect.top : rect.left;
        const line = after === undefined ? (before === undefined ? first + 4 : before.end + 2) : (before === undefined ? after.start - 2 : (before.end + after.start) / 2);
        return {action, inPlace: result.doc === doc, preview: {areaRect: null, indicator: across(line - 1, line + 1), orientation}};
    }

    function previewOf(doc: LayoutDoc, source: LayoutDropSource, action: Exclude<LayoutDropAction, {readonly kind: "strip"}>, inPlace: boolean, panels: ReadonlyArray<LayoutDropPanelGeometry>, seen: DragGeometry): LayoutDropPreview {
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
            case "edge": {
                const extent = options.extent();
                if (extent === null) return none;
                const rect = previewEdgeDrop(doc, source, action, options.policy(), options.projection(), extent, dpr());
                return {...none, areaRect: rect === null ? null : offset(rect, seen.origin)};
            }
        }
    }

    /** 落在标签条上（工具面板与编辑组同一条路径）：不进预览缓存，每次按标签量。原位按文档判。 */
    function stripDrop(doc: LayoutDoc, source: LayoutDropSource, panel: string, point: GridDropPoint, seen: DragGeometry): LayoutDragDrop<LayoutDropAction> | null {
        const snapshot = stripSnapshot(panel);
        // 实时布局里标签条上是排序，被拖的标签自己在条里跟手：按它的位置判，不按指针（抓在标签右半边往左拖时，标签到了最左端指针还没过邻居的中线）。
        const heldTab = source.kind === "tab" && live.state().active ? (frozen()?.heldTab ?? null) : null;
        const measured = snapshot === null ? null : tabStripInsertionIn(snapshot, point, heldTab);
        if (snapshot === null || measured === null) return null;
        const index = stripIndex(doc, panel, measured);
        const action: LayoutDropAction = {kind: "strip", panel, index};
        const preview: LayoutDropPreview = {areaRect: null, indicator: measured.indicator, orientation: "horizontal"};
        const part = measured.partition ?? undefined;
        if (doc.panels[panel]?.role === "editor") {
            // 放下走编辑器的动作（要先结算输入），这里只判是不是紧挨着它自己：同一个分区，插在它前面或后面。
            if (source.kind !== "tab") return {action, ...(part === undefined ? {} : {part}), inPlace: false, preview};
            const own = doc.panels[panel]?.tabs.findIndex((tab) => tabKey(tab) === source.tab) ?? -1;
            const ownPartition = snapshot.excludedPartition ?? snapshot.members.find((member) => member.id === source.tab)?.partition ?? null;
            return {action, ...(part === undefined ? {} : {part}), inPlace: own >= 0 && ownPartition === measured.partition && (index === own || index === own + 1), preview};
        }
        const result = applyLayoutDrop(doc, source, action, options.policy());
        if (!result.ok) return null;
        // 工具面板放回原处：预览画来源自己所在的位置（输出 28）。带标签条的工具面板只剩浮动窗（输出 25 第 0 行），量的块要含窗，不然原位没有可画的矩形。
        const inPlace = result.doc === doc;
        return {action, inPlace, preview: inPlace ? previewOf(doc, source, {kind: "center", panel}, true, panelsOf(seen), seen) : preview};
    }

    /** 键盘在这块标签条上能停的位置：看得见的标签之间。 */
    function stripStopsOf(doc: LayoutDoc, panel: string): ReadonlyArray<{readonly point: GridDropPoint; readonly index: number}> {
        const strip = stripOf(panel);
        if (strip === null || options.titleOnly(panel)) return [];
        return tabStripStopInsertions(strip).map(({point, insertion}) => ({point, index: stripIndex(doc, panel, insertion)}));
    }

    /** 量实时布局判定用的几何（引擎拿起后第一帧开头调，或这一次判定现量）。 */
    function freeze(doc: LayoutDoc, source: LayoutTabSource): FrozenGeometry {
        const strips = new Map([...treeLeaves(doc.tree.root).map((leaf) => leaf.id), ...doc.floats.map((float) => float.panel)].flatMap((panel) => {
            const strip = stripOf(panel);
            return strip === null ? [] : [[panel, measureTabStrip(strip, source.tab)] as const];
        }));
        const heldTab = heldTabOf(strips, source);
        // 跟手的位置（`measureSorted`）和判定用同一个抓点：标签画在哪，就按哪判。
        if (heldTab !== null) run.sort.grab = heldTab.grab;
        return {geometry: measureGeometry(doc), strips, heldTab};
    }

    /** 被拖的标签拿起时的矩形与按下的点（`heldTabIn`）：在自己的标签条里摘掉的那一个；只写标题的头没有标签条，取标题。 */
    function heldTabOf(strips: ReadonlyMap<string, TabStripSnapshot>, source: LayoutTabSource): TabStripHeld | null {
        const {pressedAt} = run;
        if (pressedAt === null) return null;
        const rect = [...strips.values()].find((snapshot) => snapshot.excludedRect !== undefined)?.excludedRect ?? rectOf(root.querySelector(`[data-panel-tab="${escape(source.tab)}"]`));
        return heldTabIn(rect, pressedAt);
    }

    /** 这个来源能浮出来吗（输出 39）：视图可以声明不许；窗数到了上限不行；已经独占一个窗的标签再浮还是它（键盘不列这个落点）。 */
    function canFloat(doc: LayoutDoc, source: LayoutTabSource): boolean {
        const found = findTab(doc, source.tab);
        if (found === null || doc.floats.length >= LAYOUT_MAX_FLOATS) return false;
        const viewId = viewIdOf(source.tab);
        return viewId === null || options.catalog().get(viewId)?.floatable !== false;
    }

    /** 面板与浮动窗的判定几何，面板在前。 */
    const panelsOf = (seen: DragGeometry): ReadonlyArray<LayoutDropPanelGeometry> => [...seen.panels, ...seen.floats];
    const toGrid = (point: GridDropPoint, {origin}: DragGeometry): GridDropPoint => ({x: point.x - origin.x, y: point.y - origin.y});
    /**
     * 明确的无落点：标签在松手处浮动打开（输出 39），反馈画这个矩形。不进预览缓存，矩形每帧变。键盘没有指针，矩形按树区域居中。
     */
    function floatDrop(doc: LayoutDoc, minimum: GridExtent, point: GridDropPoint | null, seen: DragGeometry): LayoutDragDrop<LayoutDropAction> {
        const rect = point === null ? defaultFloatRect(options.extent(), minimum, doc.floats.length) : wholeInTree(floatRectAt(toGrid(point, seen), options.extent(), minimum), options.extent());
        const areaRect = offset({left: rect.x, top: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height}, seen.origin);
        return {action: {kind: "float", rect}, inPlace: false, preview: {areaRect, indicator: null, orientation: "horizontal"}};
    }

    /** 有落点时的这一份：动作、原位、反馈。标签与整窗共用。 */
    function dropFor(doc: LayoutDoc, source: LayoutDropSource, resolved: LayoutDropAction, point: GridDropPoint, panels: ReadonlyArray<LayoutDropPanelGeometry>, seen: DragGeometry): LayoutDragDrop<LayoutDropAction> | null {
        if (resolved.kind === "strip" && !options.titleOnly(resolved.panel)) return stripDrop(doc, source, resolved.panel, point, seen);
        // 头只写标题的面板没有插入位：落在标题上就是添加为标签。
        const action = resolved.kind === "strip" ? ({kind: "center", panel: resolved.panel} as const) : resolved;
        // 缓存跟着外壳的一场拖动清（`activate`）。文件拖动是资源树的会话，没有这个清理点：每次算。
        const key = source.kind === "new" ? null : JSON.stringify([source, action, options.extent()]);
        const cached = key === null ? undefined : run.previews.get(key);
        if (cached !== undefined) return cached;
        const result = applyLayoutDrop(doc, source, action, options.policy());
        if (!result.ok) return null;
        // 放回它自己那块的中央、那块摘掉它还在：和别的面板的中央一样是添加为标签（输出 25 第 6 行），松手回到原来的位置、成为活动标签。
        const rejoins = source.kind === "tab" && action.kind === "center" && findTab(doc, source.tab)?.panel === action.panel && homeStays(doc, source.tab);
        const inPlace = result.doc === doc && !rejoins;
        const drop = {action, inPlace, preview: previewOf(doc, source, action, inPlace, panels, seen)};
        if (key !== null) run.previews.set(key, drop);
        return drop;
    }

    const dropOrigin = (doc: LayoutDoc): void => {
        const seen = frozen();
        if (doc === run.previewsOf && seen === run.previewsAt) return;
        run.previewsOf = doc;
        run.previewsAt = seen;
        run.previews.clear();
    };

    /**
     * 整窗的判定：窗一直在跟手，所以“放不进”都是移动（输出 39），反馈不画。只有标签条、缝和窄带能停靠，经过中央继续浮着。
     */
    function windowDrop(drag: WindowDrag, source: Extract<LayoutSource, {readonly kind: "panel"}>, point: GridDropPoint): LayoutDragDrop {
        const doc = options.doc();
        const moved: LayoutDragDrop = {action: {kind: "float", rect: windowRect(drag, point, options.extent())}, inPlace: false, preview: {areaRect: null, indicator: null, orientation: "horizontal"}};
        // 窗经过活动栏继续浮着：停靠只有标签条、缝与窄带（输出 39），活动栏的入口条不收整个窗（输出 45 只说工具视图）。
        const seen = geometry(doc);
        dropOrigin(doc);
        const input: LayoutDropInput = {doc, source, point, panels: seen.panels, floats: seen.floats, excluded: seen.excluded, policy: options.policy(), noCenter: true, edgeRatio: LAYOUT_FLOAT_EDGE_RATIO};
        const resolved = resolveLayoutDrop(input);
        if (resolved === null) return moved;
        const drop = dropFor(doc, source, resolved, point, seen.panels, seen);
        return drop === null ? moved : sectored(drop, resolved, input);
    }

    function dropAt(source: LayoutTabSource, point: GridDropPoint, region: KeyboardRegion | null): Judgement {
        const doc = options.doc();
        if (region?.id === FLOAT_REGION) return judgementOf(canFloat(doc, source) ? floatDrop(doc, options.floatMinimum(source), null, geometry(doc)) : null);
        // 实时布局拿起后、引擎量到之前：这一次现量一份，判定完丢掉（`resolveDrop`）。
        if (live.state().active && frozen() === null) run.transient = freeze(doc, source);
        const seen = geometry(doc);
        // 放不进入口条的（编辑器标签、有面板最大化）是取消，不开窗（输出 39“不浮动”）。入口条先判：它不在任何面板上，交给库就成了无落点、浮动打开。
        const band = bandAt(seen.bands, point);
        if (band !== undefined) return judgementOf(entryDrop(source, point, band));
        dropOrigin(doc);
        const {panels} = seen;
        // 键盘的区域是明确选的：别的窗盖着的落点也要能选。
        const floats = region === null ? seen.floats : seen.floats.filter((item) => item.id === region.id);
        const input: LayoutDropInput = {doc, source, point, panels, floats, excluded: seen.excluded, policy: options.policy(), newContainer: emptyRegionContainer(doc, source)};
        const kept = live.sticky(point);
        if (kept !== null) return judgementOf(withSectors(kept, input));
        const resolved = resolveLayoutDrop(input);
        // 只有不在面板上才是“明确的无落点”：在面板上是被拒绝，别的 null 是被挡住、算不出或出错，都不该开窗。键盘的无落点要明确选“浮动”区域。
        if (resolved === null) {
            if (region !== null) return NOT_JUDGED;
            if (layoutDropOverPanel(input)) return {drop: null, rejected: true, refusal: null};
            return judgementOf(canFloat(doc, source) ? floatDrop(doc, options.floatMinimum(source), point, seen) : null);
        }
        // 中央与原位的预览画在落点那块的正文上：落点可能是浮动窗。
        const reachable = [...panels, ...floats];
        const drop = dropFor(doc, source, resolved, point, reachable, seen);
        if (drop === null) return NOT_JUDGED;
        const answered = answeredByEditor(doc, source, drop, point, reachable, seen);
        if (answered === "refuse") {
            const tab = editorTabIdOf(source.tab);
            return {drop: null, rejected: true, refusal: tab === null ? null : {tab, drop}};
        }
        // 分区按指针下的落点算：并入改成了中央，指针在标签条上时照旧不画分区。
        return judgementOf(sectored(answered, resolved, input));
    }

    /**
     * 编辑器标签放下走编辑器的动作，结果可能和布局层算的不同（docs/specs/workbench/editor.md 输出 55）：拒绝的是被拒绝，两种手感、键盘一样；
     * 并到目标组已开着的同一标签时落点就是那一组的中央，标签条上也是：画的是盖住整组的“添加为标签”，之后的预览、盖层、文字与提交都按中央走，编辑器放到中央不挪留下的那个标签。
     * 原位不问：放下什么都不做，不会被拒绝。每次判定都问、不进预览缓存：未裁决输入在拖动中也会出现、消掉。
     */
    function answeredByEditor(doc: LayoutDoc, source: LayoutTabSource, drop: LayoutDragDrop<LayoutDropAction>, point: GridDropPoint, panels: ReadonlyArray<LayoutDropPanelGeometry>, seen: DragGeometry): LayoutDragDrop<LayoutDropAction> | "refuse" {
        const editorTab = editorTabIdOf(source.tab);
        if (editorTab === null || drop.inPlace) return drop;
        const outcome = options.editorTabs()?.dropOutcome(editorTab, drop.action) ?? "move";
        if (outcome === "refuse") return "refuse";
        if (outcome === "move" || drop.action.kind !== "strip") return drop;
        return dropFor(doc, source, {kind: "center", panel: drop.action.panel}, point, panels, seen) ?? drop;
    }

    /**
     * 文件的判定（输出 39）：同一份规则与反馈；实时布局的冻结是外壳那一场的，这里没有。按钮区、活动栏不开窗；没有编辑器时没有落点。
     */
    function fileDrop(point: GridDropPoint, top: Element | null): LayoutDragDrop<LayoutDropAction> | null {
        const doc = options.doc();
        if (options.editorTabs() === null || top?.closest("[data-no-drag]") != null) return null;
        const seen = geometry(doc);
        if (bandAt(seen.bands, point) !== undefined) return null;
        const {panels} = seen;
        const input: LayoutDropInput = {doc, source: FILE_SOURCE, point, panels, floats: seen.floats, excluded: seen.excluded, policy: options.policy()};
        const resolved = resolveLayoutDrop(input);
        // 被拒绝时松手取消；光标归资源树的会话，这里没有反馈（输出 39）。
        if (resolved === null) return !layoutDropOverPanel(input) && doc.floats.length < LAYOUT_MAX_FLOATS ? floatDrop(doc, EDITOR_GROUP_MINIMUM, point, seen) : null;
        const drop = dropFor(doc, FILE_SOURCE, resolved, point, panels, seen);
        return drop === null ? null : sectored(drop, resolved, input);
    }

    /** 标签条上是一条插入线，没有分区；头只写标题的面板没有插入位，算中央。 */
    function sectored(drop: LayoutDragDrop<LayoutDropAction>, resolved: LayoutDropAction, input: LayoutDropInput): LayoutDragDrop<LayoutDropAction> {
        return resolved.kind === "strip" && !options.titleOnly(resolved.panel) ? drop : withSectors(drop, input);
    }

    /** 分区不进预览缓存：缓存按动作存，画的是指针所在的那块。 */
    function withSectors<A extends WorkbenchDropAction>(drop: LayoutDragDrop<A>, input: LayoutDropInput): LayoutDragDrop<A> {
        // 缝上没有分区：缝不属于哪一块面板（输出 37）。
        // 实时布局不画分区：预览就是反馈（输出 38）。
        if (!options.sectors() || live.state().active || (drop.action.kind === "edge" && drop.action.target.kind === "between")) return drop;
        const panel = layoutDropPanelAt(input);
        const items = panel === null ? null : layoutDropSectors(input, panel);
        if (panel === null || items === null) return drop;
        const wanted = JSON.stringify(drop.action);
        return {...drop, sectors: {rect: panel.body, items, active: items.find((item) => JSON.stringify(item.action) === wanted)?.id ?? null}};
    }

    function panelRectIn(doc: LayoutDoc, panel: string): GridDropRect | null {
        const float = doc.floats.find((item) => item.panel === panel);
        if (float !== undefined) return {left: float.rect.x, top: float.rect.y, right: float.rect.x + float.rect.width, bottom: float.rect.y + float.rect.height};
        const extent = options.extent();
        return extent === null ? null : previewPanelRects(doc, [panel], options.projection(), extent, dpr())[panel] ?? null;
    }

    /** 区域里能停的位置。来源那块面板只剩原位时停在它的中央：放下去还是原样。 */
    function stopsOf(region: KeyboardRegion): {readonly axis: "both"; readonly points: ReadonlyArray<GridDropPoint>} {
        if (regionOfEntryStrip(region.id) !== null) {
            const band = bandOfRegion(region.id);
            return {axis: "both", points: band === undefined ? [] : barStops(band, region.entries !== false)};
        }
        if (region.id === FLOAT_REGION) {
            const box = rectOf(surface());
            return {axis: "both", points: box === null ? [] : [centerOf(box)]};
        }
        const doc = options.doc();
        const seen = geometry(doc);
        const panels = panelsOf(seen);
        const points = region.candidates.flatMap((candidate) => pointOfCandidate(candidate, doc, panels, (panel) => stripStopsOf(doc, panel)) ?? []);
        if (points.length > 0 || region.candidates.length > 0) return {axis: "both", points};
        const body = panels.find((geometry) => geometry.id === region.id)?.body;
        return {axis: "both", points: body === undefined ? [] : [centerOf(body)]};
    }

    const fromElement = (element: Element): WorkbenchDragSource | null => {
        const entry = element.closest<HTMLElement>("[data-tool-entry]");
        // 只含一个视图的入口拖的是那个视图（输出 46）；含几个视图的拖的是容器。
        if (entry !== null) return entry.dataset.toolView === undefined ? {kind: "container", container: entry.dataset.toolEntry ?? ""} : {kind: "tab", tab: viewKey(entry.dataset.toolView)};
        const tab = element.closest<HTMLElement>("[data-panel-tab]")?.dataset.panelTab;
        // 视图自绘头的窗：头在内容层里，按在视图标出的拖动区上（中间没有可交互的元素）拖的是整个窗。
        const content = element.closest<HTMLElement>("[data-content-leaf][data-float]")?.dataset.contentLeaf;
        if (content !== undefined && options.ownHead(content) && windowDragRegion(element) !== null) return {kind: "panel", panel: content};
        // 浮动窗的头：标签条空白，或它唯一的标签，拖的是整个窗；多标签时拖标签是撕下（输出 39）。自绘头时标题按钮画在内容里（`content`）。
        const floating = element.closest<HTMLElement>("[data-leaf][data-float]")?.dataset.leaf ?? content;
        if (floating !== undefined && options.doc().panels[floating] !== undefined) {
            const onHead = element.closest("[data-panel-strip], [data-panel-head]") !== null;
            if (tab === undefined ? onHead : options.doc().panels[floating]?.tabs.length === 1) return {kind: "panel", panel: floating};
        }
        return tab === undefined ? null : {kind: "tab", tab};
    };

    /** 声明 `movable: false` 的视图不起拖：不出现“拿起了却落不下去”。 */
    function movable(source: WorkbenchDragSource): boolean {
        if (source.kind === "container") return source.container !== "";
        if (source.kind === "panel") return isFloating(options.doc(), source.panel);
        if (findTab(options.doc(), source.tab) === null) return false;
        const viewId = viewIdOf(source.tab);
        return viewId === null || options.catalog().get(viewId)?.movable !== false;
    }

    const sourceAt = (target: Element): WorkbenchDragSource | null => {
        if (!options.enabled() || target.closest("[data-no-drag], [data-no-drag-start]") !== null) return null;
        const source = fromElement(target);
        return source !== null && movable(source) ? source : null;
    };

    function resolveDrop({source, point, top, region}: {readonly source: WorkbenchDragSource; readonly point: GridDropPoint; readonly top: Element | null; readonly region: KeyboardRegion | null}): Judgement {
        // 被菜单、对话框挡住的不接收；键盘没有指针下的元素。指针在窗口外没有元素，算无落点。
        const covered = region === null && top !== null && !root.contains(top);
        if (source.kind === "container") return covered ? NOT_JUDGED : judgementOf(containerDrop(source, point));
        if (source.kind === "panel") {
            const {windowDrag} = run;
            return windowDrag === null || covered ? NOT_JUDGED : judgementOf(windowDrop(windowDrag, source, point));
        }
        // 来源收起、展开那一刻屏幕上的判定，指针没动之前一直是它（被拒绝、编辑器的拒绝跟着留下）。排在遮挡之前：预览重排可能让按钮区滑到静止的指针下，那一次判定不能把它盖掉。
        if (region === null && live.unmoved(point)) return run.judged;
        const onButtons = region === null && top?.closest("[data-no-drag]") != null;
        try {
            return covered || onButtons ? NOT_JUDGED : dropAt(source, point, region);
        } finally {
            run.transient = null;
        }
    }

    /** 拖含几个视图的入口（输出 46）：只有入口条是落点，别处没有落点、不开窗，也不算被拒绝。 */
    function containerDrop(source: ContainerSource, point: GridDropPoint): LayoutDragDrop | null {
        // 只量入口条：含几个视图的入口不走实时布局，没有冻结的几何，量整份几何（每块面板的头与卡片）每次指针移动都白做。
        const band = bandAt(frozen()?.geometry.bands ?? measureBands(), point);
        return band === undefined ? null : entryDrop(source, point, band);
    }

    /** 上一次的落点：画出来一样就还给它同一个对象。手势每帧发布，外壳靠落点的身份判断要不要重画。 */
    function stableDrop(next: LayoutDragDrop | null): LayoutDragDrop | null {
        const key = next === null ? "" : JSON.stringify(next);
        if (key === run.shown.key) return run.shown.drop;
        run.shown = {drop: next, key};
        return next;
    }

    const handle = createLiveDragSession<WorkbenchDragSource, LayoutDragDrop, KeyboardRegion, LayoutTabSource, FrozenGeometry>(root, (engine) => ({
        host: liveHost(engine),
        grid: () => options.grid(),
        changed: (state) => showLive(state, engine),
        // 最大化时别的面板盖着，预览看不见；容器还没量到没有基准。键盘（没有指针可跟）与减少动效由会话先判。
        // 拖含几个视图的入口是落点指示，不走实时布局（输出 38、46）；整窗本身就在跟手。
        live: (source) => (source.kind === "tab" && options.feel() === "live" && options.maximized() === null && options.extent() !== null ? source : null),
        sourceAt,
        activate: (source, keyboard, at) => {
            run = freshRun(source.kind === "tab" && !keyboard ? (at?.pressed ?? null) : null, `${CUSTOM_CONTAINER_PREFIX}${crypto.randomUUID()}`);
            // 拖含几个视图的入口是落点指示，不走实时布局（输出 38、46）。
            if (source.kind === "container") return true;
            if (source.kind === "panel") {
                // 窗本身就在跟手，不走实时布局：它没有卡片可缩，候选文档里它已经没了。
                const rect = options.floats().find((float) => float.id === source.panel)?.rect;
                const recorded = options.doc().floats.find((float) => float.panel === source.panel)?.rect;
                if (rect === undefined || recorded === undefined || at === null) return false;
                // 抓住的是按下的那一点：过门槛时指针已经离开它几个像素。
                const origin = treeOrigin();
                const pressed = {x: at.pressed.x - origin.x, y: at.pressed.y - origin.y};
                run.windowDrag = {panel: source.panel, origin, grab: {x: pressed.x - rect.x, y: pressed.y - rect.y}, from: {x: rect.x, y: rect.y}, shown: {width: rect.width, height: rect.height}, size: {width: recorded.width, height: recorded.height}};
                options.markFloatMove(source.panel, recorded);
                return true;
            }
            return true;
        },
        // 实时布局的判定基准是拿起时的矩形，容器变了就没了，也没法从预览里量回来：整场取消。落点指示按当前位置重算（输出 32）。
        structure: () => JSON.stringify([layoutStructureKey(options.doc()), options.editorTabs()?.structure() ?? null, engine.state().active ? extentKey(options.extent()) : null]),
        resolve: (input) => {
            const judged = resolveDrop(input);
            run.judged = judged;
            const drop = stableDrop(judged.drop);
            // 判定读完 DOM 才写。根元素上的标记一变整页都要重算样式（规则里有 `*`），每次移动写两下就是每帧一次全量重算。
            setRejected(judged.rejected);
            options.moveGhost(input.point);
            // 窗一直跟着指针，放不下也跟。写放在判定读完之后。
            const {windowDrag} = run;
            if (windowDrag !== null) {
                const at = windowRect(windowDrag, input.point, options.extent());
                options.placeFloat(windowDrag.panel, {x: Math.round(at.x) - windowDrag.from.x, y: Math.round(at.y) - windowDrag.from.y});
            }
            return drop;
        },
        // 实时布局这一场由会话另外取“或”。
        commitsUnderPointer: (keyboard) => !keyboard && run.windowDrag !== null,
        actionKey: (drop) => (drop.inPlace ? null : dropKeyOf(drop.action, drop.part)),
        commit: (drop, source, keyboard) => options.commit(source, drop.action, drop.part, keyboard),
        // 编辑器不让放的落点上松手：拖动中只读、不结算，为什么不让要松手才说。照常交给编辑器，它在同一处拒绝（与 `dropOutcome` 同一判据）并在组顶部写提示（docs/specs/workbench/editor.md 输出 55）。
        // 这时 `run` 已经是收场换上的空闲那份，带着最后一次判定。
        onEnd: (end, last) => {
            const {refusal} = run.judged;
            if (end.kind !== "no-action" || refusal === null) return;
            void options.editorTabs()?.drop(refusal.tab, refusal.drop.action, refusal.drop.part, last.keyboard);
        },
        // 拖动中的光标与禁选在全局样式里按这个标记生效。
        onActiveChange: (active) => {
            root.ownerDocument.documentElement.toggleAttribute("data-workbench-dragging", active);
            if (active) return;
            setRejected(false);
            // 放下、取消、中止都经过这里，并且先于提交：会话在调这里之前结束引擎（撤预览、经 `measureSorted` 放回排序中的标签），撤预览和提交在同一个同步段，不闪。
            if (run.windowDrag !== null) options.placeFloat(run.windowDrag.panel, null);
            run = idleRun(run.judged);
            options.markFloatMove(null);
        },
        keyboard: {
            // 焦点要在拖动源本身：标签或入口；面板头里别的控件保留自己的空格。
            // 键盘的来源是标签或入口：整窗移动有自己的把手（`FloatWindowHandles`）。
            sourceAt: (target) => {
                if (!target.matches("[data-panel-tab], [data-tool-entry]")) return null;
                const source = sourceAt(target);
                if (source === null || source.kind !== "panel") return source;
                // 窗里唯一的标签，指针拖它是整窗；键盘拿起的仍是这个标签（拿起停在原位，输出 31）。
                const tab = (target as HTMLElement).dataset.panelTab;
                if (tab === undefined) return null;
                const own: WorkbenchDragSource = {kind: "tab", tab};
                return movable(own) ? own : null;
            },
            regions: (from) => {
                const doc = options.doc();
                if (from.kind === "panel") return [];
                // 含几个视图的入口只能落在入口条上（输出 46）。
                const bars = geometry(doc).bands.map((band) => entryStripOf(band.region));
                if (from.kind === "container") return bars.map((id) => ({id, candidates: [], entries: false})).filter((region) => stopsOf(region).points.length > 0);
                const source = from;
                const candidates = enumerateDropCandidates({
                    doc,
                    source,
                    policy: options.policy(),
                    stripIndexes: (panel) => stripStopsOf(doc, panel).map((stop) => stop.index),
                    seams: layoutSeamsOf(doc, geometry(doc).panels),
                    newContainer: emptyRegionContainer(doc, source),
                });
                const byRegion = new Map<string, LayoutDropCandidate[]>();
                for (const candidate of candidates) byRegion.set(candidate.region, [...(byRegion.get(candidate.region) ?? []), candidate]);
                // 按树序。来源所在的面板就算没有候选也要有一个区域：拿起时停在原位。
                const home = findTab(doc, source.tab)?.panel;
                const panels = [...treeLeaves(doc.tree.root).map((leaf) => leaf.id), ...doc.floats.map((float) => float.panel)].filter((id) => byRegion.has(id) || id === home);
                // 工具视图的第一站是入口条，活动栏在前（输出 31）；最大化时它们不接收（`barAccepts`）。
                const bar = barAccepts(source) ? bars : [];
                // 无落点没有指针可以指，排在最后明确选。已经独占一个窗的标签浮出来还是原样，不列。
                const float = canFloat(doc, source) && !isSoleWindow(doc, home) ? [FLOAT_REGION] : [];
                const regions = [...bar, ...panels, ...float].map((id) => ({id, candidates: byRegion.get(id) ?? []}));
                // 手势跳不过没有位置的区域，Tab 会卡在那里：来源隐藏着（从活动栏拿起）时它的面板量不出来，不列。
                return regions.filter((region) => stopsOf(region).points.length > 0);
            },
            stops: stopsOf,
            // 从来源自己的位置开始，直接 Enter 不移动（输出 31）。
            start: (source, regions, origin) => {
                // 从标签拿起：原位是它自己。从入口条拿起：区域就是那条入口条，起点是条目，放回去也是原位（它在面板里的标签可能看不见：面板隐藏、头只写别的视图的标题）。
                const fromBar = origin.closest("[data-tool-entry]") !== null;
                const tab = source.kind === "tab" ? source.tab : "";
                const stripRegion = origin.closest<HTMLElement>("[data-region-strip]")?.dataset.regionStrip;
                const home = fromBar ? entryStripOf(stripRegion === "auxiliarybar" || stripRegion === "panel" ? stripRegion : "sidebar") : findTab(options.doc(), tab)?.panel;
                const region = Math.max(0, regions.findIndex((candidate) => candidate.id === home));
                const own = fromBar ? null : root.querySelector(`[data-panel-tab="${escape(tab)}"]`);
                return {region, at: centerOf(rectOf(own) ?? rectOf(origin) ?? {left: 0, top: 0, right: 0, bottom: 0})};
            },
            refocus: (source) => {
                if (source.kind === "container") return root.querySelector<HTMLElement>(`[data-tool-entry="${escape(source.container)}"]`);
                const tab = source.kind === "tab" ? source.tab : "";
                return root.querySelector<HTMLElement>(`[data-panel-tab="${escape(tab)}"]`) ?? root.querySelector<HTMLElement>(`[data-tool-view="${escape(viewIdOf(tab) ?? "")}"]`);
            },
        },
    }));
    const {session, live} = handle;

    return {
        session,
        live: liveView,
        rejected: readonly(rejected),
        panelRectIn,
        fileDrop,
        dispose: () => handle.dispose(),
    };
}
