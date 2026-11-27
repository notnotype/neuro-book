<script setup lang="ts">
/**
 * 没有这一页（计划 3.11）：普通版式，一句话加回首页的链接。只对单页回退进来的路径显示；带扩展名而文件不存在的地址由服务端回 404，
 * 不到这里（计划 3.8）。
 */

import {RouterLink} from "vue-router";

import {useSiteText} from "../text";

const t = useSiteText();
</script>

<template>
    <main class="mx-auto flex max-w-[680px] flex-col items-start gap-4 px-6 py-16" data-site-page="not-found">
        <h1 class="text-xl font-semibold leading-tight">{{ t("notFound.title") }}</h1>
        <RouterLink to="/" class="site-link">{{ t("notFound.home") }}</RouterLink>
    </main>
</template>

<style scoped>
/* 文字用 `--accent-text`（对正文底色够 4.5:1），`--accent-main` 是填充色，作字色不够。静止时也带下划线，不只靠颜色认出是链接。 */
.site-link {
    color: var(--accent-text);
    text-decoration-line: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
}

.site-link:hover {
    text-decoration-thickness: 2px;
}

.site-link:focus-visible {
    outline: 2px solid var(--accent-main);
    outline-offset: 2px;
    border-radius: 2px;
}
</style>
