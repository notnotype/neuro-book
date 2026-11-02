<script setup lang="ts">
import type {HTMLAttributes} from "vue";
/**
 * 对话框（同名 .md）：一个组件两种用法，外框（面、标题、正文、页脚、分隔线）只有这一份。
 *
 * - 缺省模态：遮罩、居中；焦点锁定、背景不可交互、关闭后焦点还给打开前的元素，都交给 reka 的模态 Dialog。同时打开的
 *   模态按打开顺序叠放（useModalLayer）。宿主声明 `contained`（组件 Lab 的画布）时只在目标里画遮罩，不锁整页。
 * - `modal=false` 是浮动窗口：没有遮罩，按住留白、标题栏或内容里标了 `data-dialog-drag` 的地方可拖动，可选缩放
 *   （useFloatingWindow），点外面不关；按嵌套深度叠放。
 *
 * 关闭一律经 `request-close`：reka 自己的外部点击与 Escape 关闭都拦下，由这里判定后发出。
 */
import {computed, getCurrentInstance, inject, onBeforeUnmount, provide, ref, watch} from "vue";
import {DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle} from "reka-ui";

import {FLOATING_WINDOW_RESIZE_HANDLES, useFloatingWindow} from "../../composables/useFloatingWindow";
import {useModalLayer} from "../../composables/useModalLayer";
import {useTeleportContained, useTeleportTarget} from "../../composables/useTeleportTarget";
import {useUiText} from "../../text-port";
import {NB_DIALOG_LAYER, NB_DIALOG_WINDOW_DEPTH, NB_DIALOG_WINDOW_Z_STEP, NB_MODAL_POPOVER_Z_INDEX, NB_POPOVER_Z_INDEX, NB_Z_INDEX} from "../../theme/z-index";
import Button from "../controls/Button.vue";
import IconButton from "../controls/IconButton.vue";

// 根是 reka 的 DialogRoot（不渲染元素）：未声明的 attrs 显式交给面板。
defineOptions({inheritAttrs: false});

export type DialogSize = "sm" | "default" | "md" | "lg" | "xl" | "full";
export type DialogCloseReason = "overlay" | "cancel" | "close-button" | "esc";

type DialogSizePreset = {
    width: string;
    height: string;
    maxHeight: string;
};

const DIALOG_SIZE_PRESETS: Record<DialogSize, DialogSizePreset> = {
    sm: {width: "min(360px, calc(100cqw - 32px))", height: "auto", maxHeight: "85cqh"},
    default: {width: "min(420px, calc(100cqw - 32px))", height: "auto", maxHeight: "85cqh"},
    md: {width: "min(560px, calc(100cqw - 32px))", height: "auto", maxHeight: "85cqh"},
    lg: {width: "min(720px, calc(100cqw - 32px))", height: "auto", maxHeight: "calc(100cqh - 32px)"},
    xl: {width: "min(1080px, calc(100cqw - 20px))", height: "min(780px, calc(100cqh - 20px))", maxHeight: "calc(100cqh - 20px)"},
    full: {width: "calc(100cqw - 24px)", height: "calc(100cqh - 24px)", maxHeight: "calc(100cqh - 24px)"},
};

