<script setup lang="ts">
/**
 * 一个公开 Grid：树与几何由宿主给出（`node` + 同一容器下的 `layout`），手势由本组件独占一份会话。
 *
 * - 叶与分隔线是同一父元素的子元素，矩形来自 `placeGrid`（docs/specs/ui/nested-grid.md 的“按矩形摆放”）。树的结构变了只换矩形，
 *   不搬、不重建还在的叶，内容的滚动、输入与焦点都留着。
 * - 一次按下命中的**最多两根轴**（一根 width + 一根 height）属于同一场手势、只提交一次；叶槽里再嵌一个公开
 *   `NestedGrid` 会得到自己的 scope，不会继承外层拖动成员。
 * - 手势期间发布预览布局（编辑器等内容随外框实时变化），松手时才把冻结的 `GridGestureCommit` 交给宿主的
 *   `onGestureCommit`；宿主拒绝就地回滚并给出诊断。
 * - 这里没有百分比往返、不读存储、不写意图：几何算法全在 `grid-geometry` / `sash-drag` / `grid-rects`。
 */
import {computed, nextTick, onBeforeUnmount, provide, ref, shallowRef, useId, watch} from "vue";
import {createGridGestureSession, type GridBranchChange, type GridGestureCancellation, type GridGestureCommit, type GridGesturePreview, type GridGestureStart} from "../grid-gesture";
import {floatPlacements, layerItems, maximizePlacement, placeGrid, type GridContentInput, type GridContentPlacement, type GridFloatInput, type GridLayerItem, type GridLeafPlacement, type GridLeafShape, type GridRect} from "../grid-rects";
import {consumedReleases, floatRectJumps, settleFloatMoves, stableOrder} from "../grid-motion";
import type {GridSwap} from "../grid-swap";
import SashHandle from "./SashHandle.vue";
import {FrozenSlot} from "./frozen-slot";
import {SASH_GESTURE_SCOPE_KEY} from "./sash-scope";
import {useLayoutText} from "./layout-text";
import {gridRectStyle, leafShapeClip, liftedRectStyle, useContentLayer} from "./useContentLayer";
import {useHeldLifted} from "./useHeldLifted";
import {useDevicePixelRatio} from "./useDevicePixelRatio";
import {useGridMotion} from "./useGridMotion";
import {useGridSwap} from "./useGridSwap";
import {useLeafParking} from "./useLeafParking";
import {useGridFocus} from "./useGridFocus";
import {useLayoutExtent} from "./useLayoutExtent";
import {useRenderOrder} from "./useRenderOrder";
import {useSashPresentation} from "./useSashPresentation";
import {useSashGesture} from "./useSashGesture";
import {useSashSnap} from "./useSashSnap";
import {layoutMotionMs} from "./layout-motion";
import {commitFailure} from "../grid-failure";
import {describeValue, gridDevWarner, isCommitResult, layoutDevChecksEnabled, onlyZeroWidthBoundaries} from "../dev-checks";
import {usableExtent} from "../grid-geometry";
import {gridIssue} from "../grid-issue";
import type {GridExtent, GridFailure, GridIssue, GridIssueCode, GridLayoutResult, GridLeaf, GridNode} from "../grid-types";
import type {SashGestureBinding, SashGestureHost} from "../sash-gesture";

defineOptions({name: "NestedGrid"});

const props = withDefaults(defineProps<{
    /** 当前的树：叶交给 `leaf` 插槽，`null` 交给 `empty` 插槽。 */
    node: GridNode<unknown> | null;
    /** 与 `node` 同源的呈现结果；约束按「能够承载的语法」直接消费，不再夹取。 */
    layout: GridLayoutResult;
    disabled?: boolean;
    /** 副作用上下文（工作面 / 布局键）：与 `revision` 一起构成手势开始时冻结的外部事实。 */
    contextKey?: string;
    /** 外部版本：树、约束或容器尺寸变化时递增；进行中的手势据此失效。 */
    revision?: number;
    /** 同步接纳一次手势提交：失败（Spec 失败 6）时本组件回滚预览并给出诊断。 */
    onGestureCommit?: (commit: GridGestureCommit) => {readonly ok: true} | GridFailure;
    /** 内容层（docs/specs/ui/nested-grid.md 输出 80）：和叶外框同一父元素的内容，换叶不重建。不传时内容放在 `leaf` 插槽里。 */
    contents?: ReadonlyArray<GridContentInput>;
    /**
     * 最大化（docs/specs/ui/nested-grid.md 输出 97）：这块叶盖住除 `exclude` 以外全部叶的外接矩形，别的面板不动。只在内存，宿主决定。
     * `exclude` 里的叶只有落在这个外接矩形之外才露出来，夹在别的叶中间的照样被盖住（同名 .md 的“最大化”）。
     */
    maximized?: {readonly leaf: string; readonly exclude: ReadonlyArray<string>} | null;
    /** 拿起的内容项（实时布局）：盖在别的面板与分隔线上跟手，不接指针。矩形由 `placeLifted` 写。变成 null 时飞回它的叶。 */
    lifted?: {readonly key: string} | null;
    /** 宿主的拖动进行中（不论内容拿没拿起）：这期间离开的叶照旧立即消失，不留着缩回去。来源离开是拖动的一部分，留着的外框会被落点判定撞上。 */
    dragging?: boolean;
    /**
     * 宿主自己的尺寸手势进行中（网格之外的手柄，例如工作台侧轨的轨宽手柄）：这期间布局的变化跟手、不过渡，手势结束那一次也不过渡，
     * 同网格自己的分隔线手势预览。
     */
    gesturing?: boolean;
    /**
     * 没有内容也要在离开时留着缩回去的叶（docs/specs/ui/nested-grid.md 输出 45）：外框本身就是要看的东西，例如工作台的侧轨。
     * 不在这里的空叶离开时照旧立即消失。
     */
    keepLeaving?: ReadonlySet<string>;
    /** 浮动窗（docs/specs/ui/nested-grid.md 输出 101）：不在树里的叶，后面的压在前面的上面。矩形相对网格根，只有矩形变了不过渡。 */
    floats?: ReadonlyArray<GridFloatInput>;
    /** 分隔线的种类，写到 `data-sash-kind`，宿主据此给不同的线不同的颜色（`--nb-layout-splitter-seam`）。`before`、`after` 是线两侧节点的 id，孩子是分支时就是分支 id（同名 .md 的“分隔线的身份”）。 */
    sashKind?: ((sash: {readonly branch: string; readonly before: string; readonly after: string}) => string | undefined) | undefined;
    /**
     * 写在分隔线元素上的内联样式（多半是 CSS 变量），宿主据此在线所占的那一条里画东西，例如两张拼起来的卡片之间那一条的底色。
     * 位置与尺寸由网格写，这里给的同名属性被覆盖。
     */
    sashStyle?: ((sash: {readonly branch: string; readonly before: string; readonly after: string}) => Record<string, string> | undefined) | undefined;
    /**
     * 宿主让这条分隔线此刻不能拖（指针、键盘都不行，线照画）：例如一列分节全部收成标题行时（垫底的那一节在吸收余量，拖开时预览与结果对不上）。
     * 不给就都能拖；交换里滑出去的、零长的线照旧不能拖。`before`、`after` 同 `sashKind`，可能是分支 id。
     * 每次渲染分隔线时都调、不缓存：读响应式状态，结果才跟着它变。
     */
    sashDisabled?: ((sash: {readonly branch: string; readonly before: string; readonly after: string}) => boolean) | undefined;
    /**
     * 节点的显示名（宿主翻译好的），代进分隔线的读屏名称“调整 {before} 与 {after} 的宽度”；挨着分支时问分支 id。没给、返回 `undefined` 或空串时用节点 id。
     * 按节点问而不是按分隔线问：同一块挨着几条线时名字一样，宿主一张表就够。
     */
    paneLabel?: ((id: string) => string | undefined) | undefined;
    /**
     * 宿主在叶的外框里画成的卡片（`GridLeafShape`）。过渡中外框露出、盖住保持尺寸的内层时，外框与内容外层按它裁，露出来的一截始终是一张完整的卡片；
     * 不给时按外框的矩形裁。
     */
    leafShape?: ((leaf: string) => GridLeafShape | undefined) | undefined;
    /**
     * 交换（docs/specs/ui/nested-grid.md 输出 61，时序见“状态与转换”的“时序与寿命”第 4 条）：下一次布局变化里一组叶换成另一组时像胶片一样整块平移。和这次布局变化在同一个同步段里给，
     * `token` 变了才算一次新的；只用于 `token` 变了之后的第一次布局变化，这一轮刷新结束就作废。
     */
    swap?: GridSwap | null;
}>(), {
    disabled: false,
    contextKey: "",
    revision: 0,
    onGestureCommit: undefined,
    contents: () => [],
    maximized: null,
    lifted: null,
    dragging: false,
    gesturing: false,
    floats: () => [],
    sashKind: undefined,
    sashStyle: undefined,
    sashDisabled: undefined,
    leafShape: undefined,
    swap: null,
});

