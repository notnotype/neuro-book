<script setup lang="ts">
import type {LowCodeFieldDto, LowCodeJsonValue} from "nbook/shared/dto/low-code-form.dto";
import {useLowCodeComboboxDropdown} from "nbook/app/components/common/low-code-form/useLowCodeComboboxDropdown";

const props = withDefaults(defineProps<{
    field: LowCodeFieldDto;
    modelValue?: LowCodeJsonValue;
    disabled?: boolean;
}>(), {
    modelValue: null,
    disabled: false,
});
const emit = defineEmits<{
    (e: "update:modelValue", value: LowCodeJsonValue): void;
}>();

const {
    rootRef,
    panelRef,
    open,
    query,
    displayValue,
    filteredOptions,
    resolvedDirection,
    panelStyle,
    focusInput,
    toggleOpen,
    updateQuery,
    closeAfterSelect,
} = useLowCodeComboboxDropdown({
    field: computed(() => props.field),
    modelValue: computed(() => props.modelValue),
    disabled: computed(() => props.disabled),
});

function selectOption(value: LowCodeJsonValue): void {
    emit("update:modelValue", value);
    closeAfterSelect();
}
</script>

<template>
    <div ref="rootRef" class="relative">
        <div
            class="nb-ui-control nb-ui-control-h-sm flex w-full items-center gap-[var(--space-2)] rounded-[var(--radius-control)] border bg-[var(--control-surface)] text-[var(--text-main)]"
            :class="props.disabled ? 'cursor-not-allowed opacity-60' : ''"
            :data-state="open ? 'open' : 'closed'"
        >
            <input
                :value="open ? query : displayValue"
                type="text"
                :readonly="props.disabled"
                :placeholder="props.field.placeholder"
                class="h-full min-w-0 flex-1 bg-transparent px-2.5 text-xs text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)]"
                @focus="focusInput"
                @click="focusInput"
                @input="updateQuery(($event.target as HTMLInputElement).value)"
            >
            <button type="button" class="flex h-full w-7 items-center justify-center text-[var(--text-muted)]" :disabled="props.disabled" @click.stop="toggleOpen">
                <span class="i-lucide-chevron-down h-3.5 w-3.5 transition-transform" :class="open ? '-rotate-180' : ''"></span>
            </button>
        </div>

        <transition :name="resolvedDirection === 'up' ? 'low-code-combobox-up' : 'low-code-combobox-down'">
            <div
                v-if="open && !props.disabled"
                ref="panelRef"
                class="nb-ui-popover-surface nb-ui-menu-surface nb-ui-popover-motion absolute left-0 right-0 overflow-y-auto p-1.5 custom-scrollbar"
                :class="resolvedDirection === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'"
                :style="panelStyle"
            >
                <button
                    v-for="option in filteredOptions"
                    :key="`${typeof option.value}:${String(option.value)}`"
                    type="button"
                    class="nb-ui-popover-item flex min-h-8 w-full items-center gap-2 px-2.5 py-1 text-left text-xs transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
                    :class="option.value === props.modelValue ? 'bg-[var(--bg-subtle)] font-medium text-[var(--text-main)]' : 'text-[var(--text-secondary)]'"
                    :disabled="option.disabled"
                    @click="selectOption(option.value)"
                >
                    <span class="min-w-0 flex-1">
                        <span class="block truncate">{{ option.label }}</span>
                        <span v-if="option.description" class="mt-0.5 block truncate text-[10px] font-normal text-[var(--text-muted)]">{{ option.description }}</span>
                    </span>
                    <span v-if="option.value === props.modelValue" class="i-lucide-check h-3 w-3 shrink-0 text-[var(--accent-main)]"></span>
                </button>
            </div>
        </transition>
    </div>
</template>

<style scoped>
.low-code-combobox-down-enter-active,
.low-code-combobox-down-leave-active,
.low-code-combobox-up-enter-active,
.low-code-combobox-up-leave-active {
    transition: all 0.15s ease;
}

.low-code-combobox-down-enter-from,
.low-code-combobox-down-leave-to {
    opacity: 0;
    transform: translateY(-4px);
}

.low-code-combobox-up-enter-from,
.low-code-combobox-up-leave-to {
    opacity: 0;
    transform: translateY(4px);
}
</style>
