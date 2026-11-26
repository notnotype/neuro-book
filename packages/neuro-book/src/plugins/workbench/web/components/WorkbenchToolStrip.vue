<script setup lang="ts">
/**
 * 侧轨（同名 .md）：左轨就是活动栏，右轨是右栏外侧那一条（docs/specs/ui/workbench-layout.md 输出 22、50）。上段列区域的容器，一个容器一个入口；
 * 底段是贡献来的全局项（只有左轨有）。点了只发 `select` 或 `run-item`，做什么由宿主定。整条是一条纵向工具条，焦点按 roving tabindex 在条里走。
 */
import {Badge, DropdownMenu, IconButton, Tooltip} from "@notnotype/nb-ui/components";
import {computed, nextTick, onBeforeUnmount, onMounted, ref, watch} from "vue";

import {layoutStrip} from "../items/item-strip";
import {entryCountText, entryTitle} from "../../shared/entry-count";
import {useEntryIndicator} from "./use-entry-indicator";
import {useRailHandle} from "./use-rail-handle";

/** 上段的一个入口：侧栏里的一个容器（docs/specs/ui/workbench-layout.md 输出 22、41）。 */
export interface ToolStripEntry {
    /** 容器 id。 */
    readonly id: string;
    /** 容器的名称：可访问名称，也是“更多”菜单里的文字。 */
    readonly label: string;
    /** 成员视图的声明都不在时没有图标可取，是 null：画中性的占位图标。 */
    readonly icon: string | null;
    /** 悬停文字：写出容器里的各个视图。 */
    readonly tooltip: string;
    /** 只含一个视图的容器是那个视图的 id：拖这个入口就是拖这个视图。含几个视图的是 null：拖它只在活动栏里换序（输出 46）。 */
    readonly viewId: string | null;
    /** 侧栏的当前容器：放不下时它总在外面。 */
    readonly current: boolean;
    /** 当前容器且侧栏可见；至多一项。 */
    readonly pressed: boolean;
    /** 图标右上角的计数：容器里各视图 `badge()` 的合计（docs/specs/workbench/views.md 输出 17）；没有是 null 或不给。 */
    readonly count?: number | null;
}

/** 没有图标可取的入口画它：和声明不在的视图的标签同一个。 */
const PLACEHOLDER_ICON = "i-lucide-circle-help";

/** 底段的一个全局项（`workbench.activitybar-items`）。 */
export interface ToolStripItem {
    readonly id: string;
    readonly title: string;
    readonly icon: string;
    /** 没有命令的条目是不可点的占位。 */
    readonly interactive: boolean;
    /** 不是切换按钮为 null。 */
    readonly pressed: boolean | null;
    readonly disabledReason: string | null;
}

/**
 * 当前容器借来的视图段（docs/specs/ui/workbench-layout.md 输出 50 的“三段”“展开”“轨宽手柄”）：有它时条里多出视图段的两个位置（`main` 在中间独立滚动、`foot` 在底段）、
 * 展开按钮，展开时还有轨宽手柄。宽度都是卡片宽。
 */
export interface ToolStripSegment {
    /** 此刻生效的展开状态（被预算拒绝时是 false）。 */
    readonly expanded: boolean;
    /** 意图是展开、窗口太窄给不出：按钮写“窗口太窄”。 */
    readonly tooNarrow: boolean;
    /** 视图还在加载：`main` 里画骨架，厚度不变、不带动画。 */
    readonly loading: boolean;
    /** 此刻生效的卡片宽：手柄的数值。 */
    readonly width: number;
    readonly bounds: {readonly minimum: number; readonly maximum: number; readonly width: number};
    /** 布局版本：手柄拖动中变了就整场取消。 */
    readonly revision: unknown;
    /** 手柄不可用（别的面板最大化着）：不进 Tab、拖不动。 */
    readonly handleDisabled: boolean;
    readonly labels: {readonly expand: string; readonly collapse: string; readonly tooNarrow: string; readonly handle: string};
}

defineOptions({name: "WorkbenchToolStrip"});

