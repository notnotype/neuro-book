<script setup lang="ts">
/**
 * 对话框的外框（内部零件，同名 .md）：面、标题栏、正文、页脚、关闭按钮，`Dialog` 与 `FloatingWindow` 共用这一份。
 * 它不管定位、叠放、焦点与关闭判定：位置与尺寸由宿主经 `style` 给，关闭按钮与取消按钮只发事件，由宿主判定。
 *
 * 单根：宿主的 class、style、`data-*` 与 `@pointerdown`（窗口拖动）落到外框 `<section>` 上；reka 的 `DialogContent
 * as-child` 也把角色与标题关联挂在它上面。窗口的缩放手柄从 `edges` 插槽放进来。
 */
import {onBeforeUnmount, ref, watch} from "vue";
import type {HTMLAttributes} from "vue";
import {DialogTitle} from "reka-ui";

import Button from "../controls/Button.vue";
import IconButton from "../controls/IconButton.vue";
import {footerFillsRow} from "./dialog-frame";
import type {DialogSize} from "./dialog-frame";

const props = defineProps<{
    size: DialogSize;
    /** 可见的标题；为空时标题只给读屏（`titleText`）。 */
    title: string;
    /** 读屏用的标题：`title` 为空时是缺省名字。 */
    titleText: string;
    showHeader: boolean;
    closable: boolean;
    closeText: string;
    showFooter: boolean;
    showCancel: boolean;
    cancelText: string;
    confirmText: string;
    busy: boolean;
    status: string;
    headerClass?: string;
    bodyClass?: string;
    /** 叠在另一个对话框或窗口里：画二级的面。由宿主从 useOverlayLayer 拿到后传进来。 */
    nested: boolean;
    /** 浮动窗口：标题栏可拖动、外框带窗口的圆角。 */
    window: boolean;
} & /* @vue-ignore */ HTMLAttributes>();

const emit = defineEmits<{
    (e: "request-close", reason: "close-button" | "cancel"): void;
    (e: "confirm"): void;
}>();

const panel = ref<HTMLElement | null>(null);
const body = ref<HTMLElement | null>(null);
defineExpose({panel});

const fillsRow = (): boolean => footerFillsRow(props.size);

/*
 * 正文是滚动容器，会裁掉贴边控件的外扩光环（焦点环、色块的选中环）。四边留一圈给光环，再用等量负外边距抵掉，
 * 内容的位置不变；这一圈藏在面板的留白里（面板四边的留白都比它宽）。
 */
const bodyStyle = {fontSize: "var(--text-sm)", padding: "var(--space-3)", margin: "calc(var(--space-3) * -1)"};

/*
 * 头尾的分隔线只在正文**真的滚动得起来**的时候才画（设计语言坑 #32）。常驻两条通栏细线会把对话框切成三段；
 * macOS 的 sheet 平时一条线都没有，内容滚到标题下面去了才浮出一条分隔。
 */
const scrolledFromTop = ref(false);
const scrollableBelow = ref(false);
let panelResizeObserver: ResizeObserver | null = null;

function syncBodyScroll(): void {
    const element = body.value;
    if (!element) return;
    scrolledFromTop.value = element.scrollTop > 0;
    // 留 1px 容差：缩放比例不是整数时 scrollTop + clientHeight 会差出零点几个像素
    scrollableBelow.value = element.scrollTop + element.clientHeight < element.scrollHeight - 1;
}

// 面板高度会随内容变（异步加载的内容最典型），正文自己的滚动事件那时还没发生过：尺寸变了也重算一次。
watch(panel, (element) => {
    panelResizeObserver?.disconnect();
    panelResizeObserver = null;
    scrolledFromTop.value = false;
    scrollableBelow.value = false;
    if (element === null) return;
    syncBodyScroll();
    if (typeof ResizeObserver !== "undefined") {
        panelResizeObserver = new ResizeObserver(syncBodyScroll);
        panelResizeObserver.observe(element);
    }
});
onBeforeUnmount(() => panelResizeObserver?.disconnect());
</script>

