<script setup lang="ts">
/**
 * 桌面标题栏品牌模块：羽毛图标与应用名称。
 *
 * 属于自绘标题栏的左侧拖拽面，支持 -webkit-app-region: drag。
 */
defineProps<{
    /** 自定义品牌名，默认 "NeuroBook" */
    brandName?: string;
}>();
</script>

<template>
    <div
        class="desktop-title-bar__brand desktop-title-bar__drag-surface"
        data-tauri-drag-region
        role="presentation"
    >
        <span class="i-lucide-feather h-3.5 w-3.5 shrink-0 text-[var(--accent-main)]" aria-hidden="true"></span>
        <span class="desktop-title-bar__brand-label">{{ brandName || "NeuroBook" }}</span>
    </div>
</template>

<style scoped>
.desktop-title-bar__brand {
    display: flex;
    height: 100%;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-2);
    color: var(--text-main);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    user-select: none;
    cursor: default;
    flex-shrink: 0;
    flex-wrap: nowrap;
    white-space: nowrap;
}

.desktop-title-bar__drag-surface {
    -webkit-app-region: drag;
}

.desktop-title-bar__brand-label {
    letter-spacing: -0.01em;
    white-space: nowrap;
}
</style>
