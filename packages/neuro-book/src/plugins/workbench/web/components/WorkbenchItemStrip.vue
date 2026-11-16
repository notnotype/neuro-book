<script setup lang="ts">
/** 条目条（同名 .md）：排一行，放不下时按优先级收进“更多”；只发 run 事件。 */
import {Button, DropdownMenu, Tooltip} from "@notnotype/nb-ui/components";
import type {DropdownMenuItemData} from "@notnotype/nb-ui/components";
import {useText} from "@notnotype/nb-ui/text-port";
import {useElementSize} from "@vueuse/core";
import {computed, nextTick, onBeforeUnmount, onMounted, ref, watch} from "vue";
import type {FunctionalComponent} from "vue";

import {workbenchText} from "../../shared/text";
import {layoutStrip} from "../items/item-strip";
import type {StripEntry} from "../items/registry";
import WorkbenchItemHover from "./WorkbenchItemHover.vue";

export type {StripEntry};

defineOptions({name: "WorkbenchItemStrip"});

const props = defineProps<{
    entries: StripEntry[];
    itemHeight: number;
    align: "start" | "end";
}>();

const emit = defineEmits<{
    (event: "run", itemId: string): void;
}>();

const port = useText();
/** 条目名加文字的一句（读屏名称、“更多”菜单里没有命令的项）；中间的标点随语言，写在目录里。只有图标（文字为空）时只用名字。 */
const titled = (entry: StripEntry): string => (entry.text === "" ? entry.title : port.t(workbenchText("items.titled", {title: entry.title, text: entry.text})));
/** 有命令的条目的读屏名称：文字就是名字或只有图标时只用名字。 */
const nameOf = (entry: StripEntry): string => (entry.text === entry.title || entry.text === "" ? entry.title : titled(entry));
/** 有悬停内容、按钮可用时用提示框显示它（输出 43）；禁用时浏览器不派发悬停，照旧用原因作提示。 */
const hoverOf = (entry: StripEntry) => (entry.disabledReason === null ? entry.hover : null);
/** 不带提示框时的外层：原样渲染默认插槽。 */
const Bare: FunctionalComponent = (_props, {slots}) => slots.default?.();
/** 提示框贴着条目的哪一边：右侧的条目右对齐、左侧的左对齐，不伸出窗口。 */
const tooltipAlign = computed(() => (props.align === "end" ? "end" : "start"));
/** 条目之间的间距，与样式里的 gap 一致；测量的宽度要把它算进去。 */
const GAP = 4;

const root = ref<HTMLElement | null>(null);
const measure = ref<HTMLElement | null>(null);
const {width} = useElementSize(root);
const widths = ref<ReadonlyMap<string, number>>(new Map());
const moreWidth = ref(0);

/** 读测量层：每个条目与“更多”按钮的实际宽度；间距由预算按实际摆出来的项数算。 */
function remeasure(): void {
    const layer = measure.value;
    if (layer === null) return;
    const next = new Map<string, number>();
    for (const element of layer.querySelectorAll<HTMLElement>("[data-measure-item]")) next.set(element.dataset.measureItem ?? "", element.getBoundingClientRect().width);
    // 量出来没变就不换：换了新 Map，摆放与条目都要跟着重算、重渲染。
    if (next.size !== widths.value.size || [...next].some(([id, value]) => widths.value.get(id) !== value)) widths.value = next;
    moreWidth.value = layer.querySelector<HTMLElement>("[data-measure-more]")?.getBoundingClientRect().width ?? 0;
}

/*
 * 文字、语言或条目集合变了：等测量层渲染完再量。三个来源分开写，Vue 逐个比值；写成一个返回数组的函数时每次都是新数组，
 * 上游每换一次条目数组（改窗口大小时每一步都换）都会重量一遍、强制重算整页样式（w00046 t19）。
 */
watch([() => props.entries.map((entry) => `${entry.id}\u0000${entry.text}\u0000${entry.icon?.name ?? ""}`).join("\u0001"), () => port.locale.value, () => props.itemHeight], () => {
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
    return layoutStrip(props.entries.map((entry) => ({id: entry.id, order: entry.order, priority: entry.priority, width: widths.value.get(entry.id) ?? 0})), width.value, moreWidth.value, GAP);
});

const shown = computed(() => props.entries.filter((entry) => layout.value.shown.includes(entry.id)));
const hidden = computed(() => props.entries.filter((entry) => layout.value.hidden.includes(entry.id)));

const moreItems = computed<DropdownMenuItemData[]>(() => hidden.value.map((entry) => ({
    id: entry.id,
    label: entry.command === null ? titled(entry) : nameOf(entry),
    title: entry.disabledReason ?? entry.tooltip ?? undefined,
    disabled: entry.command === null || entry.disabledReason !== null,
})));

function tooltipOf(entry: StripEntry): string | undefined {
    if (hoverOf(entry) !== null) return undefined;
    return entry.disabledReason ?? entry.tooltip ?? (entry.text === entry.title ? undefined : entry.title);
}

/** 有悬停内容时原生提示让位，`tooltip()` 的那句改作可访问描述：只有图标的条目，读屏也听得到它此刻的状态（输出 43）。 */
const descriptionOf = (entry: StripEntry): string | undefined => (hoverOf(entry) === null ? undefined : (entry.tooltip ?? undefined));

