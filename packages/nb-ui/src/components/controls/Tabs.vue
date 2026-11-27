<script setup lang="ts">
import type {HTMLAttributes} from "vue";
import {computed, nextTick, ref, useAttrs, watch} from "vue";
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
    /**
     * 这个标签带一个菜单（同名 .md 的“标签上的菜单”）：标题后留一格向下的箭头，选中时显出、没选中时透明但占位（换选中项时别的标签
     * 不挪）；选中的这个标签再被点或按 ArrowDown 时发 `menu`。`open` 是菜单开着：箭头转半圈、`aria-expanded`。菜单由消费方画。
     */
    menu?: {open: boolean};
    /** 标题后的附注（例如这一页现在的看法），弱一号的颜色；出现与消失时宽度有过渡（换字时直接换），标题截断时先截它。 */
    note?: string;
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
    /** 选中的、带 `menu` 的标签再被点（含 Enter、Space 触发的点击）或按 ArrowDown；`element` 是这个标签，菜单由消费方画、贴着它。 */
    (e: "menu", value: string, element: HTMLElement): void;
}>();

const attrs = useAttrs();
const tablistRef = ref<HTMLDivElement | null>(null);

function isSelected(item: TabsItem): boolean {
    return item.value === props.modelValue;
}

function select(item: TabsItem, event?: MouseEvent): void {
    if (item.disabled) {
        return;
    }
    // 第一次点是选中，选中以后再点才是菜单：没选中的标签上没有菜单，箭头也是透明的。
    if (isSelected(item) && item.menu !== undefined && event?.currentTarget instanceof HTMLElement) {
        emit("menu", item.value, event.currentTarget);
        return;
    }
    emit("update:modelValue", item.value);
}

/** 带菜单的标签：只在选中时说自己有菜单，没选中的点了是选中，不是开菜单。 */
function menuAttrs(item: TabsItem): Record<string, string | boolean | undefined> {
    if (item.menu === undefined || !isSelected(item)) return {};
    return {"aria-haspopup": "menu", "aria-expanded": item.menu.open};
}


/** 左右键、Home、End 在启用的标签间移动选中项，并把焦点跟到新标签上 */
function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "ArrowDown") {
        const tab = (event.target as Element | null)?.closest<HTMLElement>("[role='tab']") ?? null;
        const item = props.items.find((candidate) => candidate.value === tab?.dataset.tabValue);
        if (tab !== null && item !== undefined && isSelected(item) && item.menu !== undefined) {
            event.preventDefault();
            emit("menu", item.value, tab);
        }
        return;
    }
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

// ── 横向滚动（overflow="scroll"，同名 .md） ─────────────────────────────────

/**
 * 选中项不在标签栏的可见范围里时，把标签栏滚到刚好露出它；它比标签栏还宽时对齐左边。只动标签栏自己的 scrollLeft：
 * `scrollIntoView` 会连带滚动外层的页面。点到的、方向键聚焦到的本来就在范围里，不动；用得上的是刚挂上、标签栏变窄与消费方
 * 换了选中（例如新加的一页排在后面）。
 */
function revealSelected(smooth: boolean): void {
    const list = tablistRef.value;
    if (adaptive.value || list === null) return;
    const tab = Array.from(list.querySelectorAll<HTMLElement>("[role='tab']")).find((element) => element.dataset.tabValue === props.modelValue);
    if (tab === undefined) return;
    const box = list.getBoundingClientRect();
    const rect = tab.getBoundingClientRect();
    const delta = rect.left < box.left || rect.width >= box.width ? rect.left - box.left : rect.right > box.right ? rect.right - box.right : 0;
    if (Math.abs(delta) < 1) return;
    // 外层有 CSS zoom 时（Component Lab 的画布）矩形是缩放后的像素，scrollLeft 是缩放前的。
    const scale = box.width > 0 ? list.offsetWidth / box.width : 1;
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    list.scrollTo({left: list.scrollLeft + delta * scale, behavior: smooth && !reduced ? "smooth" : "instant"});
}
// 刚挂上与标签栏的宽度变了（窗口变窄、转屏）时直接到位：没有起点可滑。只看宽度，高度变了不动。跟着标签栏元素走：`overflow`
// 在 scroll 与 adapt 之间换时根元素换了，旧的观察撤掉。
/**
 * 两头渐隐：某一头还有看不见的标签时，那一头淡出 24px（不画滚动条，靠它看出还能滑）。滚动、标签栏变宽变窄、标签增减时重算。
 */
