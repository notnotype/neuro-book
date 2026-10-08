<script setup lang="ts">
/** 视图外框（同名 .md）：multiple 的标题行与收起；内容由宿主搬进默认插槽，不在这里创建，滚动也归内容。 */
import {IconButton} from "@notnotype/nb-ui/components";

defineOptions({name: "WorkbenchViewSection"});

defineProps<{
    viewId: string;
    title: string;
    icon: string;
    axis: "vertical" | "horizontal";
    chrome: boolean;
    collapsed: boolean;
    collapseLabel: string;
    expandLabel: string;
}>();

const emit = defineEmits<{
    (event: "toggle-collapsed", collapsed: boolean): void;
}>();

defineSlots<{
    actions?(): unknown;
    default?(): unknown;
}>();
</script>

<template>
    <section
        class="workbench-view-section"
        :class="[`workbench-view-section--${axis}`, {'workbench-view-section--collapsed': chrome && collapsed}]"
        role="region"
        :aria-label="title"
        :data-view-section="viewId"
        :data-view-collapsed="chrome && collapsed ? 'true' : 'false'"
    >
        <header v-if="chrome" class="workbench-view-section__head">
            <IconButton
                size="sm"
                :icon-class="collapsed ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'"
                :aria-label="collapsed ? expandLabel : collapseLabel"
                :title="collapsed ? expandLabel : collapseLabel"
                :aria-expanded="!collapsed"
                data-view-toggle
                @click="emit('toggle-collapsed', !collapsed)"
            />
            <span class="workbench-view-section__icon" :class="icon" aria-hidden="true"></span>
            <h3 class="workbench-view-section__title">{{ title }}</h3>
            <div v-if="!collapsed" class="workbench-view-section__actions">
                <slot name="actions"></slot>
            </div>
        </header>
        <div v-show="!(chrome && collapsed)" class="workbench-view-section__body">
            <slot></slot>
        </div>
    </section>
</template>

<style scoped>
.workbench-view-section {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
}

.workbench-view-section__head {
    display: flex;
    flex: 0 0 32px;
    align-items: center;
    gap: var(--space-1);
    height: 32px;
    min-width: 0;
    padding-inline: var(--space-1);
    border-bottom: var(--border-w) solid var(--divider);
}

.workbench-view-section__icon {
    flex: 0 0 auto;
    width: 14px;
    height: 14px;
    color: var(--text-muted);
}

.workbench-view-section__title {
    flex: 1 1 auto;
    min-width: 0;
    margin: 0;
    overflow: hidden;
    color: var(--text-secondary);
    font-size: var(--text-xs);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.workbench-view-section__actions {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: var(--space-1);
}

.workbench-view-section__body {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
}

/* 横向容器收起成 32px 竖条：标题行转成竖排，展开按钮在顶部。 */
.workbench-view-section--horizontal.workbench-view-section--collapsed .workbench-view-section__head {
    flex: 1 1 auto;
    flex-direction: column;
    width: 32px;
    height: 100%;
    padding-block: var(--space-1);
    padding-inline: 0;
    border-bottom: 0;
}

.workbench-view-section--horizontal.workbench-view-section--collapsed .workbench-view-section__title {
    flex: 0 1 auto;
    writing-mode: vertical-rl;
}
</style>
