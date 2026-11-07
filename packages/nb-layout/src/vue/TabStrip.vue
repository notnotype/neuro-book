<script setup lang="ts">
/**
 * 标签条（同名 .md）：工具面板与编辑组共用的语义、键盘、多行、分区与宽度适配。外观由宿主写，这里只有结构必需的样式。
 */
import {DropdownMenu, useTabsAdapt} from "@notnotype/nb-ui/components";
import {moveRoving, rovingMove} from "@notnotype/nb-ui/utils";
import {computed, nextTick, ref, watch} from "vue";

export interface TabStripItem {
    /** 写到 `data-panel-tab`，事件原样带回。 */
    readonly id: string;
    /** 缺省内容、“更多”菜单与只留图标时的可访问名称。 */
    readonly title: string;
    /** 属于哪个分区；缺省第一个。 */
    readonly partition?: string;
    readonly iconClass?: string;
    readonly tooltip?: string;
    /** 写到 `role="tab"` 的按钮上。 */
    readonly attrs?: Readonly<Record<string, string>>;
}

export interface TabStripPartition {
    readonly id: string;
    /** `scroll` 放不下时横向滚动；`wrap` 折行。 */
    readonly layout: "scroll" | "wrap";
}

defineOptions({name: "TabStrip"});

const props = withDefaults(defineProps<{
    items: ReadonlyArray<TabStripItem>;
    active: string | null;
    label: string;
    /** 分区，按给定顺序一行一个。缺省一个分区，放不下时按 `overflow`。 */
    partitions?: ReadonlyArray<TabStripPartition>;
    overflow?: "scroll" | "wrap" | "adapt";
    /** `adapt` 的截断宽度。 */
    maxItemWidth?: number;
    /** `adapt` 的“更多”文字，后面跟收起来的个数。 */
    moreLabel?: string;
    /** “更多”按钮的图标：图标类要在宿主的样式引擎里，所以由宿主给。 */
    moreIconClass?: string;
    /** 标签的可访问描述：怎么拿起拖动。 */
    dragHint?: string;
    /** 标签元素的 DOM id：内容用它写 `aria-labelledby`。 */
    tabIdOf?: (id: string) => string;
    /** 标签控制的内容的 DOM id，写到 `aria-controls`。 */
    panelIdOf?: (id: string) => string;
    /** 这个标签留着盒子、看不见：它正被拖着，跟手的是拖影，别的标签让出它的位置。 */
    placeholder?: string | null;
    /** 同一行里换位时滑过去（只在拖动中开：平时换序直接到位）。跨行不动画。 */
    animateMoves?: boolean;
}>(), {placeholder: null, animateMoves: false, partitions: undefined, overflow: "scroll", maxItemWidth: 96, moreLabel: "", moreIconClass: "", dragHint: "", tabIdOf: undefined, panelIdOf: undefined});

const emit = defineEmits<{
    (event: "activate", id: string): void;
    /** Alt+←/→：换一位。 */
    (event: "reorder", id: string, delta: -1 | 1): void;
    /** Delete、中键。 */
    (event: "close", id: string): void;
    /** 双击。 */
    (event: "keep", id: string): void;
    /** 右键、Shift+F10 或菜单键；坐标是视口坐标。 */
    (event: "context-menu", id: string, at: {readonly x: number; readonly y: number}): void;
}>();

defineSlots<{
    /** 标签按钮里的内容；缺省图标加标题。`adapt` 不用它：测量层要量同款盒子，见同名 .md。 */
    tab?(props: {item: TabStripItem; active: boolean}): unknown;
    /** 按钮之后的东西（关闭、图钉）：按钮不能嵌按钮。 */
    action?(props: {item: TabStripItem; active: boolean}): unknown;
}>();

const rootEl = ref<HTMLElement | null>(null);
const listEl = ref<HTMLElement | null>(null);
const measureEl = ref<HTMLElement | null>(null);

const adaptive = computed(() => props.overflow === "adapt");
const adapt = useTabsAdapt({
    enabled: () => adaptive.value,
    items: () => props.items.map((item) => ({value: item.id, hasIcon: item.iconClass !== undefined})),
    selected: () => props.active ?? "",
    maxItemWidth: () => props.maxItemWidth,
    remeasureOn: () => [props.items, props.maxItemWidth, props.moreLabel],
    root: rootEl,
    layer: measureEl,
    list: listEl,
});
const truncating = computed(() => adaptive.value && adapt.value.level >= 1);
const iconOnly = (item: TabStripItem): boolean => adaptive.value && adapt.value.level >= 2 && item.id !== props.active && item.iconClass !== undefined;
const moreItems = computed(() => (adaptive.value ? props.items.filter((item) => adapt.value.hidden.has(item.id)).map((item) => ({label: item.title, id: item.id, ...(item.iconClass === undefined ? {} : {iconClass: item.iconClass})})) : []));

