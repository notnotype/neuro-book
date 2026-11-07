<script setup lang="ts">
import {IconButton} from "@notnotype/nb-ui/components";

import {useMarkdownText} from "../host/text";

import type {PromptAttachmentCard} from "./prompt-editor.types";

const props = withDefaults(defineProps<{
    cards: readonly PromptAttachmentCard[];
    highlighted?: string | null;
    readonly?: boolean;
}>(), {
    highlighted: null,
    readonly: false,
});

const emit = defineEmits<{
    (e: "activate", id: string): void;
    (e: "remove", id: string): void;
    (e: "retry", id: string): void;
    (e: "hover", key: string | null): void;
}>();

const {t} = useMarkdownText();

function cardLabel(card: PromptAttachmentCard): string {
    return card.kind === "image"
        ? t("prompt.tokenImage", {number: card.number})
        : t("prompt.tokenFile", {number: card.number, name: card.name});
}

function formatSize(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
    }
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function detail(card: PromptAttachmentCard): string {
    if (card.excerpt) {
        return t("prompt.lines", {count: card.excerpt.lines});
    }
    return typeof card.size === "number" ? formatSize(card.size) : "";
}
</script>

<template>
    <div v-if="props.cards.length > 0" class="prompt-strip" role="list" :aria-label="t('prompt.attachmentLabel')">
        <div
            v-for="card in props.cards"
            :key="card.id"
            class="prompt-strip__card"
            :class="[`is-${card.kind}`, `is-${card.state}`, {'is-highlighted': props.highlighted === card.hoverKey, 'has-excerpt': Boolean(card.excerpt)}]"
            role="listitem"
            :data-prompt-card="card.hoverKey"
            :data-prompt-card-state="card.state"
            @mouseenter="emit('hover', card.hoverKey)"
            @mouseleave="emit('hover', null)"
            @focusin="emit('hover', card.hoverKey)"
            @focusout="emit('hover', null)"
        >
            <button
                type="button"
                class="prompt-strip__main"
                :title="card.state === 'failed' ? `${cardLabel(card)} · ${card.error ?? ''}` : cardLabel(card)"
                :aria-label="cardLabel(card)"
                :aria-description="card.state === 'failed' ? t('prompt.attachmentFailed', {error: card.error ?? ''}) : card.state === 'uploading' ? t('prompt.attachmentUploading') : undefined"
                @click="emit('activate', card.id)"
            >
                <span v-if="card.kind === 'image'" class="prompt-strip__thumb">
                    <img v-if="card.thumbnail" :src="card.thumbnail" alt="" class="prompt-strip__img" draggable="false">
                    <span v-else class="prompt-strip__placeholder i-lucide-image" aria-hidden="true" />
                </span>
                <span v-else class="prompt-strip__file">
                    <span v-if="card.excerpt" class="prompt-strip__excerpt">{{ card.excerpt.preview }}</span>
                    <span v-else class="prompt-strip__file-name">
                        <span class="prompt-strip__file-icon i-lucide-file-text" aria-hidden="true" />
                        <span class="prompt-strip__name">{{ card.name }}</span>
                    </span>
                    <span class="prompt-strip__detail">{{ card.excerpt ? `${card.name} · ${detail(card)}` : detail(card) }}</span>
                </span>
                <span v-if="card.state === 'uploading'" class="prompt-strip__busy" aria-hidden="true">
                    <span class="prompt-strip__spinner i-lucide-loader-circle" />
                </span>
                <span class="prompt-strip__number">#{{ card.number }}</span>
            </button>
            <span v-if="!props.readonly" class="prompt-strip__actions">
                <IconButton
                    v-if="card.state === 'failed'"
                    size="sm"
                    icon-class="i-lucide-rotate-ccw"
                    :title="t('prompt.attachmentRetry')"
                    :aria-label="`${t('prompt.attachmentRetry')} ${cardLabel(card)}`"
                    data-prompt-card-action="retry"
                    @click="emit('retry', card.id)"
                />
                <IconButton
                    size="sm"
                    variant="danger"
                    icon-class="i-lucide-x"
                    :title="t('prompt.attachmentRemove')"
                    :aria-label="`${t('prompt.attachmentRemove')} ${cardLabel(card)}`"
                    data-prompt-card-action="remove"
                    @click="emit('remove', card.id)"
                />
            </span>
        </div>
    </div>
</template>

<style scoped>
.prompt-strip {
    display: flex;
    gap: 0.5rem;
    padding: 0.5rem 0.5rem 0;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: thin;
}

