<script setup lang="ts">
/**
 * 一棵树的工作台表面（同名 .md）：把布局文档画成一个 NestedGrid，外框里是卡片与面板头，内容在内容层。文档与投影由宿主给，这里只测量、发布呈现事实、按邻接算卡片。
 */
import {createGrid, hiddenRegionsAtZero, isContainerAnchor, isPanelShown, regionNodeOf, treeLeaves} from "@notnotype/nb-layout";
import type {Grid, GridBranchInput, GridExtent, GridFloatInput, GridGesturePreview, GridLeafShape, GridNodeInput, GridRect, LayoutDoc, LayoutProjection, PanelName} from "@notnotype/nb-layout";
import {moveGridFocus, NestedGrid, useGridLayout, useLayoutExtent} from "@notnotype/nb-layout/vue";
import {computed, onBeforeUnmount, onMounted, ref, shallowRef, useId, useTemplateRef, watch} from "vue";
import type {Directive} from "vue";

import {cardInset, layoutCardEdges, maximizedCardEdges, sashKindOf} from "../shell/adjacency";
import type {CardEdges} from "../shell/adjacency";
import {layoutContents, panelTabDomId, panelTabpanelDomId} from "../state/layout-present";
import "./hover-actions.css";

const ACTIVITY_BAR = "activitybar";
const STATUS_BAR = "statusbar";
/** 状态栏不是卡片（输出 19）。 */
const PLAIN: ReadonlySet<string> = new Set([STATUS_BAR]);
const BARS: ReadonlyArray<string> = [ACTIVITY_BAR, STATUS_BAR];

defineOptions({name: "WorkbenchSurface"});

const props = withDefaults(defineProps<{
    doc: LayoutDoc;
    projection: LayoutProjection;
    contextKey: string;
    maximized?: string | null;
    disabled?: boolean;
    /** 头只写标题的面板：没有标签带，内容就不是 `tabpanel`。 */
    titleOnlyPanels?: ReadonlySet<string>;
    /** 实时布局预览里的空位：这块什么都不画，露出窗体底（输出 38）。 */
    slotPanel?: string | null;
    /** 拿起的内容项（实时布局），`home` 是它已提交时所在的面板：预览把来源摘掉时内容也不能卸载。矩形由 `placeLifted` 写。 */
    lifted?: {readonly key: string; readonly home: string | null} | null;
    /** 拖动进行中：网格不留着离开的叶缩回去（`NestedGrid` 的 `dragging`）。 */
    dragging?: boolean;
    /** 画出来的浮动窗：矩形已夹取，拖动中是预览。 */
    floats?: ReadonlyArray<GridFloatInput>;
}>(), {maximized: null, disabled: false, titleOnlyPanels: () => new Set<string>(), slotPanel: null, lifted: null, dragging: false, floats: () => []});

const emit = defineEmits<{
    (event: "extent", extent: GridExtent | null): void;
    /** 主题的缝宽变了（`--shell-gap`）：活动栏的叶宽要算上它。 */
    (event: "card-gap", gap: number): void;
    /** 布局发布了：这一刻的呈现尺寸。 */
    (event: "presented", sizes: Readonly<Record<string, GridExtent>>): void;
    /** 手势进行中的预览尺寸；手势结束或预览撤回时是 null。 */
    (event: "preview", sizes: Readonly<Record<string, GridExtent>> | null): void;
    /** 手势落账：呈现尺寸，以及这次手势改了收起状态的面板。 */
    (event: "gesture-commit", sizes: Readonly<Record<string, GridExtent>>, collapsed: Readonly<Record<string, boolean>>): void;
    (event: "issues", issues: readonly string[]): void;
    /** 内容项要被停放，这一刻焦点还在里面：焦点去哪由宿主定（输出 16）。 */
    (event: "content-parked", key: string): void;
    /** 焦点现在在哪块面板；离开所有面板时是 null。宿主据此记当前面板（输出 36）。 */
    (event: "focus-panel", panel: string | null): void;
    /** 指针按在浮动窗上，或焦点进了它：提到最前。 */
    (event: "raise-float", panel: string): void;
}>();

