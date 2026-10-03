<script setup lang="ts">
import {computed, ref} from "vue";
import { onClickOutside } from "@vueuse/core";

import type { SelectOption } from "./FormSelect.vue";

type ComboboxSize = "default" | "sm";

const props = withDefaults(defineProps<{
    disabled?: boolean;
    modelValue: string | null;
    options: (string | SelectOption)[];
    placeholder?: string;
    size?: ComboboxSize;
}>(), {
    disabled: false,
    placeholder: "",
    size: "default",
});

const emit = defineEmits<{
    (e: "update:modelValue", value: string | null): void;
}>();

const open = ref(false);
const rootRef = ref<HTMLDivElement | null>(null);

onClickOutside(rootRef, () => {
    open.value = false;
});

const onFocus = () => {
    if (props.disabled) {
        return;
    }
    open.value = true;
};

const toggle = () => {
    if (props.disabled) {
        return;
    }
    open.value = !open.value;
};

const handleInput = (e: Event) => {
    if (props.disabled) {
        return;
    }
    const val = (e.target as HTMLInputElement).value;
    emit("update:modelValue", val || null);
    open.value = true;
};

const selectOption = (opt: string | SelectOption) => {
    if (props.disabled) {
        return;
    }
    const val = typeof opt === 'string' ? opt : opt.value;
    emit("update:modelValue", val);
    open.value = false;
};

const normalizedOptions = computed(() => {
    return props.options.map(opt => {
        if (typeof opt === 'string') {
            return { value: opt, label: opt };
        }
        return opt;
    });
});

const filteredOptions = computed(() => {
    if (!props.modelValue) return normalizedOptions.value;
    const lower = props.modelValue.toLowerCase();
    // Allow matching on value or label
    return normalizedOptions.value.filter(o => 
        o.label.toLowerCase().includes(lower) || o.value.toLowerCase().includes(lower)
    );
});

const displayValue = computed(() => {
    if (!props.modelValue) return '';
    const opt = normalizedOptions.value.find(o => o.value === props.modelValue);
    return opt ? opt.label : props.modelValue;
});

const controlSizeClass = computed(() => props.size === "sm"
    ? "h-7 rounded-md"
    : "min-h-[28px] rounded-lg");
const inputSizeClass = computed(() => props.size === "sm"
    ? "px-2 text-[12px] rounded-l-md"
    : "px-2 py-1 text-xs rounded-l-lg");
const panelSizeClass = computed(() => props.size === "sm"
    ? "rounded-md"
    : "rounded-lg");
const optionSizeClass = computed(() => props.size === "sm"
    ? "px-2 py-1 text-[12px]"
    : "px-2.5 py-1.5 text-[11px]");
</script>

<template>
    <div ref="rootRef" class="relative min-w-0">
        <div 
            class="flex items-center border border-[var(--border-color)] bg-[var(--bg-input)] transition-colors focus-within:!border-[var(--accent-main)] focus-within:ring-1 focus-within:ring-[var(--accent-main)]/30 hover:border-[var(--border-strong)]"
            :class="[controlSizeClass, props.disabled ? 'cursor-default opacity-80' : '']"
        >
            <input 
                :value="displayValue" 
                autocomplete="off"
                :disabled="props.disabled"
                type="text"
                :placeholder="placeholder"
                class="w-full min-w-0 bg-transparent text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)]"
                :class="inputSizeClass"
                @input="handleInput"
                @focus="onFocus"
                @click="onFocus"
            >
            <button 
                type="button" 
                class="flex items-center justify-center p-1 text-[var(--text-muted)] hover:text-[var(--text-main)] outline-none pr-1.5 shrink-0"
                :disabled="props.disabled"
                @click.stop="toggle"
            >
                <span class="i-lucide-chevron-down h-3.5 w-3.5 transition-transform duration-200" :class="open ? '-rotate-180' : ''"></span>
            </button>
        </div>

        <transition name="dropdown">
            <div 
                v-if="open && filteredOptions.length > 0 && !props.disabled" 
                class="absolute left-0 right-0 top-full mt-1 z-[60] max-h-48 overflow-y-auto border border-[var(--border-color)] bg-[var(--bg-panel)] p-1.5 shadow-xl custom-scrollbar"
                :class="panelSizeClass"
            >
                <div 
                    v-for="opt in filteredOptions" 
                    :key="opt.value"
                    class="mb-1 flex items-center gap-2 rounded-md cursor-pointer transition-colors last:mb-0 hover:bg-[var(--bg-hover)]"
                    :class="[optionSizeClass, opt.value === modelValue ? 'text-[var(--text-main)] font-medium bg-[var(--bg-input)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-main)]']"
                    @click.stop="selectOption(opt)"
                >
                    <span class="truncate flex-1">{{ opt.label }}</span>
                    <span v-if="opt.value === modelValue" class="i-lucide-check h-3 w-3 text-[var(--accent-main)] shrink-0"></span>
                </div>
            </div>
        </transition>
    </div>
</template>

<style scoped>
.dropdown-enter-active,
.dropdown-leave-active {
    transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
}
.dropdown-enter-from,
.dropdown-leave-to {
    opacity: 0;
    transform: translateY(-4px) scaleY(0.96);
}
</style>
