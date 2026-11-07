<script setup lang="ts">
import {
    ScrollAreaCorner,
    ScrollAreaRoot,
    ScrollAreaScrollbar,
    ScrollAreaThumb,
    ScrollAreaViewport,
} from "reka-ui";

export type ScrollAreaType = "auto" | "always" | "scroll" | "hover";
export type ScrollAreaOrientation = "vertical" | "horizontal" | "both";

const props = withDefaults(defineProps<{
    type?: ScrollAreaType;
    scrollHideDelay?: number;
    orientation?: ScrollAreaOrientation;
}>(), {
    type: "hover",
    scrollHideDelay: 600,
    orientation: "vertical",
});
</script>

<template>
    <ScrollAreaRoot
        :type="props.type"
        :scroll-hide-delay="props.scrollHideDelay"
        class="relative overflow-hidden"
    >
        <ScrollAreaViewport class="h-full w-full rounded-[inherit]">
            <slot />
        </ScrollAreaViewport>

        <!-- 纵向滚动条 -->
        <ScrollAreaScrollbar
            v-if="props.orientation === 'vertical' || props.orientation === 'both'"
            orientation="vertical"
            class="flex select-none touch-none p-0.5 transition-colors [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-layout)] hover:bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)] h-full w-2.5 border-l border-l-transparent"
        >
            <ScrollAreaThumb class="relative flex-1 rounded-full bg-[color-mix(in_srgb,var(--text-main)_var(--scrollbar-thumb-mix),transparent)] transition-colors hover:bg-[color-mix(in_srgb,var(--text-main)_var(--scrollbar-thumb-hover-mix),transparent)]" />
        </ScrollAreaScrollbar>

        <!-- 横向滚动条 -->
        <ScrollAreaScrollbar
            v-if="props.orientation === 'horizontal' || props.orientation === 'both'"
            orientation="horizontal"
            class="flex select-none touch-none p-0.5 transition-colors [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-layout)] hover:bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)] h-2.5 flex-col border-t border-t-transparent"
        >
            <ScrollAreaThumb class="relative flex-1 rounded-full bg-[color-mix(in_srgb,var(--text-main)_var(--scrollbar-thumb-mix),transparent)] transition-colors hover:bg-[color-mix(in_srgb,var(--text-main)_var(--scrollbar-thumb-hover-mix),transparent)]" />
        </ScrollAreaScrollbar>

        <ScrollAreaCorner />
    </ScrollAreaRoot>
</template>
