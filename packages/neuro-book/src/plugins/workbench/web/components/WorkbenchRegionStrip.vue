<script setup lang="ts">
/**
 * 底部面板的入口条（同名 .md；docs/specs/ui/workbench-layout.md 输出 47）：区域卡片顶上一行，一个容器一个入口，画容器的标题。右栏的入口在右轨上（输出 50）。
 * 当前容器只有一节时，那一节的头由宿主放进默认插槽，接在入口后面占这一行剩下的宽度。点了只发 `select` 或 `context-menu`，做什么由宿主定；
 * 入口是拖动源（`data-tool-entry`，同活动栏），拖放由宿主的拖动会话接管，这里只画占位与并入的高亮。
 */
import type {PanelName} from "@notnotype/nb-workbench-layout";
import {DropdownMenu, IconButton, Tooltip} from "@notnotype/nb-ui/components";
import {computed, onBeforeUnmount, onMounted, ref, watch} from "vue";

import {layoutStrip} from "../items/item-strip";
import "./panel-metrics.css";
import {entryTitle} from "../../shared/entry-count";
import {useEntryIndicator} from "./use-entry-indicator";

/** 一个入口：区域里的一个容器（输出 41、47）。 */
export interface RegionStripEntry {
    /** 容器 id。 */
    readonly id: string;
    /** 容器的名称：入口写出来的字，也是“更多”菜单里的文字。 */
    readonly label: string;
    /** 成员视图的声明都不在时没有图标可取，是 null：画中性的占位图标。 */
    readonly icon: string | null;
    /** 悬停文字：写出容器里的各个视图。 */
    readonly tooltip: string;
    /** 只含一个视图的容器是那个视图的 id：拖这个入口就是拖这个视图。含几个视图的是 null：拖它只在入口条上换序或整个搬到另一个区域（输出 46）。 */
    readonly viewId: string | null;
    /** 区域的当前容器：放不下时它总在外面。 */
    readonly current: boolean;
    /** 当前容器且区域可见；至多一项。 */
    readonly pressed: boolean;
    /** 计数（docs/specs/workbench/views.md 输出 17）：写在标题后（只含一个视图的容器，同那个视图的标签）。没有是 null 或不给。 */
    readonly count?: number | null;
}

const PLACEHOLDER_ICON = "i-lucide-circle-help";
/** “更多”的宽（24px 的按钮）。 */
const MORE_PX = 24;

defineOptions({name: "WorkbenchRegionStrip"});

const props = withDefaults(defineProps<{
    /** 这条入口条属于哪个区域：写在根上，宿主、测试与拖放按它找。 */
    region: PanelName;
    /** 入口这一组的可访问名称。 */
    label: string;
    moreLabel: string;
    entries: ReadonlyArray<RegionStripEntry>;
    /**
     * 并进来的头至少要留多宽（截断的标题、视图动作、框架按钮）：入口放不下时先收进“更多”，头不被挤到这个宽度以下（让位顺序见 .md）。
     * 没有并进来的头时是 0。
     */
    headMinWidth?: number;
    /**
     * 区域切换容器、内容滚过去的那一次（宿主按区域数的次数）：和按下的入口在同一次更新里变，选中标记这一次才滑过去，和内容同时走（输出 42）。
     * 别的途径换了当前容器（命令、“移动到”、当前容器空了）内容不滚，标记也直接到位。
     */
    slideToken?: number;
    /** 入口的可访问描述：怎么拿起拖动。每个入口都能拖。 */
    dragHint?: string;
    /** 这个入口留着盒子、看不见：它正被拖着（实时布局），别的入口让出它的位置。 */
    placeholder?: string | null;
    /** 这个入口盖一层并入的高亮：拖着的视图放下会并进这个容器（输出 45）。 */
    highlighted?: string | null;
}>(), {headMinWidth: 0, slideToken: 0, dragHint: "", placeholder: null, highlighted: null});

const emit = defineEmits<{
    (event: "select", id: string): void;
    /** 入口的右键菜单（键盘是菜单键）；坐标是视口坐标。 */
    (event: "context-menu", id: string, at: {readonly x: number; readonly y: number}): void;
}>();