const props = withDefaults(defineProps<{
    label: string;
    /** 哪个区域的侧轨：左轨（侧栏）在区域左边，右轨（右栏）在右边，悬停提示与菜单朝区域那一侧的反方向开。 */
    region?: "sidebar" | "auxiliarybar";
    /** 和区域的卡片相连（宿主从表面拿到）：写 `data-rail-joined`，给测试与主题看。 */
    joined?: boolean;
    moreLabel: string;
    entries: ReadonlyArray<ToolStripEntry>;
    items?: ReadonlyArray<ToolStripItem>;
    /** 入口的可访问描述：怎么拿起拖动。每个入口都能拖。 */
    dragHint?: string;
    /** 这个入口留着盒子、看不见：它正被拖着（实时布局），别的入口让出它的位置。 */
    placeholder?: string | null;
    /** 这个入口盖一层并入的高亮：拖着的视图放下会并进这个容器（输出 45）。 */
    highlighted?: string | null;
    /**
     * 侧栏切换容器时内容滚过去的那一次（宿主给的交换的 `token`）：和按下的入口在同一次更新里变，按下的块这一次才滑过去，和内容同时走。
     * 别的途径换了当前容器（命令、“移动到”、拖动落进入口、当前容器空了）内容不滚，块也直接到位。
     */
    slideToken?: number;
    /** 当前容器借来的视图段；没有是 null。 */
    segment?: ToolStripSegment | null;
}>(), {region: "sidebar", joined: false, items: () => [], dragHint: "", placeholder: null, highlighted: null, slideToken: 0, segment: null});

/** 提示与菜单开在侧轨外侧：左轨往右开，右轨往左开，不压到窗口边外。 */
const popupSide = computed(() => (props.region === "sidebar" ? "right" : "left"));

const emit = defineEmits<{
    (event: "select", id: string): void;
    (event: "run-item", id: string): void;
    /** 入口的右键菜单（键盘是菜单键）；坐标是视口坐标。 */
    (event: "context-menu", id: string, at: {readonly x: number; readonly y: number}): void;
    /** 视图段的两个位置挂上或拆掉（拆掉时都是 null）：宿主转给视图（`ViewRail.placement`）。 */
    (event: "segment-elements", main: HTMLElement | null, foot: HTMLElement | null): void;
    /** 点展开按钮。 */
    (event: "toggle-segment"): void;
    /** 轨宽手柄拖动中的宽；null 是撤回预览。宿主按它重算呈现，不写文档。 */
    (event: "segment-width-preview", width: number | null): void;
    /** 轨宽手柄落账（松手、键盘、双击）。 */
    (event: "segment-width-commit", width: number): void;
}>();

const mainEl = ref<HTMLElement | null>(null);
const footEl = ref<HTMLElement | null>(null);
// 位置挂上、拆掉都告诉宿主：视图按它 `Teleport`，拆掉之前宿主先把视图段的位置改成 `none`（同一次更新里，`flush: "sync"` 之前的 watchEffect 已经跑完）。
watch([mainEl, footEl], ([main, foot]) => emit("segment-elements", main, foot), {flush: "post", immediate: true});
onBeforeUnmount(() => emit("segment-elements", null, null));

const segmentText = computed(() => {
    const segment = props.segment;
    if (segment === null) return "";
    if (segment.tooNarrow) return segment.labels.tooNarrow;
    return segment.expanded ? segment.labels.collapse : segment.labels.expand;
});

/** 手柄在侧轨朝区域的那一边：右轨在左边。 */
const handle = useRailHandle({
    width: () => props.segment?.width ?? 0,
    bounds: () => props.segment?.bounds ?? {minimum: 0, maximum: 0, width: 0},
    side: () => (props.region === "sidebar" ? "end" : "start"),
    revision: () => props.segment?.revision,
    disabled: () => props.segment?.expanded !== true || props.segment.handleDisabled,
    preview: (width) => emit("segment-width-preview", width),
    commit: (width) => emit("segment-width-commit", width),
});

/**
 * 焦点交接（输出 50 的“焦点与读屏”）：焦点在视图段里、视图段被收起或拆掉，焦点所在的元素因此没了（视图换画法拆掉了它、整段拆掉），焦点掉到 body 时，
 * 交给展开按钮，没有按钮时交给按下的入口；还在的元素照旧留着焦点。“焦点在视图段里”按 focusin、focusout 记：元素被拆掉时浏览器不一定发 focusout，
 * 所以这个标记会留着，正好说明焦点是从这里丢的。焦点明确去了视图段外面（`relatedTarget` 在外）时清掉。
 */
