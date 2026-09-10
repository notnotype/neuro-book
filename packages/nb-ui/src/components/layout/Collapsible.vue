<script setup lang="ts">
import {
    CollapsibleContent,
    CollapsibleRoot,
    CollapsibleTrigger,
} from "reka-ui";

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
            class="overflow-hidden transition-[height,opacity] [transition-duration:var(--motion-base)] [transition-timing-function:var(--ease-standard)] nb-collapsible-content"
        >
            <slot />
        </CollapsibleContent>
    </CollapsibleRoot>
</template>
