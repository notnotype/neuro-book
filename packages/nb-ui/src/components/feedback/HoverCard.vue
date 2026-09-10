<script setup lang="ts">
import {inject} from "vue";
import {
    HoverCardArrow,
    HoverCardContent,
    HoverCardPortal,
    HoverCardRoot,
    HoverCardTrigger,
} from "reka-ui";
import {NB_POPOVER_Z_INDEX, NB_Z_INDEX} from "../../theme/z-index";

/** 窗口内的浮层跟随窗口层级（由 DialogWindow 注入）；未被窗口承载时回退到普通页面层级。 */
const popoverZIndex = inject(NB_POPOVER_Z_INDEX, NB_Z_INDEX.popover);


const props = withDefaults(defineProps<{
    open?: boolean;
    defaultOpen?: boolean;
    openDelay?: number;
    closeDelay?: number;
    side?: "top" | "right" | "bottom" | "left";
    sideOffset?: number;
    align?: "start" | "center" | "end";
    avoidCollisions?: boolean;
    contentClass?: string;
    arrow?: boolean;
}>(), {
    open: undefined,
    defaultOpen: false,
    openDelay: 250,
    closeDelay: 200,
    side: "bottom",
    sideOffset: 6,
    align: "center",
    avoidCollisions: true,
    contentClass: "",
    arrow: false,
});

const emit = defineEmits<{
    (e: "update:open", value: boolean): void;
}>();
</script>

<template>
    <HoverCardRoot
        :open="props.open"
        :default-open="props.defaultOpen"
        :open-delay="props.openDelay"
        :close-delay="props.closeDelay"
        @update:open="(val) => emit('update:open', val)"
    >
        <HoverCardTrigger as-child>
            <slot name="trigger" />
        </HoverCardTrigger>

        <HoverCardPortal>
            <HoverCardContent
                :side="props.side"
                :side-offset="props.sideOffset"
                :align="props.align"
                :avoid-collisions="props.avoidCollisions"
                :style="{
                    zIndex: popoverZIndex,
                    backgroundColor: 'color-mix(in srgb, var(--bg-panel) 75%, transparent)',
                    backdropFilter: 'blur(14px) saturate(130%) brightness(1.0)',
                    WebkitBackdropFilter: 'blur(14px) saturate(130%) brightness(1.0)',
                    boxShadow: '0 0 0 1px color-mix(in srgb, var(--text-main) 8%, transparent), 0 8px 24px -4px color-mix(in srgb, var(--shadow-color) 20%, transparent)',
                }"
                class="nb-ui-popover-surface nb-ui-popover-motion relative rounded-[var(--radius-panel)] p-3 text-[var(--text-main)] outline-none select-none max-w-[360px]"
                :class="props.contentClass"
            >
                <slot />

                <HoverCardArrow
                    v-if="props.arrow"
                    class="fill-[color-mix(in_srgb,var(--bg-panel)_85%,transparent)] stroke-[color-mix(in_srgb,var(--text-main)_10%,transparent)] stroke-[1px]"
                />
            </HoverCardContent>
        </HoverCardPortal>
    </HoverCardRoot>
</template>
