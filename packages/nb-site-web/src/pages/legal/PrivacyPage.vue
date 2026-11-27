<script setup lang="ts">
/** 隐私政策（t10 计划 3.11）。正文随这一页的块下载，版式在 `LegalPage.vue`。 */

import privacy from "../../legal/zh-CN/privacy.md";
import LegalPage from "./LegalPage.vue";
</script>

<template>
    <LegalPage :document="privacy" title="legal.privacy.title" />
</template>