let segmentFocused = false;
function onSegmentFocusIn(): void {
    segmentFocused = true;
}
function onSegmentFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && !(mainEl.value?.contains(next) ?? false)) segmentFocused = false;
}
watch(() => [props.segment?.expanded, props.segment === null], ([expanded, gone], [wasExpanded]) => {
    if (!segmentFocused || (expanded === true && gone !== true) || (wasExpanded !== true && gone !== true)) return;
    void nextTick(() => {
        const focused = document.activeElement;
        if (focused !== null && focused !== document.body) return;
        segmentFocused = false;
        const target = navEl.value?.querySelector<HTMLElement>("[data-rail-expand]") ?? navEl.value?.querySelector<HTMLElement>("[data-tool-entry][aria-pressed='true']") ?? null;
        target?.focus({preventScroll: true});
    });
});

/** 菜单键打出来的 `contextmenu` 没有可靠的指针坐标：菜单开在条目朝区域的那一侧（左轨的右边、右轨的左边）。 */
function onEntryContextMenu(id: string, event: MouseEvent): void {
    event.preventDefault();
    if (event.button === 0 && event.clientX === 0 && event.clientY === 0 && event.currentTarget instanceof Element) {
        const rect = event.currentTarget.getBoundingClientRect();
        emit("context-menu", id, {x: props.region === "sidebar" ? rect.right : rect.left, y: rect.top});
        return;
    }
    emit("context-menu", id, {x: event.clientX, y: event.clientY});
}

/** 放不下时排在后面的收进“更多”，当前容器的入口总在外面（输出 22）。量不到条目区（还没挂上）时全部摆出来，条目区自己纵向滚动兜底。 */
const bandEl = ref<HTMLElement | null>(null);
const available = ref<number | null>(null);
const ITEM_PX = 38;

function measureBand(): void {
    const band = bandEl.value;
    if (band === null) return;
    const style = getComputedStyle(band);
    const height = band.clientHeight - (Number.parseFloat(style.paddingTop) || 0) - (Number.parseFloat(style.paddingBottom) || 0);
    available.value = height > 0 ? height : null;
}

let observer: ResizeObserver | null = null;
onMounted(() => {
    measureBand();
    if (typeof ResizeObserver !== "function" || bandEl.value === null) return;
    observer = new ResizeObserver(measureBand);
    observer.observe(bandEl.value);
});
onBeforeUnmount(() => observer?.disconnect());

const strip = computed(() => {
    const room = available.value;
    if (room === null || bandEl.value === null) return {shown: props.entries.map((entry) => entry.id), hidden: [] as string[]};
    const gap = Number.parseFloat(getComputedStyle(bandEl.value).rowGap) || 0;
    return layoutStrip(props.entries.map((entry, index) => ({id: entry.id, order: index, priority: entry.current ? 1 : 0, width: ITEM_PX})), room, ITEM_PX, gap);
});
const sameItems = <T,>(a: ReadonlyArray<T>, b: ReadonlyArray<T>): boolean => a.length === b.length && a.every((item, index) => item === b[index]);
/**
 * 摆出来的入口不变时交回上一次的数组：条目区随窗口高度变、`strip` 每一步都重算，换成新数组的话列表的 TransitionGroup
 * 每一步都重渲染、量一遍所有条目（w00046 t19）。
 */
const shownEntries = computed((previous?: ReadonlyArray<ToolStripEntry>) => {
    const next = props.entries.filter((entry) => strip.value.shown.includes(entry.id));
    return previous !== undefined && sameItems(previous, next) ? previous : next;
});
const moreItems = computed(() => props.entries.filter((entry) => strip.value.hidden.includes(entry.id)).map((entry) => ({label: entryTitle(entry.label, entry.count), id: entry.id, iconClass: entry.icon ?? PLACEHOLDER_ICON})));

