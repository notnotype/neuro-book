<script setup lang="ts">
/**
 * 活动栏（同名 .md）：上段是 Sidebar 的容器切换按钮（放不下时末尾的收进“更多”），底段是贡献来的全局项；点了只发 `select`
 * 或 `run-item`，切换、打开 Sidebar 与执行命令由宿主做。
 */
import {DropdownMenu, IconButton, Tooltip} from "@notnotype/nb-ui/components";
import {useText} from "@notnotype/nb-ui/text-port";
import {computed, onBeforeUnmount, onMounted, ref} from "vue";

import {workbenchText} from "../../shared/text";
import {layoutStrip} from "../items/item-strip";

export interface ActivityContainer {
    readonly id: string;
    readonly label: string;
    readonly icon: string;
}

/** 底段的一个全局项（docs/specs/ui/workbench-shell.md 输出 40）。 */
export interface ActivityItem {
    readonly id: string;
    readonly title: string;
    readonly icon: string;
    /** 没有命令的条目是不可点的占位。 */
    readonly command: {readonly id: string; readonly args: Readonly<Record<string, unknown>>} | null;
    /** 不是切换按钮为 null。 */
    readonly pressed: boolean | null;
    readonly disabledReason: string | null;
}

defineOptions({name: "WorkbenchActivityBar"});

const props = withDefaults(defineProps<{
    label: string;
    containers: ReadonlyArray<ActivityContainer>;
    selected: string | null;
    sidebarVisible: boolean;
    items?: ReadonlyArray<ActivityItem>;
}>(), {items: () => []});

const port = useText();

const emit = defineEmits<{
    (event: "select", id: string): void;
    (event: "run-item", id: string): void;
}>();

/**
 * 条目放不下时，末尾的收进底部的“更多”（docs/specs/ui/workbench-shell.md 输出 25）：与状态栏条目同一个预算
 * （`layoutStrip`），选中的优先级最高、总在外面。量不到条目区（还没挂上）时全部摆出来，条目区自己纵向滚动兜底。
 */
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
    if (room === null || bandEl.value === null) return {shown: props.containers.map((container) => container.id), hidden: [] as string[]};
    const gap = Number.parseFloat(getComputedStyle(bandEl.value).rowGap) || 0;
    return layoutStrip(props.containers.map((container, index) => ({id: container.id, order: index, priority: container.id === props.selected ? 1 : 0, width: ITEM_PX})), room, ITEM_PX, gap);
});
const shownContainers = computed(() => props.containers.filter((container) => strip.value.shown.includes(container.id)));
const moreItems = computed(() => props.containers.filter((container) => strip.value.hidden.includes(container.id)).map((container) => ({label: container.label, value: container.id, iconClass: container.icon})));
</script>

<template>
    <nav class="workbench-activity-bar" :aria-label="label">
        <div ref="bandEl" class="workbench-activity-bar__containers" data-switcher-band="sidebar">
            <Tooltip v-for="container in shownContainers" :key="container.id" :text="container.label" side="right">
                <IconButton
                    size="lg"
                    :icon-class="container.icon"
                    :aria-label="container.label"
                    :aria-pressed="sidebarVisible && container.id === selected"
                    :data-activity-container="container.id"
                    :data-switcher-entry="container.id"
                    :data-drag-container="container.id"
                    :aria-description="port.t(workbenchText('shell.drag.hint'))"
                    class="workbench-activity-bar__item"
                    :class="{'workbench-activity-bar__item--active': sidebarVisible && container.id === selected}"
                    @click="emit('select', container.id)"
                />
            </Tooltip>
            <DropdownMenu v-if="moreItems.length > 0" :items="moreItems" side="right" align="end" @select="(id: string) => emit('select', id)">
                <IconButton size="lg" icon-class="i-lucide-ellipsis" :aria-label="port.t(workbenchText('common.more'))" class="workbench-activity-bar__item" data-activity-more />
            </DropdownMenu>
        </div>
        <div class="workbench-activity-bar__footer" data-activity-items>
            <template v-for="item in items" :key="item.id">
                <!-- 停用的按钮不触发悬停提示组件：停用时原因写在原生 title 上。 -->
                <Tooltip v-if="item.command !== null" :text="item.title" side="right" :disabled="item.disabledReason !== null">
                    <IconButton
                        size="lg"
                        :icon-class="item.icon"
                        :aria-label="item.title"
                        :title="item.disabledReason ?? ''"
                        :aria-pressed="item.pressed ?? undefined"
                        :disabled="item.disabledReason !== null"
                        :data-activity-item="item.id"
                        class="workbench-activity-bar__item"
                        :class="{'workbench-activity-bar__item--pressed': item.pressed === true}"
                        @click="emit('run-item', item.id)"
                    />
                </Tooltip>
                <!-- 没有命令：不可点的占位（不以可操作的假入口呈现），样子同书架右上角的头像位。 -->
                <Tooltip v-else :text="item.title" side="right">
                    <span class="workbench-activity-bar__placeholder" role="img" :aria-label="item.title" :data-activity-item="item.id" data-activity-item-placeholder>
                        <span class="workbench-activity-bar__placeholder-circle"><span class="workbench-activity-bar__placeholder-icon" :class="item.icon" aria-hidden="true"></span></span>
                    </span>
                </Tooltip>
            </template>
        </div>
    </nav>
</template>

<style scoped>
/* 外壳平铺（ui/workbench-shell.md 输出 38）：贴着窗体左边与侧栏，和侧栏同一块底色，不画外框与圆角。 */
.workbench-activity-bar {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    height: 100%;
    min-height: 0;
    padding-block: var(--space-1);
    background: var(--panel-surface);
}

.workbench-activity-bar__containers {
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
.workbench-activity-bar__footer {
    display: flex;
    flex: 0 0 auto;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    width: 100%;
    padding-block: var(--space-2);
}

.workbench-activity-bar__footer:empty {
    padding-block: 0;
}

.workbench-activity-bar .workbench-activity-bar__item {
    flex: 0 0 auto;
    border-radius: var(--radius-control);
    color: var(--text-muted);
    /* 活动条目也是整容器的拖动源：触摸按住起拖。 */
    touch-action: none;
}

.workbench-activity-bar .workbench-activity-bar__item:hover {
    background: var(--bg-hover);
    color: var(--text-main);
}

.workbench-activity-bar .workbench-activity-bar__item--active {
    background: var(--bg-hover);
    color: var(--accent-text);
}

/* 底段的切换按钮按下（例如设置窗口开着）：灰底、正文色，不用强调色；强调色只给上段的当前容器。 */
.workbench-activity-bar .workbench-activity-bar__item--pressed {
    background: var(--bg-hover);
    color: var(--text-main);
}

/* 占位与按钮同占一格（38px），圆形的样子与书架右上角的头像位一致。 */
.workbench-activity-bar__placeholder {
    display: grid;
    flex: 0 0 auto;
    place-items: center;
    width: 38px;
    height: 38px;
}

.workbench-activity-bar__placeholder-circle {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border: var(--border-w) solid var(--control-outline);
    border-radius: var(--radius-pill);
    background: var(--control-surface);
    color: var(--text-muted);
}

.workbench-activity-bar__placeholder-icon {
    width: var(--text-sm);
    height: var(--text-sm);
}
</style>
