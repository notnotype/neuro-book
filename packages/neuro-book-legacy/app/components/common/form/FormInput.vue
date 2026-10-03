<script setup lang="ts">
import {computed, useSlots} from "vue";

const props = withDefaults(defineProps<{
    modelValue: string;
    type?: "text" | "search" | "password" | "number";
    placeholder?: string;
    readonly?: boolean;
    disabled?: boolean;
    step?: string;
    min?: string;
    max?: string;
}>(), {
    type: "text",
    placeholder: "",
    readonly: false,
    disabled: false,
    step: undefined,
    min: undefined,
    max: undefined,
});

const emit = defineEmits<{
    (e: "update:modelValue", value: string): void;
    (e: "focus", event: FocusEvent): void;
}>();

const slots = useSlots();
const hasPrefix = computed(() => Boolean(slots.prefix));
</script>

<template>
    <!-- 通用紧凑输入框 -->
    <div
        v-if="hasPrefix"
        class="flex h-7 w-full items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-[12px] text-[var(--text-main)] transition-colors focus-within:border-[var(--accent-main)] focus-within:ring-1 focus-within:ring-[var(--accent-main)]/20"
        :class="props.disabled || props.readonly ? 'cursor-default opacity-80' : ''"
    >
        <slot name="prefix"></slot>
        <input
            :value="props.modelValue"
            :type="props.type"
            :placeholder="props.placeholder"
            :readonly="props.readonly"
            :disabled="props.disabled"
            :step="props.step"
            :min="props.min"
            :max="props.max"
            class="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)] placeholder:opacity-80"
            @focus="emit('focus', $event)"
            @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
        >
    </div>
    <input
        v-else
        :value="props.modelValue"
        :type="props.type"
        :placeholder="props.placeholder"
        :readonly="props.readonly"
        :disabled="props.disabled"
        :step="props.step"
        :min="props.min"
        :max="props.max"
        class="h-7 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-[12px] text-[var(--text-main)] outline-none transition-colors placeholder:text-[var(--text-muted)] placeholder:opacity-80 focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)]/20"
        :class="props.disabled || props.readonly ? 'cursor-default opacity-80' : ''"
        @focus="emit('focus', $event)"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    >
</template>
