<script setup lang="ts">
/** 服务条款（t10 计划 3.11）。正文随这一页的块下载，版式在 `LegalPage.vue`。 */

import terms from "../../legal/zh-CN/terms.md";
import LegalPage from "./LegalPage.vue";
</script>

<template>
    <LegalPage :document="terms" title="legal.terms.title" />
</template>
