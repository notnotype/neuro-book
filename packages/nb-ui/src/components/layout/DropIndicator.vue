<script lang="ts">
export type DropIndicatorVariant = "area" | "entry" | "line";
</script>

<script setup lang="ts">
defineProps<{variant: DropIndicatorVariant}>();
defineSlots<{default(): unknown}>();
</script>

<template>
    <div class="nb-ui-drop-indicator" :data-drop-indicator="variant" aria-hidden="true">
        <slot />
    </div>
</template>
