<script setup lang="ts">
import {
    CollapsibleContent,
    CollapsibleRoot,
    CollapsibleTrigger,
} from "reka-ui";

import {markCollapseAnimation} from "./collapse-animation";

const props = withDefaults(defineProps<{
    open?: boolean;
    defaultOpen?: boolean;
    disabled?: boolean;
}>(), {
    open: undefined,
    defaultOpen: false,
    disabled: false,
});

const emit = defineEmits<{
    (e: "update:open", value: boolean): void;
}>();

/** 对象写法表达不了 `.self`，在这里过滤掉子元素冒上来的动画事件。 */
function onContentAnimation(event: AnimationEvent): void {
    if (event.target === event.currentTarget) markCollapseAnimation(event);
}
</script>

<template>
    <CollapsibleRoot
        :open="props.open"
        :default-open="props.defaultOpen"
        :disabled="props.disabled"
        class="w-full"
        @update:open="(val) => emit('update:open', val)"
    >
        <CollapsibleTrigger as-child>
            <slot name="trigger" />
        </CollapsibleTrigger>

        <CollapsibleContent
            class="transition-[height,opacity] [transition-duration:var(--motion-base)] [transition-timing-function:var(--ease-standard)] nb-collapsible-content"
            v-bind="{onAnimationstart: onContentAnimation, onAnimationend: onContentAnimation, onAnimationcancel: onContentAnimation}"
        >
            <slot />
        </CollapsibleContent>
    </CollapsibleRoot>
</template>
