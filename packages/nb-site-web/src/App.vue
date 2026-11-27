<script setup lang="ts">
/**
 * 站点的根：给整棵树提供翻译端口（语言取 `locale.ts`），`<html lang>` 与标签页标题跟着语言与路由。
 * 取不到身份（`whoami` 回 `unavailable`、连不上）时不画页面，整页显示原因与重试（计划 3.1“守卫”；ui-development-spec 4.1）：
 * 这时不知道这个人是谁，画哪一页都可能是错的。
 *
 * 版式按路由的 `meta.layout` 套在页面外面：稿纸页（`layout: "paper"`）之间切换时稿纸是同一个元素，只换卡片里的页面，格子与
 * 产品名不重画（计划 3.6）。别的版式还没做，页面自己画。
 *
 * 根元素的 `min-h-svh` 也是 `tests/build.test.ts` 的探针（站点源码里的原子类被 Tailwind 扫到）；改这个根时连同那里一起改。
 */

import {Button} from "@notnotype/nb-ui/components";
import {provideDefaultText} from "@notnotype/nb-ui/text-port";
import {computed, shallowRef, watchEffect} from "vue";
import {RouterView, useRoute, useRouter} from "vue-router";

import PaperSheet from "./components/PaperSheet.vue";
import {useSite} from "./context";
import {locale} from "./locale";
import {useSiteText} from "./text";

// 路由的标题可能是管理面板目录里的字（`router.ts`），用端口按引用直接翻。
const port = provideDefaultText(() => locale.value);
const t = useSiteText();
const {account} = useSite();
const route = useRoute();
const router = useRouter();

const retrying = shallowRef(false);
// 重试时身份取到了、守卫还没对当前地址重走完：这段时间仍挡着页面。上一次放行时不知道身份，路由停着的可能是这个人进不了的页
// （匿名的人停在 `/account`），揭开早了会先画出那一页再被送走。
const reguarding = shallowRef(false);
// 重走守卫时跳转失败了（守卫抛错、页面的块加载失败）：留在这一屏，写明原因，可以再点重试。
const navigationFailed = shallowRef(false);
const unavailable = computed(() => account.state.value.kind === "unavailable" || reguarding.value);

watchEffect(() => {
    document.documentElement.lang = locale.value;
});

watchEffect(() => {
    const title = route.meta.title;
    document.title = title === undefined ? "NeuroBook" : t("site.documentTitle", {page: port.t(title)});
});

async function retry(): Promise<void> {
    retrying.value = true;
    reguarding.value = true;
    navigationFailed.value = false;
    try {
        const state = await account.refresh();
        // 还是取不到：`account.state` 自己挡着页面。
        if (state.kind !== "unavailable") {
            // 守卫上一次因为不知道身份而放行了；现在知道了，对同一个地址再走一遍守卫（同一地址的导航要 `force` 才会发生）。
            // 回来的导航失败（被更晚的导航取代）不算出错：那次导航同样走守卫。
            await router.replace({path: route.path, query: route.query, hash: route.hash, force: true});
        }
        reguarding.value = false;
    } catch (error) {
        console.warn("重试之后没能打开这一页", error);
        navigationFailed.value = true;
    } finally {
        retrying.value = false;
    }
}
</script>

<template>
    <div class="min-h-svh">
        <main v-if="unavailable" class="flex min-h-svh flex-col items-center justify-center gap-4 px-6" role="alert" data-site-unavailable>
            <p class="text-md">{{ t(navigationFailed ? "shell.navigationFailed" : "shell.unavailable") }}</p>
            <Button variant="secondary" :loading="retrying" @click="retry">{{ t("shell.retry") }}</Button>
        </main>
        <PaperSheet v-else-if="route.meta.layout === 'paper'">
            <RouterView />
        </PaperSheet>
        <RouterView v-else />
    </div>
</template>
