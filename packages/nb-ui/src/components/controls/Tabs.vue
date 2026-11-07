<script setup lang="ts">
import type {HTMLAttributes} from "vue";
import {computed, nextTick, ref, useAttrs} from "vue";
import DropdownMenu from "../popup/DropdownMenu.vue";
import type {DropdownMenuItemData} from "../popup/dropdown-menu.types";
import {useUiText} from "../../text-port";
import {moveRoving, rovingMove} from "../../utils/roving";
import {useTabsAdapt} from "./useTabsAdapt";
import type {ControlSize} from "../shared-types";

// 线性标签页（仅标签栏，内容面板由消费方渲染）。
// 与 SegmentedControl 的分工：Tabs 用于页面/区块级导航（底部指示线），SegmentedControl 用于紧凑的互斥模式切换。
export type TabsItem = {
    value: string;
    label: string;
    iconClass?: string;
    count?: number | string;
    disabled?: boolean;
    /** 标签元素的 id；消费方用它给内容面板写 `aria-labelledby`。 */
    id?: string;
    /** 这个标签控制的内容面板 id，写到 `aria-controls`。 */
    controls?: string;
    /** 写到这个标签元素上的额外属性（如 `data-*`、`aria-roledescription`）；与组件自己管的属性同名时以组件为准。 */
    attrs?: Readonly<Record<string, string>>;
};
export type TabsSize = Extract<ControlSize, "sm" | "md">;

defineOptions({inheritAttrs: false});

const props = withDefaults(defineProps<{
    modelValue: string;
    items: TabsItem[];
    ariaLabel?: string;
    size?: TabsSize;
    /** 标签栏下方的底边线；铺在本来就没有线的标题行里（工作台平铺的工具区标题行）时关掉。 */
    baseline?: boolean;
    /** 放不下时：`scroll` 在标签栏内横向滚动；`adapt` 逐级让位（截断、只留图标、收进“更多”）。 */
    overflow?: "scroll" | "adapt";
    /** `adapt` 的截断宽度：一个标签最宽多少 px。 */
    maxItemWidth?: number;
    /** `adapt` 的“更多”按钮文字，后面跟收起来的个数。 */
    moreLabel?: string;
} & /* @vue-ignore */ HTMLAttributes>(), {
    ariaLabel: "",
    size: "md",
    baseline: true,
    overflow: "scroll",
    maxItemWidth: 96,
});

const emit = defineEmits<{
    (e: "update:modelValue", value: string): void;
}>();

const attrs = useAttrs();
const tablistRef = ref<HTMLDivElement | null>(null);

function isSelected(item: TabsItem): boolean {
    return item.value === props.modelValue;
}

function select(item: TabsItem): void {
    if (item.disabled) {
        return;
    }
    emit("update:modelValue", item.value);
}

/** 左右键、Home、End 在启用的标签间移动选中项，并把焦点跟到新标签上 */
function handleKeydown(event: KeyboardEvent): void {
    const move = rovingMove(event.key, "horizontal");
    if (move === null) return;
    const next = moveRoving(props.items, props.items.findIndex((item) => item.value === props.modelValue), move, (item) => item.disabled === true);
    const nextItem = props.items[next];
    if (nextItem === undefined) return;
    event.preventDefault();
    emit("update:modelValue", nextItem.value);
    void nextTick(() => {
        const tabs = Array.from(tablistRef.value?.querySelectorAll<HTMLButtonElement>("[role='tab']") ?? []);
        tabs.find((tab) => tab.dataset.tabValue === nextItem.value)?.focus();
    });
}

function tabClass(item: TabsItem): string {
    if (isSelected(item)) {
        return "text-[var(--text-main)] after:bg-[var(--accent-main)]";
    }
    return "text-[var(--text-secondary)] hover:text-[var(--text-main)] after:bg-transparent";
}

/** 标签的盒子：真实标签与测量层共用，测出来的宽度才对得上。 */
const tabBoxClass = computed(() => [
    "relative inline-flex shrink-0 items-center gap-[var(--space-2)] whitespace-nowrap [font-weight:var(--weight-medium)]",
    props.size === "sm" ? "h-[var(--control-h-sm)] px-[calc(var(--control-px)*0.8)] text-[length:var(--text-xs)]" : "h-[var(--control-h-md)] px-[var(--control-px)] text-[length:var(--text-sm)]",
]);

