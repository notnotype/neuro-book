<script setup lang="ts">
import {IconButton} from "@notnotype/nb-ui/components";
import type {AgentSessionAttachmentItemDto} from "nbook/shared/dto/agent-session.dto";
import {agentAttachmentUrl} from "nbook/app/components/novel-ide/agent/agent-attachment";
import OriginalImagePreviewDialog from "nbook/app/components/common/OriginalImagePreviewDialog.vue";
import {canonicalImageMime} from "nbook/shared/media/raster-image";

const props = defineProps<{
    sessionId: number;
    items: AgentSessionAttachmentItemDto[];
    total: number;
    hasMore: boolean;
    loading: boolean;
    search: string;
    insertDisabled: boolean;
}>();

const emit = defineEmits<{
    (e: "update:search", value: string): void;
    (e: "load-more"): void;
    (e: "insert", item: AgentSessionAttachmentItemDto): void;
    (e: "close"): void;
}>();
const {t} = useI18n();
const previewItem = ref<AgentSessionAttachmentItemDto | null>(null);
const originalPreviewOpen = computed({
    get: () => previewItem.value !== null,
    set: (open: boolean) => {
        if (!open) {
            previewItem.value = null;
        }
    },
});

function imageUrl(item: AgentSessionAttachmentItemDto): string | null {
    return isImage(item)
        ? agentAttachmentUrl(props.sessionId, item.locator.entryId, item.locator.contentIndex, "attachment-grid")
        : null;
}

/** 只有服务端规范化过的光栅 MIME 才进入图片变体与 Composer 图片链。 */
function isImage(item: AgentSessionAttachmentItemDto): boolean {
    return canonicalImageMime(item.attachment.mimeType) !== null;
}

/** 原图 URL 不带变体参数，只在共享预览 Dialog 打开后挂载。 */
function originalUrl(item: AgentSessionAttachmentItemDto | null): string {
    return item
        ? agentAttachmentUrl(props.sessionId, item.locator.entryId, item.locator.contentIndex) ?? ""
        : "";
}

function bytesLabel(bytes: number): string {
    if (bytes < 1024) return `${String(bytes)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
</script>

<template>
    <!-- Session 全分支附件目录 -->
    <section class="nb-ui-popover-surface absolute inset-x-2 top-12 z-30 flex max-h-[28rem] flex-col overflow-hidden rounded-xl">
        <header class="flex items-center gap-2 border-b border-[var(--border-color)] px-3 py-2">
            <span class="i-lucide-paperclip h-4 w-4 text-[var(--accent-text)]"></span>
            <div class="min-w-0 flex-1">
                <div class="text-xs font-medium text-[var(--text-main)]">{{ t("agent.attachments.title") }}</div>
                <div class="text-[10px] text-[var(--text-muted)]">{{ t("agent.attachments.total", {count: props.total}) }}</div>
            </div>
            <IconButton icon-class="i-lucide-x" size="sm" variant="default" :title="t('agent.attachments.close')" :aria-label="t('agent.attachments.close')" @click="emit('close')" />
        </header>

        <div class="border-b border-[var(--border-color)] p-2">
            <div class="flex items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--bg-subtle)] px-2">
                <span class="i-lucide-search h-3.5 w-3.5 text-[var(--text-muted)]"></span>
                <input :value="props.search" class="nb-ui-native-input min-w-0 flex-1 bg-transparent py-1.5 text-xs text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)]" :placeholder="t('agent.attachments.searchPlaceholder')" @input="emit('update:search', ($event.target as HTMLInputElement).value)" />
            </div>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto p-2">
            <div v-if="props.items.length > 0" class="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <article v-for="item in props.items" :key="item.attachment.attachmentId" class="min-w-0 overflow-hidden rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--bg-subtle)]">
                    <button v-if="isImage(item) && imageUrl(item)" type="button" class="block aspect-video w-full cursor-zoom-in bg-[var(--bg-panel)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent-main)]" :aria-label="t('ide.imagePreview.openOriginal')" @click="previewItem = item">
                        <img :src="imageUrl(item) || undefined" :alt="item.attachment.name || t('agent.attachments.imageAlt')" class="h-full w-full object-contain" loading="lazy" decoding="async">
                    </button>
                    <div v-else class="flex aspect-video w-full items-center justify-center bg-[var(--bg-panel)] text-[var(--text-muted)]" aria-hidden="true">
                        <span class="i-lucide-file h-8 w-8"></span>
                    </div>
                    <div class="space-y-1 p-2">
                        <div class="truncate text-[11px] font-medium text-[var(--text-main)]" :title="item.attachment.name || item.attachment.attachmentId">{{ item.attachment.name || item.attachment.attachmentId }}</div>
                        <div class="flex items-center justify-between gap-1 text-[9px] text-[var(--text-muted)]">
                            <span class="truncate">{{ item.attachment.mimeType }}</span>
                            <span class="shrink-0">{{ bytesLabel(item.attachment.bytes) }}</span>
                        </div>
                        <button v-if="isImage(item)" type="button" class="w-full rounded-[var(--radius-control)] border border-[var(--border-color)] px-2 py-1 text-[10px] text-[var(--accent-text)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40" :disabled="props.insertDisabled" @click="emit('insert', item)">{{ t("agent.attachments.insert") }}</button>
                        <a v-else :href="originalUrl(item)" :download="item.attachment.name || ''" class="flex w-full items-center justify-center gap-1 rounded-[var(--radius-control)] border border-[var(--border-color)] px-2 py-1 text-[10px] text-[var(--accent-text)] hover:bg-[var(--bg-hover)]"><span class="i-lucide-download h-3 w-3"></span>{{ t("agent.attachments.downloadFile") }}</a>
                    </div>
                </article>
            </div>
            <div v-else-if="!props.loading" class="flex min-h-28 flex-col items-center justify-center gap-2 text-xs text-[var(--text-muted)]">
                <span class="i-lucide-images h-6 w-6"></span>
                <span>{{ props.search ? t("agent.attachments.noMatches") : t("agent.attachments.empty") }}</span>
            </div>
            <div v-if="props.loading" class="flex items-center justify-center gap-2 py-4 text-xs text-[var(--text-muted)]"><span class="i-lucide-loader-circle h-4 w-4 animate-spin"></span><span>{{ t("agent.attachments.loading") }}</span></div>
            <button v-else-if="props.hasMore" type="button" class="mt-2 w-full rounded-[var(--radius-control)] border border-[var(--border-color)] py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="emit('load-more')">{{ t("agent.attachments.loadMore") }}</button>
        </div>
    </section>
    <OriginalImagePreviewDialog v-model="originalPreviewOpen" :src="originalUrl(previewItem)" :alt="previewItem?.attachment.name || t('agent.attachments.imageAlt')" :download-name="previewItem?.attachment.name" />
</template>
