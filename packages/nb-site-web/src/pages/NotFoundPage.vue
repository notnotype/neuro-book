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
.site-link {
    color: var(--accent-main);
    text-underline-offset: 3px;
}

.site-link:hover {
    text-decoration-line: underline;
}

.site-link:focus-visible {
    outline: 2px solid var(--accent-main);
    outline-offset: 2px;
    border-radius: 2px;
}
</style>
