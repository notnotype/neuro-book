/**
 * 一棵树的拖放（docs/specs/ui/workbench-layout.md 输出 24 到 32）：手势是 nb-layout 的拖动会话，落点规则是 `resolveLayoutDrop`，这里读 DOM 给它矩形，把结果换成反馈要画的东西。
 *
 * 拖动源：标签（`data-panel-tab`，工具视图与编辑器标签都是，分节的标题也是）、活动栏的入口（`data-tool-entry`；只含一个视图的另有 `data-tool-view`，拖的是那个视图；含几个视图的拖的是容器，只能在入口条里换序，输出 46）、浮动窗的头（标签条空白，或它唯一的标签：整窗移动，输出 39）。树里整块面板不能拖（输出 24）。`data-no-drag` 里的按钮既不起拖也不接收，
 * `data-no-drag-start` 只是不起拖（标签上的关闭按钮：拖动经过时它还在标签条里），被菜单、对话框挡住的不接收。编辑组的标签条写 `data-panel-strip`，它的多行、固定分区由编辑器量（`editorTabs`）。
 *
 * 入口条（输出 45、47）：活动栏上段（`data-tool-band`）是侧栏的，右栏、底部面板的在各自卡片顶上（`data-region-strip`）。入口之间新建容器、换序或整个容器搬过来，入口上并入；
 * 判定与放下的结果在 `entry-drop`，这里量入口给它。入口条不走库的落点规则：条不是面板。入口条里并进来的那一节的头不算入口条，是那一节的标题行（输出 25 第 7 行）。
 *
 * 判定是纯读：预览用提交时的同一个函数（`applyLayoutDrop`）算，放回原处的落点只显示、不提交。结构键变了整场取消（输出 32），放下时提交再验一次接受矩阵（领域操作自己验）。
 */

import {applyLayoutDrop, clampFloatRect, enumerateDropCandidates, findTab, isFloating, isPanelShown, isSectionCollapsed, LAYOUT_FLOAT_EDGE_RATIO, LAYOUT_MAX_FLOATS, layoutDropOverPanel, layoutDropPanelAt, layoutDropSectors, layoutSeamsOf, previewEdgeDrop, previewPanelRects, projectLayoutDoc, removeTab, resolveLayoutDrop, tabKey, treeLeaves} from "@notnotype/nb-layout";
import type {GridDropPoint, GridDropRect, GridExtent, GridFloatInput, GridOrientation, GridRect, LayoutDoc, LayoutDropAction, LayoutDropCandidate, LayoutDropInput, LayoutDropPanelGeometry, LayoutDropSector, LayoutDropSectorId, LayoutDropSource, LayoutFloatRect, LayoutPolicy, LayoutProjectionOptions, LayoutSource, PanelName, TabRef} from "@notnotype/nb-layout";
import {createDragSession, layoutMotionMs, measureTabStrip, resolveTabStripInsertion, tabStripInsertionIn, tabStripStops, translateTabStrip} from "@notnotype/nb-layout/vue";
import type {DragSession, TabStripHeld, TabStripSnapshot} from "@notnotype/nb-layout/vue";

import {nextTick, readonly, shallowRef} from "vue";
import type {Ref} from "vue";

import {applyEntryDrop, barSpotAt, barStopsOf, entryDropAt, entryStripOf, isEntryAction, regionOfEntryStrip, soleRegionContainer, workbenchDropKey} from "./entry-drop";
import type {BarEntryRect, ContainerSource, EntryDropAction, WorkbenchDragSource, WorkbenchDropAction} from "./entry-drop";
import {createLiveDrag} from "./live-drag";
import type {LiveCardRefresh, LiveDrag} from "./live-drag";

import {EDITOR_TAB_TYPE, editorTabIdOf} from "../shared/editor-panels";
import {CUSTOM_CONTAINER_PREFIX} from "../shared/views";
import type {EditorTabDrag} from "./contracts";
import {defaultFloatRect, EDITOR_GROUP_MINIMUM, FLOAT_KEEP_WIDTH, floatRectAt, PANEL_HEAD_HEIGHT} from "./state/layout-constraints";
import {regionContainers} from "./state/containers";
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
    /** 要不要算落点分区（设置 `nbook.workbench/dropSectors`）。 */
    sectors(): boolean;
    /** 手感（设置 `nbook.workbench/dragFeel`）；键盘、减少动效、最大化时一律落点指示。 */
    feel(): "live" | "indicator";
    /** 卡片什么时候缩小（设置 `nbook.workbench/dragCardShrink`）。 */
    cardShrink(): "strip" | "panel";
    /** 卡片的尺寸多久写一次（设置 `nbook.workbench/dragCardRefresh`）。 */
    cardRefresh(): LiveCardRefresh;
    /** 把进行中的过渡直接送到终点：拿起后要量矩形。 */
    settleMotion(): void;
    /** 摆预览；null 回到已提交的布局。 */
    showPreview(doc: LayoutDoc | null): void;
    /** 写拿起的内容项的矩形（相对网格根）。跟手的东西直接写元素，不走渲染。 */
    placeCard(rect: GridRect): void;
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
    readonly live: LiveDrag;
    /** 指针在面板上但放不进去（输出 39）：松手取消。 */
    readonly rejected: Readonly<Ref<boolean>>;
    /** 这块面板在这份文档里的矩形（相对网格根）：并入盖层按它画。 */
    panelRectIn(doc: LayoutDoc, panel: string): GridDropRect | null;
    /** 资源树的文件在树外能落到哪（输出 39）：这一场是资源树自己的会话，这里只判定。`top` 是指针处最上层的元素，窗口外是 null。 */
    fileDrop(point: GridDropPoint, top: Element | null): LayoutDragDrop<LayoutDropAction> | null;
    dispose(): void;
}

