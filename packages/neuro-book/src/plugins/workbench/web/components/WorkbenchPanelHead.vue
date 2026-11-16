<script setup lang="ts">
/** 工具面板的面板头（同名 .md）：标签带或当前视图的标题、当前视图的动作、框架按钮。点了只发事件，切换与命令由宿主做。 */
import {TabStrip, useLayoutExtent} from "@notnotype/nb-layout/vue";
import {IconButton} from "@notnotype/nb-ui/components";
import {computed, onBeforeUnmount, ref, watch} from "vue";

import type {PanelHeadSlots} from "../views/view-head";
import {panelTabDomId, panelTabpanelDomId, panelTitleDomId} from "../state/layout-present";
import "./hover-actions.css";

export interface PanelHeadTab {
    /** 标签键；事件原样带回。 */
    readonly id: string;
    readonly label: string;
    readonly icon: string;
}

/** 活动视图接管了标题区（docs/specs/workbench/views.md 输出 19）。 */
export interface PanelViewHead {
    /** 视图实例的身份（视图 id 加代际）：换了就重建几个位置，新实例从头拿到它们。 */
    readonly key: string;
    /** 标题按钮弹出的东西开着没有；null 是不弹出东西。 */
    readonly popup: {readonly expanded: boolean} | null;
}

export interface PanelFrameAction {
    readonly id: string;
    readonly label: string;
    readonly icon: string;
    readonly disabled: boolean;
    readonly reason?: string;
    readonly pressed?: boolean;
}

defineOptions({name: "WorkbenchPanelHead"});

const props = withDefaults(defineProps<{
    /** 正被实时布局拖着、还在标签条里的标签：留着盒子、看不见。 */
    draggingTab?: string | null;
    panelId: string;
    /** 标签带的可访问名称；没有标签时显示它。 */
    label: string;
    tabs: ReadonlyArray<PanelHeadTab>;
    active: string | null;
    moreLabel: string;
    /** 标签与内容互相引用的 DOM id 前缀（表面给）。 */
    idPrefix?: string;
    /** 标签的可访问描述：怎么拿起拖动。 */
    dragHint?: string;
    /** 不画标签带，只写活动标签的标题（侧栏这一列，切视图靠活动栏）。 */
    titleOnly?: boolean;
    frameActions?: ReadonlyArray<PanelFrameAction>;
    /** 只写标题时活动视图接管了标题区：整行改成三列，左、中、右的位置交给视图（`head-slots`）。 */
    viewHead?: PanelViewHead | null;
}>(), {draggingTab: null, idPrefix: "workbench-panel", dragHint: "", titleOnly: false, frameActions: () => [], viewHead: null});

const emit = defineEmits<{
    (event: "activate", id: string): void;
    /** Alt 加方向键换序（docs/specs/ui/workbench-layout.md 输出 20）。 */
    (event: "reorder", id: string, delta: -1 | 1): void;
    (event: "action", id: string): void;
    /** 标签的右键菜单（键盘是菜单键）；坐标是视口坐标。 */
    (event: "context-menu", id: string, at: {readonly x: number; readonly y: number}): void;
    /** 接管标题区时几个位置画出来了（换了）或拆掉了（null）。 */
    (event: "head-slots", slots: PanelHeadSlots | null): void;
}>();

defineSlots<{
    /** 当前视图的动作。 */
    actions?(): unknown;
}>();

const TAB_MAX_WIDTH = 96;

const items = computed(() => props.tabs.map((tab) => ({id: tab.id, title: tab.label, iconClass: tab.icon})));

const activeTab = computed(() => (props.titleOnly ? (props.tabs.find((tab) => tab.id === props.active) ?? null) : null));
const viewHeadShown = computed(() => activeTab.value !== null && props.viewHead !== null);