// ── 宽度适配（overflow="adapt"，同名 .md） ─────────────────────────────────

const text = useUiText();
const moreText = computed(() => props.moreLabel ?? text("tabs.more"));
const adaptive = computed(() => props.overflow === "adapt");
const rootRef = ref<HTMLDivElement | null>(null);
const measureRef = ref<HTMLDivElement | null>(null);
const adapt = useTabsAdapt({
    enabled: () => adaptive.value,
    items: () => props.items.map((item) => ({value: item.value, hasIcon: item.iconClass !== undefined})),
    selected: () => props.modelValue,
    maxItemWidth: () => props.maxItemWidth,
    remeasureOn: () => [props.items, props.maxItemWidth, props.size, moreText.value],
    root: rootRef,
    layer: measureRef,
    list: tablistRef,
});

/**
 * 截断及以后：标签有最大宽度，标题末尾省略，悬停显示全名。收进“更多”那一档里标签带可能窄到连选中的加“更多”都放不下，
 * 这时标签可以再收缩，标题出省略号，不被标签带硬切。
 */
const truncating = computed(() => adaptive.value && adapt.value.level >= 1);
/** 只留图标：选中的照旧带标题，没有图标的也带。 */
function iconOnly(item: TabsItem): boolean {
    return adaptive.value && adapt.value.level >= 2 && !isSelected(item) && item.iconClass !== undefined;
}
const visibleItems = computed(() => (adaptive.value ? props.items.filter((item) => !adapt.value.hidden.has(item.value)) : props.items));
const moreItems = computed<DropdownMenuItemData[]>(() => props.items.filter((item) => adapt.value.hidden.has(item.value)).map((item) => ({label: item.label, id: item.value, ...(item.iconClass === undefined ? {} : {iconClass: item.iconClass}), ...(item.disabled === true ? {disabled: true} : {})})));

function selectHidden(value: string): void {
    const item = props.items.find((candidate) => candidate.value === value);
    if (item !== undefined) {
        select(item);
    }
}
</script>

