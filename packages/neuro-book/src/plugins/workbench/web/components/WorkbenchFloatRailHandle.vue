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

.workbench-float-rail-handle:hover,
.workbench-float-rail-handle:focus-visible,
.workbench-float-rail-handle[data-dragging] {
    background: var(--accent-main);
    outline: none;
    transition: background-color var(--motion-fast) var(--ease-layout);
}
</style>