/*
 * 描边画在内容上面（::after 的内嵌阴影），缩略图铺满整张卡片、按卡片圆角裁切：
 * 用普通 border 时缩略图的圆角比描边内侧小一圈，四角会露出底色。悬停、聚焦与正文标签联动时描边换成 2px 强调色，只有一层。
 */
.prompt-strip__card {
    position: relative;
    flex: none;
    height: 48px;
    border-radius: 0.5rem;
    background: var(--bg-subtle);
}

.prompt-strip__card::after {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    box-shadow: inset 0 0 0 1px var(--border-color);
    content: "";
    pointer-events: none;
    transition: box-shadow var(--motion-fast) var(--ease-layout);
}

.prompt-strip__card:hover::after,
.prompt-strip__card:focus-within::after,
.prompt-strip__card.is-highlighted::after {
    box-shadow: inset 0 0 0 2px var(--accent-main);
}

.prompt-strip__card.is-failed {
    background: var(--status-danger-bg);
}

.prompt-strip__card.is-failed::after {
    box-shadow: inset 0 0 0 1px var(--status-danger-border);
}

.prompt-strip__card.is-failed:hover::after,
.prompt-strip__card.is-failed:focus-within::after,
.prompt-strip__card.is-failed.is-highlighted::after {
    box-shadow: inset 0 0 0 2px var(--status-danger);
}

.prompt-strip__main {
    position: relative;
    display: flex;
    height: 100%;
    align-items: stretch;
    padding: 0;
    border: 0;
    border-radius: inherit;
    background: transparent;
    color: var(--text-main);
    font: inherit;
    text-align: left;
    cursor: pointer;
    overflow: hidden;
    outline: none;
}

.prompt-strip__thumb {
    display: flex;
    width: 48px;
    height: 48px;
    align-items: center;
    justify-content: center;
}

.prompt-strip__img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.prompt-strip__placeholder {
    width: 1.25rem;
    height: 1.25rem;
    color: var(--text-muted);
}

.prompt-strip__file {
    display: flex;
    width: 9.5rem;
    min-width: 0;
    flex-direction: column;
    justify-content: center;
    gap: 0.1rem;
    padding: 0 1.75rem 0 0.55rem;
}

.prompt-strip__card.has-excerpt .prompt-strip__file {
    width: 11rem;
}

.prompt-strip__file-name {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.3rem;
    font-size: var(--text-xs);
}

.prompt-strip__file-icon {
    flex: none;
    width: 0.9rem;
    height: 0.9rem;
    color: var(--status-info);
}

.prompt-strip__name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.prompt-strip__excerpt {
    display: -webkit-box;
    overflow: hidden;
    color: var(--text-main);
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: var(--text-2xs);
    line-height: 1.3;
    white-space: pre;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
}

.prompt-strip__detail {
    overflow: hidden;
    color: var(--text-muted);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.prompt-strip__number {
    position: absolute;
    bottom: 3px;
    left: 3px;
    padding: 0 0.25rem;
    border-radius: 0.3rem;
    background: color-mix(in srgb, var(--bg-panel) 82%, transparent);
    color: var(--text-main);
    font-size: var(--text-2xs);
    font-weight: 600;
    line-height: 1.4;
}

.prompt-strip__card.is-file .prompt-strip__number {
    right: 4px;
    bottom: 3px;
    left: auto;
}

.prompt-strip__busy {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--bg-panel) 55%, transparent);
}

.prompt-strip__spinner {
    width: 1.1rem;
    height: 1.1rem;
    color: var(--text-muted);
    animation: prompt-strip-spin 0.9s linear infinite;
}

/* 按钮收在卡片右上角里，不伸出卡片，免得压住相邻的卡片。 */
.prompt-strip__actions {
    position: absolute;
    top: 3px;
    right: 3px;
    z-index: 1;
    display: flex;
    gap: 2px;
    opacity: 0;
    transition: opacity var(--motion-fast) var(--ease-layout);
}

.prompt-strip__actions :deep(button) {
    width: 18px;
    height: 18px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--bg-panel) 88%, transparent);
    box-shadow: 0 0 0 1px var(--border-color);
    font-size: var(--text-xs);
}

.prompt-strip__card:hover .prompt-strip__actions,
.prompt-strip__card:focus-within .prompt-strip__actions,
.prompt-strip__card.is-failed .prompt-strip__actions {
    opacity: 1;
}

@media (hover: none) {
    .prompt-strip__actions {
        opacity: 1;
    }
}

@keyframes prompt-strip-spin {
    to {
        transform: rotate(360deg);
    }
}

@media (prefers-reduced-motion: reduce) {
    .prompt-strip__spinner {
        animation: none;
    }

    .prompt-strip__card::after,
    .prompt-strip__actions {
        transition: none;
    }
}
</style>
