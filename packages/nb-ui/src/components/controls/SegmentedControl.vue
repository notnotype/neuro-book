<script setup lang="ts">
import type {HTMLAttributes} from "vue";
import {computed, nextTick, ref} from "vue";
import {moveRoving, rovingMove} from "../../utils/roving";

import {useFieldContext} from "../form/field-context";
import type {ControlSize} from "../shared-types";

/**
 * 分段选择器（SegmentedControl · 经典 macOS 系统蓝平滑滑动体系）。
 *
 * 视觉与动效规范：
 * 1. 底座：圆角消费 var(--radius-control)，10% 柔灰实底 + 1px 细微反光外框；
 * 2. 指示块：纯正 Apple 蓝（var(--accent-main)）+ 纯白反色文字 + 舒缓物理滑动动画（消费 var(--motion-move) 与 var(--ease-layout)）；
 * 3. 分隔线：未选中项之间配备 1px 细微竖向分隔线，在选中项相邻两侧智能平滑消隐；
 * 4. 无障碍与键盘：支持标准 WAI-ARIA RadioGroup 模式与 ArrowLeft/ArrowRight/Home/End 键盘巡检。
 * 5. 在表单里（三项以内、没有说明的单选）照表单控件的统一合同：名字来自 `Field` 的组形态，停用、只读、出错同其它控件
 *    （docs/specs/ui/forms.md 输出 26–28）。
 */

export type SegmentedControlValue = string | number | boolean | null;
export type SegmentedControlSize = Extract<ControlSize, "xs" | "sm">;

export type SegmentedControlOption = {
    count?: number | string;
    disabled?: boolean;
    iconClass?: string;
    label?: string;
    testId?: string;
    title?: string;
    value: SegmentedControlValue;
};

const props = withDefaults(defineProps<{
    modelValue: SegmentedControlValue;
    options: SegmentedControlOption[];
    ariaLabel?: string;
    size?: SegmentedControlSize;
    wrap?: boolean;
    fullWidth?: boolean;
    /** 整组停用。 */
    disabled?: boolean;
    /** 只读：可以聚焦、写 `aria-readonly`，方向键只移动焦点，点击与方向键都不改值（docs/specs/ui/forms.md 输出 28）。 */
    readonly?: boolean;
    /** 出错外观与 `aria-invalid`；与 `Field` 上下文的出错取或。 */
    invalid?: boolean;
    /** 必填：写 `aria-required`；与 `Field` 上下文的必填取或。 */
    required?: boolean;
} & /* @vue-ignore */ HTMLAttributes>(), {
    ariaLabel: "",
    size: "sm",
    wrap: false,
    fullWidth: false,
    disabled: false,
    readonly: false,
    invalid: false,
    required: false,
});

const emit = defineEmits<{
    (e: "update:modelValue", value: SegmentedControlValue): void;
}>();

const rootRef = ref<HTMLDivElement | null>(null);

/** 组的名字来自字段的标签（`Field` 的组形态，docs/specs/ui/forms.md 输出 27）。 */
const field = useFieldContext();
const isInvalid = computed(() => props.invalid || field?.invalid.value === true);

function optionDisabled(option: SegmentedControlOption): boolean {
    return props.disabled || option.disabled === true;
}

function optionKey(option: SegmentedControlOption): string {
    return `${typeof option.value}:${String(option.value)}`;
}

function isSelected(option: SegmentedControlOption): boolean {
    return option.value === props.modelValue;
}

const selectedIndex = computed(() => props.options.findIndex((opt) => opt.value === props.modelValue));

const enabledOptions = computed(() => props.options.filter((opt) => !optionDisabled(opt)));

/**
 * 键盘进入组时停在哪一项：启用的选中项；当前值不对应任何一项（例如 Lab 手动拖出的画布尺寸），或对应的是停用项（表单里
 * “已不存在”的当前值）时停在第一个启用项，否则整组没有 Tab 停靠点，键盘进不来。整组停用时没有停靠点。
 */
const tabStopKey = computed(() => {
    const selected = props.options[selectedIndex.value];
    const option = selected !== undefined && !optionDisabled(selected) ? selected : enabledOptions.value[0];
    return option === undefined ? null : optionKey(option);
});

/**
 * 段宽规则：各段等宽，宽度随内容时取最宽一段的自然宽度。指示块按「内容宽 ÷ 段数」定宽、按整段平移，
 * 只有段段等宽它才对得上。
 *
 * 不用 flex 等分：`flex: 1 1 0%` 的组宽度随内容时是各段自然宽度之和，再平分给每段，最长的那段必然放不下被截断。
 * 网格的 `1fr` 列在组宽度随内容时取各段里最大的自然宽度，给了宽度（`fullWidth` 或宿主定宽）时平分那个宽度；
 * 列的下限写 0：宽度不够时各段一起收窄、截断标签，组不撑出父级。
 * 指示块是绝对定位，不占网格单元；网格里绝对定位子元素的静态位置在内边距外沿（flex 里在内容框），所以它的
 * `left` 显式写成与内边距相同的 2px。`wrap` 要换行，网格做不到，仍用 flex。
 */
