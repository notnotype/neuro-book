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

<style>
/* 仅负责皮肤；落点坐标、尺寸与层级由 Editor/Workbench 等宿主适配。 */
.nb-ui-drop-indicator {
    box-sizing: border-box;
    pointer-events: none;
    user-select: none;
}

.nb-ui-drop-indicator[data-drop-indicator="area"],
.nb-ui-drop-indicator[data-drop-indicator="entry"] {
    border: 1px solid var(--drop-area-border);
    border-radius: var(--radius-control);
    background: var(--drop-area-fill);
    box-shadow: var(--elevation-raised);
    transition: opacity var(--motion-fast) var(--ease-standard);
}

.nb-ui-drop-indicator[data-drop-indicator="line"] {
    border-radius: var(--radius-pill);
    background: var(--accent-main);
    box-shadow: 0 0 4px var(--accent-main);
}

@media (prefers-reduced-motion: reduce) {
    .nb-ui-drop-indicator {
        transition: none !important;
    }
}
</style>
