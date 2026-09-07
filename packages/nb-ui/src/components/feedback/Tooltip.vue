<script setup lang="ts">
import {
    TooltipContent,
    TooltipPortal,
    TooltipProvider,
    TooltipRoot,
    TooltipTrigger,
} from "reka-ui";
import {NB_Z_INDEX} from "../../theme/z-index";

// 悬停提示：hover 延迟显示、focus 即时显示、click 不打断已显示的提示、Esc 关闭。
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
                <!-- Tooltip 仍属于 popover 层级，但使用 compact modifier 表达小提示的形状与材质。
                     Reka 只负责 portal、定位、碰撞翻转和交互；箭头由 surface 伪元素绘制，
                     避免 SVG Arrow 旋转后产生独立布局框和错误边缘。 -->
                <TooltipContent
                    :side="props.placement"
                    :side-offset="6"
                    :style="{zIndex: NB_Z_INDEX.tooltip}"
                    class="nb-ui-popover-surface nb-ui-tooltip-surface pointer-events-none w-max max-w-64 outline-none"
                >
                    <span class="block">
                        <slot name="content">{{ props.text }}</slot>
                    </span>
                </TooltipContent>
            </TooltipPortal>
        </TooltipRoot>
    </TooltipProvider>
</template>
