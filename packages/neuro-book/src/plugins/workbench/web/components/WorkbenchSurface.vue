<script setup lang="ts">
/**
 * 一棵树的工作台表面（同名 .md）：把布局文档画成一个 NestedGrid，外框里是卡片与面板头，内容在内容层。文档与投影由宿主给，这里只测量、发布呈现事实、按邻接算卡片。
 */
import {createGrid} from "@notnotype/nb-layout";
import {hiddenRegionsAtZero, isContainerAnchor, isPanelShown, isSectionCollapsed, railLeafId, regionNodeOf, regionOf, regionOfRailLeaf, regionOfStripLeaf, treeLeaves} from "@notnotype/nb-workbench-layout";
import type {Grid, GridBranchInput, GridExtent, GridFloatInput, GridGesturePreview, GridLeafShape, GridNodeInput, GridRect, GridSwap} from "@notnotype/nb-layout";
import type {LayoutDoc, LayoutProjection, PanelName} from "@notnotype/nb-workbench-layout";
import {moveGridFocus, NestedGrid, useGridHost, type GridHostIssue} from "@notnotype/nb-layout/vue";
import {computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useId, useTemplateRef, watch} from "vue";
import type {Directive} from "vue";

import {cardInset, cardInsetPx, joinedToBar, layoutCardEdges, leafIdsOf, maximizedCardEdges, sashKindOf} from "../shell/adjacency";
import type {CardBar, CardEdges, CardSide} from "../shell/adjacency";
import {layoutContents, panelTabDomId, panelTabpanelDomId, panelTitleDomId} from "../state/layout-present";
import "./hover-actions.css";

const ACTIVITY_BAR = "activitybar";
const STATUS_BAR = "statusbar";
/** 状态栏不是卡片（输出 19）。 */
const PLAIN: ReadonlySet<string> = new Set([STATUS_BAR]);
const BARS: ReadonlyArray<string> = [ACTIVITY_BAR, STATUS_BAR];
/**
 * 侧轨的叶没有挂内容（视图段是 Teleport 进去的），网格照默认会让它离开时立即消失；收起视图段、视图挪走时要和别的叶一样缩回去
 * （docs/specs/ui/nested-grid.md 输出 45 的宿主名单）。
 */
const KEEP_LEAVING: ReadonlySet<string> = new Set([railLeafId("auxiliarybar")]);

defineOptions({name: "WorkbenchSurface"});

const props = withDefaults(defineProps<{
    doc: LayoutDoc;
    projection: LayoutProjection;
    contextKey: string;
    maximized?: string | null;
    disabled?: boolean;
    /** 头只写标题的面板：没有标签带，内容就不是 `tabpanel`。 */
    titleOnlyPanels?: ReadonlySet<string>;
    /**
     * 视图自绘头的浮动窗（docs/specs/workbench/views.md 输出 19 的“自绘头”）：外框里不画头，内容从窗口顶上开始、四个角都裁圆；
     * 头由宿主画在 `own-head` 插槽里（内容里、视图之上）。只认此刻画成浮动窗的面板。值是按钮一组在右端占的宽度（CSS px），写成内容上的
     * `--workbench-own-head-inset-end`，视图在它的头右端让出来。
     */
    ownHeads?: ReadonlyMap<string, number>;
    /** 实时布局预览里的空位：这块什么都不画，露出窗体底（输出 38）。 */
    slotPanel?: string | null;
    /** 拿起的内容项（实时布局）：预览把来源摘掉时网格自己留住它（`NestedGrid` 的 `lifted`）。矩形由 `placeLifted` 写。 */
    lifted?: {readonly key: string} | null;
    /** 拖动进行中：网格不留着离开的叶缩回去（`NestedGrid` 的 `dragging`）。 */
    dragging?: boolean;
    /** 宿主自己的尺寸手势进行中（侧轨的轨宽手柄）：布局跟手、不过渡（`NestedGrid` 的 `gesturing`）。 */
    gesturing?: boolean;
    /** 画出来的浮动窗：矩形已夹取，拖动中是预览。 */
    floats?: ReadonlyArray<GridFloatInput>;
    /**
     * 切换容器时卡片不动、里面的内容滚过去（输出 42，网格的交换）：和那次提交在同一个同步段里给，`token` 变了才算新的。缝宽与裁切窗由这里按主题补上：
     * 内容裁在这一列的卡片里，滑走的与换上来的之间隔一条缝。
     */
    swap?: Omit<GridSwap, "gap" | "window"> | null;
}>(), {maximized: null, disabled: false, titleOnlyPanels: () => new Set<string>(), ownHeads: () => new Map<string, number>(), slotPanel: null, lifted: null, dragging: false, gesturing: false, floats: () => [], swap: null});

const emit = defineEmits<{
    (event: "extent", extent: GridExtent | null): void;
    /** 主题的缝宽变了（`--shell-gap`）：活动栏的叶宽要算上它。 */
    (event: "card-gap", gap: number): void;
    /** 布局发布了：这一刻的呈现尺寸。 */
    (event: "presented", sizes: Readonly<Record<string, GridExtent>>): void;
    /** 手势进行中的预览尺寸；手势结束或预览撤回时是 null。 */
    (event: "preview", sizes: Readonly<Record<string, GridExtent>> | null): void;
    /** 手势落账：`before` 是手势开始时呈现的尺寸，`after` 是落账之后的，`collapsed` 是这次手势改了收起状态的面板；宿主经 `applyGestureCommit` 写回文档（workbench-layout 输出 49）。 */
    (event: "gesture-commit", before: Readonly<Record<string, GridExtent>>, after: Readonly<Record<string, GridExtent>>, collapsed: Readonly<Record<string, boolean>>): void;
    /** 网格的诊断与被拒的提交（`ui/nested-grid` 输出 139）：`NestedGrid` 的 `issues` 与 `useGridLayout` 的 `onIssues` 两路合在这里；外壳交给 `reportGridIssues` 记进窗口的诊断。 */
    (event: "issues", issues: readonly GridHostIssue[]): void;
    /** 内容项要被停放，这一刻焦点还在里面：焦点去哪由宿主定（输出 16）。 */
    (event: "content-parked", key: string): void;
    /** 焦点现在在哪块面板；离开所有面板时是 null。宿主据此记当前面板（输出 36）。 */
    (event: "focus-panel", panel: string | null): void;
    /** 指针按在浮动窗上，或焦点进了它：提到最前。已在最前不发（转发网格的 `float-raise`）。 */
    (event: "raise-float", panel: string): void;
}>();