/** 入口写的字：标题，有计数时后面接计数（“通知 2”），读屏名称同样带上。 */
const titleOf = (entry: RegionStripEntry): string => entryTitle(entry.label, entry.count);

/** 菜单键打出来的 `contextmenu` 没有可靠的指针坐标：菜单开在入口下面。 */
function onEntryContextMenu(id: string, event: MouseEvent): void {
    event.preventDefault();
    if (event.button === 0 && event.clientX === 0 && event.clientY === 0 && event.currentTarget instanceof Element) {
        const rect = event.currentTarget.getBoundingClientRect();
        emit("context-menu", id, {x: rect.left, y: rect.bottom});
        return;
    }
    emit("context-menu", id, {x: event.clientX, y: event.clientY});
}

/**
 * 放不下时排在后面的收进“更多”，当前容器的入口总在外面（输出 47）。入口能用的宽是整条减去并进来的头至少要留的宽，与摆出来几个入口无关，
 * 所以不会量了又变。标题入口的宽各不相同，在一行看不见的量尺里量（它总是摆出全部入口）。
 */
const rootEl = ref<HTMLElement | null>(null);
const entriesEl = ref<HTMLElement | null>(null);
const measureEl = ref<HTMLElement | null>(null);
const rootWidth = ref<number | null>(null);
const entryGap = ref(0);
const titleWidths = ref<ReadonlyMap<string, number>>(new Map());

function measure(): void {
    const root = rootEl.value;
    if (root === null) return;
    const style = getComputedStyle(root);
    const width = root.clientWidth - (Number.parseFloat(style.paddingLeft) || 0) - (Number.parseFloat(style.paddingRight) || 0);
    rootWidth.value = width > 0 ? width : null;
    entryGap.value = entriesEl.value === null ? 0 : Number.parseFloat(getComputedStyle(entriesEl.value).columnGap) || 0;
    const ruler = measureEl.value;
    if (ruler === null) return;
    const next = new Map<string, number>();
    for (const element of ruler.querySelectorAll<HTMLElement>("[data-measure-entry]")) next.set(element.dataset.measureEntry ?? "", element.offsetWidth);
    titleWidths.value = next;
}

let observer: ResizeObserver | null = null;
onMounted(() => {
    measure();
    if (typeof ResizeObserver !== "function" || rootEl.value === null) return;
    observer = new ResizeObserver(measure);
    observer.observe(rootEl.value);
});
onBeforeUnmount(() => observer?.disconnect());
// 换了入口（名称、个数）时入口的宽要重量；量尺在下一次渲染之后才是新的。
watch(() => props.entries.map(titleOf).join("\n"), () => requestAnimationFrame(measure), {flush: "post"});

const widthOf = (id: string): number => titleWidths.value.get(id) ?? 0;
const strip = computed(() => {
    const room = rootWidth.value;
    const all = {shown: props.entries.map((entry) => entry.id), hidden: [] as string[]};
    if (room === null || titleWidths.value.size === 0) return all;
    // 当前容器的入口加“更多”总放得下：条再窄也不让它收进“更多”，挤的是并进来的头。
    const current = props.entries.find((entry) => entry.current);
    const floor = current === undefined ? 0 : widthOf(current.id) + MORE_PX + entryGap.value;
    return layoutStrip(props.entries.map((entry, index) => ({id: entry.id, order: index, priority: entry.current ? 1 : 0, width: widthOf(entry.id)})), Math.max(floor, room - props.headMinWidth), MORE_PX, entryGap.value);
});
const shownEntries = computed(() => props.entries.filter((entry) => strip.value.shown.includes(entry.id)));
const moreItems = computed(() => props.entries.filter((entry) => strip.value.hidden.includes(entry.id)).map((entry) => ({label: titleOf(entry), id: entry.id, iconClass: entry.icon ?? PLACEHOLDER_ICON})));

