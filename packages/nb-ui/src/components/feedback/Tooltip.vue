<script setup lang="ts">
import {computed, ref, watch} from "vue";
import {
    TooltipContent,
    TooltipPortal,
    TooltipProvider,
    TooltipRoot,
    TooltipTrigger,
} from "reka-ui";
import {usePopoverLayer} from "../../composables/usePopoverLayer";
import type {Align, Side} from "../shared-types";

const {zIndex: popoverZIndex} = usePopoverLayer();

// 悬停提示：hover 延迟显示、focus 即时显示、click 不打断已显示的提示、Esc 关闭。
// 定位与碰撞翻转交给 reka Popper，不再自己算视口边界。
const props = withDefaults(defineProps<{
    /** 提示文本；富内容用 content 插槽覆盖 */
    text?: string;
    side?: Side;
    align?: Align;
    /** hover 到显示的延迟毫秒数 */
    delay?: number;
    disabled?: boolean;
    /** 为真时提示显示，悬停与焦点的开合照旧叠加在上面；按 Esc 关掉后，要等它先变假再变真才会再次强制显示 */
    forceOpen?: boolean;
}>(), {
    text: "",
    side: "top",
    align: "center",
    delay: 300,
    disabled: false,
    forceOpen: false,
});

/*
 * 开合由这里受控：reka 的 `disabled` 只挡住新的悬停，不关已经开着的提示，也不撤悬停时已经排好的延时打开。
 * 点一下触发器把它变成禁用（例如打开了它旁边的面板）时，提示会在延时到点后照样冒出来，压在面板上面接走 Esc。
 */
const open = ref(false);
watch(() => props.disabled, (disabled) => {
    if (disabled) open.value = false;
});

function onOpenChange(value: boolean): void {
    open.value = value && !props.disabled;
}

/*
 * `forceOpen` 在悬停与焦点之上另加一路“显示”。reka 的其它关闭来源（指针离开、失焦）只关 `open`，管不到这一路：
 * 悬停离开不该把调用方强制显示的提示关掉。只有 Esc 例外，它是用户明说“收起来”，记在 `escDismissed` 里，
 * 直到 `forceOpen` 变假才清掉，下一次置真才重新强制显示（否则调用方的条件一直成立时，Esc 关不掉）。
 */
const escDismissed = ref(false);
watch(() => props.forceOpen, (forced) => {
    if (!forced) escDismissed.value = false;
});

const shown = computed(() => open.value || (props.forceOpen && !escDismissed.value && !props.disabled));

// 只在正被强制显示时记下：悬停或焦点打开的提示按 Esc 由 reka 自己关，记下来反而会吞掉之后的一次强制显示。
function onEscapeKeyDown(): void {
    if (props.forceOpen) escDismissed.value = true;
}
</script>

<template>
    <TooltipProvider :delay-duration="props.delay">
        <TooltipRoot :open="shown" :delay-duration="props.delay" :disabled="props.disabled" :disable-closing-trigger="true" @update:open="onOpenChange">
            <TooltipTrigger as-child>
                <slot />
            </TooltipTrigger>
            <TooltipPortal>
                <!-- Tooltip 是轻量说明性浮层：无箭头、对比色胶囊卡片、12px 文字、紧凑适度内边距。
                     通过清晰的 6px 间距声明指向关系，彻底避免三角箭头在复杂投影与描边下的变形与瑕疵。 -->
                <TooltipContent
                    :side="props.side"
                    :align="props.align"
                    :side-offset="6"
                    :style="{zIndex: popoverZIndex}"
                    @escape-key-down="onEscapeKeyDown"
                    class="nb-ui-tooltip-surface pointer-events-none w-max max-w-72 outline-none"
                >
                    <span class="block">
                        <slot name="content">{{ props.text }}</slot>
                    </span>
                </TooltipContent>
            </TooltipPortal>
        </TooltipRoot>
    </TooltipProvider>
</template>