defineSlots<{
    /** 活动栏（左轨）。`joined`：此刻和侧栏的卡片相连（同 `data-shell-join`）。 */
    activitybar?(props: {joined: boolean}): unknown;
    /** 右栏外侧的侧轨（投影的 `rails`，输出 50）：叶里画什么。`joined` 同活动栏。 */
    rail?(props: {region: PanelName; joined: boolean}): unknown;
    statusbar?(): unknown;
    /** 面板的头，工具面板与编辑组都在这里。`idPrefix` 交给 `WorkbenchPanelHead`，标签和内容才对得上。 */
    head?(props: {panelId: string; idPrefix: string}): unknown;
    /** 打开着的空区域（区域的锚进了呈现树，ADR 0050）：整块卡片里画什么，没有头。 */
    "empty-region"?(props: {panelId: string}): unknown;
    /** 右栏、底部面板卡片顶上的入口条（输出 47）：`merged` 是此刻画在这一行里的那一节（它的头在这里），没有时是 null。 */
    strip?(props: {region: PanelName; merged: string | null; idPrefix: string}): unknown;
    content?(props: {contentKey: string; panelId: string; active: boolean}): unknown;
    /** 拿起的内容项的头。 */
    "lifted-head"?(): unknown;
    /** 盖在分隔线之上、拿起的内容之下，不接指针。 */
    overlay?(): unknown;
    /** 浮动窗的手柄与自绘头的按钮。`actionsShown`：视图动作与框架按钮此刻该不该显示（指针在这块窗上或焦点在里面）；`idPrefix` 同 `head`。 */
    "float-chrome"?(props: {id: string; rect: GridRect}): unknown;
    /**
     * 视图自绘头的浮动窗盖在视图之上的那一条（`ownHeads`）：画在内容里，焦点、悬停与 F6 都算这块面板，飞行时跟着内容走。
     * `actionsShown`：指针或焦点在这块窗上（同卡片的 `data-hover-actions-active`）；`idPrefix` 同 `head`。
     */
    "own-head"?(props: {panelId: string; idPrefix: string; actionsShown: boolean}): unknown;
}>();

const rootEl = ref<HTMLElement | null>(null);
const gridEl = useTemplateRef<InstanceType<typeof NestedGrid>>("grid");
const idPrefix = useId();
const preview = shallowRef<Readonly<Record<string, GridExtent>> | null>(null);

/** 主题写在文档根上，换主题或明暗时文档根的属性与内联变量会变，这时重读。 */
let themeObserver: MutationObserver | null = null;
/** 主题的缝宽（px）：交换里滑走的内容与换上来的内容之间隔它，裁切窗按它算卡片的内缩。 */
const cardGap = ref(0);
function readCardGap(): void {
    const root = rootEl.value;
    if (root === null) return;
    const value = Number.parseFloat(getComputedStyle(root).getPropertyValue("--shell-gap"));
    cardGap.value = Number.isFinite(value) ? value : 0;
    emit("card-gap", cardGap.value);
}
/**
 * 侧栏切换容器时卡片不动、里面的内容滚过去（输出 42；开发者 2026-11-17：“滚动的时候，边框位置不要变，右上角右下角要依旧保持圆角”）。
 * 裁切窗就是这一列的卡片：外框按卡片的四边内缩、四个角照卡片的。静止的卡片画在网格的 `swap-backdrop` 里，滑动的外框这期间不画自己的卡片
 * （`data-swap`，见样式），只带着头与内容滑。
 */
const gridSwap = computed<GridSwap | null>(() => {
    if (props.swap === null) return null;
    const column = swapColumn.value;
    const gap = cardGap.value;
    if (column === null) return {...props.swap, gap};
    const inset = [cardInsetPx(column.top, gap), cardInsetPx(column.right, gap), cardInsetPx(column.bottom, gap), cardInsetPx(column.left, gap)] as const;
    return {...props.swap, gap, window: {inset, radius: cornersOf(column)}};
});
onMounted(() => {
    readCardGap();
    themeObserver = new MutationObserver(readCardGap);
    themeObserver.observe(document.documentElement, {attributes: true, attributeFilter: ["data-nb-theme", "data-nb-appearance", "style"]});
});
onBeforeUnmount(() => themeObserver?.disconnect());

const grid = computed<Grid<string>>(() => createGrid<string>(props.projection.input, {sashSize: props.projection.sashSize}));
/** 网格宿主：尺寸取自 `NestedGrid` 量的根盒（与本组件的根同大，都铺满），诊断与被拒的提交经 `onIssues` 一个出口交出去。 */
const host = useGridHost<string>({
    grid,
    contextKey: () => props.contextKey,
    disabled: () => props.disabled,
    // 只接手势：工作台的收起与尺寸走文档再投影（换网格实例），不调 `host.setCollapsed`、`host.setSize`。
    onApplied: (change, before) => {
        if (change.kind === "gesture") emit("gesture-commit", before.sizes, host.layout.value.sizes, change.collapsed);
    },
    onIssues: (issues) => emit("issues", issues),
});

// 同步发：store 的投影依赖尺寸，晚一拍就会用旧树算一次新尺寸的布局。`immediate`：挂载前先发 null，重挂载时重置 store。
watch(host.extent, (next) => emit("extent", next), {immediate: true, flush: "sync"});

watch(() => host.layout.value, (layout) => emit("presented", layout.sizes), {immediate: true});

function onGesturePreview(next: GridGesturePreview<unknown>): void {
    // 预览撤回时 `changes` 是空的、`layout` 是已发布的布局。
    preview.value = next.changes.length === 0 ? null : next.layout.sizes;
    emit("preview", preview.value);
}

function onGestureSettled(): void {
    preview.value = null;
    emit("preview", null);
}

/**
 * 编辑组的头高（标签折行、提示条都会变）：内容从它下面开始。`ResizeObserver` 的回调在绘制之前，回调里改了内容的矩形，浏览器在同一帧里重新布局。
 * 新拆出来的组第一次发布时头还没挂上，这时按一行算：新叶正在长出来，内容带着过渡，从 0 开始的话会先盖住头再滑下去。没有头（编辑器撤回、提供者不给）时量出来是 0，内容占满。
 */
const EDITOR_HEAD_ONE_ROW = 34;
const editorHeadHeights = shallowRef<Readonly<Record<string, number>>>({});
const headObserver = typeof ResizeObserver === "function" ? new ResizeObserver((entries) => {
    const next = {...editorHeadHeights.value};
    let changed = false;
    for (const entry of entries) {
        const panel = (entry.target as HTMLElement).dataset.surfaceHead;
        // 布局尺寸，不用 `getBoundingClientRect`：Lab 的画布有 CSS `zoom`，内容的矩形也是布局尺寸。
        const height = entry.borderBoxSize[0]?.blockSize ?? 0;
        if (panel === undefined || next[panel] === height) continue;
        next[panel] = height;
        changed = true;
    }
    // 只有宽变了也会回调（改窗口宽度时每一步都来）：高度都没变就不换对象，换了内容层整个重算、整个网格重渲染一次。
    if (changed) editorHeadHeights.value = next;
}) : null;
onBeforeUnmount(() => headObserver?.disconnect());
/** 写在编辑组头的外层上：观察它的高度。 */
const vEditorHead: Directive<HTMLElement> = {
    mounted: (element) => headObserver?.observe(element),
    beforeUnmount: (element) => {
        headObserver?.unobserve(element);
        const panel = element.dataset.surfaceHead;
        if (panel === undefined) return;
        const {[panel]: _gone, ...rest} = editorHeadHeights.value;
        editorHeadHeights.value = rest;
    },
};

const contents = computed(() => {
    // 垫底的分节（投影的 `fillers`，一列全部收起时最后一节，输出 11）外框拉到了底，内容层会按外框摆出它的内容：它仍是收起的，内容不显示、不可交互。
    // 只给垫底的：别的收起的分节外框只有标题行高，被拉开时内容在拖动中就出现（输出 12）。
    const fillers = props.projection.fillers;
    const laid = layoutContents(props.doc, (panel) => editorHeadHeights.value[panel] ?? EDITOR_HEAD_ONE_ROW, headless.value);
    return fillers.size === 0 ? laid : laid.map((item) => (fillers.has(item.leaf) ? {...item, active: false} : item));
});
/** 最大化盖住除条与侧轨以外的全部（输出 13、50）。 */
const maximizedLeaf = computed(() => (props.maximized === null ? null : {leaf: props.maximized, exclude: [...BARS, ...props.projection.rails.map((rail) => rail.leaf)]}));