defineSlots<{
    activitybar?(): unknown;
    statusbar?(): unknown;
    /** 面板的头，工具面板与编辑组都在这里。`idPrefix` 交给 `WorkbenchPanelHead`，标签和内容才对得上。 */
    head?(props: {panelId: string; idPrefix: string}): unknown;
    /** 打开着的空区域（区域的锚进了呈现树，ADR 0050）：整块卡片里画什么，没有头。 */
    "empty-region"?(props: {panelId: string}): unknown;
    content?(props: {contentKey: string; panelId: string; active: boolean}): unknown;
    /** 拿起的内容项的头。 */
    "lifted-head"?(props: {contentKey: string}): unknown;
    /** 盖在分隔线之上、拿起的内容之下，不接指针。 */
    overlay?(): unknown;
    /** 浮动窗的手柄。 */
    "float-chrome"?(props: {id: string; rect: GridRect}): unknown;
}>();

const rootEl = ref<HTMLElement | null>(null);
const gridEl = useTemplateRef<InstanceType<typeof NestedGrid>>("grid");
const extent = useLayoutExtent(rootEl);
const idPrefix = useId();
const preview = shallowRef<Readonly<Record<string, GridExtent>> | null>(null);

// 同步发：store 的投影依赖尺寸，晚一拍就会用旧树算一次新尺寸的布局。
watch(extent, (next) => emit("extent", next), {immediate: true, flush: "sync"});

/** 主题写在文档根上，换主题或明暗时文档根的属性与内联变量会变，这时重读。 */
let themeObserver: MutationObserver | null = null;
function readCardGap(): void {
    const root = rootEl.value;
    if (root === null) return;
    const value = Number.parseFloat(getComputedStyle(root).getPropertyValue("--shell-gap"));
    emit("card-gap", Number.isFinite(value) ? value : 0);
}
onMounted(() => {
    readCardGap();
    themeObserver = new MutationObserver(readCardGap);
    themeObserver.observe(document.documentElement, {attributes: true, attributeFilter: ["data-nb-theme", "data-nb-appearance", "style"]});
});
onBeforeUnmount(() => themeObserver?.disconnect());

const grid = computed<Grid<string>>(() => createGrid<string>(props.projection.input, {sashSize: props.projection.sashSize}));
const host = useGridLayout<string>({
    grid,
    extent,
    contextKey: () => props.contextKey,
    onApplied: (_commit, result) => emit("gesture-commit", host.layout.value.sizes, result.collapsed),
    onIssues: (issues) => emit("issues", issues),
});

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
    for (const entry of entries) {
        const panel = (entry.target as HTMLElement).dataset.surfaceHead;
        // 布局尺寸，不用 `getBoundingClientRect`：Lab 的画布有 CSS `zoom`，内容的矩形也是布局尺寸。
        if (panel !== undefined) next[panel] = entry.borderBoxSize[0]?.blockSize ?? 0;
    }
    editorHeadHeights.value = next;
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
    const items = layoutContents(props.doc, (panel) => editorHeadHeights.value[panel] ?? EDITOR_HEAD_ONE_ROW);
    const {lifted} = props;
    if (lifted === null || items.some((item) => item.key === lifted.key)) return items;
    // 预览把来源摘掉了：内容项还得在，不然实例就卸了。它的叶可能也不在了，矩形由 `placeLifted` 给。
    return [...items, {key: lifted.key, leaf: lifted.home ?? "", insetTop: 0, active: false}];
});
const maximizedLeaf = computed(() => (props.maximized === null ? null : {leaf: props.maximized, exclude: BARS}));

const roleOf = (id: string): "tool" | "editor" | null => props.doc.panels[id]?.role ?? null;

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

/** 卡片跟着拖动中的预览走：相连与否按拖动中的几何算（输出 19）。 */
const cards = computed<Readonly<Record<string, CardEdges>>>(() => {
    const computedCards = layoutCardEdges({
        root: props.projection.input,
        sizes: preview.value ?? host.layout.value.sizes,
        sashSizes: host.layout.value.sashSizes,
        activitybar: ACTIVITY_BAR,
        plain: PLAIN,
        isTool: (id) => roleOf(id) === "tool",
    });
    return props.maximized === null ? computedCards : maximizedCardEdges(computedCards, props.maximized, ACTIVITY_BAR);
});

/**
 * 缩回去的叶（docs/specs/ui/nested-grid.md 的“过渡”：隐藏、拖到零的区域降到零，离开的节点留在过渡里）这一刻的布局已经是终点：零宽，或不在呈现里。
 * 卡片四边、相连与场景图沿用它最后一次有尺寸时的，不然缩回去的第一帧卡片就少了外边距、换了圆角。只记呈现着、有尺寸的叶，缩完、回来了就用新算的。
 */