const rows = computed(() => {
    if (props.partitions !== undefined && props.partitions.length > 0) {
        const first = props.partitions[0]?.id;
        return props.partitions.map((partition) => ({
            id: partition.id,
            partition: partition.id,
            layout: partition.layout,
            items: props.items.filter((item) => (item.partition ?? first) === partition.id),
        }));
    }
    const shown = adaptive.value ? props.items.filter((item) => !adapt.value.hidden.has(item.id)) : props.items;
    return [{id: "all", partition: undefined, layout: props.overflow === "wrap" ? ("wrap" as const) : ("scroll" as const), items: shown}];
});
const wraps = computed(() => rows.value.some((row) => row.layout === "wrap"));
/** 选中的标签是 Tab 停靠点；没有选中时是第一个，标签条仍能用键盘进入。 */
const tabStop = computed(() => props.active ?? props.items[0]?.id ?? null);

const tabElement = (id: string): HTMLElement | null => listEl.value?.querySelector<HTMLElement>(`[data-panel-tab="${CSS.escape(id)}"]`) ?? null;

/** 把活动标签滚到完整可见：横向滚它所在的那一行，纵向滚整个标签区。只动标签条自己的滚动。 */
function reveal(id: string): void {
    // 等下一帧再量：新标签刚插入、或刚换了单行与多行时宽度还没落定，太早量会差几像素。
    void nextTick(() => requestAnimationFrame(() => {
        const tab = tabElement(id)?.parentElement;
        const strip = listEl.value;
        if (tab === null || tab === undefined || strip === null) return;
        const row = tab.parentElement;
        const box = tab.getBoundingClientRect();
        if (row !== null && row.scrollWidth > row.clientWidth) {
            const view = row.getBoundingClientRect();
            // 滚动量向外取整：`scrollLeft` 会被截到整像素，差的零点几像素会让标签边缘仍被裁掉。
            if (box.left < view.left) row.scrollLeft -= Math.ceil(view.left - box.left);
            else if (box.right > view.right) row.scrollLeft += Math.ceil(box.right - view.right);
        }
        const view = strip.getBoundingClientRect();
        if (box.top < view.top) strip.scrollTop -= Math.ceil(view.top - box.top);
        else if (box.bottom > view.bottom) strip.scrollTop += Math.ceil(box.bottom - view.bottom);
    }));
}
watch(() => [props.active, wraps.value] as const, ([id]) => {
    if (id !== null) reveal(id);
}, {immediate: true});

function focusTab(id: string | undefined): void {
    if (id === undefined) return;
    emit("activate", id);
    void nextTick(() => tabElement(id)?.focus());
}

/** 多行时 ↑/↓：上一行或下一行里水平位置离它最近的标签（按此刻的几何算，换行位置随宽度变）。 */
function verticalNeighbor(id: string, direction: -1 | 1): string | undefined {
    const current = tabElement(id)?.getBoundingClientRect();
    if (current === undefined) return undefined;
    const center = current.left + current.width / 2;
    let best: {id: string; rowDistance: number; distance: number} | undefined;
    for (const item of props.items) {
        const box = tabElement(item.id)?.getBoundingClientRect();
        if (box === undefined) continue;
        const rowDistance = (box.top - current.top) * direction;
        // 只看那个方向上的行，取最近的一行里水平最近的。
        if (rowDistance < current.height / 2) continue;
        const distance = Math.abs(box.left + box.width / 2 - center);
        if (best === undefined || rowDistance < best.rowDistance - 1 || (Math.abs(rowDistance - best.rowDistance) <= 1 && distance < best.distance)) best = {id: item.id, rowDistance, distance};
    }
    return best?.id;
}

function onKeydown(event: KeyboardEvent): void {
    const tab = event.target instanceof Element ? event.target.closest<HTMLElement>("[role='tab'][data-panel-tab]") : null;
    const id = tab?.dataset.panelTab;
    if (tab === null || tab === undefined || id === undefined) return;
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        event.preventDefault();
        const box = tab.getBoundingClientRect();
        emit("context-menu", id, {x: box.left, y: box.bottom});
        return;
    }
    if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        emit("reorder", id, event.key === "ArrowLeft" ? -1 : 1);
        return;
    }
    if (event.key === "Delete") {
        event.preventDefault();
        emit("close", id);
        return;
    }
    if (wraps.value && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        focusTab(verticalNeighbor(id, event.key === "ArrowUp" ? -1 : 1));
        return;
    }
    const move = rovingMove(event.key, "horizontal");
    if (move === null) return;
    event.preventDefault();
    const next = moveRoving(props.items, props.items.findIndex((item) => item.id === id), move, () => false);
    focusTab(props.items[next]?.id);
}

/** 中键关闭：按下时阻止浏览器的自动滚动。 */
function onAuxClick(event: MouseEvent, id: string): void {
    if (event.button !== 1) return;
    event.preventDefault();
    emit("close", id);
}

/** 菜单键打出来的 `contextmenu` 没有可靠的指针坐标：菜单开在标签下面。 */
function onContextMenu(event: MouseEvent, id: string): void {
    event.preventDefault();
    if (event.button === 0 && event.clientX === 0 && event.clientY === 0) {
        const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
        emit("context-menu", id, {x: box.left, y: box.bottom});
        return;
    }
    emit("context-menu", id, {x: event.clientX, y: event.clientY});
}

defineExpose({focusTab: (id: string) => tabElement(id)?.focus()});
</script>

