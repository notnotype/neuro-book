<script setup lang="ts">
import {inject} from "vue";
import {MenubarContent, MenubarItem, MenubarMenu, MenubarPortal, MenubarRoot, MenubarTrigger} from "reka-ui";
import MenuNodes from "./MenuNodes.vue";
import {useMenuCascade} from "../../composables/useMenuCascade";
import {NB_POPOVER_Z_INDEX, NB_Z_INDEX} from "../../theme/z-index";

/** 窗口内的浮层跟随窗口层级（由 DialogWindow 注入）；未被窗口承载时回退到普通页面层级。 */
const popoverZIndex = inject(NB_POPOVER_Z_INDEX, NB_Z_INDEX.popover);


export interface MenubarItemData {
    label: string;
    value: string;
    shortcut?: string;
    iconClass?: string;
    disabled?: boolean;
    /** 提示与读屏描述（例如禁用原因）；默认不显示。 */
    title?: string;
    tone?: "default" | "danger";
    separator?: boolean;
    checked?: boolean;
    type?: "default" | "checkbox" | "radio";
    children?: MenubarItemData[];
}

export interface MenubarMenuData {
    id: string;
    label: string;
    disabled?: boolean;
    items: MenubarItemData[];
}

const props = withDefaults(defineProps<{
    menus?: MenubarMenuData[];
    size?: "sm" | "md";
    modelValue?: string;
    /** floating：自带外框与模糊的独立菜单条；flat：嵌进标题栏这类已有面的位置，不画外框与模糊。 */
    variant?: "floating" | "flat";
}>(), {
    menus: () => [],
    size: "md",
    modelValue: undefined,
    variant: "floating",
});

const emit = defineEmits<{
    (e: "select", item: MenubarItemData): void;
    (e: "update:modelValue", value: string): void;
}>();

function handleItemClick(item: MenubarItemData): void {
    if (item.disabled || item.separator) return;
    emit("select", item);
}

/**
 * 打开的顶层菜单变了：转发给宿主（v-model），全部关闭时收起级联面板。reka 的 `MenubarRoot` 把这个事件的类型声明成
 * `boolean`，实际发出的是菜单 id 字符串（关闭时为空串），所以按 unknown 收下再收窄。
 */
function handleOpenMenu(value: unknown): void {
    const open = typeof value === "string" ? value : "";
    if (open === "") cascade.reset();
    emit("update:modelValue", open);
}
const cascade = useMenuCascade<MenubarItemData>();
function scheduleLevel(item: MenubarItemData | null, trigger: HTMLElement, depth: number, immediate = false): void {
    cascade.schedule(item, trigger, depth, immediate, Boolean(item?.children?.length));
}
</script>

<template>
    <MenubarRoot
        :model-value="props.modelValue"
        class="inline-flex items-center gap-0.5 select-none"
        :class="[props.size === 'sm' ? 'h-[30px]' : 'h-[36px]', props.variant === 'floating' ? 'rounded-[var(--radius-control)] border border-[color-mix(in_srgb,var(--border-color)_70%,transparent)] bg-[color-mix(in_srgb,var(--bg-panel)_85%,transparent)] p-1 backdrop-blur-md shadow-sm' : '']"
        @update:model-value="handleOpenMenu"
    >
        <MenubarMenu
            v-for="menu in props.menus"
            :key="menu.id"
            :value="menu.id"
        >
            <MenubarTrigger
                :disabled="menu.disabled"
                class="nb-ui-focus-ring flex items-center justify-center rounded-[calc(var(--radius-control)*0.75)] font-medium text-[var(--text-main)] transition-colors [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:bg-[color-mix(in_srgb,var(--text-main)_10%,transparent)] data-[state=open]:bg-[color-mix(in_srgb,var(--text-main)_14%,transparent)] cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                :class="props.size === 'sm' ? 'px-2 py-0.5 text-[12px]' : 'px-2.5 py-1 text-[13px]'"
            >
                {{ menu.label }}
            </MenubarTrigger>

            <MenubarPortal>
                <MenubarContent
                    :side-offset="6"
                    :align-offset="-4"
                    :style="{zIndex: popoverZIndex}"
                    class="nb-ui-popover-surface nb-ui-menu-surface nb-ui-popover-motion min-w-[200px] p-1.5 text-[var(--text-main)] outline-none select-none"
                >
                    <MenuNodes :items="menu.items" :active="cascade.levels.value[0]?.value" :item-component="MenubarItem" @select="handleItemClick" @hover="(item, trigger, immediate) => scheduleLevel(item, trigger, 0, immediate)" />
                </MenubarContent>
            </MenubarPortal>
        </MenubarMenu>
        <div
            v-for="(level, depth) in cascade.levels.value"
            :key="depth"
            :ref="(element) => cascade.setPanel(depth, element)"
            role="menu"
            class="nb-ui-popover-surface nb-ui-menu-surface nb-menu-level fixed overflow-hidden p-1.5"
            :data-switching="level.switching"
            :style="{...level.style, zIndex: popoverZIndex + depth + 1}"
        >
            <div class="nb-menu-level-content">
                <MenuNodes :items="level.value.children ?? []" :active="cascade.levels.value[depth + 1]?.value" @select="handleItemClick" @hover="(item, trigger, immediate) => scheduleLevel(item, trigger, depth + 1, immediate)" />
            </div>
        </div>
    </MenubarRoot>
</template>
