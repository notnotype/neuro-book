<script setup lang="ts">
import LabShell from "nbook/app/component-lab/LabShell.vue";

// 这个页面只在源码开发环境注册。排除发生在 nuxt.config 的路由生成阶段，
// 不是运行时守卫——产物里根本没有这条路由，也就到不了这里。
useHead({title: "组件 Lab"});
</script>

<template>
    <div class="h-screen w-screen overflow-hidden">
        <LabShell />
    </div>
</template>
