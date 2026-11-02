<script setup lang="ts">
import type {HTMLAttributes} from "vue";
/**
 * 模态对话框（同名 .md）：遮罩、居中；焦点锁定、背景不可交互、关闭后焦点还给打开前的元素，都交给 reka 的模态 Dialog。
 * 同时打开的模态按打开顺序叠放（useOverlayLayer）。宿主声明 `contained`（组件 Lab 的画布）时只在目标里画遮罩，不锁整页。
 * 外框在 DialogSurface；可拖动、可缩放的非模态窗口是 FloatingWindow。
 *
 * 关闭一律经 `request-close`：reka 自己的外部点击与 Escape 关闭都拦下，由这里判定后发出。
 */
import {computed, ref} from "vue";
import {DialogContent, DialogOverlay, DialogPortal, DialogRoot} from "reka-ui";

import {useOverlayLayer} from "../../composables/useOverlayLayer";
import {useTeleportContained, useTeleportTarget} from "../../composables/useTeleportTarget";
import {useUiText} from "../../text-port";
import type {OverlayCloseReason} from "../shared-types";
import {useDialogClose} from "./dialog-close";
import {DIALOG_SURFACE_STYLE, resolveDialogFrame} from "./dialog-frame";
import type {DialogSize} from "./dialog-frame";
import DialogSurface from "./DialogSurface.vue";

export type {DialogSize} from "./dialog-frame";
/** `Dialog` 发出的关闭原因：`OverlayCloseReason` 的子集。 */
export type DialogCloseReason = Extract<OverlayCloseReason, "escape" | "outside" | "close-button" | "cancel">;

// 根是 reka 的 DialogRoot（不渲染元素）：未声明的 attrs 显式交给面板。
defineOptions({inheritAttrs: false});

