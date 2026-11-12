<script setup lang="ts">
import {EmptyState} from "@notnotype/nb-ui/components";
import {useRouter} from "vue-router";
import PageShell from "../parts/PageShell.vue";

/** 没有这一页：套 PageShell（面包屑回首页、唯一的 h1），正文是空态。 */
const router = useRouter();
</script>

<template>
    <PageShell :crumbs="[{label: '首页', href: '/'}, {label: '找不到这一页'}]" title="找不到这一页" @navigate="(href) => void router.push(href)">
        <EmptyState icon-class="i-lucide-map-pin-off" title="地址可能写错了" description="或者面板还没有这个视图；从左栏或首页重新进入" />
    </PageShell>
</template>