/** 按下态（下划线）是入口这一组里一个独立的块，区域切换容器、内容滚过去的那一次滑过去（`use-entry-indicator.ts`）。 */
const {element: indicatorEl, shown: indicatorShown, sliding, settled, style: indicatorStyle, onTransitionEnd: onIndicatorTransitionEnd} = useEntryIndicator({
    band: entriesEl,
    pressed: () => {
        const id = shownEntries.value.find((entry) => entry.pressed)?.id;
        const button = id === undefined ? undefined : [...(entriesEl.value?.querySelectorAll<HTMLElement>("[data-region-entry]") ?? [])].find((element) => element.dataset.regionEntry === id);
        return id === undefined || button === undefined ? null : {id, button};
    },
    hasEntries: () => shownEntries.value.length > 0,
    slideToken: () => props.slideToken,
    // 按下的入口、摆出来的入口、条的宽与标题入口的宽：标题入口的宽各不相同，名称一变按钮就挪。
    layoutKey: () => `${shownEntries.value.map((entry) => `${entry.id}${entry.pressed ? "*" : ""}`).join(",")}|${String(rootWidth.value)}|${[...titleWidths.value.values()].join(",")}`,
});
</script>

<template>
    <div ref="rootEl" class="workbench-region-strip" :data-region-strip="region">
        <div ref="entriesEl" class="workbench-region-strip__entries" role="group" :aria-label="label" data-region-entries>
            <span
                ref="indicatorEl"
                class="workbench-region-strip__indicator"
                data-region-indicator
                aria-hidden="true"
                :data-shown="indicatorShown ? '' : undefined"
                :data-sliding="sliding ? '' : undefined"
                :data-settled="settled ? '' : undefined"
                :style="indicatorStyle"
                @transitionend="onIndicatorTransitionEnd"
            ></span>
            <!-- 换位时滑过去，只在拖动中开。条目外面要有一层元素：`Tooltip` 的根是 Fragment，`TransitionGroup` 记不到它的位置。 -->
            <TransitionGroup tag="div" class="workbench-region-strip__list" :css="false" :move-class="placeholder !== null ? 'workbench-region-strip__frame--moving' : 'workbench-region-strip__frame--still'">
                <div v-for="entry in shownEntries" :key="entry.id" class="workbench-region-strip__frame" data-entry-frame :class="{'workbench-region-strip__frame--placeholder': entry.id === placeholder}" :aria-hidden="entry.id === placeholder ? 'true' : undefined">
                    <Tooltip :text="entry.tooltip" side="bottom">
                        <button
                            type="button"
                            class="workbench-region-strip__entry nb-ui-focus-ring-inset"
                            :class="{'workbench-region-strip__entry--merge': entry.id === highlighted}"
                            :aria-pressed="entry.pressed"
                            :aria-description="dragHint === '' ? undefined : dragHint"
                            :data-region-entry="entry.id"
                            :data-tool-entry="entry.id"
                            :data-tool-view="entry.viewId ?? undefined"
                            :data-tool-merge="entry.id === highlighted ? '' : undefined"
                            :data-pressed="entry.pressed ? '' : undefined"
                            @mousedown.prevent
                            @click="emit('select', entry.id)"
                            @contextmenu="onEntryContextMenu(entry.id, $event)"
                        >
                            <span class="workbench-region-strip__title">{{ titleOf(entry) }}</span>
                        </button>
                    </Tooltip>
                </div>
            </TransitionGroup>
            <DropdownMenu v-if="moreItems.length > 0" :items="moreItems" side="bottom" align="start" @select="(id: string) => emit('select', id)">
                <IconButton size="xs" icon-class="i-lucide-ellipsis" :aria-label="moreLabel" class="workbench-region-strip__more" data-region-more />
            </DropdownMenu>
        </div>
        <div class="workbench-region-strip__head">
            <slot></slot>
        </div>
        <!-- 标题入口的量尺：一行看不见的全部入口，不占位置，不进可访问树。 -->
        <div ref="measureEl" class="workbench-region-strip__ruler" aria-hidden="true">
            <span v-for="entry in entries" :key="entry.id" class="workbench-region-strip__entry" :data-measure-entry="entry.id">
                <span class="workbench-region-strip__title">{{ titleOf(entry) }}</span>
            </span>
        </div>
    </div>
</template>

<style scoped>
.workbench-region-strip {
    position: relative;
    display: flex;
    align-items: center;
    width: 100%;
    height: 100%;
    min-width: 0;
    /* 左内边距同面板头，入口的对齐从卡片左缘算（下面两种入口各自补到目标线）。 */
    padding-inline: var(--space-1) var(--space-2);
    overflow: hidden;
    user-select: none;
}