const emit = defineEmits<{
    (e: "gesture-start", info: GridGestureStart): void;
    (e: "gesture-update", preview: GridGesturePreview<unknown>): void;
    (e: "gesture-end", commit: GridGestureCommit): void;
    (e: "gesture-cancel", info: GridGestureCancellation): void;
    /** 诊断与被拒的提交（Spec 输出 139、140）：带 `ok` 的（`"ok" in issue`）是被拒的提交，已经回滚。 */
    (e: "issues", issues: readonly (GridIssue<GridIssueCode | "not-published"> | GridFailure)[]): void;
    /** 内容项要被停放，这一刻焦点还在里面：宿主决定焦点去哪。 */
    (e: "content-parked", key: string): void;
    /**
     * 量到的根盒（Spec 输出 144）：挂载后量到就发、两轴变了才再发，同步发；卸载前发 null。宿主据此算布局（`useGridHost` 接它），
     * 所以宿主不用自己再量一遍承载盒。
     */
    (e: "extent", extent: GridExtent | null): void;
    /**
     * 抬升的请求（Spec 输出 173）：指针在一扇浮动窗上按下（捕获阶段判，手柄阻止冒泡也收得到；外框、内容、手柄层，含其中嵌的网格），或焦点进入它，
     * 它又不是 `floats` 的最后一个。网格不改次序，宿主把它挪到 `floats` 末尾。
     */
    (e: "float-raise", id: string): void;
}>();

defineSlots<{
    leaf(props: {node: GridLeaf<unknown>}): unknown;
    content(props: {contentKey: string; leaf: string; active: boolean}): unknown;
    /** 拿起的内容项的头：卡片上面那一条。 */
    "lifted-head"?(props: {contentKey: string}): unknown;
    /** 盖在分隔线之上、拿起的内容之下的一层（实时布局的分区、空位），不接指针。 */
    overlay?(): unknown;
    /** 浮动窗的手柄：网格根的直接子元素，矩形同浮动窗，叠在它的内容上面（放在外框里会被内容层盖住）。外层不接指针，里面的控件自己开。 */
    "float-chrome"?(props: {id: string; rect: GridRect}): unknown;
    /**
     * 交换进行中静止的底：一层在所有外框下面、矩形是两组外框的外接矩形，交换结束（滑出去的项摘掉的同一次渲染）就摘掉。`inset` 是裁切窗在这一层里的四边内缩
     * （px：上、右、下、左），`radius` 是窗的四个角；宿主在里面画不动的东西（例如一张卡片，外框这期间不画自己的卡片），内容在它上面滑。
     */
    "swap-backdrop"?(props: {inset: readonly [number, number, number, number]; radius: readonly [string, string, string, string] | null}): unknown;
    empty(): unknown;
}>();

const instanceId = useId();
const rootEl = ref<HTMLElement | null>(null);
const preview = shallowRef<GridGesturePreview<unknown> | null>(null);
/** 会话根盒来自共享的布局盒测量：未挂载是 `null`，与「真实零尺寸」区分。 */
const measuredExtent = useLayoutExtent(rootEl);
// 同步发：工作台的 store 用尺寸算投影，晚一拍就会用旧树算新尺寸的布局。
watch(measuredExtent, (next) => emit("extent", next), {flush: "sync"});
let sessionCounter = 0;

/** 手势期间渲染预览；提交被拒绝、取消或宿主发布新布局后回到受控事实。 */
const renderTree = computed(() => preview.value?.tree ?? props.node);
const renderLayout = computed(() => preview.value?.layout ?? props.layout);

const dpr = useDevicePixelRatio();
const text = useLayoutText();
const snapHost = useSashSnap(rootEl);

const parking = useLeafParking();
const {parked} = parking;
const motion = useGridMotion({root: rootEl, onSettled: () => snapHost.schedule(), onSwapSkipped: (issue) => emit("issues", [issue])});
const {moving, growing, docking, following, flying, keptSize, anchoredRight, held} = motion;
/** 离开了、在过渡里留着缩回去的叶（docs/specs/ui/nested-grid.md 输出 48）：算降到零的叶，停放、不可交互，只是过渡结束前还画着。 */
const leavingLeaves = computed<ReadonlySet<string>>(() => new Set(motion.leaving.value.flatMap((item) => (item.kind === "leaf" ? [item.node.id] : []))));
/** 缩回去、过渡结束前还画着的叶：留着缩回去的离开的叶，和这一轮降到零的叶（`shrinkingLeaves`）。停放、不可交互。 */
const outgoingLeaves = computed<ReadonlySet<string>>(() => (motion.shrinking.value.size === 0 ? leavingLeaves.value : new Set([...leavingLeaves.value, ...motion.shrinking.value])));
const {swapSide, swapSideOf, swapBackdrop, swappingLeaves, swapClipStyle, offerSwap, takeSwap} = useGridSwap(motion.band);
watch(() => props.swap?.token, () => offerSwap(props.swap), {flush: "sync"});

/** 摆放的容器：实测盒；还没挂上时退回布局发布的根节点尺寸。 */
const placementExtent = computed<GridExtent>(() => rootExtent() ?? {width: 0, height: 0});
/** 树的摆放：和浮动窗分开算，拖窗时它不失效，也不用重新对齐分隔线。 */
const treePlacement = computed(() => {
    const root = renderTree.value;
    if (root === null) return null;
    const placed = placeGrid(root, renderLayout.value, placementExtent.value, dpr.value);
    return props.maximized == null ? placed : {items: maximizePlacement(placed.items, props.maximized.leaf, props.maximized.exclude)};
});
const placement = computed(() => {
    const tree = treePlacement.value;
    const leavers = motion.leaving.value;
    if (tree === null || (props.floats.length === 0 && leavers.length === 0)) return tree;
    return {items: [...tree.items, ...leavers, ...floatPlacements(props.floats)]};
});
/** 被盖住的叶：除了最大化的那块和 `exclude`（条）。浮动窗在最大化的面板上面，不算。 */
const obscuredLeaves = computed<ReadonlySet<string>>(() => {
    const maximized = props.maximized;
    if (maximized == null) return new Set();
    return new Set((treePlacement.value?.items ?? []).flatMap((item) => (item.kind === "leaf" && item.node.id !== maximized.leaf && !maximized.exclude.includes(item.node.id) ? [item.node.id] : [])));
});
/** 浮动窗的层级：外框、内容、手柄各一档，后面的压在前面的上面。写在元素上：内容换叶后 DOM 位置不变，不靠 DOM 序。 */
const FLOAT_Z_BASE = 10;
const floatAt = computed(() => new Map(props.floats.map((float, index) => [float.id, index])));
const floatGestures = computed(() => new Map(props.floats.flatMap((float) => (float.gesture === undefined ? [] : [[float.id, float.gesture] as const]))));
/** 上一次判过渡时带着手势的窗：手势撤掉与矩形变化在同一次渲染里（缩放、整窗拖动的提交）时，它的 `animate` 不算（输出 105）。 */
let lastGestures: ReadonlySet<string> = new Set();
/** 拖动中每扇窗最后一次的偏移（`placeFloat`），放开时转进 `released`。 */
const floatOffsets = new Map<string, {readonly x: number; readonly y: number}>();
/**
 * 刚放开的窗（id 到松手时的偏移，输出 172）：每次判过渡时交给 `motion.update`，按窗用掉（`consumedReleases`：窗离开了 `floats` 或矩形变了），
 * 别的更新不清它：宿主可能先撤手势、`nextTick` 之后才停靠。没有用掉的（取消、只撤了手势）下一帧清掉，不留到以后误用。
 * 所以宿主在 `placeFloat(id, null)` 之后、下一帧之前发布的变化从松手处出发，更晚发布的照旧从记录矩形出发。
 */
