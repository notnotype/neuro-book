<script setup lang="ts">
import { IDE_THEME_HOST_CLASS } from "nbook/app/utils/theme/theme-tokens";
import {computed, getCurrentInstance, onBeforeUnmount, onMounted, ref, watch} from "vue";
/**
 * 通用对话框组件。
 *
 * 提供 header / default(body) / footer 三个 slot 槽位，
 * header 和 footer 有默认实现。支持 v-model 控制显隐、Esc 关闭、点击遮罩关闭。
 * 样式通过 CSS custom properties 继承项目主题。
 */

type DialogSize = "sm" | "default" | "md" | "lg" | "xl" | "full";

type DialogSizePreset = {
    width: string;
    height: string;
    maxHeight: string;
};

const DIALOG_SIZE_PRESETS: Record<DialogSize, DialogSizePreset> = {
    sm: {
        width: "360px",
        height: "auto",
        maxHeight: "85vh",
    },
    default: {
        width: "420px",
        height: "auto",
        maxHeight: "85vh",
    },
    md: {
        width: "min(560px, calc(100vw - 32px))",
        height: "auto",
        maxHeight: "85vh",
    },
    lg: {
        width: "min(720px, calc(100vw - 32px))",
        height: "auto",
        maxHeight: "calc(100vh - 32px)",
    },
    xl: {
        width: "min(1040px, calc(100vw - 48px))",
        height: "min(720px, calc(100vh - 64px))",
        maxHeight: "calc(100vh - 64px)",
    },
    full: {
        width: "min(1200px, calc(100vw - 64px))",
        height: "min(720px, calc(100vh - 96px))",
        maxHeight: "calc(100vh - 96px)",
    },
};

const props = withDefaults(defineProps<{
    /** 控制对话框显隐 */
    modelValue: boolean;
    /** 语义尺寸，适合复用常见弹窗和大型工作台这类标准尺寸 */
    size?: DialogSize;
    /** header 默认标题 */
    title?: string;
    /** 是否显示关闭按钮（默认 true） */
    closable?: boolean;
    /** 是否渲染默认 header 区域（默认 true） */
    showHeader?: boolean;
    /** 点击遮罩是否关闭（默认 true） */
    closeOnOverlay?: boolean;
    /** Esc 键是否关闭（默认 true） */
    closeOnEsc?: boolean;
    /** 对话框宽度 */
    width?: string;
    /** 对话框高度 */
    height?: string;
    /** 对话框最大高度 */
    maxHeight?: string;
    /** Teleport 目标，传入 false 禁用 teleport */
    teleportTarget?: string | boolean;
    /** 遮罩层效果：全透明或不透明半黑 */
    overlayType?: "transparent" | "opaque";
    /** 是否显示底部自带的取消按钮 */
    showCancel?: boolean;
    /** 是否显示底部区域 */
    showFooter?: boolean;
    /** 是否处于忙碌态，忙碌时不允许关闭或再次确认 */
    busy?: boolean;
    /** 自定义 body 区域 class，用于大尺寸工作台等需要接管内部滚动的场景 */
    bodyClass?: string;
    /** 自定义 header 区域 class，用于工作台接管标题栏等场景 */
    headerClass?: string;
}>(), {
    title: "",
    size: "default",
    closable: true,
    showHeader: true,
    closeOnOverlay: true,
    closeOnEsc: true,
    teleportTarget: `.${IDE_THEME_HOST_CLASS}`,
    overlayType: "opaque",
    showCancel: false,
    showFooter: true,
    busy: false,
    bodyClass: "",
    headerClass: "",
});

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "confirm"): void;
    (e: "cancel"): void;
    (e: "request-close", reason: "overlay" | "cancel" | "close-button" | "esc"): void;
}>();
const instance = getCurrentInstance();
const {t} = useI18n();
const overlayPointerButton = ref<number | null>(null);

/**
 * 判断父组件是否监听了指定事件。
 *
 * 已在 `emits` 声明的事件不会进入 `useAttrs()`，因此这里从 vnode props 读取。
 */
function hasListener(name: "onRequestClose" | "onConfirm"): boolean {
    return Boolean(instance?.vnode.props && name in instance.vnode.props);
}

const hasRequestCloseListener = computed(() => hasListener("onRequestClose"));
const hasConfirmListener = computed(() => hasListener("onConfirm"));

/**
 * 关闭对话框并触发 cancel 事件。
 */
const closeImmediate = (): void => {
    emit("update:modelValue", false);
    emit("cancel");
};

/**
 * 请求关闭对话框，若外部未拦截则按默认方式关闭。
 */
const requestClose = (reason: "overlay" | "cancel" | "close-button" | "esc"): void => {
    if (props.busy) {
        return;
    }

    emit("request-close", reason);
    if (!hasRequestCloseListener.value) {
        closeImmediate();
    }
};

/**
 * 确认动作。存在业务监听时只触发确认，由业务自行决定何时关闭。
 */
const handleConfirm = (): void => {
    if (props.busy) {
        return;
    }

    emit("confirm");
    if (!hasConfirmListener.value) {
        closeImmediate();
    }
};

/**
 * 指针在遮罩层按下时记录按钮，只有完整按下并在遮罩层抬起才允许关闭。
 */
const handleOverlayPointerDown = (event: PointerEvent): void => {
    overlayPointerButton.value = event.button;
};

/**
 * 指针在遮罩层抬起时，根据按下按钮决定是否关闭。
 */
