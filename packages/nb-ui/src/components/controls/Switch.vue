<script setup lang="ts">
import {
    SwitchRoot,
    SwitchThumb,
} from "reka-ui";

export type SwitchSize = "sm" | "md" | "lg";

const props = withDefaults(defineProps<{
    modelValue?: boolean;
    defaultValue?: boolean;
    disabled?: boolean;
    size?: SwitchSize;
    name?: string;
    ariaLabel?: string;
}>(), {
    modelValue: undefined,
    defaultValue: false,
    disabled: false,
    size: "md",
    name: undefined,
    ariaLabel: "开关",
});

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
}>();
</script>

<template>
    <SwitchRoot
        :model-value="props.modelValue"
        :default-value="props.defaultValue"
        :disabled="props.disabled"
        :name="props.name"
        :aria-label="props.ariaLabel"
        class="nb-ui-focus-ring relative inline-flex shrink-0 items-center rounded-full border border-transparent transition-colors [transition-duration:var(--motion-base)] [transition-timing-function:var(--ease-standard)] cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 bg-[color-mix(in_srgb,var(--text-main)_16%,transparent)] data-[state=checked]:bg-[var(--accent-main)]"
        :class="[
            // 内边距必须与那 1px 透明边框（焦点环靠它上色）一起算：内容高 = 轨道高 − 2×边框 − 2×内边距。
            // `p-0.5` 会让 md 的内容区只剩 14px，装不下 16px 的滑块——滑块会从轨道右上角溢出去。
            props.size === 'sm' ? 'h-4 w-7 p-px' : '',
            props.size === 'md' ? 'h-5 w-9 p-px' : '',
            props.size === 'lg' ? 'h-6 w-11 p-px' : '',
        ]"
        @update:model-value="(val) => emit('update:modelValue', val)"
    >
        <SwitchThumb
            class="pointer-events-none block rounded-full bg-[var(--text-inverse)] shadow-[0_1px_2px_color-mix(in_srgb,var(--shadow-color)_25%,transparent)] transition-transform [transition-duration:var(--motion-base)] [transition-timing-function:var(--ease-standard)] will-change-transform translate-x-0"
            :class="[
                props.size === 'sm' ? 'h-3 w-3 data-[state=checked]:translate-x-3' : '',
                props.size === 'md' ? 'h-4 w-4 data-[state=checked]:translate-x-4' : '',
                props.size === 'lg' ? 'h-5 w-5 data-[state=checked]:translate-x-5' : '',
            ]"
        />
    </SwitchRoot>
</template>