let released = new Map<string, {readonly x: number; readonly y: number}>();
let releaseFrame: number | null = null;
function clearReleased(): void {
    if (releaseFrame !== null) cancelAnimationFrame(releaseFrame);
    releaseFrame = null;
    released = new Map();
}
/**
 * 这一轮改了矩形、不过渡的浮动窗（节点 id，`floatRectJumps`，输出 105、172）：别的窗或树正在过渡（`moving`）时，它的外框、内容与手柄在写新矩形的那一次渲染不带过渡标记，
 * 直接画在新矩形上；别的窗与树上的过渡照走。渲染之后（`nextTick`）清掉：那时新矩形已经画上，再带回标记也不会从旧矩形滑过去。
 * 不按每次判定现算：同一轮刷新里侦听会重入（起点经内容层改了 `layers`），重入时上一次的项已经是新矩形，现算是空的，渲染就带上了标记。
 */
const floatJumps = shallowRef<ReadonlySet<string>>(new Set());
let floatJumpsClearing = false;
function holdFloatJumps(jumps: ReadonlySet<string>): void {
    floatJumps.value = new Set([...floatJumps.value, ...jumps]);
    if (floatJumpsClearing) return;
    floatJumpsClearing = true;
    void nextTick(() => {
        floatJumpsClearing = false;
        floatJumps.value = new Set();
    });
}
function floatLayer(leaf: string, part: 0 | 1 | 2): Record<string, string> {
    const at = floatAt.value.get(leaf);
    return at === undefined ? {} : {zIndex: String(FLOAT_Z_BASE + at * 3 + part)};
}
/**
 * 浮动窗之间不随叠放变的次序（`stableOrder`：还在的保持相对次序，新的排在它在 `floats` 里前一扇之后）。`floats` 的次序是叠放（Spec 输出 103），
 * 每次按下或焦点进窗都会变（输出 173），所以两样东西不按它、按这里：
 * - 手柄层的渲染次序：按 `floats` 渲染的话，抬升会让 Vue 搬手柄层的节点，按在手柄上的焦点就丢了；
 * - 导航序（`navLayers`）里窗的先后：按叠放的话，Tab 进一扇窗它就成了最后一项，走出它的正文就离开网格，回到页面前面重走。
 * 理由同 `useRenderOrder`：必须在 `computed` 里同步算，每轮只算一次，“上一轮”不会漂移；不要在它之外再读 `renderedFloats`。
 */
let renderedFloats: string[] = [];
const floatOrder = computed<ReadonlyArray<string>>(() => {
    renderedFloats = stableOrder(renderedFloats, props.floats.map((float) => float.id));
    return renderedFloats;
});
const chromeFloats = computed<ReadonlyArray<GridFloatInput>>(() => {
    const byId = new Map(props.floats.map((float) => [float.id, float]));
    return floatOrder.value.map((id) => byId.get(id) as GridFloatInput);
});
/** 手柄层的元素，按 DOM 序（即 `floatOrder`）：Tab 接管时排在所有窗的正文之后（`useGridFocus` 的 `floatChrome`）。 */
function chromeElements(): HTMLElement[] {
    const root = rootEl.value;
    if (root === null) return [];
    return [...root.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child.dataset.floatChrome !== undefined);
}
/**
 * 事件落在哪扇浮动窗上：从目标往上走到网格根的直接子元素（外框、内容、手柄层），读它的标记。嵌在窗内容里的网格的元素也走到外层这扇窗；
 * 不在窗上（树里的叶、分隔线、盖层）时为 null。
 */
function floatOfTarget(target: EventTarget | null): string | null {
    const root = rootEl.value;
    let element = target instanceof Element ? target : null;
    while (element !== null && element.parentElement !== root) element = element.parentElement;
    if (!(element instanceof HTMLElement)) return null;
    const id = element.dataset.leaf ?? element.dataset.contentLeaf ?? element.dataset.floatChrome;
    return id !== undefined && floatAt.value.has(id) ? id : null;
}
/** 按下或焦点进入一扇窗时请求抬升（输出 173）；已在最上面不发。 */
function requestRaise(target: EventTarget | null): void {
    const id = floatOfTarget(target);
    if (id !== null && floatAt.value.get(id) !== props.floats.length - 1) emit("float-raise", id);
}
function onFocusin(event: FocusEvent): void {
    focus.onFocusin(event);
    requestRaise(event.target);
}
/** 叶的卡片形状（`leafShape`）。浮动窗不按它裁：窗的投影画在外框自身，外框一裁就没了。 */
function shapeOf(leaf: string): GridLeafShape | undefined {
    return floatAt.value.has(leaf) ? undefined : props.leafShape?.(leaf);
}
/**
 * 过渡中外框露出、盖住保持尺寸的内层（`keptSize` 的叶）：外框按卡片裁（`leafShapeClip`）；别的叶内层跟着外框，外框自己的矩形就是卡片的边。
 * 形状伸出外框（`fill`）时，伸出去的部分用外框自己的投影画（投影不受自己的 `overflow` 裁，里面的东西照旧裁在外框里），扩展量取伸得最远的一边，
 * 再由 `clip-path` 裁成形状；外框压到别的外框下面（它们是 `z-index: auto`、按 DOM 序叠的同一档，内容层在 1）。
 */
function frameClip(item: GridLeafPlacement<unknown>): Record<string, string> {
    const shape = keptSize.value.has(item.key) ? shapeOf(item.node.id) : undefined;
    if (shape === undefined) return {};
    if (shape.fill === undefined) return {clipPath: leafShapeClip(shape)};
    const reach = `max(0px, ${shape.inset.map((inset) => `calc(-1 * (${inset}))`).join(", ")})`;
    return {clipPath: leafShapeClip(shape), boxShadow: `0 0 0 ${reach} ${shape.fill}`, zIndex: "-1"};
}
/** 这一刻外框按 `leafShape` 裁的叶（节点 id）：过渡中外框露出、盖住保持尺寸的内层的那些，过渡结束就空了。 */
const shapedLeaves = computed<ReadonlySet<string>>(() => new Set((placement.value?.items ?? []).flatMap((item) => (item.kind === "leaf" && keptSize.value.has(item.key) && !floatAt.value.has(item.node.id) ? [item.node.id] : []))));
/** 最大化期间没有分隔线可拖。 */
const gesturesDisabled = computed(() => props.disabled || props.maximized != null);
/** 压在别的面板上面的那块叶：还原的过渡结束之前它还要在上面。 */
const raisedLeaf = shallowRef<string | null>(null);


/** 拿起的内容项此刻的矩形。跟手的东西不走渲染：每帧走属性的话，这个组件和每块叶的插槽都要重跑。 */
let liftedRect: GridRect = {x: 0, y: 0, width: 0, height: 0};

const layerContents = useHeldLifted({contents: () => props.contents, lifted: () => props.lifted});

