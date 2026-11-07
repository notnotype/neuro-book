<script setup lang="ts">
import {computed} from "vue";
import {
    ProgressIndicator,
    ProgressRoot,
} from "reka-ui";
import type {ControlSize} from "../shared-types";

export type ProgressTone = "accent" | "success" | "warning" | "danger";
export type ProgressSize = Extract<ControlSize, "sm" | "md" | "lg">;

const props = withDefaults(defineProps<{
    modelValue?: number;
    max?: number;
    tone?: ProgressTone;
    size?: ProgressSize;
}>(), {
    modelValue: 0,
    max: 100,
    tone: "accent",
    size: "md",
});

const progressPercent = computed(() => {
    const val = typeof props.modelValue === "number" ? props.modelValue : 0;
    const maxVal = props.max > 0 ? props.max : 100;
    return Math.min(100, Math.max(0, (val / maxVal) * 100));
});

const toneClass = computed(() => {
    if (props.tone === "success") return "bg-[var(--status-success)]";
    if (props.tone === "warning") return "bg-[var(--status-warning)]";
    if (props.tone === "danger") return "bg-[var(--status-danger)]";
    return "bg-[var(--accent-main)]";
});

const sizeClass = computed(() => {
    if (props.size === "sm") return "h-1.5";
    if (props.size === "lg") return "h-3.5";
    return "h-2.5";
});
</script>

<template>
    <ProgressRoot
        :model-value="props.modelValue"
        :max="props.max"
        class="relative w-full overflow-hidden rounded-[var(--radius-pill)] bg-[color-mix(in_srgb,var(--text-main)_12%,transparent)]"
        :class="sizeClass"
    >
        <ProgressIndicator
            class="h-full w-full flex-1 rounded-[var(--radius-pill)] transition-transform [transition-duration:var(--motion-move)] [transition-timing-function:var(--ease-layout)]"
            :class="toneClass"
            :style="{transform: `translateX(-${100 - progressPercent}%)`}"
        />
    </ProgressRoot>
</template>
