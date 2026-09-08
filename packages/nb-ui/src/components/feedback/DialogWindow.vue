<script setup lang="ts">
import {computed, getCurrentInstance, nextTick, onBeforeUnmount, ref, watch} from "vue";
import {useDraggable, useWindowSize} from "@vueuse/core";
import {DialogContent, DialogPortal, DialogRoot, DialogTitle} from "reka-ui";
import {NB_Z_INDEX} from "../../theme/z-index";
import IconButton from "../controls/IconButton.vue";

/**
 * 通用浮动窗口组件（非模态）。
 *
 * Reka 只提供 Dialog 的语义、Portal 与非模态生命周期；窗口定位、标题栏拖动和可选尺寸调整
 * 属于这个组件自身的窗口行为。这里明确保持 modal=false，不渲染遮罩，也不阻断窗口外交互。
 */

type DialogWindowResizeAxis = "width" | "height" | "both";

const props = withDefaults(defineProps<{
    /** 控制窗口显隐 */
    modelValue: boolean;
    /** 标题栏文字；没有标题或 header slot 时使用视觉隐藏的通用标题 */
    title?: string;
    /** 窗口宽度（px），拖动边界按此值收敛 */
    width?: number;
    /** 窗口高度，默认按内容自适应；启用 resize 时也可由宿主传入 px 字符串 */
    height?: string | number;
    /** 窗口最大高度 */
    maxHeight?: string;
    /** 允许调整窗口尺寸 */
    resizable?: boolean;
    /** 可调整的最小宽度（px） */
    minWidth?: number;
    /** 可调整的最小高度（px） */
    minHeight?: number;
    /** 是否显示关闭按钮 */
    closable?: boolean;
    /** Esc 键是否关闭 */
    closeOnEsc?: boolean;
    /** 是否处于忙碌态，忙碌时不允许关闭或调整尺寸 */
    busy?: boolean;
    /** 自定义 body 区域 class，用于接管内部滚动的场景 */
    bodyClass?: string;
    /** Teleport 目标；传入 false 仅用于内联测试或特殊宿主 */
    teleportTarget?: string | boolean;
}>(), {
    title: "",
    width: 560,
    height: "auto",
    maxHeight: "calc(100dvh - 80px)",
    resizable: false,
    minWidth: 320,
    minHeight: 240,
    closable: true,
    closeOnEsc: true,
    busy: false,
    bodyClass: "overflow-y-auto px-4 py-3",
    teleportTarget: "body",
});

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "request-close", reason: "close-button" | "esc"): void;
    (e: "update:width", value: number): void;
    (e: "update:height", value: number): void;
}>();

const instance = getCurrentInstance();
const windowRef = ref<HTMLElement | null>(null);
const dragHandleRef = ref<HTMLElement | null>(null);
const positioned = ref(false);
const draftWidth = ref<number | null>(null);
const draftHeight = ref<number | null>(null);
let resizeCleanup: (() => void) | null = null;

const {width: viewportWidth, height: viewportHeight} = useWindowSize();
const {x, y} = useDraggable(windowRef, {
    handle: dragHandleRef,
    preventDefault: true,
    initialValue: {x: 24, y: 24},
});

const portalTarget = computed(() => typeof props.teleportTarget === "string" ? props.teleportTarget : "body");
const displayWidth = computed(() => draftWidth.value ?? props.width);
const displayHeight = computed(() => draftHeight.value === null ? props.height : `${draftHeight.value}px`);
const effectiveWidth = computed(() => {
    const availableWidth = viewportWidth.value > 0 ? Math.max(0, viewportWidth.value - 24) : displayWidth.value;
    return Math.min(displayWidth.value, availableWidth);
});

/** 拖动边界收敛：窗口至少保留一角在视口内，标题栏始终可再次抓取。 */
const clampedX = computed(() => {
    const minX = 16 - effectiveWidth.value + 72;
    const maxX = Math.max(viewportWidth.value - 72, minX);
    return Math.min(Math.max(x.value, minX), maxX);
});
const clampedY = computed(() => {
    const maxY = Math.max(viewportHeight.value - 48, 8);
    return Math.min(Math.max(y.value, 8), maxY);
});

const windowStyle = computed(() => ({
    left: `${clampedX.value}px`,
    top: `${clampedY.value}px`,
    width: `${effectiveWidth.value}px`,
    height: displayHeight.value,
    maxHeight: props.maxHeight,
    zIndex: NB_Z_INDEX.dialogWindow,
}));

