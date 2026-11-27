<script setup lang="ts">
/** 工具面板的面板头（同名 .md）：标签带或当前视图的标题、当前视图的动作、框架按钮。点了只发事件，切换与命令由宿主做。 */
import {useLayoutExtent} from "@notnotype/nb-layout/vue";
import {TabStrip} from "@notnotype/nb-workbench-layout/vue";
import {IconButton} from "@notnotype/nb-ui/components";
import {computed, onBeforeUnmount, ref, watch} from "vue";

import type {PanelHeadSlots} from "../views/view-head";
import {nbTarget} from "@notnotype/nb-page-agent/attrs";
import {panelTabDomId, panelTabpanelDomId, panelTitleDomId, viewIdOf} from "../state/layout-present";
import "./hover-actions.css";
import "./panel-metrics.css";

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
    /**
     * 标题写在入口上（底部面板并成一行时，docs/specs/ui/workbench-layout.md 输出 47）：头不画看得见的标题，只有视图动作与框架按钮；
     * 内容区名称指向的隐藏标题照旧在，标题按钮（`data-panel-tab`）不在，拖动、右键与焦点落到标题都由宿主交给那个入口。
     */
    titleInEntry?: boolean;
    frameActions?: ReadonlyArray<PanelFrameAction>;
    /** 只写标题时活动视图接管了标题区：整行改成三列，左、中、右的位置交给视图（`head-slots`）。 */
    viewHead?: PanelViewHead | null;
    /**
     * 这块面板在这里能收成标题行（docs/specs/ui/workbench-layout.md 输出 20）：标题前画展开标记，标题按钮带 `aria-expanded`，点它由宿主切换。
     * 不给就不画标记（底部面板的分节、区域唯一的分节、浮动窗、最大化着的面板）。
     */
    fold?: {readonly collapsed: boolean} | null;
    /** 接管标题区时单独的展开标记的可访问名称（`fold` 给了才用）。 */
    foldLabel?: string;
    /**
     * 视图自绘整个头（docs/specs/workbench/views.md 输出 19 的“自绘头”，只写标题时才起作用）：头不占一行，画成盖在内容顶上、高 `band` 的一条，
     * 本身不接指针；视图动作与框架按钮在右端，标题按钮在左上角、键盘聚焦时才看得见。宿主把它放在这块窗的内容里、视图之前。
     */
    ownHead?: {readonly band: number} | null;
    /** 自绘头时视图动作与框架按钮该不该显示：指针或焦点在这块窗的内容上（宿主算，同卡片的 `data-hover-actions-active`）。 */
    actionsShown?: boolean;
}>(), {draggingTab: null, idPrefix: "workbench-panel", dragHint: "", titleOnly: false, titleInEntry: false, frameActions: () => [], viewHead: null, fold: null, foldLabel: "", ownHead: null, actionsShown: false});

const emit = defineEmits<{
    (event: "activate", id: string): void;
    /** Alt 加方向键换序（docs/specs/ui/workbench-layout.md 输出 20）。 */
    (event: "reorder", id: string, delta: -1 | 1): void;
    (event: "action", id: string): void;
    /** 标签的右键菜单（键盘是菜单键）；坐标是视口坐标。 */
    (event: "context-menu", id: string, at: {readonly x: number; readonly y: number}): void;
    /** 接管标题区时几个位置画出来了（换了）或拆掉了（null）。 */
    (event: "head-slots", slots: PanelHeadSlots | null): void;
    /** 接管标题区时点了单独的展开标记：宿主切换收起（标题按钮这时是视图的）。 */
    (event: "toggle-fold"): void;
    /** 自绘头时右端按钮一组连同到窗口右缘的留白占多宽（CSS px）：宿主写给视图，视图在它的头右端让出来。 */
    (event: "own-head-inset", width: number): void;
}>();

/** 视图标题的稳定名（docs/specs/agent/page-agent.md 输出 6）：视图的标签才有，编辑器页这类标签没有。 */
const viewTarget = (tabId: string) => {
    const viewId = viewIdOf(tabId);
    return viewId === null ? {} : nbTarget("workbench.view", viewId);
};

defineSlots<{
    /** 当前视图的动作。 */
    actions?(): unknown;
}>();

const TAB_MAX_WIDTH = 96;

// 几个视图叠成标签时，标签就是视图的标题：同样写稳定名（输出 6）。
const items = computed(() => props.tabs.map((tab) => ({id: tab.id, title: tab.label, iconClass: tab.icon, attrs: viewTarget(tab.id)})));

