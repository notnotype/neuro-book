<script setup lang="ts">
import { ref } from "vue";

const props = defineProps<{
    modelValue: string[];
    placeholder?: string;
    accentStyle?: boolean;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: string[]): void;
}>();

const inputValue = ref("");

const addTag = () => {
    const val = inputValue.value.trim();
    if (val && !props.modelValue.includes(val)) {
        emit("update:modelValue", [...props.modelValue, val]);
    }
    inputValue.value = "";
};

const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        addTag();
    } else if (e.key === "Backspace" && inputValue.value === "" && props.modelValue.length > 0) {
        removeTag(props.modelValue.length - 1);
    }
};

const removeTag = (index: number) => {
    const newTags = [...props.modelValue];
    newTags.splice(index, 1);
    emit("update:modelValue", newTags);
};
</script>

<template>
    <div class="flex flex-wrap items-center gap-1 min-h-[28px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-1 transition-colors focus-within:border-[var(--accent-main)] focus-within:ring-1 focus-within:ring-[var(--accent-main)]/30">
        <span 
            v-for="(tag, i) in modelValue" 
            :key="tag" 
            class="flex items-center gap-1 rounded bg-[var(--bg-panel)] px-1.5 py-0.5 text-[11px] leading-none"
            :class="accentStyle ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border border-[var(--border-color)] text-[var(--text-main)]'"
        >
            {{ tag }}
            <button type="button" class="i-lucide-x h-3 w-3 flex-shrink-0 cursor-pointer opacity-50 transition-colors hover:text-[var(--status-danger)] hover:opacity-100" @click="removeTag(i)"></button>
        </span>
        <input 
            v-model="inputValue" 
            type="text" 
            :placeholder="modelValue.length === 0 ? placeholder : ''"
            class="min-w-[20px] flex-1 bg-transparent text-[11px] text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)] p-0"
            @keydown="handleKeydown"
            @blur="addTag"
        >
    </div>
</template>
