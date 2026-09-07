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
                <!-- Tooltip 是最小浮层：不做箭头。箭头是「指向关系」的强声明，也最难做干净——
                     reka 的三角需要描边才不穿帮，一描边就变成独立三角贴片。
                     这里改用 macos 快速提示（NSHelpAnchor）的做法：无箭头、深色墨面、白字、
                     大圆角、紧凑内边距、轻阴影。指向关系由 6px 间距与位置表达，
                     深色面在任何配色/背景上都有明确轮廓，不再依赖边框与透明度。 -->
                <TooltipContent
                    :side="props.placement"
                    :side-offset="6"
                    :style="{zIndex: NB_Z_INDEX.tooltip, borderRadius: 'var(--radius-menu)', backgroundColor: 'color-mix(in srgb, var(--shadow-color) 88%, transparent)', boxShadow: '0 4px 12px color-mix(in srgb, var(--shadow-color) 24%, transparent)'}"
                    class="pointer-events-none w-max max-w-64 px-2.5 py-1 text-xs leading-relaxed text-[var(--text-inverse)]"
                >
                    <span class="block">
                        <slot name="content">{{ props.text }}</slot>
                    </span>
                </TooltipContent>
            </TooltipPortal>
        </TooltipRoot>
    </TooltipProvider>
</template>