const contentLayer = useContentLayer({
    contents: () => layerContents.value,
    leaving: () => motion.leavingContents.value,
    items: () => placement.value?.items ?? [],
    dpr,
    parkedLeaves: parked,
    growing,
    following,
    flying,
    keptSize,
    shape: shapeOf,
    previewing: () => preview.value !== null || props.gesturing,
    measured: () => usableExtent(placementExtent.value),
    obscuredLeaves: () => obscuredLeaves.value,
    outgoingLeaves: () => outgoingLeaves.value,
    held: () => held.value,
    moving: () => moving.value,
    holdsFocus: (key) => {
        // 经 `getRootNode` 取：grid 可能在 Shadow DOM 里。
        const host = rootEl.value?.getRootNode() as Document | ShadowRoot | undefined;
        const element = host?.getElementById(domIdOf(key));
        return element != null && host?.activeElement != null && element.contains(host.activeElement);
    },
    onParked: (contentKey) => emit("content-parked", contentKey),
    swapClip: (item, rect) => swapClipStyle(item, rect).clipPath,
    lifted: () => props.lifted,
    liftedRect: () => liftedRect,
});
/** 渲染层的全部项，树序：每块叶后面紧跟属于它的内容。 */
const layers = computed<ReadonlyArray<GridLayerItem<unknown>>>(() => layerItems(placement.value?.items ?? [], contentLayer.placements.value));
/**
 * 面板头（`leaf` 插槽）停在最后一次渲染的叶（输出 156）：有库留着的内容项时，留着缩回的离开的叶都冻。离开的叶按子树整组留（`leavingPlacements`），
 * 一列里只要有一块带着留着的内容，同列别的叶也留着，宿主多半已经一起删了它们的数据。交换里滑出去的叶、没有留着的内容时的离开的叶（区域隐藏）照常渲染：
 * 宿主还有它们，插槽要读到这一轮的 `moving`、`swappingLeaves` 这些值（“时序与寿命”）。读内容层去重之后的项：宿主又给回同一个 key 的不算。
 */
const frozenLeaves = computed<ReadonlySet<string>>(() => {
    if (!contentLayer.placements.value.some((item) => item.leaving === true)) return new Set();
    return new Set([...leavingLeaves.value].filter((id) => swapSide.value.leaves.get(id) !== "out"));
});

/**
 * 导航序：Tab、F6 与读屏走的树序（Spec 输出 101、121、132），也是渲染序列的依据。和 `layers` 只差浮动窗之间的先后：`layers` 里窗按 `floats`
 * 的叠放次序排，这里按 `floatOrder`（理由见那里）。窗的项在 `layers` 里排在树后面、连成一段，这里在那一段的位置上按 `floatOrder` 重排，
 * 每扇窗的外框与内容项保持原来的相对次序。
 */
const navLayers = computed<ReadonlyArray<GridLayerItem<unknown>>>(() => {
    const items = layers.value;
    const floats = floatAt.value;
    if (floats.size < 2) return items;
    const floatOf = (item: GridLayerItem<unknown>): string | null => {
        const id = item.kind === "leaf" ? item.node.id : item.kind === "content" ? item.leaf : null;
        return id !== null && floats.has(id) ? id : null;
    };
    const groups = new Map<string, GridLayerItem<unknown>[]>();
    for (const item of items) {
        const id = floatOf(item);
        if (id === null) continue;
        const group = groups.get(id);
        if (group === undefined) groups.set(id, [item]);
        else group.push(item);
    }
    const result: GridLayerItem<unknown>[] = [];
    let placed = false;
    for (const item of items) {
        if (floatOf(item) === null) {
            result.push(item);
            continue;
        }
        if (placed) continue;
        placed = true;
        for (const id of floatOrder.value) result.push(...(groups.get(id) ?? []));
    }
    return result;
});

// 交换里滑出去的分隔线对读屏隐藏（`detached`），不列进 `aria-owns`。
const order = useRenderOrder(navLayers, instanceId, (item) => (item.kind === "content" && contentLayer.isParked(item)) || (item.kind === "sash" && item.leaving === true));
const {domIdOf} = order;
const focus = useGridFocus({root: rootEl, layers: navLayers, order, floatChrome: chromeElements});

/** 分隔线控制的窗格：外框里只剩面板头时，真正被调整的是活动的内容。 */
function controlledIds(leaf: string): string {
    const frame = domIdOf(`leaf:${leaf}`);
    const content = contentLayer.placements.value.find((item) => item.leaf === leaf && item.active);
    return content === undefined ? frame : `${frame} ${domIdOf(content.key)}`;
}

const {sashKindOf, sashBoxStyle, sashProps} = useSashPresentation({
    host: props,
    layers: () => layers.value,
    layout: () => renderLayout.value,
    gesturesDisabled: () => gesturesDisabled.value,
    growing: () => growing.value,
    swapClip: swapClipStyle,
    domIdOf,
    controlledIds,
    text,
});

/**
 * 内容项带不带过渡标记。用着起点矩形（`growing`，键见 `startKey`：停放过的内容随新叶长出来、换成按叶的矩形摆的那一帧、落地的卡片）的那一次渲染不带：
 * 它是早就挂着的元素，带着过渡写起点，浏览器就开始一段从停放时的矩形到起点的过渡，紧接着写终点时这段过渡就地反向取消，看起来是一下子到终点。
 * 起点立即生效，下一次写终点时再带上，过渡才从起点开始。新出现的元素没有上一帧的样式，带不带都一样。
 */
function contentMoving(item: GridContentPlacement): boolean {
    return moving.value && item.active && !contentLayer.isLifted(item) && !growing.value.has(contentLayer.startKey(item)) && !floatJumps.value.has(item.leaf);
}

/**
 * 外框与分隔线带不带过渡标记：同 `contentMoving`，用着起点矩形的那一次渲染不带。新建的元素带不带都一样；还挂着的元素（缩回去中途又回来的叶，
 * 例如拖动预览里来源缩回去、放下又出现在别处）带着标记写起点，会从它此刻的位置一路飞过去，而不是从起点长出来。
 */
function structureMoving(key: string): boolean {
    return moving.value && !growing.value.has(key);
}

/** 叶外框带不带过渡标记：同 `structureMoving`，这一轮改了矩形、不过渡的浮动窗（`floatJumps`）不带。 */
function frameMoving(item: GridLeafPlacement<unknown>): boolean {
    return structureMoving(item.key) && !floatJumps.value.has(item.node.id);
}

function contentStyle(item: GridLeafPlacement<unknown>): Record<string, string> {
    if (following.value.has(item.key)) return {width: "100%", height: "100%"};
    const size = parking.contentSize(item);
    // 缩回去的叶（离开的、降到零的）也停放着（不可交互），但过渡结束前还要看得见。
    return {width: `${size.width}px`, height: `${size.height}px`, ...(parked.value.has(item.node.id) && !outgoingLeaves.value.has(item.node.id) ? {visibility: "hidden"} : {})};
}

let snappedTree: typeof treePlacement.value = null;
/**
 * 布局与拿起的内容项一起看：放下时提交与撤卡片在同一个同步段，这一次回调里同时有放下前后的布局，落地时才判断得了内容落进的叶是不是这次才出现的。
 * 落地：这个内容项不跟着外框逐帧变化。落进的是这次才出现的叶（拖出来的浮动窗）时，叶的外框与窗的把手也从卡片的矩形长到终点，和内容一起；
 * 不然它们直接画在终点（手势收尾的布局变化不过渡），内容再慢慢飞进去。两样分在两次回调里到时，落地那次的布局还是放下前的，内容只是不带外框地飞。
 */
