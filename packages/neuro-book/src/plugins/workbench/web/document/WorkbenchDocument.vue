<script setup lang="ts">
/**
 * 工作台页面对文档根的设置（docs/specs/theme/system.md 的“运行时流程”）：`<html lang>` 跟着界面语言，产品主题与明暗
 * 跟着配置；`system` 读系统明暗的当前值并监听变化，只改文档的明暗与配色，不改写配置。只在工作台的页面挂载期间生效：
 * 不放在一直存活的插件激活作用域里，页面卸载（例如去 Lab）时停止监听并去掉自己写下的主题，Lab 自己管文档根。
 * 不渲染任何内容。
 */
import {computed, onBeforeUnmount, ref, watchEffect} from "vue";
import type {Ref} from "vue";

import type {DisplayLocale} from "nbook/shared/localized-text";
import {createDocumentThemeWriter} from "nbook/ui/theme/document-theme";
import type {ProductTheme} from "nbook/ui/theme/product-theme-shape";
import {productTheme} from "nbook/ui/theme/product-themes";

const props = defineProps<{
    locale: Readonly<Ref<DisplayLocale>>;
    /** 一个明暗下要写的主题：选哪一套、退回到哪一套都在调用方算，它会读响应式的配置。 */
    resolveTheme: (appearance: "light" | "dark") => ProductTheme;
    appearance: Readonly<Ref<"light" | "dark" | "system">>;
}>();

const writer = createDocumentThemeWriter();
const media = window.matchMedia("(prefers-color-scheme: dark)");
const systemDark = ref(media.matches);
const onSystemChange = (event: MediaQueryListEvent): void => {
    systemDark.value = event.matches;
};
media.addEventListener("change", onSystemChange);

const appearance = computed(() => (props.appearance.value === "system" ? (systemDark.value ? "dark" : "light") : props.appearance.value));

const stopLang = watchEffect(() => {
    document.documentElement.lang = props.locale.value;
});
const stopTheme = watchEffect(() => {
    writer.apply(productTheme(props.resolveTheme(appearance.value), appearance.value));
});

onBeforeUnmount(() => {
    media.removeEventListener("change", onSystemChange);
    stopLang();
    stopTheme();
    writer.clear();
});
</script>

<template>
    <span hidden data-workbench-document="" />
</template>
