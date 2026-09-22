<script setup lang="ts">
import {computed, getCurrentInstance, nextTick, onBeforeUnmount, onMounted, ref, watch} from "vue";
import {NB_Z_INDEX} from "../../theme/z-index";
import {getFocusable, trapTabKey} from "../../utils/focus-trap";
import IconButton from "../controls/IconButton.vue";

type DialogSize = "sm" | "default" | "md" | "lg" | "xl" | "full";
type DialogCloseReason = "overlay" | "cancel" | "close-button" | "esc";

type DialogSizePreset = {
    width: string;
    height: string;
    maxHeight: string;
};

const DIALOG_SIZE_PRESETS: Record<DialogSize, DialogSizePreset> = {
    sm: {width: "360px", height: "auto", maxHeight: "85vh"},
    default: {width: "420px", height: "auto", maxHeight: "85vh"},
    md: {width: "min(560px, calc(100vw - 32px))", height: "auto", maxHeight: "85vh"},
    lg: {width: "min(720px, calc(100vw - 32px))", height: "auto", maxHeight: "calc(100vh - 32px)"},
    xl: {width: "min(1080px, calc(100vw - 20px))", height: "min(780px, calc(100vh - 20px))", maxHeight: "calc(100vh - 20px)"},
    full: {width: "calc(100vw - 24px)", height: "calc(100vh - 24px)", maxHeight: "calc(100vh - 24px)"},
};

const props = withDefaults(defineProps<{
    modelValue: boolean;
    size?: DialogSize;
    title?: string;
    closable?: boolean;
    showHeader?: boolean;
    closeOnOverlay?: boolean;
    closeOnEsc?: boolean;
    width?: string;
    height?: string;
    maxHeight?: string;
    teleportTarget?: string | boolean;
    overlayType?: "transparent" | "blur" | "opaque";
    showCancel?: boolean;
    showFooter?: boolean;
    busy?: boolean;
    bodyClass?: string;
    headerClass?: string;
    cancelLabel?: string;
    confirmLabel?: string;
    closeLabel?: string;
}>(), {
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
    teleportTarget: "body",
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
    bodyClass: "",
    headerClass: "",
    cancelLabel: "取消",
    confirmLabel: "确认",
    closeLabel: "关闭",
});

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "confirm"): void;
    (e: "cancel"): void;
    (e: "request-close", reason: DialogCloseReason): void;
}>();

const instance = getCurrentInstance();
const overlayPointerButton = ref<number | null>(null);
const isMounted = ref(false);
const panelRef = ref<HTMLElement | null>(null);
const bodyRef = ref<HTMLElement | null>(null);
/*
 * 头尾的分隔线只在正文**真的滚动得起来**的时候才画。
 *
 * 常驻两条通栏细线会把对话框切成三段，这是后台管理面板的读法不是 Apple 的读法——
 * macOS 的 sheet 平时一条线都没有，内容滚到工具栏下面去了才浮出一条分隔，
 * 那条线的意思是「上面还有内容」，不是「这里是标题栏」。没有内容可滚时它就不该存在。
 */
const scrolledFromTop = ref(false);
const scrollableBelow = ref(false);
// 打开前的焦点元素，关闭时归还
let previousFocus: HTMLElement | null = null;
// 滚动锁前 body 的 overflow 原值
let previousBodyOverflow: string | null = null;
// 面板尺寸变化时重算分隔线（异步内容撑开面板是最常见的一种）
let panelResizeObserver: ResizeObserver | null = null;

function hasListener(name: "onRequestClose" | "onConfirm"): boolean {
    return Boolean(instance?.vnode.props && name in instance.vnode.props);
}

const hasRequestCloseListener = computed(() => hasListener("onRequestClose"));
const hasConfirmListener = computed(() => hasListener("onConfirm"));
const resolvedSizePreset = computed(() => DIALOG_SIZE_PRESETS[props.size]);
const resolvedWidth = computed(() => props.width ?? resolvedSizePreset.value.width);
const resolvedHeight = computed(() => props.height ?? resolvedSizePreset.value.height);
const resolvedMaxHeight = computed(() => props.maxHeight ?? resolvedSizePreset.value.maxHeight);
const resolvedTeleportTarget = computed(() => {
    if (typeof props.teleportTarget === "string") {
        if (typeof document !== "undefined" && !document.querySelector(props.teleportTarget)) {
            return "body";
        }
        return props.teleportTarget;
    }
    return "body";
});

