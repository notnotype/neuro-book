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
import {productTheme} from "nbook/ui/theme/product-themes";

const props = defineProps<{
    locale: Readonly<Ref<DisplayLocale>>;
    theme: Readonly<Ref<string>>;
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
    writer.apply(productTheme(props.theme.value, appearance.value));
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