.workbench-region-strip__entries {
    position: relative;
    /* 按下的块（`z-index: -1`）画在按钮下面、这一组里面：绝对定位的元素缺省画在普通流的按钮上面。 */
    isolation: isolate;
    display: flex;
    flex: 0 1 auto;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
}

/*
 * 按下的块（`useEntryIndicator`）：这一组里的第一个子元素，大小和位置是按下的那个入口，画在按钮下面。位置在 `transform` 上，
 * 只有内容滚过去的那一次带过渡；显示、隐藏是透明度。
 */
.workbench-region-strip__indicator {
    position: absolute;
    top: 0;
    left: 0;
    z-index: -1;
    opacity: 0;
    pointer-events: none;
}

.workbench-region-strip__indicator[data-shown] {
    opacity: 1;
}

.workbench-region-strip__indicator[data-settled] {
    transition: opacity var(--motion-layout) var(--ease-layout);
}

.workbench-region-strip__indicator[data-settled][data-sliding] {
    transition: opacity var(--motion-layout) var(--ease-layout), transform var(--motion-layout) var(--ease-layout);
}

/* 并进来的头占这一行剩下的宽度：入口先排满，头从剩下的里缩，缩到 `headMinWidth` 以下之前入口先收进“更多”。 */
.workbench-region-strip__head {
    display: flex;
    flex: 1 1 0;
    align-self: stretch;
    min-width: 0;
}

/* 并进来的头在这一行里横着占满剩下的宽度；它在分节里是竖排卡片的第一行，那里的 32px 定的是高。 */
.workbench-region-strip__head :slotted(.workbench-panel-head) {
    flex: 1 1 auto;
    height: 100%;
    min-width: 0;
}

/* 条目直接排在入口这一组里：这一层只给 `TransitionGroup` 一个容器。 */
.workbench-region-strip__list {
    display: contents;
}

.workbench-region-strip__frame {
    /* 单格网格：角标与按钮叠在同一格。不用定位：外框成了定位祖先，按钮的 offsetLeft 就改成相对外框，按下的块按它量的位置会错。 */
    display: grid;
    flex: 0 0 auto;
}

.workbench-region-strip__frame > * {
    grid-area: 1 / 1;
}

.workbench-region-strip__frame--moving {
    transition: transform var(--motion-move) var(--ease-layout);
}

.workbench-region-strip__frame--placeholder {
    visibility: hidden;
    /* 宿主拖着它在条里排序时它自己跟手（写 `translate`），不参与换位过渡：过渡的 `transform` 会让它先滑回空位再跳到指针下。 */
    transform: none !important;
}

.workbench-region-strip__entry {
    position: relative;
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    height: 24px;
    color: var(--text-secondary);
    font-size: var(--text-xs);
    white-space: nowrap;
    /* 入口也是拖动源：触摸按住起拖。 */
    touch-action: none;
    transition: color var(--motion-fast) var(--ease-layout), background-color var(--motion-fast) var(--ease-layout);
}

.workbench-region-strip__entry:hover {
    color: var(--text-main);
}

/*
 * 标题入口，水平内边距固定 4px（不随主题变），第一个入口的文字和分节头的标题文字在一条竖线上（头的左内边距加标题格的内边距）。
 * 按下是按钮宽度上的一条下划线，同面板头标签带的选中标记，画在按下的块的底边。
 */
.workbench-region-strip__entry {
    padding-inline: var(--space-2);
    font-weight: var(--weight-medium);
}

.workbench-region-strip__entry[data-pressed] {
    color: var(--text-main);
}

.workbench-region-strip__indicator {
    box-shadow: inset 0 -2px 0 var(--accent-main);
}

/* 并入的高亮：和面板并入的盖层同一种填充与描边（`--layout-merge-*`），压在按下与悬停的样子上面：拖动中指针就停在这个入口上。 */
.workbench-region-strip .workbench-region-strip__entry--merge,
.workbench-region-strip .workbench-region-strip__entry--merge:hover {
    background: var(--layout-merge-fill);
    box-shadow: inset 0 0 0 var(--layout-merge-border-width) var(--layout-merge-border);
}

.workbench-region-strip__ruler {
    position: absolute;
    top: 0;
    left: 0;
    display: flex;
    visibility: hidden;
    pointer-events: none;
}
</style>