watch([layers, () => props.lifted?.key ?? null] as const, ([next, liftedKey], old) => {
    const previous = old?.[0];
    // 分隔线的矩形变了要重新对齐设备像素。只有浮动窗在动时树没变，不用读 DOM。
    if (treePlacement.value !== snappedTree) {
        snappedTree = treePlacement.value;
        snapHost.schedule();
    }
    // 先判过渡，再停放：这一次有叶离开、要留着缩回去时，停放与内容层要把它当作还在（降到零），否则先丢了它最后的尺寸。
    const root = renderTree.value;
    const releasing = released;
    // 标了 `animate`、这一次与上一次都不在手势里、不是刚放开的窗：矩形变化照常过渡（输出 105）。
    const animated = new Set(props.floats.flatMap((float) => (float.animate === true && float.gesture === undefined && !lastGestures.has(float.id) && !releasing.has(float.id) ? [float.id] : [])));
    const jumps = previous === undefined ? new Set<string>() : floatRectJumps(next, previous, animated);
    motion.update({
        items: previous === undefined ? next : settleFloatMoves(next, previous, animated),
        previous: previous ?? null,
        rootSize: root === null ? null : (props.layout.sizes[root.id] ?? null),
        extent: placementExtent.value,
        dpr: dpr.value,
        previewing: preview.value !== null || props.gesturing,
        holding: liftedKey !== null || props.dragging,
        ...(props.keepLeaving === undefined ? {} : {keepEmpty: props.keepLeaving}),
        swap: takeSwap(),
        ...(releasing.size === 0 ? {} : {released: releasing}),
    });
    lastGestures = new Set(floatGestures.value.keys());
    // 没有过渡时本来就不带标记，不用记（拖着缩放时每一帧都改矩形）。
    if (jumps.size > 0 && moving.value) holdFloatJumps(jumps);
    if (releasing.size > 0) {
        for (const id of consumedReleases(next, previous ?? [], releasing)) released.delete(id);
        if (released.size === 0) clearReleased();
    }
    const items = placement.value?.items ?? [];
    parking.update(items, preview.value !== null);
    contentLayer.update();
    if (props.maximized != null) raisedLeaf.value = props.maximized.leaf;
    const before = old?.[1] ?? null;
    if (liftedKey !== null || before === null) return;
    const key = `content:${before}`;
    const landed = next.find((item) => item.kind === "content" && item.key === key);
    const leaf = landed?.kind === "content" ? `leaf:${landed.leaf}` : null;
    const known = (previous ?? []).some((item) => item.key === leaf);
    // 卡片跟手时位置在 `transform` 上，落到叶上换回 `left`/`top`：这一帧先不带过渡写在卡片的矩形上，下一帧再过渡到叶，不让两种位置一起过渡（又是两个线程各走各的）。
    const entering = new Map([[key, liftedRect]]);
    if (leaf !== null && !known) entering.set(leaf, liftedRect);
    // 并进已有的叶：它刚才显示着的内容留在卡片下面，等卡片长满（不然放下的那一刻叶就空了，卡片在空的叶里长）。
    const into = landed?.kind === "content" ? landed.leaf : null;
    const kept = known ? (previous ?? []).flatMap((item) => (item.kind === "content" && item.leaf === into && item.active && item.key !== key ? [item.key] : [])) : [];
    motion.land(key, entering, new Set(kept));
}, {immediate: true});

/**
 * 会话的根盒：优先用本组件实测盒（宿主正是按这个盒算布局），拿不到测量时退回布局发布的根节点尺寸。
 * 两者都拿不到（未挂载 / 无布局）时不开始手势。
 */
function rootExtent(): GridExtent | null {
    if (measuredExtent.value !== null) {
        return measuredExtent.value;
    }
    const root = renderTree.value;
    if (root === null) {
        return null;
    }
    const size = renderLayout.value.sizes[root.id];
    if (size === undefined) {
        return null;
    }
    return {width: size.width, height: size.height};
}

/** 预览重投影沿用本次呈现的真实 sash 占用（含宿主按容器压缩的结果）。 */
function sashResolver(): (branchId: string, sashIndex: number) => number {
    return (branchId, sashIndex) => Math.max(0, renderLayout.value.sashSizes[branchId]?.[sashIndex] ?? 0);
}

/** 宿主发布的新布局是否已经反映本次提交（只核对真正改变的叶）。 */
function publishedMatches(previewLayout: GridLayoutResult, published: GridLayoutResult, changes: readonly GridBranchChange[]): boolean {
    for (const change of changes) {
        for (const id of [...change.active, ...change.compensated]) {
            const before = previewLayout.sizes[id];
            const after = published.sizes[id];
            if (before === undefined || after === undefined) {
                continue;
            }
            if (Math.abs(before.width - after.width) > 1 || Math.abs(before.height - after.height) > 1) {
                return false;
            }
        }
    }
    return true;
}

/** 手势撤下预览：回到已发布的布局。这次几何变化不过渡，`useGridMotion` 按“上一次还在预览中”认出来。 */
function releasePreview(): void {
    preview.value = null;
}

function onPreview(next: GridGesturePreview<unknown> | null): void {
    if (next === null) {
        // 预览撤回（拖回基线、无变化松手、取消、提交被拒）也是一次几何变化：宿主可能按预览改了别的状态（例如把内容提前
        // 搬出停放区），要知道画面已回到已发布的布局。已经在基线上时不重复发。
        const wasPreviewing = preview.value !== null;
        releasePreview();
        if (wasPreviewing) emit("gesture-update", {layout: props.layout, tree: props.node, changes: [], issues: []});
        return;
    }
    preview.value = next;
    emit("gesture-update", next);
}

const host: SashGestureHost<GridGesturePreview<unknown>, GridBranchChange> = {
    begin(input) {
        const root = renderTree.value;
        const extent = rootExtent();
        if (root === null || extent === null) {
            return null;
        }
        sessionCounter += 1;
        const sessionId = `${instanceId}-${sessionCounter}`;
        const session = createGridGestureSession<unknown>({
            sessionId,
            contextKey: props.contextKey,
            source: input.source,
            revision: props.revision,
            root,
            extent,
            layout: renderLayout.value,
            sashSize: sashResolver(),
            sashes: input.sashes,
        });
        emit("gesture-start", {sessionId, contextKey: props.contextKey, source: input.source, revision: props.revision, sashes: session.sashes});
        return {
            session,
            onPreview,
            onCommit(commit) {
                emit("gesture-end", commit);
                // 开发模式给接线的人的警告（输出 151）；失败本身照旧经 `useSashGesture` 的拒绝分支发。
                if (props.onGestureCommit === undefined) warnDev("commit-handler-missing", `has no onGestureCommit, so drags are rolled back. Pass onGestureCommit as a prop (useGridHost's bindings carry it).`);
                else if (typeof props.onGestureCommit !== "function") warnDev("commit-handler-not-function", `has an onGestureCommit that is not a function (${describeValue(props.onGestureCommit)}), so drags are rolled back. Writing @gesture-commit next to v-bind="host.bindings.value" merges the two into an array; drop the @gesture-commit.`);
                const outcome = props.onGestureCommit?.(commit);
                if (props.onGestureCommit !== undefined && !isCommitResult(outcome)) {
                    warnDev("commit-handler-bad-return", `got ${describeValue(outcome)} from onGestureCommit, so the drag was rolled back. It must return {ok: true} or a failure; a handler written as an event (@gesture-commit) that returns nothing causes this.`);
                }
                if (outcome === undefined) {
                    // 失败经 `useSashGesture` 的拒绝分支发一条（一个失败一条），这里不另发。
                    releasePreview();
                    return commitFailure("handler-missing", "The host did not provide onGestureCommit; the resize was not applied");
                }
                if (!outcome.ok) {
                    releasePreview();
                    return outcome;
                }
                /**
                 * 接纳成功：保持最后一帧预览，等宿主把匹配布局发布出来再释放（避免闪回旧尺寸）。
                 * 一个 tick 之后仍没有匹配发布就按宿主机合同错误处理：释放预览并给出诊断。
                 */
                const held = preview.value;
                if (held !== null) {
                    void nextTick(() => {
                        if (preview.value === held && !publishedMatches(held.layout, props.layout, commit.changes)) {
                            releasePreview();
                            emit("issues", [gridIssue("not-published", "The host accepted the resize but did not publish a matching layout; reverted to the published layout")]);
                        }
                    });
                }
                return outcome;
            },
            onCancel(info) {
                emit("gesture-cancel", info);
            },
        } satisfies SashGestureBinding<GridGesturePreview<unknown>, GridBranchChange>;
    },
};

