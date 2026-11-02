<script setup lang="ts">
import type {HTMLAttributes} from "vue";
import {computed} from "vue";
import type {ControlSize} from "../shared-types";

/**
 * 状态徽章（Badge · 方案 2-B 现代工作区超椭圆实心体系）。
 *
 * 视觉特征：
 * 1. 形态：采用饱满现代超椭圆（Squircle，消费 var(--radius-control) / calc），与 Button / Input 等控件形成统一几何律动；
 * 2. 材质：solid 模式采用纯正状态色实底 + 纯白反色文字 + 16% 微透光反光边 + 轻微柔影；
 * 3. 警示色调（warning）：采用深琥珀暖金配色（消费 var(--status-warning) 组合），告别刺眼柠檬黄；
 * 4. 支持 dot（状态圆点）、iconClass（图标）与 count（徽标）。
 */

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger";
export type BadgeVariant = "solid" | "soft" | "outline";
export type BadgeSize = Extract<ControlSize, "sm" | "md">;

const props = withDefaults(defineProps<{
    tone?: BadgeTone;
    variant?: BadgeVariant;
    size?: BadgeSize;
    /** 在文字前渲染一个同色状态圆点 */
    dot?: boolean;
    iconClass?: string;
    count?: number | string;
} & /* @vue-ignore */ HTMLAttributes>(), {
    tone: "neutral",
    variant: "solid",
    size: "md",
    dot: false,
    iconClass: "",
    count: undefined,
});

const toneClass = computed(() => `nb-badge--${props.tone}`);
const variantClass = computed(() => `nb-badge--${props.variant}`);

const sizeClass = computed(() => (props.size === "sm"
    ? "h-[calc(var(--control-h-sm)*0.68)] gap-[var(--space-1)] px-[calc(var(--control-px)*0.45)] text-[length:var(--text-2xs)] rounded-[max(2px,calc(var(--radius-control)-2px))]"
    : "h-[calc(var(--control-h-sm)*0.82)] gap-[var(--space-3)] px-[calc(var(--control-px)*0.6)] text-[length:var(--text-xs)] rounded-[var(--radius-control)]"));
</script>

<template>
    <span
        class="nb-badge inline-flex shrink-0 items-center whitespace-nowrap [font-weight:var(--weight-strong)] select-none transition-colors [transition-duration:var(--motion-fast)]"
        :class="[toneClass, variantClass, sizeClass]"
    >
        <span v-if="props.dot" class="h-1.5 w-1.5 shrink-0 rounded-full bg-current shadow-[0_0_3px_currentColor]"></span>
        <span v-if="props.iconClass" :class="props.iconClass" class="h-[1.15em] w-[1.15em] shrink-0 opacity-90"></span>
        <slot />
        <span
            v-if="props.count !== undefined"
            class="px-1 py-[0.05rem] rounded font-mono text-[length:var(--text-2xs)] bg-[color-mix(in_srgb,var(--text-inverse)_20%,transparent)] shadow-inner"
        >{{ props.count }}</span>
    </span>
</template>

<style scoped>
/* 状态映射：中性/强调/成功/警告/危险 */
.nb-badge {
    --nb-badge-tone: var(--text-secondary);
    --nb-badge-tone-bg: var(--bg-subtle);
    --nb-badge-tone-solid: color-mix(in srgb, var(--text-main) 65%, transparent);
    --nb-badge-tone-border: var(--border-color);
}

.nb-badge--accent {
    --nb-badge-tone: var(--accent-main);
    --nb-badge-tone-bg: color-mix(in srgb, var(--accent-main) 12%, transparent);
    --nb-badge-tone-solid: var(--accent-main);
    --nb-badge-tone-border: color-mix(in srgb, var(--accent-main) 30%, transparent);
}

.nb-badge--success {
    --nb-badge-tone: var(--status-success);
    --nb-badge-tone-bg: color-mix(in srgb, var(--status-success) 12%, transparent);
    --nb-badge-tone-solid: var(--status-success);
    --nb-badge-tone-border: color-mix(in srgb, var(--status-success) 30%, transparent);
}

/* 优化后的深琥珀暖金色（告别高亮刺眼黄与黑字） */
.nb-badge--warning {
    --nb-badge-tone: color-mix(in srgb, var(--status-warning) 80%, black);
    --nb-badge-tone-bg: color-mix(in srgb, var(--status-warning) 14%, transparent);
    --nb-badge-tone-solid: color-mix(in srgb, var(--status-warning) 82%, black);
    --nb-badge-tone-border: color-mix(in srgb, var(--status-warning) 35%, transparent);
}

.nb-badge--danger {
    --nb-badge-tone: var(--status-danger);
    --nb-badge-tone-bg: color-mix(in srgb, var(--status-danger) 12%, transparent);
    --nb-badge-tone-solid: var(--status-danger);
    --nb-badge-tone-border: color-mix(in srgb, var(--status-danger) 30%, transparent);
}

/* 核心方案 2-B：纯色实心 + 纯白反色文字 + 微反光边 + 微阴影 */
.nb-badge--solid {
    border: var(--border-w) solid color-mix(in srgb, var(--text-inverse) 16%, transparent);
    background-color: var(--nb-badge-tone-solid);
    color: var(--text-inverse);
    box-shadow: 0 1px 2px color-mix(in srgb, var(--shadow-color) 12%, transparent);
}

/* 柔光模式 */
.nb-badge--soft {
    border: var(--border-w) solid var(--nb-badge-tone-border);
    background-color: var(--nb-badge-tone-bg);
    color: var(--nb-badge-tone);
}

/* 镂空模式 */
.nb-badge--outline {
    border: var(--border-w) solid var(--nb-badge-tone-border);
    background-color: transparent;
    color: var(--nb-badge-tone);
}
</style>
