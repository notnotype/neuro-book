<script setup lang="ts">
/** 条目条（同名 .md）：排一行，放不下时按优先级收进“更多”；只发 run 事件。 */
import {Button, Dropdown} from "@notnotype/nb-ui/components";
import type {DropdownItem} from "@notnotype/nb-ui/components";
import {useElementSize} from "@vueuse/core";
import {computed, nextTick, onBeforeUnmount, onMounted, ref, watch} from "vue";

import {localize} from "nbook/shared/localized-text";
import type {DisplayLocale} from "nbook/shared/localized-text";

import {layoutStrip} from "../items/item-strip";
import type {ShownItem} from "../items/registry";

export type StripEntry = ShownItem & {readonly disabledReason: string | null};

defineOptions({name: "WorkbenchItemStrip"});

const props = defineProps<{
    locale: DisplayLocale;
    entries: StripEntry[];
    itemHeight: number;
    align: "start" | "end";
}>();

const emit = defineEmits<{
    (event: "run", itemId: string): void;
}>();

const MORE = {"zh-CN": "更多", "en-US": "More"};
/** 条目之间的间距，与样式里的 gap 一致；测量的宽度要把它算进去。 */
const GAP = 4;

const root = ref<HTMLElement | null>(null);
const measure = ref<HTMLElement | null>(null);
const {width} = useElementSize(root);
const widths = ref<ReadonlyMap<string, number>>(new Map());
const moreWidth = ref(0);

/** 读测量层：每个条目的实际宽度加间距，以及“更多”按钮的宽度。 */
function remeasure(): void {
    const layer = measure.value;
    if (layer === null) return;
    const next = new Map<string, number>();
    for (const element of layer.querySelectorAll<HTMLElement>("[data-measure-item]")) next.set(element.dataset.measureItem ?? "", element.getBoundingClientRect().width + GAP);
    widths.value = next;
    moreWidth.value = (layer.querySelector<HTMLElement>("[data-measure-more]")?.getBoundingClientRect().width ?? 0) + GAP;
}

// 文字、语言或条目集合变了：等测量层渲染完再量。
watch(() => [props.entries.map((entry) => `${entry.id}\u0000${entry.text}`).join("\u0001"), props.locale, props.itemHeight], () => {
    void nextTick(remeasure);
}, {immediate: true});

let observer: ResizeObserver | null = null;
onMounted(() => {
    remeasure();
    // 字体晚到也会改变宽度：测量层自己的尺寸变化同样触发重量。
    if (measure.value !== null && typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(() => remeasure());
        observer.observe(measure.value);
    }
});
onBeforeUnmount(() => {
    observer?.disconnect();
    observer = null;
});

const layout = computed(() => {
    // 还没量到宽度（首帧、测试环境没有布局）时全部摆出来，不先收起再弹出。
    if (width.value <= 0 || widths.value.size === 0) return {shown: props.entries.map((entry) => entry.id), hidden: [] as string[]};
    return layoutStrip(props.entries.map((entry) => ({id: entry.id, order: entry.order, priority: entry.priority, width: widths.value.get(entry.id) ?? 0})), width.value, moreWidth.value);
});

const shown = computed(() => props.entries.filter((entry) => layout.value.shown.includes(entry.id)));
const hidden = computed(() => props.entries.filter((entry) => layout.value.hidden.includes(entry.id)));

const moreItems = computed<DropdownItem[]>(() => hidden.value.map((entry) => ({
    value: entry.id,
    label: entry.command === null ? `${entry.title}：${entry.text}` : entry.text,
    title: entry.disabledReason ?? entry.tooltip ?? undefined,
    disabled: entry.command === null || entry.disabledReason !== null,
})));

function tooltipOf(entry: StripEntry): string | undefined {
    return entry.disabledReason ?? entry.tooltip ?? (entry.text === entry.title ? undefined : entry.title);
}
</script>

<template>
    <div
        v-if="entries.length > 0"
        ref="root"
        class="workbench-item-strip"
        :class="`workbench-item-strip--${align}`"
        :style="{'--strip-item-h': `${String(itemHeight)}px`}"
        data-workbench-item-strip
    >
        <template v-for="entry in shown" :key="entry.id">
            <Button
                v-if="entry.command !== null"
                variant="ghost"
                size="sm"
                class="workbench-item-strip__item"
                :class="`workbench-item-strip__item--${entry.state}`"
                :disabled="entry.disabledReason !== null"
                :title="tooltipOf(entry)"
                :aria-label="entry.text === entry.title ? entry.text : `${entry.title}：${entry.text}`"
                :data-workbench-item="entry.id"
                @click="emit('run', entry.id)"
            >{{ entry.text }}</Button>
            <span
                v-else
                role="status"
                class="workbench-item-strip__item workbench-item-strip__text"
                :class="`workbench-item-strip__item--${entry.state}`"
                :title="tooltipOf(entry)"
                :aria-label="`${entry.title}：${entry.text}`"
                :data-workbench-item="entry.id"
            >{{ entry.text }}</span>
        </template>
        <Dropdown v-if="hidden.length > 0" :items="moreItems" align="end" side="top" @select="emit('run', $event)">
            <Button variant="ghost" size="sm" class="workbench-item-strip__item" :aria-label="localize(MORE, locale)" data-workbench-item-more>
                <span class="i-lucide-ellipsis h-3.5 w-3.5" aria-hidden="true"></span>
            </Button>
        </Dropdown>

        <!-- 测量层：与显示同样的样式，量每个条目与“更多”的宽度；不可见、不进读屏与 Tab 顺序。 -->
        <div ref="measure" class="workbench-item-strip__measure" aria-hidden="true" inert>
            <span v-for="entry in entries" :key="entry.id" class="workbench-item-strip__item workbench-item-strip__text workbench-item-strip__probe" :data-measure-item="entry.id">{{ entry.text }}</span>
            <span class="workbench-item-strip__item workbench-item-strip__probe" data-measure-more><span class="i-lucide-ellipsis h-3.5 w-3.5"></span></span>
        </div>
    </div>
</template>

<style scoped>
.workbench-item-strip {
    position: relative;
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    gap: 4px;
    min-width: 0;
    overflow: hidden;
}

.workbench-item-strip--end {
    justify-content: flex-end;
}

.workbench-item-strip__item {
    flex: 0 0 auto;
    max-width: 320px;
    height: var(--strip-item-h);
    padding-inline: var(--space-1);
    overflow: hidden;
    font-size: inherit;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.workbench-item-strip__text {
    display: inline-flex;
    align-items: center;
}

.workbench-item-strip__item--warning {
    color: var(--status-warning);
}

.workbench-item-strip__item--error {
    color: var(--status-danger);
}

.workbench-item-strip__measure {
    position: absolute;
    top: 0;
    left: 0;
    display: flex;
    visibility: hidden;
    pointer-events: none;
}

/* 探针与显示的条目用同一组尺寸类（高度、内边距、320px 上限），量出来的宽度才是摆出来时的宽度。 */
.workbench-item-strip__probe {
    display: inline-flex;
    align-items: center;
}
</style>
