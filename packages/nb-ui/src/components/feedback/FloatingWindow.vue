<script setup lang="ts">
import type {HTMLAttributes} from "vue";
/**
 * 浮动窗口（同名 .md）：非模态、没有遮罩，按住留白、标题栏或内容里标了 `data-dialog-drag` 的地方可拖动，可选缩放
 * （useFloatingWindow），点外面不关。按嵌套深度叠放，整条窗口层级带在模态对话框之下（useOverlayLayer）。
 * 外框与 `Dialog` 共用 DialogSurface。
 *
 * 关闭经 `request-close`：Escape 与关闭、取消按钮；reka 自己的外部点击与 Escape 关闭都拦下。
 */
import {computed, ref} from "vue";
import {DialogContent, DialogPortal, DialogRoot} from "reka-ui";

import {FLOATING_WINDOW_RESIZE_HANDLES, useFloatingWindow} from "../../composables/useFloatingWindow";
import {useOverlayLayer} from "../../composables/useOverlayLayer";
import {useTeleportTarget} from "../../composables/useTeleportTarget";
import {useUiText} from "../../text-port";
import type {OverlayCloseReason} from "../shared-types";
import {useDialogClose} from "./dialog-close";
import {DIALOG_SURFACE_STYLE, pxOf, resolveDialogFrame} from "./dialog-frame";
import type {DialogSize} from "./dialog-frame";
import DialogSurface from "./DialogSurface.vue";

/** `FloatingWindow` 发出的关闭原因：没有遮罩，不发 `outside`。 */
export type FloatingWindowCloseReason = Extract<OverlayCloseReason, "escape" | "close-button" | "cancel">;

// 根是 reka 的 DialogRoot（不渲染元素）：未声明的 attrs 显式交给面板。
defineOptions({inheritAttrs: false});

const props = withDefaults(defineProps<{
    /** 受控的打开态：组件只发 `update:open`，自己不翻转。 */
    open: boolean;
    size?: DialogSize;
    title?: string;
    closable?: boolean;
    showHeader?: boolean;
    closeOnEsc?: boolean;
    /** 请求关闭后随即发 `update:open(false)`；宿主要自己决定关不关时传 false。 */
    closeOnRequest?: boolean;
    /** CSS 宽度，或 px 数字（按容器收窄，不会比容器宽）。 */
    width?: string | number;
    height?: string | number;
    maxHeight?: string;
    /** 打开时在正文里按选择器找初始焦点；不给时是第一个可聚焦元素，给了但找不到时聚焦面板。 */
    initialFocus?: string;
    resizable?: boolean;
    minWidth?: number;
    minHeight?: number;
    /** 传送目标；`false` 不传送，就地渲染。 */
    teleportTarget?: string | false;
    showCancel?: boolean;
    showFooter?: boolean;
    busy?: boolean;
    /** 页脚左侧状态行的错误；非空时替下 `status` 插槽（只在 md 及以上尺寸有）。 */
    status?: string;
    bodyClass?: string;
    headerClass?: string;
    cancelLabel?: string;
    confirmLabel?: string;
    closeLabel?: string;
} & /* @vue-ignore */ HTMLAttributes>(), {
    title: "",
    size: "default",
    closable: false,
    closeOnRequest: true,
    showHeader: true,
    closeOnEsc: true,
    width: undefined,
    height: undefined,
    maxHeight: undefined,
    initialFocus: undefined,
    resizable: false,
    minWidth: 320,
    minHeight: 240,
    teleportTarget: undefined,
    showCancel: false,
    showFooter: true,
    busy: false,
    status: "",
    bodyClass: "",
    headerClass: "",
});

const emit = defineEmits<{
    (e: "update:open", value: boolean): void;
    (e: "confirm"): void;
    (e: "request-close", reason: FloatingWindowCloseReason): void;
    (e: "closed"): void;
    (e: "update:width", value: number): void;
    (e: "update:height", value: number): void;
}>();

const text = useUiText();
const cancelText = computed(() => props.cancelLabel ?? text("dialog.cancel"));
const confirmText = computed(() => props.confirmLabel ?? text("dialog.confirm"));
const closeText = computed(() => props.closeLabel ?? text("dialog.close"));
const titleText = computed(() => props.title || text("dialog.untitled"));

