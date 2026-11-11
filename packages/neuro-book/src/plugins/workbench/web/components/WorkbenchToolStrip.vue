<script setup lang="ts">
/**
 * 活动栏（同名 .md）：上段列侧栏的容器，一个容器一个入口；底段是贡献来的全局项。点了只发 `select` 或 `run-item`，做什么由宿主定。
 */
import {DropdownMenu, IconButton, Tooltip} from "@notnotype/nb-ui/components";
import {computed, onBeforeUnmount, onMounted, ref} from "vue";

import {layoutStrip} from "../items/item-strip";

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
    /** 只含一个视图的容器是那个视图的 id：拖这个入口就是拖这个视图。含几个视图的是 null，不起拖。 */
    readonly viewId: string | null;
    /** 侧栏的当前容器：放不下时它总在外面。 */
    readonly current: boolean;
    /** 当前容器且侧栏可见；至多一项。 */
    readonly pressed: boolean;
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

defineOptions({name: "WorkbenchToolStrip"});

const props = withDefaults(defineProps<{
    label: string;
    moreLabel: string;
    entries: ReadonlyArray<ToolStripEntry>;
    items?: ReadonlyArray<ToolStripItem>;
    /** 能拖的入口（只含一个视图的）的可访问描述：怎么拿起拖动。 */
    dragHint?: string;
    /** 这个入口留着盒子、看不见：它正被拖着（实时布局），别的入口让出它的位置。 */
    placeholder?: string | null;
}>(), {items: () => [], dragHint: "", placeholder: null});

const emit = defineEmits<{
    (event: "select", id: string): void;
    (event: "run-item", id: string): void;
    /** 入口的右键菜单（键盘是菜单键）；坐标是视口坐标。 */
    (event: "context-menu", id: string, at: {readonly x: number; readonly y: number}): void;
}>();

/** 菜单键打出来的 `contextmenu` 没有可靠的指针坐标：菜单开在条目右边。 */
function onEntryContextMenu(id: string, event: MouseEvent): void {
    event.preventDefault();
    if (event.button === 0 && event.clientX === 0 && event.clientY === 0 && event.currentTarget instanceof Element) {
        const rect = event.currentTarget.getBoundingClientRect();
        emit("context-menu", id, {x: rect.right, y: rect.top});
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
const shownEntries = computed(() => props.entries.filter((entry) => strip.value.shown.includes(entry.id)));
const moreItems = computed(() => props.entries.filter((entry) => strip.value.hidden.includes(entry.id)).map((entry) => ({label: entry.label, id: entry.id, iconClass: entry.icon ?? PLACEHOLDER_ICON})));
</script>

<template>
    <nav class="workbench-tool-strip" :aria-label="label">
        <div ref="bandEl" class="workbench-tool-strip__entries" data-tool-band>
            <!-- 换位时滑过去，只在拖动中开。条目外面要有一层元素：`Tooltip` 的根是 Fragment，`TransitionGroup` 记不到它的位置。 -->
            <TransitionGroup tag="div" class="workbench-tool-strip__list" :css="false" :move-class="placeholder !== null ? 'workbench-tool-strip__frame--moving' : 'workbench-tool-strip__frame--still'">
                <div v-for="entry in shownEntries" :key="entry.id" class="workbench-tool-strip__frame" :class="{'workbench-tool-strip__frame--placeholder': entry.id === placeholder}" :aria-hidden="entry.id === placeholder ? 'true' : undefined">
                    <Tooltip :text="entry.tooltip" side="right">
                        <IconButton
                            size="lg"
                            :icon-class="entry.icon ?? PLACEHOLDER_ICON"
                            :aria-label="entry.label"
                            :aria-pressed="entry.pressed"
                            :aria-description="dragHint === '' || entry.viewId === null ? undefined : dragHint"
                            :data-tool-entry="entry.id"
                            :data-tool-view="entry.viewId ?? undefined"
                            class="workbench-tool-strip__item"
                            :class="{'workbench-tool-strip__item--active': entry.pressed}"
                            @mousedown.prevent
                            @click="emit('select', entry.id)"
                            @contextmenu="onEntryContextMenu(entry.id, $event)"
                        />
                    </Tooltip>
                </div>
            </TransitionGroup>
            <DropdownMenu v-if="moreItems.length > 0" :items="moreItems" side="right" align="end" @select="(id: string) => emit('select', id)">
                <IconButton size="lg" icon-class="i-lucide-ellipsis" :aria-label="moreLabel" class="workbench-tool-strip__item" data-tool-more />
            </DropdownMenu>
        </div>
        <div class="workbench-tool-strip__footer" data-activity-items>
            <template v-for="item in items" :key="item.id">
                <!-- 停用的按钮不触发悬停提示组件：停用时原因写在原生 title 上。 -->
                <Tooltip v-if="item.interactive" :text="item.title" side="right" :disabled="item.disabledReason !== null">
                    <IconButton
                        size="lg"
                        :icon-class="item.icon"
                        :aria-label="item.title"
                        :title="item.disabledReason ?? ''"
                        :aria-pressed="item.pressed ?? undefined"
                        :disabled="item.disabledReason !== null"
                        :data-activity-item="item.id"
                        class="workbench-tool-strip__item"
                        :class="{'workbench-tool-strip__item--pressed': item.pressed === true}"
                        @click="emit('run-item', item.id)"
                    />
                </Tooltip>
                <!-- 没有命令：不可点的占位（不以可操作的假入口呈现），样子同书架右上角的头像位。 -->
                <Tooltip v-else :text="item.title" side="right">
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
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    height: 100%;
    min-height: 0;
    padding-block: var(--space-1);
    background: var(--skin-activitybar-surface, var(--panel-surface));
}

/* 书脊首尾的两条（docs/specs/theme/skins.md 输出 7）。主题没写时高度是 0，和没有一样。 */
.workbench-tool-strip::before,
.workbench-tool-strip::after {
    flex: none;
    box-sizing: border-box;
    width: 34px;
    height: var(--skin-activitybar-ornament-size, 0px);
    border-block: var(--skin-activitybar-ornament-width, 0px) solid var(--skin-activitybar-ornament, transparent);
    content: "";
}

.workbench-tool-strip__entries {
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
    display: flex;
    flex: 0 0 auto;
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
    background: var(--skin-activitybar-hover, var(--bg-hover));
    color: var(--skin-activitybar-active, var(--accent-text));
}

/* 底段的切换按钮按下（例如设置窗口开着）：灰底、正文色，不用强调色；强调色只给上段的视图。 */
.workbench-tool-strip .workbench-tool-strip__item--pressed {
    background: var(--skin-activitybar-hover, var(--bg-hover));
    color: var(--skin-activitybar-active, var(--text-main));
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
