<script setup lang="ts">
/**
 * 浮动窗里视图段的轨宽手柄（同名 .md）：手势与右轨的手柄同一个 `useRailHandle`（手柄在视图段左边，往左拖变宽）。
 */
import {computed} from "vue";

import {useRailHandle} from "./use-rail-handle";

const props = defineProps<{
    width: number;
    bounds: {readonly minimum: number; readonly maximum: number; readonly width: number};
    revision: unknown;
    label: string;
}>();

const emit = defineEmits<{
    preview: [width: number | null];
    commit: [width: number];
}>();

const handle = useRailHandle({
    width: () => props.width,
    bounds: () => props.bounds,
    side: () => "start",
    revision: () => props.revision,
    disabled: () => false,
    preview: (width) => emit("preview", width),
    commit: (width) => emit("commit", width),
});

const style = computed(() => ({right: `${props.width}px`}));
</script>

<template>
    <div
        class="workbench-float-rail-handle"
        role="separator"
        aria-orientation="vertical"
        tabindex="0"
        :aria-label="props.label"
        :aria-valuenow="handle.dragging.value ?? props.width"
        :aria-valuemin="props.bounds.minimum"
        :aria-valuemax="props.bounds.maximum"
        :data-dragging="handle.dragging.value === null ? undefined : ''"
        :style="style"
        data-float-rail-handle
        data-no-drag
        v-on="handle.listeners"
    ></div>
</template>

<style scoped>
.workbench-float-rail-handle {
    position: absolute;
    inset-block: 0;
    z-index: 2;
    width: 6px;
    transform: translateX(50%);
    cursor: col-resize;
    pointer-events: auto;
    touch-action: none;
}

/* 亮起来的是接缝上居中的一条线，样子与时机同网格的分隔线与侧轨的轨宽手柄（`WorkbenchToolStrip`）。 */
.workbench-float-rail-handle::before {
    position: absolute;
    inset-block: 0;
    left: 50%;
    width: var(--sash-line-size);
    border-radius: var(--sash-line-radius);
    background: var(--sash-line-color);
    box-shadow: var(--sash-line-glow, none);
    content: "";
    opacity: 0;
    transform: translateX(-50%);
    transition: opacity var(--motion-fast) var(--ease-layout);
}

.workbench-float-rail-handle:hover::before {
    opacity: 1;
    transition-delay: 250ms;
}

.workbench-float-rail-handle:focus-visible,
.workbench-float-rail-handle[data-dragging] {
    outline: none;
}

.workbench-float-rail-handle:focus-visible::before,
.workbench-float-rail-handle[data-dragging]::before {
    opacity: 1;
    transition: none;
}
</style>