/**
 * 交给视图的几个位置。模板引用在渲染之后才换好，所以在 post 时机读：换代时（`viewHead.key` 变了）旧元素拆掉、新元素挂上，
 * 这里只看到最后的结果，不会先交一次 null。视图拿到后在同一轮刷新里把内容送进来，中间不会画出空的标题。
 */
const headStart = ref<HTMLElement | null>(null);
const headTitle = ref<HTMLElement | null>(null);
const headEnd = ref<HTMLElement | null>(null);
const headHandle = ref<HTMLElement | null>(null);
let slotsGiven = false;
watch([headStart, headTitle, headEnd, headHandle], ([start, title, end, handle]) => {
    const slots = start !== null && title !== null && end !== null && handle !== null ? {start, title, end, handle} : null;
    if (slots === null && !slotsGiven) return;
    slotsGiven = slots !== null;
    emit("head-slots", slots);
}, {flush: "post"});
onBeforeUnmount(() => {
    if (slotsGiven) emit("head-slots", null);
});

/**
 * 标题按整行居中：两侧的列都至少与较宽的一侧一样宽。只靠 `1fr auto 1fr`，右边有框架按钮、比左边宽，又放不下时，标题会偏向左边。
 * 量的是两侧内容自己的宽度（两格都不拉伸），不是列宽，所以不会自己把自己撑大。
 */
const endColumn = ref<HTMLElement | null>(null);
const startExtent = useLayoutExtent(computed(() => (viewHeadShown.value ? headStart.value : null)));
const endExtent = useLayoutExtent(computed(() => (viewHeadShown.value ? endColumn.value : null)));
const sideWidth = computed(() => Math.ceil(Math.max(startExtent.value?.width ?? 0, endExtent.value?.width ?? 0)));

/** 只写标题时的右键：菜单键打出来的 `contextmenu` 没有可靠的指针坐标，菜单开在标题下面。标签带的右键在 `TabStrip` 里。 */
function onTitleContextMenu(event: MouseEvent, id: string): void {
    event.preventDefault();
    if (event.button === 0 && event.clientX === 0 && event.clientY === 0) {
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        emit("context-menu", id, {x: rect.left, y: rect.bottom});
        return;
    }
    emit("context-menu", id, {x: event.clientX, y: event.clientY});
}
</script>

