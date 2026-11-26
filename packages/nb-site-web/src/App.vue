<script setup lang="ts">
/**
 * 站点的根：给整棵树提供翻译端口（语言取 `locale.ts`），`<html lang>` 与标签页标题跟着语言与路由。
 * 取不到身份（`whoami` 回 `unavailable`、连不上）时不画页面，整页显示原因与重试（计划 3.1“守卫”；ui-development-spec 4.1）：
 * 这时不知道这个人是谁，画哪一页都可能是错的。
 *
 * 根元素的 `min-h-svh` 也是 `tests/build.test.ts` 的探针（站点源码里的原子类被 Tailwind 扫到）；改这个根时连同那里一起改。
 */

import {Button} from "@notnotype/nb-ui/components";
import {provideDefaultText} from "@notnotype/nb-ui/text-port";
import {computed, shallowRef, watchEffect} from "vue";
import {RouterView, useRoute, useRouter} from "vue-router";

import {useSite} from "./context";
import {locale} from "./locale";
import {useSiteText} from "./text";

provideDefaultText(() => locale.value);
const t = useSiteText();
const {account} = useSite();
const route = useRoute();
const router = useRouter();

const unavailable = computed(() => account.state.value.kind === "unavailable");
const retrying = shallowRef(false);

watchEffect(() => {
    document.documentElement.lang = locale.value;
});

watchEffect(() => {
    const key = route.meta.titleKey;
    document.title = key === undefined ? "NeuroBook" : t("site.documentTitle", {page: t(key)});
});

async function retry(): Promise<void> {
    retrying.value = true;
    try {
        await account.refresh();
        // 守卫上一次因为不知道身份而放行了；现在知道了，对同一个地址再走一遍守卫（同一地址的导航要 `force` 才会发生）。
        await router.replace({path: route.path, query: route.query, hash: route.hash, force: true});
    } finally {
        retrying.value = false;
    }
}
</script>

<template>
    <div class="min-h-svh">
        <main v-if="unavailable" class="flex min-h-svh flex-col items-center justify-center gap-4 px-6" role="alert" data-site-unavailable>
            <p class="text-md">{{ t("shell.unavailable") }}</p>
            <Button variant="secondary" :loading="retrying" @click="retry">{{ t("shell.retry") }}</Button>
        </main>
        <RouterView v-else />
    </div>
</template>