/** 按下的底色是条目区里一个独立的块（输出 22），侧栏切换容器、内容滚过去的那一次滑过去（`use-entry-indicator.ts`）。 */
const {element: indicatorEl, shown: indicatorShown, sliding, settled, style: indicatorStyle, onTransitionEnd: onIndicatorTransitionEnd} = useEntryIndicator({
    band: bandEl,
    pressed: () => {
        const id = shownEntries.value.find((entry) => entry.pressed)?.id;
        const button = id === undefined ? undefined : [...(bandEl.value?.querySelectorAll<HTMLElement>("[data-tool-entry]") ?? [])].find((element) => element.dataset.toolEntry === id);
        return id === undefined || button === undefined ? null : {id, button};
    },
    hasEntries: () => shownEntries.value.length > 0,
    slideToken: () => props.slideToken,
    // 按下的入口、摆出来的入口与条目区的高度：入口是定宽的按钮，别的不会挪动它。
    layoutKey: () => `${shownEntries.value.map((entry) => `${entry.id}${entry.pressed ? "*" : ""}`).join(",")}|${String(available.value)}`,
});

/**
 * 纵向工具条的焦点（输出 50 的“焦点与读屏”）：条里带 `data-rail-item` 的可聚焦项按 DOM 顺序是一条（入口、“更多”、视图借来的那一段里的项、底段），
 * 只有一项可以 Tab 进来（`tabindex=0`），上下方向键、Home、End 在条里走。视图段的项由视图画（Teleport 进来），所以按 DOM 现找，不靠这里的数据；
 * 条里的元素变了（入口增减、视图段换画法）由 `MutationObserver` 重排一次。Tab 进来的那一项：上次在条里的那一项还在就是它，否则是按下的入口，再否则是第一项。
 */
const navEl = ref<HTMLElement | null>(null);
let lastItem: HTMLElement | null = null;

function railItems(): HTMLElement[] {
    const root = navEl.value;
    if (root === null) return [];
    return [...root.querySelectorAll<HTMLElement>("[data-rail-item]")].filter((element) => !element.hasAttribute("disabled") && element.closest("[aria-hidden='true']") === null);
}

function syncTabStops(): void {
    const items = railItems();
    const stop = (lastItem !== null && items.includes(lastItem) ? lastItem : null)
        ?? items.find((element) => element.getAttribute("aria-pressed") === "true" && element.hasAttribute("data-tool-entry"))
        ?? items[0];
    // 值没变不写：条里每次增删都会排一次（拖分隔线、改窗口大小时每帧都有），写同样的值也算一次 DOM 写入。
    for (const element of items) {
        const value = element === stop ? "0" : "-1";
        if (element.getAttribute("tabindex") !== value) element.setAttribute("tabindex", value);
    }
}

function onFocusIn(event: FocusEvent): void {
    const item = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-rail-item]") : null;
    if (item === null || !navEl.value?.contains(item)) return;
    lastItem = item;
    syncTabStops();
}

const STEPS: Readonly<Record<string, (index: number, count: number) => number>> = {
    ArrowDown: (index, count) => Math.min(count - 1, index + 1),
    ArrowUp: (index) => Math.max(0, index - 1),
    Home: () => 0,
    End: (_index, count) => count - 1,
};

function onKeydown(event: KeyboardEvent): void {
    const step = STEPS[event.key];
    const item = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-rail-item]") : null;
    // 项自己已经处理过的键不再走：“更多”的触发器在 ArrowDown 上打开菜单并 `preventDefault`，这里再挪焦点就和菜单抢。
    if (step === undefined || item === null || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const items = railItems();
    const index = items.indexOf(item);
    if (index === -1) return;
    event.preventDefault();
    items[step(index, items.length)]?.focus();
}

let mutations: MutationObserver | null = null;
onMounted(() => {
    syncTabStops();
    if (typeof MutationObserver !== "function" || navEl.value === null) return;
    mutations = new MutationObserver(syncTabStops);
    // 只看增删：`tabindex` 是这里自己写的，看属性会循环。
    mutations.observe(navEl.value, {childList: true, subtree: true});
});
onBeforeUnmount(() => mutations?.disconnect());
// 按下的入口换了、入口收进“更多”：增删看不到，等这一轮渲染完再排。
watch(() => props.entries.map((entry) => `${entry.id}${entry.pressed ? "*" : ""}`).join(","), () => void nextTick(syncTabStops));
</script>

