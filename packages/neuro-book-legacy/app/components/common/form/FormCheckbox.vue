<script setup lang="ts">
const props = withDefaults(defineProps<{
    modelValue: boolean;
    label?: string;
}>(), {
    label: "",
});

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "focus", event: FocusEvent): void;
}>();
</script>

<template>
    <!-- 通用紧凑复选框，用于表单中的布尔属性 -->
    <label class="flex h-9 items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-xs text-[var(--text-secondary)]">
        <input
            :checked="props.modelValue"
            type="checkbox"
            class="h-3.5 w-3.5 accent-[var(--accent-main)]"
            @focus="emit('focus', $event)"
            @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
        >
        <span>{{ props.label || (props.modelValue ? "true" : "false") }}</span>
    </label>
</template>
