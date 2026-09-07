<script setup lang="ts">
import {
    TooltipArrow,
    TooltipContent,
    TooltipPortal,
    TooltipProvider,
    TooltipRoot,
    TooltipTrigger,
} from "reka-ui";
import {NB_Z_INDEX} from "../../theme/z-index";

// 悬停提示：hover 延迟显示、focus 即时显示、click 切换、Esc 关闭。
// 定位与碰撞翻转交给 reka Popper，不再自己算视口边界。
export type TooltipPlacement = "top" | "bottom" | "left" | "right";

const props = withDefaults(defineProps<{
    /** 提示文本；富内容用 content 插槽覆盖 */
    text?: string;
    placement?: TooltipPlacement;
    /** hover 到显示的延迟毫秒数 */
    delay?: number;
    disabled?: boolean;
}>(), {
    text: "",
    placement: "top",
    delay: 300,
    disabled: false,
});
</script>

<template>
    <TooltipProvider :delay-duration="props.delay">
        <TooltipRoot :delay-duration="props.delay" :disabled="props.disabled" :disable-closing-trigger="true">
            <TooltipTrigger as-child>
                <slot />
            </TooltipTrigger>
            <TooltipPortal>
                <!-- Tooltip 气泡：主体大圆角 + 顶部/边缘圆润凸起（rounded tab），同色无描边。
                     reka Arrow 的 rounded 变体路径是「两侧曲线、顶部圆钝」的拱形凸起，
                     与主体同 fill、后置于 content 的边框之后渲染，视觉上是一体成型。
                     深色墨面保证任何配色/背景上都有明确轮廓。 -->
                <TooltipContent
                    :side="props.placement"
                    :side-offset="5"
                    :style="{zIndex: NB_Z_INDEX.tooltip, borderRadius: 'var(--radius-menu)', backgroundColor: 'color-mix(in srgb, var(--shadow-color) 88%, transparent)', boxShadow: '0 4px 12px color-mix(in srgb, var(--shadow-color) 24%, transparent)'}"
                    class="pointer-events-none w-max max-w-64 px-2.5 py-1 text-xs leading-relaxed text-[var(--text-inverse)]"
                >
                    <TooltipArrow :width="16" :height="7" :rounded="true" class="fill-[color-mix(in_srgb,var(--shadow-color)_88%,transparent)]" />
                    <span class="block">
                        <slot name="content">{{ props.text }}</slot>
                    </span>
                </TooltipContent>
            </TooltipPortal>
        </TooltipRoot>
    </TooltipProvider>
</template>
