<script setup lang="ts">
import {IDE_THEME_HOST_CLASS} from "nbook/app/utils/theme/theme-tokens";

/**
 * 通用浮动窗口组件（非模态）。
 *
 * 与 Dialog 的区别：没有遮罩层，页面其余部分保持可见、可交互；
 * 窗口本体使用与 Dialog 一致的不透明表面、可通过标题栏拖动。适合"边调整边看页面实时变化"
 * 的工具面板场景（如主题编辑器）。模态确认类交互请继续用 Dialog。
 */

const props = withDefaults(defineProps<{
    /** 控制窗口显隐 */
    modelValue: boolean;
    /** 标题栏文字 */
    title?: string;
    /** 窗口宽度（px），拖动边界按此值收敛 */
    width?: number;
    /** 窗口高度，默认按内容自适应 */
    height?: string;
    /** 窗口最大高度 */
    maxHeight?: string;
    /** 是否显示关闭按钮 */
    closable?: boolean;
    /** Esc 键是否关闭 */
    closeOnEsc?: boolean;
    /** 是否处于忙碌态，忙碌时不允许关闭 */
    busy?: boolean;
    /** 自定义 body 区域 class，用于接管内部滚动的场景 */
    bodyClass?: string;
    /** Teleport 目标，默认挂到主题宿主保证消费主题变量 */
    teleportTarget?: string;
}>(), {
    title: "",
    width: 560,
    height: "auto",
    maxHeight: "calc(100vh - 32px)",
    closable: true,
    closeOnEsc: true,
    busy: false,
    bodyClass: "overflow-y-auto px-4 py-3",
    teleportTarget: `.${IDE_THEME_HOST_CLASS}`,
});

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "request-close", reason: "close-button" | "esc"): void;
}>();

const instance = getCurrentInstance();
const windowRef = ref<HTMLElement | null>(null);
const dragHandleRef = ref<HTMLElement | null>(null);
/** 是否已经计算过首次弹出位置；组件存活期间保留用户拖动后的位置 */
const positioned = ref(false);

const {width: viewportWidth, height: viewportHeight} = useWindowSize();
const {x, y} = useDraggable(windowRef, {
    handle: dragHandleRef,
    preventDefault: true,
    initialValue: {x: 24, y: 24},
});

/** 拖动边界收敛：窗口至少保留一角在视口内，标题栏始终可再次抓取 */
const clampedX = computed(() => {
    const minX = 16 - props.width + 72;
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
    width: `${props.width}px`,
    height: props.height,
    maxHeight: props.maxHeight,
}));

/**
 * 判断父组件是否监听了 request-close，用于决定默认关闭行为。
 */
const hasRequestCloseListener = computed(() => {
    return Boolean(instance?.vnode.props && "onRequestClose" in instance.vnode.props);
});

/**
 * 请求关闭窗口，若外部未拦截则直接关闭。
 */
function requestClose(reason: "close-button" | "esc"): void {
    if (props.busy) {
        return;
    }
    emit("request-close", reason);
    if (!hasRequestCloseListener.value) {
        emit("update:modelValue", false);
    }
}

/**
 * 监听键盘 Esc。
 */
function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && props.closeOnEsc) {
        requestClose("esc");
    }
}

watch(() => props.modelValue, (visible) => {
    if (!import.meta.client) {
        return;
    }
    if (visible) {
        // 首次打开时停靠视口右上，之后保留用户拖过的位置
        if (!positioned.value) {
            x.value = Math.max(viewportWidth.value - props.width - 28, 16);
            y.value = 64;
            positioned.value = true;
        }
        document.addEventListener("keydown", handleKeydown);
    } else {
        document.removeEventListener("keydown", handleKeydown);
    }
});

onBeforeUnmount(() => {
    if (import.meta.client) {
        document.removeEventListener("keydown", handleKeydown);
    }
});

const isMounted = ref(false);
onMounted(() => {
    isMounted.value = true;
});
</script>

<template>
    <!-- 浮动窗口（无遮罩，页面保持可交互） -->
    <Teleport v-if="isMounted" :to="teleportTarget">
        <Transition name="nb-dialog-window">
            <div v-if="modelValue" ref="windowRef" class="nb-dialog-window fixed z-[8990] flex flex-col overflow-hidden rounded-lg border border-[var(--border-color)] text-[var(--text-main)]" :style="windowStyle">
                <!-- 标题栏（拖动手柄） -->
                <div class="flex shrink-0 items-center gap-2 border-b border-[var(--border-color)] pr-2">
                    <div ref="dragHandleRef" class="flex min-w-0 flex-1 cursor-move touch-none select-none items-center gap-2 py-2 pl-4">
                        <span class="i-lucide-grip-vertical h-4 w-4 shrink-0 text-[var(--text-muted)]"></span>
                        <slot name="header">
                            <span class="min-w-0 flex-1 truncate text-sm font-semibold leading-snug text-[var(--text-main)]">{{ title }}</span>
                        </slot>
                    </div>
                    <button v-if="closable" type="button" class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-50" :disabled="busy" @click="requestClose('close-button')">
                        <span class="i-lucide-x h-4 w-4"></span>
                    </button>
                </div>

                <!-- body 区域 -->
                <div class="flex min-h-0 flex-1 flex-col text-[14px] leading-relaxed text-[var(--text-secondary)]" :class="bodyClass">
                    <slot />
                </div>

                <!-- footer 区域 -->
                <div v-if="$slots.footer" class="flex shrink-0 items-center justify-end gap-2.5 border-t border-[var(--border-color)] px-4 py-2">
                    <slot name="footer"></slot>
                </div>
            </div>
        </Transition>
    </Teleport>
</template>

<style scoped>
.nb-dialog-window {
    background: var(--bg-panel);
    box-shadow:
        0 18px 44px color-mix(in srgb, var(--shadow-color) 24%, transparent),
        0 4px 12px color-mix(in srgb, var(--shadow-color) 12%, transparent);
}

.nb-dialog-window-enter-active,
.nb-dialog-window-leave-active {
    transition: opacity 0.18s ease, transform 0.18s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.nb-dialog-window-enter-from,
.nb-dialog-window-leave-to {
    opacity: 0;
    transform: scale(0.98) translateY(6px);
}
</style>
