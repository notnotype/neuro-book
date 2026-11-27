<script setup lang="ts">
/**
 * 隐私政策与服务条款的阅读版式（t10 计划 3.11）：顶部站名回首页，下面一列是标题、版本与正文，列宽封顶 680px、居中
 * （design-language“内容列有上限宽度”），站名那一行与它同宽、左边对齐。正文由各页传入（`PrivacyPage.vue`、`TermsPage.vue`），
 * 跟着那一页的块下载，不进入口。
 *
 * 正文的 HTML 用 `v-html` 放进页面：它是构建时由仓库自己的 Markdown 文件转出来的（`build/legal-docs.ts`），不含用户输入。
 * 正文改成从接口或别处取时，这个前提就不成立了，要先过消毒。`v-html` 的内容没有 scoped 的属性，正文的样式用 `:deep`。
 */

import {RouterLink, useRoute} from "vue-router";

import type {LegalDocument} from "../../legal/document";
import {useSiteText} from "../../text";
import type {SiteTextKey} from "../../text";

defineProps<{
    readonly document: LegalDocument;
    /** 页名，与路由的标签页标题同一个键。 */
    readonly title: SiteTextKey;
}>();

const t = useSiteText();
const route = useRoute();
</script>

<template>
    <div class="legal" :data-site-page="String(route.name)">
        <header class="legal-column legal-head">
            <RouterLink to="/" class="legal-home">{{ t("site.name") }}</RouterLink>
        </header>
        <main class="legal-column legal-main" data-site-legal-column>
            <h1 class="legal-title">{{ t(title) }}</h1>
            <p class="legal-version">
                <time :datetime="document.version" data-site-legal-version>{{ t("legal.version", {version: document.version}) }}</time>
            </p>
            <article class="legal-body" data-site-legal-body v-html="document.html" />
        </main>
    </div>
</template>

<style scoped>
.legal {
    padding-inline: 24px;
}

.legal-column {
    box-sizing: content-box;
    max-width: 680px;
    margin-inline: auto;
}

/* 分隔线只跨内容列，不跨整页（design-language“内容列有上限宽度”）。 */
.legal-head {
    display: flex;
    align-items: center;
    min-height: 64px;
    border-bottom: 1px solid var(--divider);
}

.legal-home {
    color: var(--text-main);
    font-family: var(--font-display);
    font-size: var(--text-lg);
    font-weight: 600;
    text-decoration: none;
    text-underline-offset: 4px;
}

.legal-home:hover {
    text-decoration-line: underline;
}

.legal-home:focus-visible {
    outline: 2px solid var(--accent-main);
    outline-offset: 2px;
    border-radius: 2px;
}

.legal-main {
    padding-block: 40px 96px;
}

.legal-title {
    margin: 0;
    font-family: var(--font-display);
    font-size: 28px;
    font-weight: 600;
    line-height: var(--leading-tight);
}

.legal-version {
    margin: 8px 0 32px;
    color: var(--text-secondary);
    font-size: var(--text-sm);
}

/* 正文：比界面大一档，行距放松；长网址、长英文词在窄屏上折行，不撑出横向滚动。 */
.legal-body {
    color: var(--text-main);
    font-size: var(--text-lg);
    line-height: var(--leading-reading);
    overflow-wrap: anywhere;
}

.legal-body :deep(:first-child) {
    margin-top: 0;
}

.legal-body :deep(p) {
    margin: 0 0 1em;
}

.legal-body :deep(h2) {
    margin: 2em 0 0.6em;
    font-size: var(--text-xl);
    font-weight: 600;
    line-height: var(--leading-tight);
}

.legal-body :deep(h3) {
    margin: 1.6em 0 0.4em;
    font-size: var(--text-lg);
    font-weight: 600;
    line-height: var(--leading-tight);
}

.legal-body :deep(ul),
.legal-body :deep(ol) {
    margin: 0 0 1em;
    padding-inline-start: 1.5em;
}

.legal-body :deep(ul) {
    list-style: disc;
}

.legal-body :deep(ol) {
    list-style: decimal;
}

.legal-body :deep(li + li) {
    margin-top: 0.25em;
}

.legal-body :deep(li::marker) {
    color: var(--text-secondary);
}

.legal-body :deep(strong) {
    font-weight: 600;
}

/* 与站点别处的行内链接同一种画法（`styles/paper-form.css` 的 `.site-link`）：静止时也带下划线。 */
.legal-body :deep(a) {
    color: var(--accent-text);
    text-decoration-line: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
}

.legal-body :deep(a:hover) {
    text-decoration-thickness: 2px;
}

.legal-body :deep(a:focus-visible) {
    outline: 2px solid var(--accent-main);
    outline-offset: 2px;
    border-radius: 2px;
}

.legal-body :deep(blockquote) {
    margin: 0 0 1em;
    padding-inline-start: 1em;
    border-inline-start: 3px solid var(--divider);
    color: var(--text-secondary);
}

.legal-body :deep(hr) {
    margin: 2em 0;
    border: 0;
    border-top: 1px solid var(--divider);
}

/* 表格比列宽时在自己里面横向滚动，页面不跟着滚。 */
.legal-body :deep(table) {
    display: block;
    max-width: 100%;
    overflow-x: auto;
    margin: 0 0 1em;
    border-collapse: collapse;
    font-size: var(--text-md);
}

.legal-body :deep(th),
.legal-body :deep(td) {
    padding: 6px 12px;
    border: 1px solid var(--divider);
    text-align: start;
}

.legal-body :deep(code) {
    font-family: var(--font-mono);
    font-size: 0.9em;
}

@media (max-width: 560px) {
    .legal {
        padding-inline: 20px;
    }

    .legal-head {
        min-height: 56px;
    }

    .legal-main {
        padding-block: 28px 64px;
    }

    .legal-title {
        font-size: 24px;
    }

    .legal-version {
        margin-bottom: 24px;
    }
}
</style>
