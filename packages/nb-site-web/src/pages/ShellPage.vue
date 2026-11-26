<script setup lang="ts">
/** 还没做的页面的空壳（`router.ts`）：只有路由的标题。各片做到那一页时换成自己的组件，不往这里加东西。 */

import {computed} from "vue";
import {useRoute} from "vue-router";

import {useSiteText} from "../text";

const t = useSiteText();
const route = useRoute();
const title = computed(() => (route.meta.titleKey === undefined ? "" : t(route.meta.titleKey)));
</script>

<template>
    <!-- 稿纸页的 `main` 是稿纸的卡片（`App.vue` 套上），这里只是卡片里的内容。 -->
    <div v-if="route.meta.layout === 'paper'" :data-site-page="String(route.name)">
        <h1>{{ title }}</h1>
    </div>
    <main v-else class="mx-auto max-w-[680px] px-6 py-16" :data-site-page="String(route.name)">
        <h1 class="text-xl font-semibold leading-tight">{{ title }}</h1>
    </main>
</template>