/** 判断父组件是否监听了 request-close，用于决定默认关闭行为。 */
const hasRequestCloseListener = computed(() => {
    return Boolean(instance?.vnode.props && "onRequestClose" in instance.vnode.props);
});

function requestClose(reason: "close-button" | "esc"): void {
    if (props.busy) {
        return;
    }
    emit("request-close", reason);
    if (!hasRequestCloseListener.value) {
        emit("update:modelValue", false);
    }
}

function handleRootOpenChange(open: boolean): void {
    if (open !== props.modelValue) {
        emit("update:modelValue", open);
    }
}

/** 非模态窗口保留页面外部交互，但不把外部 pointer/focus 当成关闭动作。 */
function preventOutsideInteraction(event: Event): void {
    event.preventDefault();
}

function handleEscapeKeyDown(event: KeyboardEvent): void {
    event.preventDefault();
    if (props.closeOnEsc) {
        requestClose("esc");
    }
}

function currentWidth(): number {
    return Math.max(props.minWidth, Math.round(props.width));
}

function currentHeight(): number {
    if (typeof props.height === "number" && Number.isFinite(props.height)) {
        return Math.max(props.minHeight, Math.round(props.height));
    }
    const pxHeight = typeof props.height === "string" ? /^([0-9]+(?:\.[0-9]+)?)px$/.exec(props.height.trim()) : null;
    if (pxHeight) {
        return Math.max(props.minHeight, Math.round(Number(pxHeight[1])));
    }
    const measuredHeight = windowRef.value?.getBoundingClientRect().height ?? 0;
    return measuredHeight > 0 ? Math.max(props.minHeight, Math.round(measuredHeight)) : props.minHeight;
}

function clampResize(value: number, minimum: number): number {
    return Math.max(minimum, Math.round(value));
}

function startResize(axis: DialogWindowResizeAxis, event: PointerEvent): void {
    if (!props.resizable || props.busy) {
        return;
    }
    resizeCleanup?.();
    const handle = event.currentTarget as HTMLElement;
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = currentWidth();
    const startHeight = currentHeight();
    event.preventDefault();
    handle.setPointerCapture?.(event.pointerId);

    const move = (moveEvent: PointerEvent): void => {
        if (axis === "width" || axis === "both") {
            draftWidth.value = clampResize(startWidth + moveEvent.clientX - startX, props.minWidth);
        }
        if (axis === "height" || axis === "both") {
            draftHeight.value = clampResize(startHeight + moveEvent.clientY - startY, props.minHeight);
        }
    };
    const finish = (commit: boolean): void => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", onPointerUp);
        handle.removeEventListener("pointercancel", onPointerCancel);
        if (commit) {
            if (draftWidth.value !== null && draftWidth.value !== startWidth) {
                emit("update:width", draftWidth.value);
            }
            if (draftHeight.value !== null && draftHeight.value !== startHeight) {
                emit("update:height", draftHeight.value);
            }
        }
        draftWidth.value = null;
        draftHeight.value = null;
        resizeCleanup = null;
    };
    const onPointerUp = (): void => finish(true);
    const onPointerCancel = (): void => finish(false);
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", onPointerUp);
    handle.addEventListener("pointercancel", onPointerCancel);
    resizeCleanup = () => finish(false);
}

function handleResizeKeydown(axis: DialogWindowResizeAxis, event: KeyboardEvent): void {
    if (!props.resizable || props.busy) {
        return;
    }
    const step = event.shiftKey ? 1 : 10;
    const horizontal = event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
    const vertical = event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0;
    if ((axis === "height" && horizontal !== 0) || (axis === "width" && vertical !== 0) || (horizontal === 0 && vertical === 0)) {
        return;
    }
    event.preventDefault();
    if (axis === "width" || axis === "both") {
        if (horizontal !== 0) {
            const current = currentWidth();
            const nextWidth = clampResize(current + horizontal, props.minWidth);
            if (nextWidth !== current) {
                emit("update:width", nextWidth);
            }
        }
    }
    if (axis === "height" || axis === "both") {
        if (vertical !== 0) {
            const current = currentHeight();
            const nextHeight = clampResize(current + vertical, props.minHeight);
            if (nextHeight !== current) {
                emit("update:height", nextHeight);
            }
        }
    }
}

watch(() => props.modelValue, (visible) => {
    if (!visible || positioned.value || typeof window === "undefined") {
        return;
    }
    void nextTick(() => {
        const initialLeft = Math.max(12, Math.min(viewportWidth.value - effectiveWidth.value - 12, viewportWidth.value - 72));
        x.value = initialLeft;
        y.value = 64;
        positioned.value = true;
    });
}, {immediate: true});