const props = withDefaults(defineProps<{
    /** 受控的打开态：组件只发 `update:open`，自己不翻转。 */
    open: boolean;
    size?: DialogSize;
    title?: string;
    closable?: boolean;
    showHeader?: boolean;
    closeOnOverlay?: boolean;
    closeOnEsc?: boolean;
    /** 请求关闭后随即发 `update:open(false)`；宿主要自己决定关不关（守卫、脏表单）时传 false。 */
    closeOnRequest?: boolean;
    /** CSS 宽度，或 px 数字（按容器收窄，不会比容器宽）。 */
    width?: string | number;
    height?: string | number;
    maxHeight?: string;
    /** 打开时在正文里按选择器找初始焦点；不给时是第一个可聚焦元素，给了但找不到时聚焦面板。 */
    initialFocus?: string;
    /** 传送目标；`false` 不传送，就地渲染。 */
    teleportTarget?: string | false;
    overlayType?: "transparent" | "blur" | "opaque";
    showCancel?: boolean;
    showFooter?: boolean;
    busy?: boolean;
    /** 页脚左侧状态行的错误：提交之后才知道的错误写在这里，一次一条；非空时替下 `status` 插槽（只在 md 及以上尺寸有）。 */
    status?: string;
    bodyClass?: string;
    headerClass?: string;
    cancelLabel?: string;
    confirmLabel?: string;
    closeLabel?: string;
} & /* @vue-ignore */ HTMLAttributes>(), {
    title: "",
    size: "default",
    /*
     * 默认**不画关闭按钮**。
     *
     * Apple 官方 macOS 27 UI Kit 里的 Alert 与 Save Dialog 都没有 ×：模态对话框的出口是
     * 一颗**有名字的按钮**（取消 / 存储 / 删除），而不是一个角落里的叉。叉是 Web 与 Windows
     * 的做法，它把「关掉这个框」和「放弃这次操作」说成两件事，用户得自己猜它们是不是同一件。
     *
     * 默认 showFooter 是 true，所以关掉 × 之后仍然至少有一颗按钮可以出去；
     * 真要做一个没有按钮的框，得自己显式传 closable。
     */
    closable: false,
    closeOnRequest: true,
    showHeader: true,
    closeOnOverlay: true,
    closeOnEsc: true,
    width: undefined,
    height: undefined,
    maxHeight: undefined,
    initialFocus: undefined,
    teleportTarget: undefined,
    /*
     * 遮罩只压暗，不预模糊。
     *
     * 面板的 backdrop-filter 采的是**遮罩之后**的页面，遮罩先把整页糊过一遍，
     * 玻璃就没有高频内容可挤了——重遮罩和玻璃对话框是互斥的两种做法。
     * macOS 的 sheet 干脆连底下的窗口都不压暗，靠材质与影子分层。
     */
    overlayType: "opaque",
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
    (e: "request-close", reason: DialogCloseReason): void;
    (e: "closed"): void;
}>();

const text = useUiText();
const cancelText = computed(() => props.cancelLabel ?? text("dialog.cancel"));
const confirmText = computed(() => props.confirmLabel ?? text("dialog.confirm"));
const closeText = computed(() => props.closeLabel ?? text("dialog.close"));
// 标题为空时屏幕阅读器仍要有对话框的名字。
const titleText = computed(() => props.title || text("dialog.untitled"));

const {zIndex, nested} = useOverlayLayer({kind: "modal", open: () => props.open});

const contained = useTeleportContained();
/** 锁整页（reka 的模态）：宿主没有声明 contained。 */
const pageModal = !contained;
const teleportTo = useTeleportTarget(() => (typeof props.teleportTarget === "string" ? props.teleportTarget : undefined));

const surface = ref<InstanceType<typeof DialogSurface> | null>(null);
const panel = computed(() => surface.value?.panel ?? null);

const panelStyle = computed(() => {
    const frame = resolveDialogFrame(props);
    // 居中：四边贴住容器再 margin auto；高度按内容时用 fit-content，auto 会撑满。
    return {
        ...DIALOG_SURFACE_STYLE,
        width: frame.width,
        maxHeight: frame.maxHeight,
        zIndex: zIndex.value,
        position: "fixed" as const,
        inset: "0",
        margin: "auto",
        height: frame.height === "auto" ? "fit-content" : frame.height,
    };
});

/** 遮罩的底色与模糊；入退场的淡入淡出来自 `.nb-ui-overlay`。 */
const overlayClass = computed(() => (props.overlayType === "transparent" ? "bg-transparent" : props.overlayType === "blur" ? "bg-[var(--overlay-bg)] backdrop-blur-sm" : "bg-[var(--overlay-bg)]"));

const close = useDialogClose<DialogCloseReason>({
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

/** 一个图层（reka 的可关闭层）的有效层级：自己或最近一个设了 z-index 的祖先。 */
function layerZIndex(element: Element): number {
    for (let node: Element | null = element; node !== null; node = node.parentElement) {
        const value = Number.parseInt(getComputedStyle(node).zIndex, 10);
        if (Number.isFinite(value)) return value;
    }
    return 0;
}

/**
 * 遮罩上按下时，这个对话框是不是最上层：里面开着的下拉、取色面板这类浮层（reka 的可关闭层，层级在对话框之上）
 * 这一下只该把浮层关掉，不关对话框。模态的叠放序号回答不了这件事：下拉不登记在里面。
 */
function onTop(): boolean {
    const element = panel.value;
    if (element === null) return false;
    const mine = zIndex.value;
    return [...document.querySelectorAll("[data-dismissable-layer]")].every((layer) => layer === element || element.contains(layer) || layerZIndex(layer) < mine);
}

let overlayPress: {button: number} | null = null;

/** 遮罩：按下与松开都在遮罩上、同一个键（主键或右键），才算一次点击（拖选文字拖到外面松开不算）。 */
function onOverlayPointerDown(event: PointerEvent): void {
    overlayPress = onTop() ? {button: event.button} : null;
}

function onOverlayPointerUp(event: PointerEvent): void {
    const press = overlayPress;
    overlayPress = null;
    if (!props.closeOnOverlay || press === null || event.button !== press.button) return;
    if (event.button === 0 || event.button === 2) close.requestClose("outside");
}
</script>

<template>
    <DialogRoot :open="props.open" :modal="pageModal">
        <DialogPortal :to="props.teleportTarget === false ? undefined : teleportTo()" :disabled="props.teleportTarget === false">
            <!-- 遮罩与面板是**平级**：面板若是遮罩的子元素，带 backdrop-filter 的遮罩会成为它的 backdrop root，玻璃采不到背景。
                 锁整页时用 reka 的 DialogOverlay：reka 会让 body 不接收指针，只有它的遮罩恢复了指针；contained 时用普通遮罩。 -->
            <DialogOverlay
                v-if="pageModal"
                class="nb-ui-overlay fixed inset-0"
                :class="overlayClass"
                :style="{zIndex}"
                data-dialog-overlay
                v-bind="{onPointerdown: onOverlayPointerDown, onPointerup: onOverlayPointerUp, onContextmenu: (event: MouseEvent) => event.preventDefault()}"
            />
            <div
                v-else-if="props.open"
                class="nb-ui-overlay fixed inset-0"
                :class="overlayClass"
                :style="{zIndex}"
                data-dialog-overlay
                @pointerdown="onOverlayPointerDown"
                @pointerup="onOverlayPointerUp"
                @contextmenu.prevent
            />
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
                    :window="false"
                    :style="panelStyle"
                    :aria-modal="pageModal ? 'true' : undefined"
                    @request-close="close.requestClose"
                    @confirm="close.confirm"
                >
                    <template v-if="$slots.header" #header><slot name="header" /></template>
                    <template #header-extra><slot name="header-extra" /></template>
                    <slot />
                    <template #status><slot name="status" /></template>
                    <template v-if="$slots.footer" #footer="footer"><slot name="footer" v-bind="footer" /></template>
                </DialogSurface>
            </DialogContent>
        </DialogPortal>
    </DialogRoot>
</template>
