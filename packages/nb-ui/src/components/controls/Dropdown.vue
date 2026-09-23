<script setup lang="ts">
import {computed, provide, ref} from "vue";
import {
    DropdownMenuContent,
    DropdownMenuPortal,
    DropdownMenuRoot,
    DropdownMenuTrigger,
} from "reka-ui";
import MenuNodes from "./MenuNodes.vue";
import {useDropdownFloating} from "../../composables/useDropdownFloating";
import {useMenuCascade} from "../../composables/useMenuCascade";
import type {DropdownItem} from "./dropdown.types";
/**
 * 下拉菜单（Dropdown · 规范化黄金 Surface、同心圆角与 N.5 齐腰截半露底视口）。
 *
 * 浮层接入 `useDropdownFloating` 单一真相源，
 * 严格对齐 FormSelect 黄金微反光立体投影与 130% 饱和滤波，
 * 支持 4px 悬浮 macOS 胶囊滚动条与自适应双向渐隐。
 *
 * 结构覆盖平面项、分隔线、任意层级子菜单与受控 radio / checkbox；
 * 键盘漫游、子菜单展开与关闭后焦点归还全部由 Reka 菜单原语承担，组件不自己排焦点。
 */

const props = withDefaults(defineProps<{
    items: DropdownItem[];
    menuClass?: string;
    menuMaxHeight?: string;
    rootClass?: string;
    compact?: boolean;
    align?: "start" | "center" | "end";
    side?: "top" | "right" | "bottom" | "left";
    sideOffset?: number;
    disabled?: boolean;
    popoverStyle?: Record<string, string | number>;
    /** 受控展开态：传了由宿主决定，不传由原语自管；两种用法都会发 update:open。 */
    open?: boolean;
    /** 浮层内容原生属性透传（用于 data-xxx 等属性） */
    contentProps?: Record<string, unknown>;
}>(), {
    menuClass: undefined,
    menuMaxHeight: undefined,
    rootClass: "",
    compact: false,
    align: "start",
    side: "bottom",
    sideOffset: 7,
    disabled: false,
    // 显式 undefined 默认值：Boolean 档缺省会被 Vue 转成 false，那样就永远拿不到「未受控」这一档
    open: undefined,
    contentProps: () => ({}),
});

const emit = defineEmits<{
    (e: "select", value: string): void;
    (e: "focus", event: FocusEvent): void;
    (e: "update:open", value: boolean): void;
}>();

function handleOpenChange(value: boolean): void {
    if (!value) cascade.reset();
    emit("update:open", value);
}

/** 子菜单父项不走这里：它只展开子菜单，不执行自己的动作。 */
function handleSelect(item: DropdownItem): void {
    if (item.disabled) return;
    emit("select", item.value);
}

const triggerRef = ref<HTMLElement | null>(null);
function setTriggerRef(element: {$el?: HTMLElement} | HTMLElement | null): void {
    const node = element && "$el" in element ? element.$el : element;
    triggerRef.value = node && "getBoundingClientRect" in node ? node : null;
}
const unscaledAnchor = computed(() => {
    const trigger = triggerRef.value;
    if (!trigger || !("getBoundingClientRect" in trigger)) return undefined;
    return {getBoundingClientRect: () => unscaledRect(trigger)};
});

function unscaledRect(element: HTMLElement): DOMRect {
    const rect = element.getBoundingClientRect();
    const scale = new DOMMatrix(getComputedStyle(element).transform).a || 1;
    if (scale === 1) return rect;
    const width = rect.width / scale;
    const height = rect.height / scale;
    return new DOMRect(rect.left - (width - rect.width) / 2, rect.top - (height - rect.height) / 2, width, height);
}
// 统一浮层材质、同心律视口、黄金截半高度与 macOS 悬浮滚动条单一真相源
const {
    popoverStyle: floatingPopoverStyle,
    popoverClasses,
    setViewportRef,
    viewportStyle,
    viewportClasses,
    handleViewportScroll,
    handleThumbMouseDown,
    scrollThumbTop,
    scrollThumbHeight,
    isScrollable,
    isDragging,
} = useDropdownFloating({
    size: computed(() => props.compact ? "sm" : "default"),
    sideOffset: computed(() => props.sideOffset),
    popoverStyle: computed(() => props.popoverStyle),
    explicitMaxHeight: computed(() => props.menuMaxHeight),
    maxHeightLimit: computed(() => props.menuMaxHeight && !isNaN(parseInt(props.menuMaxHeight, 10)) ? parseInt(props.menuMaxHeight, 10) : undefined),
});
const resolvedMenuClass = computed(() => props.menuClass ?? (props.compact ? "min-w-[160px]" : "min-w-[200px]"));




/** 项级几何：与滚动视口同心贴边，密度随 compact 档切换。 */
const itemBaseClass = "nb-ui-popover-item flex flex-nowrap whitespace-nowrap w-full items-center justify-between text-left outline-none cursor-pointer select-none transition-colors [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] motion-reduce:transition-none data-[disabled]:opacity-40 data-[disabled]:cursor-not-allowed data-[state=open]:bg-[var(--overlay-item-active)]";