const leafIdsOf = (node: GridNodeInput<string>): string[] => (node.kind === "leaf" ? [node.id] : node.children.flatMap(leafIdsOf));
const presentedLeaves = computed(() => new Set(leafIdsOf(props.projection.input)));
const outgoingLeaves = computed<ReadonlySet<string>>(() => gridEl.value?.outgoingLeaves ?? new Set());
const lastPresented = {cards: new Map<string, CardEdges>(), scene: new Map<string, PanelName>()};
watch([cards, sceneCorners, presentedLeaves], ([nextCards, nextScene, presented]) => {
    const sizes = preview.value ?? host.layout.value.sizes;
    for (const id of presented) {
        const size = sizes[id];
        if (size !== undefined && (size.width <= 0 || size.height <= 0)) continue;
        const edges = nextCards[id];
        if (edges === undefined) lastPresented.cards.delete(id);
        else lastPresented.cards.set(id, edges);
        const scene = nextScene.get(id);
        if (scene === undefined) lastPresented.scene.delete(id);
        else lastPresented.scene.set(id, scene);
    }
}, {immediate: true, flush: "sync"});
/**
 * 不在呈现里、也不在缩回去的叶，最后一次的记录用不上了：编辑组每次拆分都是新 id，不清就一直长。等 `NestedGrid` 判完过渡再清（`post`）：
 * 刚离开、要留着缩回去的那块这时已经在 `outgoingLeaves` 里，它缩回去的这段还要用记录。
 */
watch([presentedLeaves, outgoingLeaves], ([presented, outgoing]) => {
    for (const records of [lastPresented.cards, lastPresented.scene]) {
        for (const id of records.keys()) if (!presented.has(id) && !outgoing.has(id)) records.delete(id);
    }
}, {flush: "post"});
/**
 * 和活动栏相连的工具面板隐藏、在过渡里缩回去时（docs/specs/ui/workbench-layout.md 输出 19），活动栏照旧贴着它、不留缝：两张卡片作为一张缩回去，缩完
 * 才留出缝。按这一刻的布局算的话活动栏第一帧就断开了（拖到零不相连），第一帧就让出缝，而缩回去的面板还是相连的样子，贴着它的那边是直的。相连只在活动栏和它右边的工具面板之间，
 * 所以缩回去的叶最后一次有尺寸时左边相连，就是和活动栏连着。
 * 留着的只是缝（`insetOf`）：活动栏相接的两个角按这一刻的布局，隐藏一开始就往圆角过渡，和面板缩回去同时走完，正好是显示时的倒放（`joinOf`）。
 */
const drawnAsBefore = (id: string): boolean => !presentedLeaves.value.has(id) || outgoingLeaves.value.has(id);
const barJoinHeld = computed(() => [...outgoingLeaves.value].some((id) => lastPresented.cards.get(id)?.left.kind === "joined"));
/** 这块卡片的四边：离开的叶用最后一次呈现的。`holdBarJoin`：缩回去的面板还和活动栏连着时，活动栏右边仍算相连（只给缝用）。 */
function cardOf(id: string, holdBarJoin: boolean): CardEdges | undefined {
    if (drawnAsBefore(id)) return lastPresented.cards.get(id) ?? cards.value[id];
    const card = cards.value[id];
    return holdBarJoin && id === ACTIVITY_BAR && card !== undefined && barJoinHeld.value ? {...card, right: {kind: "joined"}} : card;
}
const sceneOf = (id: string): PanelName | undefined => (drawnAsBefore(id) ? lastPresented.scene.get(id) : sceneCorners.value.get(id));

function insetOf(id: string): Record<string, string> {
    const edges = cardOf(id, true);
    return edges === undefined ? {} : {padding: [edges.top, edges.right, edges.bottom, edges.left].map(cardInset).join(" ")};
}

/** 活动栏与工具面板相连时，相接的一侧不圆（活动栏是 start，面板是 end）；不留缝的是 `insetOf`。 */
function joinOf(id: string): "start" | "end" | undefined {
    const edges = cardOf(id, false);
    if (edges?.right.kind === "joined") return "start";
    if (edges?.left.kind === "joined") return "end";
    return undefined;
}

/** 活动栏和右边的工具面板之间那条短线：跟着缝走（`insetOf`），两张卡片还贴着就画，缩完才和缝一起没。 */
const barSeamOf = (id: string): "" | undefined => (id === ACTIVITY_BAR && cardOf(id, true)?.right.kind === "joined" ? "" : undefined);

