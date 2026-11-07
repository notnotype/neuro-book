<script setup lang="ts">
/**
 * 一棵树的工作台表面（同名 .md）：把布局文档画成一个 NestedGrid，外框里是卡片与面板头，内容在内容层。文档与投影由宿主给，这里只测量、发布呈现事实、按邻接算卡片。
 */
import {createGrid} from "@notnotype/nb-layout";
import type {Grid, GridBranchInput, GridExtent, GridFloatInput, GridGesturePreview, GridNodeInput, GridRect, LayoutDoc, LayoutProjection} from "@notnotype/nb-layout";
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
    /** 拿起的内容项（实时布局），`home` 是它已提交时所在的面板：预览把来源摘掉时内容也不能卸载。 */
    lifted?: {readonly key: string; readonly rect: GridRect; readonly home: string | null} | null;
    /** 画出来的浮动窗：矩形已夹取，拖动中是预览。 */
    floats?: ReadonlyArray<GridFloatInput>;
}>(), {maximized: null, disabled: false, titleOnlyPanels: () => new Set<string>(), lifted: null, floats: () => []});

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

// 卡片的矩形每帧变，内容项不该跟着重算：只取键与来源。
const liftedKey = computed(() => props.lifted?.key ?? null);
const liftedHome = computed(() => props.lifted?.home ?? null);
const contents = computed(() => {
    const items = layoutContents(props.doc, (panel) => editorHeadHeights.value[panel] ?? EDITOR_HEAD_ONE_ROW);
    const key = liftedKey.value;
    if (key === null || items.some((item) => item.key === key)) return items;
    // 预览把来源摘掉了：内容项还得在，不然实例就卸了。它的叶可能也不在了，矩形由 `lifted` 给。
    return [...items, {key, leaf: liftedHome.value ?? "", insetTop: 0, active: false}];
});
const liftedItem = computed(() => (props.lifted === null ? null : {key: props.lifted.key, rect: props.lifted.rect}));
const maximizedLeaf = computed(() => (props.maximized === null ? null : {leaf: props.maximized, exclude: BARS}));

const roleOf = (id: string): "tool" | "editor" | null => props.doc.panels[id]?.role ?? null;

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

function insetOf(id: string): Record<string, string> {
    const edges = cards.value[id];
    return edges === undefined ? {} : {padding: [edges.top, edges.right, edges.bottom, edges.left].map(cardInset).join(" ")};
}

/** 活动栏与工具面板相连时，相接的一侧不圆、不留缝（活动栏是 start，面板是 end）。 */
function joinOf(id: string): "start" | "end" | undefined {
    const edges = cards.value[id];
    if (edges?.right.kind === "joined") return "start";
    if (edges?.left.kind === "joined") return "end";
    return undefined;
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
            :lifted="liftedItem"
            :floats="floats"
            :maximized="maximizedLeaf"
            :sash-kind="sashKind"
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
                        :data-panel-role="roleOf(node.id) ?? undefined"
                        :data-panel-name="doc.panels[node.id]?.name"
                        :data-hover-actions-scope="roleOf(node.id) === null ? undefined : ''"
                        :data-hover-actions-active="actionsShownOn(node.id) ? '' : undefined"
                    >
                        <slot v-if="node.id === ACTIVITY_BAR" name="activitybar"></slot>
                        <div v-else-if="roleOf(node.id) === 'editor'" v-editor-head class="workbench-surface__editor-head" :data-surface-head="node.id">
                            <slot name="head" :panel-id="node.id" :id-prefix="idPrefix"></slot>
                        </div>
                        <slot v-else-if="roleOf(node.id) === 'tool'" name="head" :panel-id="node.id" :id-prefix="idPrefix"></slot>
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

/* 卡片主题里主体的接缝透明，卡片之间的缝就是边界；工具面板之间、编辑组之间的线还要看得见。 */
.workbench-surface :deep(.nb-grid-sash[data-sash-kind="panes"]) {
    --nb-splitter-seam: var(--shell-pane-divider, var(--divider));
    --nb-splitter-seam-inset: var(--shell-pane-divider-inset, 0px);
    --sash-line-inset: var(--shell-pane-divider-inset, 0px);
}

/* 编辑组之间的线贯通整个高度。 */
.workbench-surface :deep(.nb-grid-sash[data-sash-kind="editors"]) {
    --nb-splitter-seam: var(--shell-pane-divider, var(--divider));
    --nb-splitter-seam-inset: 0px;
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
}

.workbench-surface__card[data-panel-role] {
    background: var(--panel-surface);
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
.workbench-surface__card[data-shell-join="start"]::after {
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
 * 侧栏与右栏下角的场景图（docs/specs/theme/skins.md 输出 6）：只有这两块具名面板，跟着面板走，不跟着视图走。图在外框里，内容层盖在上面；
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
