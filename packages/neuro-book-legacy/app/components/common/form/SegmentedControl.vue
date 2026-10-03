<script setup lang="ts">
export type SegmentedControlValue = string | number | boolean | null;
export type SegmentedControlSize = "xs" | "sm";
export type SegmentedControlTone = "default" | "accent" | "warning";
export type SegmentedControlOption = {
    count?: number | string;
    disabled?: boolean;
    iconClass?: string;
    label: string;
    testId?: string;
    title?: string;
    tone?: SegmentedControlTone;
    value: SegmentedControlValue;
};

const props = withDefaults(defineProps<{
    modelValue: SegmentedControlValue;
    options: SegmentedControlOption[];
    size?: SegmentedControlSize;
    tone?: SegmentedControlTone;
    wrap?: boolean;
}>(), {
    size: "sm",
    tone: "default",
    wrap: true,
});

const emit = defineEmits<{
    (e: "update:modelValue", value: SegmentedControlValue): void;
}>();

function optionKey(option: SegmentedControlOption): string {
    return `${typeof option.value}:${String(option.value)}`;
}

function optionTone(option: SegmentedControlOption): SegmentedControlTone {
    return option.tone ?? props.tone;
}

function isSelected(option: SegmentedControlOption): boolean {
    return option.value === props.modelValue;
}

function buttonClass(option: SegmentedControlOption): string {
    if (isSelected(option)) {
        if (optionTone(option) === "warning") {
            return "bg-[var(--bg-panel)] text-[var(--accent-text)] shadow-sm";
        }
        if (optionTone(option) === "accent") {
            return "bg-[var(--bg-panel)] text-[var(--accent-main)] shadow-sm";
        }
        return "bg-[var(--bg-panel)] text-[var(--text-main)] shadow-sm";
    }
    return "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]";
}

function selectOption(option: SegmentedControlOption): void {
    if (option.disabled) {
        return;
    }
    emit("update:modelValue", option.value);
}
</script>

<template>
    <!-- 通用 segmented 控件，用于互斥的紧凑模式切换。 -->
    <div class="inline-flex max-w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-0.5" :class="props.wrap ? 'flex-wrap' : 'flex-nowrap'">
        <button
            v-for="option in props.options"
            :key="optionKey(option)"
            type="button"
            class="inline-flex min-w-0 items-center justify-center gap-1 rounded font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            :class="[props.size === 'xs' ? 'h-6 px-2 text-[11px]' : 'h-7 px-3 text-xs', buttonClass(option)]"
            :aria-pressed="isSelected(option)"
            :data-testid="option.testId"
            :disabled="option.disabled"
            :title="option.title"
            @click="selectOption(option)"
        >
            <span v-if="option.iconClass" class="h-3.5 w-3.5 shrink-0" :class="option.iconClass"></span>
            <span class="truncate">{{ option.label }}</span>
            <span v-if="option.count !== undefined" class="shrink-0 font-mono text-[10px] opacity-80">{{ option.count }}</span>
        </button>
    </div>
</template>
