<script setup lang="ts">
/**
 * 一棵树的工作台表面（同名 .md）：把布局文档画成一个 NestedGrid，外框里是卡片与面板头，内容在内容层。文档与投影由宿主给，这里只测量、发布呈现事实、按邻接算卡片。
 */
import {createGrid} from "@notnotype/nb-layout";
import type {Grid, GridBranchInput, GridExtent, GridGesturePreview, GridNodeInput, LayoutDoc, LayoutProjection} from "@notnotype/nb-layout";
import {moveGridFocus, NestedGrid, useGridLayout, useLayoutExtent} from "@notnotype/nb-layout/vue";
import {computed, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch} from "vue";

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
}>(), {maximized: null, disabled: false});

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
    /** 焦点现在在哪块面板；离开所有面板时是 null。活动栏条目据此决定点了做什么（输出 22）。 */
    (event: "focus-panel", panel: string | null): void;
}>();

defineSlots<{
    activitybar?(): unknown;
    statusbar?(): unknown;
    /** 工具面板的头。`idPrefix` 交给 `WorkbenchPanelHead`，标签和内容才对得上。 */
    head?(props: {panelId: string; idPrefix: string}): unknown;
    content?(props: {contentKey: string; panelId: string; active: boolean}): unknown;
}>();

const rootEl = ref<HTMLElement | null>(null);
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

const contents = computed(() => layoutContents(props.doc));
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

function onFocusIn(event: FocusEvent): void {
    const panel = panelOf(event.target);
    setFocusedPanel(panel !== null && props.doc.panels[panel] !== undefined ? panel : null);
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
        @focusin="onFocusIn"
        @focusout="onFocusOut"
    >
        <NestedGrid
            :node="host.node.value"
            :layout="host.layout.value"
            :disabled="disabled || extent === null"
            :context-key="contextKey"
            :revision="host.revision.value"
            :on-gesture-commit="host.onGestureCommit"
            :contents="contents"
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
                        :data-surface-card="node.id"
                        :data-surface-join="joinOf(node.id)"
                        :data-panel-role="roleOf(node.id) ?? undefined"
                        :data-panel-name="doc.panels[node.id]?.name"
                        :data-hover-actions-scope="roleOf(node.id) === 'tool' ? '' : undefined"
                        :data-hover-actions-active="actionsShownOn(node.id) ? '' : undefined"
                    >
                        <slot v-if="node.id === ACTIVITY_BAR" name="activitybar"></slot>
                        <slot v-else-if="roleOf(node.id) === 'tool'" name="head" :panel-id="node.id" :id-prefix="idPrefix"></slot>
                    </div>
                </div>
            </template>
            <template #content="{contentKey, leaf, active}">
                <div class="workbench-surface__content" :style="insetOf(leaf)">
                    <div
                        :id="roleOf(leaf) === 'tool' ? panelTabpanelDomId(idPrefix, contentKey) : undefined"
                        class="workbench-surface__content-clip"
                        :role="roleOf(leaf) === 'tool' ? 'tabpanel' : undefined"
                        :aria-labelledby="roleOf(leaf) === 'tool' ? panelTabDomId(idPrefix, contentKey) : undefined"
                        :data-panel-role="roleOf(leaf) ?? undefined"
                        :data-surface-join="joinOf(leaf)"
                    >
                        <slot name="content" :content-key="contentKey" :panel-id="leaf" :active="active"></slot>
                    </div>
                </div>
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

.workbench-surface__card[data-surface-join="start"] {
    border-start-end-radius: 0;
    border-end-end-radius: 0;
}

.workbench-surface__card[data-surface-join="end"] {
    border-start-start-radius: 0;
    border-end-start-radius: 0;
}

/* 相连的活动栏与面板之间一条两端不碰顶底的短线；不需要时主题把颜色设成透明。 */
.workbench-surface__card[data-surface-join="start"]::after {
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

/* 工具面板的内容在头下面，只有下面两个角是卡片的角；编辑组没有头，四个角都是。 */
.workbench-surface__content-clip {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    border-end-start-radius: var(--shell-card-radius, 0px);
    border-end-end-radius: var(--shell-card-radius, 0px);
}

.workbench-surface__content-clip[data-panel-role="editor"] {
    border-start-start-radius: var(--shell-card-radius, 0px);
    border-start-end-radius: var(--shell-card-radius, 0px);
}

.workbench-surface__content-clip[data-surface-join="end"] {
    border-end-start-radius: 0;
}
</style>