<template>
    <nav
        ref="navEl"
        class="workbench-tool-strip"
        :class="`workbench-tool-strip--${region}`"
        :aria-label="label"
        :data-rail="region"
        :data-rail-state="segment?.expanded === true ? 'expanded' : 'collapsed'"
        :data-rail-segment-host="segment === null ? undefined : ''"
        data-drop-refuse
        :data-rail-joined="joined ? '' : undefined"
        @focusin="onFocusIn"
        @keydown="onKeydown"
    >
        <div ref="bandEl" class="workbench-tool-strip__entries" data-tool-band>
            <span
                ref="indicatorEl"
                class="workbench-tool-strip__indicator"
                data-tool-indicator
                aria-hidden="true"
                :data-shown="indicatorShown ? '' : undefined"
                :data-sliding="sliding ? '' : undefined"
                :data-settled="settled ? '' : undefined"
                :style="indicatorStyle"
                @transitionend="onIndicatorTransitionEnd"
            ></span>
            <!-- 换位时滑过去，只在拖动中开。条目外面要有一层元素：`Tooltip` 的根是 Fragment，`TransitionGroup` 记不到它的位置。 -->
            <TransitionGroup tag="div" class="workbench-tool-strip__list" :css="false" :move-class="placeholder !== null ? 'workbench-tool-strip__frame--moving' : 'workbench-tool-strip__frame--still'">
                <div v-for="entry in shownEntries" :key="entry.id" class="workbench-tool-strip__frame" data-entry-frame :class="{'workbench-tool-strip__frame--placeholder': entry.id === placeholder}" :aria-hidden="entry.id === placeholder ? 'true' : undefined">
                    <Tooltip :text="entry.tooltip" :side="popupSide">
                        <IconButton
                            size="lg"
                            :icon-class="entry.icon ?? PLACEHOLDER_ICON"
                            :aria-label="entryTitle(entry.label, entry.count)"
                            :aria-pressed="entry.pressed"
                            :aria-description="dragHint === '' ? undefined : dragHint"
                            :data-tool-entry="entry.id"
                            :data-tool-view="entry.viewId ?? undefined"
                            data-rail-item
                            class="workbench-tool-strip__item"
                            :class="{'workbench-tool-strip__item--active': entry.pressed, 'workbench-tool-strip__item--merge': entry.id === highlighted}"
                            :data-tool-merge="entry.id === highlighted ? '' : undefined"
                            @mousedown.prevent
                            @click="emit('select', entry.id)"
                            @contextmenu="onEntryContextMenu(entry.id, $event)"
                        />
                    </Tooltip>
                    <Badge v-if="entry.count != null" size="sm" tone="accent" class="workbench-tool-strip__count" aria-hidden="true" :data-tool-count="entry.id">{{ entryCountText(entry.count) }}</Badge>
                </div>
            </TransitionGroup>
            <DropdownMenu v-if="moreItems.length > 0" :items="moreItems" :side="popupSide" align="end" @select="(id: string) => emit('select', id)">
                <IconButton size="lg" icon-class="i-lucide-ellipsis" :aria-label="moreLabel" class="workbench-tool-strip__item" data-tool-more data-rail-item />
            </DropdownMenu>
        </div>
        <!-- 视图段（输出 50 的“三段”）：`main` 与 `foot` 由工作台画、视图 Teleport 进来，两处都是拖动的拒收区，松手是取消。 -->
        <template v-if="segment !== null">
            <div ref="mainEl" class="workbench-tool-strip__segment" data-rail-segment="main" data-drop-refuse @focusin="onSegmentFocusIn" @focusout="onSegmentFocusOut">
                <div v-if="segment.loading" class="workbench-tool-strip__skeleton" data-rail-loading aria-hidden="true"></div>
            </div>
            <div ref="footEl" class="workbench-tool-strip__segment-foot" data-rail-segment="foot" data-drop-refuse></div>
            <Tooltip :text="segmentText" :side="popupSide">
                <IconButton
                    size="lg"
                    :icon-class="segment.expanded ? 'i-lucide-panel-right-close' : 'i-lucide-panel-right-open'"
                    :aria-label="segment.labels.expand"
                    :aria-description="segment.tooNarrow ? segment.labels.tooNarrow : undefined"
                    :aria-expanded="segment.expanded"
                    :data-rail-too-narrow="segment.tooNarrow ? '' : undefined"
                    data-rail-expand
                    data-rail-item
                    class="workbench-tool-strip__item workbench-tool-strip__expand"
                    @click="emit('toggle-segment')"
                />
            </Tooltip>
            <div
                v-if="segment.expanded && !segment.handleDisabled"
                class="workbench-tool-strip__handle"
                :class="`workbench-tool-strip__handle--${region === 'sidebar' ? 'end' : 'start'}`"
                role="separator"
                aria-orientation="vertical"
                :aria-label="segment.labels.handle"
                :aria-valuenow="handle.dragging.value ?? segment.width"
                :aria-valuemin="segment.bounds.minimum"
                :aria-valuemax="segment.bounds.maximum"
                :data-dragging="handle.dragging.value === null ? undefined : ''"
                data-rail-handle
                data-rail-item
                v-on="handle.listeners"
            ></div>
        </template>
        <!-- 全局项只在左轨（输出 50 的“三段”：主侧再加全局项）；右轨没有这一段，也不带 `data-activity-items`。 -->
        <div v-if="region === 'sidebar'" class="workbench-tool-strip__footer" data-activity-items>
            <template v-for="item in items" :key="item.id">
                <!-- 停用的按钮不触发悬停提示组件：停用时原因写在原生 title 上。 -->
                <Tooltip v-if="item.interactive" :text="item.title" :side="popupSide" :disabled="item.disabledReason !== null">
                    <IconButton
                        size="lg"
                        :icon-class="item.icon"
                        :aria-label="item.title"
                        :title="item.disabledReason ?? ''"
                        :aria-pressed="item.pressed ?? undefined"
                        :disabled="item.disabledReason !== null"
                        :data-activity-item="item.id"
                        data-rail-item
                        class="workbench-tool-strip__item"
                        :class="{'workbench-tool-strip__item--pressed': item.pressed === true}"
                        @click="emit('run-item', item.id)"
                    />
                </Tooltip>
                <!-- 没有命令：不可点的占位（不以可操作的假入口呈现），样子同书架右上角的头像位。 -->
                <Tooltip v-else :text="item.title" :side="popupSide">
                    <span class="workbench-tool-strip__placeholder" role="img" :aria-label="item.title" :data-activity-item="item.id" data-activity-item-placeholder>
                        <span class="workbench-tool-strip__placeholder-circle"><span class="workbench-tool-strip__placeholder-icon" :class="item.icon" aria-hidden="true"></span></span>
                    </span>
                </Tooltip>
            </template>
        </div>
    </nav>