const scope = useSashGesture<GridGesturePreview<unknown>, GridBranchChange>({
    host: () => host,
    root: rootEl,
    disabled: () => gesturesDisabled.value,
    onIssues: (batch) => emit("issues", batch),
});
provide(SASH_GESTURE_SCOPE_KEY, scope);

/** 外部事实变化（上下文、版本、结构、禁用）取消进行中的手势：不沿旧基线写新上下文。 */
watch([() => props.contextKey, () => props.revision, () => gesturesDisabled.value, () => props.node], () => {
    scope.invalidate();
});

/** 宿主发布新布局即视为几何事实已更新，释放最后一帧预览（避免重复渲染到下一 tick 之后）。 */
watch(() => props.layout, releasePreview);

watch(moving, (value) => {
    if (!value && props.maximized == null) raisedLeaf.value = null;
});

/** 过渡中开始手势：外框直接到终点，拖动没有拖尾。 */
watch(() => scope.active.size > 0, (active) => {
    if (active) motion.stop();
});

/** 开发模式的配置检查（Spec 输出 151）：“每种只报一次”按这个组件实例记。只读的网格（不接提交处理或停用）`sashSize` 为 0 合法，不报。 */
const warnDev = gridDevWarner(() => props.contextKey);
watch(() => [props.node, props.layout, props.disabled, props.onGestureCommit] as const, ([node, layout, disabled, onCommit]) => {
    if (!layoutDevChecksEnabled() || disabled || onCommit === undefined) return;
    if (onlyZeroWidthBoundaries(node, layout)) warnDev("sash-size-zero", `has 0px sashes on every boundary that could be dragged, so nothing can be dragged. createGrid's sashSize defaults to 0; pass a positive sashSize.`);
}, {immediate: true});

/**
 * 起拖时过渡还在走（Spec 输出 159）：宿主的拖动会话没在起拖时调 `settleMotion()`，判定量到的是过渡中间的矩形。
 * 必须是 sync：属性一赋值就跑，早于同一次更新里 `layers` 的 pre 侦听开始的新过渡，读到的是这次更新之前的过渡状态。宿主在起拖的
 * 同一次更新里改了布局、过渡是这次才开始的，不算漏调；写成 pre 会排在那个侦听之后、把它误报出来。
 */
watch(() => props.dragging, (now, before) => {
    if (now && !before && layoutDevChecksEnabled() && motion.moving.value) warnDev("drag-during-motion", `got dragging=true while a layout transition was still running, so the drag measured mid-transition rects. Call settleMotion() when the drag activates (createLiveDragSession does this itself).`);
}, {flush: "sync"});

onBeforeUnmount(() => {
    clearReleased();
    // 手势在 `useSashGesture` 自己的卸载钩子里先收尾（它在这条之前注册）：宿主的 `extent` 监听抛出时（开发构建里 emit 会把异常抛回来），手势也已经结束、窗口上的监听已经摘掉。
    // 卸载时侦听先停、模板 ref 后置空，`useLayoutExtent` 来不及发 null：这里显式告诉宿主尺寸没了（Spec 输出 144）。
    emit("extent", null);
});

/** 写拿起元素的矩形（相对网格根）。刚拿起时元素还没带标记，写不到，这次渲染从 `liftedRect` 取。只写变了的键：尺寸没变就不引起布局。 */
function placeLifted(rect: GridRect): void {
    const before = liftedRect;
    liftedRect = rect;
    const element = rootEl.value?.querySelector<HTMLElement>(":scope > [data-lifted]");
    if (element == null) return;
    const style = liftedRectStyle(rect);
    if (rect.x !== before.x || rect.y !== before.y) element.style.transform = style.transform as string;
    if (rect.width !== before.width) element.style.width = style.width as string;
    if (rect.height !== before.height) element.style.height = style.height as string;
}

/**
 * 拖动中的窗相对记录里的矩形挪了多少（`null` 回到原处）。写在 `translate` 属性上，和 Vue 管的 `left`/`top` 互不相干，重渲染不跳；放下时宿主发布新矩形，同一拍调 `null`。
 * 窗的外框、每个标签的内容、手柄都是网格根的直接子元素，一起挪。
 */
function placeFloat(id: string, offset: {readonly x: number; readonly y: number} | null): void {
    // 记下松手时的偏移（输出 172）：下一帧之前发布的变化从这里出发。下一帧清掉。
    if (offset !== null) floatOffsets.set(id, offset);
    else {
        const last = floatOffsets.get(id);
        floatOffsets.delete(id);
        if (last !== undefined && (last.x !== 0 || last.y !== 0)) {
            released.set(id, last);
            releaseFrame ??= requestAnimationFrame(() => {
                releaseFrame = null;
                released = new Map();
            });
        }
    }
    const translate = offset === null ? "" : `${String(offset.x)}px ${String(offset.y)}px`;
    for (const child of rootEl.value?.children ?? []) {
        const {dataset, style} = child as HTMLElement;
        if (dataset.leaf === id || dataset.contentLeaf === id || dataset.floatChrome === id) style.translate = translate;
    }
}

defineExpose({
    /** 进行中的过渡直接到终点：宿主马上要量矩形（拖动拿起）。 */
    settleMotion: (): void => motion.stop(),
    /** 网格根的左上角（视口坐标）：拿起的内容与盖层相对它。没挂上时是原点。 */
    origin: (): {x: number; y: number} => {
        const box = rootEl.value?.getBoundingClientRect();
        return {x: box?.left ?? 0, y: box?.top ?? 0};
    },
    /** 网格元素上的布局过渡时长（`--nb-layout-motion-layout`）；减少动效时是 0。宿主在网格上覆盖这个变量时，会话的根读不到，所以从网格读。 */
    motionMs: (): number => (rootEl.value === null ? 0 : layoutMotionMs(rootEl.value)),
    placeLifted,
    placeFloat,
    /**
     * 树里这块叶此刻的矩形（相对网格根，CSS px，Spec 输出 174）：与网格渲染同一份树的摆放，手势预览中是预览的，最大化时最大化的那块是盖住的外接矩形，
     * 取整与网格相同。浮动窗、离开中的叶、不存在的 id 交回 null。读的是树的摆放而不是含浮动窗的那份：宿主多半由它算 `floats`，读后者会让
     * “叶的矩形 → floats → 摆放 → 叶的矩形”转个不停。在计算属性里调用，摆放变了会重算。
     */
    leafRect: (id: string): GridRect | null => {
        const found = treePlacement.value?.items.find((item) => item.kind === "leaf" && item.node.id === id);
        return found?.rect ?? null;
    },
    /**
     * 离开、过渡结束前还画着的叶（节点 id）：离开了的（已经不在 `node` 里，缩回去或交换里滑出去）与降到零的（还在，尺寸已经是零）。宿主按它们离开之前的样子
     * 画挨着的东西（相连的卡片），不按这一刻的布局：那已经是终点了。过渡结束就空了。
     */
    outgoingLeaves,
    /**
     * 这一刻外框按 `leafShape` 裁的叶（节点 id）：长出来的、缩回去的、内容不跟外框的。宿主要在这段时间换一种形状时读它（例如让形状伸到邻居底下，
     * 见 `GridLeafShape.fill`），读到的就是这一轮的。过渡结束就空了。
     */
    shapedLeaves,
    /** 这一刻在交换里的叶（节点 id，含滑出去的）：宿主在这段时间不换别的画法时读它。过渡结束就空了。 */
    swappingLeaves,
    /**
     * 这一刻有没有布局过渡在走（整个网格的）。宿主要等过渡结束再换画法时读它，按“为假”这个状态判，不按由真变假：减少动态效果时一轮过渡都不开，它一直为假。
     */
    moving: computed(() => motion.moving.value),
});
</script>

