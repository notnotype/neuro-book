<script setup lang="ts">
import type {ButtonHTMLAttributes} from "vue";
import {focusRingClass} from "./focus-ring";
import type {FocusRingStyle} from "./focus-ring";
import type {ControlSize} from "../shared-types";

export type IconButtonVariant = "default" | "danger" | "accent" | "secondary";
export type IconButtonSize = Extract<ControlSize, "2xs" | "xs" | "sm" | "md" | "lg">;

const props = withDefaults(defineProps<{
    title?: string;
    ariaLabel?: string;
    variant?: IconButtonVariant;
    size?: IconButtonSize;
    disabled?: boolean;
    iconClass?: string;
    focusRing?: FocusRingStyle;
} & /* @vue-ignore */ ButtonHTMLAttributes>(), {
    title: "",
    ariaLabel: "",
    variant: "default",
    size: "md",
    disabled: false,
    iconClass: "",
    focusRing: "outer",
});

/*
 * 尺寸与材质消费主题 token。边长是定值、不取 --control-h-*：图标按钮多放在定宽的竖条与
 * 定高的工具条里（活动栏 48px 宽，lg 的 38px 两侧各留 5px 给焦点光环），随主题长高会被裁。
 * 零 Layout Shift，禁用态禁止任何缩放。
 */
function sizeClass(): string {
    if (props.size === "2xs") {
        // 标题行里的展开标记：14px 方框、12px 图标，整行可点时它只是状态的落点，不占标题前的空间。
        return "h-[14px] w-[14px] text-[length:9.6px] rounded-[4px]";
    }
    if (props.size === "xs") {
        // 一行 32px 的头部里的图标按钮：四周各留 4px，外扩光晕不被头部所在的面板裁掉。
        return "h-[24px] w-[24px] text-xs rounded-[var(--radius-button-sm)]";
    }
    if (props.size === "sm") {
        return "h-[26px] w-[26px] text-xs rounded-[var(--radius-button-sm)]";
    }
    if (props.size === "lg") {
        return "h-[38px] w-[38px] text-base rounded-[var(--radius-button-lg)]";
    }
    return "h-[32px] w-[32px] text-sm rounded-[var(--radius-button-md)]";
}

function variantClass(): string {
    if (props.variant === "danger") {
        return "text-[var(--text-muted)] hover:bg-[color-mix(in_srgb,var(--status-danger)_16%,transparent)] hover:text-[var(--status-danger)] active:bg-[color-mix(in_srgb,var(--status-danger)_24%,transparent)]";
    }
    if (props.variant === "accent") {
        return "text-[var(--accent-text)] hover:bg-[color-mix(in_srgb,var(--accent-main)_16%,transparent)] hover:text-[var(--accent-main)] active:bg-[color-mix(in_srgb,var(--accent-main)_24%,transparent)]";
    }
    if (props.variant === "secondary") {
        return "bg-[color-mix(in_srgb,var(--text-main)_8%,transparent)] text-[var(--text-main)] hover:bg-[color-mix(in_srgb,var(--text-main)_18%,transparent)] active:bg-[color-mix(in_srgb,var(--text-main)_24%,transparent)]";
    }
    return "text-[var(--text-secondary)] hover:bg-[color-mix(in_srgb,var(--text-main)_15%,transparent)] hover:text-[var(--text-main)] active:bg-[color-mix(in_srgb,var(--text-main)_24%,transparent)]";
}
</script>

<template>
    <!-- 通用紧凑图标按钮 -->
    <button
        type="button"
        :title="props.title"
        :aria-label="props.ariaLabel || props.title"
        :disabled="props.disabled"
        class="inline-flex shrink-0 items-center justify-center rounded-[var(--radius-control)] border-[length:var(--border-w)] border-transparent box-border transition-[background-color,color,transform,box-shadow] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] not-disabled:active:scale-[0.93] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:active:transform-none cursor-pointer"
        :class="[
            focusRingClass(props.focusRing),
            sizeClass(),
            variantClass(),
        ]"
    >
        <span v-if="props.iconClass" :class="props.iconClass" class="h-[1.25em] w-[1.25em] shrink-0" aria-hidden="true" />
        <slot />
    </button>
</template>