const segmentLayoutClass = computed(() => {
    if (props.wrap) {
        return [props.fullWidth ? "flex w-full" : "inline-flex", "flex-wrap"];
    }
    return [props.fullWidth ? "grid w-full" : "inline-grid", "grid-flow-col auto-cols-[minmax(0,1fr)]"];
});

function selectOption(option: SegmentedControlOption): void {
    if (optionDisabled(option) || props.readonly) {
        return;
    }
    emit("update:modelValue", option.value);
}

/** 键盘无障碍：支持左右方向键、Home/End 快速切换并同步聚焦 */
function handleKeydown(event: KeyboardEvent): void {
    const enabled = enabledOptions.value;
    if (enabled.length <= 1) return;
    const move = rovingMove(event.key, "both");
    if (move === null) return;
    event.preventDefault();

    // 只读时选中不动，方向键从焦点所在的项走；没有起点时，向后从第一项开始、向前从最后一项开始（moveRoving 的起点规则）。
    const focusedValue = (document.activeElement as HTMLElement | null)?.dataset?.value;
    const from = props.readonly
        ? enabled.findIndex((opt) => String(opt.value) === focusedValue)
        : enabled.findIndex((opt) => opt.value === props.modelValue);
    const targetOpt = enabled[moveRoving(enabled, from, move)];
    if (targetOpt) {
        if (!props.readonly) selectOption(targetOpt);
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
        role="radiogroup"
        :id="field?.inputId.value"
        :aria-label="props.ariaLabel || undefined"
        :aria-labelledby="field?.labelId.value"
        :aria-describedby="field?.ariaDescribedby.value"
        :aria-invalid="isInvalid ? 'true' : undefined"
        :aria-readonly="props.readonly || undefined"
        :aria-required="props.required || field?.required.value === true || undefined"
        :aria-disabled="props.disabled || undefined"
        class="relative max-w-full items-stretch rounded-[var(--radius-control)] border-[length:var(--border-w)] border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] bg-[color-mix(in_srgb,var(--text-main)_10%,transparent)] p-[2px] select-none box-border outline-none"
        :class="[segmentLayoutClass, isInvalid ? '!border-[color:var(--status-danger)]' : '', props.disabled ? 'opacity-45' : '']"
        @keydown="handleKeydown"
    >
        <!-- 舒缓平滑滑动背景指示块（单选且选项固定等分时连续 GPU 硬件滑动） -->
        <div
            v-if="selectedIndex >= 0 && !props.wrap"
            class="absolute top-[2px] bottom-[2px] left-[2px] rounded-[max(2px,calc(var(--radius-control)-2px))] bg-[var(--accent-main)] text-[var(--text-inverse)] shadow-[0_2px_8px_color-mix(in_srgb,var(--accent-main)_38%,transparent),0_0_0_1px_color-mix(in_srgb,var(--accent-main)_30%,transparent)] pointer-events-none transition-[transform,width,background-color,color,box-shadow] [transition-duration:var(--motion-move)] [transition-timing-function:var(--ease-layout)] will-change-transform"
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
            :aria-checked="isSelected(option)"
            :tabindex="optionKey(option) === tabStopKey ? 0 : -1"
            :disabled="optionDisabled(option)"
            :aria-label="option.title || option.label || undefined"
            :title="option.title || option.label"
            :data-testid="option.testId"
            class="nb-ui-focus-ring relative z-10 inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[max(2px,calc(var(--radius-control)-2px))] [font-weight:var(--weight-medium)] transition-[color,transform,opacity] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-layout)] disabled:cursor-not-allowed disabled:hover:bg-transparent"
            :class="[
                props.wrap ? 'flex-1' : '',
                props.size === 'xs'
                    ? (option.label ? 'h-[calc(var(--control-h-sm)-var(--space-1)*2)] px-2 text-[length:var(--text-xs)]' : 'h-[calc(var(--control-h-sm)-var(--space-1)*2)] px-1.5 text-[length:var(--text-xs)]')
                    : (option.label ? 'h-[calc(var(--control-h-sm)-var(--space-1))] px-3 text-xs' : 'h-[calc(var(--control-h-sm)-var(--space-1))] px-2 text-xs'),
                isSelected(option)
                    ? 'text-[var(--text-inverse)] font-semibold'
                    : props.readonly ? 'text-[var(--text-muted)]' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]',
                // 整组停用时只在根上降一次透明度（同单选组的 45%），各项不再各自变淡：两层叠起来选中块上的字读不出来。
                option.disabled === true && !props.disabled ? 'opacity-35' : '',
                // 只读不画成可点：悬停不变色、按下不缩。
                props.readonly ? 'cursor-default' : 'cursor-pointer not-disabled:active:scale-[0.96]',
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
                class="ml-0.5 rounded-full px-1.5 py-[0.05rem] text-[length:var(--text-2xs)] font-mono leading-none transition-colors"
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
