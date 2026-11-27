<script setup lang="ts">
/** 还没做的页面的空壳（`router.ts`）：只有路由的标题。各片做到那一页时换成自己的组件，不往这里加东西。 */

import {useText} from "@notnotype/nb-ui/text-port";
import {computed} from "vue";
import {useRoute} from "vue-router";

import AdminPageHead from "./admin/AdminPageHead.vue";

const {t} = useText();
const route = useRoute();
const title = computed(() => (route.meta.title === undefined ? "" : t(route.meta.title)));
</script>

<template>
    <!-- 稿纸页的 `main` 是稿纸的卡片（`App.vue` 套上），这里只是卡片里的内容。 -->
    <div v-if="route.meta.layout === 'paper'" :data-site-page="String(route.name)">
        <h1>{{ title }}</h1>
    </div>
    <!-- 管理面板的 `main` 是外壳的内容区（`admin/AdminShell.vue`），这里只是其中的一页。 -->
    <div v-else-if="route.meta.layout === 'admin'" :data-site-page="String(route.name)">
        <AdminPageHead :title="title" />
    </div>
    <main v-else class="mx-auto max-w-[680px] px-6 py-16" :data-site-page="String(route.name)">
        <h1 class="text-xl font-semibold leading-tight">{{ title }}</h1>
    </main>
</template>
