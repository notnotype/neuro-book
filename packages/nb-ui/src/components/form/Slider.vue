<script setup lang="ts">
import type {HTMLAttributes} from "vue";
import {computed} from "vue";

import {useUiText} from "../../text-port";
import {
    SliderRange,
    SliderRoot,
    SliderThumb,
    SliderTrack,
} from "reka-ui";
import type {ControlSize} from "../shared-types";

export type SliderSize = Extract<ControlSize, "sm" | "md" | "lg">;

const props = withDefaults(defineProps<{
    modelValue?: number | number[];
    defaultValue?: number | number[];
    min?: number;
    max?: number;
    step?: number;
    disabled?: boolean;
    orientation?: "horizontal" | "vertical";
    size?: SliderSize;
    name?: string;
    ariaLabel?: string;
} & /* @vue-ignore */ HTMLAttributes>(), {
    modelValue: undefined,
    defaultValue: () => [0],
    min: 0,
    max: 100,
    step: 1,
    disabled: false,
    orientation: "horizontal",
    size: "md",
    name: undefined,
    ariaLabel: undefined,
});

const text = useUiText();

const emit = defineEmits<{
    (e: "update:modelValue", value: number | number[]): void;
    (e: "valueCommit", value: number | number[]): void;
}>();

// 统一将单数值/数组归一化为 Reka UI 接受的 number[] 结构
const normalizedValue = computed(() => {
    if (props.modelValue === undefined) return undefined;
    return Array.isArray(props.modelValue) ? props.modelValue : [props.modelValue];
});

const normalizedDefaultValue = computed(() => {
    return Array.isArray(props.defaultValue) ? props.defaultValue : [props.defaultValue];
});

function handleUpdate(val: number[] | undefined) {
    if (!val) return;
    // 如果外部传入的是单个 number，则解包单值；否则派发数组
    if (typeof props.modelValue === "number" || (props.modelValue === undefined && !Array.isArray(props.defaultValue))) {
        emit("update:modelValue", val[0] ?? 0);
    } else {
        emit("update:modelValue", val);
    }
}

function handleValueCommit(val: number[]) {
    if (typeof props.modelValue === "number" || (props.modelValue === undefined && !Array.isArray(props.defaultValue))) {
        emit("valueCommit", val[0] ?? 0);
    } else {
        emit("valueCommit", val);
    }
}

// 尺寸映射
const trackSizeClass = computed(() => {
    if (props.orientation === "vertical") {
        if (props.size === "sm") return "w-1 h-full";
        if (props.size === "lg") return "w-2.5 h-full";
        return "w-1.5 h-full";
    }
    if (props.size === "sm") return "h-1 w-full";
    if (props.size === "lg") return "h-2.5 w-full";
    return "h-1.5 w-full";
});

const thumbSizeClass = computed(() => {
    if (props.size === "sm") return "h-3.5 w-3.5";
    if (props.size === "lg") return "h-5.5 w-5.5";
    return "h-4.5 w-4.5";
});

// Thumb 数量推导
const thumbCount = computed(() => {
    if (Array.isArray(props.modelValue)) return props.modelValue.length;
    if (Array.isArray(props.defaultValue)) return props.defaultValue.length;
    return 1;
});
</script>

<template>
    <SliderRoot
        :model-value="normalizedValue"
        :default-value="normalizedDefaultValue"
        :min="props.min"
        :max="props.max"
        :step="props.step"
        :disabled="props.disabled"
        :orientation="props.orientation"
        :name="props.name"
        class="relative flex items-center select-none touch-none cursor-pointer data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45"
        :class="[
            props.orientation === 'vertical' ? 'flex-col h-full min-h-[100px] w-5 justify-center' : 'w-full min-w-[80px] h-5',
        ]"
        @update:model-value="handleUpdate"
        @value-commit="handleValueCommit"
    >
        <!-- 轨道底槽 -->
        <SliderTrack
            class="relative grow rounded-[var(--radius-pill)] bg-[color-mix(in_srgb,var(--text-main)_12%,transparent)] overflow-hidden transition-colors"
            :class="trackSizeClass"
        >
            <!-- 激活范围高亮条 -->
            <SliderRange class="absolute rounded-[var(--radius-pill)] bg-[var(--accent-main)]" />
        </SliderTrack>

        <!-- 滑块 Thumb -->
        <SliderThumb
            v-for="index in thumbCount"
            :key="index"
            :aria-label="props.ariaLabel || text('slider.thumb', {index})"
            class="nb-ui-focus-ring block rounded-[var(--radius-pill)] bg-[var(--bg-panel)] shadow-[0_1px_3px_color-mix(in_srgb,var(--shadow-color)_20%,transparent),0_0_0_1px_color-mix(in_srgb,var(--text-main)_14%,transparent)] transition-[transform,box-shadow] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:scale-110 not-disabled:active:scale-95 disabled:hover:scale-100 disabled:cursor-not-allowed"
            :class="thumbSizeClass"
        />
    </SliderRoot>
</template>