<template>
    <div ref="rootEl" class="nb-tab-strip" data-tab-strip :data-tabs-level="adaptive ? adapt.level : undefined">
        <div ref="listEl" role="tablist" :aria-label="label" class="nb-tab-strip__list" @keydown="onKeydown">
            <TransitionGroup v-for="row in rows" :key="row.id" tag="div" class="nb-tab-strip__row" :css="false" :move-class="animateMoves ? 'nb-tab-frame--moving' : 'nb-tab-frame--still'" :data-tab-row="row.id" :data-tab-row-partition="row.partition" :data-layout="row.layout">
                <div
                    v-for="item in row.items"
                    :key="item.id"
                    class="nb-tab-frame"
                    :class="{'is-active': item.id === active, 'nb-tab-frame--placeholder': item.id === placeholder}"
                    :aria-hidden="item.id === placeholder ? 'true' : undefined"
                    :style="truncating ? {maxWidth: `${maxItemWidth}px`, ...(adapt.level === 3 ? {flexShrink: 1} : {})} : undefined"
                >
                    <button
                        v-bind="item.attrs"
                        :id="tabIdOf?.(item.id)"
                        type="button"
                        role="tab"
                        class="nb-tab nb-ui-focus-ring-inset"
                        :aria-controls="panelIdOf?.(item.id)"
                        :aria-selected="item.id === active ? 'true' : 'false'"
                        :aria-label="iconOnly(item) ? item.title : undefined"
                        :aria-description="dragHint === '' ? undefined : dragHint"
                        :tabindex="item.id === tabStop ? 0 : -1"
                        :title="item.tooltip ?? (truncating ? item.title : undefined)"
                        :data-panel-tab="item.id"
                        :data-tab-partition="item.partition ?? row.partition"
                        @click="emit('activate', item.id)"
                        @dblclick="emit('keep', item.id)"
                        @auxclick="onAuxClick($event, item.id)"
                        @mousedown="(event: MouseEvent) => event.button === 2 && event.preventDefault()"
                        @contextmenu="onContextMenu($event, item.id)"
                    >
                        <slot name="tab" :item="item" :active="item.id === active">
                            <span v-if="item.iconClass !== undefined" class="nb-tab__icon" :class="item.iconClass" aria-hidden="true"></span>
                            <span v-if="!iconOnly(item)" class="nb-tab__title">{{ item.title }}</span>
                        </slot>
                    </button>
                    <slot name="action" :item="item" :active="item.id === active"></slot>
                </div>
            </TransitionGroup>
        </div>
        <DropdownMenu v-if="moreItems.length > 0" :items="moreItems" align="end" @select="(id: string) => emit('activate', id)">
            <button type="button" class="nb-tab nb-tab--more nb-ui-focus-ring-inset" data-tabs-more>
                {{ moreLabel }} {{ moreItems.length }}<span class="nb-tab__chevron" :class="moreIconClass" aria-hidden="true"></span>
            </button>
        </DropdownMenu>
        <!-- 测量层：完整标题的每个标签、只留图标的标签与“更多”，不可见、不占位、不进无障碍树。 -->
        <div v-if="adaptive" ref="measureEl" class="nb-tab-strip__measure" aria-hidden="true" inert>
            <span v-for="item in items" :key="item.id" class="nb-tab" data-measure-tab>
                <span v-if="item.iconClass !== undefined" class="nb-tab__icon"></span>
                <span>{{ item.title }}</span>
            </span>
            <span class="nb-tab" data-measure-icon><span class="nb-tab__icon"></span></span>
            <span class="nb-tab nb-tab--more" data-measure-more>{{ moreLabel }} {{ items.length }}<span class="nb-tab__chevron"></span></span>
        </div>
    </div>
</template>

<style scoped>
.nb-tab-frame--moving {
    transition: transform var(--motion-move) var(--ease-layout);
}

.nb-tab-frame--placeholder {
    visibility: hidden;
}

.nb-tab-strip {
    position: relative;
    display: flex;
    align-items: flex-end;
    min-width: 0;
}

.nb-tab-strip__list {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-width: 0;
}

.nb-tab-strip__row {
    display: flex;
    flex: none;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
}

.nb-tab-strip__row[data-layout="wrap"] {
    flex-wrap: wrap;
    overflow-x: hidden;
}

.nb-tab-frame {
    position: relative;
    display: flex;
    flex: none;
    align-items: center;
    min-width: 0;
}

/* 让位时不滚动：放不下的已经收进“更多”。 */
[data-tabs-level] .nb-tab-strip__row {
    overflow: hidden;
}

.nb-tab {
    max-width: 100%;
    /* 标签是拖动源：触摸按住起拖，不滚动。 */
    touch-action: none;
}

/* 测量层叠在标签带下面：不可见、不接指针、不撑高度，子元素照常按内容宽度排开，量得出各自的宽度。 */
.nb-tab-strip__measure {
    position: absolute;
    top: 0;
    left: 0;
    display: flex;
    height: 0;
    overflow: hidden;
    visibility: hidden;
    pointer-events: none;
    white-space: nowrap;
}
</style>
