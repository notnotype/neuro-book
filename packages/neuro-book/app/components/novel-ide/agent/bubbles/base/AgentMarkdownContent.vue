<script setup lang="ts">
import { inject, onUnmounted, ref, watch, type Ref } from "vue";
import { renderMarkdown } from "nbook/app/utils/markdown/render";
import { MARKDOWN_THEME } from "nbook/app/config/markdown-theme";

const STREAMING_MARKDOWN_RENDER_INTERVAL_MS = 120;

const props = defineProps<{
    content: string;
    html?: string;
    /** 流式输出期间降频渲染 Markdown，减少主线程连续解析压力。 */
    streaming?: boolean;
    /** 打开 Markdown 渲染出的 workspace 引用 chip。 */
    openReference?: (target: string) => void;
}>();

const sanitizeHtml = inject<Ref<((html: string) => string) | null> | null>("sanitizeHtml", null);
const renderedHtml = ref("");
let markdownRenderFrame: number | null = null;
let markdownRenderTimer: ReturnType<typeof setTimeout> | null = null;
let lastStreamingRenderAt = 0;

/** 渲染当前 Markdown 输入。 */
const renderCurrentHtml = (): string => {
    return props.html || renderMarkdown(props.content, sanitizeHtml?.value ?? undefined);
};

/** 取消尚未执行的流式渲染任务。 */
const cancelScheduledRender = (): void => {
    if (markdownRenderFrame !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(markdownRenderFrame);
    }
    markdownRenderFrame = null;
    if (markdownRenderTimer !== null) {
        clearTimeout(markdownRenderTimer);
    }
    markdownRenderTimer = null;
};

/** 立即渲染，用于非流式或终态内容。 */
const renderImmediately = (): void => {
    cancelScheduledRender();
    renderedHtml.value = renderCurrentHtml();
    lastStreamingRenderAt = Date.now();
};

/** 在下一帧执行一次 Markdown 渲染。 */
const renderInFrame = (): void => {
    if (typeof requestAnimationFrame === "function") {
        markdownRenderFrame = requestAnimationFrame(() => {
            markdownRenderFrame = null;
            renderedHtml.value = renderCurrentHtml();
            lastStreamingRenderAt = Date.now();
        });
        return;
    }
    renderedHtml.value = renderCurrentHtml();
    lastStreamingRenderAt = Date.now();
};

/** 流式期间按固定间隔合并 Markdown 渲染。 */
const scheduleStreamingRender = (): void => {
    if (markdownRenderFrame !== null || markdownRenderTimer !== null) {
        return;
    }
    const elapsedMs = Date.now() - lastStreamingRenderAt;
    const waitMs = Math.max(0, STREAMING_MARKDOWN_RENDER_INTERVAL_MS - elapsedMs);
    if (waitMs === 0) {
        renderInFrame();
        return;
    }
    markdownRenderTimer = setTimeout(() => {
        markdownRenderTimer = null;
        renderInFrame();
    }, waitMs);
};

/** 委托处理 workspace 引用 chip 点击。 */
const handleReferenceClick = (event: MouseEvent): void => {
    if (!props.openReference) {
        return;
    }
    const chip = event.target instanceof Element
        ? event.target.closest<HTMLElement>(".nb-reference-chip[data-reference-target]")
        : null;
    const target = chip?.dataset.referenceTarget ?? "";
    if (!target) {
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    props.openReference(target);
};

watch([
    () => props.content,
    () => props.html,
    () => props.streaming,
    () => sanitizeHtml?.value,
], () => {
    if (!props.streaming || props.html) {
        renderImmediately();
        return;
    }
    scheduleStreamingRender();
}, {immediate: true});

onUnmounted(() => {
    cancelScheduledRender();
});
</script>

<template>
    <div :class="['agent-markdown', `theme-${MARKDOWN_THEME}`, {'is-reference-clickable': Boolean(props.openReference)}]" @click="handleReferenceClick" v-html="renderedHtml"></div>
</template>

<style>
/* 引入外部扩展的全局社区主题 */
@import "nbook/app/styles/markdown-themes.css";
</style>

<style scoped>
.agent-markdown {
    min-width: 0;
    max-width: 100%;
    overflow-wrap: anywhere;
    word-break: break-word;
}
.agent-markdown :deep(*) {
    max-width: 100%;
}
.agent-markdown :deep(p),
.agent-markdown :deep(li),
.agent-markdown :deep(a),
.agent-markdown :deep(code) {
    overflow-wrap: anywhere;
    word-break: break-word;
}
.agent-markdown :deep(pre) {
    max-width: 100%;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}
.agent-markdown :deep(pre code) {
    white-space: pre-wrap;
}
.agent-markdown.is-reference-clickable :deep(.nb-reference-chip[data-reference-target]) {
    cursor: pointer;
}
.agent-markdown.is-reference-clickable :deep(.nb-reference-chip[data-reference-target]:hover) {
    border-color: color-mix(in srgb, currentColor 30%, transparent);
    background: color-mix(in srgb, currentColor 14%, var(--bg-panel));
}

/* 默认自带旧有样式 */
.theme-default :deep(h1),
.theme-default :deep(h2),
.theme-default :deep(h3),
.theme-default :deep(h4) {
    margin: 0.75rem 0 0.35rem;
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--text-main);
}
.theme-default :deep(p) {
    margin: 0.4rem 0;
}
.theme-default :deep(ul),
.theme-default :deep(ol) {
    margin: 0.45rem 0;
    padding-left: 1.5rem;
    list-style: initial;
}
.theme-default :deep(ul) { list-style-type: disc; }
.theme-default :deep(ol) { list-style-type: decimal; }
.theme-default :deep(li) {
    margin: 0.18rem 0;
}
.theme-default :deep(blockquote) {
    margin: 0.6rem 0;
    border-left: 3px solid var(--accent-main);
    padding-left: 0.75rem;
    color: var(--text-secondary);
}
.theme-default :deep(code) {
    white-space: normal;
    overflow-wrap: anywhere;
    word-break: break-word;
    border: 1px solid var(--border-color);
    border-radius: 0.4rem;
    background: var(--bg-hover);
    padding: 0.08rem 0.35rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85em;
}
.theme-default :deep(pre) {
    max-width: 100%;
    overflow-x: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    border: 1px solid var(--border-color);
    border-radius: 0.5rem;
    background: var(--bg-hover);
    padding: 0.75rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85em;
    line-height: 1.4;
    margin: 0.5rem 0;
}
.theme-default :deep(pre code) {
    white-space: pre-wrap;
    border: 0;
    background: transparent;
    padding: 0;
}
.theme-default :deep(a) {
    color: var(--accent-text);
    text-decoration: underline;
    text-underline-offset: 0.15rem;
}

.theme-default :deep(table) {
    width: 100%;
    border-collapse: collapse;
    margin: 1rem 0;
    font-size: 0.9em;
}
.theme-default :deep(th),
.theme-default :deep(td) {
    padding: 0.5rem;
    border: 1px solid var(--border-color);
    text-align: left;
}
.theme-default :deep(th) {
    background: var(--bg-hover);
    font-weight: 600;
}
</style>