onBeforeUnmount(() => {
    resizeCleanup?.();
});
</script>

<template>
    <DialogRoot
        :open="props.modelValue"
        :modal="false"
        @update:open="handleRootOpenChange"
    >
        <DialogPortal :to="portalTarget" :disabled="props.teleportTarget === false">
            <DialogContent
                as-child
                :aria-describedby="undefined"
                @escape-key-down="handleEscapeKeyDown"
                @interact-outside="preventOutsideInteraction"
                @pointer-down-outside="preventOutsideInteraction"
                @focus-outside="preventOutsideInteraction"
            >
                <div
                    ref="windowRef"
                    data-dialog-window
                    data-dialog-surface
                    :style="windowStyle"
                    class="nb-dialog-window nb-ui-surface-rim fixed flex flex-col overflow-hidden rounded-xl border border-[var(--panel-outline)] text-[var(--text-main)] outline-none data-[state=closed]:pointer-events-none data-[state=closed]:opacity-0 data-[state=closed]:scale-[0.96]"
                >
                    <div class="flex shrink-0 items-center gap-2 border-b border-[var(--divider)] pr-2">
                        <span class="i-lucide-grip-vertical ml-4 h-4 w-4 shrink-0 cursor-move touch-none text-[var(--text-muted)]" aria-hidden="true"></span>
                        <div ref="dragHandleRef" class="min-w-0 flex-1 cursor-move touch-none select-none">
                            <DialogTitle v-if="$slots.header" as="div" class="truncate text-sm font-semibold leading-snug text-[var(--text-main)]">
                                <slot name="header" />
                            </DialogTitle>
                            <DialogTitle v-else-if="props.title" class="truncate text-sm font-semibold leading-snug text-[var(--text-main)]">
                                {{ props.title }}
                            </DialogTitle>
                            <DialogTitle v-else class="sr-only">Dialog window</DialogTitle>
                        </div>
                        <IconButton v-if="props.closable" title="关闭" :disabled="props.busy" @click="requestClose('close-button')">
                            <span class="i-lucide-x h-4 w-4"></span>
                        </IconButton>
                    </div>

                    <div class="flex min-h-0 flex-1 flex-col text-sm leading-relaxed text-[var(--text-secondary)]" :class="props.bodyClass">
                        <slot />
                    </div>

                    <div v-if="$slots.footer" class="flex shrink-0 items-center justify-end gap-2.5 border-t border-[var(--divider)] px-4 py-2">
                        <slot name="footer" />
                    </div>

                    <template v-if="props.resizable">
                        <div
                            data-dialog-resize="right"
                            role="separator"
                            aria-orientation="vertical"
                            aria-label="调整窗口宽度"
                            :aria-valuemin="props.minWidth"
                            :aria-valuenow="displayWidth"
                            :tabindex="props.busy ? -1 : 0"
                            class="absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize outline-none"
                            @pointerdown="startResize('width', $event)"
                            @keydown="handleResizeKeydown('width', $event)"
                        ></div>
                        <div
                            data-dialog-resize="bottom"
                            role="separator"
                            aria-orientation="horizontal"
                            aria-label="调整窗口高度"
                            :aria-valuemin="props.minHeight"
                            :aria-valuenow="currentHeight()"
                            :tabindex="props.busy ? -1 : 0"
                            class="absolute inset-x-0 bottom-0 z-10 h-2 cursor-ns-resize outline-none"
                            @pointerdown="startResize('height', $event)"
                            @keydown="handleResizeKeydown('height', $event)"
                        ></div>
                        <div
                            data-dialog-resize="corner"
                            role="separator"
                            aria-label="调整窗口大小"
                            :aria-valuemin="props.minWidth"
                            :aria-valuenow="displayWidth"
                            :tabindex="props.busy ? -1 : 0"
                            class="absolute bottom-0 right-0 z-20 h-3 w-3 cursor-se-resize outline-none"
                            @pointerdown="startResize('both', $event)"
                            @keydown="handleResizeKeydown('both', $event)"
                        ></div>
                    </template>
                </div>
            </DialogContent>
        </DialogPortal>
    </DialogRoot>
</template>

<style scoped>
.nb-dialog-window {
    background-color: color-mix(in srgb, var(--bg-panel) 86%, transparent);
    backdrop-filter: blur(14px);
    box-shadow: var(--elevation-popover);
    transition:
        opacity var(--motion-base) var(--ease-standard),
        transform var(--motion-base) var(--ease-standard);
}
</style>