/**
 * 侧轨（docs/specs/ui/workbench-layout.md 输出 50）：左边的活动栏与右栏外侧的右轨（投影的 `rails`）。和区域相连、角接过去都按这张表、左右镜像地算；
 * 每一边至多一条。
 */
const shellBars = computed<ReadonlyArray<CardBar>>(() => [
    {leaf: ACTIVITY_BAR, group: "sidebar", side: "start"},
    ...props.projection.rails.map((rail): CardBar => ({leaf: rail.leaf, group: rail.region, side: "end"})),
]);
const barOf = (leaf: string): CardBar | undefined => shellBars.value.find((bar) => bar.leaf === leaf);
/** 侧轨朝着区域的那一边：活动栏是右边，右轨是左边。区域的块朝着侧轨的那一边反过来。 */
const barFacing = (bar: CardBar): "left" | "right" => (bar.side === "start" ? "right" : "left");
const groupFacing = (bar: CardBar): "left" | "right" => (bar.side === "start" ? "left" : "right");
/** 这块卡片和哪条侧轨相连：左边连着的是 `start` 那条，右边连着的是 `end` 那条（每边至多一条）。 */
function joinedBarOf(id: string, edges: CardEdges | undefined): CardBar | undefined {
    if (barOf(id) !== undefined || edges === undefined) return undefined;
    return shellBars.value.find((bar) => joinedToBar(edges[groupFacing(bar)]));
}

/** 叶是什么角色：入口条叶（只在呈现里）算工具面板，它和区域的分节拼成一张卡片、有卡片的底色与悬停范围。 */
const roleOf = (id: string): "tool" | "editor" | null => (regionOfStripLeaf(id) !== null ? "tool" : props.doc.panels[id]?.role ?? null);
/** 卡片组（输出 19）：工具面板按区域，一个区域里相邻的几块拼成一张卡片；实时布局的空位自成一块，四周照旧留缝。 */
const groupOf = (id: string): string | null => (id === props.slotPanel ? null : regionOfStripLeaf(id) ?? regionOf(props.doc, id));

// ── 入口条与并成一行（docs/specs/ui/workbench-layout.md 输出 20、47） ────────────────

/** 这一次呈现里的入口条：入口条叶 → 区域与并进来的那一节（投影按被投影的文档判，表面不另算）。 */
const stripPlacements = computed(() => new Map(props.projection.strips.map((strip) => [strip.leaf, strip] as const)));

/**
 * 还原过渡里的那一节（输出 13）：最大化着时它在自己的叶里画头；还原时入口条叶在过渡结束前还被盖着，头留在叶里，等网格没有过渡（`moving` 为假）
 * 才搬回入口条，这一刻正文上移一行、不随过渡（待确认清单 2026-11-17）。判“为假”不判由真变假：减少动态效果时没有过渡，它一直为假，提交后就搬回。
 * 别的区域同时在过渡时跟着推迟，已知限制。
 */
const restoring = shallowRef<string | null>(null);
const floatingPanels = computed<ReadonlySet<string>>(() => new Set(props.floats.map((float) => float.id)));
/** 此刻画成浮动窗、视图自绘头的面板。 */
const ownHeadFloats = computed<ReadonlySet<string>>(() => new Set([...props.ownHeads.keys()].filter((id) => floatingPanels.value.has(id))));
watch(() => props.maximized, (next, previous) => {
    if (previous === null || next === previous) return;
    restoring.value = previous;
    // 网格在这次渲染里才开始过渡：渲染之后还没在动，就是没有过渡（减少动态效果、几何没变）。
    void nextTick(() => {
        if (gridEl.value?.moving !== true) restoring.value = null;
    });
});
watch(() => gridEl.value?.moving === true, (moving) => {
    if (!moving) restoring.value = null;
});

/**
 * 入口条叶此刻画成并着哪一节，表面里只有这一处决定（正文的上边、叶插槽画不画头、入口条里接不接头、悬停与焦点的面板都读它）：投影的 `merged`；
 * 正在离开的入口条叶用最后一次呈现的；那一节最大化着或还在还原过渡里时是 null，它在自己的叶里画头，同一块面板不出现两个头；它是实时布局的空位时也是 null。
 */
function mergedIn(stripLeaf: string): string | null {
    const merged = drawnAsBefore(stripLeaf) ? lastPresented.strips.get(stripLeaf) ?? null : stripPlacements.value.get(stripLeaf)?.merged ?? null;
    // 实时布局预览里的空位（拿起了它唯一的视图）什么都不画，头也不留在入口条里（输出 38）；浮起来的那一节画在浮动窗里，窗有自己的头，
    // 缩走的入口条照最后一次呈现的样子画时也不再接它的头。
    if (merged === null || merged === props.maximized || merged === restoring.value || merged === props.slotPanel || floatingPanels.value.has(merged)) return null;
    return merged;
}
/** 此刻叶里不画头的分节：并在入口条里的，以及正在离开、离开前并着的（滑出去时不冒出自己的头，内容不下跳）。 */
const headless = computed<ReadonlySet<string>>(() => {
    const panels = new Set<string>();
    for (const leaf of stripPlacements.value.keys()) {
        const merged = mergedIn(leaf);
        if (merged !== null) panels.add(merged);
    }
    // 浮起来的那一节画在浮动窗里，窗有自己的头：从入口条下面飞出去的那一刻起内容就让出头。
    for (const id of lastPresented.headless) if (drawnAsBefore(id) && id !== props.maximized && !floatingPanels.value.has(id)) panels.add(id);
    for (const id of ownHeadFloats.value) panels.add(id);
    return panels;
});
/** 叶代表哪块面板：入口条叶是并进来的那一节，没有并时不代表面板（和活动栏一样）。 */
const panelOfLeaf = (leaf: string | null): string | null => (leaf === null ? null : regionOfStripLeaf(leaf) === null ? leaf : mergedIn(leaf));

/** 呈现里的区域的锚就是打开着的空区域（ADR 0050）：有分节时锚不进呈现树。它没有头，画宿主给的提示。 */
const isEmptyRegion = (id: string): boolean => {
    const panel = props.doc.panels[id];
    return panel !== undefined && isContainerAnchor(panel);
};

/**
 * 侧栏与右栏下角的场景图画在哪块卡片上（docs/specs/theme/skins.md 输出 6）：图跟着区域走，不跟着视图走。区域的锚不进呈现树，所以取区域里显示着的最后一块，
 * 它的下缘就是区域的下缘；一列分成几节时只画一张。按呈现算（隐藏的区域按拖到零画）：隐藏的那一刻图还在那块卡片上，跟着它缩回去。
 */
const sceneCorners = computed<ReadonlyMap<string, PanelName>>(() => new Map((["sidebar", "auxiliarybar"] as const).flatMap((region) => {
    const presented = hiddenRegionsAtZero(props.doc);
    const hit = regionNodeOf(presented, region);
    const last = hit === null ? undefined : treeLeaves(hit.node).map((leaf) => leaf.id).filter((id) => isPanelShown(presented, id)).at(-1);
    return last === undefined ? [] : [[last, region] as const];
})));

/**
 * 交换的这一列的卡片的四边：换上来的那几块在新布局里的边（离开的那几块已经不在新布局里）。上下取最外面那块的（组里相邻的边是相连的），左右同一列都一样。
 */
