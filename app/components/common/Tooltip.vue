<script setup lang="ts">
import {useEventListener} from "@vueuse/core";
import {cloneVNode, computed, isVNode, nextTick, onBeforeUnmount, onMounted, ref, useId, useSlots, type VNode} from "vue";
import {IDE_THEME_HOST_CLASS} from "nbook/app/utils/theme/theme-tokens";
import {
    computeTooltipPosition,
    type TooltipEffectivePlacement,
    type TooltipPlacement,
} from "nbook/app/utils/tooltip-position";

const props = withDefaults(defineProps<{
    text: string;
    placement?: TooltipPlacement;
    showDelay?: number;
    hideDelay?: number;
}>(), {
    placement: "right",
    showDelay: 300,
    hideDelay: 100,
});

const slots = useSlots();
const rootRef = ref<HTMLElement | null>(null);
const triggerRef = ref<HTMLElement | null>(null);
const tooltipRef = ref<HTMLElement | null>(null);
const isMounted = ref(false);
const visible = ref(false);
const position = ref<TooltipPosition>({x: 0, y: 0, placement: "right"});
const tooltipId = `nbook-tooltip-${useId().replace(/:/g, "")}`;

let showTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

/** 跟随现有浮层范式：Teleport 到主题宿主内，保证主题变量可解析。 */
const teleportTarget = computed<HTMLElement | string>(() => {
    return rootRef.value?.closest(`.${IDE_THEME_HOST_CLASS}`) as HTMLElement | null ?? "body";
});

const hasContent = computed(() => props.text.trim().length > 0);

/**
 * 基于当前插槽内容克隆根节点，把 aria-describedby 与测量 ref 挂到真实触发元素上。
 * 必须用普通函数而非 computed：computed 不会因父组件重渲染产生的「同引用新插槽内容」而失效，
 * 会导致按钮的 disabled/class 等属性停留在旧状态（已实测复现）。
 */
function renderTrigger(): VNode[] {
    const nodes = slots.default?.() ?? [];
    if (nodes.length === 0 || !isVNode(nodes[0])) {
        return nodes;
    }
    const [first, ...rest] = nodes;
    const cloned = cloneVNode(first, {
        ref: (element: unknown) => {
            triggerRef.value = element as HTMLElement | null;
        },
        "aria-describedby": visible.value ? tooltipId : undefined,
    }, true);
    return [cloned, ...rest];
}

/** 箭头所在边：与「实际出现在哪一侧」相反（tooltip 在右侧 → 箭头贴左边缘）。 */
const ARROW_EDGE_BY_PLACEMENT: Record<TooltipEffectivePlacement, TooltipEffectivePlacement> = {
    left: "right",
    right: "left",
    top: "bottom",
    bottom: "top",
};
const arrowEdge = computed(() => ARROW_EDGE_BY_PLACEMENT[position.value.placement]);

function clearTimers(): void {
    if (showTimer !== null) {
        clearTimeout(showTimer);
        showTimer = null;
    }
    if (hideTimer !== null) {
        clearTimeout(hideTimer);
        hideTimer = null;
    }
}

function updatePosition(): void {
    const trigger = triggerRef.value ?? (rootRef.value?.firstElementChild as HTMLElement | null);
    const tooltip = tooltipRef.value;
    if (!trigger || !tooltip) {
        return;
    }
    position.value = computeTooltipPosition(
        trigger.getBoundingClientRect(),
        tooltip.getBoundingClientRect(),
        props.placement,
        {left: 0, top: 0, width: window.innerWidth, height: window.innerHeight},
    );
}

function open(): void {
    if (!hasContent.value) {
        return;
    }
    visible.value = true;
    void nextTick(() => {
        updatePosition();
    });
}

function show(immediate = false): void {
    if (!hasContent.value) {
        return;
    }
    clearTimers();
    if (immediate) {
        open();
        return;
    }
    showTimer = setTimeout(() => {
        showTimer = null;
        open();
    }, props.showDelay);
}

function hide(immediate = false): void {
    clearTimers();
    if (!visible.value) {
        return;
    }
    if (immediate) {
        visible.value = false;
        return;
    }
    hideTimer = setTimeout(() => {
        hideTimer = null;
        visible.value = false;
    }, props.hideDelay);
}

function handleMouseEnter(): void {
    show(false);
}

function handleMouseLeave(): void {
    hide(false);
}

function handleFocusIn(): void {
    show(true);
}

function handleFocusOut(): void {
    hide(true);
}

function handleClick(): void {
    hide(true);
}

onMounted(() => {
    isMounted.value = true;
    useEventListener(window, "scroll", () => hide(true), {capture: true});
    useEventListener(window, "pointerdown", () => hide(true));
    useEventListener(window, "resize", () => hide(true));
});

onBeforeUnmount(() => {
    clearTimers();
});
</script>

<template>
    <span
        ref="rootRef"
        class="contents"
        @mouseenter="handleMouseEnter"
        @mouseleave="handleMouseLeave"
        @focusin="handleFocusIn"
        @focusout="handleFocusOut"
        @click="handleClick"
    >
        <template v-for="(node, index) in renderTrigger()" :key="node.key ?? `tooltip-slot-${index}`">
            <component :is="node" />
        </template>

        <Teleport v-if="isMounted" :to="teleportTarget">
            <Transition name="tooltip-fade">
                <div
                    v-if="visible"
                    ref="tooltipRef"
                    :id="tooltipId"
                    role="tooltip"
                    class="tooltip-popover fixed z-[9050] rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 py-1 text-xs text-[var(--text-main)] shadow-xl"
                    :style="{left: `${position.x}px`, top: `${position.y}px`}"
                >
                    <span class="tooltip-arrow" :class="`tooltip-arrow--${arrowEdge}`"></span>
                    <span class="block max-w-[220px] truncate">{{ text }}</span>
                </div>
            </Transition>
        </Teleport>
    </span>
</template>

<style scoped>
.tooltip-popover {
    pointer-events: none;
}

.tooltip-arrow {
    position: absolute;
    width: 8px;
    height: 8px;
    background: var(--bg-panel);
    transform: rotate(45deg);
}

.tooltip-arrow--left {
    left: -4px;
    top: 50%;
    margin-top: -4px;
    border-left: 1px solid var(--border-color);
    border-bottom: 1px solid var(--border-color);
}

.tooltip-arrow--right {
    right: -4px;
    top: 50%;
    margin-top: -4px;
    border-right: 1px solid var(--border-color);
    border-top: 1px solid var(--border-color);
}

.tooltip-arrow--top {
    top: -4px;
    left: 50%;
    margin-left: -4px;
    border-left: 1px solid var(--border-color);
    border-top: 1px solid var(--border-color);
}

.tooltip-arrow--bottom {
    bottom: -4px;
    left: 50%;
    margin-left: -4px;
    border-right: 1px solid var(--border-color);
    border-bottom: 1px solid var(--border-color);
}

.tooltip-fade-enter-active,
.tooltip-fade-leave-active {
    transition: opacity 120ms ease;
}

.tooltip-fade-enter-from,
.tooltip-fade-leave-to {
    opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
    .tooltip-fade-enter-active,
    .tooltip-fade-leave-active {
        transition: none;
    }
}
</style>
