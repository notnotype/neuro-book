<script setup lang="ts">
import {computed} from "vue";
import {renderMarkdown} from "nbook/app/utils/markdown/render";

const props = defineProps<{
    text: string;
    sanitizeHtml?: (html: string) => string;
    streaming?: boolean;
}>();

const html = computed(() => props.sanitizeHtml === undefined ? null : renderMarkdown(props.text, props.sanitizeHtml));
</script>

<template>
    <!-- eslint-disable-next-line vue/no-v-html -- 已经过调用方提供的 sanitizeHtml 消毒 -->
    <div v-if="html !== null" class="agent-markdown" :data-streaming="props.streaming || undefined" v-html="html" />
    <div v-else class="agent-markdown agent-markdown--plain" :data-streaming="props.streaming || undefined">{{ props.text }}</div>
</template>

<style scoped>
.agent-markdown {
    min-width: 0;
    color: var(--acv-markdown-color, var(--text-main));
    font-size: var(--acv-markdown-size, 13px);
    line-height: 1.7;
    overflow-wrap: anywhere;
}

.agent-markdown--plain {
    white-space: pre-wrap;
}

.agent-markdown :deep(> :first-child) {
    margin-top: 0;
}

.agent-markdown :deep(> :last-child) {
    margin-bottom: 0;
}

.agent-markdown :deep(p),
.agent-markdown :deep(ul),
.agent-markdown :deep(ol),
.agent-markdown :deep(blockquote),
.agent-markdown :deep(pre),
.agent-markdown :deep(table) {
    margin: 0 0 8px;
}

.agent-markdown :deep(ul),
.agent-markdown :deep(ol) {
    padding-left: 1.4em;
}

.agent-markdown :deep(ul) {
    list-style: disc;
}

.agent-markdown :deep(ol) {
    list-style: decimal;
}

.agent-markdown :deep(li + li) {
    margin-top: 2px;
}

.agent-markdown :deep(li::marker) {
    color: var(--text-muted);
}

.agent-markdown :deep(h1),
.agent-markdown :deep(h2),
.agent-markdown :deep(h3) {
    margin: 12px 0 6px;
    font-size: 14px;
    font-weight: var(--weight-strong, 600);
    line-height: 1.5;
}

.agent-markdown :deep(strong) {
    font-weight: var(--weight-strong, 600);
}

.agent-markdown :deep(code) {
    padding: 1px 4px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--text-main) 8%, transparent);
    font-family: var(--font-mono);
    font-size: 12px;
}

.agent-markdown :deep(pre) {
    padding: 8px 10px;
    overflow-x: auto;
    border-radius: var(--radius-control);
    background: color-mix(in srgb, var(--text-main) 6%, transparent);
}

.agent-markdown :deep(pre code) {
    padding: 0;
    background: none;
}

.agent-markdown :deep(blockquote) {
    padding-left: 10px;
    border-left: 2px solid var(--border-color);
    color: var(--text-secondary);
}

/*
 * 流式生成中的光标，接在最后一段文字后面；最后是列表时接在最后一项里，没有内容时单独一个。
 * 循环闪烁是和 Spinner 旋转同类的进行中指示，不是状态过渡，所以不走动效时长 token。
 */
.agent-markdown--plain[data-streaming]::after,
.agent-markdown[data-streaming]:empty::after,
.agent-markdown[data-streaming] :deep(> :not(ul, ol):last-child)::after,
.agent-markdown[data-streaming] :deep(> :is(ul, ol):last-child > li:last-child)::after {
    content: "";
    display: inline-block;
    width: 0.45em;
    height: 1.1em;
    margin-left: 2px;
    vertical-align: text-bottom;
    background: currentColor;
    opacity: 0.55;
    animation: agent-markdown-caret 1s step-end infinite;
}

@keyframes agent-markdown-caret {
    50% {
        opacity: 0;
    }
}

@media (prefers-reduced-motion: reduce) {
    .agent-markdown--plain[data-streaming]::after,
    .agent-markdown[data-streaming]:empty::after,
    .agent-markdown[data-streaming] :deep(> :not(ul, ol):last-child)::after,
    .agent-markdown[data-streaming] :deep(> :is(ul, ol):last-child > li:last-child)::after {
        animation: none;
    }
}
</style>