const activeTab = computed(() => (props.titleOnly ? (props.tabs.find((tab) => tab.id === props.active) ?? null) : null));
/** 自绘头优先于接管标题区：宿主不会同时给两样，这里也只认一样。 */
const ownHeadShown = computed(() => activeTab.value !== null && props.ownHead !== null);
const viewHeadShown = computed(() => activeTab.value !== null && props.viewHead !== null && !ownHeadShown.value);

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
const startColumn = ref<HTMLElement | null>(null);
const startExtent = useLayoutExtent(computed(() => (viewHeadShown.value ? startColumn.value : null)));
const endExtent = useLayoutExtent(computed(() => (viewHeadShown.value ? endColumn.value : null)));
const sideWidth = computed(() => Math.ceil(Math.max(startExtent.value?.width ?? 0, endExtent.value?.width ?? 0)));

/**
 * 自绘头右端让出的宽度：按钮一组的宽，加上它到窗口右缘的内边距与它和视图的“⋯”之间的间距（两个数与下面 `--own` 的样式同值）。
 * 动作透明时也占位，所以只在动作增减时变，缩放窗口不变。
 */
/** 12：画在窗右边缘的视图段收着时是 48 宽的一列（`SHELL_RAIL_WIDTH`），24 宽的“回到停靠”离右缘 12 正好在那一列的中线上，和下面的按钮对齐（输出 51 的“顶格”）。 */
const OWN_HEAD_END_PADDING = 12;
const OWN_HEAD_END_GAP = 4;
const ownEndExtent = useLayoutExtent(computed(() => (ownHeadShown.value ? endColumn.value : null)));
watch(() => (ownEndExtent.value === null ? null : Math.ceil(ownEndExtent.value.width)), (width) => {
    if (width !== null) emit("own-head-inset", width === 0 ? 0 : width + OWN_HEAD_END_PADDING + OWN_HEAD_END_GAP);
}, {immediate: true});

/**
 * 点标题：先把焦点放到按钮上再交给宿主。有的浏览器（Safari、macOS 上的 Firefox）点按钮不聚焦，宿主切换收起之后焦点要在标题上，
 * 当前面板与快捷键才落在这块面板（输出 20）。
 */