<template>
    <header class="workbench-panel-head" :class="{'workbench-panel-head--view': viewHeadShown}" :style="viewHeadShown ? {'--view-head-side': `${sideWidth}px`} : undefined" :data-panel-head="panelId">
        <!-- 只写标题时内容 region 的名称指向它（docs/specs/ui/workbench-layout.md 输出 20），不指向标题按钮：视图接管标题区时按钮写的是视图的内容。 -->
        <span v-if="activeTab !== null" :id="panelTitleDomId(idPrefix, activeTab.id)" hidden>{{ activeTab.label }}</span>
        <template v-if="viewHeadShown">
            <div :key="`start:${viewHead!.key}`" ref="headStart" class="workbench-panel-head__view-start" data-no-drag data-panel-head-start></div>
            <h2 class="workbench-panel-head__view-title">
                <!-- 按钮是工作台的：拖动、空格拿起与右键菜单不经过视图。视图只往里面那格送文字与图标。 -->
                <button
                    :id="panelTabDomId(idPrefix, activeTab!.id)"
                    ref="headHandle"
                    type="button"
                    class="workbench-panel-head__view-handle nb-ui-focus-ring-inset"
                    tabindex="0"
                    :data-panel-tab="activeTab!.id"
                    :aria-description="dragHint === '' ? undefined : dragHint"
                    :aria-haspopup="viewHead!.popup === null ? undefined : 'dialog'"
                    :aria-expanded="viewHead!.popup === null ? undefined : viewHead!.popup.expanded"
                    @click="emit('activate', activeTab!.id)"
                    @contextmenu="onTitleContextMenu($event, activeTab!.id)"
                >
                    <span :key="`title:${viewHead!.key}`" ref="headTitle" class="workbench-panel-head__view-label" data-panel-head-title></span>
                </button>
            </h2>
        </template>
        <div v-else class="workbench-panel-head__band" :data-panel-band="panelId" :data-panel-strip="panelId">
            <!-- 头只写标题时它就是拖动源（docs/specs/ui/workbench-layout.md 输出 20），怎么拖写在描述里。
                 焦点光晕画在里面：标题要省略号，外面一层是 `overflow: hidden`，画在外面会被裁掉（和标签一样用内描）。 -->
            <h2 v-if="activeTab !== null" class="workbench-panel-head__title">
                <button
                    :id="panelTabDomId(idPrefix, activeTab.id)"
                    type="button"
                    class="workbench-panel-head__handle nb-ui-focus-ring-inset"
                    tabindex="0"
                    :data-panel-tab="activeTab.id"
                    :aria-description="dragHint === '' ? undefined : dragHint"
                    @click="emit('activate', activeTab!.id)"
                    @contextmenu="onTitleContextMenu($event, activeTab!.id)"
                >{{ activeTab.label }}</button>
            </h2>
            <TabStrip
                v-else-if="items.length > 0"
                class="workbench-panel-head__tabs"
                overflow="adapt"
                :max-item-width="TAB_MAX_WIDTH"
                :more-label="moreLabel"
                more-icon-class="i-lucide-chevron-down"
                :items="items"
                :active="active"
                :label="label"
                :drag-hint="dragHint"
                :placeholder="draggingTab"
                :animate-moves="draggingTab !== null"
                :tab-id-of="(id: string) => panelTabDomId(idPrefix, id)"
                :panel-id-of="(id: string) => panelTabpanelDomId(idPrefix, id)"
                @activate="(id: string) => emit('activate', id)"
                @reorder="(id: string, delta: -1 | 1) => emit('reorder', id, delta)"
                @context-menu="(id: string, at: {x: number; y: number}) => emit('context-menu', id, at)"
            />
            <h2 v-else class="workbench-panel-head__title">{{ label }}</h2>
        </div>
        <div ref="endColumn" class="workbench-panel-head__end">
            <div v-if="viewHeadShown" :key="`end:${viewHead!.key}`" ref="headEnd" class="workbench-panel-head__view-end" data-no-drag data-panel-head-end></div>
            <div v-if="$slots.actions !== undefined" class="workbench-panel-head__actions" data-no-drag data-hover-actions>
                <slot name="actions"></slot>
            </div>
            <div v-if="frameActions.length > 0" class="workbench-panel-head__actions" data-no-drag>
                <IconButton
                    v-for="action in frameActions"
                    :key="action.id"
                    size="xs"
                    :icon-class="action.icon"
                    :aria-label="action.label"
                    :title="action.disabled && action.reason !== undefined ? action.reason : action.label"
                    :disabled="action.disabled"
                    :aria-pressed="action.pressed"
                    :data-panel-action="action.id"
                    @click="emit('action', action.id)"
                />
            </div>
        </div>
    </header>
</template>

<style scoped>
.workbench-panel-head {
    display: flex;
    flex: 0 0 32px;
    align-items: center;
    gap: var(--space-1);
    height: 32px;
    min-width: 0;
    /* 右端是 24px 的图标按钮：右边留 4px，外扩焦点光环（实色 3.5px）不被面板的裁切切掉。 */
    padding-inline: var(--space-1) var(--space-2);
    user-select: none;
}

.workbench-panel-head__band {
    display: flex;
    flex: 1 1 auto;
    align-self: stretch;
    align-items: center;
    min-width: 0;
}

.workbench-panel-head__tabs {
    flex: 1 1 auto;
    min-width: 0;
}

/* 标签的外观：下划线指示，`TabStrip` 只管结构（钩子见它的 .md）。 */
.workbench-panel-head__tabs :deep(.nb-tab-strip__list) {
    column-gap: var(--space-2);
}

.workbench-panel-head__tabs :deep(.nb-tab-strip__row) {
    column-gap: inherit;
}