<template>
    <div ref="rootEl" class="nb-nested-grid" :data-grid-scope="instanceId" :aria-owns="order.ariaOwns.value" @keydown="focus.onKeydown" @focusin="onFocusin" @pointerdown.capture="requestRaise($event.target)">
        <span v-if="order.outOfOrder.value" :ref="(el) => (focus.enterSentinel.value = el as HTMLElement | null)" tabindex="-1" aria-hidden="true"></span>
        <!-- 在所有外框之前：外框不写 z-index，按 DOM 序叠在它上面。 -->
        <div v-if="swapBackdrop !== null && $slots['swap-backdrop'] !== undefined" class="nb-grid-swap-backdrop" data-swap-backdrop aria-hidden="true" :style="swapBackdrop.style">
            <slot name="swap-backdrop" :inset="swapBackdrop.inset" :radius="swapBackdrop.radius"></slot>
        </div>
        <template v-for="item in order.items.value" :key="item.key">
            <div
                v-if="item.kind === 'leaf'"
                :id="domIdOf(item.key)"
                class="nb-grid-frame"
                :data-leaf="item.node.id"
                :data-moving="frameMoving(item) ? '' : undefined"
                :data-flying="flying.has(item.key) || raisedLeaf === item.node.id ? '' : undefined"
                :data-float="floatAt.has(item.node.id) || docking.has(item.key) ? '' : undefined"
                :data-float-gesture="floatGestures.get(item.node.id)"
                :data-leaving="leavingLeaves.has(item.node.id) ? '' : undefined"
                :data-anchor-right="anchoredRight.has(item.key) ? '' : undefined"
                :data-swap="swapSideOf(item)"
                :inert="obscuredLeaves.has(item.node.id) || outgoingLeaves.has(item.node.id)"
                :style="{...gridRectStyle(growing.get(item.key) ?? item.rect), ...frameClip(item), ...swapClipStyle(item, growing.get(item.key) ?? item.rect), ...floatLayer(item.node.id, 0)}"
            >
                <div class="nb-grid-leaf" :data-leaf-content="item.node.id" :inert="parked.has(item.node.id)" :style="contentStyle(item)">
                    <FrozenSlot :frozen="frozenLeaves.has(item.node.id)" :name="`leaf ${item.node.id}`"><slot name="leaf" :node="item.node"></slot></FrozenSlot>
                </div>
            </div>
            <SashHandle v-else-if="item.kind === 'sash'" :dom-id="domIdOf(item.key)" class="nb-grid-sash" v-bind="sashProps(item)" :data-sash-kind="sashKindOf(item)" :data-moving="structureMoving(item.key) ? '' : undefined" :data-swap="swapSideOf(item)" :data-leaving="item.leaving ? '' : undefined" :data-obscured="maximized != null ? '' : undefined" :style="sashBoxStyle(item)" />
            <div
                v-else
                :id="domIdOf(item.key)"
                class="nb-grid-content"
                :data-content="item.contentKey"
                :data-content-leaf="item.leaf"
                :data-moving="contentMoving(item) ? '' : undefined"
                :data-flying="flying.has(item.key) || raisedLeaf === item.leaf ? '' : undefined"
                :data-lifted="contentLayer.isLifted(item) ? '' : undefined"
                :data-float="floatAt.has(item.leaf) ? '' : undefined"
                :data-float-gesture="floatGestures.get(item.leaf)"
                :data-leaving="leavingLeaves.has(item.leaf) ? '' : undefined"
                :data-content-leaving="item.leaving ? '' : undefined"
                :data-anchor-right="anchoredRight.has(item.key) ? '' : undefined"
                :data-by-leaf="contentLayer.byLeafRect(item) ? '' : undefined"
                :data-swap="swapSideOf(item)"
                :inert="contentLayer.isParked(item)"
                :style="{...contentLayer.frameStyle(item), ...(contentLayer.isLifted(item) ? {} : floatLayer(item.leaf, 1))}"
            >
                <slot v-if="contentLayer.isLifted(item)" name="lifted-head" :content-key="item.contentKey"></slot>
                <div class="nb-grid-content__body" :style="contentLayer.bodyStyle(item)">
                    <FrozenSlot :frozen="item.leaving === true" :name="`content ${item.contentKey}`"><slot name="content" :content-key="item.contentKey" :leaf="item.leaf" :active="item.active"></slot></FrozenSlot>
                </div>
            </div>
        </template>
        <template v-if="$slots['float-chrome'] !== undefined">
            <div v-for="float in chromeFloats" :key="float.id" class="nb-grid-float-chrome" :data-float-chrome="float.id" :data-moving="moving && !floatJumps.has(float.id) ? '' : undefined" :data-float-gesture="floatGestures.get(float.id)" :style="{...gridRectStyle(growing.get(`leaf:${float.id}`) ?? float.rect), ...floatLayer(float.id, 2)}">
                <slot name="float-chrome" :id="float.id" :rect="float.rect"></slot>
            </div>
        </template>
        <div v-if="$slots.overlay !== undefined" class="nb-grid-overlay"><slot name="overlay"></slot></div>
        <span v-if="order.outOfOrder.value" :ref="(el) => (focus.exitSentinel.value = el as HTMLElement | null)" tabindex="-1" aria-hidden="true"></span>
        <slot v-if="node === null" name="empty"></slot>
    </div>
</template>

<style scoped>
/* `clip` 不用 `hidden`：`scrollIntoView` 滚不动 `clip`，否则内容里的滚动会把外框挪走。 */
.nb-nested-grid {
    position: relative;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: clip;
    /* 叠放固定在这个根里：外框、内容、飞行内容、分隔线、浮动窗（从 10 起，内联）、盖层、拿起的内容。内容换叶后 DOM 位置不变，不靠 DOM 序。 */
    isolation: isolate;
}

/*
 * 外框、内容、手柄都是 `contain: layout`：是里面 `position: fixed` 的包含块，也自成层叠上下文，里面的 `z-index` 出不来（位置原来用 `transform`，
 * 这两点是它带来的，组件说明里写着）；里面的排版也不往外传。
 */
.nb-grid-frame {
    position: absolute;
    top: 0;
    left: 0;
    overflow: clip;
    contain: layout;
}

.nb-grid-swap-backdrop {
    position: absolute;
    pointer-events: none;
}

/* 内容自己的裁切框，不是叶外框：飞过别的叶时不被它们裁。 */
.nb-grid-content {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 1;
    overflow: clip;
    contain: layout;
}

/*
 * 飞的内容压在飞的外框上面，和不飞时一样。不能都是一档、按 DOM 序：换了叶的内容留在原来的 DOM 位置，可能排在新叶的外框前面
 * （浮动窗回到树里时外框排在最后），外框的卡片底色就把内容盖住了，飞的一路只看得到面板头。
 */
.nb-grid-frame[data-flying] {
    z-index: 2;
}

.nb-grid-content[data-flying] {
    z-index: 3;
}

/*
 * 拿起的内容是一张卡片：盖在分隔线上跟手，不接指针（`elementsFromPoint` 要看到底下的面板）。卡片是一列：宿主的头（`lifted-head`）加内容体，
 * 内容体占满头下面的部分，宿主写的尺寸一变就按卡片的大小重排。
 */
