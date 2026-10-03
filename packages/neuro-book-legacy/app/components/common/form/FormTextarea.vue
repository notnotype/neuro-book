<script setup lang="ts">
const props = withDefaults(defineProps<{
    modelValue: string;
    rows?: number;
    placeholder?: string;
    disabled?: boolean;
}>(), {
    rows: 2,
    placeholder: "",
    disabled: false,
});

const emit = defineEmits<{
    (e: "update:modelValue", value: string): void;
    (e: "focus", event: FocusEvent): void;
}>();
</script>

<template>
    <!-- 通用紧凑多行输入框 -->
    <textarea
        :value="props.modelValue"
        :rows="props.rows"
        :placeholder="props.placeholder"
        :disabled="props.disabled"
        class="w-full resize-none rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 py-1.5 text-[12px] leading-5 text-[var(--text-main)] outline-none transition-colors placeholder:text-[var(--text-muted)] placeholder:opacity-80 focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)]/20"
        :class="props.disabled ? 'cursor-default opacity-80' : ''"
        @focus="emit('focus', $event)"
        @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
    ></textarea>
</template>
