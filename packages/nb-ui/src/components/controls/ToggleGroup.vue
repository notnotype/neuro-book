<script setup lang="ts">
import {
    ToggleGroupItem,
    ToggleGroupRoot,
} from "reka-ui";
import type {AcceptableValue} from "reka-ui";
import type {ControlSize} from "../shared-types";

export interface ToggleGroupOption {
    value: string;
    label?: string;
    iconClass?: string;
    title?: string;
    disabled?: boolean;
}

export type ToggleGroupSize = Extract<ControlSize, "sm" | "md" | "lg">;

/**
 * 只做多选（可叠加的开关，例如格式按钮）：“几个里选一个”用 SegmentedControl，那边始终有一个选中项，
 * 不会像上游单选模式那样再点一次就清空。
 */
const props = withDefaults(defineProps<{
    modelValue?: string[];
    defaultValue?: string[];
    disabled?: boolean;
    size?: ToggleGroupSize;
    orientation?: "horizontal" | "vertical";
    options?: ToggleGroupOption[];
}>(), {
    modelValue: undefined,
    defaultValue: undefined,
    disabled: false,
    size: "md",
    orientation: "horizontal",
    options: () => [],
});

const emit = defineEmits<{
    (e: "update:modelValue", value: string[]): void;
}>();

// 上游的事件类型是单选与多选共用的联合；本组件固定多选，运行时总是数组，项目值也都是字符串。
function onUpdate(value: AcceptableValue | AcceptableValue[]): void {
    emit("update:modelValue", Array.isArray(value) ? value.map(String) : []);
}

function sizeClass(): string {
    if (props.size === "sm") return "h-6 px-2 text-[length:var(--text-xs)] min-w-[24px] gap-1";
    if (props.size === "lg") return "h-8 px-3 text-[length:var(--text-md)] min-w-[32px] gap-2";
    return "h-7 px-2.5 text-[length:var(--text-sm)] min-w-[28px] gap-1.5";
}
</script>

<template>
    <ToggleGroupRoot
        :model-value="props.modelValue"
        :default-value="props.defaultValue"
        type="multiple"
        :disabled="props.disabled"
        :orientation="props.orientation"
        class="inline-flex items-center gap-0.5 rounded-[var(--radius-control)] border border-[color-mix(in_srgb,var(--text-main)_10%,transparent)] bg-[color-mix(in_srgb,var(--text-main)_4%,transparent)] p-0.5 select-none"
        :class="props.orientation === 'vertical' ? 'flex-col' : 'flex-row'"
        @update:model-value="onUpdate"
    >
        <template v-if="props.options.length > 0">
            <ToggleGroupItem
                v-for="opt in props.options"
                :key="opt.value"
                :value="opt.value"
                :disabled="opt.disabled"
                v-bind="{title: opt.title || opt.label}"
                class="nb-ui-focus-ring inline-flex items-center justify-center rounded-[calc(var(--radius-control)-2px)] font-medium text-[var(--text-secondary)] transition-[background-color,color,transform,box-shadow] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] not-disabled:active:scale-[0.96] hover:bg-[color-mix(in_srgb,var(--text-main)_8%,transparent)] hover:text-[var(--text-main)] data-[state=on]:bg-[var(--bg-panel)] data-[state=on]:text-[var(--accent-main)] data-[state=on]:shadow-sm cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 disabled:active:transform-none"
                :class="sizeClass()"
            >
                <span v-if="opt.iconClass" :class="opt.iconClass" class="h-3.5 w-3.5 shrink-0 transition-transform" aria-hidden="true"></span>
                <span v-if="opt.label">{{ opt.label }}</span>
            </ToggleGroupItem>
        </template>
        <template v-else>
            <slot />
        </template>
    </ToggleGroupRoot>
</template>
