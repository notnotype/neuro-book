<script setup lang="ts">
import {
    AccordionContent,
    AccordionHeader,
    AccordionItem,
    AccordionRoot,
    AccordionTrigger,
} from "reka-ui";

export interface AccordionItemData {
    value: string;
    title: string;
    subtitle?: string;
    content?: string;
    iconClass?: string;
    disabled?: boolean;
}

const props = withDefaults(defineProps<{
    modelValue?: string | string[];
    defaultValue?: string | string[];
    type?: "single" | "multiple";
    collapsible?: boolean;
    disabled?: boolean;
    items?: AccordionItemData[];
}>(), {
    modelValue: undefined,
    defaultValue: undefined,
    type: "single",
    collapsible: true,
    disabled: false,
    items: () => [],
});

const emit = defineEmits<{
    (e: "update:modelValue", value: string | string[]): void;
}>();
</script>

<template>
    <AccordionRoot
        :model-value="props.modelValue"
        :default-value="props.defaultValue"
        :type="props.type as any"
        :collapsible="props.collapsible"
        :disabled="props.disabled"
        class="w-full divide-y divide-[var(--divider)] rounded-[var(--radius-panel)] border border-[color-mix(in_srgb,var(--text-main)_10%,transparent)] bg-[var(--bg-panel)] overflow-hidden"
        @update:model-value="(val) => emit('update:modelValue', val as any)"
    >
        <template v-if="props.items.length > 0">
            <AccordionItem
                v-for="item in props.items"
                :key="item.value"
                :value="item.value"
                :disabled="item.disabled"
                class="overflow-hidden transition-colors data-[disabled]:opacity-50"
            >
                <AccordionHeader class="flex">
                    <AccordionTrigger
                        class="nb-ui-focus-ring group flex flex-1 items-center justify-between px-4 py-3 text-left text-[var(--text-sm)] font-medium text-[var(--text-main)] transition-colors [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)] disabled:cursor-not-allowed cursor-pointer select-none"
                    >
                        <div class="flex items-center gap-2.5 min-w-0">
                            <span v-if="item.iconClass" :class="item.iconClass" class="h-4 w-4 shrink-0 text-[var(--text-secondary)]" aria-hidden="true"></span>
                            <div class="min-w-0">
                                <span class="block truncate">{{ item.title }}</span>
                                <span v-if="item.subtitle" class="block text-[var(--text-xs)] text-[var(--text-muted)] font-normal truncate mt-0.5">{{ item.subtitle }}</span>
                            </div>
                        </div>

                        <span class="i-lucide-chevron-down h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform [transition-duration:var(--motion-base)] [transition-timing-function:var(--ease-standard)] group-data-[state=open]:rotate-180" aria-hidden="true"></span>
                    </AccordionTrigger>
                </AccordionHeader>

                <AccordionContent
                    class="overflow-hidden text-[var(--text-sm)] text-[var(--text-secondary)] transition-[height,opacity] [transition-duration:var(--motion-base)] [transition-timing-function:var(--ease-standard)] nb-accordion-content"
                >
                    <div class="px-4 pb-3.5 pt-1">
                        <slot :name="`content-${item.value}`" :item="item">
                            {{ item.content }}
                        </slot>
                    </div>
                </AccordionContent>
            </AccordionItem>
        </template>
        <template v-else>
            <slot />
        </template>
    </AccordionRoot>
</template>
