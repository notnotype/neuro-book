<script setup lang="ts">
import {computed, getCurrentInstance, inject, nextTick, onBeforeUnmount, provide, ref, watch} from "vue";
import {useWindowSize} from "@vueuse/core";
import {DialogContent, DialogPortal, DialogRoot, DialogTitle} from "reka-ui";
import {NB_DIALOG_WINDOW_DEPTH, NB_DIALOG_WINDOW_Z_STEP, NB_POPOVER_Z_INDEX, NB_Z_INDEX} from "../../theme/z-index";
import IconButton from "../controls/IconButton.vue";

/**
 * 浮动窗口可以有层级：从窗口里开出来的窗口要压住第一个窗口，窗口自己的下拉也要压住自己。
 * 深度由注入的父深度推出来，第一层仍是 NB_Z_INDEX.dialogWindow；每一层占 NB_DIALOG_WINDOW_Z_STEP 两格，
 * 于是「外层窗口 < 外层下拉 < 内层窗口 < 内层下拉」在数值上必然成立，整档不越过模态 Dialog。
 */
const windowDepth = inject(NB_DIALOG_WINDOW_DEPTH, 0) + 1;
const windowZIndex = NB_Z_INDEX.dialogWindow + (windowDepth - 1) * NB_DIALOG_WINDOW_Z_STEP;

provide(NB_DIALOG_WINDOW_DEPTH, windowDepth);
provide(NB_POPOVER_Z_INDEX, windowZIndex + 1);

/**
 * 通用浮动窗口组件（非模态）。
 *
 * Reka 只提供 Dialog 的语义、Portal 与非模态生命周期；窗口定位、标题栏拖动和可选尺寸调整
 * 属于这个组件自身的窗口行为。这里明确保持 modal=false，不渲染遮罩，也不阻断窗口外交互。
 */

/** 缩放方向：正号表示拖动时右/下边界跟随指针，负号表示左/上边界跟随指针。 */
type DialogWindowResizeDirection = {
    width: 0 | 1 | -1;
    height: 0 | 1 | -1;
};

type DialogWindowResizeHandle = {
    id: string;
    label: string;
    orientation?: "vertical" | "horizontal";
    direction: DialogWindowResizeDirection;
    class: string;
};

/**
 * 六个手柄：右、下两条边加四个角。角落要能任意拖，所以四个角都在；
 * 负方向（左/上）在拖动时同时改写窗口的 x / y。
 */
const RESIZE_HANDLES: DialogWindowResizeHandle[] = [
    {id: "right", label: "调整窗口宽度", orientation: "vertical", direction: {width: 1, height: 0}, class: "inset-y-0 right-0 w-2 cursor-ew-resize"},
    {id: "bottom", label: "调整窗口高度", orientation: "horizontal", direction: {width: 0, height: 1}, class: "inset-x-0 bottom-0 h-2 cursor-ns-resize"},
    {id: "bottom-right", label: "调整窗口大小", direction: {width: 1, height: 1}, class: "bottom-0 right-0 h-3 w-3 cursor-nwse-resize"},
    {id: "bottom-left", label: "调整窗口大小", direction: {width: -1, height: 1}, class: "bottom-0 left-0 h-3 w-3 cursor-nesw-resize"},
    {id: "top-right", label: "调整窗口大小", direction: {width: 1, height: -1}, class: "top-0 right-0 h-3 w-3 cursor-nesw-resize"},
    {id: "top-left", label: "调整窗口大小", direction: {width: -1, height: -1}, class: "top-0 left-0 h-3 w-3 cursor-nwse-resize"},
];

/** 尺寸字面量：宽高都给，调用方想只改一维就显式传 width / height。 */
const DIALOG_WINDOW_SIZE_PRESETS = {
    sm: {width: 420, height: 420},
    md: {width: 720, height: 640},
    lg: {width: 1100, height: 820},
} as const;