const props = withDefaults(defineProps<{
    modelValue: boolean;
    /** 模态（缺省）或浮动窗口；打开期间不要切换。 */
    modal?: boolean;
    size?: DialogSize;
    title?: string;
    closable?: boolean;
    showHeader?: boolean;
    closeOnOverlay?: boolean;
    closeOnEsc?: boolean;
    /** CSS 宽度，或 px 数字（按容器收窄，不会比容器宽）。 */
    width?: string | number;
    height?: string | number;
    maxHeight?: string;
    /** 打开时在正文里按选择器找初始焦点；不给时是第一个可聚焦元素，给了但找不到时聚焦面板。 */
    initialFocus?: string;
    resizable?: boolean;
    minWidth?: number;
    minHeight?: number;
    teleportTarget?: string | boolean;
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
    modal: true,
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
    showHeader: true,
    closeOnOverlay: true,
    closeOnEsc: true,
    width: undefined,
    height: undefined,
    maxHeight: undefined,
    initialFocus: undefined,
    resizable: false,
    minWidth: 320,
    minHeight: 240,
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
    (e: "update:modelValue", value: boolean): void;
    (e: "confirm"): void;
    (e: "cancel"): void;
    (e: "request-close", reason: DialogCloseReason): void;
    (e: "update:width", value: number): void;
    (e: "update:height", value: number): void;
}>();

const text = useUiText();
const cancelText = computed(() => props.cancelLabel ?? text("dialog.cancel"));
const confirmText = computed(() => props.confirmLabel ?? text("dialog.confirm"));
const closeText = computed(() => props.closeLabel ?? text("dialog.close"));
// 标题为空时屏幕阅读器仍要有对话框的名字。
const titleText = computed(() => props.title || text("dialog.untitled"));

const instance = getCurrentInstance();
const panelRef = ref<HTMLElement | null>(null);
const bodyRef = ref<HTMLElement | null>(null);

/*
 * 层级。模态按打开顺序叠放；浮动窗口按嵌套深度（从窗口里开出来的窗口压住外层，窗口自己的下拉压住自己）。
 * 向内容树提供的局部浮层层级：模态给一个高于所有模态层的固定值（理由见 NB_MODAL_POPOVER_Z_INDEX），窗口给“自己 + 1”。
 * 用法在建立时取定：注入只能在 setup 里给。
 */
const parentDepth = inject(NB_DIALOG_WINDOW_DEPTH, 0);
const parentLayer = inject(NB_DIALOG_LAYER, 0);
provide(NB_DIALOG_LAYER, parentLayer + 1);
const nested = parentLayer >= 1;
const windowDepth = props.modal ? parentDepth : parentDepth + 1;
const windowZIndex = NB_Z_INDEX.dialogWindow + (Math.max(windowDepth, 1) - 1) * NB_DIALOG_WINDOW_Z_STEP;
provide(NB_DIALOG_WINDOW_DEPTH, windowDepth);
provide(NB_POPOVER_Z_INDEX, props.modal ? NB_MODAL_POPOVER_Z_INDEX : windowZIndex + 1);
const {zIndex: modalZIndex} = useModalLayer(() => props.modal && props.modelValue);
const zIndex = computed(() => (props.modal ? modalZIndex.value : windowZIndex));

const contained = useTeleportContained();
/** 锁整页（reka 的模态）：模态且宿主没有声明 contained。 */
const pageModal = computed(() => props.modal && !contained);
const teleportTo = useTeleportTarget(() => (typeof props.teleportTarget === "string" ? props.teleportTarget : undefined));

/** 高度写成数字或 `Npx` 时的像素值。 */
function pxOf(value: string | number | undefined): number | null {
    if (typeof value === "number") return value;
    const match = value === undefined ? null : /^([0-9]+(?:\.[0-9]+)?)px$/u.exec(value.trim());
    return match === null ? null : Number(match[1]);
}

const floating = useFloatingWindow({
    enabled: () => !props.modal,
    open: () => props.modelValue,
    target: () => (props.teleportTarget === false ? false : teleportTo()),
    resizable: () => props.resizable,
    busy: () => props.busy,
    minWidth: () => props.minWidth,
    minHeight: () => props.minHeight,
    declared: () => ({width: typeof props.width === "number" ? props.width : null, height: pxOf(props.height)}),
    windowRef: panelRef,
    onResize: (dimension, value) => (dimension === "width" ? emit("update:width", value) : emit("update:height", value)),
});

const preset = computed(() => DIALOG_SIZE_PRESETS[props.size]);
const cssLength = (value: string | number): string => (typeof value === "number" ? `${String(value)}px` : value);
/** 数字宽度按容器收窄，和预设一样两侧至少留 16px。 */
const resolvedWidth = computed(() => (props.width === undefined ? preset.value.width : typeof props.width === "number" ? `min(${String(props.width)}px, calc(100cqw - 32px))` : props.width));
const resolvedHeight = computed(() => cssLength(props.height ?? preset.value.height));
const resolvedMaxHeight = computed(() => props.maxHeight ?? preset.value.maxHeight);

/*
 * 三段的留白由一处算出来，不各写各的。
 *
 * **不设头尾条。** 这是从 Apple 官方 macOS 27 UI Kit 实测回来的结论：那份文件里 Save Dialog 与 Alert
 * 都是**一列 flex，四边留白基本一致**，标题只是这一列的第一个块，按钮只是最后一个块。官方读到的取值：
 * Save Dialog `padding: 20px; gap: 20px`；Alert `padding: 20px 16px 16px; gap: 14px`。上留白比左右多一档，
 * 也是官方原值：标题的字面顶端比它的行盒要低，四边等距时读起来会像偏上。浮动窗口用同一个外框。
 */
const surfaceStyle = {
    paddingBlockStart: "calc(var(--panel-p) + var(--space-2))",
    paddingInline: "var(--panel-p)",
    paddingBlockEnd: "var(--panel-p)",
    /* 14px 是官方 Alert 的原值。这一档是块与块之间的空，不跟着中文放松 */
    gap: "calc(var(--space-6) - var(--space-1))",
};

/*
 * 正文是滚动容器，会裁掉贴边控件的外扩光环（焦点环、色块的选中环）。四边留一圈给光环，再用等量负外边距抵掉，
 * 内容的位置不变；这一圈藏在面板的留白里（面板四边的留白都比它宽）。
 */
const bodyStyle = {fontSize: "var(--text-sm)", padding: "var(--space-3)", margin: "calc(var(--space-3) * -1)"};

const panelStyle = computed(() => {
    const size = {width: resolvedWidth.value, maxHeight: resolvedMaxHeight.value, zIndex: zIndex.value, ...surfaceStyle};
    if (props.modal) {
        // 居中：四边贴住容器再 margin auto；高度按内容时用 fit-content，auto 会撑满。
        return {...size, position: "fixed" as const, inset: "0", margin: "auto", height: resolvedHeight.value === "auto" ? "fit-content" : resolvedHeight.value};
    }
    return {...size, ...(resolvedHeight.value === "auto" ? {} : {height: resolvedHeight.value}), ...floating.style.value};
});

const overlayClass = computed(() => (props.overlayType === "transparent" ? "bg-transparent" : props.overlayType === "blur" ? "bg-[var(--overlay-bg)] backdrop-blur-sm" : "bg-[var(--overlay-bg)]"));

/*
 * 按钮平分整行还是右对齐——Apple 自己就是分两档的（官方 macOS 27 UI Kit 实测）：窄的 Alert 两颗按钮平分整行，
 * 宽的 Save Dialog 按钮右对齐。判据是「这个框窄不窄」：sm / default 平分，md 以上右对齐。
 */
const footerFillsRow = computed(() => props.size === "sm" || props.size === "default");

/*
 * 头尾的分隔线只在正文**真的滚动得起来**的时候才画（设计语言坑 #32）。常驻两条通栏细线会把对话框切成三段；
 * macOS 的 sheet 平时一条线都没有，内容滚到标题下面去了才浮出一条分隔。
 */
const scrolledFromTop = ref(false);
const scrollableBelow = ref(false);
let panelResizeObserver: ResizeObserver | null = null;

function syncBodyScroll(): void {
    const body = bodyRef.value;
    if (!body) return;
    scrolledFromTop.value = body.scrollTop > 0;
    // 留 1px 容差：缩放比例不是整数时 scrollTop + clientHeight 会差出零点几个像素
    scrollableBelow.value = body.scrollTop + body.clientHeight < body.scrollHeight - 1;
}

// 面板高度会随内容变（异步加载的内容最典型），正文自己的滚动事件那时还没发生过：尺寸变了也重算一次。
watch(panelRef, (panel) => {
    panelResizeObserver?.disconnect();
    panelResizeObserver = null;
    scrolledFromTop.value = false;
    scrollableBelow.value = false;
    if (panel === null) return;
    syncBodyScroll();
    if (typeof ResizeObserver !== "undefined") {
        panelResizeObserver = new ResizeObserver(syncBodyScroll);
        panelResizeObserver.observe(panel);
    }
});
onBeforeUnmount(() => panelResizeObserver?.disconnect());

function hasListener(name: "onRequestClose" | "onConfirm"): boolean {
    return Boolean(instance?.vnode.props && name in instance.vnode.props);
}

function closeImmediate(): void {
    emit("update:modelValue", false);
    emit("cancel");
}

function requestClose(reason: DialogCloseReason): void {
    if (props.busy) return;
    emit("request-close", reason);
    if (!hasListener("onRequestClose")) closeImmediate();
}

function handleConfirm(): void {
    if (props.busy) return;
    emit("confirm");
    if (!hasListener("onConfirm")) closeImmediate();
}

/** reka 想自己关（外部点击、Escape）都已在下面拦掉；这里不再另做事。 */
function preventDismiss(event: Event): void {
    event.preventDefault();
}

/**
 * Escape：只有最上层收得到（reka 判定）。reka 在 window 上冒泡阶段监听，内层控件已经处理过（`.prevent`）的、
 * 输入法正在组字时按的，都不算关闭。
 */
function onEscapeKeyDown(event: KeyboardEvent): void {
    const handled = event.defaultPrevented || event.isComposing || event.keyCode === 229;
    event.preventDefault();
    if (!handled && props.closeOnEsc) requestClose("esc");
}

function onOpenAutoFocus(event: Event): void {
    if (props.initialFocus === undefined) return;
    event.preventDefault();
    const panel = panelRef.value;
    (panel?.querySelector<HTMLElement>(props.initialFocus) ?? panel)?.focus({preventScroll: true});
}

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
 * 这一下只该把浮层关掉，不关对话框。
 */
function onTop(): boolean {
    const panel = panelRef.value;
    if (panel === null) return false;
    const mine = zIndex.value;
    return [...document.querySelectorAll("[data-dismissable-layer]")].every((layer) => layer === panel || panel.contains(layer) || layerZIndex(layer) < mine);
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
    if (event.button === 0 || event.button === 2) requestClose("overlay");
}
</script>

<template>
    <DialogRoot :open="props.modelValue" :modal="pageModal">
        <DialogPortal :to="props.teleportTarget === false ? undefined : teleportTo()" :disabled="props.teleportTarget === false">
            <!-- 遮罩与面板是**平级**：面板若是遮罩的子元素，带 backdrop-filter 的遮罩会成为它的 backdrop root，玻璃采不到背景。
                 锁整页时用 reka 的 DialogOverlay：reka 会让 body 不接收指针，只有它的遮罩恢复了指针；contained 时用普通遮罩。 -->
            <template v-if="props.modal">
                <DialogOverlay
                    v-if="pageModal"
                    class="nb-dialog__overlay fixed inset-0"
                    :class="overlayClass"
                    :style="{zIndex}"
                    data-dialog-overlay
                    v-bind="{onPointerdown: onOverlayPointerDown, onPointerup: onOverlayPointerUp, onContextmenu: (event: MouseEvent) => event.preventDefault()}"
                />
                <div
                    v-else-if="props.modelValue"
                    class="nb-dialog__overlay fixed inset-0"
                    :class="overlayClass"
                    :style="{zIndex}"
                    data-dialog-overlay
                    @pointerdown="onOverlayPointerDown"
                    @pointerup="onOverlayPointerUp"
                    @contextmenu.prevent
                />
            </template>
            <DialogContent
                as-child
                :aria-describedby="undefined"
                @open-auto-focus="onOpenAutoFocus"
                @escape-key-down="onEscapeKeyDown"
                @pointer-down-outside="preventDismiss"
                @interact-outside="preventDismiss"
                @focus-outside="preventDismiss"
            >
                <section
                    v-bind="$attrs"
                    ref="panelRef"
                    class="nb-dialog nb-ui-popover-surface nb-ui-dialog-surface nb-ui-surface-rim flex flex-col overflow-hidden text-[var(--text-main)] outline-none"
                    :class="[props.modal ? 'nb-dialog--modal' : 'nb-dialog--window nb-ui-dialog-surface--window', nested ? 'nb-ui-dialog-surface--nested' : '']"
                    :style="panelStyle"
                    data-dialog-surface
                    :data-dialog-window="props.modal ? undefined : ''"
                    :aria-modal="pageModal ? 'true' : undefined"
                    @pointerdown="floating.startDrag"
                >
                    <!-- 浮动窗口里整条标题栏都能拖（按钮除外）；标题文字那一块给出移动光标。 -->
                    <header
                        v-if="props.showHeader"
                        class="nb-dialog__header flex items-center justify-between gap-3"
                        :class="props.headerClass"
                        :style="{boxShadow: scrolledFromTop ? '0 1px 0 var(--divider)' : 'none'}"
                        :data-dialog-drag="props.modal ? undefined : ''"
                    >
                        <div class="min-w-0 flex-1" :class="props.modal ? '' : 'cursor-move'">
                            <DialogTitle v-if="$slots.header" as="div" class="nb-ui-dialog-title truncate">
                                <slot name="header" />
                            </DialogTitle>
                            <DialogTitle v-else class="nb-ui-dialog-title truncate" :class="props.title === '' ? 'sr-only' : ''">{{ titleText }}</DialogTitle>
                        </div>
                        <slot name="header-extra"></slot>
                        <IconButton v-if="props.closable" size="sm" :title="closeText" :aria-label="closeText" :disabled="props.busy" @click="requestClose('close-button')">
                            <span class="i-lucide-x h-4 w-4"></span>
                        </IconButton>
                    </header>
                    <template v-else>
                        <DialogTitle class="sr-only">{{ titleText }}</DialogTitle>
                        <!-- 没有标题栏时关闭按钮贴在面板右上角，浮在正文之上；正文要给它让出位置（见同名 .md）。 -->
                        <IconButton
                            v-if="props.closable"
                            class="nb-dialog__corner-close"
                            size="sm"
                            :title="closeText"
                            :aria-label="closeText"
                            :disabled="props.busy"
                            @click="requestClose('close-button')"
                        >
                            <span class="i-lucide-x h-4 w-4"></span>
                        </IconButton>
                    </template>
                    <div
                        ref="bodyRef"
                        class="nb-dialog__body min-h-0 flex-1 overflow-y-auto leading-relaxed"
                        :class="props.bodyClass"
                        :style="bodyStyle"
                        data-dialog-body
                        @scroll="syncBodyScroll"
                    >
                        <slot />
                    </div>
                    <footer
                        v-if="props.showFooter"
                        class="nb-ui-dialog-footer"
                        :class="footerFillsRow ? '' : 'justify-end'"
                        :style="{boxShadow: scrollableBelow ? '0 -1px 0 var(--divider)' : 'none'}"
                    >
                        <!-- 状态行一直占着按钮左边的位置（空着也在）：平时是 status 插槽的中性状态，出错时换成错误，按钮不动。 -->
                        <p
                            v-if="!footerFillsRow"
                            class="nb-dialog__status m-0 flex min-w-0 flex-1 items-center gap-1.5"
                            :class="props.status !== '' ? 'text-[var(--status-danger)]' : 'text-[var(--text-muted)]'"
                            :style="{fontSize: 'var(--text-xs)'}"
                            :title="props.status || undefined"
                            aria-live="polite"
                            data-dialog-status
                            :data-dialog-status-error="props.status !== '' ? '' : undefined"
                        >
                            <template v-if="props.status !== ''">
                                <span class="i-lucide-circle-alert h-3.5 w-3.5 shrink-0" aria-hidden="true"></span>
                                <span class="truncate">{{ props.status }}</span>
                            </template>
                            <span v-else class="truncate"><slot name="status" /></span>
                        </p>
                        <slot name="footer" :confirm="handleConfirm" :cancel="() => requestClose('cancel')">
                            <Button v-if="props.showCancel" variant="secondary" :class="footerFillsRow ? 'flex-1' : ''" :disabled="props.busy" @click="requestClose('cancel')">{{ cancelText }}</Button>
                            <Button variant="primary" :class="footerFillsRow ? 'flex-1' : ''" :disabled="props.busy" @click="handleConfirm">{{ confirmText }}</Button>
                        </slot>
                    </footer>
                    <template v-if="!props.modal && props.resizable">
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
                </section>
            </DialogContent>
        </DialogPortal>
    </DialogRoot>
</template>

<style scoped>
/*
 * 拖动区域不让浏览器拿触摸手势去滚动、也不起选字：按住就是拖窗口。面板自己只关触摸手势（它不继承，正文是滚动容器，
 * 里面照常滚）；选字是继承的，只关在区域上，正文里照常能选。
 */
.nb-dialog--window {
    touch-action: none;
}

.nb-dialog--window :deep([data-dialog-drag]) {
    touch-action: none;
    user-select: none;
}

/*
 * 有标题栏时关闭按钮在面板的内边距里；没有标题栏时退到角上，离两条边各一档，不贴圆角。它浮在正文之上，
 * `--nb-dialog-close-room` 是它从面板右边、上边算起要占的见方（离边一档、按钮 26px、再隔一档），正文按它让位。
 */
.nb-dialog {
    --nb-dialog-close-room: calc(var(--space-4) * 2 + 26px);
}

.nb-dialog__corner-close {
    position: absolute;
    top: var(--space-4);
    right: var(--space-4);
    z-index: 1;
}

.nb-dialog__header,
.nb-ui-dialog-footer {
    transition: box-shadow var(--motion-fast) var(--ease-standard);
}

/*
 * 入场只缩放不位移：模态对话框没有来处，它是当场出现在你面前，所以 Apple 的 alert 是原地弹出。
 * 用关键帧而不是过渡：reka 关闭时等的是 animationend，过渡来不及播就被卸掉了。
 */
.nb-dialog[data-state="open"] {
    animation: nb-dialog-in var(--motion-base) var(--ease-standard);
}

.nb-dialog[data-state="closed"] {
    animation: nb-dialog-out var(--motion-fast) var(--ease-standard) forwards;
}

.nb-dialog__overlay[data-state="open"] {
    animation: nb-dialog-fade-in var(--motion-base) var(--ease-standard);
}

.nb-dialog__overlay[data-state="closed"] {
    animation: nb-dialog-fade-out var(--motion-fast) var(--ease-standard) forwards;
}

@keyframes nb-dialog-in {
    from {
        opacity: 0;
        transform: scale(0.96);
    }
}

@keyframes nb-dialog-out {
    to {
        opacity: 0;
        transform: scale(0.96);
    }
}

@keyframes nb-dialog-fade-in {
    from {
        opacity: 0;
    }
}

@keyframes nb-dialog-fade-out {
    to {
        opacity: 0;
    }
}
</style>
