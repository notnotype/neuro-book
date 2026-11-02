<script lang="ts">
export type DropIndicatorVariant = "area" | "entry" | "line";
</script>

<script setup lang="ts">
import type {HTMLAttributes} from "vue";
defineProps<{variant: DropIndicatorVariant} & /* @vue-ignore */ HTMLAttributes>();
defineSlots<{default(): unknown}>();
</script>

<template>
    <div class="nb-ui-drop-indicator" :data-drop-indicator="variant" aria-hidden="true">
        <slot />
    </div>
</template>
