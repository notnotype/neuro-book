<script setup lang="ts">
import {inject} from "vue";
import {
    PopoverArrow,
    PopoverClose,
    PopoverContent,
    PopoverPortal,
    PopoverRoot,
    PopoverTrigger,
} from "reka-ui";
import {NB_POPOVER_Z_INDEX, NB_Z_INDEX} from "../../theme/z-index";

/** 窗口内的浮层跟随窗口层级（由 DialogWindow 注入）；未被窗口承载时回退到普通页面层级。 */
const popoverZIndex = inject(NB_POPOVER_Z_INDEX, NB_Z_INDEX.popover);


const props = withDefaults(defineProps<{
    open?: boolean;
    defaultOpen?: boolean;
    side?: "top" | "right" | "bottom" | "left";
    sideOffset?: number;
    align?: "start" | "center" | "end";
    avoidCollisions?: boolean;
    modal?: boolean;
    contentClass?: string;
    arrow?: boolean;
}>(), {
    open: undefined,
    defaultOpen: false,
    side: "bottom",
    sideOffset: 6,
    align: "center",
    avoidCollisions: true,
    modal: false,
    contentClass: "",
    arrow: false,
});

const emit = defineEmits<{
    (e: "update:open", value: boolean): void;
}>();
</script>

<template>
    <PopoverRoot
        :open="props.open"
        :default-open="props.defaultOpen"
        :modal="props.modal"
        @update:open="(val) => emit('update:open', val)"
    >
        <PopoverTrigger as-child>
            <slot name="trigger" />
        </PopoverTrigger>

        <PopoverPortal>
            <PopoverContent
                :side="props.side"
                :side-offset="props.sideOffset"
                :align="props.align"
                :avoid-collisions="props.avoidCollisions"
                :style="{
                    zIndex: popoverZIndex,
                }"
                class="nb-ui-popover-surface nb-ui-popover-motion relative rounded-[var(--radius-panel)] p-3 text-[var(--text-main)] outline-none select-none max-w-[calc(100vw-32px)]"
                :class="props.contentClass"
                @close-auto-focus="(event) => event.preventDefault()"
            >
                <slot />

                <PopoverArrow
                    v-if="props.arrow"
                    class="fill-[color-mix(in_srgb,var(--bg-panel)_85%,transparent)] stroke-[color-mix(in_srgb,var(--text-main)_10%,transparent)] stroke-[1px]"
                />
            </PopoverContent>
        </PopoverPortal>
    </PopoverRoot>
</template>