function itemClass(item: DropdownItem): string {
    if (item.tone === "danger") {
        return "text-[var(--status-danger)] hover:bg-[color-mix(in_srgb,var(--status-danger)_12%,transparent)] data-[highlighted]:bg-[color-mix(in_srgb,var(--status-danger)_12%,transparent)] data-[highlighted]:text-[var(--status-danger)]";
    }
    if (item.active) {
        return "bg-[color-mix(in_srgb,var(--accent-main)_14%,transparent)] text-[var(--text-main)] font-medium";
    }
    return "text-[var(--text-main)] hover:bg-[var(--overlay-item-active)] data-[highlighted]:bg-[var(--overlay-item-active)]";
}

function itemClassList(item: DropdownItem): (string | Record<string, boolean>)[] {
    return [
        itemBaseClass,
        props.compact
            ? "h-[24px] px-2 gap-2 mb-0.5 last:mb-0 text-[var(--text-xs)]"
            : "h-[var(--control-h-sm)] px-2.5 gap-2.5 mb-0.5 last:mb-0 text-xs",
        itemClass(item),
    ];
}



const cascade = useMenuCascade<DropdownItem>();
function warnMissingRadioGroup(items: readonly DropdownItem[]): void {
    for (const item of items) {
        if (item.type === "radio" && item.group === undefined) console.warn(`[nb-ui/Dropdown] radio 项「${item.value}」缺少 group，已按单项独立成组渲染。`);
        if (item.children) warnMissingRadioGroup(item.children);
    }
}
warnMissingRadioGroup(props.items);
function scheduleSubmenu(item: DropdownItem | null, trigger: HTMLElement, depth = 0, immediate = false): void {
    cascade.schedule(item, trigger, depth, immediate, Boolean(item?.children?.length));
}
</script>

<template>
    <DropdownMenuRoot :modal="false" :open="props.open" @update:open="handleOpenChange">
        <DropdownMenuTrigger :ref="setTriggerRef" as-child :disabled="props.disabled" :class="props.rootClass">
            <slot />
        </DropdownMenuTrigger>

        <DropdownMenuPortal v-if="props.open === undefined || props.open">
            <DropdownMenuContent
                position="popper"
                :reference="unscaledAnchor"
                :align="props.align"
                :side="props.side"
                :side-offset="props.sideOffset"
                :avoid-collisions="true"
                :collision-padding="8"
                :class="[popoverClasses, resolvedMenuClass]"
                v-bind="props.contentProps"
            >
                <!-- 滚动视口（自适应双向渐隐 + 隐藏原生滚动条） -->
                <div
                    :ref="setViewportRef"
                    class="clean-dropdown-viewport w-full"
                    :class="[viewportClasses, isScrollable ? 'pr-1.5' : '']"
                    :style="viewportStyle"
                    @scroll="handleViewportScroll"

                >
                    <MenuNodes
                        :items="props.items"
                        :active="cascade.levels.value[0]?.value"
                        :item-class="itemClassList"
                        @select="handleSelect"
                        @hover="(item, trigger, immediate) => scheduleSubmenu(item, trigger, 0, immediate)"
                    >
                        <template #item="slotProps"><slot name="item" v-bind="slotProps" /></template>
                        <template #item-right="slotProps"><slot name="item-right" v-bind="slotProps" /></template>
                    </MenuNodes>
                </div>

                <!-- 100% 绝对可见、100% 鼠标完全可按住拖拽的 macOS 4px 悬浮胶囊滑块 -->
                <div
                    v-if="isScrollable"
                    class="absolute right-[3px] top-1.5 bottom-1.5 w-1 z-20 flex flex-col justify-start"
                >
                    <div
                        class="w-1 rounded-full cursor-pointer transition-colors"
                        :class="isDragging ? 'bg-[color-mix(in_srgb,var(--text-main)_75%,transparent)]' : 'bg-[color-mix(in_srgb,var(--text-main)_45%,transparent)] hover:bg-[color-mix(in_srgb,var(--text-main)_70%,transparent)]'"
                        :style="{
                            height: `${scrollThumbHeight}px`,
                            transform: `translateY(${scrollThumbTop}px)`,
                        }"
                        @mousedown="handleThumbMouseDown"
                    ></div>
                </div>
            </DropdownMenuContent>
            <div
                v-for="(level, depth) in cascade.levels.value"
                :key="depth"
                :ref="(element) => cascade.setPanel(depth, element)"
                role="menu"
                class="nb-ui-popover-surface nb-ui-menu-surface nb-menu-level fixed overflow-hidden p-1.5"
                :data-switching="level.switching"
                :style="level.style"
            >
                <div class="nb-menu-level-content">
                    <MenuNodes :items="level.value.children ?? []" :active="cascade.levels.value[depth + 1]?.value" :item-class="itemClassList" @select="handleSelect" @hover="(item, trigger, immediate) => scheduleSubmenu(item, trigger, depth + 1, immediate)" />
                </div>
            </div>
        </DropdownMenuPortal>
    </DropdownMenuRoot>
</template>

<style scoped>
.clean-dropdown-viewport {
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: none;
    -ms-overflow-style: none;
}
.clean-dropdown-viewport::-webkit-scrollbar {
    display: none;
}
</style>