const swapColumn = computed<CardEdges | null>(() => {
    const entering = (props.swap?.entering ?? []).flatMap((id) => {
        const edges = cards.value[id];
        return edges === undefined ? [] : [edges];
    });
    const first = entering[0];
    if (first === undefined) return null;
    const side = (key: keyof CardEdges): CardSide => entering.map((edges) => edges[key]).find((found) => found.kind !== "joined") ?? first[key];
    return {top: side("top"), right: side("right"), bottom: side("bottom"), left: side("left")};
});
/** 静止的卡片：外层同 `slot`（按内缩留出缝、裁掉相连那一边的投影），里面一张卡片，角照这一列的；主题的场景图也画在它上面，不随内容滑。 */
function swapBackdropStyle(inset: readonly number[]): Record<string, string> {
    const [topLeft, topRight, bottomRight, bottomLeft] = swapColumn.value === null ? [ROUND, ROUND, ROUND, ROUND] : cornersOf(swapColumn.value);
    return {padding: inset.map((value) => `${String(value)}px`).join(" "), "--shell-corner-tl": topLeft, "--shell-corner-tr": topRight, "--shell-corner-br": bottomRight, "--shell-corner-bl": bottomLeft};
}
const swapScene = computed(() => (props.swap?.entering ?? []).map((id) => sceneCorners.value.get(id)).find((scene) => scene !== undefined));

/** 卡片跟着拖动中的预览走：相连与否按拖动中的几何算（输出 19）。 */
const cards = computed<Readonly<Record<string, CardEdges>>>(() => {
    const computedCards = layoutCardEdges({
        root: props.projection.input,
        sizes: preview.value ?? host.layout.value.sizes,
        sashSizes: host.layout.value.sashSizes,
        bars: shellBars.value,
        plain: PLAIN,
        groupOf,
    });
    return props.maximized === null ? computedCards : maximizedCardEdges(computedCards, props.maximized, shellBars.value);
});

/**
 * 缩回去的叶（docs/specs/ui/nested-grid.md 输出 46、49：隐藏、拖到零的区域降到零，离开的节点留在过渡里）这一刻的布局已经是终点：零宽，或不在呈现里。
 * 卡片四边、相连与场景图沿用它最后一次有尺寸时的，不然缩回去的第一帧卡片就少了外边距、换了圆角。只记呈现着、有尺寸的叶，缩完、回来了就用新算的。
 */
const presentedLeaves = computed(() => new Set(leafIdsOf(props.projection.input)));
const outgoingLeaves = computed<ReadonlySet<string>>(() => gridEl.value?.outgoingLeaves ?? new Set());
const shapedLeaves = computed<ReadonlySet<string>>(() => gridEl.value?.shapedLeaves ?? new Set());
/** 这一刻在交换里的叶（切换容器滚过去的两张卡片）：它们不算“角接过去”，侧轨前后都相连，不换画法。 */
const swappingLeaves = computed<ReadonlySet<string>>(() => gridEl.value?.swappingLeaves ?? new Set());
/**
 * 侧轨刚从断开变成相连时连上的那一列（`capLeaves`）：区域显示（从零宽长出来）。一直相连、只是换了一列（切换容器）时不算。
 * 每条侧轨各记各的（键是侧轨的叶）：自己的列表别的变化、自己那一列的过渡结束才清，另一条侧轨这时连上、断开都不碰它，两边同时过渡不互相冲掉。
 * 按 id 的列表比，同一列重算出来的卡片不算变化。
 */
const freshByBar = shallowRef<ReadonlyMap<string, ReadonlySet<string>>>(new Map());
const freshlyJoined = computed<ReadonlySet<string>>(() => new Set([...freshByBar.value.values()].flatMap((leaves) => [...leaves])));
const barJoinedKeys = (all: Readonly<Record<string, CardEdges>>): Record<string, string> => Object.fromEntries(shellBars.value.map((bar) => [
    bar.leaf,
    Object.keys(all).filter((id) => joinedBarOf(id, all[id])?.leaf === bar.leaf).sort().join("\n"),
]));
watch(() => JSON.stringify(barJoinedKeys(cards.value)), (now, before) => {
    const next = JSON.parse(now) as Record<string, string>;
    const previous = before === undefined ? {} : JSON.parse(before) as Record<string, string>;
    const fresh = new Map(freshByBar.value);
    for (const [leaf, leaves] of Object.entries(next)) {
        const was = previous[leaf] ?? "";
        if (was === leaves) continue;
        if (was === "" && leaves !== "") fresh.set(leaf, new Set(leaves.split("\n")));
        else fresh.delete(leaf);
    }
    freshByBar.value = fresh;
}, {flush: "sync"});
watch(shapedLeaves, (shaped, before) => {
    // 这条侧轨那一列的过渡结束（上一刻还有叶按卡片裁，这一刻一块都没有）才清它的记录；整个网格都没有过渡时全清。
    const ended = (leaves: ReadonlySet<string>): boolean => shaped.size === 0 || ([...leaves].some((id) => before?.has(id) === true) && ![...leaves].some((id) => shaped.has(id)));
    const kept = new Map([...freshByBar.value].filter(([, leaves]) => !ended(leaves)));
    if (kept.size !== freshByBar.value.size) freshByBar.value = kept;
});
const lastPresented = {cards: new Map<string, CardEdges>(), scene: new Map<string, PanelName>(), strips: new Map<string, string | null>(), headless: new Set<string>()};
/** 每条侧轨最近一次没和区域相连时朝着区域那一边的样子：区域长出来的这段侧轨照这个画（`cardOf`）。 */
const separatedSides = new Map<string, CardSide>();
watch([cards, sceneCorners, presentedLeaves, stripPlacements], ([nextCards, nextScene, presented, strips]) => {
    const sizes = preview.value ?? host.layout.value.sizes;
    const merged = new Set([...strips.values()].flatMap((strip) => (strip.merged === null ? [] : [strip.merged])));
    for (const id of presented) {
        const size = sizes[id];
        if (size !== undefined && (size.width <= 0 || size.height <= 0)) continue;
        const strip = strips.get(id);
        if (strip !== undefined) lastPresented.strips.set(id, strip.merged);
        if (merged.has(id)) lastPresented.headless.add(id);
        else lastPresented.headless.delete(id);
        const edges = nextCards[id];
        if (edges === undefined) lastPresented.cards.delete(id);
        else lastPresented.cards.set(id, edges);
        const scene = nextScene.get(id);
        if (scene === undefined) lastPresented.scene.delete(id);
        else lastPresented.scene.set(id, scene);
    }
    for (const bar of shellBars.value) {
        const facing = nextCards[bar.leaf]?.[barFacing(bar)];
        if (facing !== undefined && facing.kind !== "joined") separatedSides.set(bar.leaf, facing);
    }
}, {immediate: true, flush: "sync"});
/**
 * 不在呈现里、也不在缩回去的叶，最后一次的记录用不上了：编辑组每次拆分都是新 id，不清就一直长。等 `NestedGrid` 判完过渡再清（`post`）：
 * 刚离开、要留着缩回去的那块这时已经在 `outgoingLeaves` 里，它缩回去的这段还要用记录。
 */
watch([presentedLeaves, outgoingLeaves], ([presented, outgoing]) => {
    for (const records of [lastPresented.cards, lastPresented.scene, lastPresented.strips]) {
        for (const id of records.keys()) if (!presented.has(id) && !outgoing.has(id)) records.delete(id);
    }
    for (const id of lastPresented.headless) if (!presented.has(id) && !outgoing.has(id)) lastPresented.headless.delete(id);
}, {flush: "post"});