const props = withDefaults(defineProps<{
    /** 控制窗口显隐 */
    modelValue: boolean;
    /** 尺寸字面量；显式传入的 width / height 覆盖对应维度 */
    size?: keyof typeof DIALOG_WINDOW_SIZE_PRESETS;
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
    size: "md",
    title: "",
    width: undefined,
    height: undefined,
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
const x = ref(24);
const y = ref(24);
let resizeCleanup: (() => void) | null = null;
let dragCleanup: (() => void) | null = null;

const {width: viewportWidth, height: viewportHeight} = useWindowSize();

const portalTarget = computed(() => {
    if (props.teleportTarget === false) {
        return undefined;
    }
    if (typeof props.teleportTarget === "string") {
        if (typeof document !== "undefined") {
            const el = document.querySelector(props.teleportTarget);
            if (el) {
                return props.teleportTarget;
            }
        }
        // 当传入的选择器在当前上下文（如 Lab）中不存在时，平滑回退到 body
        return "body";
    }
    return "body";
});

/** 尺寸字面量只做缺省：显式传入的 width / height 覆盖对应维度。 */
const sizePreset = computed(() => DIALOG_WINDOW_SIZE_PRESETS[props.size]);
const resolvedWidth = computed(() => props.width ?? sizePreset.value.width);
const resolvedHeight = computed(() => props.height ?? sizePreset.value.height);
const displayWidth = computed(() => draftWidth.value ?? resolvedWidth.value);
const displayHeight = computed(() => {
    if (draftHeight.value !== null) {
        return `${draftHeight.value}px`;
    }
    // 数字必须补单位：直接绑数字 Vue 会写成 `height: 640`，浏览器当无效值丢掉。
    return typeof resolvedHeight.value === "number" ? `${resolvedHeight.value}px` : resolvedHeight.value;
});

const containerSize = computed(() => {
    if (props.teleportTarget === false && windowRef.value) {
        const parent = windowRef.value.offsetParent as HTMLElement | null;
        if (parent && parent !== document.body && parent.clientWidth > 0) {
            return {
                width: parent.clientWidth,
                height: parent.clientHeight,
            };
        }
    }
    return {
        width: viewportWidth.value,
        height: viewportHeight.value,
    };
});

const effectiveWidth = computed(() => {
    const availableWidth = containerSize.value.width > 0 ? Math.max(0, containerSize.value.width - 24) : displayWidth.value;
    return Math.min(displayWidth.value, availableWidth);
});

/** 拖动边界收敛：窗口至少保留一角在视口/宿主容器内，标题栏始终可再次抓取。 */
const clampedX = computed(() => {
    const minX = 16 - effectiveWidth.value + 72;
    const maxX = Math.max(containerSize.value.width - 72, minX);
    return Math.min(Math.max(x.value, minX), maxX);
});
const clampedY = computed(() => {
    const maxY = Math.max(containerSize.value.height - 48, 8);
    return Math.min(Math.max(y.value, 8), maxY);
});

const windowStyle = computed(() => ({
    left: `${clampedX.value}px`,
    top: `${clampedY.value}px`,
    width: `${effectiveWidth.value}px`,
    height: displayHeight.value,
    maxHeight: props.maxHeight,
    zIndex: windowZIndex,
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
    return Math.max(props.minWidth, Math.round(resolvedWidth.value));
}

function currentHeight(): number {
    const height = resolvedHeight.value;
    if (typeof height === "number" && Number.isFinite(height)) {
        return Math.max(props.minHeight, Math.round(height));
    }
    const pxHeight = typeof height === "string" ? /^([0-9]+(?:\.[0-9]+)?)px$/.exec(height.trim()) : null;
    if (pxHeight) {
        return Math.max(props.minHeight, Math.round(Number(pxHeight[1])));
    }
    const measuredHeight = windowRef.value?.getBoundingClientRect().height ?? 0;
    return measuredHeight > 0 ? Math.max(props.minHeight, Math.round(measuredHeight)) : props.minHeight;
}

function clampResize(value: number, minimum: number): number {
    return Math.max(minimum, Math.round(value));
}

function startDrag(event: PointerEvent): void {
    if (event.button !== 0 || props.busy) {
        return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, input, textarea, a, select, [data-interactive]")) {
        return;
    }
    const handle = dragHandleRef.value;
    if (!handle || !windowRef.value) {
        return;
    }

    dragCleanup?.();
    event.preventDefault();
    handle.setPointerCapture?.(event.pointerId);

    const startClientX = event.clientX;
    const startClientY = event.clientY;
    const startLeft = clampedX.value;
    const startTop = clampedY.value;

    const rect = windowRef.value.getBoundingClientRect();
    const offsetW = windowRef.value.offsetWidth;
    const offsetH = windowRef.value.offsetHeight;
    const scaleX = (offsetW > 0 && rect.width > 0) ? (rect.width / offsetW) : 1;
    const scaleY = (offsetH > 0 && rect.height > 0) ? (rect.height / offsetH) : 1;

    const move = (moveEvent: PointerEvent): void => {
        const deltaX = (moveEvent.clientX - startClientX) / scaleX;
        const deltaY = (moveEvent.clientY - startClientY) / scaleY;
        x.value = startLeft + deltaX;
        y.value = startTop + deltaY;
    };

    const finish = (): void => {
        try {
            handle.releasePointerCapture?.(event.pointerId);
        } catch {
            // ignore if already released
        }
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", finish);
        handle.removeEventListener("pointercancel", finish);
        dragCleanup = null;
    };

    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
    dragCleanup = finish;
}

function startResize(direction: DialogWindowResizeDirection, event: PointerEvent): void {
    if (!props.resizable || props.busy) {
        return;
    }
    resizeCleanup?.();
    const handle = event.currentTarget as HTMLElement;
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = currentWidth();
    const startHeight = currentHeight();
    const startLeft = clampedX.value;
    const startTop = clampedY.value;
    const rect = windowRef.value?.getBoundingClientRect();
    const offsetW = windowRef.value?.offsetWidth ?? 0;
    const offsetH = windowRef.value?.offsetHeight ?? 0;
    const scaleX = (offsetW > 0 && rect && rect.width > 0) ? (rect.width / offsetW) : 1;
    const scaleY = (offsetH > 0 && rect && rect.height > 0) ? (rect.height / offsetH) : 1;

    event.preventDefault();
    handle.setPointerCapture?.(event.pointerId);

    const move = (moveEvent: PointerEvent): void => {
        // 负方向手柄（左/上）拖动时，窗口的 x / y 跟着边界走：先算新尺寸，再由尺寸反推位置，
        // 这样触到最小尺寸时位置不会继续漂移。
        if (direction.width !== 0) {
            const delta = ((moveEvent.clientX - startX) / scaleX) * direction.width;
            const nextWidth = clampResize(startWidth + delta, props.minWidth);
            draftWidth.value = nextWidth;
            if (direction.width < 0) {
                x.value = startLeft + (startWidth - nextWidth);
            }
        }
        if (direction.height !== 0) {
            const delta = ((moveEvent.clientY - startY) / scaleY) * direction.height;
            const nextHeight = clampResize(startHeight + delta, props.minHeight);
            draftHeight.value = nextHeight;
            if (direction.height < 0) {
                y.value = startTop + (startHeight - nextHeight);
            }
        }
    };
    const finish = (commit: boolean): void => {
        try {
            handle.releasePointerCapture?.(event.pointerId);
        } catch {
            // ignore
        }
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

function handleResizeKeydown(direction: DialogWindowResizeDirection, event: KeyboardEvent): void {
    if (!props.resizable || props.busy) {
        return;
    }
    const step = event.shiftKey ? 1 : 10;
    const horizontal = event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
    const vertical = event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0;
    const wantsWidth = direction.width !== 0 && horizontal !== 0;
    const wantsHeight = direction.height !== 0 && vertical !== 0;
    if (!wantsWidth && !wantsHeight) {
        return;
    }
    event.preventDefault();
    // 负方向手柄上，方向键沿用「光标移动方向」：向左键让左边界继续向左，也就是变大。
    if (direction.width !== 0 && horizontal !== 0) {
        const current = currentWidth();
        const nextWidth = clampResize(current + horizontal * direction.width, props.minWidth);
        if (nextWidth !== current) {
            emit("update:width", nextWidth);
        }
    }
    if (direction.height !== 0 && vertical !== 0) {
        const current = currentHeight();
        const nextHeight = clampResize(current + vertical * direction.height, props.minHeight);
        if (nextHeight !== current) {
            emit("update:height", nextHeight);
        }
    }
}

watch(() => props.modelValue, (visible) => {
    if (!visible) {
        positioned.value = false;
        return;
    }
    if (positioned.value || typeof window === "undefined") {
        return;
    }
    void nextTick(() => {
        if (!windowRef.value) return;
        // 打开时居中：宽高都已知时正中央，高度按内容自适应时量一次实际高度，量不到就用 64px 顶距。
        const targetContainer = containerSize.value;
        const initialLeft = Math.max(12, Math.round((targetContainer.width - effectiveWidth.value) / 2));
        const rect = windowRef.value.getBoundingClientRect();
        const offsetH = windowRef.value.offsetHeight;
        const scaleY = (offsetH > 0 && rect.height > 0) ? (rect.height / offsetH) : 1;
        const measuredHeight = rect.height / scaleY;
        const initialTop = measuredHeight > 0
            ? Math.max(24, Math.round((targetContainer.height - measuredHeight) / 2))
            : 64;
        x.value = initialLeft;
        y.value = initialTop;
        positioned.value = true;
    });
}, {immediate: true});

onBeforeUnmount(() => {
    resizeCleanup?.();
    dragCleanup?.();
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
                    :class="windowDepth > 1 ? 'nb-dialog-window--nested' : ''"
                >
                    <div class="flex min-h-9 shrink-0 items-center border-b border-[var(--divider)] px-4 py-1">
                        <div ref="dragHandleRef" class="min-w-0 flex-1 cursor-move touch-none select-none" @pointerdown="startDrag">
                            <DialogTitle v-if="$slots.header" as="div" class="truncate text-sm font-semibold leading-snug text-[var(--text-main)]">
                                <slot name="header" />
                            </DialogTitle>
                            <DialogTitle v-else-if="props.title" class="truncate text-sm font-semibold leading-snug text-[var(--text-main)]">
                                {{ props.title }}
                            </DialogTitle>
                            <DialogTitle v-else class="sr-only">Dialog window</DialogTitle>
                        </div>
                        <div v-if="props.closable" class="flex w-[26px] shrink-0 justify-end">
                            <IconButton
                                title="关闭"
                                size="sm"
                                :disabled="props.busy"
                                @click="requestClose('close-button')"
                            >
                                <span class="i-lucide-x h-4 w-4"></span>
                            </IconButton>
                        </div>
                    </div>

                    <div class="flex min-h-0 flex-1 flex-col text-sm leading-relaxed text-[var(--text-secondary)]" :class="props.bodyClass">
                        <slot />
                    </div>

                    <div v-if="$slots.footer" class="flex shrink-0 items-center justify-end gap-2.5 border-t border-[var(--divider)] px-4 py-2">
                        <slot name="footer" />
                    </div>

                    <template v-if="props.resizable">
                        <div
                            v-for="handle in RESIZE_HANDLES"
                            :key="handle.id"
                            :data-dialog-resize="handle.id"
                            role="separator"
                            :aria-orientation="handle.orientation"
                            :aria-label="handle.label"
                            :aria-valuemin="handle.direction.width === 0 ? props.minHeight : props.minWidth"
                            :aria-valuenow="handle.direction.width === 0 ? currentHeight() : displayWidth"
                            :tabindex="props.busy ? -1 : 0"
                            class="absolute z-10 outline-none"
                            :class="handle.class"
                            @pointerdown="startResize(handle.direction, $event)"
                            @keydown="handleResizeKeydown(handle.direction, $event)"
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

/*
 * 二级及更深的窗口不再做玻璃。
 *
 * 材质只有一层（design-language §二）：玻璃采的是它背后的东西，而背后又是一块玻璃时，
 * Web 上采不到可用的高频内容（backdrop-filter 不在链上叠加），只会读成一块发灰的板。
 * 与其让它假装透明，不如直接给层级色——层级轴本来就是不透明色阶。
 */
.nb-dialog-window--nested {
    background-color: var(--panel-surface, var(--bg-panel));
    backdrop-filter: none;
}
</style>
