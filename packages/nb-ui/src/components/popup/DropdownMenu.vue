<script setup lang="ts">
import {computed, mergeProps, ref} from "vue";
import {
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuPortal,
    DropdownMenuRoot,
    DropdownMenuTrigger,
} from "reka-ui";
import MenuLevelPanel from "./MenuLevelPanel.vue";
import MenuNodes from "./MenuNodes.vue";
import PopupScrollbar from "./PopupScrollbar.vue";
import {useMenuCascade} from "../../composables/useMenuCascade";
import {usePopoverLayer} from "../../composables/usePopoverLayer";
import {usePopupScroll} from "../../composables/usePopupScroll";
import {elementOf} from "../../utils/element-of";
import {toPopoverReference} from "./popover-anchor";
import type {DropdownMenuItemData} from "./dropdown-menu.types";
/**
 * 下拉菜单。浮层外观由 `.nb-ui-popover-surface` 与 `.nb-ui-menu-surface` 给出，滚动（截在第 9 项中间、悬浮滑块、
 * 顶底渐隐）由 `usePopupScroll` 给出；外框按 reka 给的可用高度夹紧，视口在里面收缩。
 *
 * 结构覆盖平面项、分隔线、任意层级子菜单与受控 radio / checkbox；
 * 一级菜单的键盘漫游（上下键、Home、End、首字母、跳过禁用项）与关闭后焦点归还由 Reka 菜单原语承担。级联面板是手工
 * 画的（在 Reka 的菜单内容之外，接不到它的菜单上下文）：键盘漫游、展开与收起由 `useMenuCascade` 处理，面板里的指针与焦点
 * 也不算“点了外部”，否则按下指针时菜单先关、点击落空。
 */

const props = withDefaults(defineProps<{
    items: DropdownMenuItemData[];
    menuClass?: string;
    rootClass?: string;
    align?: "start" | "center" | "end";
    side?: "top" | "right" | "bottom" | "left";
    sideOffset?: number;
    disabled?: boolean;
    popoverStyle?: Record<string, string | number>;
    /** 受控展开态：传了由宿主决定，不传由原语自管；两种用法都会发 update:open。 */
    open?: boolean;
    /** 浮层内容原生属性透传（用于 data-xxx 等属性） */
    contentProps?: Record<string, unknown>;
    /** 条目文字允许换行：菜单最宽 320px，长文字完整显示；缺省单行截断。 */
    wrap?: boolean;
}>(), {
    menuClass: undefined,
    rootClass: "",
    align: "start",
    side: "bottom",
    sideOffset: 7,
    disabled: false,
    // 显式 undefined 默认值：Boolean 档缺省会被 Vue 转成 false，那样就永远拿不到「未受控」这一档
    open: undefined,
    contentProps: () => ({}),
    wrap: false,
});

const emit = defineEmits<{
    (e: "select", value: string): void;
    (e: "focus", event: FocusEvent): void;
    (e: "update:open", value: boolean): void;
}>();

/** 非受控时由这里持有展开态：级联面板里选中一项后要能把整个菜单关掉（那不是 Reka 的菜单项，它不会自己关）。 */
const ownOpen = ref(false);
const isOpen = computed(() => props.open ?? ownOpen.value);

function handleOpenChange(value: boolean): void {
    if (!value) cascade.reset();
    ownOpen.value = value;
    emit("update:open", value);
}

/** 子菜单父项不走这里：它只展开子菜单，不执行自己的动作。 */
function handleSelect(item: DropdownMenuItemData): void {
    if (item.disabled) return;
    emit("select", item.value);
}

/** 级联面板里的选中：执行后关掉整个菜单，焦点由 Reka 还给触发器。 */
function handleCascadeSelect(item: DropdownMenuItemData): void {
    if (item.disabled) return;
    handleSelect(item);
    handleOpenChange(false);
}

/** 指针或焦点进了级联面板：在 Reka 看来是菜单内容之外，但它属于这个菜单。 */
function keepOpenForCascade(event: Event): void {
    if (cascade.contains((event as CustomEvent<{originalEvent?: Event}>).detail?.originalEvent?.target ?? event.target)) event.preventDefault();
}

