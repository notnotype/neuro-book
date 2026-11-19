<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, ref, watch} from "vue";

import {useUiText} from "../../text-port";
import Button from "../controls/Button.vue";
import CopyButton from "../controls/CopyButton.vue";
import Spinner from "../display/Spinner.vue";
import Dialog from "./Dialog.vue";
import {previewImageSize} from "./image-preview-size";

const props = withDefaults(defineProps<{
    open: boolean;
    src: string;
    alt: string;
    downloadName?: string;
    /** 长边不到它的图放大到它（仍受可用空间限制）；0 为只缩小不放大。 */
    minSize?: number;
    /** 给了就在头部放一个复制按钮，复制这段文字。 */
    copyText?: string;
    copyLabel?: string;
    teleportTarget?: string | false;
}>(), {
    downloadName: "",
    minSize: 0,
    copyText: undefined,
    copyLabel: undefined,
    teleportTarget: undefined,
});

const emit = defineEmits<{
    (e: "update:open", value: boolean): void;
}>();

const text = useUiText();
const loadState = ref<"loading" | "loaded" | "error">("loading");
const retryNonce = ref(0);
/**
 * 重试时给服务器地址加一个查询参数，绕过浏览器缓存的失败结果。`blob:`、`data:` 地址不能带查询参数（加了必然加载失败），
 * 只靠换一个 `<img>` 元素（`:key`）重新加载。
 */
const requestUrl = computed(() => retryNonce.value === 0 || /^(?:blob|data):/u.test(props.src)
    ? props.src
    : `${props.src}${props.src.includes("?") ? "&" : "?"}previewRetry=${String(retryNonce.value)}`);

/** 尺寸未知（加载中、失败、SVG 没写宽高）时占的区域。 */
const PLACEHOLDER = {width: 320, height: 200};
/** 浮层宿主四周留给遮罩的空白，与 Dialog 宿主的 p-4 一致。 */
const HOST_GAP = 16;
/** 卡片最窄的宽度：很小的图片也要放得下标题和头部的几个按钮。 */
const MIN_STAGE_WIDTH = 240;

const stageRef = ref<HTMLElement | null>(null);
const natural = ref<{width: number; height: number} | null>(null);
/** 图片（或尺寸未知时的占位区域）的显示尺寸。 */
const displaySize = ref({...PLACEHOLDER});
const sizeStyle = computed(() => ({width: `${displaySize.value.width}px`, height: `${displaySize.value.height}px`}));
/** 卡片随内容收缩，CSS 百分比在这里会退化成图片自身的宽度，所以最小宽度按可用宽度算成像素。 */
const minStageWidth = ref(MIN_STAGE_WIDTH);
const stageStyle = computed(() => ({
    minWidth: `${minStageWidth.value}px`,
    ...(loadState.value === "loaded" ? {} : sizeStyle.value),
}));
let hostObserver: ResizeObserver | null = null;

watch(() => [props.open, props.src], () => {
    loadState.value = "loading";
    retryNonce.value = 0;
    natural.value = null;
});

/**
 * 图片按原始尺寸显示（长边不到 `minSize` 的放大到它），超出时等比缩小，卡片贴着图片。可用空间取浮层宿主（Dialog 面板的
 * 父元素：产品里是窗口，Lab 就地渲染时是画布）扣掉四周空白和卡片自己的头部与留白。
 * 纯 CSS 做不到：卡片高度随内容，图片的百分比高度在这里没有参照。
 */
function measure(): void {
    const stage = stageRef.value;
    const panel = stage?.closest<HTMLElement>("[role='dialog']");
    const host = panel?.parentElement;
    if (!stage || !panel || !host) {
        return;
    }
    const panelStyle = getComputedStyle(panel);
    const chromeWidth = Number.parseFloat(panelStyle.paddingLeft) + Number.parseFloat(panelStyle.paddingRight)
        + Number.parseFloat(panelStyle.borderLeftWidth) + Number.parseFloat(panelStyle.borderRightWidth);
    const chromeHeight = panel.offsetHeight - stage.offsetHeight;
    const availableWidth = Math.max(1, host.clientWidth - HOST_GAP * 2 - chromeWidth);
    const availableHeight = Math.max(1, host.clientHeight - HOST_GAP * 2 - chromeHeight);
    minStageWidth.value = Math.min(MIN_STAGE_WIDTH, availableWidth);
    // 尺寸未知时的占位区域不放大。
    displaySize.value = previewImageSize(natural.value ?? PLACEHOLDER, {width: availableWidth, height: availableHeight}, natural.value === null ? 0 : props.minSize);
    if (!hostObserver && typeof ResizeObserver !== "undefined") {
        hostObserver = new ResizeObserver(() => measure());
        hostObserver.observe(host);
    }
}

