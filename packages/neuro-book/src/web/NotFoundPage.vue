<script setup lang="ts">
/** 窗口已就绪，但页面表里没有这个路径（包括生产构建里的开发页面，例如 `/lab`）。 */
import {RouterLink, useRoute} from "vue-router";

const route = useRoute();
</script>

<template>
    <main class="nb-host-page" data-page-not-found>
        <h1>页面不存在</h1>
        <p class="nb-host-reason">{{ route.fullPath }}</p>
        <RouterLink to="/">回到工作台</RouterLink>
    </main>
</template>