const fadeStart = ref(false);
const fadeEnd = ref(false);
function updateFade(): void {
    const list = tablistRef.value;
    if (adaptive.value || list === null) {
        fadeStart.value = false;
        fadeEnd.value = false;
        return;
    }
    const room = list.scrollWidth - list.clientWidth;
    fadeStart.value = room > 1 && list.scrollLeft > 1;
    fadeEnd.value = room > 1 && list.scrollLeft < room - 1;
}
watch(() => props.items, updateFade, {flush: "post", deep: true});

watch([tablistRef, adaptive], ([list, adapting], _previous, onCleanup) => {
    if (list === null || adapting) return;
    revealSelected(false);
    updateFade();
    if (typeof ResizeObserver !== "function") return;
    let width = list.clientWidth;
    const observer = new ResizeObserver(() => {
        updateFade();
        if (list.clientWidth === width) return;
        width = list.clientWidth;
        revealSelected(false);
    });
    observer.observe(list);
    onCleanup(() => observer.disconnect());
}, {flush: "post", immediate: true});
// 只在选中项变了、或选中的那一项刚出现在列表里时看；别的更新（例如计数变了）不看，免得滑到别处看标签时被拽回来。
watch(() => (props.items.some((item) => item.value === props.modelValue) ? props.modelValue : null), (value) => {
    if (value !== null) revealSelected(true);
}, {flush: "post"});

/**
 * 标签栏不画滚动条（经典滚动条出现时占一条高度，放不下与放得下时标签栏高矮不同、推开下面的内容），所以鼠标滚轮在标签栏上
 * 竖着滚时改成横着滑；已经滑到那一头时不拦，照常滚外层。触控板的横向滑动与 Shift+滚轮本来就是横向的，不动。
 */
