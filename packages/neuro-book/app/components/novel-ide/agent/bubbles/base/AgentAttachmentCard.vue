<script setup lang="ts">
import type {PublicAttachmentDto} from "nbook/shared/dto/agent-public-event.dto";
import {agentAttachmentUrl} from "nbook/app/components/novel-ide/agent/agent-attachment";
import OriginalImagePreviewDialog from "nbook/app/components/common/OriginalImagePreviewDialog.vue";
import {canonicalImageMime} from "nbook/shared/media/raster-image";

const props = defineProps<{
    sessionId?: number | null;
    /** live 工具结果尚未持久化时为空；此时只展示不可用状态且不发起请求。 */
    entryId?: string | null;
    contentIndex: number;
    attachment: PublicAttachmentDto;
}>();

type LoadState = "loading" | "loaded" | "error";
const loadState = ref<LoadState>("loading");
const retryNonce = ref(0);
const originalPreviewOpen = ref(false);
const isImage = computed(() => canonicalImageMime(props.attachment.mimeType) !== null);
const originalUrl = computed(() => (
    agentAttachmentUrl(props.sessionId, props.entryId, props.contentIndex) ?? ""
));
const imageUrl = computed(() => {
    if (!isImage.value) {
        return "";
    }
    const url = agentAttachmentUrl(props.sessionId, props.entryId, props.contentIndex, "attachment-chat") ?? "";
    return url && retryNonce.value > 0 ? `${url}&retry=${String(retryNonce.value)}` : url;
});
const {t, locale} = useI18n();
const attachmentName = computed(() => props.attachment.name || t("agent.chat.attachmentFile", {mimeType: props.attachment.mimeType}));
const imageAlt = computed(() => props.attachment.name || t("agent.chat.attachmentAlt", {mimeType: props.attachment.mimeType}));
const bytesLabel = computed(() => `${new Intl.NumberFormat(locale.value).format(props.attachment.bytes)} B`);

watch(imageUrl, () => {
    loadState.value = "loading";
});

watch(() => [props.sessionId, props.entryId, props.contentIndex, props.attachment.mimeType, props.attachment.bytes, props.attachment.name], () => {
    retryNonce.value = 0;
    loadState.value = "loading";
});

/** 图片成功加载后移除占位态，但保留固定容器避免列表布局抖动。 */
const onLoad = (): void => {
    loadState.value = "loaded";
};

/** 单张图片失败只影响当前附件，不改变 Chat Flow 其他消息状态。 */
const onError = (): void => {
    loadState.value = "error";
};

/** 用户显式重试单张图片；query 只用于绕过失败的浏览器缓存，授权 locator 不变。 */
const retry = (): void => {
    loadState.value = "loading";
    retryNonce.value += 1;
};
</script>

<template>
    <!-- 图片附件继续使用变体预览，点击后才加载原图。 -->
    <figure v-if="isImage" class="w-full max-w-xl overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-subtle)]">
        <div class="relative aspect-video w-full">
            <div v-if="loadState === 'loading' && imageUrl" class="absolute inset-0 flex items-center justify-center text-[var(--text-muted)]" aria-hidden="true">
                <span class="i-lucide-image-down h-5 w-5 animate-pulse"></span>
            </div>
            <button v-if="imageUrl && loadState !== 'error'" type="button" class="absolute inset-0 block h-full w-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent-main)]" :aria-label="t('ide.imagePreview.openOriginal')" @click="originalPreviewOpen = true">
                <img :src="imageUrl" :alt="imageAlt" loading="lazy" decoding="async" class="block h-full w-full object-contain transition-opacity" :class="loadState === 'loaded' ? 'opacity-100' : 'opacity-0'" @load="onLoad" @error="onError">
            </button>
            <div v-if="loadState === 'error' || !imageUrl" class="absolute inset-0 flex flex-col items-center justify-center gap-2 px-3 py-4 text-xs text-[var(--status-danger)]">
                <div class="flex items-center gap-2">
                    <span class="i-lucide-image-off h-4 w-4 shrink-0"></span>
                    <span>{{ imageUrl ? t("agent.chat.attachmentLoadFailed") : t("agent.chat.attachmentUnavailable") }}</span>
                </div>
                <button v-if="imageUrl" type="button" class="rounded border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 py-1 text-[var(--text-main)] hover:bg-[var(--bg-hover)]" @click="retry">{{ t("agent.chat.retry") }}</button>
            </div>
        </div>
        <figcaption class="flex items-center justify-between gap-2 border-t border-[var(--border-color)] px-2.5 py-1.5 text-[10px] text-[var(--text-muted)]">
            <span class="min-w-0 truncate" :title="imageAlt">{{ imageAlt }}</span>
            <span class="shrink-0 tabular-nums">{{ bytesLabel }}</span>
        </figcaption>
    </figure>

    <!-- 非图片附件只提供原件下载，不请求变体或进入图片预览。 -->
    <article v-else class="flex w-full max-w-xl items-center gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-subtle)] p-3">
        <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] text-[var(--text-muted)]">
            <span class="i-lucide-file-text h-5 w-5"></span>
        </span>
        <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-medium text-[var(--text-main)]" :title="attachmentName">{{ attachmentName }}</div>
            <div class="mt-1 flex min-w-0 items-center gap-2 text-[10px] text-[var(--text-muted)]">
                <span class="truncate">{{ attachment.mimeType }}</span>
                <span class="shrink-0 tabular-nums">{{ bytesLabel }}</span>
            </div>
        </div>
        <a v-if="originalUrl" :href="originalUrl" :download="attachment.name || ''" class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] text-[var(--accent-text)] hover:bg-[var(--bg-hover)]" :title="t('agent.chat.downloadAttachment')" :aria-label="t('agent.chat.downloadAttachment')">
            <span class="i-lucide-download h-4 w-4"></span>
        </a>
        <span v-else class="shrink-0 text-xs text-[var(--status-danger)]">{{ t("agent.chat.fileUnavailable") }}</span>
    </article>

    <OriginalImagePreviewDialog v-if="isImage" v-model="originalPreviewOpen" :src="originalUrl" :alt="imageAlt" :download-name="attachment.name" />
</template>