const drawnAsBefore = (id: string): boolean => !presentedLeaves.value.has(id) || outgoingLeaves.value.has(id);
/** 这块卡片按呈现算的四边：缩回去的叶用最后一次有尺寸时的。 */
const edgesOf = (id: string): CardEdges | undefined => (drawnAsBefore(id) ? lastPresented.cards.get(id) ?? cards.value[id] : cards.value[id]);
const sceneOf = (id: string): PanelName | undefined => (drawnAsBefore(id) ? lastPresented.scene.get(id) : sceneCorners.value.get(id));

/**
 * 侧栏的角接过去（docs/specs/ui/workbench-layout.md 输出 19，开发者 2026-11-16 在 t25 的 join-motion 评审页上选丙）：和活动栏相连的侧栏
 * 隐藏缩回去、显示长出来的这段（外框按卡片裁，`shapedLeaves`），活动栏和侧栏画成一张、侧栏右边那两个圆角跟着它的右沿走。侧栏一列几节时整列一起（`capLeaves`）。做法：
 * - 活动栏照断开的样子画（右边留半缝、四个角都圆）：显示时用它上一次断开时的右边（`separatedBarRight`），隐藏时这一刻的布局本来就是断开的；
 * - 侧栏每一块的形状往左伸到活动栏右边那个圆角起头的地方，左边的角是直的，伸出去的部分是活动栏的底色、压在活动栏下面（`GridLeafShape.fill`），
 *   盖住活动栏的圆角与半缝，只在它们空着的地方露出来，活动栏的图标与悬停底色照旧在上面；组内的块之间没有缝，伸出去的部分连成一条；
 * - 侧栏右上、右下的圆角（几节时是最上面一块的右上角、最下面一块的右下角，组内的角本来是直的）跟着外框的右沿：缩到零时正好落在活动栏右边，
 *   成了活动栏的两个角，摘掉侧栏后画面不变；显示时反过来，长完了换回相连的画法，画面同样不变。
 * 所以活动栏的角不过渡：断开、相连的那一刻它的角都被盖着。中间那条短线随着淡出（隐藏）、淡入（显示）。
 * 只认缩回去的和活动栏刚连上的（`freshlyJoined`）：切换容器时活动栏前后都相连，不换画法（换的话图标会左右挪一下）；切换时内容滚过去的那些叶
 * （`swappingLeaves`）留着画到滚完，也不算。
 */
const capLeaves = computed<ReadonlyMap<string, CardBar>>(() => {
    const caps = new Map<string, CardBar>();
    for (const id of shapedLeaves.value) {
        if (swappingLeaves.value.has(id) || !(drawnAsBefore(id) || freshlyJoined.value.has(id))) continue;
        const bar = joinedBarOf(id, edgesOf(id));
        if (bar !== undefined) caps.set(id, bar);
    }
    return caps;
});
/** 这一刻在角接过去的侧轨。 */
const cappedBars = computed<ReadonlySet<string>>(() => new Set([...capLeaves.value.values()].map((bar) => bar.leaf)));

/** 这块卡片的四边：离开的叶用最后一次呈现的；区域的角接过去的这段，侧轨照断开的样子。 */
function cardOf(id: string): CardEdges | undefined {
    const card = edgesOf(id);
    const bar = barOf(id);
    if (bar === undefined || card === undefined || !cappedBars.value.has(id) || !joinedToBar(card[barFacing(bar)])) return card;
    return {...card, [barFacing(bar)]: separatedSides.get(id) ?? {kind: "inner", occupied: 0}};
}

const ROUND = "var(--shell-card-radius, 0px)";
/** 四个角（左上、右上、右下、左下）：一个角圆当且仅当它两侧的边都不相连（输出 19）。 */
function cornersOf(edges: CardEdges): readonly [string, string, string, string] {
    const open = (a: CardSide, b: CardSide): string => (a.kind !== "joined" && b.kind !== "joined" ? ROUND : "0px");
    return [open(edges.top, edges.left), open(edges.top, edges.right), open(edges.bottom, edges.right), open(edges.bottom, edges.left)];
}

/** 卡片在外框里的内边距与四个角：写在外框里那一层（`slot`）和内容外层上，卡片与内容的裁切读同一组角（`--shell-corner-*`）。 */
function insetOf(id: string): Record<string, string> {
    const edges = cardOf(id);
    if (edges === undefined) return {};
    const [topLeft, topRight, bottomRight, bottomLeft] = cornersOf(edges);
    return {
        padding: [edges.top, edges.right, edges.bottom, edges.left].map(cardInset).join(" "),
        "--shell-corner-tl": topLeft,
        "--shell-corner-tr": topRight,
        "--shell-corner-br": bottomRight,
        "--shell-corner-bl": bottomLeft,
    };
}

/** 侧轨与区域相连：左边那张写 start、右边那张写 end（活动栏是 start、侧栏的块是 end；右栏的块是 start、右轨是 end）。圆角由 `insetOf` 的四个角给，这里只是给测试与主题看的标记。 */
function joinOf(id: string): "start" | "end" | undefined {
    const edges = cardOf(id);
    if (joinedToBar(edges?.right)) return "start";
    if (joinedToBar(edges?.left)) return "end";
    return undefined;
}

/** 区域的角接过去的这段（`capLeaves`），只写在侧轨上：隐藏是 `leave`，显示是 `enter`。 */
function capOf(id: string): "enter" | "leave" | undefined {
    if (!cappedBars.value.has(id)) return undefined;
    return [...capLeaves.value].some(([leaf, bar]) => bar.leaf === id && drawnAsBefore(leaf)) ? "leave" : "enter";
}

/**
 * 侧轨和区域之间那条短线：相连时画，区域的角接过去的这段也画（随着淡出、淡入，见 `capOf`）。值是线在侧轨的哪一头：
 * 活动栏的线在它的右边（`end`），右轨的在它的左边（`start`）。
 */
function barSeamOf(id: string): "start" | "end" | undefined {
    const bar = barOf(id);
    if (bar === undefined || !(cappedBars.value.has(id) || joinedToBar(cardOf(id)?.[barFacing(bar)]))) return undefined;
    return bar.side === "start" ? "end" : "start";
}

/**
 * 卡片在外框里的形状（NestedGrid 的 `leafShape`）：过渡中外框露出、盖住保持尺寸的面板时按它裁，露出来的一截是一张完整的卡片。
 * 和 `insetOf` 同一来源（四边与四个角），离开的叶用最后一次呈现的。圆角按物理方向给（工作台只有从左到右）。
 * 区域的角接过去的这段，区域的每一块朝着侧轨伸过它的半缝与一个圆角（见 `capLeaves`）：侧栏往左伸过活动栏，右栏往右伸过右轨。
 */
function shapeOf(id: string): GridLeafShape | undefined {
    const edges = cardOf(id);
    if (edges === undefined || PLAIN.has(id)) return undefined;
    const inset = [cardInset(edges.top), cardInset(edges.right), cardInset(edges.bottom), cardInset(edges.left)] as const;
    const radius = cornersOf(edges);
    const bar = capLeaves.value.get(id);
    const barCard = bar === undefined ? undefined : cardOf(bar.leaf);
    if (bar === undefined || barCard === undefined) return {inset, radius};
    const reach = `calc(-1 * (${ROUND} + ${cardInset(barCard[barFacing(bar)])}))`;
    return {
        inset: bar.side === "start" ? [inset[0], inset[1], inset[2], reach] : [inset[0], reach, inset[2], inset[3]],
        radius,
        fill: "var(--skin-activitybar-surface, var(--panel-surface))",
    };
}

