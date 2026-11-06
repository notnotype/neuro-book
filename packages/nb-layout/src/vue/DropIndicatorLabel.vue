<script setup lang="ts">
defineProps<{label: string; iconClass?: string}>();
</script>

<template>
    <span v-if="label.trim().length > 0" class="nb-ui-drop-indicator-label" data-drop-indicator-label aria-hidden="true">
        <span v-if="iconClass" class="nb-ui-drop-indicator-label__icon" :class="iconClass" aria-hidden="true" />
        <span class="nb-ui-drop-indicator-label__text">{{ label }}</span>
    </span>
</template>

<style>
.nb-ui-drop-indicator-label {
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    max-width: 100%;
    padding: 4px 12px;
    border: 1px solid color-mix(in srgb, var(--accent-main) 40%, transparent);
    border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--panel-surface) 90%, transparent);
    color: var(--accent-text);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    line-height: var(--leading-tight);
    box-shadow: var(--elevation-raised);
    pointer-events: none;
    user-select: none;
    -webkit-backdrop-filter: var(--overlay-blur);
    backdrop-filter: var(--overlay-blur);
}

.nb-ui-drop-indicator-label__icon {
    flex: none;
    width: 14px;
    height: 14px;
}

.nb-ui-drop-indicator-label__text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

@media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
    .nb-ui-drop-indicator-label {
        background: var(--panel-surface);
        -webkit-backdrop-filter: none;
        backdrop-filter: none;
    }
}
</style>