function onTitleClick(event: MouseEvent, id: string): void {
    (event.currentTarget as HTMLElement).focus({preventScroll: true});
    emit("activate", id);
}

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
    <!-- 收着时悬停范围就是这一行（它下面可能是垫底拉长的空卡片，指针停在那里不显示按钮）；展开着时范围是整张卡片，由表面写。 -->
    <!-- 自绘头时这一条本身就是悬停范围：它不在卡片里，指针在内容上时由宿主给 `actionsShown`。 -->
    <header
        class="workbench-panel-head"
        :class="{'workbench-panel-head--view': viewHeadShown, 'workbench-panel-head--own': ownHeadShown}"
        :style="viewHeadShown ? {'--view-head-side': `${sideWidth}px`} : ownHeadShown ? {'--own-head-band': `${ownHead!.band}px`} : undefined"
        :data-panel-head="panelId"
        :data-own-head="ownHeadShown ? '' : undefined"
        :data-collapsed="fold?.collapsed === true ? '' : undefined"
        :data-hover-actions-scope="fold?.collapsed === true || ownHeadShown ? '' : undefined"
        :data-hover-actions-active="ownHeadShown && actionsShown ? '' : undefined"
    >
        <!-- 只写标题时内容 region 的名称指向它（docs/specs/ui/workbench-layout.md 输出 20），不指向标题按钮：视图接管标题区时按钮写的是视图的内容。 -->
        <span v-if="activeTab !== null" :id="panelTitleDomId(idPrefix, activeTab.id)" hidden>{{ activeTab.label }}</span>
        <!-- 自绘头的标题按钮：拖动源、F6 与“焦点落到标题”的落点都还是它，平时透明、不接指针，键盘聚焦（`:focus-visible`）时显示在左上角：
             点了“浮动”、关了“移动到”后焦点由程序还到它上面时不冒出来压住视图的头。不用 display:none，否则落不上焦点。 -->
        <h2 v-if="ownHeadShown" class="workbench-panel-head__own-title">
            <button
                :id="panelTabDomId(idPrefix, activeTab!.id)"
                type="button"
                class="workbench-panel-head__own-handle nb-ui-focus-ring-inset"
                tabindex="0"
                :data-panel-tab="activeTab!.id"
                v-bind="viewTarget(activeTab!.id)"
                :aria-description="dragHint === '' ? undefined : dragHint"
                @click="onTitleClick($event, activeTab!.id)"
                @contextmenu="onTitleContextMenu($event, activeTab!.id)"
            >
                {{ activeTab!.label }}
            </button>
        </h2>
        <template v-else-if="viewHeadShown">
            <div ref="startColumn" class="workbench-panel-head__view-side">
                <!-- 接管时标题按钮是视图的（弹会话列表），展开标记单独一个按钮，算进两侧等宽，标题照旧居中。 -->
                <button
                    v-if="fold !== null"
                    type="button"
                    class="workbench-panel-head__fold nb-ui-focus-ring-inset"
                    :aria-label="foldLabel"
                    :aria-expanded="!fold.collapsed"
                    :aria-controls="panelTabpanelDomId(idPrefix, activeTab!.id)"
                    data-no-drag
                    data-panel-fold
                    @click="emit('toggle-fold')"
                >
                    <span class="workbench-panel-head__chevron i-lucide-chevron-right" aria-hidden="true"></span>
                </button>
                <div :key="`start:${viewHead!.key}`" ref="headStart" class="workbench-panel-head__view-start" data-no-drag data-panel-head-start></div>
            </div>
            <h2 class="workbench-panel-head__view-title">
                <!-- 按钮是工作台的：拖动、空格拿起与右键菜单不经过视图。视图只往里面那格送文字与图标。 -->
                <button
                    :id="panelTabDomId(idPrefix, activeTab!.id)"
                    ref="headHandle"
                    type="button"
                    class="workbench-panel-head__view-handle nb-ui-focus-ring-inset"
                    tabindex="0"
                    :data-panel-tab="activeTab!.id"
                    v-bind="viewTarget(activeTab!.id)"
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
            <h2 v-if="activeTab !== null && !titleInEntry" class="workbench-panel-head__title">
                <button
                    :id="panelTabDomId(idPrefix, activeTab.id)"
                    type="button"
                    class="workbench-panel-head__handle nb-ui-focus-ring-inset"
                    tabindex="0"
                    :data-panel-tab="activeTab.id"
                    v-bind="viewTarget(activeTab.id)"
                    :aria-description="dragHint === '' ? undefined : dragHint"
                    :aria-expanded="fold === null ? undefined : !fold.collapsed"
                    :aria-controls="fold === null ? undefined : panelTabpanelDomId(idPrefix, activeTab.id)"
                    @click="onTitleClick($event, activeTab!.id)"
                    @contextmenu="onTitleContextMenu($event, activeTab!.id)"
                >
                    <!-- 整行是开关：按钮铺满标题这一格，标记在按钮里（点它和点标题一样）。 -->
                    <span v-if="fold !== null" class="workbench-panel-head__chevron i-lucide-chevron-right" aria-hidden="true" data-panel-fold></span>
                    <span class="workbench-panel-head__label">{{ activeTab.label }}</span>
                </button>
            </h2>
            <TabStrip
                v-else-if="!titleInEntry && items.length > 0"
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
            <h2 v-else-if="!titleInEntry" class="workbench-panel-head__title">{{ label }}</h2>
        </div>
        <div ref="endColumn" class="workbench-panel-head__end">
            <div v-if="viewHeadShown" :key="`end:${viewHead!.key}`" ref="headEnd" class="workbench-panel-head__view-end" data-no-drag data-panel-head-end></div>
            <div v-if="$slots.actions !== undefined" class="workbench-panel-head__actions" data-no-drag data-hover-actions>
                <slot name="actions"></slot>
            </div>
            <!-- 框架按钮和视图动作同一个显示范围（悬停才出）；按下的（最大化着时的还原）一直显示，豁免只给这个容器（hover-actions.css）。 -->
            <div v-if="frameActions.length > 0" class="workbench-panel-head__actions" data-no-drag data-hover-actions="frame">
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

.workbench-panel-head__tabs :deep(.nb-tab:hover),
.workbench-panel-head__tabs :deep(.nb-tab-frame--placeholder .nb-tab) {
    color: var(--text-main);
}

