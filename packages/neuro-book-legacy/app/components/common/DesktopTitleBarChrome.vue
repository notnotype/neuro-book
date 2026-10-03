<script setup lang="ts">
/**
 * 保持向前兼容的转发入口：实现已迁移至 `app/components/desktop-title-bar/`。
 */
import DesktopTitleBarShell from "../desktop-title-bar/DesktopTitleBarShell.vue";
import type {
    DesktopTitleBarProps,
    DesktopTitleBarEmits,
    TitleBarWindowCommand,
    TitleBarProject,
} from "../desktop-title-bar/desktop-title-bar.types";

export type {TitleBarWindowCommand, TitleBarProject};

const props = defineProps<DesktopTitleBarProps>();
const emit = defineEmits<DesktopTitleBarEmits>();
</script>

<template>
    <DesktopTitleBarShell
        v-bind="props"
        @update:open-menu="emit('update:openMenu', $event)"
        @invoke-command="emit('invoke-command', $event)"
        @select-project="emit('select-project', $event)"
        @toggle-agent-panel="emit('toggle-agent-panel')"
        @window-command="emit('window-command', $event)"
        @open-command-palette="emit('open-command-palette')"
        @toggle-sidebar="emit('toggle-sidebar')"
        @toggle-bottom-panel="emit('toggle-bottom-panel')"
    />
</template>
