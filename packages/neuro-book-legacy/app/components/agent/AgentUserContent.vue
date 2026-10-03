<script setup lang="ts">
import {computed} from "vue";
import type {ContentBlockView, UserMessageView} from "./agent-view.types";

type Attachment = Extract<ContentBlockView, {kind: "attachment"}>;

const props = defineProps<{
    message: UserMessageView;
    resolveAttachmentUrl: (locator: string, variant: "thumbnail" | "original") => string | null;
}>();

const {t} = useI18n();

/** 按原顺序排列的片段；相邻的附件并成一行。 */
const segments = computed(() => {
    const result: Array<{kind: "text"; text: string} | {kind: "files"; items: Attachment[]}> = [];
    for (const block of props.message.blocks) {
        const last = result.at(-1);
        if (block.kind === "text") {
            if (block.text.trim() !== "") {
                result.push({kind: "text", text: block.text});
            }
        } else if (last?.kind === "files") {
            last.items.push(block);
        } else {
            result.push({kind: "files", items: [block]});
        }
    }
    return result;
});

function isImage(file: Attachment): boolean {
    return file.mimeType.startsWith("image/");
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
</script>

<template>
    <div class="acv-user-content">
        <template v-for="(segment, index) in segments" :key="index">
            <p v-if="segment.kind === 'text'" class="acv-user-content__text">{{ segment.text }}</p>
            <div v-else class="acv-user-content__files">
                <template v-for="file in segment.items" :key="file.locator">
                    <template v-if="isImage(file)">
                        <img
                            v-if="props.resolveAttachmentUrl(file.locator, 'thumbnail') !== null"
                            class="acv-user-content__image"
                            :src="props.resolveAttachmentUrl(file.locator, 'thumbnail')!"
                            :alt="file.name"
                            :title="file.name"
                            width="72"
                            height="72"
                            loading="lazy"
                            decoding="async"
                        >
                        <span v-else class="acv-user-content__image acv-user-content__image--missing" :title="file.name">
                            <span class="i-lucide-image-off acv-user-content__missing-icon" aria-hidden="true" />
                            {{ t("agentView.user.attachmentUnavailable") }}
                        </span>
                    </template>
                    <span v-else class="acv-user-content__file" :title="file.name">
                        <span class="i-lucide-paperclip acv-user-content__file-icon" aria-hidden="true" />
                        <span class="acv-user-content__file-name">{{ file.name }}</span>
                        <span class="acv-user-content__file-size">{{ formatBytes(file.bytes) }}</span>
                    </span>
                </template>
            </div>
        </template>
        <p v-if="props.message.contentOmitted" class="acv-user-content__omitted">
            <span class="i-lucide-scissors acv-user-content__omitted-icon" aria-hidden="true" />{{ t("agentView.user.previewOnly") }}
        </p>
    </div>
</template>

<style scoped>
.acv-user-content {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
}

.acv-user-content__text {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}

.acv-user-content__files {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    min-width: 0;
}

/* 缩略图尺寸固定：图片加载前后行高不变，消息流不会因此跳动。 */
.acv-user-content__image {
    flex-shrink: 0;
    width: 72px;
    height: 72px;
    border: var(--border-w, 1px) solid var(--divider);
    border-radius: var(--radius-control);
    background: var(--bg-subtle);
    object-fit: cover;
}

.acv-user-content__image--missing {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    color: var(--text-muted);
    font-size: 10px;
    line-height: 1.2;
}

.acv-user-content__missing-icon {
    width: 16px;
    height: 16px;
}

.acv-user-content__file {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    max-width: 100%;
    height: 24px;
    padding: 0 8px;
    border: var(--border-w, 1px) solid var(--divider);
    border-radius: var(--radius-control);
    color: var(--text-secondary);
    font-size: 12px;
}

.acv-user-content__file-icon {
    flex-shrink: 0;
    width: 12px;
    height: 12px;
}

.acv-user-content__file-name {
    min-width: 0;
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.acv-user-content__file-size {
    flex-shrink: 0;
    color: var(--text-muted);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
}

.acv-user-content__omitted {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 0;
    color: var(--text-muted);
    font-size: 11px;
}

.acv-user-content__omitted-icon {
    width: 12px;
    height: 12px;
}
</style>