function findBranch(node: GridNodeInput<string>, id: string): GridBranchInput<string> | null {
    if (node.kind === "leaf") return null;
    if (node.id === id) return node;
    for (const child of node.children) {
        const found = findBranch(child, id);
        if (found !== null) return found;
    }
    return null;
}

type SashRef = {readonly branch: string; readonly before: string; readonly after: string};

function sashKind(sash: SashRef): string | undefined {
    const branch = findBranch(props.projection.input, sash.branch);
    return branch === null ? undefined : sashKindOf(branch, sash.before, sash.after, roleOf, groupOf);
}

/**
 * 同一张卡片里两块之间的分隔线（`panes`）占着 1px，两张卡片各自贴到外框边，这一条里没有卡片：线两端会露出窗体底，深色的外框也在这里断开。
 * 这一条按卡片的范围画底色与两端的投影（样式见下面的 `panes` 分隔线），这里给范围：线前面那一块在长轴方向的两边内缩，同一列（排）的两块这两边贴着同样的东西。
 */
function sashStyleOf(sash: SashRef): Record<string, string> | undefined {
    const branch = findBranch(props.projection.input, sash.branch);
    const before = branch?.children.find((child) => child.id === sash.before);
    if (branch === null || before === undefined || sashKindOf(branch, sash.before, sash.after, roleOf, groupOf) !== "panes") return undefined;
    const leaves = leafIdsOf(before);
    const first = cardOf(leaves[0] ?? "");
    const last = cardOf(leaves.at(-1) ?? "");
    if (first === undefined || last === undefined) return undefined;
    // 纵向的分支里是横着的一条，两端是左右；横向的分支里是竖着的一条，两端是上下。
    const [start, end] = branch.orientation === "vertical" ? [first.left, last.right] : [first.top, last.bottom];
    const style: Record<string, string> = {"--shell-sash-fill-start": cardInset(start), "--shell-sash-fill-end": cardInset(end)};
    // 相连的那一端（侧栏挨着活动栏）卡片自己的投影由外层裁掉，这一条也不往外放投影，否则落在活动栏上（输出 19）。
    if (start.kind === "joined") style["--shell-sash-shadow-start"] = "0px";
    if (end.kind === "joined") style["--shell-sash-shadow-end"] = "0px";
    const bar = capLeaves.value.get(leaves[0] ?? "");
    const barCard = bar === undefined ? undefined : cardOf(bar.leaf);
    if (bar !== undefined && barCard !== undefined) {
        style["--shell-sash-cap"] = cardInset(barCard[barFacing(bar)]);
        // 右轨在右边：补的那一截在线的右边。
        if (bar.side === "end") Object.assign(style, {"--shell-sash-cap-right": "auto", "--shell-sash-cap-left": "100%"});
    }
    return style;
}

/**
 * 一列分节全部收成标题行时（投影的 `fillers`，最后一节垫底、外框拉到了底）这一列的分隔线不能拖（docs/specs/ui/workbench-layout.md 输出 11）：
 * 拖开时预览里垫底的那一节在吸收，松手后它回到标题行、刚展开的那一节吸收，结果和预览对不上。展开靠点标题或命令。
 */
const fillerColumns = computed<ReadonlySet<string>>(() => {
    const columns = new Set<string>();
    const visit = (node: GridNodeInput<string>): void => {
        if (node.kind === "leaf") return;
        if (node.children.some((child) => props.projection.fillers.has(child.id))) columns.add(node.id);
        node.children.forEach(visit);
    };
    if (props.projection.fillers.size > 0) visit(props.projection.input);
    return columns;
});
const sashDisabledOf = (sash: SashRef): boolean => fillerColumns.value.has(sash.branch);

// ── 指针与焦点在哪块面板 ──────────────────────────────────────────────────

/**
 * 指针、焦点按叶记，面板按此刻的投影现算（输出 36）：在入口条里点入口切容器时焦点没动、没有新的 `focusin`，并进来的那一节一换，当前面板跟着换。
 */
const pointerLeaf = shallowRef<string | null>(null);
const focusedLeaf = shallowRef<string | null>(null);
const pointerPanel = computed(() => panelOfLeaf(pointerLeaf.value));
const focusedPanel = computed(() => {
    const panel = panelOfLeaf(focusedLeaf.value);
    return panel !== null && props.doc.panels[panel] !== undefined ? panel : null;
});
watch(focusedPanel, (panel) => emit("focus-panel", panel));

/** 外框和内容项都是这个 grid 根的直接子元素；视图里还可以嵌别的 grid，往外找到属于这一层的那个。 */
function leafOf(target: EventTarget | null): string | null {
    const gridRoot = rootEl.value?.querySelector(":scope > [data-grid-scope]");
    let element = target instanceof Element ? target.closest("[data-content-leaf], [data-leaf]") : null;
    while (element !== null && element.parentElement !== gridRoot) element = element.parentElement?.closest("[data-content-leaf], [data-leaf]") ?? null;
    return element?.getAttribute("data-content-leaf") ?? element?.getAttribute("data-leaf") ?? null;
}

function onFocusIn(event: FocusEvent): void {
    focusedLeaf.value = leafOf(event.target);
}

function onFocusOut(event: FocusEvent): void {
    if (!(event.relatedTarget instanceof Node) || rootEl.value?.contains(event.relatedTarget) !== true) focusedLeaf.value = null;
}

const actionsShownOn = (panel: string | null): boolean => panel !== null && (pointerPanel.value === panel || focusedPanel.value === panel);

defineExpose({
    /** 进行中的过渡直接到终点（拖动拿起后要量矩形）。 */
    settleMotion: (): void => gridEl.value?.settleMotion(),
    /** 写拿起的内容项的矩形：跟手，不走渲染。 */
    placeLifted: (rect: GridRect): void => gridEl.value?.placeLifted(rect),
    /** 网格根的左上角（视口坐标）：实时布局的卡片与空位相对它。 */
    origin: (): {x: number; y: number} => gridEl.value?.origin() ?? {x: 0, y: 0},
    /** 网格上的布局过渡时长；减少动效时是 0，实时布局不走。 */
    motionMs: (): number => gridEl.value?.motionMs() ?? 0,
    /** 拖动中挪窗：跟手，不走渲染。`null` 回到原处。 */
    placeFloat: (panel: string, offset: {readonly x: number; readonly y: number} | null): void => gridEl.value?.placeFloat(panel, offset),
    /** F6、Shift+F6（输出 18）：命令由宿主绑。 */
    moveFocus: (direction: "next" | "previous"): boolean => moveGridFocus(rootEl.value, direction),
});
</script>

