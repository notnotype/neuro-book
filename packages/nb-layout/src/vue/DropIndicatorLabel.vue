<script setup lang="ts">
defineProps<{label: string; iconClass?: string}>();
</script>

<template>
    <span v-if="label.trim().length > 0" class="nb-layout-drop-indicator-label" data-drop-indicator-label aria-hidden="true">
        <slot name="icon"><span v-if="iconClass" class="nb-layout-drop-indicator-label__icon" :class="iconClass" aria-hidden="true" /></slot>
        <span class="nb-layout-drop-indicator-label__text">{{ label }}</span>
    </span>
</template>

<style>
.nb-layout-drop-indicator-label {
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    max-width: 100%;
    padding: 4px 12px;
    border: 1px solid color-mix(in srgb, var(--nb-layout-accent-main, Highlight) 40%, transparent);
    border-radius: var(--nb-layout-radius-pill, 999px);
    background: color-mix(in srgb, var(--nb-layout-panel-surface, Canvas) 90%, transparent);
    color: var(--nb-layout-accent-text, LinkText);
    font-family: var(--nb-layout-font-ui, system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif);
    font-size: var(--nb-layout-text-xs, 12px);
    font-weight: var(--nb-layout-weight-medium, 500);
    line-height: var(--nb-layout-leading-tight, 1.3);
    box-shadow: var(--nb-layout-elevation-raised, none);
    pointer-events: none;
    user-select: none;
    -webkit-backdrop-filter: var(--nb-layout-overlay-blur, none);
    backdrop-filter: var(--nb-layout-overlay-blur, none);
}

.nb-layout-drop-indicator-label__icon {
    flex: none;
    width: 14px;
    height: 14px;
}

.nb-layout-drop-indicator-label__text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

@media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
    .nb-layout-drop-indicator-label {
        background: var(--nb-layout-panel-surface, Canvas);
        -webkit-backdrop-filter: none;
        backdrop-filter: none;
    }
}
</style>