.nb-grid-content[data-lifted] {
    display: flex;
    flex-direction: column;
    z-index: 1000;
    overflow: hidden;
    border-radius: var(--nb-layout-card-radius, 10px);
    background: var(--nb-layout-panel-surface, Canvas);
    box-shadow: var(--nb-layout-card-shadow, 0 18px 48px rgb(0 0 0 / 34%), 0 0 0 1px color-mix(in srgb, CanvasText 15%, transparent));
    pointer-events: none;
    will-change: transform;
}

.nb-grid-overlay {
    position: absolute;
    inset: 0;
    z-index: 900;
    pointer-events: none;
}

/* 浮动窗：矩形就是卡片，投影与圆角画在外框自身（元素自己的 `overflow: clip` 不裁自己的 `box-shadow`）。 */
.nb-grid-frame[data-float] {
    border-radius: var(--nb-layout-card-radius, 10px);
    background: var(--nb-layout-panel-surface, Canvas);
    box-shadow: var(--nb-layout-card-shadow, 0 18px 48px rgb(0 0 0 / 34%), 0 0 0 1px color-mix(in srgb, CanvasText 15%, transparent));
}

.nb-grid-float-chrome {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
    contain: layout;
}

.nb-grid-content__body {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
}

.nb-grid-content[data-lifted] > .nb-grid-content__body {
    flex: 1 1 0;
    width: 100%;
}

.nb-nested-grid > .nb-grid-sash {
    z-index: 4;
}

/* 最大化的面板盖住的分隔线不画：它在面板上面一层，会露出来。 */
.nb-nested-grid > .nb-grid-sash[data-obscured] {
    visibility: hidden;
}

/* 标记写在外框上，不写在根上：实时布局拖动中要一部分动、一部分跟手。 */
.nb-grid-frame[data-moving],
.nb-grid-float-chrome[data-moving],
.nb-grid-content[data-moving],
.nb-grid-sash[data-moving] {
    transition:
        left var(--nb-layout-motion-layout, 470ms) var(--nb-layout-ease-layout, cubic-bezier(0.23, 1, 0.32, 1)),
        top var(--nb-layout-motion-layout, 470ms) var(--nb-layout-ease-layout, cubic-bezier(0.23, 1, 0.32, 1)),
        width var(--nb-layout-motion-layout, 470ms) var(--nb-layout-ease-layout, cubic-bezier(0.23, 1, 0.32, 1)),
        height var(--nb-layout-motion-layout, 470ms) var(--nb-layout-ease-layout, cubic-bezier(0.23, 1, 0.32, 1));
    /* 位置不在 `transform` 上（见 `gridRectStyle`）；这里只是让过渡中的项各占一层，挪动时少重画。 */
    will-change: transform;
}

/*
 * 浮动窗回到树里（叶不换）：带着过渡标记的那一次渲染摘掉 `data-float`（从起点出发时晚一次，见 `useGridMotion` 的 `docking`），窗的投影、底色与圆角跟着位置一起过渡掉，看得出是一张卡片飞回去、落下来；
 * 一下子摘掉的话飞回去的只是一块没有边的底色，像没有动画。三样都用加速的曲线，到快落地才没：圆角跟着位置先变直，底色还没淡，半路就是一张方角的卡片。
 * 别的叶这几样不变，过渡不到它们。
 */
.nb-grid-frame[data-moving] {
    transition:
        left var(--nb-layout-motion-layout, 470ms) var(--nb-layout-ease-layout, cubic-bezier(0.23, 1, 0.32, 1)),
        top var(--nb-layout-motion-layout, 470ms) var(--nb-layout-ease-layout, cubic-bezier(0.23, 1, 0.32, 1)),
        width var(--nb-layout-motion-layout, 470ms) var(--nb-layout-ease-layout, cubic-bezier(0.23, 1, 0.32, 1)),
        height var(--nb-layout-motion-layout, 470ms) var(--nb-layout-ease-layout, cubic-bezier(0.23, 1, 0.32, 1)),
        box-shadow var(--nb-layout-motion-layout, 470ms) var(--nb-layout-ease-dialog-leave, cubic-bezier(0.4, 0, 0.8, 0.5)),
        background-color var(--nb-layout-motion-layout, 470ms) var(--nb-layout-ease-dialog-leave, cubic-bezier(0.4, 0, 0.8, 0.5)),
        border-radius var(--nb-layout-motion-layout, 470ms) var(--nb-layout-ease-dialog-leave, cubic-bezier(0.4, 0, 0.8, 0.5));
}

/* 离开了、在过渡里缩回去或滑出去的叶、它的内容与分隔线，宿主已去掉而留着的内容（叶降到零时它没有 `data-leaving`）：已经不在布局里，不接指针，命中判定看到的是底下。 */
.nb-grid-frame[data-leaving],
.nb-grid-content[data-leaving],
.nb-grid-content[data-content-leaving],
.nb-nested-grid > .nb-grid-sash[data-leaving] {
    pointer-events: none;
}

/*
 * 交换里带上的项（docs/specs/ui/nested-grid.md 输出 63）：裁切窗随位置同一段过渡，窗在网格里不动。只给带上的项加：别的项的 `clip-path`
 * （按卡片裁的外框、按叶摆的内容）是每一帧按盒算的，带过渡会让它在头变高时慢半拍。写在上面两条过渡后面，特异性更高。
 */
.nb-grid-frame[data-moving][data-swap],
.nb-grid-content[data-moving][data-swap],
.nb-grid-sash[data-moving][data-swap] {
    transition:
        left var(--nb-layout-motion-layout, 470ms) var(--nb-layout-ease-layout, cubic-bezier(0.23, 1, 0.32, 1)),
        top var(--nb-layout-motion-layout, 470ms) var(--nb-layout-ease-layout, cubic-bezier(0.23, 1, 0.32, 1)),
        width var(--nb-layout-motion-layout, 470ms) var(--nb-layout-ease-layout, cubic-bezier(0.23, 1, 0.32, 1)),
        height var(--nb-layout-motion-layout, 470ms) var(--nb-layout-ease-layout, cubic-bezier(0.23, 1, 0.32, 1)),
        clip-path var(--nb-layout-motion-layout, 470ms) var(--nb-layout-ease-layout, cubic-bezier(0.23, 1, 0.32, 1));
}

/* 手势中的窗跟手：别的布局变化正在过渡时也不带拖尾。写在 [data-moving] 后面，同样的特异性后写的赢。 */
.nb-grid-frame[data-float-gesture],
.nb-grid-content[data-float-gesture],
.nb-grid-float-chrome[data-float-gesture] {
    transition: none;
}

.nb-grid-frame[data-float-gesture="move"],
.nb-grid-content[data-float-gesture="move"] {
    pointer-events: none;
}

.nb-grid-leaf {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
}

/*
 * 过渡中按叶的矩形摆的内容（`byLeafRect`）：外层和外框同一个矩形，内容体往下挪一个面板头，外层的上边跟着外框的上边走，内容一直紧贴面板头下面。
 * 挪用相对定位，不用内边距：内边距会把比面板头还矮的外层撑高，外层伸出外框。面板头那一条由外层的 `clip-path` 裁掉（内联，见 `useContentLayer`）。
 * 写在贴右边的规则前面，两者都有时内容体是绝对定位，上边另给。
 */
.nb-grid-content[data-by-leaf] > .nb-grid-content__body {
    position: relative;
    top: var(--nb-layout-grid-inset);
}

/*
 * 过渡中内容贴着外框的右边（`rightAnchored`）：整块跟着右边平移进出。内层是最终尺寸，比外框宽的部分在左边被裁掉；
 * 过渡结束标记就摘了，那时外框等于内层，贴哪边都一样，不跳。
 */
.nb-grid-frame[data-anchor-right] > .nb-grid-leaf,
.nb-grid-content[data-anchor-right] > .nb-grid-content__body {
    position: absolute;
    top: 0;
    right: 0;
}

.nb-grid-content[data-by-leaf][data-anchor-right] > .nb-grid-content__body {
    top: var(--nb-layout-grid-inset);
}
</style>