/** 一次判定要的矩形（视口坐标）。 */
interface DragGeometry {
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


/** 一条入口条在判定里的样子（视口坐标）：活动栏上段竖着排，右栏、底部面板的入口条横着排。 */
interface EntryBand {
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
const offset = (rect: GridDropRect, by: GridDropPoint): GridDropRect => ({left: rect.left + by.x, top: rect.top + by.y, right: rect.right + by.x, bottom: rect.bottom + by.y});
const centerOf = (rect: GridDropRect): GridDropPoint => ({x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2});
const escape = (value: string): string => CSS.escape(value);
const contains = (rect: GridDropRect, point: GridDropPoint): boolean => point.x >= rect.left && point.x < rect.right && point.y >= rect.top && point.y < rect.bottom;

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

/** 实时布局判定用的矩形（`frozen`）：拿起后量一次，收起与展开来源时换一份。 */
interface FrozenGeometry {
    readonly geometry: DragGeometry;
    readonly strips: ReadonlyMap<string, TabStripSnapshot>;
    /** 被拖的标签拿起时的宽度与按下的点占它的比例：在标签条里跟手时判定按它的前缘（输出 38“标签条上”）。量不到（键盘、没有按下的点）是 null，按指针判。 */
    readonly heldTab: TabStripHeld | null;
}

/** 编辑器不让放的落点：哪个标签、放到哪（`answeredByEditor` 答拒绝的那一个）。 */
interface EditorRefusal {
    readonly tab: string;
    readonly drop: LayoutDragDrop<LayoutDropAction>;
}

export function createLayoutDrag(options: LayoutDragOptions): LayoutDrag {
    const {root} = options;
    const surface = (): HTMLElement | null => root.querySelector("[data-workbench-surface]");
    /** 同一个落点的预览只算一次：判定每次指针移动都跑。键里带着容器尺寸：一场里窗口变了，矩形要重算（输出 32）。 */
    const previews = new Map<string, LayoutDragDrop<LayoutDropAction>>();
    /** 预览是按这份文档算的：一场拖动中文档被命令改了（快捷键移动视图），缓存作废。 */
    let previewsOf: LayoutDoc | null = null;
    /** 实时布局判定用的矩形：拿起后第一次判定时量。之后邻居在让位，读 DOM 的话预览会把自己换掉。落点指示每次现量（`geometry`）。 */
    let frozen: FrozenGeometry | null = null;
    /** 这一场新建容器要用的 id（输出 45）：拿起时定，落点每帧比较，判定一次换一个的话落点永远不稳定。 */
    let newContainer = "";
    /**
     * 放进空区域时归哪个容器（ADR 0050 决策 2）：来源是它容器唯一的成员时整个容器搬过去，id 不变（同输出 44 的“移到”、输出 45 的“只换位置”）；
     * 否则是这一场的新容器，和活动栏入口之间新建的是同一个 id。
     */
    const emptyRegionContainer = (doc: LayoutDoc, source: LayoutTabSource): string => {
        const hit = findTab(doc, source.tab);
        const container = hit === null ? undefined : doc.panels[hit.panel]?.container;
        if (container === undefined) return newContainer;
        return Object.values(doc.panels).filter((panel) => panel.container === container).length === 1 ? container : newContainer;
    };
    /** 来源此刻收起着（`collapseSource`）：判定用的是收起后的几何，预览不能把来源摆回来。展开（`expandSource`）、拿起时清掉。 */
    let sourceCollapsed = false;
    /** 收起前的判定几何：回到原处展开时换回它（输出 38）。 */
    let beforeCollapse: FrozenGeometry | null = null;
    /** 这一场按下的点（视口坐标）：键盘拿起是 null。 */
    let pressedAt: GridDropPoint | null = null;
    /** 这一场是整窗拖动：抓住的点相对窗的偏移；窗拿起时呈现的位置与大小（夹位置用）；记录里的大小（提交用：夹取不写回）。 */
    let windowDrag: {readonly panel: string; readonly grab: GridDropPoint; readonly origin: GridDropPoint; readonly from: GridDropPoint; readonly shown: GridExtent; readonly size: GridExtent} | null = null;

    const dpr = (): number => root.ownerDocument.defaultView?.devicePixelRatio ?? 1;
    const view = root.ownerDocument.defaultView;
    const rejected = shallowRef(false);
    /** 这一次判定有没有被拒绝。 */
    let overRejected = false;
    /** 这一次判定里编辑器不让放的落点（`answeredByEditor`）：在它上面松手时仍交给编辑器，由它在同一处拒绝并在组顶部写提示。 */
    let editorRefusal: EditorRefusal | null = null;
    /** 光标在全局样式里按根元素上的标记生效（`WorkbenchDragFeedback`）：拖动中的抓手是 `!important`，写在别处压不过。 */
    function setRejected(next: boolean): void {
        if (rejected.value === next) return;
        rejected.value = next;
        root.ownerDocument.documentElement.toggleAttribute("data-drop-rejected", next);
    }
    const live = createLiveDrag({
        requestFrame: (run) => view?.requestAnimationFrame(run) ?? 0,
        cancelFrame: (frame) => view?.cancelAnimationFrame(frame),
        candidateDoc: (source, drop) => {
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
            if (action.kind === "join-container" && !sourceCollapsed && soleRegionContainer(doc, source, action.region) !== null) return doc;
            // 预览不摆真实结果的落点（输出 38）。浮动：窗此刻就是跟手的卡片。中央：目标不动，只盖一层；放下才换标签。这两种都是来源收起，内容靠拿起留着。
            if (action.kind === "float" || action.kind === "center" || action.kind === "join-container") {
                const result = removeTab(doc, source.tab);
                return result.ok ? result.doc : null;
            }
            const result = applyLayoutDrop(doc, source, action, options.policy());
            return result.ok ? result.doc : null;
        },
        sourceRemovedDoc: (source) => {
            const result = removeTab(options.doc(), source.tab);
            return result.ok ? result.doc : null;
        },
        collapseSource: (source, drop) => {
            const result = removeTab(options.doc(), source.tab);
            if (!result.ok || frozen === null) return;
            beforeCollapse = frozen;
            frozen = collapsed(frozen, options.doc(), result.doc, source);
            sourceCollapsed = true;
            // 预览缓存里并入的矩形是按旧几何算的。
            previews.clear();
            // 照 Trellis：指针再动才按收起后的布局重判。收起时指针下的判定留着，松手（按指针下重判）还是屏幕上这个；被拒绝也留着：松手那次重判命中它，编辑器不让放的要交给编辑器写提示。
            held = {point: session.state.value?.point ?? null, drop, rejected: overRejected, refusal: editorRefusal};
        },
        expandSource: (_source, drop) => {
            if (beforeCollapse === null) return;
            frozen = beforeCollapse;
            beforeCollapse = null;
            sourceCollapsed = false;
            previews.clear();
            // 同收起：指针再动才按拿起时的布局重判，这之前松手还是屏幕上的原位。
            held = {point: session.state.value?.point ?? null, drop, rejected: overRejected, refusal: editorRefusal};
        },
        homeOf: (source) => findTab(options.doc(), source.tab)?.panel ?? null,
        homeStays: (source) => homeStays(options.doc(), source.tab),
        // 一个区域里一个容器唯一的视图：那个区域的入口条就是它自己的，在里面换位、停在别的入口上都不收起来源（输出 45）。
        isHomeStrip: (source, strip) => {
            if (strip === findTab(options.doc(), source.tab)?.panel) return true;
            const region = regionOfEntryStrip(strip);
            return region !== null && soleRegionContainer(options.doc(), source, region) !== null;
        },
        show: (doc) => options.showPreview(doc),
        panelRect: (panel) => {
            const seen = frozen?.geometry;
            return (seen === undefined ? undefined : [...seen.panels, ...seen.floats].find((item) => item.id === panel)?.frame) ?? null;
        },
        gridOrigin: () => {
            const box = root.querySelector("[data-workbench-surface] > [data-grid-scope]")?.getBoundingClientRect();
            return {x: box?.left ?? 0, y: box?.top ?? 0};
        },
        settleDrop: () => session.flush(),
        pointer: () => session.state.value?.point ?? null,
        placeCard: (rect) => options.placeCard(rect),
        placeSorted: (at) => measureSorted(at),
        placeSortedAfterRender: (at) => {
            void nextTick(() => {
                if (live.active.value) measureSorted(at)();
            });
        },
        cardShrink: () => options.cardShrink(),
        cardRefresh: () => options.cardRefresh(),
    });
    /**
     * 指针一动就叫醒实时布局的帧循环（按住不动时它停着），`wake` 不在拖动中时什么都不做。构造时就挂上：窗口上同一阶段的监听按挂上的先后跑，
     * 它要排在会话按下时挂的 `pointermove` 前面，帧循环的帧才排在手势发布的帧前面，帧里先由帧循环做判定（读），再写卡片。
     */
    const wakeLive = (): void => live.wake();
    view?.addEventListener("pointermove", wakeLive, {capture: true, passive: true});

    /**
     * 标签条里排序（输出 38“标签条上”）：被拖的那个标签就是它留着的位置，邻居按预览滑开；它自己显示出来，沿条跟着指针，夹在条的两端之间，不另画拖影。
     * 位置直接写元素的 `translate`（跟手的东西不走渲染）；标签条的换位过渡用 `transform`，两者不打架，占位的那个标签不参与换位过渡（样式里压掉）。
     */
    let sorting: HTMLElement | null = null;
    /** 抓住的点占标签的比例：第一次排序时定，这一场不变，换到别的标签条里也一样。 */
    let sortGrab: number | null = null;
    function sortTargetOf(at: {readonly point: GridDropPoint; readonly panel: string}, tab: string): {readonly frame: HTMLElement; readonly bounds: GridDropRect; readonly vertical: boolean} | null {
        const band = bandAt(geometry(options.doc()).bands, at.point);
        const viewId = viewIdOf(tab);
        if (band !== undefined) {
            if (viewId === null) return null;
            const frame = bandElement(band.region)?.querySelector<HTMLElement>(`[data-tool-view="${escape(viewId)}"]`)?.closest<HTMLElement>("[data-entry-frame]") ?? null;
            return frame === null ? null : {frame, bounds: band.rect, vertical: band.axis === "y"};
        }
        if (options.titleOnly(at.panel)) return null;
        const editor = options.doc().panels[at.panel]?.role === "editor";
        const container = root.querySelector(editor ? `[data-panel-strip="${escape(at.panel)}"]` : `[data-panel-head="${escape(at.panel)}"]`);
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
    /** 读这一次要写什么，返回写的那一步：调用方把写放在这一帧别的读（判定）之后。 */
    function measureSorted(at: {readonly point: GridDropPoint; readonly panel: string} | null): () => void {
        const source = session.state.value?.source;
        const target = at === null || source?.kind !== "tab" ? null : sortTargetOf(at, source.tab);
        const rect = target === null ? null : target.frame.getBoundingClientRect();
        if (target === null || rect === null || at === null) {
            return () => {
                if (sorting !== null) releaseSorted(sorting);
                sorting = null;
            };
        }
        const {frame, bounds, vertical} = target;
        // 此刻写在它上面的位移按元素上的值算，不按记下的：Vue 重渲染可能把整个 style 换掉。
        const written = frame.style.translate.split(" ").map((part) => Number.parseFloat(part));
        const along0 = vertical ? written[1] : written[0];
        const shifted = along0 !== undefined && Number.isFinite(along0) ? along0 : 0;
        const size = vertical ? rect.height : rect.width;
        const resting = (vertical ? rect.top : rect.left) - shifted;
        const along = vertical ? at.point.y : at.point.x;
        sortGrab ??= size > 0 ? Math.min(1, Math.max(0, (along - resting) / size)) : 0.5;
        const [start, end] = vertical ? [bounds.top, bounds.bottom] : [bounds.left, bounds.right];
        const wanted = Math.min(Math.max(along - sortGrab * size, start), Math.max(start, end - size));
        const next = Math.round((wanted - resting) * 100) / 100;
        // Vue 重渲染这个标签时可能整个换掉 style：值对不上就重写，不只看上一次写了什么。
        // 写成浏览器读回来的同一个样子（只有横向时省掉 y），不然每帧都对不上、每帧都重写。
        const value = vertical ? `0px ${String(next)}px` : `${String(next)}px`;
        return () => {
            if (sorting !== null && sorting !== frame) releaseSorted(sorting);
            if (frame.style.translate !== value) frame.style.translate = value;
            if (frame.style.visibility !== "visible") frame.style.visibility = "visible";
            if (frame.style.zIndex !== "1") frame.style.zIndex = "1";
            sorting = frame;
        };
    }
    const stripOf = (panel: string): Element | null => root.querySelector(`[data-panel-strip="${escape(panel)}"] [data-tab-strip]`);

    function geometryOf(doc: LayoutDoc, id: string): LayoutDropPanelGeometry | null {
        // 拖到零的面板，卡片还停在最后的非零尺寸（内容不重排），量的是外框：外框为零，量不到矩形，不是落点。隐藏的区域按拖到零画，同样。
        // 离开了、还在过渡里缩回去的（`data-leaving`）外框还在，也不算：它已经不在布局里，不是落点（docs/specs/ui/nested-grid.md 的“过渡”）。
        const frame = root.querySelector(`[data-leaf="${escape(id)}"]`);
        if (rectOf(frame) === null || frame?.hasAttribute("data-leaving") === true) return null;
        const card = rectOf(root.querySelector(`[data-shell-card="${escape(id)}"]`));
        if (card === null) return null;
        // 工具面板整个头都算标签条（动作区经 `data-no-drag` 不接收）；编辑组的头里还有提示条，只有标签条那一行算，头以下是正文。
        const editor = doc.panels[id]?.role === "editor";
        const head = root.querySelector(editor ? `[data-panel-strip="${escape(id)}"]` : `[data-panel-head="${escape(id)}"]`);
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
        const floats = doc.floats.toReversed().flatMap(({panel}) => (panel === windowDrag?.panel ? [] : (geometryOf(doc, panel) ?? [])));
        const excluded = [root.querySelector("[data-shell-card='activitybar']"), root.querySelector("[data-leaf='statusbar']"), root.querySelector("[data-shell-titlebar]")].flatMap((element) => rectOf(element) ?? []);
        return {panels, floats, excluded, bands: measureBands(), origin: treeOrigin()};
    }

    function treeOrigin(): GridDropPoint {
        const box = surface()?.getBoundingClientRect();
        return {x: box?.left ?? 0, y: box?.top ?? 0};
    }

    const geometry = (doc: LayoutDoc): DragGeometry => frozen?.geometry ?? measureGeometry(doc);

    /** 标签条的量取：实时布局用拿起时量的那份（摘掉了来源：预览里来源已经挪了，标签也在滑）。 */
    function stripSnapshot(panel: string): TabStripSnapshot | null {
        const kept = frozen?.strips.get(panel);
        if (kept !== undefined) return kept;
        const strip = stripOf(panel);
        return strip === null ? null : measureTabStrip(strip);
    }

    /** 一个区域的入口条元素：侧栏是活动栏上段，右栏、底部面板是卡片顶上那一行。 */
    const bandElement = (region: PanelName): Element | null => root.querySelector(region === "sidebar" ? "[data-tool-band]" : `[data-region-strip="${region}"]`);

    /** 看得见的入口，沿入口条的方向：收进“更多”的不在 DOM 里。实时布局用拿起时量的那份（`frozen`）：预览里入口在滑。 */
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

    const bandAt = (bands: ReadonlyArray<EntryBand>, point: GridDropPoint): EntryBand | undefined => bands.find((band) => contains(band.rect, point));
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
        const action = entryDropAt(doc, source, spot, newContainer, band.region);
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

    /** 键盘在入口条上的停靠点（输出 31）：每个空位，和视图能并入的每个入口。 */
    function barStops(band: EntryBand, entries: boolean): ReadonlyArray<GridDropPoint> {
        const {rect, axis} = band;
        const middle = axis === "y" ? (rect.left + rect.right) / 2 : (rect.top + rect.bottom) / 2;
        return barStopsOf(band.entries, axis === "y" ? rect.bottom : rect.right, {entries}).map((along) => (axis === "y" ? {x: middle, y: along} : {x: along, y: middle}));
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
            case "edge": {
                const extent = options.extent();
                if (extent === null) return none;
                const rect = previewEdgeDrop(doc, source, action, options.policy(), options.projection(), extent, dpr());
                return {...none, areaRect: rect === null ? null : offset(rect, geometry(doc).origin)};
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
    function stripDrop(doc: LayoutDoc, source: LayoutDropSource, panel: string, point: GridDropPoint): LayoutDragDrop<LayoutDropAction> | null {
        const snapshot = stripSnapshot(panel);
        // 实时布局里标签条上是排序，被拖的标签自己在条里跟手：按它的位置判，不按指针（抓在标签右半边往左拖时，标签到了最左端指针还没过邻居的中线）。
        const heldTab = source.kind === "tab" && live.active.value ? (frozen?.heldTab ?? null) : null;
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
        const seen = geometry(doc);
        return {action, inPlace, preview: inPlace ? previewOf(doc, source, {kind: "center", panel}, true, [...seen.panels, ...seen.floats]) : preview};
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
        const strips = new Map([...treeLeaves(doc.tree.root).map((leaf) => leaf.id), ...doc.floats.map((float) => float.panel)].flatMap((panel) => {
            const strip = stripOf(panel);
            return strip === null ? [] : [[panel, measureTabStrip(strip, source.tab)] as const];
        }));
        const heldTab = heldTabOf(strips, source);
        frozen = {geometry: measureGeometry(doc), strips, heldTab};
        // 跟手的位置（`measureSorted`）和判定用同一个抓点：标签画在哪，就按哪判。
        if (heldTab !== null) sortGrab = heldTab.grab;
    }

    /**
     * 被拖的标签在标签条里跟手时怎么判：宽度取它拿起时量到的（在自己的标签条里摘掉的那一个；只写标题的头没有标签条，取标题），按下的点在它上面的比例。
     * 拖到别的标签条里它画出来的宽度可能不同（只写标题的头换成标签），判定仍按拿起时的宽度：只差在离两端很近的那一点。
     * 只认按下的点落在里面的那个矩形：从活动栏拖入口时同一个视图的标题在侧栏里，按下的点不在它上面，量它会把抓点夹成 0。
     * 这时是 null，判定按指针，抓点照旧在第一次排序时定（`measureSorted`）。
     */
    function heldTabOf(strips: ReadonlyMap<string, TabStripSnapshot>, source: LayoutTabSource): TabStripHeld | null {
        if (pressedAt === null) return null;
        const rect = [...strips.values()].find((snapshot) => snapshot.excludedRect !== undefined)?.excludedRect ?? rectOf(root.querySelector(`[data-panel-tab="${escape(source.tab)}"]`));
        const width = rect === null ? 0 : rect.right - rect.left;
        if (rect === null || width <= 0 || !contains(rect, pressedAt)) return null;
        return {width, grab: (pressedAt.x - rect.left) / width};
    }

    /**
     * 来源收起之后判定用的几何（输出 38）：按收起后的文档算每块面板挪到哪，不读 DOM，预览怎么摆都不变，判定和预览不会互相牵着来回换。
     * 拿起时量的卡片、头、标签条和面板之间的内外边距不变，所以每块面板按它在两份文档里的矩形差平移、伸缩。收起后不在的面板（来源是它最后一个标签）不再是落点；
     * 回到原处时 `expandSource` 换回拿起时的几何。
     */
    function collapsed(kept: FrozenGeometry, doc: LayoutDoc, base: LayoutDoc, source: LayoutTabSource): FrozenGeometry {
        const extent = options.extent();
        if (extent === null) return kept;
        // 入口条叶只在呈现里，不在文档的树里：按投影一起量（入口条跟着区域挪、缩没了）。
        const stripLeaves = kept.geometry.bands.flatMap((band) => (band.region === "sidebar" ? [] : [entryStripOf(band.region)]));
        const ids = [...treeLeaves(doc.tree.root).map((leaf) => leaf.id), ...stripLeaves];
        const before = previewPanelRects(doc, ids, options.projection(), extent, dpr());
        const after = previewPanelRects(base, ids, options.projection(), extent, dpr());
        // 收起后哪一节并进了入口条（同一个容器剩一节时并进来，第一轮第 2 条后半）：按收起后的投影，不按拿起时的头。
        const mergedAfter = new Map(projectLayoutDoc(base, options.projection()).strips.map((strip) => [strip.region, strip.merged] as const));
        const moves = new Map<string, {readonly left: number; readonly top: number; readonly right: number; readonly bottom: number}>();
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
     * 入口还在的不动：容器少一个分节，入口不变。右栏、底部面板的入口条跟着它的入口条叶挪；区域里的分节都收走了、入口条叶不在了，这条入口条就不是落点；
     * 收起后并进来了一节（`mergedAfter`），落点那一段只到入口这一组为止。
     */
    function bandsAfterCollapse(kept: ReadonlyArray<EntryBand>, base: LayoutDoc, moves: ReadonlyMap<string, {readonly left: number; readonly top: number; readonly right: number; readonly bottom: number}>, mergedAfter: ReadonlyMap<PanelName, string | null>): ReadonlyArray<EntryBand> {
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
            const row = {left: band.row.left + move.left, right: band.row.right + move.right, top: band.row.top + move.top, bottom: band.row.bottom + move.top};
            const groupEnd = band.groupEnd + move.left - shift;
            const merged = mergedAfter.get(band.region) ?? null;
            return [{...band, row, groupEnd, merged, rect: merged === null ? row : {...row, right: groupEnd}, entries: entries.map((entry) => ({...entry, start: entry.start + move.left, end: entry.end + move.left}))}];
        });
    }

    /** 这个来源能浮出来吗（输出 39）：视图可以声明不许；窗数到了上限不行；已经独占一个窗的标签再浮还是它（键盘不列这个落点）。 */
    function canFloat(doc: LayoutDoc, source: LayoutTabSource): boolean {
        const found = findTab(doc, source.tab);
        if (found === null || doc.floats.length >= LAYOUT_MAX_FLOATS) return false;
        const viewId = viewIdOf(source.tab);
        return viewId === null || options.catalog().get(viewId)?.floatable !== false;
    }

    const toGrid = (point: GridDropPoint, {origin}: DragGeometry): GridDropPoint => ({x: point.x - origin.x, y: point.y - origin.y});
    const keepVisible = (rect: LayoutFloatRect): LayoutFloatRect => {
        const extent = options.extent();
        return extent === null ? rect : clampFloatRect(rect, extent, {width: FLOAT_KEEP_WIDTH, height: PANEL_HEAD_HEIGHT});
    };

    /** 新开的窗整个夹回树区域：在状态栏上松手时，只留头在里面就等于开到了屏幕外。拖窗不一样，用户自己摆的，`keepVisible` 只保证抓得到。 */
    const wholeInTree = (rect: LayoutFloatRect): LayoutFloatRect => {
        const extent = options.extent();
        return extent === null ? rect : clampFloatRect(rect, extent, {width: rect.width, height: rect.height});
    };

    /**
     * 明确的无落点：标签在松手处浮动打开（输出 39），反馈画这个矩形。不进预览缓存，矩形每帧变。键盘没有指针，矩形按树区域居中。
     */
    function floatDrop(doc: LayoutDoc, minimum: GridExtent, point: GridDropPoint | null): LayoutDragDrop<LayoutDropAction> {
        const seen = geometry(doc);
        const rect = point === null ? defaultFloatRect(options.extent(), minimum, doc.floats.length) : wholeInTree(floatRectAt(toGrid(point, seen), options.extent(), minimum));
        const areaRect = offset({left: rect.x, top: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height}, seen.origin);
        return {action: {kind: "float", rect}, inPlace: false, preview: {areaRect, indicator: null, orientation: "horizontal"}};
    }

    /** 整窗此刻的矩形：抓住的点在指针下，位置按呈现的大小夹，大小还是记录里的。 */
    function windowRect(drag: NonNullable<typeof windowDrag>, point: GridDropPoint): LayoutFloatRect {
        const at = {x: point.x - drag.origin.x, y: point.y - drag.origin.y};
        const {x, y} = keepVisible({x: at.x - drag.grab.x, y: at.y - drag.grab.y, ...drag.shown});
        return {x, y, ...drag.size};
    }

    /** 有落点时的这一份：动作、原位、反馈。标签与整窗共用。 */
    function dropFor(doc: LayoutDoc, source: LayoutDropSource, resolved: LayoutDropAction, point: GridDropPoint, panels: ReadonlyArray<LayoutDropPanelGeometry>): LayoutDragDrop<LayoutDropAction> | null {
        if (resolved.kind === "strip" && !options.titleOnly(resolved.panel)) return stripDrop(doc, source, resolved.panel, point);
        // 头只写标题的面板没有插入位：落在标题上就是添加为标签。
        const action = resolved.kind === "strip" ? ({kind: "center", panel: resolved.panel} as const) : resolved;
        // 缓存跟着外壳的一场拖动清（`activate`）。文件拖动是资源树的会话，没有这个清理点：每次算。
        const key = source.kind === "new" ? null : JSON.stringify([source, action, options.extent()]);
        const cached = key === null ? undefined : previews.get(key);
        if (cached !== undefined) return cached;
        const result = applyLayoutDrop(doc, source, action, options.policy());
        if (!result.ok) return null;
        // 放回它自己那块的中央、那块摘掉它还在：和别的面板的中央一样是添加为标签（输出 25 第 6 行），松手回到原来的位置、成为活动标签。
        const rejoins = source.kind === "tab" && action.kind === "center" && findTab(doc, source.tab)?.panel === action.panel && homeStays(doc, source.tab);
        const inPlace = result.doc === doc && !rejoins;
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
     * 整窗的判定：窗一直在跟手，所以“放不进”都是移动（输出 39），反馈不画。只有标签条、缝和窄带能停靠，经过中央继续浮着。
     */
    function windowDrop(drag: NonNullable<typeof windowDrag>, source: Extract<LayoutSource, {readonly kind: "panel"}>, point: GridDropPoint): LayoutDragDrop {
        const doc = options.doc();
        const moved: LayoutDragDrop = {action: {kind: "float", rect: windowRect(drag, point)}, inPlace: false, preview: {areaRect: null, indicator: null, orientation: "horizontal"}};
        // 窗经过活动栏继续浮着：停靠只有标签条、缝与窄带（输出 39），活动栏的入口条不收整个窗（输出 45 只说工具视图）。
        const seen = geometry(doc);
        dropOrigin(doc);
        const input: LayoutDropInput = {doc, source, point, panels: seen.panels, floats: seen.floats, excluded: seen.excluded, policy: options.policy(), noCenter: true, edgeRatio: LAYOUT_FLOAT_EDGE_RATIO};
        const resolved = resolveLayoutDrop(input);
        if (resolved === null) return moved;
        const drop = dropFor(doc, source, resolved, point, seen.panels);
        return drop === null ? moved : sectored(drop, resolved, input);
    }

    /** 来源收起、展开那一刻屏幕上的判定（落点，或被拒绝）：指针没动之前一直是它（`collapseSource`）。 */
    let held: {readonly point: GridDropPoint | null; readonly drop: LayoutDragDrop | null; readonly rejected: boolean; readonly refusal: EditorRefusal | null} | null = null;

    function dropAt(source: LayoutTabSource, point: GridDropPoint, region: KeyboardRegion | null): LayoutDragDrop | null {
        if (held !== null) {
            if (region === null && held.point !== null && held.point.x === point.x && held.point.y === point.y) {
                overRejected = held.rejected;
                editorRefusal = held.refusal;
                return held.drop;
            }
            held = null;
        }
        const doc = options.doc();
        if (region?.id === FLOAT_REGION) return canFloat(doc, source) ? floatDrop(doc, options.floatMinimum(source), null) : null;
        if (live.active.value && frozen === null) freeze(doc, source);
        const seen = geometry(doc);
        // 放不进入口条的（编辑器标签、有面板最大化）是取消，不开窗（输出 39“不浮动”）。入口条先判：它不在任何面板上，交给库就成了无落点、浮动打开。
        const band = bandAt(seen.bands, point);
        if (band !== undefined) return entryDrop(source, point, band);
        dropOrigin(doc);
        const {panels} = seen;
        // 键盘的区域是明确选的：别的窗盖着的落点也要能选。
        const floats = region === null ? seen.floats : seen.floats.filter((item) => item.id === region.id);
        const input: LayoutDropInput = {doc, source, point, panels, floats, excluded: seen.excluded, policy: options.policy(), newContainer: emptyRegionContainer(doc, source)};
        const kept = live.stickyDrop(point);
        if (kept !== null) return withSectors(kept, input);
        const resolved = resolveLayoutDrop(input);
        // 只有不在面板上才是“明确的无落点”：在面板上是被拒绝，别的 null 是被挡住、算不出或出错，都不该开窗。键盘的无落点要明确选“浮动”区域。
        if (resolved === null) {
            if (region !== null) return null;
            if (layoutDropOverPanel(input)) {
                overRejected = true;
                return null;
            }
            return canFloat(doc, source) ? floatDrop(doc, options.floatMinimum(source), point) : null;
        }
        // 中央与原位的预览画在落点那块的正文上：落点可能是浮动窗。
        const drop = dropFor(doc, source, resolved, point, [...panels, ...floats]);
        if (drop === null) return null;
        const answered = answeredByEditor(doc, source, drop, point, [...panels, ...floats]);
        if (answered === "refuse") {
            overRejected = true;
            const tab = editorTabIdOf(source.tab);
            editorRefusal = tab === null ? null : {tab, drop};
            return null;
        }
        // 分区按指针下的落点算：并入改成了中央，指针在标签条上时照旧不画分区。
        return sectored(answered, resolved, input);
    }

    /**
     * 编辑器标签放下走编辑器的动作，结果可能和布局层算的不同（docs/specs/workbench/editor.md 输出 55）：拒绝的是被拒绝，两种手感、键盘一样；
     * 并到目标组已开着的同一标签时落点就是那一组的中央，标签条上也是：画的是盖住整组的“添加为标签”，之后的预览、盖层、文字与提交都按中央走，编辑器放到中央不挪留下的那个标签。
     * 原位不问：放下什么都不做，不会被拒绝。每次判定都问、不进预览缓存：未裁决输入在拖动中也会出现、消掉。
     */
    function answeredByEditor(doc: LayoutDoc, source: LayoutTabSource, drop: LayoutDragDrop<LayoutDropAction>, point: GridDropPoint, panels: ReadonlyArray<LayoutDropPanelGeometry>): LayoutDragDrop<LayoutDropAction> | "refuse" {
        const editorTab = editorTabIdOf(source.tab);
        if (editorTab === null || drop.inPlace) return drop;
        const outcome = options.editorTabs()?.dropOutcome(editorTab, drop.action) ?? "move";
        if (outcome === "refuse") return "refuse";
        if (outcome === "move" || drop.action.kind !== "strip") return drop;
        return dropFor(doc, source, {kind: "center", panel: drop.action.panel}, point, panels) ?? drop;
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
        if (resolved === null) return !layoutDropOverPanel(input) && doc.floats.length < LAYOUT_MAX_FLOATS ? floatDrop(doc, EDITOR_GROUP_MINIMUM, point) : null;
        const drop = dropFor(doc, FILE_SOURCE, resolved, point, panels);
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
        if (!options.sectors() || live.active.value || (drop.action.kind === "edge" && drop.action.target.kind === "between")) return drop;
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

    /** 这个落点放回 `dropAt` 能算出它的那个点（键盘用）。 */
    function pointOfCandidate(candidate: LayoutDropCandidate, doc: LayoutDoc, panels: ReadonlyArray<LayoutDropPanelGeometry>): GridDropPoint | null {
        const {action} = candidate;
        if (action.kind === "float") return null;
        if (action.kind === "edge" && action.target.kind === "between") {
            const {before, after} = action.target;
            const seam = layoutSeamsOf(doc, panels).find((item) => item.before === before && item.after === after);
            if (seam === undefined) return null;
            const across = (seam.from + seam.to) / 2;
            return seam.orientation === "horizontal" ? {x: seam.at, y: across} : {x: across, y: seam.at};
        }
        const panelId = action.kind !== "edge" ? action.panel : (action.target.kind === "between" ? null : action.target.panel);
        if (panelId === null) return null;
        const geometry = panels.find((item) => item.id === panelId);
        if (geometry === undefined) return null;
        // 同一个下标可能有两个位置（固定行的行尾、普通行的行首）：取后一个，放下去是普通标签。
        if (action.kind === "strip") return stripStopsOf(doc, panelId).findLast((stop) => stop.index === action.index)?.point ?? null;
        const {body} = geometry;
        const center = centerOf(body);
        if (action.kind === "center") return center;
        const {target} = action;
        if (target.kind === "between") return null;
        const {edge} = target;
        // 收成标题行的分节正文是零高，正文上沿往里 2px 已经落到下一节：它的前半就是标题行（nb-layout 的 `sectionHalf`），停靠点取标题行中心。
        if (edge === "top" && body.bottom <= body.top && geometry.strip !== null) return centerOf(geometry.strip);
        const inset = 2;
        if (edge === "left") return {x: body.left + inset, y: center.y};
        if (edge === "right") return {x: body.right - inset, y: center.y};
        if (edge === "top") return {x: center.x, y: body.top + inset};
        return {x: center.x, y: body.bottom - inset};
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
        const panels = [...seen.panels, ...seen.floats];
        const points = region.candidates.flatMap((candidate) => pointOfCandidate(candidate, doc, panels) ?? []);
        if (points.length > 0 || region.candidates.length > 0) return {axis: "both", points};
        const body = panels.find((geometry) => geometry.id === region.id)?.body;
        return {axis: "both", points: body === undefined ? [] : [centerOf(body)]};
    }

    const fromElement = (element: Element): WorkbenchDragSource | null => {
        const entry = element.closest<HTMLElement>("[data-tool-entry]");
        // 只含一个视图的入口拖的是那个视图（输出 46）；含几个视图的拖的是容器。
        if (entry !== null) return entry.dataset.toolView === undefined ? {kind: "container", container: entry.dataset.toolEntry ?? ""} : {kind: "tab", tab: viewKey(entry.dataset.toolView)};
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

    function resolveDrop({source, point, top, region}: {readonly source: WorkbenchDragSource; readonly point: GridDropPoint; readonly top: Element | null; readonly region: KeyboardRegion | null}): LayoutDragDrop | null {
        // 被菜单、对话框挡住的不接收；键盘没有指针下的元素。指针在窗口外没有元素，算无落点。
        const covered = region === null && top !== null && !root.contains(top);
        if (source.kind === "container") return covered ? null : containerDrop(source, point);
        if (source.kind === "panel") {
            if (windowDrag === null) return null;
            return covered ? null : windowDrop(windowDrag, source, point);
        }
        const onButtons = region === null && top?.closest("[data-no-drag]") != null;
        const drop = covered || onButtons ? null : dropAt(source, point, region);
        live.offer(drop);
        return drop;
    }

    /** 拖含几个视图的入口（输出 46）：只有入口条是落点，别处没有落点、不开窗，也不算被拒绝。 */
    function containerDrop(source: ContainerSource, point: GridDropPoint): LayoutDragDrop | null {
        // 只量入口条：含几个视图的入口不走实时布局，没有冻结的几何，量整份几何（每块面板的头与卡片）每次指针移动都白做。
        const band = bandAt(frozen?.geometry.bands ?? measureBands(), point);
        return band === undefined ? null : entryDrop(source, point, band);
    }

    /** 上一次的落点：画出来一样就还给它同一个对象。手势每帧发布，外壳靠落点的身份判断要不要重画。 */
    let shownDrop: LayoutDragDrop | null = null;
    let shownDropKey = "";
    function stableDrop(next: LayoutDragDrop | null): LayoutDragDrop | null {
        const key = next === null ? "" : JSON.stringify(next);
        if (key === shownDropKey) return shownDrop;
        shownDrop = next;
        shownDropKey = key;
        return next;
    }

    const session = createDragSession<WorkbenchDragSource, LayoutDragDrop, KeyboardRegion>({
        root,
        sourceAt,
        activate: (source, keyboard, at) => {
            previews.clear();
            sortGrab = null;
            pressedAt = source.kind === "tab" && !keyboard ? (at?.pressed ?? null) : null;
            held = null;
            editorRefusal = null;
            shownDrop = null;
            shownDropKey = "";
            frozen = null;
            beforeCollapse = null;
            sourceCollapsed = false;
            windowDrag = null;
            newContainer = `${CUSTOM_CONTAINER_PREFIX}${crypto.randomUUID()}`;
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
                windowDrag = {panel: source.panel, origin, grab: {x: pressed.x - rect.x, y: pressed.y - rect.y}, from: {x: rect.x, y: rect.y}, shown: {width: rect.width, height: rect.height}, size: {width: recorded.width, height: recorded.height}};
                options.markFloatMove(source.panel, recorded);
                return true;
            }
            // 键盘没有指针可跟；减少动效时邻居瞬移看不出去了哪；最大化时别的面板盖着，预览看不见。
            if (!keyboard && options.feel() === "live" && options.maximized() === null && options.extent() !== null && layoutMotionMs(root) > 0) {
                options.settleMotion();
                live.begin(source, at?.point ?? null);
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
        resolve: (input) => {
            overRejected = false;
            editorRefusal = null;
            const drop = stableDrop(resolveDrop(input));
            // 判定读完 DOM 才写。根元素上的标记一变整页都要重算样式（规则里有 `*`），每次移动写两下就是每帧一次全量重算。
            setRejected(overRejected);
            options.moveGhost(input.point);
            // 窗一直跟着指针，放不下也跟。写放在判定读完之后。
            if (windowDrag !== null) {
                const at = windowRect(windowDrag, input.point);
                options.placeFloat(windowDrag.panel, {x: Math.round(at.x) - windowDrag.from.x, y: Math.round(at.y) - windowDrag.from.y});
            }
            return drop;
        },
        commitsUnderPointer: (keyboard) => !keyboard && (live.active.value || windowDrag !== null),
        actionKey: (drop) => (drop.inPlace ? null : JSON.stringify([workbenchDropKey(drop.action), drop.part ?? null])),
        commit: (drop, source, keyboard) => options.commit(source, drop.action, drop.part, keyboard),
        // 编辑器不让放的落点上松手：拖动中只读、不结算，为什么不让要松手才说。照常交给编辑器，它在同一处拒绝（与 `dropOutcome` 同一判据）并在组顶部写提示（docs/specs/workbench/editor.md 输出 55）。
        onEnd: (end, last) => {
            const refusal = editorRefusal;
            editorRefusal = null;
            if (end.kind !== "no-action" || refusal === null) return;
            void options.editorTabs()?.drop(refusal.tab, refusal.drop.action, refusal.drop.part, last.keyboard);
        },
        // 拖动中的光标与禁选在全局样式里按这个标记生效。
        onActiveChange: (active) => {
            root.ownerDocument.documentElement.toggleAttribute("data-workbench-dragging", active);
            if (active) return;
            setRejected(false);
            // 放下、取消、中止都经过这里，并且先于提交：撤预览和提交在同一个同步段，不闪。
            live.end();
            frozen = null;
            beforeCollapse = null;
            if (windowDrag !== null) options.placeFloat(windowDrag.panel, null);
            windowDrag = null;
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
                const alone = home !== undefined && isFloating(doc, home) && doc.panels[home]?.tabs.length === 1;
                const float = canFloat(doc, source) && !alone ? [FLOAT_REGION] : [];
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
    });

    return {
        session,
        live,
        rejected: readonly(rejected),
        panelRectIn,
        fileDrop,
        dispose: () => {
            view?.removeEventListener("pointermove", wakeLive, {capture: true});
            session.dispose();
        },
    };
}
