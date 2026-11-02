<script setup lang="ts">
import type {ControlSize} from "../shared-types";
export type KbdSize = Extract<ControlSize, "sm" | "md" | "lg">;

const props = withDefaults(defineProps<{
    size?: KbdSize;
}>(), {
    size: "md",
});

function sizeClass(): string {
    if (props.size === "sm") {
        return "h-4 min-w-[16px] px-1 text-[length:var(--text-2xs)] rounded-[calc(var(--radius-control)*0.6)]";
    }
    if (props.size === "lg") {
        return "h-6 min-w-[24px] px-2 text-[length:var(--text-sm)] rounded-[calc(var(--radius-control)*0.8)]";
    }
    return "h-5 min-w-[20px] px-1.5 text-[length:var(--text-xs)] rounded-[calc(var(--radius-control)*0.7)]";
}
</script>

<template>
    <kbd
        class="inline-flex items-center justify-center border border-[color:var(--control-outline)] bg-[var(--bg-subtle)] font-mono font-medium text-[var(--text-main)] shadow-[var(--elevation-raised)] select-none whitespace-nowrap"
        :class="sizeClass()"
    >
        <slot />
    </kbd>
</template>
