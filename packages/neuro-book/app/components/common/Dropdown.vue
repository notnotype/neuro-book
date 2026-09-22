<script setup lang="ts">
import {Dropdown as NbDropdown, type DropdownItem as NbDropdownItem} from "@notnotype/nb-ui/components";

/**
 * 历史通用下拉菜单原地代理桥接（common/Dropdown.vue -> @notnotype/nb-ui Dropdown）。
 *
 * 彻底废除手写绝对定位与老旧 shadow-xl，全面对齐 Reka UI 原语、
 * 黄金 4 阶微反光立体柔影与 N.5 齐腰截半露底视口高度。
 */

export type DropdownItem = NbDropdownItem;

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
}>(), {
    menuClass: "",
    menuMaxHeight: undefined,
    rootClass: "",
    compact: false,
    align: "start",
    side: "bottom",
    sideOffset: 7,
    disabled: false,
});

const emit = defineEmits<{
    (e: "select", value: string): void;
    (e: "focus", event: FocusEvent): void;
}>();
</script>

<template>
    <NbDropdown
        :items="props.items"
        :menu-class="props.menuClass"
        :menu-max-height="props.menuMaxHeight"
        :root-class="props.rootClass"
        :compact="props.compact"
        :align="props.align"
        :side="props.side"
        :side-offset="props.sideOffset"
        :disabled="props.disabled"
        @select="emit('select', $event)"
        @focus="emit('focus', $event)"
    >
        <slot />
    </NbDropdown>
</template>

