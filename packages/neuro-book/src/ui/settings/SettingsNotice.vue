<script setup lang="ts">
/** 设置页一行里的问题提示（同名 .md）：不占新的一行，有没有它下面的内容都不动。 */
withDefaults(defineProps<{
    tone?: "warning" | "danger";
    as?: "p" | "button";
    /** 静态文字要能聚焦：外面包的 `Tooltip` 用键盘也能打开。 */
    focusable?: boolean;
}>(), {tone: "warning", as: "p", focusable: false});

defineEmits<{(event: "click", value: MouseEvent): void}>();
</script>

<template>
    <component
        :is="as"
        :type="as === 'button' ? 'button' : undefined"
        :tabindex="focusable ? 0 : undefined"
        class="settings-notice"
        :class="[`settings-notice--${tone}`, {'settings-notice--button nb-ui-focus-ring': as === 'button'}]"
        @click="$emit('click', $event)"
    >
        <span :class="tone === 'danger' ? 'i-lucide-circle-alert' : 'i-lucide-triangle-alert'" class="settings-notice__icon" aria-hidden="true"></span>
        <span class="settings-notice__text"><slot /></span>
        <slot name="action" />
    </component>
</template>

<style scoped>
.settings-notice {
    display: inline-flex;
    min-width: 0;
    height: var(--control-h-sm);
    box-sizing: border-box;
    align-items: center;
    gap: var(--space-3);
    margin: 0;
    padding: 0 var(--space-5);
    border: var(--border-w) solid color-mix(in srgb, var(--settings-notice-color) 35%, transparent);
    border-radius: var(--radius-control);
    background: color-mix(in srgb, var(--settings-notice-color) 10%, transparent);
    color: var(--text-main);
    font: inherit;
    font-size: var(--text-sm);
    white-space: nowrap;
    outline: none;
}

.settings-notice--warning {
    --settings-notice-color: var(--status-warning);
}

.settings-notice--danger {
    --settings-notice-color: var(--status-danger);
}

.settings-notice--button {
    padding-right: var(--space-3);
    cursor: pointer;
}

.settings-notice__icon {
    flex-shrink: 0;
    color: var(--settings-notice-color);
}

.settings-notice__text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
}
</style>
