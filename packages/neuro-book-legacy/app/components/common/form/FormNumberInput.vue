<script setup lang="ts">
import {computed} from "vue";

type NumberInputSize = "default" | "sm";
type StepDirection = "down" | "up";

const props = withDefaults(defineProps<{
    disabled?: boolean;
    max?: string;
    min?: string;
    modelValue: string;
    placeholder?: string;
    readonly?: boolean;
    size?: NumberInputSize;
    step?: string;
    title?: string;
}>(), {
    disabled: false,
    max: undefined,
    min: undefined,
    placeholder: "",
    readonly: false,
    size: "default",
    step: "1",
    title: undefined,
});

const emit = defineEmits<{
    (e: "submit"): void;
    (e: "update:modelValue", value: string): void;
}>();

const controlSizeClass = computed(() => props.size === "sm"
    ? "h-7 px-2 text-[12px]"
    : "h-7 px-2.5 text-[12px]");
const stepValue = computed(() => {
    const parsed = Number.parseFloat(props.step || "1");
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
});

/** 写入用户输入，保留中间态如空字符串、负号和小数点。 */
function updateValue(value: string): void {
    emit("update:modelValue", value);
}

/** 根据 step / min / max 执行一次上下步进。 */
function stepValueBy(direction: StepDirection): void {
    if (props.disabled || props.readonly) {
        return;
    }
    const current = Number.parseFloat(props.modelValue);
    const fallback = direction === "up" ? minNumber() ?? 0 : maxNumber() ?? 0;
    const base = Number.isFinite(current) ? current : fallback;
    const delta = direction === "up" ? stepValue.value : -stepValue.value;
    emit("update:modelValue", formatSteppedNumber(clampNumber(base + delta)));
}

/** 键盘方向键使用同一套步进逻辑。 */
function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
        event.preventDefault();
        emit("submit");
        return;
    }
    if (event.key === "ArrowUp") {
        event.preventDefault();
        stepValueBy("up");
        return;
    }
    if (event.key === "ArrowDown") {
        event.preventDefault();
        stepValueBy("down");
    }
}

/** 限制数字在 min / max 范围内。 */
function clampNumber(value: number): number {
    const min = minNumber();
    const max = maxNumber();
    if (min !== null && value < min) {
        return min;
    }
    if (max !== null && value > max) {
        return max;
    }
    return value;
}

/** 格式化步进后的数字，避免 0.1 + 0.2 一类浮点尾巴暴露到 UI。 */
function formatSteppedNumber(value: number): string {
    const decimals = decimalPlaces(props.step || "1");
    return decimals > 0 ? Number(value.toFixed(decimals)).toString() : Math.trunc(value).toString();
}

/** 解析 min。 */
function minNumber(): number | null {
    const parsed = Number.parseFloat(props.min ?? "");
    return Number.isFinite(parsed) ? parsed : null;
}

/** 解析 max。 */
function maxNumber(): number | null {
    const parsed = Number.parseFloat(props.max ?? "");
    return Number.isFinite(parsed) ? parsed : null;
}

/** 读取小数位数，用于步进后输出。 */
function decimalPlaces(value: string): number {
    const [, decimal = ""] = value.split(".");
    return decimal.length;
}
</script>

<template>
    <!-- 通用数字输入：用自定义步进按钮替代浏览器原生 spinner -->
    <div
        class="flex w-full min-w-0 items-center rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-main)] transition-colors focus-within:border-[var(--accent-main)] focus-within:ring-1 focus-within:ring-[var(--accent-main)]/20"
        :class="[controlSizeClass, props.disabled || props.readonly ? 'cursor-default opacity-80' : '']"
        :title="props.title"
    >
        <input
            :value="props.modelValue"
            :disabled="props.disabled"
            :placeholder="props.placeholder"
            :readonly="props.readonly"
            class="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)] placeholder:opacity-80"
            inputmode="decimal"
            @input="updateValue(($event.target as HTMLInputElement).value)"
            @keydown="handleKeydown"
        >
        <span class="ml-1 flex h-5 w-4 shrink-0 flex-col overflow-hidden rounded-sm border border-[var(--border-color)] bg-[var(--bg-panel)]">
            <button type="button" class="flex h-1/2 items-center justify-center text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:opacity-40" :disabled="props.disabled || props.readonly" title="增加" @click="stepValueBy('up')">
                <span class="i-lucide-chevron-up h-2.5 w-2.5"></span>
            </button>
            <button type="button" class="flex h-1/2 items-center justify-center border-t border-[var(--border-color)] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:opacity-40" :disabled="props.disabled || props.readonly" title="减少" @click="stepValueBy('down')">
                <span class="i-lucide-chevron-down h-2.5 w-2.5"></span>
            </button>
        </span>
    </div>
</template>
