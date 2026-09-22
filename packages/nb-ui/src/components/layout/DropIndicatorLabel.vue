<script setup lang="ts">
defineProps<{label: string; iconClass?: string}>();
</script>

<template>
    <span v-if="label.trim().length > 0" class="nb-ui-drop-indicator-label" data-drop-indicator-label aria-hidden="true">
        <span v-if="iconClass" class="nb-ui-drop-indicator-label__icon" :class="iconClass" aria-hidden="true" />
        <span class="nb-ui-drop-indicator-label__text">{{ label }}</span>
    </span>
</template>
