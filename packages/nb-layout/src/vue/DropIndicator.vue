<script lang="ts">
export type DropIndicatorVariant = "area" | "entry" | "line";
</script>

<script setup lang="ts">
import type {HTMLAttributes} from "vue";
defineProps<{variant: DropIndicatorVariant} & /* @vue-ignore */ HTMLAttributes>();
defineSlots<{default(): unknown}>();
</script>

<template>
    <div class="nb-layout-drop-indicator" :data-drop-indicator="variant" aria-hidden="true">
        <slot />
    </div>
</template>

<style>
/* 仅负责皮肤；落点坐标、尺寸与层级由 Editor/Workbench 等宿主适配。 */
.nb-layout-drop-indicator {
    box-sizing: border-box;
    pointer-events: none;
    user-select: none;
}

.nb-layout-drop-indicator[data-drop-indicator="area"],
.nb-layout-drop-indicator[data-drop-indicator="entry"] {
    border: 1px solid var(--nb-layout-drop-area-border, color-mix(in srgb, Highlight 70%, transparent));
    border-radius: var(--nb-layout-radius-control, 6px);
    background: var(--nb-layout-drop-area-fill, color-mix(in srgb, Highlight 12%, transparent));
    box-shadow: var(--nb-layout-elevation-raised, none);
    transition: opacity var(--nb-layout-motion-fast, 120ms) var(--nb-layout-ease-layout, cubic-bezier(0.23, 1, 0.32, 1));
}

.nb-layout-drop-indicator[data-drop-indicator="line"] {
    border-radius: var(--nb-layout-radius-pill, 999px);
    background: var(--nb-layout-accent-main, Highlight);
    box-shadow: 0 0 4px var(--nb-layout-accent-main, Highlight);
}

@media (prefers-reduced-motion: reduce) {
    .nb-layout-drop-indicator {
        transition: none !important;
    }
}
</style>