/*
 * 按钮平分整行还是右对齐——Apple 自己就是分两档的，本轮从官方 macOS 27 UI Kit 实测：
 *
 * - **Alert**（260px 宽，只有一句话）：按钮行 `display:flex; gap:8px; width:228px`，
 *   两颗各 110px，正好把内容宽度分完。窄框里右对齐会剩一大片空白，选项也显得不对等。
 * - **Save Dialog**（390px 宽，里面是一组表单行）：按钮 76×24 **右对齐**。
 *   宽框里平分整行会得到两颗夸张的长条，而且按钮会离它要确认的那些字段太远。
 *
 * 所以判据是「这个框窄不窄」，不是「它是不是对话框」。sm / default 走 alert 那一档，
 * md 以上走 sheet 那一档。
 */
const footerFillsRow = computed(() => props.size === "sm" || props.size === "default");

/*
 * 三段的留白由一处算出来，不各写各的。
 *
 * **不设头尾条。** 这是本轮从 Apple 官方 macOS 27 UI Kit 实测回来的结论：那份文件里
 * Save Dialog 与 Alert 都是**一列 flex，四边留白基本一致**，标题只是这一列的第一个块，
 * 按钮只是最后一个块——没有「标题独占一条、按钮独占一条」这种结构。
 * 官方文件读到的取值：Save Dialog `padding: 20px; gap: 20px`；
 * Alert `padding: 20px 16px 16px; gap: 14px`。
 *
 * 「头尾条」是 Web / Windows 的做法。上一版把留白配额发给三个条各自持有，于是每加一条
 * 内容就多一道横向的分界，读起来是三个堆叠的条而不是一块面板——用户的原话是
 * 「这个 box 没有学到精髓」。留白收归容器之后，三段自动共用同一条左右边线。
 *
 * 上留白比左右多一档（20 vs 16），也是官方文件里的原值：标题的字面顶端比它的行盒要低，
 * 四边等距时读起来会像偏上。
 */
const surfaceStyle = computed(() => ({
    paddingBlockStart: "calc(var(--panel-p) + var(--space-2))",
    paddingInline: "var(--panel-p)",
    paddingBlockEnd: "var(--panel-p)",
    /* 14px 是官方 Alert 的原值。这一档不是行距而是**块与块之间的空**，
       所以不跟着中文放松——放松的是行高，那一档在 --leading-ui 里已经给过了 */
    gap: "calc(var(--space-6) - var(--space-1))",
}));

/** 正文能不能滚、滚到哪儿了——两条分隔线各看一头 */
function syncBodyScroll(): void {
    const body = bodyRef.value;
    if (!body) {
        return;
    }
    scrolledFromTop.value = body.scrollTop > 0;
    // 留 1px 容差：缩放比例不是整数时 scrollTop + clientHeight 会差出零点几个像素
    scrollableBelow.value = body.scrollTop + body.clientHeight < body.scrollHeight - 1;
}

function closeImmediate(): void {
    emit("update:modelValue", false);
    emit("cancel");
}

function requestClose(reason: DialogCloseReason): void {
    if (props.busy) {
        return;
    }
    emit("request-close", reason);
    if (!hasRequestCloseListener.value) {
        closeImmediate();
    }
}

function handleConfirm(): void {
    if (props.busy) {
        return;
    }
    emit("confirm");
    if (!hasConfirmListener.value) {
        closeImmediate();
    }
}

function handleOverlayPointerDown(event: PointerEvent): void {
    overlayPointerButton.value = event.button;
}

function handleOverlayPointerUp(event: PointerEvent): void {
    const pressedButton = overlayPointerButton.value;
    overlayPointerButton.value = null;
    if (!props.closeOnOverlay || pressedButton === null || event.button !== pressedButton) {
        return;
    }
    if (event.button === 0 || event.button === 2) {
        requestClose("overlay");
    }
}

function handleOverlayContextMenu(event: MouseEvent): void {
    event.preventDefault();
}

function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && props.closeOnEsc) {
        requestClose("esc");
        return;
    }
    // 焦点陷阱：Tab 在面板内首尾循环
    if (panelRef.value) {
        trapTabKey(event, panelRef.value);
    }
}

/** 打开时的副作用：键盘监听、滚动锁、焦点移入面板 */
function activate(): void {
    document.addEventListener("keydown", handleKeydown);
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    void nextTick(() => {
        const panel = panelRef.value;
        if (!panel) {
            return;
        }
        syncBodyScroll();
        /*
         * 面板高度会随内容变（异步加载的内容最典型），而正文自己的滚动事件那时还没发生过——
         * 只在 @scroll 里算的话，一段「打开时是空的、随后填满」的内容永远读到「不用滚」。
         */
        if (typeof ResizeObserver !== "undefined") {
            panelResizeObserver = new ResizeObserver(syncBodyScroll);
            panelResizeObserver.observe(panel);
        }
        const target = getFocusable(panel)[0] ?? panel;
        target.focus();
    });
}