<template>
    <div
        ref="rootEl"
        class="workbench-surface"
        tabindex="-1"
        data-workbench-surface
        @pointerover="pointerLeaf = leafOf($event.target)"
        @pointerleave="pointerLeaf = null"
        @focusin="onFocusIn"
        @focusout="onFocusOut"
    >
        <NestedGrid
            ref="grid"
            v-bind="host.bindings.value"
            :contents="contents"
            :lifted="lifted"
            :dragging="dragging"
            :gesturing="gesturing"
            :keep-leaving="KEEP_LEAVING"
            :floats="floats"
            :maximized="maximizedLeaf"
            :sash-kind="sashKind"
            :sash-style="sashStyleOf"
            :sash-disabled="sashDisabledOf"
            :leaf-shape="shapeOf"
            :swap="gridSwap"
            @gesture-update="onGesturePreview"
            @gesture-end="onGestureSettled"
            @gesture-cancel="onGestureSettled"
            @content-parked="(key: string) => emit('content-parked', key)"
            @float-raise="(id: string) => emit('raise-float', id)"
        >
            <template #leaf="{node}">
                <div class="workbench-surface__slot" :style="insetOf(node.id)">
                    <slot v-if="node.id === STATUS_BAR" name="statusbar"></slot>
                    <div
                        v-else
                        class="workbench-surface__card"
                        :data-shell-card="node.id"
                        :data-shell-join="joinOf(node.id)"
                        :data-shell-join-seam="barSeamOf(node.id)"
                        :data-shell-cap="capOf(node.id)"
                        :data-shell-slot="node.id === slotPanel ? '' : undefined"
                        :data-panel-role="roleOf(node.id) ?? undefined"
                        :data-panel-name="swappingLeaves.has(node.id) ? undefined : sceneOf(node.id)"
                        :data-hover-actions-scope="panelOfLeaf(node.id) === null || roleOf(node.id) === null || isSectionCollapsed(doc, node.id) ? undefined : ''"
                        :data-hover-actions-active="actionsShownOn(panelOfLeaf(node.id)) ? '' : undefined"
                    >
                        <slot v-if="node.id === ACTIVITY_BAR" name="activitybar" :joined="joinOf(node.id) !== undefined"></slot>
                        <slot v-else-if="regionOfRailLeaf(node.id) !== null" name="rail" :region="regionOfRailLeaf(node.id)!" :joined="joinOf(node.id) !== undefined"></slot>
                        <template v-else-if="node.id !== slotPanel">
                            <div v-if="roleOf(node.id) === 'editor'" v-editor-head class="workbench-surface__editor-head" :data-surface-head="node.id">
                                <slot name="head" :panel-id="node.id" :id-prefix="idPrefix"></slot>
                            </div>
                            <slot v-else-if="isEmptyRegion(node.id)" name="empty-region" :panel-id="node.id"></slot>
                            <slot v-else-if="regionOfStripLeaf(node.id) !== null" name="strip" :region="regionOfStripLeaf(node.id)!" :merged="mergedIn(node.id)" :id-prefix="idPrefix"></slot>
                            <slot v-else-if="roleOf(node.id) === 'tool' && !headless.has(node.id)" name="head" :panel-id="node.id" :id-prefix="idPrefix"></slot>
                        </template>
                    </div>
                </div>
            </template>
            <template #swap-backdrop="{inset}">
                <div class="workbench-surface__slot" :style="swapBackdropStyle(inset)">
                    <div class="workbench-surface__card" data-panel-role="tool" data-shell-swap-card :data-panel-name="swapScene"></div>
                </div>
            </template>
            <template #content="{contentKey, leaf, active}">
                <div class="workbench-surface__content" :style="insetOf(leaf)">
                    <div
                        :id="roleOf(leaf) === 'tool' ? panelTabpanelDomId(idPrefix, contentKey) : undefined"
                        class="workbench-surface__content-clip"
                        :data-own-head="ownHeadFloats.has(leaf) ? '' : undefined"
                        :style="ownHeadFloats.has(leaf) ? {'--workbench-own-head-inset-end': `${ownHeads.get(leaf) ?? 0}px`} : undefined"
                        :role="roleOf(leaf) === 'tool' ? (titleOnlyPanels.has(leaf) ? 'region' : 'tabpanel') : undefined"
                        :aria-labelledby="roleOf(leaf) === 'tool' ? (titleOnlyPanels.has(leaf) ? panelTitleDomId(idPrefix, contentKey) : panelTabDomId(idPrefix, contentKey)) : undefined"
                        :data-panel-role="roleOf(leaf) ?? undefined"
                    >
                        <slot v-if="ownHeadFloats.has(leaf) && active" name="own-head" :panel-id="leaf" :id-prefix="idPrefix" :actions-shown="actionsShownOn(leaf)"></slot>
                        <slot name="content" :content-key="contentKey" :panel-id="leaf" :active="active"></slot>
                    </div>
                </div>
            </template>
            <template #lifted-head>
                <slot name="lifted-head"></slot>
            </template>
            <template #overlay>
                <slot name="overlay"></slot>
            </template>
            <template #float-chrome="{id, rect}">
                <slot name="float-chrome" :id="id" :rect="rect"></slot>
            </template>
        </NestedGrid>
    </div>
</template>

<style scoped>
/*
 * 卡片外壳（docs/specs/ui/workbench-layout.md 输出 19）：缝、圆角、投影与接缝颜色都是主题变量，缺省即平铺（缝 0、无圆角、接缝是 --divider）。
 * 卡片画在外框里；内容层是外框的兄弟，所以它自己也按同样的内边距缩进、按同样的圆角裁切，两层才拼成一张卡片。
 */
.workbench-surface {
    --nb-layout-splitter-seam: var(--shell-seam, var(--divider));
    position: relative;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
}

/* 浮动窗不贴着别的卡片：圆角用卡片的，投影画在外框上（NestedGrid），里面的卡片不再画一层。 */
.workbench-surface :deep(.nb-grid-frame[data-float]),
.workbench-surface :deep(.nb-grid-content[data-float]) {
    --shell-card-radius: var(--layout-card-radius);
    --shell-card-shadow: none;
}

/*
 * 同一张卡片里几节之间的线（`panes`，输出 19）是开放式分割线：颜色按主题，沿长轴两端按主题缩进（悬停线也是）。编辑组之间的线和外壳的接缝一样取
 * `--shell-seam`、贯通整个高度：一组一张卡片，卡片主题里缝就是分界，不画线（开发者 2026-11-16）。
 */
.workbench-surface :deep(.nb-grid-sash[data-sash-kind="panes"]) {
    --nb-layout-splitter-seam: var(--shell-pane-divider, var(--divider));
    --nb-layout-splitter-seam-inset: var(--shell-pane-divider-inset, 0px);
    --nb-layout-sash-line-inset: var(--shell-pane-divider-inset, 0px);
}

/*
 * 这条线占的那 1px 也是卡片（`sashStyleOf` 给范围）：底色同卡片，带卡片的投影，接上两边卡片的外框与投影。线与悬停线画在上面。
 * 画底的那一块沿主轴往两边各多伸 8px、再裁回这 1px：只有 1px 高（宽）的元素做模糊投影，侧边的投影只有整张卡片的几分之一，伸长了才和卡片侧边一样深；
 * 沿长轴放出 8px，投影露在卡片外面；相连的那一端不放（`--shell-sash-shadow-*` 为 0）。平铺主题缝为 0、没有投影，结果是一条贯通的线。
 */
.workbench-surface :deep(.nb-grid-sash[data-sash-kind="panes"]::before) {
    position: absolute;
    background: var(--panel-surface);
    box-shadow: var(--shell-card-shadow, none);
    content: "";
    pointer-events: none;
}

.workbench-surface :deep(.nb-grid-sash.nb-splitter__sash--vertical[data-sash-kind="panes"]::before) {
    inset: -8px var(--shell-sash-fill-end, 0px) -8px var(--shell-sash-fill-start, 0px);
    clip-path: inset(8px var(--shell-sash-shadow-end, -8px) 8px var(--shell-sash-shadow-start, -8px));
}

.workbench-surface :deep(.nb-grid-sash.nb-splitter__sash--horizontal[data-sash-kind="panes"]::before) {
    inset: var(--shell-sash-fill-start, 0px) -8px var(--shell-sash-fill-end, 0px) -8px;
    clip-path: inset(var(--shell-sash-shadow-start, -8px) 8px var(--shell-sash-shadow-end, -8px) 8px);
}

