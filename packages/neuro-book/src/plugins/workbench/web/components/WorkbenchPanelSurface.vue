<script setup lang="ts">
/** 面板的外观（同名 .md）：标题头与框架按钮、内容区；按钮只发 `action`，命令由宿主执行。 */
import {IconButton} from "@notnotype/nb-ui/components";

export interface PanelFrameAction {
    readonly id: string;
    readonly label: string;
    readonly icon: string;
    readonly disabled: boolean;
    readonly reason?: string;
    readonly pressed?: boolean;
}

defineOptions({name: "WorkbenchPanelSurface"});

withDefaults(defineProps<{
    title: string;
    collapsed?: boolean;
    actions?: ReadonlyArray<PanelFrameAction>;
}>(), {collapsed: false, actions: () => []});

const emit = defineEmits<{
    (event: "action", id: string): void;
}>();

defineSlots<{
    default?(): unknown;
}>();
</script>

<template>
    <section class="workbench-panel-surface" :aria-label="title" :data-panel-collapsed="collapsed ? 'true' : 'false'">
        <header class="workbench-panel-surface__head">
            <h2 class="workbench-panel-surface__title" tabindex="-1" data-shell-focus-target="panel-title">{{ title }}</h2>
            <div class="workbench-panel-surface__actions">
                <IconButton
                    v-for="action in actions"
                    :key="action.id"
                    size="sm"
                    :icon-class="action.icon"
                    :aria-label="action.label"
                    :title="action.disabled && action.reason !== undefined ? action.reason : action.label"
                    :disabled="action.disabled"
                    :aria-pressed="action.pressed"
                    :data-panel-action="action.id"
                    @click="emit('action', action.id)"
                />
            </div>
        </header>
        <div v-show="!collapsed" class="workbench-panel-surface__content">
            <slot></slot>
        </div>
    </section>
</template>

<style scoped>
.workbench-panel-surface {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--panel-surface);
}

/* 标题头固定 32px：外壳把收起的面板叶压到同一高度。 */
.workbench-panel-surface__head {
    display: flex;
    flex: 0 0 32px;
    align-items: center;
    gap: var(--space-2);
    height: 32px;
    padding-inline: var(--space-3) var(--space-1);
    border-bottom: var(--border-w) solid var(--divider);
}

.workbench-panel-surface__title {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    color: var(--text-secondary);
    font-size: var(--text-xs);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* 标题是可编程聚焦的落点（最大化时外壳把焦点交给它），不是交互控件，不画焦点环。 */
.workbench-panel-surface__title:focus {
    outline: none;
}

.workbench-panel-surface__actions {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: var(--space-1);
}

.workbench-panel-surface__content {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
}
</style>
