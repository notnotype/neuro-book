<script setup lang="ts">
import {inject} from "vue";
import {
    MenubarCheckboxItem,
    MenubarContent,
    MenubarItem,
    MenubarItemIndicator,
    MenubarMenu,
    MenubarPortal,
    MenubarRadioGroup,
    MenubarRadioItem,
    MenubarRoot,
    MenubarSeparator,
    MenubarSub,
    MenubarSubContent,
    MenubarSubTrigger,
    MenubarTrigger,
} from "reka-ui";
import {NB_POPOVER_Z_INDEX, NB_Z_INDEX} from "../../theme/z-index";

/** 窗口内的浮层跟随窗口层级（由 DialogWindow 注入）；未被窗口承载时回退到普通页面层级。 */
const popoverZIndex = inject(NB_POPOVER_Z_INDEX, NB_Z_INDEX.popover);


export interface MenubarItemData {
    label: string;
    value: string;
    shortcut?: string;
    iconClass?: string;
    disabled?: boolean;
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
}>(), {
    menus: () => [],
    size: "md",
    modelValue: undefined,
});

const emit = defineEmits<{
    (e: "select", item: MenubarItemData): void;
    (e: "update:modelValue", value: string): void;
}>();

function handleItemClick(item: MenubarItemData): void {
    if (item.disabled || item.separator) return;
    emit("select", item);
    emit("update:modelValue", item.value);
}
</script>

<template>
    <MenubarRoot
        :model-value="props.modelValue"
        class="inline-flex items-center gap-0.5 rounded-[var(--radius-control)] border border-[color-mix(in_srgb,var(--border-color)_70%,transparent)] bg-[color-mix(in_srgb,var(--bg-panel)_85%,transparent)] p-1 backdrop-blur-md shadow-sm select-none"
        :class="props.size === 'sm' ? 'h-[30px]' : 'h-[36px]'"
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
                    :style="{
                        zIndex: popoverZIndex,
                        backgroundColor: 'color-mix(in srgb, var(--bg-panel) 85%, transparent)',
                        backdropFilter: 'blur(16px) saturate(130%) brightness(1.0)',
                        WebkitBackdropFilter: 'blur(16px) saturate(130%) brightness(1.0)',
                        boxShadow: '0 0 0 1px color-mix(in srgb, var(--text-main) 8%, transparent), 0 8px 24px -4px color-mix(in srgb, var(--shadow-color) 24%, transparent)',
                    }"
                    class="nb-ui-popover-surface nb-ui-menu-surface nb-ui-popover-motion min-w-[200px] rounded-[var(--radius-panel)] p-1 text-[var(--text-main)] outline-none select-none"
                    @close-auto-focus="(e) => e.preventDefault()"
                >
                    <template v-for="item in menu.items" :key="item.value">
                        <!-- 分隔线 -->
                        <MenubarSeparator
                            v-if="item.separator"
                            class="my-1 h-[1px] bg-[var(--divider)]"
                        />

                        <!-- 子菜单 -->
                        <MenubarSub v-else-if="item.children && item.children.length > 0">
                            <MenubarSubTrigger
                                :disabled="item.disabled"
                                class="nb-ui-popover-item flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-xs text-[var(--text-main)] transition-colors [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:bg-[color-mix(in_srgb,var(--text-main)_10%,transparent)] data-[state=open]:bg-[color-mix(in_srgb,var(--text-main)_10%,transparent)] cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                <div class="flex items-center gap-2">
                                    <span v-if="item.iconClass" :class="[item.iconClass, 'h-4 w-4']" aria-hidden="true" />
                                    <span>{{ item.label }}</span>
                                </div>
                                <span class="i-lucide-chevron-right h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />
                            </MenubarSubTrigger>

                            <MenubarPortal>
                                <MenubarSubContent
                                    :side-offset="4"
                                    :style="{
                                        zIndex: popoverZIndex + 1,
                                        backgroundColor: 'color-mix(in srgb, var(--bg-panel) 85%, transparent)',
                                        backdropFilter: 'blur(16px) saturate(130%) brightness(1.0)',
                                        WebkitBackdropFilter: 'blur(16px) saturate(130%) brightness(1.0)',
                                        boxShadow: '0 0 0 1px color-mix(in srgb, var(--text-main) 8%, transparent), 0 8px 24px -4px color-mix(in srgb, var(--shadow-color) 24%, transparent)',
                                    }"
                                    class="nb-ui-popover-surface nb-ui-menu-surface nb-ui-popover-motion min-w-[180px] rounded-[var(--radius-panel)] p-1 text-[var(--text-main)] outline-none select-none"
                                >
                                    <template v-for="child in item.children" :key="child.value">
                                        <MenubarSeparator v-if="child.separator" class="my-1 h-[1px] bg-[var(--divider)]" />
                                        <MenubarItem
                                            v-else
                                            :disabled="child.disabled"
                                            class="nb-ui-popover-item flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs text-[var(--text-main)] transition-colors [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:bg-[color-mix(in_srgb,var(--text-main)_10%,transparent)] cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                                            :class="child.tone === 'danger' ? 'text-[var(--status-danger)] hover:bg-[color-mix(in_srgb,var(--status-danger)_12%,transparent)]' : ''"
                                            @click="handleItemClick(child)"
                                        >
                                            <div class="flex items-center gap-2">
                                                <span v-if="child.iconClass" :class="[child.iconClass, 'h-4 w-4']" aria-hidden="true" />
                                                <span>{{ child.label }}</span>
                                            </div>
                                            <span v-if="child.shortcut" class="font-mono text-[10px] text-[var(--text-muted)]">{{ child.shortcut }}</span>
                                        </MenubarItem>
                                    </template>
                                </MenubarSubContent>
                            </MenubarPortal>
                        </MenubarSub>

                        <!-- 普通菜单项 -->
                        <MenubarItem
                            v-else
                            :disabled="item.disabled"
                            class="nb-ui-popover-item flex items-center justify-between gap-3 px-2.5 py-1.5 text-xs text-[var(--text-main)] transition-colors [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:bg-[color-mix(in_srgb,var(--text-main)_10%,transparent)] cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                            :class="item.tone === 'danger' ? 'text-[var(--status-danger)] hover:bg-[color-mix(in_srgb,var(--status-danger)_12%,transparent)]' : ''"
                            @click="handleItemClick(item)"
                        >
                            <div class="flex items-center gap-2">
                                <span v-if="item.iconClass" :class="[item.iconClass, 'h-4 w-4']" aria-hidden="true" />
                                <span>{{ item.label }}</span>
                            </div>
                            <span v-if="item.shortcut" class="font-mono text-[10px] text-[var(--text-muted)]">{{ item.shortcut }}</span>
                        </MenubarItem>
                    </template>
                </MenubarContent>
            </MenubarPortal>
        </MenubarMenu>
    </MenubarRoot>
</template>
