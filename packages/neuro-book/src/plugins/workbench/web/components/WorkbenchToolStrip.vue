<script setup lang="ts">
/**
 * 活动栏（同名 .md）：上段列侧栏这一列的视图；底段是贡献来的全局项。点了只发 `select` 或 `run-item`，做什么由宿主定。
 */
import {DropdownMenu, IconButton, Tooltip} from "@notnotype/nb-ui/components";
import {computed, onBeforeUnmount, onMounted, ref} from "vue";

import {layoutStrip} from "../items/item-strip";

export interface ToolStripEntry {
    readonly id: string;
    readonly label: string;
    readonly icon: string;
    /** 视图有效可见（docs/specs/ui/workbench-layout.md 输出 17）。 */
    readonly pressed: boolean;
}

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
    /** 条目的可访问描述：怎么拿起拖动。 */
    dragHint?: string;
}>(), {items: () => [], dragHint: ""});

const emit = defineEmits<{
    (event: "select", id: string): void;
    (event: "run-item", id: string): void;
    /** 条目的右键菜单（键盘是菜单键）；坐标是视口坐标。 */
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

/** 放不下时排在后面的收进“更多”，有效可见的总在外面（输出 22）。量不到条目区（还没挂上）时全部摆出来，条目区自己纵向滚动兜底。 */
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
    return layoutStrip(props.entries.map((entry, index) => ({id: entry.id, order: index, priority: entry.pressed ? 1 : 0, width: ITEM_PX})), room, ITEM_PX, gap);
});
const shownEntries = computed(() => props.entries.filter((entry) => strip.value.shown.includes(entry.id)));
const moreItems = computed(() => props.entries.filter((entry) => strip.value.hidden.includes(entry.id)).map((entry) => ({label: entry.label, id: entry.id, iconClass: entry.icon})));
</script>

<template>
    <nav class="workbench-tool-strip" :aria-label="label">
        <div ref="bandEl" class="workbench-tool-strip__entries" data-tool-band>
            <Tooltip v-for="entry in shownEntries" :key="entry.id" :text="entry.label" side="right">
                <IconButton
                    size="lg"
                    :icon-class="entry.icon"
                    :aria-label="entry.label"
                    :aria-pressed="entry.pressed"
                    :aria-description="dragHint === '' ? undefined : dragHint"
                    :data-tool-entry="entry.id"
                    class="workbench-tool-strip__item"
                    :class="{'workbench-tool-strip__item--active': entry.pressed}"
                    @mousedown.prevent
                    @click="emit('select', entry.id)"
                    @contextmenu="onEntryContextMenu(entry.id, $event)"
                />
            </Tooltip>
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