const {zIndex, nested} = useOverlayLayer({kind: "window", open: () => props.open});
const teleportTo = useTeleportTarget(() => (typeof props.teleportTarget === "string" ? props.teleportTarget : undefined));

const surface = ref<InstanceType<typeof DialogSurface> | null>(null);
const panel = computed(() => surface.value?.panel ?? null);

const floating = useFloatingWindow({
    open: () => props.open,
    target: () => (props.teleportTarget === false ? false : teleportTo()),
    resizable: () => props.resizable,
    busy: () => props.busy,
    minWidth: () => props.minWidth,
    minHeight: () => props.minHeight,
    declared: () => ({width: typeof props.width === "number" ? props.width : null, height: pxOf(props.height)}),
    windowRef: panel,
    onResize: (dimension, value) => (dimension === "width" ? emit("update:width", value) : emit("update:height", value)),
});

const panelStyle = computed(() => {
    const frame = resolveDialogFrame(props);
    return {
        ...DIALOG_SURFACE_STYLE,
        width: frame.width,
        maxHeight: frame.maxHeight,
        zIndex: zIndex.value,
        ...(frame.height === "auto" ? {} : {height: frame.height}),
        ...floating.style.value,
    };
});

const close = useDialogClose<FloatingWindowCloseReason>({
    open: () => props.open,
    busy: () => props.busy,
    closeOnRequest: () => props.closeOnRequest,
    closeOnEsc: () => props.closeOnEsc,
    initialFocus: () => props.initialFocus,
    panel,
    emitRequest: (reason) => emit("request-close", reason),
    emitOpen: (value) => emit("update:open", value),
    emitConfirm: () => emit("confirm"),
    emitClosed: () => emit("closed"),
});
</script>

<template>
    <DialogRoot :open="props.open" :modal="false">
        <DialogPortal :to="props.teleportTarget === false ? undefined : teleportTo()" :disabled="props.teleportTarget === false">
            <DialogContent
                as-child
                :aria-describedby="undefined"
                @open-auto-focus="close.onOpenAutoFocus"
                @close-auto-focus="close.onCloseAutoFocus"
                @escape-key-down="close.onEscapeKeyDown"
                @pointer-down-outside="close.preventDismiss"
                @interact-outside="close.preventDismiss"
                @focus-outside="close.preventDismiss"
            >
                <DialogSurface
                    v-bind="$attrs"
                    ref="surface"
                    :size="props.size"
                    :title="props.title"
                    :title-text="titleText"
                    :show-header="props.showHeader"
                    :closable="props.closable"
                    :close-text="closeText"
                    :show-footer="props.showFooter"
                    :show-cancel="props.showCancel"
                    :cancel-text="cancelText"
                    :confirm-text="confirmText"
                    :busy="props.busy"
                    :status="props.status"
                    :header-class="props.headerClass"
                    :body-class="props.bodyClass"
                    :nested="nested"
                    :window="true"
                    :style="panelStyle"
                    @pointerdown="floating.startDrag"
                    @request-close="close.requestClose"
                    @confirm="close.confirm"
                >
                    <template v-if="$slots.header" #header><slot name="header" /></template>
                    <template #header-extra><slot name="header-extra" /></template>
                    <slot />
                    <template #status><slot name="status" /></template>
                    <template v-if="$slots.footer" #footer="footer"><slot name="footer" v-bind="footer" /></template>
                    <template v-if="props.resizable" #edges>
                        <div
                            v-for="handle in FLOATING_WINDOW_RESIZE_HANDLES"
                            :key="handle.id"
                            :data-dialog-resize="handle.id"
                            role="separator"
                            :aria-orientation="handle.orientation"
                            :aria-label="text(handle.labelKey)"
                            :aria-valuemin="handle.direction.width === 0 ? props.minHeight : props.minWidth"
                            :tabindex="props.busy ? -1 : 0"
                            class="absolute z-10 outline-none"
                            :class="handle.class"
                            @pointerdown="floating.startResize(handle.direction, $event)"
                            @keydown="floating.resizeByKey(handle.direction, $event)"
                        ></div>
                    </template>
                </DialogSurface>
            </DialogContent>
        </DialogPortal>
    </DialogRoot>
</template>
