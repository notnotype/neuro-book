<script setup lang="ts">
/** 活动栏（同名 .md）：Sidebar 的容器切换按钮；点了只发 `select`，切换与打开 Sidebar 由宿主做。 */
import {IconButton, Tooltip} from "@notnotype/nb-ui/components";

export interface ActivityContainer {
    readonly id: string;
    readonly label: string;
    readonly icon: string;
}

defineOptions({name: "WorkbenchActivityBar"});

defineProps<{
    label: string;
    containers: ReadonlyArray<ActivityContainer>;
    selected: string | null;
    sidebarVisible: boolean;
    /** 条目作为拖动源的说明（写到 `aria-description`），例如“按空格拿起并拖动”。 */
    dragHint: string;
}>();

const emit = defineEmits<{
    (event: "select", id: string): void;
}>();
</script>

<template>
    <nav class="workbench-activity-bar" :aria-label="label">
        <div class="workbench-activity-bar__containers" data-switcher-band="sidebar">
            <Tooltip v-for="container in containers" :key="container.id" :text="container.label" placement="right">
                <IconButton
                    :icon-class="container.icon"
                    :aria-label="container.label"
                    :aria-pressed="sidebarVisible && container.id === selected"
                    :data-activity-container="container.id"
                    :data-switcher-entry="container.id"
                    :data-drag-container="container.id"
                    :aria-description="dragHint"
                    class="workbench-activity-bar__item"
                    :class="{'workbench-activity-bar__item--active': sidebarVisible && container.id === selected}"
                    @click="emit('select', container.id)"
                />
            </Tooltip>
        </div>
        <div class="workbench-activity-bar__footer"></div>
    </nav>
</template>

<style scoped>
/* 卡片四周的留白归外壳（叶的内边距），这里只画卡片本身。 */
.workbench-activity-bar {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    height: 100%;
    min-height: 0;
    padding-block: var(--space-1);
    background: var(--panel-surface);
    border: var(--border-w) solid var(--panel-outline);
    border-radius: var(--radius-panel);
}

.workbench-activity-bar__containers {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    width: 100%;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: none;
}

.workbench-activity-bar__footer {
    display: flex;
    flex: 0 0 auto;
    flex-direction: column;
    align-items: center;
}

/* IconButton 的默认尺寸是控件档；活动栏固定 40px 见方。 */
.workbench-activity-bar .workbench-activity-bar__item {
    flex: 0 0 auto;
    width: 40px;
    height: 40px;
    border-radius: var(--radius-control);
    color: var(--text-muted);
    /* 活动条目也是整容器的拖动源：触摸按住起拖。 */
    touch-action: none;
}

.workbench-activity-bar .workbench-activity-bar__item:hover {
    background: var(--bg-hover);
    color: var(--text-main);
}

.workbench-activity-bar .workbench-activity-bar__item--active {
    background: var(--bg-hover);
    color: var(--accent-text);
}
</style>