const triggerRef = ref<HTMLElement | null>(null);
function setTriggerRef(element: unknown): void {
    triggerRef.value = elementOf(element);
}
const unscaledAnchor = computed(() => toPopoverReference(triggerRef.value));
const {zIndex} = usePopoverLayer();
const scroll = usePopupScroll();
const resolvedMenuClass = computed(() => [props.menuClass ?? "min-w-[160px]", props.wrap ? "max-w-[320px]" : ""]);


/** 一级菜单的条目直接放在滚动视口里；一级的键盘漫游归 reka。 */
const cascade = useMenuCascade<DropdownMenuItemData>({rootLevel: () => scroll.viewport.value, rootRoving: false});

function onMainScroll(): void {
    scroll.onScroll();
    cascade.collapseBelow(0);
}
function warnMissingRadioGroup(items: readonly DropdownMenuItemData[]): void {
    for (const item of items) {
        if (item.type === "radio" && item.group === undefined) console.warn(`[nb-ui/DropdownMenu] radio 项「${item.value}」缺少 group，已按单项独立成组渲染。`);
        if (item.children) warnMissingRadioGroup(item.children);
    }
}
warnMissingRadioGroup(props.items);
function scheduleSubmenu(item: DropdownMenuItemData | null, trigger: HTMLElement, depth = 0, immediate = false): void {
    cascade.schedule(item, trigger, depth, immediate, Boolean(item?.children?.length));
}

</script>

<template>
    <DropdownMenuRoot :modal="false" :open="isOpen" @update:open="handleOpenChange">
        <DropdownMenuTrigger :ref="setTriggerRef" as-child :disabled="props.disabled" :class="props.rootClass">
            <slot />
        </DropdownMenuTrigger>

        <DropdownMenuPortal v-if="props.open === undefined || props.open">
            <DropdownMenuContent
                :reference="unscaledAnchor"
                :align="props.align"
                :side="props.side"
                :side-offset="props.sideOffset"
                :avoid-collisions="true"
                :collision-padding="8"
                class="nb-ui-popover-surface nb-ui-menu-surface nb-ui-popover-motion relative flex max-h-[var(--reka-popper-available-height)] flex-col overflow-hidden"
                :class="resolvedMenuClass"
                :style="{zIndex, ...props.popoverStyle}"
                v-bind="mergeProps(props.contentProps, {onKeydownCapture: cascade.rootKeydown})"
                @interact-outside="keepOpenForCascade"
            >
                <div
                    :ref="scroll.setViewport"
                    class="nb-ui-popover-scroll w-full"
                    :class="scroll.fadeClass.value"
                    :style="scroll.viewportStyle.value"
                    @scroll="onMainScroll"
                >
                    <MenuNodes
                        :items="props.items"
                        :active="cascade.levels.value[0]?.value"
                        :item-component="DropdownMenuItem"
                        :wrap="props.wrap"
                        @select="handleSelect"
                        @hover="(item, trigger, immediate) => scheduleSubmenu(item, trigger, 0, immediate)"
                    >
                        <template #item="slotProps"><slot name="item" v-bind="slotProps" /></template>
                        <template #item-right="slotProps"><slot name="item-right" v-bind="slotProps" /></template>
                    </MenuNodes>
                </div>

                <PopupScrollbar :scroll="scroll" />
            </DropdownMenuContent>
            <MenuLevelPanel
                v-for="(level, depth) in cascade.levels.value"
                :key="depth"
                :ref="(element) => cascade.setPanel(depth, element)"
                :panel-style="{...level.style, zIndex: zIndex + depth + 1}"
                :switching="level.switching"
                :content-key="level.value"
                @keydown="(event: KeyboardEvent) => cascade.levelKeydown(depth, event)"
                @scroll="cascade.collapseBelow(depth + 1)"
            >
                <MenuNodes :items="level.value.children ?? []" :active="cascade.levels.value[depth + 1]?.value" :wrap="props.wrap" @select="handleCascadeSelect" @hover="(item, trigger, immediate) => scheduleSubmenu(item, trigger, depth + 1, immediate)" />
            </MenuLevelPanel>
        </DropdownMenuPortal>
    </DropdownMenuRoot>
</template>