const handleOverlayPointerUp = (event: PointerEvent): void => {
    const pressedButton = overlayPointerButton.value;
    overlayPointerButton.value = null;

    if (!props.closeOnOverlay) {
        return;
    }

    if (pressedButton === null || event.button !== pressedButton) {
        return;
    }

    if (event.button === 0 || event.button === 2) {
        requestClose("overlay");
    }
};

/**
 * 屏蔽遮罩层默认右键菜单，避免关闭时弹出浏览器菜单。
 */
const handleOverlayContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
};

/**
 * 监听键盘 Esc。
 */
const handleKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && props.closeOnEsc) {
        requestClose("esc");
    }
};

watch(() => props.modelValue, (visible) => {
    if (!import.meta.client) {
        return;
    }

    if (visible) {
        document.addEventListener("keydown", handleKeydown);
    } else {
        document.removeEventListener("keydown", handleKeydown);
    }
});

onBeforeUnmount(() => {
    if (import.meta.client) {
        document.removeEventListener("keydown", handleKeydown);
    }
    overlayPointerButton.value = null;
});

const isMounted = ref(false);
const resolvedSizePreset = computed(() => DIALOG_SIZE_PRESETS[props.size]);
const resolvedWidth = computed(() => props.width ?? resolvedSizePreset.value.width);
const resolvedHeight = computed(() => props.height ?? resolvedSizePreset.value.height);
const resolvedMaxHeight = computed(() => props.maxHeight ?? resolvedSizePreset.value.maxHeight);

onMounted(() => {
    isMounted.value = true;
});
</script>

<template>
    <!-- 对话框遮罩 + 容器 -->
    <Teleport v-if="isMounted" :to="typeof teleportTarget === 'string' ? teleportTarget : 'body'" :disabled="teleportTarget === false">
        <Transition name="nb-dialog">
            <div v-if="modelValue" class="fixed inset-0 z-[9000] flex items-center justify-center transition-colors duration-200" :class="[
                overlayType === 'opaque' ? 'bg-black/50' :
                'bg-transparent'
            ]" @pointerdown.self="handleOverlayPointerDown" @pointerup.self="handleOverlayPointerUp" @contextmenu.self="handleOverlayContextMenu">
                <!-- 对话框主体 -->
                <div 
                    class="nb-dialog-surface flex flex-col overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] text-[var(--text-main)] transform"
                    :style="{ width: resolvedWidth, height: resolvedHeight, maxHeight: resolvedMaxHeight }"
                >
                    <!-- header 区域 -->
                    <div v-if="props.showHeader" class="flex items-center justify-between px-5 py-2 border-b border-[var(--border-color)]" :class="props.headerClass">
                        <slot name="header">
                            <div class="flex min-w-0 flex-1 items-center gap-3">
                                <span class="min-w-0 flex-1 text-base font-semibold text-[var(--text-main)] leading-snug tracking-wide">{{ props.title }}</span>
                                <slot name="header-extra"></slot>
                                <button v-if="props.closable" class="flex items-center justify-center w-7 h-7 rounded-md text-[var(--text-muted)] bg-transparent border-none cursor-pointer transition-colors duration-200 hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50" :disabled="props.busy" @click="requestClose('close-button')">
                                    <span class="i-lucide-x w-4.5 h-4.5"></span>
                                </button>
                            </div>
                        </slot>
                    </div>

                    <!-- body 区域 -->
                    <div class="flex-1 flex flex-col gap-4 overflow-y-auto px-5 py-4 text-[14px] leading-relaxed text-[var(--text-secondary)]" :class="props.bodyClass">
                        <slot />
                    </div>

                    <!-- footer 区域 -->
                    <div v-if="props.showFooter" class="flex items-center justify-end gap-2.5 px-5 py-2 border-t border-[var(--border-color)] bg-transparent">
                        <slot name="footer" :confirm="handleConfirm" :cancel="() => requestClose('cancel')">
                            <button v-if="props.showCancel" class="inline-flex items-center justify-center h-8 px-4 rounded-md text-[13px] font-medium cursor-pointer border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-main)] transition-colors duration-200 hover:bg-[var(--bg-hover)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50" :disabled="props.busy" @click="requestClose('cancel')">{{ t("common.cancel") }}</button>
                            <button class="inline-flex items-center justify-center h-8 px-4 rounded-md text-[13px] font-medium cursor-pointer border border-transparent bg-[var(--accent-main)] text-[var(--text-inverse)] transition-all duration-200 hover:opacity-90 hover:shadow-md active:scale-95 disabled:cursor-not-allowed disabled:opacity-50" :disabled="props.busy" @click="handleConfirm">{{ t("common.confirm") }}</button>
                        </slot>
                    </div>
                </div>
            </div>
        </Transition>
    </Teleport>
</template>

<style scoped>
.nb-dialog-surface {
    box-shadow:
        0 18px 44px color-mix(in srgb, var(--shadow-color) 24%, transparent),
        0 4px 12px color-mix(in srgb, var(--shadow-color) 12%, transparent);
}

.nb-dialog-enter-active,
.nb-dialog-leave-active {
    transition: opacity 0.18s ease;
}

.nb-dialog-enter-active > div,
.nb-dialog-leave-active > div {
    transition: transform 0.18s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.18s ease;
}

.nb-dialog-enter-from,
.nb-dialog-leave-to {
    opacity: 0;
}

.nb-dialog-enter-from > div {
    transform: scale(0.97) translateY(8px);
    opacity: 0;
}

.nb-dialog-leave-to > div {
    transform: scale(0.98) translateY(4px);
    opacity: 0;
}
</style>
