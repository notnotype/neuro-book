<script setup lang="ts">
/**
 * 工作台页面对文档根的设置：`<html lang>` 跟着当前显示语言。只在工作台的页面挂载期间生效，页面卸载后由接着挂载的
 * 页面自己设置（Lab 是离开时整页加载的独立页面，不受它影响）。不渲染任何内容。
 */
import {watchEffect} from "vue";
import type {Ref} from "vue";

import type {DisplayLocale} from "nbook/shared/localized-text";

const props = defineProps<{locale: Readonly<Ref<DisplayLocale>>}>();

watchEffect(() => {
    document.documentElement.lang = props.locale.value;
});
</script>

<template>
    <span hidden data-workbench-document="" />
</template>
