<script setup lang="ts">
import {computed, ref, inject} from "vue";
import {
    PopoverContent,
    PopoverPortal,
    PopoverRoot,
    PopoverTrigger,
    type DateRange,
} from "reka-ui";
import {NB_POPOVER_Z_INDEX, NB_Z_INDEX} from "../../theme/z-index";
import Button from "../controls/Button.vue";
import RangeCalendar from "./RangeCalendar.vue";

/** 窗口内的浮层跟随窗口层级（由 DialogWindow 注入）；未被窗口承载时回退到普通页面层级。 */
const popoverZIndex = inject(NB_POPOVER_Z_INDEX, NB_Z_INDEX.popover);


const props = withDefaults(defineProps<{
    modelValue?: DateRange;
    placeholder?: string;
    disabled?: boolean;
    readonly?: boolean;
    locale?: string;
    size?: "sm" | "md" | "lg";
}>(), {
    modelValue: undefined,
    placeholder: "选择起止日期区间...",
    disabled: false,
    readonly: false,
    locale: "zh-CN",
    size: "md",
});

const emit = defineEmits<{
    (e: "update:modelValue", value: DateRange): void;
}>();

const isOpen = ref(false);

const displayValue = computed(() => {
    if (!props.modelValue?.start) return "";
    const startStr = props.modelValue.start.toString();
    if (!props.modelValue.end) return `${startStr} ~ ...`;
    return `${startStr} ~ ${props.modelValue.end.toString()}`;
});

function handleRangeSelect(val: DateRange): void {
    emit("update:modelValue", val);
    if (val.start && val.end) {
        isOpen.value = false;
    }
}

function handleClear(): void {
    emit("update:modelValue", {start: undefined, end: undefined});
    isOpen.value = false;
}
</script>

<template>
    <PopoverRoot v-model:open="isOpen">
        <PopoverTrigger as-child>
            <button
                type="button"
                :disabled="props.disabled"
                class="nb-ui-control nb-ui-focus-ring relative inline-flex items-center justify-between gap-2 rounded-[var(--radius-control)] border bg-[var(--bg-panel)] px-3 text-left transition-colors [transition-duration:var(--motion-base)] [transition-timing-function:var(--ease-standard)] cursor-pointer select-none disabled:cursor-not-allowed disabled:opacity-40"
                :class="[
                    props.size === 'sm' ? 'nb-ui-control-h-sm text-xs' : '',
                    props.size === 'md' ? 'nb-ui-control-h-md text-sm' : '',
                    props.size === 'lg' ? 'nb-ui-control-h-lg text-base' : '',
                ]"
            >
                <div class="flex items-center gap-2 truncate">
                    <span class="i-lucide-calendar-range h-4 w-4 text-[var(--text-muted)] shrink-0" aria-hidden="true" />
                    <span v-if="displayValue" class="text-[var(--text-main)] font-mono text-xs">{{ displayValue }}</span>
                    <span v-else class="text-[var(--text-muted)]">{{ props.placeholder }}</span>
                </div>

                <span
                    v-if="displayValue && !props.disabled && !props.readonly"
                    class="i-lucide-x h-3.5 w-3.5 text-[var(--text-muted)] hover:text-[var(--text-main)] shrink-0"
                    @click.stop="handleClear"
                />
            </button>
        </PopoverTrigger>

        <PopoverPortal>
            <PopoverContent
                :side-offset="6"
                :style="{
                    zIndex: popoverZIndex,
                    backgroundColor: 'color-mix(in srgb, var(--bg-panel) 90%, transparent)',
                    backdropFilter: 'blur(16px) saturate(130%) brightness(1.0)',
                    WebkitBackdropFilter: 'blur(16px) saturate(130%) brightness(1.0)',
                    boxShadow: '0 0 0 1px color-mix(in srgb, var(--text-main) 8%, transparent), 0 8px 24px -4px color-mix(in srgb, var(--shadow-color) 24%, transparent)',
                }"
                class="nb-ui-popover-surface nb-ui-popover-motion rounded-[var(--radius-panel)] p-2 text-[var(--text-main)] outline-none select-none"
                @close-auto-focus="(e) => e.preventDefault()"
            >
                <RangeCalendar
                    :model-value="props.modelValue"
                    :disabled="props.disabled"
                    :readonly="props.readonly"
                    :locale="props.locale"
                    @update:model-value="handleRangeSelect"
                />

                <div class="flex items-center justify-between border-t border-[var(--divider)] pt-2 px-1">
                    <Button size="sm" variant="ghost" @click="handleClear">
                        清除
                    </Button>
                    <Button size="sm" variant="secondary" @click="isOpen = false">
                        完成
                    </Button>
                </div>
            </PopoverContent>
        </PopoverPortal>
    </PopoverRoot>
</template>