function iconClass(entry: StripEntry): (string | Record<string, boolean>)[] {
    return [entry.icon?.name ?? "", "workbench-item-strip__icon", {"workbench-item-strip__icon--spin": entry.icon?.spin === true, "workbench-item-strip__icon--muted": entry.icon?.muted === true}];
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
            <component :is="hoverOf(entry) === null ? Bare : Tooltip" v-bind="hoverOf(entry) === null ? {} : {side: 'top', align: tooltipAlign}">
                <Button
                    v-if="entry.command !== null"
                    variant="ghost"
                    size="sm"
                    focus-ring="inset"
                    class="workbench-item-strip__item"
                    :class="`workbench-item-strip__item--${entry.state}`"
                    :disabled="entry.disabledReason !== null"
                    :title="tooltipOf(entry)"
                    :aria-label="nameOf(entry)"
                    :aria-description="descriptionOf(entry)"
                    :data-workbench-item="entry.id"
                    @click="emit('run', entry.id)"
                >
                    <span v-if="entry.icon !== null" :class="iconClass(entry)" aria-hidden="true" data-workbench-item-icon></span>
                    <span v-if="entry.text !== ''" class="workbench-item-strip__label">{{ entry.text }}</span>
                </Button>
                <span
                    v-else
                    role="status"
                    class="workbench-item-strip__item workbench-item-strip__text"
                    :class="`workbench-item-strip__item--${entry.state}`"
                    :title="tooltipOf(entry)"
                    :aria-label="titled(entry)"
                    :data-workbench-item="entry.id"
                >
                    <span v-if="entry.icon !== null" :class="iconClass(entry)" aria-hidden="true" data-workbench-item-icon></span>
                    <span v-if="entry.text !== ''" class="workbench-item-strip__label">{{ entry.text }}</span>
                </span>
                <template v-if="hoverOf(entry) !== null" #content>
                    <WorkbenchItemHover :source="hoverOf(entry)!" :fallback="entry.tooltip ?? entry.title" data-workbench-item-hover />
                </template>
            </component>
        </template>
        <DropdownMenu v-if="hidden.length > 0" :items="moreItems" align="end" side="top" wrap @select="emit('run', $event)">
            <Button variant="ghost" size="sm" focus-ring="inset" class="workbench-item-strip__item" :aria-label="port.t(workbenchText('common.more'))" data-workbench-item-more>
                <span class="i-lucide-ellipsis h-3.5 w-3.5" aria-hidden="true"></span>
            </Button>
        </DropdownMenu>

        <!-- 测量层：与显示同一种元素（有命令的是 Button、没有的是文字），量每个条目与“更多”的宽度；不可见、不进读屏与 Tab 顺序。 -->
        <div ref="measure" class="workbench-item-strip__measure" aria-hidden="true" inert>
            <template v-for="entry in entries" :key="entry.id">
                <Button v-if="entry.command !== null" variant="ghost" size="sm" class="workbench-item-strip__item" tabindex="-1" :data-measure-item="entry.id">
                    <span v-if="entry.icon !== null" :class="iconClass(entry)"></span>
                    <span v-if="entry.text !== ''" class="workbench-item-strip__label">{{ entry.text }}</span>
                </Button>
                <span v-else class="workbench-item-strip__item workbench-item-strip__text" :data-measure-item="entry.id">
                    <span v-if="entry.icon !== null" :class="iconClass(entry)"></span>
                    <span v-if="entry.text !== ''" class="workbench-item-strip__label">{{ entry.text }}</span>
                </span>
            </template>
            <Button variant="ghost" size="sm" class="workbench-item-strip__item" tabindex="-1" data-measure-more><span class="i-lucide-ellipsis h-3.5 w-3.5" aria-hidden="true"></span></Button>
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
    gap: var(--space-1);
}

/* 图标在文字前（外壳四输出 42）：12px，颜色随条目；淡色只在条目没有警告、出错时生效。 */
.workbench-item-strip__icon {
    flex: 0 0 auto;
    width: 12px;
    height: 12px;
}

.workbench-item-strip__item--normal .workbench-item-strip__icon--muted {
    color: var(--text-muted);
}

.workbench-item-strip__icon--spin {
    animation: workbench-item-spin 1s linear infinite;
}

@keyframes workbench-item-spin {
    to {
        transform: rotate(360deg);
    }
}

@media (prefers-reduced-motion: reduce) {
    .workbench-item-strip__icon--spin {
        animation: none;
    }
}

.workbench-item-strip__label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.workbench-item-strip__item--warning {
    color: var(--status-warning);
}

.workbench-item-strip__item--error {
    color: var(--status-danger);
}

/*
 * 测量层与显示用同一种元素、同一组类，量出来的宽度才是摆出来时的宽度；间距不在这里，预算按项数算。
 * 宽度取内容本身（max-content），不随条带变：否则条目合起来比条带宽时，测量层被条带夹窄、条目被压缩，量出来的是压过的宽度；
 * 测量层的尺寸跟着窗口变，ResizeObserver 每一步都要重量一遍（w00046 t19）。
 */
.workbench-item-strip__measure {
    position: absolute;
    top: 0;
    left: 0;
    width: max-content;
    display: flex;
    gap: 4px;
    visibility: hidden;
    pointer-events: none;
}
</style>
