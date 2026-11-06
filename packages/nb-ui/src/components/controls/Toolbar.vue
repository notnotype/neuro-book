<script setup lang="ts">
import {
    ToolbarRoot,
    ToolbarSeparator,
} from "reka-ui";
import {computed} from "vue";

import {useUiText} from "../../text-port";

const props = withDefaults(defineProps<{
    orientation?: "horizontal" | "vertical";
    ariaLabel?: string;
    /** `flat` 没有面板外观，由所在的条提供底色与边界；内容放不下时由使用方决定怎么收。 */
    variant?: "panel" | "flat";
}>(), {
    orientation: "horizontal",
    variant: "panel",
});

const text = useUiText();
const labelText = computed(() => props.ariaLabel ?? text("toolbar.label"));
</script>

<template>
    <ToolbarRoot
        :orientation="props.orientation"
        :aria-label="labelText"
        class="flex items-center"
        :class="[
            props.variant === 'flat' ? 'min-w-0 gap-0.5' : 'gap-1 rounded-[var(--radius-control)] border border-[color-mix(in_srgb,var(--text-main)_10%,transparent)] bg-[var(--bg-panel)] p-1 shadow-sm select-none',
            props.orientation === 'vertical' ? 'flex-col w-max' : props.variant === 'flat' ? 'flex-row w-full' : 'flex-row w-max max-w-full overflow-x-auto',
        ]"
    >
        <slot />
    </ToolbarRoot>
</template>