<template>
    <section
        ref="panel"
        class="nb-dialog nb-ui-popover-surface nb-ui-dialog-surface nb-ui-surface-rim flex flex-col overflow-hidden text-[var(--text-main)] outline-none"
        :class="[props.window ? 'nb-dialog--window nb-ui-dialog-surface--window' : 'nb-dialog--modal', props.nested ? 'nb-ui-dialog-surface--nested' : '']"
        data-dialog-surface
        :data-dialog-window="props.window ? '' : undefined"
    >
        <!-- 浮动窗口里整条标题栏都能拖（按钮除外）；标题文字那一块给出移动光标。 -->
        <header
            v-if="props.showHeader"
            class="nb-dialog__header flex items-center justify-between gap-3"
            :class="props.headerClass"
            :style="{boxShadow: scrolledFromTop ? '0 1px 0 var(--divider)' : 'none'}"
            :data-dialog-drag="props.window ? '' : undefined"
        >
            <div class="min-w-0 flex-1" :class="props.window ? 'cursor-move' : ''">
                <DialogTitle v-if="$slots.header" as="div" class="nb-ui-dialog-title truncate">
                    <slot name="header" />
                </DialogTitle>
                <DialogTitle v-else class="nb-ui-dialog-title truncate" :class="props.title === '' ? 'sr-only' : ''">{{ props.titleText }}</DialogTitle>
            </div>
            <slot name="header-extra"></slot>
            <IconButton v-if="props.closable" size="sm" :title="props.closeText" :aria-label="props.closeText" :disabled="props.busy" @click="emit('request-close', 'close-button')">
                <span class="i-lucide-x h-4 w-4"></span>
            </IconButton>
        </header>
        <template v-else>
            <DialogTitle class="sr-only">{{ props.titleText }}</DialogTitle>
            <!-- 没有标题栏时关闭按钮贴在面板右上角，浮在正文之上；正文要给它让出位置（见同名 .md）。 -->
            <IconButton
                v-if="props.closable"
                class="nb-dialog__corner-close"
                size="sm"
                :title="props.closeText"
                :aria-label="props.closeText"
                :disabled="props.busy"
                @click="emit('request-close', 'close-button')"
            >
                <span class="i-lucide-x h-4 w-4"></span>
            </IconButton>
        </template>
        <div
            ref="body"
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
            :class="fillsRow() ? '' : 'justify-end'"
            :style="{boxShadow: scrollableBelow ? '0 -1px 0 var(--divider)' : 'none'}"
        >
            <!-- 状态行一直占着按钮左边的位置（空着也在）：平时是 status 插槽的中性状态，出错时换成错误，按钮不动。 -->
            <p
                v-if="!fillsRow()"
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
            <slot name="footer" :confirm="() => emit('confirm')" :cancel="() => emit('request-close', 'cancel')">
                <Button v-if="props.showCancel" variant="secondary" :class="fillsRow() ? 'flex-1' : ''" :disabled="props.busy" @click="emit('request-close', 'cancel')">{{ props.cancelText }}</Button>
                <Button variant="primary" :class="fillsRow() ? 'flex-1' : ''" :disabled="props.busy" @click="emit('confirm')">{{ props.confirmText }}</Button>
            </slot>
        </footer>
        <slot name="edges" />
    </section>
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
 * 入场：有来处的（用户点按钮或菜单项打开的）朝来处偏一小段并放大，没有来处的（快捷键、命令面板、程序打开）原地缩放淡入。
 * 偏移与起始缩放由宿主经 `--nb-dialog-from-x/y/scale` 写在面板上（useDialogOrigin，规则见 dialog-origin.ts），没写就是原地；
 * 有来处时入场用 `--motion-enter`（由 `--nb-dialog-enter-duration` 带进来），否则 `--motion-base`。关闭沿用同一组变量，朝同一方向收回。
 * 系统要求减少动态效果时这些时长令牌都是 0，动画不播，第一帧就是终点。
 * 用关键帧而不是过渡：reka 关闭时等的是 animationend，过渡来不及播就被卸掉了。
 */
.nb-dialog[data-state="open"] {
    animation: nb-dialog-in var(--nb-dialog-enter-duration, var(--motion-base)) var(--ease-standard);
}

.nb-dialog[data-state="closed"] {
    animation: nb-dialog-out var(--motion-fast) var(--ease-standard) forwards;
}

@keyframes nb-dialog-in {
    from {
        opacity: 0;
        transform: translate(var(--nb-dialog-from-x, 0px), var(--nb-dialog-from-y, 0px)) scale(var(--nb-dialog-from-scale, 0.96));
    }
}

@keyframes nb-dialog-out {
    to {
        opacity: 0;
        transform: translate(var(--nb-dialog-from-x, 0px), var(--nb-dialog-from-y, 0px)) scale(var(--nb-dialog-from-scale, 0.96));
    }
}
</style>
