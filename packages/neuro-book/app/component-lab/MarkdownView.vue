<script setup lang="ts">
import {computed} from "vue";
import DOMPurify from "dompurify";
import {Marked} from "marked";

const props = defineProps<{
    source: string;
}>();

// 独立实例：全局 marked 被产品的渲染管线改过扩展，Lab 只要标准 Markdown。
const marked = new Marked({gfm: true, breaks: false});

marked.use({
    renderer: {
        // 组件文档里的锚点指向文档站，在 Lab 里跳不到有意义的位置，因此只处理外链。
        link({href, title, tokens}) {
            const text = this.parser.parseInline(tokens);
            const titleAttr = title ? ` title="${title}"` : "";
            const external = /^https?:\/\//u.test(href);
            const target = external ? ' target="_blank" rel="noreferrer noopener"' : "";
            return `<a href="${href}"${titleAttr}${target}>${text}</a>`;
        },
    },
});

const html = computed(() => {
    const raw = marked.parse(props.source, {async: false});
    // Markdown 允许内嵌 HTML，marked 只生成不判断安全性，净化必须单独做一遍。
    return DOMPurify.sanitize(raw, {ADD_ATTR: ["target", "rel"]});
});
</script>

<template>
    <div class="nb-lab-markdown" v-html="html"></div>
</template>

<style scoped>
.nb-lab-markdown {
    color: var(--text-main);
    font-size: var(--text-sm);
    line-height: var(--leading-reading);
    word-break: break-word;
}

.nb-lab-markdown :deep(h1),
.nb-lab-markdown :deep(h2),
.nb-lab-markdown :deep(h3),
.nb-lab-markdown :deep(h4) {
    margin: 1.4em 0 0.6em;
    font-weight: 600;
    line-height: 1.35;
}

.nb-lab-markdown :deep(h1) { font-size: 1.35em; }
.nb-lab-markdown :deep(h2) { font-size: 1.18em; }
.nb-lab-markdown :deep(h3) { font-size: 1.05em; }
.nb-lab-markdown :deep(h4) { font-size: 1em; }

.nb-lab-markdown :deep(> :first-child) {
    margin-top: 0;
}

.nb-lab-markdown :deep(p),
.nb-lab-markdown :deep(ul),
.nb-lab-markdown :deep(ol),
.nb-lab-markdown :deep(blockquote) {
    margin: 0.7em 0;
}

.nb-lab-markdown :deep(ul),
.nb-lab-markdown :deep(ol) {
    padding-left: 1.4em;
    list-style: revert;
}

.nb-lab-markdown :deep(li) {
    margin: 0.25em 0;
}

.nb-lab-markdown :deep(strong) {
    font-weight: 600;
}

.nb-lab-markdown :deep(em) {
    font-style: italic;
}

.nb-lab-markdown :deep(a) {
    color: var(--accent-main);
    text-decoration: underline;
    text-underline-offset: 2px;
}

.nb-lab-markdown :deep(code) {
    padding: 0.1em 0.35em;
    border-radius: var(--radius-control);
    background: var(--bg-subtle);
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.92em;
}

.nb-lab-markdown :deep(pre) {
    margin: 0.8em 0;
    padding: 0.75em 0.9em;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-control);
    background: var(--bg-subtle);
    /* 代码块自己横向滚，不把整块文档撑宽 */
    overflow-x: auto;
}

.nb-lab-markdown :deep(pre code) {
    padding: 0;
    background: transparent;
    white-space: pre;
}

.nb-lab-markdown :deep(blockquote) {
    padding-left: 0.9em;
    border-left: 3px solid var(--border-color);
    color: var(--text-secondary);
}

.nb-lab-markdown :deep(hr) {
    margin: 1.4em 0;
    border: 0;
    border-top: 1px solid var(--border-color);
}

.nb-lab-markdown :deep(table) {
    display: block;
    margin: 0.8em 0;
    border-collapse: collapse;
    overflow-x: auto;
}

.nb-lab-markdown :deep(th),
.nb-lab-markdown :deep(td) {
    padding: 0.35em 0.7em;
    border: 1px solid var(--border-color);
    text-align: left;
}

.nb-lab-markdown :deep(th) {
    background: var(--bg-subtle);
    font-weight: 600;
}
</style>