.workbench-panel-head__tabs :deep(.nb-tab) {
    position: relative;
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    gap: var(--space-2);
    height: var(--control-h-sm);
    padding-inline: calc(var(--control-px) * 0.8);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    white-space: nowrap;
    transition: color var(--motion-fast) var(--ease-layout);
}

.workbench-panel-head__tabs :deep(.nb-tab:hover) {
    color: var(--text-main);
}

.workbench-panel-head__tabs :deep([role="tab"].nb-tab)::after {
    position: absolute;
    bottom: 0;
    height: 2px;
    background: transparent;
    content: "";
    inset-inline: 0;
    transition: background-color var(--motion-fast) var(--ease-layout);
}

.workbench-panel-head__tabs :deep(.is-active .nb-tab) {
    color: var(--text-main);
}

.workbench-panel-head__tabs :deep(.is-active [role="tab"].nb-tab)::after {
    background: var(--accent-main);
}

.workbench-panel-head__tabs :deep(.nb-tab__icon) {
    flex-shrink: 0;
    width: 1.15em;
    height: 1.15em;
}

.workbench-panel-head__tabs :deep(.nb-tab__title) {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
}

.workbench-panel-head__tabs :deep(.nb-tab__chevron) {
    flex-shrink: 0;
    width: 1em;
    height: 1em;
}

.workbench-panel-head__title {
    flex: 1 1 auto;
    min-width: 0;
    margin: 0;
    padding-inline-start: var(--space-2);
    overflow: hidden;
    color: var(--text-secondary);
    font-size: var(--text-xs);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* 标签与标题是拖动源：触摸按住起拖，不滚动。 */
.workbench-panel-head__tabs :deep([data-panel-tab]) {
    touch-action: none;
}

.workbench-panel-head__handle {
    display: block;
    max-width: 100%;
    overflow: hidden;
    color: inherit;
    font: inherit;
    text-overflow: ellipsis;
    white-space: nowrap;
    touch-action: none;
}

.workbench-panel-head__actions {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: var(--space-1);
}

.workbench-panel-head__end {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: var(--space-1);
}

/*
 * 视图接管标题区（docs/specs/workbench/views.md 输出 19）：三列，两侧至少放得下自己的内容、平分剩下的宽度，所以标题按整行居中；
 * 两侧放不下时标题让位（截断），两侧不让。框架按钮在右列，两边的留白因此对称。
 */
.workbench-panel-head--view {
    display: grid;
    grid-template-columns: minmax(var(--view-head-side, 0px), 1fr) minmax(0, auto) minmax(var(--view-head-side, 0px), 1fr);
    /* 两边一样宽，标题才在正中；右边的 4px 仍够框架按钮的外扩焦点环。 */
    padding-inline: var(--space-2);
}

.workbench-panel-head__view-start,
.workbench-panel-head__view-end {
    display: flex;
    align-items: center;
    gap: var(--space-1);
}

.workbench-panel-head__view-start {
    justify-self: start;
}

/* 右列里没有内容时不占一格间距；左列始终在（它是网格的第一列）。 */
.workbench-panel-head__view-end:empty {
    display: none;
}

.workbench-panel-head--view .workbench-panel-head__end {
    justify-self: end;
}

.workbench-panel-head__view-title {
    min-width: 0;
    margin: 0;
    font: inherit;
}

.workbench-panel-head__view-handle {
    display: flex;
    align-items: center;
    max-width: 100%;
    height: var(--control-h-sm);
    padding-inline: var(--space-2);
    border-radius: var(--radius-control);
    color: var(--text-main);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    touch-action: none;
    transition: background-color var(--motion-fast) var(--ease-layout);
}

.workbench-panel-head__view-handle:hover,
.workbench-panel-head__view-handle[aria-expanded="true"] {
    background: var(--bg-hover);
}

.workbench-panel-head__view-label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
}
</style>
