<script setup lang="ts">
/**
 * 状态栏部件：工作台最底部的极窄状态信息条。
 *
 * 规范与契约：
 * - 单根 <footer>，role="status"，aria-label="状态栏"；
 * - 极窄高度契约：token 表达，约 22px：calc(var(--space-7) - var(--space-1))；
 * - 底取 --panel-surface，顶部分界线取 --divider，描边底线取 --panel-outline，文字取 --text-secondary；
 * - 具名插槽：`left`（左侧项组：分支、同步、错误/警告计数等）、`right`（右侧项组：编码、行号、通知等）以及默认插槽；
 * - 不拥有任何持久化状态或业务逻辑。
 */
import WorkbenchStatusBarItem from "./WorkbenchStatusBarItem.vue";

const props = withDefaults(defineProps<{
    /** 无障碍名称 */
    ariaLabel?: string;
}>(), {
    ariaLabel: "状态栏",
});

defineSlots<{
    /** 状态栏左侧分组项 */
    left?(): unknown;
    /** 状态栏右侧分组项 */
    right?(): unknown;
    /** 默认插槽（直接平铺内容） */
    default?(): unknown;
}>();
</script>

<template>
    <footer
        class="workbench-status-bar"
        role="status"
        :aria-label="ariaLabel"
        data-workbench-status-bar
    >
        <div class="workbench-status-bar__left">
            <slot name="left"><slot></slot></slot>
        </div>

        <div v-if="$slots.right" class="workbench-status-bar__right">
            <slot name="right"></slot>
        </div>
    </footer>
</template>

<style scoped>
/*
 * 状态栏：极窄条 chrome（约 22px）
 * 高度取 calc(var(--space-7) - var(--space-1))（24px - 2px = 22px）。
 * 底取 --panel-surface，分界线取 --divider，描边取 --panel-outline，文字取 --text-secondary。
 */
.workbench-status-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    min-width: 0;
    height: calc(var(--space-7) - var(--space-1));
    min-height: calc(var(--space-7) - var(--space-1));
    max-height: calc(var(--space-7) - var(--space-1));
    padding-inline: var(--space-2);
    box-sizing: border-box;
    overflow: hidden;
    user-select: none;
    background: var(--panel-surface);
    border-top: var(--border-w) solid var(--divider);
    border-bottom: var(--border-w) solid var(--panel-outline);
    color: var(--text-secondary);
    font-size: var(--text-2xs);
    line-height: 1;
}

/* 左侧项组：横向排列，允许子项紧凑收缩，内容溢出时隐去，不造成整栏换行 */
.workbench-status-bar__left {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    gap: var(--space-1);
    height: 100%;
    min-width: 0;
    overflow: hidden;
}

/* 右侧项组：贴右排列，紧凑且不换行 */
.workbench-status-bar__right {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: var(--space-1);
    height: 100%;
    margin-left: auto;
}
</style>