<template>
    <!--
        标签栏：底边线 + 选中项指示线。

        指示线必须**待在盒子里**（after:bottom-0），不能靠负偏移压在边线上。
        原因是这条 overflow-x-auto：CSS 规定两轴只要有一轴不是 visible，另一轴的 visible
        就计算成 auto，所以这里的 overflow-y 实际是 auto。指示线原来写 bottom:-1px，
        有 1px 落在 padding box 外面，于是标签栏**多出一条竖向滚动条**——一条 26px 高的
        标签栏配一根滚动条，看起来像坏了。负 margin 会踩同一个坑，换成绝对定位并没有绕开。

        代价：指示线现在贴在边线上方而不是压住它，视觉上厚度少 1px。

        宽度适配时外面多一层：标签带、“更多”与测量层并排，attrs 落在这一层上（滚动时落在标签带上）。
    -->
    <div
        v-if="adaptive"
        ref="rootRef"
        v-bind="attrs"
        class="nb-ui-tabs-adapt relative flex min-w-0 items-end"
        :class="props.baseline ? 'border-b-[length:var(--border-w)] border-[color:var(--divider)]' : ''"
        :data-tabs-level="adapt.level"
    >
        <div ref="tablistRef" role="tablist" :aria-label="props.ariaLabel || undefined" class="flex min-w-0 items-end gap-[var(--space-2)] overflow-hidden" @keydown="handleKeydown">
            <button
                v-for="item in visibleItems"
                :key="item.value"
                v-bind="item.attrs"
                type="button"
                role="tab"
                :id="item.id"
                :aria-controls="item.controls"
                :aria-label="iconOnly(item) ? item.label : undefined"
                :title="truncating ? item.label : undefined"
                :data-tab-value="item.value"
                :aria-selected="isSelected(item)"
                :tabindex="isSelected(item) ? 0 : -1"
                :disabled="item.disabled"
                class="nb-ui-focus-ring-inset transition-colors [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-layout)] after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:transition-colors after:[transition-duration:var(--motion-fast)] after:[transition-timing-function:var(--ease-layout)] disabled:cursor-not-allowed disabled:opacity-45"
                :class="[tabBoxClass, tabClass(item)]"
                :style="truncating ? {maxWidth: `${props.maxItemWidth}px`, ...(adapt.level === 3 ? {flexShrink: 1, minWidth: '0'} : {})} : undefined"
                @click="select(item)"
            >
                <span v-if="item.iconClass" :class="item.iconClass" class="h-[1.15em] w-[1.15em] shrink-0"></span>
                <span v-if="!iconOnly(item)" class="min-w-0 truncate">{{ item.label }}</span>
                <span v-if="item.count !== undefined && !iconOnly(item)" class="rounded-[var(--radius-pill)] bg-[var(--bg-subtle)] px-[var(--space-1)] font-mono text-[length:var(--text-2xs)] text-[var(--text-muted)]">{{ item.count }}</span>
            </button>
        </div>
        <DropdownMenu v-if="moreItems.length > 0" :items="moreItems" align="end" @select="selectHidden">
            <button type="button" class="nb-ui-focus-ring-inset text-[var(--text-secondary)] hover:text-[var(--text-main)]" :class="tabBoxClass" data-tabs-more>
                {{ moreText }} {{ moreItems.length }}<span class="i-lucide-chevron-down h-[1em] w-[1em]" aria-hidden="true"></span>
            </button>
        </DropdownMenu>
        <!-- 测量层：完整标题的每个标签、只留图标的标签与“更多”，不可见、不占位、不进无障碍树。 -->
        <div ref="measureRef" class="nb-ui-tabs-adapt__measure" aria-hidden="true" inert>
            <span v-for="item in props.items" :key="item.value" :class="tabBoxClass" data-measure-tab>
                <span v-if="item.iconClass" :class="item.iconClass" class="h-[1.15em] w-[1.15em] shrink-0"></span>
                <span>{{ item.label }}</span>
                <span v-if="item.count !== undefined" class="rounded-[var(--radius-pill)] px-[var(--space-1)] font-mono text-[length:var(--text-2xs)]">{{ item.count }}</span>
            </span>
            <span :class="tabBoxClass" data-measure-icon><span class="h-[1.15em] w-[1.15em] shrink-0"></span></span>
            <span :class="tabBoxClass" data-measure-more>{{ moreText }} {{ props.items.length }}<span class="h-[1em] w-[1em]"></span></span>
        </div>
    </div>
    <div v-else ref="tablistRef" v-bind="attrs" role="tablist" :aria-label="props.ariaLabel || undefined" class="flex items-end gap-[var(--space-2)] overflow-x-auto" :class="props.baseline ? 'border-b-[length:var(--border-w)] border-[color:var(--divider)]' : ''" @keydown="handleKeydown">
        <button
            v-for="item in props.items"
            :key="item.value"
            v-bind="item.attrs"
            type="button"
            role="tab"
            :id="item.id"
            :aria-controls="item.controls"
            :data-tab-value="item.value"
            :aria-selected="isSelected(item)"
            :tabindex="isSelected(item) ? 0 : -1"
            :disabled="item.disabled"
            class="nb-ui-focus-ring-inset transition-colors [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-layout)] after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:transition-colors after:[transition-duration:var(--motion-fast)] after:[transition-timing-function:var(--ease-layout)] disabled:cursor-not-allowed disabled:opacity-45"
            :class="[tabBoxClass, tabClass(item)]"
            @click="select(item)"
        >
            <span v-if="item.iconClass" :class="item.iconClass" class="h-[1.15em] w-[1.15em] shrink-0"></span>
            <span>{{ item.label }}</span>
            <span v-if="item.count !== undefined" class="rounded-[var(--radius-pill)] bg-[var(--bg-subtle)] px-[var(--space-1)] font-mono text-[length:var(--text-2xs)] text-[var(--text-muted)]">{{ item.count }}</span>
        </button>
    </div>
</template>

<style scoped>
/* 测量层叠在标签带下面：不可见、不接指针、不撑高度，子元素照常按内容宽度排开，量得出各自的宽度。 */
.nb-ui-tabs-adapt__measure {
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