/**
 * 卡片在外框里的形状（NestedGrid 的 `leafShape`）：过渡中外框露出、盖住保持尺寸的面板时按它裁，露出来的一截是一张完整的卡片。
 * 和 `insetOf`、`joinOf` 同一来源，离开的叶用最后一次呈现的；相连的一侧不圆。圆角按物理方向给（工作台只有从左到右）。
 */
function shapeOf(id: string): GridLeafShape | undefined {
    const edges = cardOf(id, true);
    if (edges === undefined || PLAIN.has(id)) return undefined;
    const round = "var(--shell-card-radius, 0px)";
    const join = joinOf(id);
    const left = join === "end" ? "0px" : round;
    const right = join === "start" ? "0px" : round;
    return {inset: [cardInset(edges.top), cardInset(edges.right), cardInset(edges.bottom), cardInset(edges.left)], radius: [left, right, right, left]};
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

function sashKind(sash: {readonly branch: string; readonly before: string; readonly after: string}): string | undefined {
    const branch = findBranch(props.projection.input, sash.branch);
    return branch === null ? undefined : sashKindOf(branch, sash.before, sash.after, roleOf);
}

// ── 指针与焦点在哪块面板 ──────────────────────────────────────────────────

const pointerPanel = shallowRef<string | null>(null);
const focusedPanel = shallowRef<string | null>(null);

/** 外框和内容项都是这个 grid 根的直接子元素；视图里还可以嵌别的 grid，往外找到属于这一层的那个。 */
function panelOf(target: EventTarget | null): string | null {
    const gridRoot = rootEl.value?.querySelector(":scope > [data-grid-scope]");
    let element = target instanceof Element ? target.closest("[data-content-leaf], [data-leaf]") : null;
    while (element !== null && element.parentElement !== gridRoot) element = element.parentElement?.closest("[data-content-leaf], [data-leaf]") ?? null;
    return element?.getAttribute("data-content-leaf") ?? element?.getAttribute("data-leaf") ?? null;
}

function raiseIfFloat(target: EventTarget | null): void {
    const chrome = target instanceof Element ? target.closest("[data-float-chrome]")?.getAttribute("data-float-chrome") : null;
    const panel = chrome ?? panelOf(target);
    if (panel !== null && props.floats.some((float) => float.id === panel)) emit("raise-float", panel);
}

function onFocusIn(event: FocusEvent): void {
    const panel = panelOf(event.target);
    setFocusedPanel(panel !== null && props.doc.panels[panel] !== undefined ? panel : null);
    raiseIfFloat(event.target);
}

function onFocusOut(event: FocusEvent): void {
    if (!(event.relatedTarget instanceof Node) || rootEl.value?.contains(event.relatedTarget) !== true) setFocusedPanel(null);
}

function setFocusedPanel(panel: string | null): void {
    if (focusedPanel.value === panel) return;
    focusedPanel.value = panel;
    emit("focus-panel", panel);
}

const actionsShownOn = (panel: string): boolean => pointerPanel.value === panel || focusedPanel.value === panel;

defineExpose({
    /** 进行中的过渡直接到终点（拖动拿起后要量矩形）。 */
    settleMotion: (): void => gridEl.value?.settleMotion(),
    /** 写拿起的内容项的矩形：跟手，不走渲染。 */
    placeLifted: (rect: GridRect): void => gridEl.value?.placeLifted(rect),
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
        @pointerover="pointerPanel = panelOf($event.target)"
        @pointerleave="pointerPanel = null"
        @pointerdown.capture="raiseIfFloat($event.target)"
        @focusin="onFocusIn"
        @focusout="onFocusOut"
    >
        <NestedGrid
            ref="grid"
            :node="host.node.value"
            :layout="host.layout.value"
            :disabled="disabled || extent === null"
            :context-key="contextKey"
            :revision="host.revision.value"
            :on-gesture-commit="host.onGestureCommit"
            :contents="contents"
            :lifted="lifted"
            :dragging="dragging"
            :floats="floats"
            :maximized="maximizedLeaf"
            :sash-kind="sashKind"
            :leaf-shape="shapeOf"
            @gesture-update="onGesturePreview"
            @gesture-end="onGestureSettled"
            @gesture-cancel="onGestureSettled"
            @issues="(issues: readonly string[]) => emit('issues', issues)"
            @content-parked="(key: string) => emit('content-parked', key)"
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
                        :data-shell-slot="node.id === slotPanel ? '' : undefined"
                        :data-panel-role="roleOf(node.id) ?? undefined"
                        :data-panel-name="sceneOf(node.id)"
                        :data-hover-actions-scope="roleOf(node.id) === null ? undefined : ''"
                        :data-hover-actions-active="actionsShownOn(node.id) ? '' : undefined"
                    >
                        <slot v-if="node.id === ACTIVITY_BAR" name="activitybar"></slot>
                        <template v-else-if="node.id !== slotPanel">
                            <div v-if="roleOf(node.id) === 'editor'" v-editor-head class="workbench-surface__editor-head" :data-surface-head="node.id">
                                <slot name="head" :panel-id="node.id" :id-prefix="idPrefix"></slot>
                            </div>
                            <slot v-else-if="isEmptyRegion(node.id)" name="empty-region" :panel-id="node.id"></slot>
                            <slot v-else-if="roleOf(node.id) === 'tool'" name="head" :panel-id="node.id" :id-prefix="idPrefix"></slot>
                        </template>
                    </div>
                </div>
            </template>
            <template #content="{contentKey, leaf, active}">
                <div class="workbench-surface__content" :style="insetOf(leaf)">
                    <div
                        :id="roleOf(leaf) === 'tool' ? panelTabpanelDomId(idPrefix, contentKey) : undefined"
                        class="workbench-surface__content-clip"
                        :role="roleOf(leaf) === 'tool' ? (titleOnlyPanels.has(leaf) ? 'region' : 'tabpanel') : undefined"
                        :aria-labelledby="roleOf(leaf) === 'tool' ? panelTabDomId(idPrefix, contentKey) : undefined"
                        :data-panel-role="roleOf(leaf) ?? undefined"
                        :data-shell-join="joinOf(leaf)"
                    >
                        <slot name="content" :content-key="contentKey" :panel-id="leaf" :active="active"></slot>
                    </div>
                </div>
            </template>
            <template #lifted-head="{contentKey}">
                <slot name="lifted-head" :content-key="contentKey"></slot>
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
    --nb-splitter-seam: var(--shell-seam, var(--divider));
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
 * 工具面板之间的线按主题（卡片主题里两节之间有缝，不画），沿长轴两端按主题缩进（悬停线也是）。编辑组之间的线和外壳的接缝一样取 `--shell-seam`、贯通整个高度：
 * 一组一张卡片，卡片主题里缝就是分界，不画线（开发者 2026-11-16）；当初编辑区是一张卡片、组画在里面，才要一条看得见的线。
 */
.workbench-surface :deep(.nb-grid-sash[data-sash-kind="panes"]) {
    --nb-splitter-seam: var(--shell-pane-divider, var(--divider));
    --nb-splitter-seam-inset: var(--shell-pane-divider-inset, 0px);
    --sash-line-inset: var(--shell-pane-divider-inset, 0px);
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
    border-radius: var(--shell-card-radius, 0px);
    box-shadow: var(--shell-card-shadow, none);
    /*
     * 相连、断开时相接的两个角在直角与圆角之间过渡（开发者 2026-11-13）：显示侧栏时活动栏的角随侧栏长出来变直，隐藏时随侧栏缩回去变圆
     * （开发者 2026-11-16：原来等缩完才变圆，像慢了一拍）。和网格的过渡同一个时长与曲线，所以同时走完；减少动效时为 0。
     */
    transition: border-radius var(--motion-layout) var(--ease-layout);
}

.workbench-surface__card[data-panel-role] {
    background: var(--panel-surface);
}

/* 空位：放下才有卡片（输出 38）。写在角色的底色后面，同样的特异性后写的赢。 */
.workbench-surface__card[data-shell-slot] {
    background: transparent;
    box-shadow: none;
}

.workbench-surface__card[data-shell-join="start"] {
    border-start-end-radius: 0;
    border-end-end-radius: 0;
}

.workbench-surface__card[data-shell-join="end"] {
    border-start-start-radius: 0;
    border-end-start-radius: 0;
}

/* 相连的活动栏与面板之间一条两端不碰顶底的短线；不需要时主题把颜色设成透明。 */
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
    border-end-start-radius: var(--shell-card-radius, 0px);
    border-end-end-radius: var(--shell-card-radius, 0px);
    /* 同卡片的角：相连、断开时跟卡片一起过渡。 */
    transition: border-radius var(--motion-layout) var(--ease-layout);
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

.workbench-surface__content-clip[data-shell-join="end"] {
    border-end-start-radius: 0;
}
</style>
