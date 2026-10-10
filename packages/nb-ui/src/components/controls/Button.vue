<script setup lang="ts">
export type ButtonVariant = "primary" | "secondary" | "subtle" | "danger" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

const props = withDefaults(defineProps<{
    variant?: ButtonVariant;
    size?: ButtonSize;
    block?: boolean;
    disabled?: boolean;
    loading?: boolean;
    iconClass?: string;
    type?: "button" | "submit" | "reset";
}>(), {
    variant: "primary",
    size: "md",
    block: false,
    disabled: false,
    loading: false,
    iconClass: "",
    type: "button",
});

/*
 * 尺寸与材质取自设计推演选定的 BH1-C 方案：
 * - 紧凑尺寸与精致圆角（sm: 26px/6px, md: 32px/8px, lg: 38px/10px）
 * - 纯净半透层次（Secondary 为 8% 浅底，Hover 跃升至 18% 饱满实底 + 2px 触觉柔光底影）
 * - Primary/Danger 绑定品牌与状态色 + 柔光底晕
 */
function sizeClass(): string {
    if (props.size === "sm") {
        return "h-[26px] px-2.5 text-[12px] gap-1 rounded-[6px]";
    }
    if (props.size === "lg") {
        return "h-[38px] px-4.5 text-[14px] gap-2 rounded-[10px]";
    }
    return "h-[32px] px-3.5 text-[13px] gap-1.5 rounded-[8px]";
}

function variantClass(): string {
    if (props.variant === "secondary") {
        return "bg-[color-mix(in_srgb,var(--text-main)_8%,transparent)] text-[var(--text-main)] hover:bg-[color-mix(in_srgb,var(--text-main)_18%,transparent)] hover:shadow-[0_2px_6px_color-mix(in_srgb,var(--shadow-color)_12%,transparent)] active:bg-[color-mix(in_srgb,var(--text-main)_24%,transparent)]";
    }
    if (props.variant === "subtle") {
        return "bg-[color-mix(in_srgb,var(--text-main)_5%,transparent)] text-[var(--text-secondary)] hover:bg-[color-mix(in_srgb,var(--text-main)_14%,transparent)] hover:text-[var(--text-main)]";
    }
    if (props.variant === "danger") {
        return "bg-[var(--status-danger)] text-[var(--text-inverse)] hover:bg-[color-mix(in_srgb,var(--status-danger)_86%,var(--text-main))] hover:shadow-[0_2.5px_8px_color-mix(in_srgb,var(--status-danger)_40%,transparent)]";
    }
    if (props.variant === "ghost") {
        return "bg-transparent text-[var(--text-secondary)] hover:bg-[color-mix(in_srgb,var(--text-main)_10%,transparent)] hover:text-[var(--text-main)]";
    }
    return "bg-[var(--accent-main)] text-[var(--text-inverse)] shadow-[0_1px_2px_color-mix(in_srgb,var(--accent-main)_25%,transparent)] hover:bg-[color-mix(in_srgb,var(--accent-main)_86%,var(--text-main))] hover:shadow-[0_2.5px_8px_color-mix(in_srgb,var(--accent-main)_40%,transparent)] active:shadow-[0_1px_2px_color-mix(in_srgb,var(--accent-main)_20%,transparent)]";
}
</script>

<template>
    <button
        :type="props.type"
        :disabled="props.disabled || props.loading"
        class="nb-ui-focus-ring inline-flex items-center justify-center font-medium whitespace-nowrap outline-none select-none box-border border border-transparent cursor-pointer transition-[background-color,box-shadow,color,transform] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] not-disabled:active:scale-[0.975] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:shadow-none disabled:active:transform-none"
        :class="[
            sizeClass(),
            props.block ? 'w-full' : '',
            variantClass(),
        ]"
        :aria-busy="props.loading || undefined"
    >
        <span v-if="props.loading" class="i-lucide-loader-2 h-[1em] w-[1em] animate-spin shrink-0"></span>
        <span v-else-if="props.iconClass" :class="props.iconClass" class="h-[1.15em] w-[1.15em] shrink-0" aria-hidden="true"></span>
        <slot />
    </button>
</template>