/*
 * 区域的角接过去的这段（`capLeaves`）：每一块朝着侧轨伸过它的半缝，伸出去的部分是侧轨的底色；伸出去的部分裁在各自的外框里，两块之间这一行没有，
 * 由这条线朝侧轨补上同样宽的一截（`--shell-sash-cap`；右轨在右边时 `--shell-sash-cap-left`、`-right` 把它翻到线的右边）。
 * 只补半缝：这一行在区域中间，侧轨在这里是直的，圆角只在它的两头。
 */
.workbench-surface :deep(.nb-grid-sash.nb-splitter__sash--vertical[data-sash-kind="panes"]::after) {
    position: absolute;
    top: 0;
    right: var(--shell-sash-cap-right, 100%);
    bottom: 0;
    left: var(--shell-sash-cap-left, auto);
    width: var(--shell-sash-cap, 0px);
    background: var(--skin-activitybar-surface, var(--panel-surface));
    content: "";
    pointer-events: none;
}

.workbench-surface__slot {
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
}

.workbench-surface__card {
    position: relative;
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    /* 四个角各自按两侧相不相连（`insetOf`）；没有写的（浮动窗）按卡片的圆角。 */
    border-radius: var(--shell-corner-tl, var(--shell-card-radius, 0px)) var(--shell-corner-tr, var(--shell-card-radius, 0px)) var(--shell-corner-br, var(--shell-card-radius, 0px)) var(--shell-corner-bl, var(--shell-card-radius, 0px));
    box-shadow: var(--shell-card-shadow, none);
}

.workbench-surface__card[data-panel-role] {
    background: var(--panel-surface);
}

/* 侧栏切换滚动中：卡片由静止的底画（`swap-backdrop`），滑动的外框不画自己的底与投影，只带着头与内容（输出 42）。 */
.workbench-surface :deep(.nb-grid-frame[data-swap]) .workbench-surface__card {
    background: transparent;
    box-shadow: none;
}

/* 空位：放下才有卡片（输出 38）。写在角色的底色后面，同样的特异性后写的赢。 */
.workbench-surface__card[data-shell-slot] {
    background: transparent;
    box-shadow: none;
}

/* 相连的侧轨与区域之间一条两端不碰顶底的短线，画在侧轨朝着区域的那一头；不需要时主题把颜色设成透明。 */
.workbench-surface__card[data-shell-join-seam]::after {
    content: "";
    position: absolute;
    inset-block: 10px;
    inset-inline-end: 0;
    z-index: 1;
    width: var(--border-w);
    background: var(--shell-join-divider, transparent);
    pointer-events: none;
}

/* 右轨的短线在它左边（`barSeamOf` 给 `start`）。 */
.workbench-surface__card[data-shell-join-seam="start"]::after {
    inset-inline-start: 0;
    inset-inline-end: auto;
}

/*
 * 面板的角接过去的这段（`capOf`）：侧轨不画投影，伸过来的那一截压在它下面，投影会在上面描出它朝着区域那一边与圆角（面板的投影这期间也裁掉了，结束时一起出现）；
 * 短线隐藏时淡出、显示时淡入，和网格的过渡同一个时长与曲线，减少动效时时长为 0、直接到位。
 */
.workbench-surface__card[data-shell-cap] {
    box-shadow: none;
}

.workbench-surface__card[data-shell-cap="enter"]::after {
    animation: workbench-surface-seam-in var(--motion-layout) var(--ease-layout) both;
}

.workbench-surface__card[data-shell-cap="leave"]::after {
    animation: workbench-surface-seam-out var(--motion-layout) var(--ease-layout) both;
}

@keyframes workbench-surface-seam-in {
    from {
        opacity: 0;
    }
}

@keyframes workbench-surface-seam-out {
    to {
        opacity: 0;
    }
}

/*
 * 侧栏与右栏下角的场景图（docs/specs/theme/skins.md 输出 6）：只有这两个区域，跟着区域走，不跟着视图走；`data-panel-name` 只写在区域最下面那块上（`sceneCorners`）。图在外框里，内容层盖在上面；
 * 高度不足 300px 不画，靠容器查询。
 */
.workbench-surface__card[data-panel-name="sidebar"],
.workbench-surface__card[data-panel-name="auxiliarybar"] {
    /* 自成一层：下面的 z-index 只在这一层里，图盖在面上。 */
    isolation: isolate;
    container-type: size;
}

:global([data-nb-skin-scene] .workbench-surface__card[data-panel-name="sidebar"]::after),
:global([data-nb-skin-scene] .workbench-surface__card[data-panel-name="auxiliarybar"]::after) {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    height: 240px;
    background-image: var(--skin-scene);
    background-repeat: no-repeat;
    content: "";
    mask-image: linear-gradient(to top, #000 10%, transparent 92%);
    pointer-events: none;
    z-index: -1;
}

:global([data-nb-skin-scene] .workbench-surface__card[data-panel-name="sidebar"]::after) {
    background-position: var(--skin-sidebar-corner-position, 0 0);
    background-size: var(--skin-sidebar-corner-size, 0 0);
}

:global([data-nb-skin-scene] .workbench-surface__card[data-panel-name="auxiliarybar"]::after) {
    background-position: var(--skin-auxiliary-corner-position, 0 0);
    background-size: var(--skin-auxiliary-corner-size, 0 0);
    /* 对话列表的文字比资源管理器的行更常压在图上；淡一些，亮暗两套都给次要文字留足对比度（skins.md 验收 12）。 */
    opacity: 0.7;
}

@container (max-height: 299px) {
    :global([data-nb-skin-scene] .workbench-surface__card[data-panel-name="sidebar"]::after),
    :global([data-nb-skin-scene] .workbench-surface__card[data-panel-name="auxiliarybar"]::after) {
        display: none;
    }
}

@media (prefers-contrast: more), (forced-colors: active) {
    :global([data-nb-skin-scene] .workbench-surface__card[data-panel-name="sidebar"]::after),
    :global([data-nb-skin-scene] .workbench-surface__card[data-panel-name="auxiliarybar"]::after) {
        display: none;
    }
}

.workbench-surface__content {
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
}

/* 内容在头下面，只有下面两个角是卡片的角（编辑组没有头时上面两个角是外框的底色，圆角由卡片裁）。 */
.workbench-surface__content-clip {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    border-end-start-radius: var(--shell-corner-bl, var(--shell-card-radius, 0px));
    border-end-end-radius: var(--shell-corner-br, var(--shell-card-radius, 0px));
}

/* 视图自绘头的浮动窗没有头，内容顶到窗口的上边，上面两个角也是卡片的角：列表栏的底色不从圆角外露出来。盖在视图之上的那一条相对它定位。 */
.workbench-surface__content-clip[data-own-head] {
    position: relative;
    border-start-start-radius: var(--shell-corner-tl, var(--shell-card-radius, 0px));
    border-start-end-radius: var(--shell-corner-tr, var(--shell-card-radius, 0px));
}

/* 飞行中压在别的面板上面（输出 15）：内容平时透明，露出卡片的底与场景图；飞的时候离开了卡片，要自己带底，不和下面的字叠在一起。 */
.workbench-surface :deep(.nb-grid-content[data-flying]) .workbench-surface__content-clip {
    background: var(--panel-surface);
}

/*
 * 编辑组的头：一到三行标签加提示条。组矮的时候先收它：下面要给正文留面包屑 26、进度条 2、一行字 28。
 */
.workbench-surface__editor-head {
    display: flex;
    flex: 0 1 auto;
    flex-direction: column;
    min-height: 0;
    max-height: calc(100% - 56px);
}
</style>