</template>

<style scoped>
.workbench-tool-strip {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    height: 100%;
    min-height: 0;
    padding-block: var(--space-1);
    background: var(--skin-activitybar-surface, var(--panel-surface));
}

/* 书脊首尾的两条（docs/specs/theme/skins.md 输出 7）。主题没写时高度是 0，和没有一样。只画在左轨（活动栏）上：书脊是活动栏的装饰。 */
.workbench-tool-strip--sidebar::before,
.workbench-tool-strip--sidebar::after {
    flex: none;
    box-sizing: border-box;
    width: 34px;
    height: var(--skin-activitybar-ornament-size, 0px);
    border-block: var(--skin-activitybar-ornament-width, 0px) solid var(--skin-activitybar-ornament, transparent);
    content: "";
}

.workbench-tool-strip__entries {
    position: relative;
    /* 按下的块（`z-index: -1`）画在按钮下面、条目区里面：绝对定位的元素缺省画在普通流的按钮上面。 */
    isolation: isolate;
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    width: 100%;
    min-height: 0;
    /* 滚动区自己会裁切：上下留 4px，按钮（38px，左右各余 4px）的焦点光环不被它切掉。 */
    padding-block: var(--space-2);
    overflow-y: auto;
    scrollbar-width: none;
}

/* 条目直接排在上段的列里：这一层只给 `TransitionGroup` 一个容器。 */
.workbench-tool-strip__list {
    display: contents;
}

.workbench-tool-strip__frame {
    /* 单格网格：角标与按钮叠在同一格。不用定位：外框成了定位祖先，按钮的 offsetTop 就改成相对外框，按下的块按它量的位置会错。 */
    display: grid;
    flex: 0 0 auto;
}

.workbench-tool-strip__frame > * {
    grid-area: 1 / 1;
}

/* 角标压在图标右上角，不挡点击（点它就是点入口）。 */
.workbench-tool-strip__count {
    align-self: start;
    justify-self: end;
    pointer-events: none;
}