/** 关闭时的副作用：解除监听与滚动锁、焦点归还触发元素 */
function deactivate(): void {
    document.removeEventListener("keydown", handleKeydown);
    panelResizeObserver?.disconnect();
    panelResizeObserver = null;
    scrolledFromTop.value = false;
    scrollableBelow.value = false;
    if (previousBodyOverflow !== null) {
        document.body.style.overflow = previousBodyOverflow;
        previousBodyOverflow = null;
    }
    previousFocus?.focus();
    previousFocus = null;
}

watch(() => props.modelValue, (visible) => {
    if (typeof document === "undefined") {
        return;
    }
    if (visible) {
        activate();
    } else {
        deactivate();
    }
});

onMounted(() => {
    isMounted.value = true;
    // 以 modelValue=true 初始挂载时 watch 不触发，手动补激活
    if (props.modelValue && typeof document !== "undefined") {
        activate();
    }
});

onBeforeUnmount(() => {
    if (typeof document !== "undefined") {
        deactivate();
    }
    overlayPointerButton.value = null;
});
</script>

<template>
    <Teleport v-if="isMounted" :to="resolvedTeleportTarget" :disabled="teleportTarget === false">
        <Transition name="nb-dialog">
            <div
                v-if="modelValue"
                class="fixed inset-0 flex items-center justify-center p-4"
                :style="{zIndex: NB_Z_INDEX.dialog}"
            >
                <!--
                    遮罩与面板是**平级**，不是父子。
                    面板原来是遮罩的子元素，而一个带 backdrop-filter 的元素会成为其子元素的
                    backdrop root——子元素的磨砂因此采不到任何背景，玻璃主题下表现为
                    「Dialog 一点都不模糊」，且 backdrop-filter 在计算样式里明明是有值的，很难查。
                    平级之后面板才有东西可采。

                    .self 修饰符随之去掉：遮罩现在没有子元素，落在它上面的指针事件必然是「点在外面」。
                -->
                <div
                    class="absolute inset-0 transition-colors [transition-duration:var(--motion-base)]"
                    :class="overlayType === 'transparent' ? 'bg-transparent' : overlayType === 'blur' ? 'bg-[var(--overlay-bg)] backdrop-blur-sm' : 'bg-[var(--overlay-bg)]'"
                    @pointerdown="handleOverlayPointerDown"
                    @pointerup="handleOverlayPointerUp"
                    @contextmenu="handleOverlayContextMenu"
                ></div>
                <!-- relative 是必需的：遮罩是 absolute，静态定位的面板会画在它下面 -->
                <section ref="panelRef" role="dialog" aria-modal="true" :aria-label="props.title || undefined" tabindex="-1" class="nb-ui-popover-surface nb-ui-dialog-surface nb-ui-surface-rim relative flex flex-col overflow-hidden text-[var(--text-main)] outline-none" :style="{width: resolvedWidth, height: resolvedHeight, maxHeight: resolvedMaxHeight, ...surfaceStyle}">
                    <!--
                        头尾不是「条」，是这一列的第一个块和最后一个块：它们没有自己的 padding，
                        留白由 section 一处给（理由见 script 里 surfaceStyle 那段）。
                        分隔线只在正文**真的滚动得起来**时才浮出，线用 --divider 不用 --border-color。
                    -->
                    <header
                        v-if="props.showHeader"
                        class="flex items-start justify-between gap-3"
                        :class="props.headerClass"
                        :style="{
                            boxShadow: scrolledFromTop ? '0 1px 0 var(--divider)' : 'none',
                            transition: 'box-shadow var(--motion-fast) var(--ease-standard)',
                        }"
                    >
                        <slot name="header">
                            <!--
                                标题与正文**同字号**，只差字重和颜色。这是 Apple 官方 UI Kit 里的实测值
                                （Alert 的 Title 是 SF Pro Bold 13px，Description 是 SF Pro Regular 13px，
                                两者行高同为 16px）。上一版是 16px semibold 标题配 14px 正文——
                                两个字号拉开的是**网页 H2 + 段落**的关系，不是一块面板里的一句话。
                            -->
                            <h2 class="min-w-0 flex-1 truncate" :style="{fontSize: 'var(--text-sm)', fontWeight: '700', lineHeight: 'var(--leading-tight)'}">{{ props.title }}</h2>
                            <slot name="header-extra"></slot>
                            <IconButton v-if="props.closable" :title="props.closeLabel" :aria-label="props.closeLabel" :disabled="props.busy" @click="requestClose('close-button')">
                                <span class="i-lucide-x h-4 w-4"></span>
                            </IconButton>
                        </slot>
                    </header>
                    <div
                        ref="bodyRef"
                        class="min-h-0 flex-1 overflow-y-auto leading-relaxed"
                        :class="props.bodyClass"
                        :style="{fontSize: 'var(--text-sm)'}"
                        @scroll="syncBodyScroll"
                    >
                        <slot />
                    </div>
                    <footer
                        v-if="props.showFooter"
                        class="flex items-center"
                        :class="footerFillsRow ? '' : 'justify-end'"
                        :style="{
                            gap: 'var(--space-4)',
                            boxShadow: scrollableBelow ? '0 -1px 0 var(--divider)' : 'none',
                            transition: 'box-shadow var(--motion-fast) var(--ease-standard)',
                        }"
                    >
                        <slot name="footer" :confirm="handleConfirm" :cancel="() => requestClose('cancel')">
                            <!--
                                按钮**等宽平分整行**，不是右对齐的两颗。这同样是官方 UI Kit 的做法：
                                Alert 的按钮行是 `display:flex; gap:8px; width:228px`，两颗各 110px，
                                正好把内容宽度分完。右对齐 + 固定最小宽度是 Web 的做法，
                                它让「取消」和「确认」在视觉上不对等，而对话框恰恰是让人做选择的地方。

                                形状是**胶囊**：Apple 官方 macOS 27 UI Kit 的 Buttons 组里，
                                从 Mini（41×16）到 XL（66×36）全是整颗胶囊，不存在「只有大控件才 pill」这一说。
                                高度取 --control-h-sm（28px），与官方 Alert 用的 Large 档（28px）对齐。
                            -->
                            <button
                                v-if="props.showCancel"
                                type="button"
                                class="nb-ui-focus-ring transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                                :class="footerFillsRow ? 'flex-1' : ''"
                                :style="{
                                    minWidth: footerFillsRow ? undefined : 'calc(var(--control-h-sm) * 2.8)',
                                    height: 'var(--control-h-sm)',
                                    paddingInline: 'var(--control-px)',
                                    borderRadius: 'var(--radius-pill)',
                                    border: 'var(--border-w) solid var(--button-outline)',
                                    background: 'var(--button-surface)',
                                    boxShadow: 'var(--elevation-raised)',
                                    fontSize: 'var(--text-sm)',
                                    color: 'var(--text-main)',
                                }"
                                :disabled="props.busy"
                                @click="requestClose('cancel')"
                            >{{ props.cancelLabel }}</button>
                            <button
                                type="button"
                                class="nb-ui-focus-ring font-medium transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                                :class="footerFillsRow ? 'flex-1' : ''"
                                :style="{
                                    minWidth: footerFillsRow ? undefined : 'calc(var(--control-h-sm) * 2.8)',
                                    height: 'var(--control-h-sm)',
                                    paddingInline: 'var(--control-px)',
                                    borderRadius: 'var(--radius-pill)',
                                    border: 'var(--border-w) solid transparent',
                                    background: 'var(--accent-main)',
                                    boxShadow: 'var(--elevation-raised)',
                                    fontSize: 'var(--text-sm)',
                                    color: 'var(--text-inverse)',
                                }"
                                :disabled="props.busy"
                                @click="handleConfirm"
                            >{{ props.confirmLabel }}</button>
                        </slot>
                    </footer>
                </section>
            </div>
        </Transition>
    </Teleport>
</template>

<style scoped>
.nb-dialog-enter-active,
.nb-dialog-leave-active {
    transition: opacity var(--motion-base) var(--ease-standard);
}

.nb-dialog-enter-active > section,
.nb-dialog-leave-active > section {
    transition: transform var(--motion-base) var(--ease-standard), opacity var(--motion-base) var(--ease-standard);
}

.nb-dialog-enter-from,
.nb-dialog-leave-to {
    opacity: 0;
}

/*
 * 只缩放不位移。上一版是 translateY(8px) + scale(0.98)，读起来是「从下面滑上来」——
 * 那是 sheet / toast 的语义（有来处、有归处）。模态对话框没有来处，它是**当场出现在你面前**，
 * 所以 Apple 的 alert 是原地弹出。位移还会让居中的面板在入场时短暂偏离视觉中心。
 */
.nb-dialog-enter-from > section,
.nb-dialog-leave-to > section {
    opacity: 0;
    transform: scale(0.96);
}
</style>