/* 在条里排序、跟着指针的那个标签（`TabStrip` 的 `placeholder`）：盖在邻居上，底色同卡片，邻居的字不透上来。 */
.workbench-panel-head__tabs :deep(.nb-tab-frame--placeholder) {
    background: var(--panel-surface);
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
    /* 撑满头的高度，好让能收起的标题按钮整行可点；里面照旧竖直居中（只写名称的文字、没有标记的按钮都不被拉高）。 */
    display: flex;
    flex: 1 1 auto;
    align-self: stretch;
    align-items: center;
    min-width: 0;
    margin: 0;
    padding-inline-start: var(--space-2);
    overflow: hidden;
    color: var(--text-main);
    font-size: var(--text-xs);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* 收成标题行时标题退一档（输出 20）。 */
.workbench-panel-head[data-collapsed] .workbench-panel-head__title,
.workbench-panel-head[data-collapsed] .workbench-panel-head__view-handle {
    color: var(--text-secondary);
}

/*
 * 展开标记：和资源管理器树的展开箭头同一种画法（向右的 chevron，展开时转 90 度，同一档尺寸与时长），这样标记与树的箭头对得齐、动得一样。
 */
.workbench-panel-head__chevron {
    flex: 0 0 auto;
    width: 14px;
    height: 14px;
    color: var(--text-secondary);
    transition: transform var(--motion-move) var(--ease-layout);
}

[aria-expanded="true"] > .workbench-panel-head__chevron {
    transform: rotate(90deg);
}

/*
 * 对齐（开发者 2026-11-17：“看看对齐了没”）：标记与资源管理器树第一层的展开箭头在一条竖线上（`--workbench-fold-inset`，panel-metrics.css），
 * 标题与树第一层的文字在一条竖线上：文字在箭头的 16px 框后 4px，离卡片 34px。头的左内边距加标题格的内边距之后，标记再往里补到那条线，
 * 14px 的标记后隔 5px 是标题。
 */
.workbench-panel-head__handle > .workbench-panel-head__chevron {
    margin-inline-start: calc(var(--workbench-fold-inset) - var(--space-1) - var(--space-2));
}

.workbench-panel-head__handle:has(> .workbench-panel-head__chevron) {
    /* 能收起时整行是开关（输出 20）：铺满标题这一格，上下也到头的边。别的头按钮只有标题那么大，空白处不起拖（输出 24）。 */
    flex: 1 1 auto;
    align-self: stretch;
    gap: 5px;
}

/* 标签与标题是拖动源：触摸按住起拖，不滚动。 */
.workbench-panel-head__tabs :deep([data-panel-tab]) {
    touch-action: none;
}

.workbench-panel-head__handle {
    display: flex;
    flex: 0 1 auto;
    align-items: center;
    gap: 6px;
    min-width: 0;
    overflow: hidden;
    color: inherit;
    font: inherit;
    white-space: nowrap;
    touch-action: none;
}

.workbench-panel-head__label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
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

.workbench-panel-head__view-side {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    justify-self: start;
}

/* 接管标题区时单独的展开标记。 */
.workbench-panel-head__fold {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: var(--radius-button-sm, var(--radius-control));
}

.workbench-panel-head__fold:hover {
    background: var(--bg-hover);
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

/*
 * 视图自绘头（docs/specs/workbench/views.md 输出 19 的“自绘头”）：盖在内容顶上的一条，本身不接指针，指针穿过它落到视图的头上（拖窗口、点视图的按钮）；
 * 只有工作台的按钮接指针。右端按钮竖直居中在这一条里；左右内边距与 `OWN_HEAD_END_PADDING` 同值。
 */
.workbench-panel-head--own {
    position: absolute;
    top: 0;
    right: 0;
    left: 0;
    flex: none;
    justify-content: flex-end;
    height: var(--own-head-band);
    padding-inline: var(--space-1) 12px;
    z-index: 10;
    pointer-events: none;
}

.workbench-panel-head--own .workbench-panel-head__end :is(button, [role="button"], a) {
    pointer-events: auto;
}

.workbench-panel-head__own-title {
    position: absolute;
    top: 4px;
    left: 4px;
    margin: 0;
    font: inherit;
}

.workbench-panel-head__own-handle {
    display: flex;
    align-items: center;
    height: var(--control-h-sm);
    padding-inline: var(--space-2);
    border-radius: var(--radius-control);
    background: var(--panel-surface);
    box-shadow: var(--elevation-raised);
    color: var(--text-main);
    font-size: var(--text-xs);
    font-weight: 600;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    touch-action: none;
    transition: opacity var(--motion-reveal-in, var(--motion-fast)) linear;
}

.workbench-panel-head__own-handle:focus-visible {
    opacity: 1;
    pointer-events: auto;
}
</style>