.workbench-tool-strip__frame--moving {
    transition: transform var(--motion-move) var(--ease-layout);
}

.workbench-tool-strip__frame--placeholder {
    visibility: hidden;
    /* 宿主拖着它在条里排序时它自己跟手（写 `translate`），不参与换位过渡：过渡的 `transform` 会让它先滑回空位再跳到指针下。 */
    transform: none !important;
}

/* 底段贴着列底，不滚动：放不下时上段先滚动。上下留出与上段相同的余地，按钮的焦点光环不被列裁掉。 */
.workbench-tool-strip__footer {
    display: flex;
    flex: 0 0 auto;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    width: 100%;
    padding-block: var(--space-2);
}

.workbench-tool-strip__footer:empty {
    padding-block: 0;
}

.workbench-tool-strip .workbench-tool-strip__item {
    flex: 0 0 auto;
    border-radius: var(--radius-control);
    color: var(--skin-activitybar-foreground, var(--text-muted));
    /* 条目也是拖动源：触摸按住起拖。 */
    touch-action: none;
}

.workbench-tool-strip .workbench-tool-strip__item:hover {
    background: var(--skin-activitybar-hover, var(--bg-hover));
    color: var(--skin-activitybar-active, var(--text-main));
}

.workbench-tool-strip .workbench-tool-strip__item--active {
    color: var(--skin-activitybar-active, var(--accent-text));
}

/* 按下的入口自己不画底：底是下面这个块，悬停时也不另画一层。 */
.workbench-tool-strip .workbench-tool-strip__item--active,
.workbench-tool-strip .workbench-tool-strip__item--active:hover {
    background: transparent;
}

/*
 * 按下的块（`placeIndicator`）：条目区里的第一个子元素，画在按钮下面，跟着条目区滚动。位置在 `transform` 上，只有换入口的那一次带过渡；
 * 显示、隐藏是透明度。`left`/`top` 为 0，`transform` 给位置（`offsetLeft`、`offsetTop` 相对条目区）。
 */
.workbench-tool-strip__indicator {
    position: absolute;
    top: 0;
    left: 0;
    z-index: -1;
    border-radius: var(--radius-control);
    background: var(--skin-activitybar-hover, var(--bg-hover));
    opacity: 0;
    pointer-events: none;
}

.workbench-tool-strip__indicator[data-shown] {
    opacity: 1;
}

.workbench-tool-strip__indicator[data-settled] {
    transition: opacity var(--motion-layout) var(--ease-layout);
}

.workbench-tool-strip__indicator[data-settled][data-sliding] {
    transition: opacity var(--motion-layout) var(--ease-layout), transform var(--motion-layout) var(--ease-layout);
}

/* 并入的高亮：和面板并入的盖层同一种填充与描边（`--layout-merge-*`），压在按下与悬停的样子上面：拖动中指针就停在这个入口上。 */
.workbench-tool-strip .workbench-tool-strip__item--merge,
.workbench-tool-strip .workbench-tool-strip__item--merge:hover {
    background: var(--layout-merge-fill);
    box-shadow: inset 0 0 0 var(--layout-merge-border-width) var(--layout-merge-border);
}

/* 底段的切换按钮按下（例如设置窗口开着）：灰底、正文色，不用强调色；强调色只给上段的视图。 */
.workbench-tool-strip .workbench-tool-strip__item--pressed {
    background: var(--skin-activitybar-hover, var(--bg-hover));
    color: var(--skin-activitybar-active, var(--text-main));
}

/*
 * 收着时各段是贴窗口外缘的 48 一列：展开、收起的过渡里叶宽还在变，居中的话入口列会跟着宽度漂到中间，收起时先跳一下。
 */
.workbench-tool-strip:not([data-rail-state="expanded"]) > * {
    max-width: 48px;
}

.workbench-tool-strip--sidebar:not([data-rail-state="expanded"]) {
    align-items: flex-start;
}

.workbench-tool-strip--auxiliarybar:not([data-rail-state="expanded"]) {
    align-items: flex-end;
}

/*
 * 有视图段时（输出 50 的“三段”）：入口带按内容高，视图段的 `main` 吃掉中间剩下的高度、自己滚动，底段与展开按钮贴底。
 * 展开时侧轨是两栏：左边 48 一列不动（入口、底段、展开按钮留在原位），`main` 在右边一栏占满整高，宽是轨宽减 48。
 */