function handleWheel(event: WheelEvent): void {
    const list = event.currentTarget as HTMLElement;
    if (event.ctrlKey || event.deltaX !== 0 || event.deltaY === 0) return;
    const room = list.scrollWidth - list.clientWidth;
    if (room <= 0) return;
    if ((event.deltaY < 0 && list.scrollLeft <= 0) || (event.deltaY > 0 && list.scrollLeft >= room - 1)) return;
    event.preventDefault();
    // deltaMode 1 是按行（Firefox 的鼠标滚轮），一行折成 16 像素。
    list.scrollLeft += event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
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
                v-bind="{...item.attrs, ...menuAttrs(item)}"
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
                @click="select(item, $event)"
            >
                <span v-if="item.iconClass" :class="item.iconClass" class="h-[1.15em] w-[1.15em] shrink-0"></span>
                <span v-if="!iconOnly(item)" class="min-w-0 truncate">{{ item.label }}<Transition name="nb-ui-tabs-note"><span v-if="item.note" class="nb-ui-tabs-note"><span class="nb-ui-tabs-note__text"><span class="sr-only">，</span>{{ item.note }}</span></span></Transition></span>
                <span v-if="item.count !== undefined && !iconOnly(item)" class="rounded-[var(--radius-pill)] bg-[var(--bg-subtle)] px-[var(--space-1)] font-mono text-[length:var(--text-2xs)] text-[var(--text-muted)]">{{ item.count }}</span>
                <span v-if="item.menu !== undefined" class="nb-ui-tabs-menu-mark i-lucide-chevron-down" :data-shown="isSelected(item) ? '' : undefined" :data-open="isSelected(item) && item.menu.open ? '' : undefined" aria-hidden="true"></span>
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
                <span>{{ item.label }}<span v-if="item.note" class="nb-ui-tabs-note__text">{{ item.note }}</span></span>
                <span v-if="item.count !== undefined" class="rounded-[var(--radius-pill)] px-[var(--space-1)] font-mono text-[length:var(--text-2xs)]">{{ item.count }}</span>
                <span v-if="item.menu !== undefined" class="nb-ui-tabs-menu-mark"></span>
            </span>
            <span :class="tabBoxClass" data-measure-icon><span class="h-[1.15em] w-[1.15em] shrink-0"></span></span>
            <span :class="tabBoxClass" data-measure-more>{{ moreText }} {{ props.items.length }}<span class="h-[1em] w-[1em]"></span></span>
        </div>
    </div>
    <div v-else ref="tablistRef" v-bind="attrs" role="tablist" :aria-label="props.ariaLabel || undefined" class="nb-ui-tabs-scroll flex items-end gap-[var(--space-2)] overflow-x-auto" :class="props.baseline ? 'border-b-[length:var(--border-w)] border-[color:var(--divider)]' : ''" :data-fade-start="fadeStart ? '' : undefined" :data-fade-end="fadeEnd ? '' : undefined" @keydown="handleKeydown" @wheel="handleWheel" @scroll="updateFade">
        <button
            v-for="item in props.items"
            :key="item.value"
            v-bind="{...item.attrs, ...menuAttrs(item)}"
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
            @click="select(item, $event)"
        >
            <span v-if="item.iconClass" :class="item.iconClass" class="h-[1.15em] w-[1.15em] shrink-0"></span>
            <span>{{ item.label }}<Transition name="nb-ui-tabs-note"><span v-if="item.note" class="nb-ui-tabs-note"><span class="nb-ui-tabs-note__text"><span class="sr-only">，</span>{{ item.note }}</span></span></Transition></span>
            <span v-if="item.count !== undefined" class="rounded-[var(--radius-pill)] bg-[var(--bg-subtle)] px-[var(--space-1)] font-mono text-[length:var(--text-2xs)] text-[var(--text-muted)]">{{ item.count }}</span>
            <span v-if="item.menu !== undefined" class="nb-ui-tabs-menu-mark i-lucide-chevron-down" :data-shown="isSelected(item) ? '' : undefined" :data-open="isSelected(item) && item.menu.open ? '' : undefined" aria-hidden="true"></span>
        </button>
    </div>
</template>

<style scoped>
/*
 * 标题后的附注：出现时宽度从 0 过渡到字的宽度（grid 的 0fr 到 1fr），消失时反过来、收完才拿掉，后面的标签滑开而不是跳开。
 * 与标题的间隔写在附注自己的内边距里，收着时一起收掉。
 */
.nb-ui-tabs-note {
    display: inline-grid;
    grid-template-columns: 1fr;
    vertical-align: bottom;
    color: var(--text-muted);
}
.nb-ui-tabs-note-enter-active,
.nb-ui-tabs-note-leave-active {
    transition: grid-template-columns var(--motion-base) var(--ease-layout), opacity var(--motion-base) var(--ease-layout);
}
.nb-ui-tabs-note-enter-from,
.nb-ui-tabs-note-leave-to {
    grid-template-columns: 0fr;
    opacity: 0;
}
.nb-ui-tabs-note__text {
    min-width: 0;
    overflow: hidden;
    padding-left: var(--space-2);
    white-space: nowrap;
}
/* 菜单的箭头：带菜单的标签总留这一格，选中时显出，菜单开着时转半圈。 */
.nb-ui-tabs-menu-mark {
    width: 1em;
    height: 1em;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity var(--motion-fast) var(--ease-layout), transform var(--motion-fast) var(--ease-layout);
}
.nb-ui-tabs-menu-mark[data-shown] {
    opacity: 0.7;
}
.nb-ui-tabs-menu-mark[data-open] {
    transform: rotate(180deg);
}
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
/* 横向滚动的标签栏不画滚动条：经典滚动条会占一条高度（见 handleWheel）。比宿主根上 `.nb-ui-scrollbar-thin` 的零特异性规则优先。 */
.nb-ui-tabs-scroll {
    scrollbar-width: none;
}
.nb-ui-tabs-scroll::-webkit-scrollbar {
    display: none;
}
.nb-ui-tabs-scroll[data-fade-end] {
    mask-image: linear-gradient(to right, #000 calc(100% - 24px), transparent);
}
.nb-ui-tabs-scroll[data-fade-start] {
    mask-image: linear-gradient(to right, transparent, #000 24px);
}
.nb-ui-tabs-scroll[data-fade-start][data-fade-end] {
    mask-image: linear-gradient(to right, transparent, #000 24px, #000 calc(100% - 24px), transparent);
}
</style>
