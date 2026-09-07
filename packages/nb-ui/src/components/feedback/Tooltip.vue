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
                <!-- Tooltip 是最小浮层：小字贴边，读性靠面不靠 blur。
                     显式给不透明纸面（--bg-panel）与实线描边，不吃 .nb-ui-popover-surface
                     的 14% 玻璃配方——那套是给大浮层的，小气泡压在浅色页面上会隐形。
                     箭头用原生三角 fill 同色、不描边，位于气泡边缘内缩盖住边框线，
                     与气泡连成一体；禁用 trigger 点击关闭（disableClosingTrigger），
                     说明性提示不应被点击打断。 -->
                <TooltipContent
                    :side="props.placement"
                    :side-offset="7"
                    :style="{zIndex: NB_Z_INDEX.tooltip, borderRadius: 'var(--radius-control)', backgroundColor: 'var(--bg-panel)', border: '1px solid var(--panel-outline)', boxShadow: 'var(--elevation-popover)'}"
                    class="pointer-events-none w-max max-w-64 px-2.5 py-1.5 text-xs leading-relaxed text-[var(--text-main)]"
                >
                    <TooltipArrow :width="14" :height="7" class="relative -top-px fill-[var(--bg-panel)]" />
                    <span class="block">
                        <slot name="content">{{ props.text }}</slot>
                    </span>
                </TooltipContent>
            </TooltipPortal>
        </TooltipRoot>
    </TooltipProvider>
</template>