.workbench-tool-strip[data-rail-segment-host] > .workbench-tool-strip__entries {
    flex: 0 1 auto;
}

.workbench-tool-strip__segment {
    position: relative;
    display: flex;
    flex: 1 1 0;
    flex-direction: column;
    align-items: center;
    width: 100%;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    scrollbar-width: none;
}

.workbench-tool-strip__segment-foot {
    display: flex;
    flex: 0 0 auto;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    width: 100%;
}

.workbench-tool-strip__segment-foot:empty {
    display: none;
}

.workbench-tool-strip .workbench-tool-strip__expand {
    margin-block: var(--space-2);
}

.workbench-tool-strip[data-rail-state="expanded"] {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto auto;
    grid-template-columns: 48px minmax(0, 1fr);
    align-items: start;
    justify-items: center;
}

.workbench-tool-strip[data-rail-state="expanded"] > .workbench-tool-strip__entries {
    grid-row: 1;
    grid-column: 1;
    max-height: 100%;
}

.workbench-tool-strip[data-rail-state="expanded"] > .workbench-tool-strip__segment {
    grid-row: 1 / -1;
    grid-column: 2;
    align-self: stretch;
    align-items: stretch;
    height: 100%;
}

.workbench-tool-strip[data-rail-state="expanded"] > .workbench-tool-strip__segment-foot {
    grid-row: 3;
    grid-column: 1;
}

.workbench-tool-strip[data-rail-state="expanded"] > .workbench-tool-strip__expand,
.workbench-tool-strip[data-rail-state="expanded"] > :has(> .workbench-tool-strip__expand) {
    grid-row: 4;
    grid-column: 1;
}

/* 右轨的两栏镜像：48 一列贴窗口外缘（右边），`main` 朝区域长出去（左边）。 */
.workbench-tool-strip--auxiliarybar[data-rail-state="expanded"] {
    grid-template-columns: minmax(0, 1fr) 48px;
}

.workbench-tool-strip--auxiliarybar[data-rail-state="expanded"] > .workbench-tool-strip__entries,
.workbench-tool-strip--auxiliarybar[data-rail-state="expanded"] > .workbench-tool-strip__segment-foot,
.workbench-tool-strip--auxiliarybar[data-rail-state="expanded"] > .workbench-tool-strip__expand {
    grid-column: 2;
}

.workbench-tool-strip--auxiliarybar[data-rail-state="expanded"] > .workbench-tool-strip__segment {
    grid-column: 1;
}

/* 加载中的骨架：稳定尺寸、不带动画，宽跟着 `main`。 */
.workbench-tool-strip__skeleton {
    flex: 1 1 auto;
    align-self: stretch;
    margin: var(--space-2);
    border-radius: var(--radius-control);
    background: var(--skin-activitybar-hover, var(--bg-hover));
    opacity: 0.6;
}

/* 轨宽手柄：叠在 `main` 朝区域的那一边，命中区只在轨这一侧（不向区域外扩），不和网格的分隔线抢。 */
.workbench-tool-strip__handle {
    position: absolute;
    inset-block: 0;
    z-index: 2;
    width: 6px;
    cursor: col-resize;
    touch-action: none;
}

.workbench-tool-strip__handle--start {
    left: 0;
}

.workbench-tool-strip__handle--end {
    right: 0;
}

.workbench-tool-strip__handle:hover,
.workbench-tool-strip__handle:focus-visible,
.workbench-tool-strip__handle[data-dragging] {
    background: var(--accent-main);
    outline: none;
    transition: background-color var(--motion-fast) var(--ease-layout);
}

/* 占位与按钮同占一格（38px），圆形的样子与书架右上角的头像位一致。 */
.workbench-tool-strip__placeholder {
    display: grid;
    flex: 0 0 auto;
    place-items: center;
    width: 38px;
    height: 38px;
}

.workbench-tool-strip__placeholder-circle {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border: var(--border-w) solid var(--control-outline);
    border-radius: var(--radius-pill);
    background: var(--control-surface);
    color: var(--text-muted);
}

.workbench-tool-strip__placeholder-icon {
    width: var(--text-sm);
    height: var(--text-sm);
}
</style>
