<script setup lang="ts">
import {computed, nextTick, ref} from "vue";

/**
 * 分段选择器（SegmentedControl · 经典 macOS 系统蓝平滑滑动体系）。
 *
 * 视觉与动效规范：
 * 1. 底座：饱满超椭圆（Squircle，消费 var(--radius-control)），10% 柔灰实底 + 1px 细微反光外框；
 * 2. 指示块：纯正 Apple 蓝（var(--accent-main)）+ 纯白反色文字 + 舒缓物理滑动动画（消费 var(--motion-base) 与 var(--ease-standard)）；
 * 3. 分隔线：未选中项之间配备 1px 细微竖向分隔线，在选中项相邻两侧智能平滑消隐；
 * 4. 无障碍与键盘：支持标准 WAI-ARIA RadioGroup 模式与 ArrowLeft/ArrowRight/Home/End 键盘巡检。
 */

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
    ariaLabel?: string;
    size?: SegmentedControlSize;
    tone?: SegmentedControlTone;
    wrap?: boolean;
    fullWidth?: boolean;
}>(), {
    ariaLabel: "",
    size: "sm",
    tone: "default",
    wrap: false,
    fullWidth: false,
});

const emit = defineEmits<{
    (e: "update:modelValue", value: SegmentedControlValue): void;
}>();

const rootRef = ref<HTMLDivElement | null>(null);

function optionKey(option: SegmentedControlOption): string {
    return `${typeof option.value}:${String(option.value)}`;
}

function isSelected(option: SegmentedControlOption): boolean {
    return option.value === props.modelValue;
}

const selectedIndex = computed(() => props.options.findIndex((opt) => opt.value === props.modelValue));

const enabledOptions = computed(() => props.options.filter((opt) => !opt.disabled));

function selectOption(option: SegmentedControlOption): void {
    if (option.disabled) {
        return;
    }
    emit("update:modelValue", option.value);
}

/** 键盘无障碍：支持左右方向键、Home/End 快速切换并同步聚焦 */
function handleKeydown(event: KeyboardEvent): void {
    const enabled = enabledOptions.value;
    if (enabled.length <= 1) return;

    const currentIdx = enabled.findIndex((opt) => opt.value === props.modelValue);
    let nextIdx: number | null = null;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        nextIdx = (currentIdx + 1) % enabled.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        nextIdx = (currentIdx - 1 + enabled.length) % enabled.length;
    } else if (event.key === "Home") {
        nextIdx = 0;
    } else if (event.key === "End") {
        nextIdx = enabled.length - 1;
    }

    if (nextIdx === null) return;
    event.preventDefault();

    const targetOpt = enabled[nextIdx];
    if (targetOpt) {
        selectOption(targetOpt);
        void nextTick(() => {
            const buttons = Array.from(rootRef.value?.querySelectorAll<HTMLButtonElement>("button[role='radio']") ?? []);
            const targetBtn = buttons.find((btn) => btn.dataset.value === String(targetOpt.value));
            targetBtn?.focus();
        });
    }
}
</script>

<template>
    <div
        ref="rootRef"
        role="group"
        :aria-label="props.ariaLabel || undefined"
        class="relative inline-flex max-w-full items-stretch rounded-[var(--radius-control)] border-[length:var(--border-w)] border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] bg-[color-mix(in_srgb,var(--text-main)_10%,transparent)] p-[2px] select-none box-border outline-none"
        :class="[
            props.fullWidth ? 'w-full flex' : 'inline-flex',
            props.wrap ? 'flex-wrap' : 'flex-nowrap',
        ]"
        @keydown="handleKeydown"
    >
        <!-- 舒缓平滑滑动背景指示块（单选且选项固定等分时连续 GPU 硬件滑动） -->
        <div
            v-if="selectedIndex >= 0 && !props.wrap"
            class="absolute top-[2px] bottom-[2px] rounded-[max(2px,calc(var(--radius-control)-2px))] bg-[var(--accent-main)] text-[var(--text-inverse)] shadow-[0_2px_8px_color-mix(in_srgb,var(--accent-main)_38%,transparent),0_0_0_1px_color-mix(in_srgb,var(--accent-main)_30%,transparent)] pointer-events-none transition-[transform,width,background-color,color,box-shadow] [transition-duration:var(--motion-base)] [transition-timing-function:var(--ease-standard)] will-change-transform"
            :style="{
                width: `calc((100% - 4px) / ${props.options.length})`,
                transform: `translateX(calc(${selectedIndex} * 100%))`,
            }"
        ></div>

        <!-- 选项按钮列表 -->
        <button
            v-for="(option, idx) in props.options"
            :key="optionKey(option)"
            type="button"
            role="radio"
            :data-value="String(option.value)"
            :aria-pressed="isSelected(option) ? 'true' : 'false'"
            :aria-checked="isSelected(option)"
            :tabindex="isSelected(option) ? 0 : -1"
            :disabled="option.disabled"
            :aria-label="option.title || option.label || undefined"
            :title="option.title || option.label"
            :data-testid="option.testId"
            class="nb-ui-focus-ring relative z-10 flex-1 inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[max(2px,calc(var(--radius-control)-2px))] [font-weight:var(--weight-medium)] transition-[color,transform,opacity] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] not-disabled:active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent cursor-pointer"
            :class="[
                props.size === 'xs'
                    ? (option.label ? 'h-[calc(var(--control-h-sm)-var(--space-1)*2)] px-2 text-[11px]' : 'h-[calc(var(--control-h-sm)-var(--space-1)*2)] px-1.5 text-[11px]')
                    : (option.label ? 'h-[calc(var(--control-h-sm)-var(--space-1))] px-3 text-xs' : 'h-[calc(var(--control-h-sm)-var(--space-1))] px-2 text-xs'),
                isSelected(option)
                    ? 'text-[var(--text-inverse)] font-semibold'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]',
            ]"
            @click="selectOption(option)"
        >
            <span
                v-if="option.iconClass"
                :class="option.iconClass"
                class="h-3.5 w-3.5 shrink-0 opacity-90 transition-transform [transition-duration:var(--motion-fast)]"
                aria-hidden="true"
            />
            <span v-if="option.label" class="truncate">{{ option.label }}</span>
            <span
                v-if="option.count !== undefined"
                class="ml-0.5 rounded-full px-1.5 py-0.2 text-[10px] font-mono leading-none transition-colors"
                :class="isSelected(option) ? 'bg-[color-mix(in_srgb,var(--text-inverse)_22%,transparent)] text-[var(--text-inverse)]' : 'bg-[color-mix(in_srgb,var(--text-main)_12%,transparent)] text-[var(--text-muted)]'"
            >
                {{ option.count }}
            </span>

            <!-- 智能竖向分隔线：在未选中相邻项之间优雅显隐 -->
            <span
                v-if="idx < props.options.length - 1"
                class="absolute right-0 top-1.5 bottom-1.5 w-[1px] bg-[color-mix(in_srgb,var(--text-main)_14%,transparent)] pointer-events-none transition-opacity [transition-duration:var(--motion-fast)]"
                :class="isSelected(option) || idx === selectedIndex - 1 ? 'opacity-0' : 'opacity-100'"
            />
        </button>
    </div>
</template>
