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
        <TooltipRoot :delay-duration="props.delay" :disabled="props.disabled">
            <TooltipTrigger as-child>
                <slot />
            </TooltipTrigger>
            <TooltipPortal>
                <TooltipContent
                    :side="props.placement"
                    :side-offset="6"
                    :style="{zIndex: NB_Z_INDEX.tooltip}"
                    class="nb-ui-popover-surface pointer-events-none w-max max-w-64 px-2.5 py-1.5 text-xs leading-relaxed text-[var(--text-main)]"
                >
                    <TooltipArrow class="fill-[color-mix(in_srgb,var(--bg-panel)_85%,transparent)] stroke-[color-mix(in_srgb,var(--text-main)_10%,transparent)] stroke-[1px]" />
                    <span class="block" :style="{borderRadius: 'var(--radius-control)'}">
                        <slot name="content">{{ props.text }}</slot>
                    </span>
                </TooltipContent>
            </TooltipPortal>
        </TooltipRoot>
    </TooltipProvider>
</template>
