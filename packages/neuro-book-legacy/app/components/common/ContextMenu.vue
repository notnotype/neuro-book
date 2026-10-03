<script lang="ts">
export interface ContextMenuItem {
    label?: string;
    iconClass?: string;
    shortcut?: string;
    action?: () => void;
    children?: ContextMenuItem[];
    disabled?: boolean;
    danger?: boolean;
    tone?: "default" | "danger";
    separator?: boolean;
}
</script>

<script setup lang="ts">
import {computed} from "vue";
import {THEME_HOST_SELECTOR} from "nbook/app/utils/theme/host";
import {ContextMenu as NbContextMenu, type ContextMenuItem as NbContextMenuItem} from "@notnotype/nb-ui/components";

/**
 * 历史右键菜单原地代理桥接（common/ContextMenu.vue -> @notnotype/nb-ui ContextMenu）。
 *
 * 保持原有 ContextMenuItem 类型与 danger 标志兼容，
 * 底层接入标准 4 阶微反光立体柔影、130% 纯净滤波与视口边界收敛计算。
 */

const props = defineProps<{
    visible: boolean;
    x: number;
    y: number;
    items: ContextMenuItem[];
}>();

const emit = defineEmits<{
    (e: "close"): void;
}>();
function mapItem(item: ContextMenuItem): NbContextMenuItem {
    return {
        label: item.label,
        iconClass: item.iconClass,
        shortcut: item.shortcut,
        action: item.action,
        disabled: item.disabled,
        separator: item.separator,
        tone: item.tone ?? (item.danger ? "danger" : "default"),
        children: item.children ? item.children.map(mapItem) : undefined,
    };
}

const mappedItems = computed<NbContextMenuItem[]>(() => props.items.map(mapItem));

const teleportTarget = computed(() => {
    if (typeof document !== "undefined" && document.querySelector(THEME_HOST_SELECTOR)) {
        return THEME_HOST_SELECTOR;
    }
    return "body";
});
</script>

<template>
    <NbContextMenu
        :visible="props.visible"
        :x="props.x"
        :y="props.y"
        :items="mappedItems"
        :teleport-target="teleportTarget"
        @close="emit('close')"
    />
</template>