function stopObserving(): void {
    hostObserver?.disconnect();
    hostObserver = null;
}

watch(() => props.open, async (open) => {
    stopObserving();
    if (open) {
        await nextTick();
        measure();
    }
}, {immediate: true});

onBeforeUnmount(stopObserving);

function onLoad(event: Event): void {
    const image = event.target as HTMLImageElement;
    // 没写宽高的 SVG 报 0，按占位区域等比放进去。
    natural.value = image.naturalWidth > 0 && image.naturalHeight > 0 ? {width: image.naturalWidth, height: image.naturalHeight} : null;
    loadState.value = "loaded";
    measure();
}

function onError(): void {
    loadState.value = "error";
    natural.value = null;
    measure();
}

/** 用户显式重试；对话框关闭前保留错误态。 */
function retry(): void {
    loadState.value = "loading";
    retryNonce.value += 1;
}
</script>

<template>
    <!--
        只在打开时挂载 img，缩略图列表不会提前请求原图。
        宽度写 fit-content：Dialog 的面板四边贴住容器再 margin auto 居中，写 auto 会撑满整个容器，卡片就不贴着图片了。
    -->
    <Dialog
        :open="props.open"
        :title="props.alt"
        closable
        :close-label="text('imagePreviewDialog.close')"
        width="fit-content"
        height="auto"
        max-height="100%"
        :show-footer="false"
        body-class="!overflow-hidden"
        header-class="nb-image-preview__header"
        :teleport-target="props.teleportTarget"
        @update:open="emit('update:open', $event)"
    >
        <template #header-extra>
            <CopyButton v-if="props.copyText !== undefined" :text="props.copyText" :label="props.copyLabel" icon-only data-image-preview-copy />
            <a :href="props.src" :download="props.downloadName" class="nb-image-preview__download nb-ui-focus-ring" :title="text('imagePreviewDialog.downloadOriginal')" :aria-label="text('imagePreviewDialog.downloadOriginal')">
                <span class="i-lucide-download h-4 w-4" aria-hidden="true"></span>
            </a>
        </template>
        <div ref="stageRef" class="nb-image-preview__stage" :style="stageStyle">
            <Spinner v-if="loadState === 'loading'" size="lg" :label="text('imagePreviewDialog.loading')" />
            <img v-if="props.open && props.src && loadState !== 'error'" :key="retryNonce" :src="requestUrl" :alt="props.alt" class="nb-image-preview__image" :class="{'is-loading': loadState === 'loading'}" :style="loadState === 'loaded' ? sizeStyle : undefined" @load="onLoad" @error="onError">
            <div v-if="loadState === 'error'" class="nb-image-preview__error" role="alert">
                <span class="i-lucide-image-off h-7 w-7" aria-hidden="true"></span>
                <span>{{ text("imagePreviewDialog.loadFailed") }}</span>
                <Button size="sm" variant="secondary" icon-class="i-lucide-refresh-cw" @click="retry">
                    {{ text("imagePreviewDialog.retry") }}
                </Button>
            </div>
        </div>
    </Dialog>
</template>

<style scoped>
/*
 * 标题不参与卡片宽度的计算：卡片贴着图片，长标题在头部里截断。Dialog 的头部在组件外，
 * 这个类经 header-class 挂上去，所以用 :global。
 */
:global(.nb-image-preview__header) {
    width: 0;
    min-width: 100%;
}

/* 很小的图片在最小宽高的区域里居中；最小宽度由 measure 按可用宽度给出。 */
.nb-image-preview__stage {
    position: relative;
    display: flex;
    min-height: 120px;
    max-width: 100%;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border-radius: var(--radius-control);
    background: var(--bg-subtle);
}

.nb-image-preview__image {
    display: block;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
}

/* 加载中不占位：尺寸未知时卡片先按占位区域摆好，图片到了再换。 */
.nb-image-preview__image.is-loading {
    position: absolute;
    opacity: 0;
}

.nb-image-preview__error {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-6);
    color: var(--status-danger);
    font-size: var(--text-sm);
    text-align: center;
}

/* 与 IconButton 默认尺寸、配色一致；下载必须是带 download 的链接，IconButton 只能是按钮。 */
.nb-image-preview__download {
    display: inline-flex;
    flex: none;
    width: 32px;
    height: 32px;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-control);
    color: var(--text-secondary);
    transition: background-color var(--motion-fast) var(--ease-layout), color var(--motion-fast) var(--ease-layout);
}

.nb-image-preview__download:hover {
    background: color-mix(in srgb, var(--text-main) 15%, transparent);
    color: var(--text-main);
}
</style>
