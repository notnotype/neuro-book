<script setup lang="ts">
import {onMounted} from "vue";
import {provideThemeComponents} from "../../src/theme/component-registry";
import {useColorway} from "./composables/useColorway";
import {useTheme} from "./composables/useTheme";

const colorway = useColorway();
const theme = useTheme();

// 把当前主题的组件覆盖表接进 provide/inject 链。少了这一句，主题带的组件实现装得上但用不上
provideThemeComponents(theme.components);

onMounted(() => {
    colorway.initColorway();
    theme.initTheme();
});

const navItems = [
    {to: "/", label: "主题对照"},
    {to: "/workbench", label: "工作台"},
    {to: "/components", label: "组件画廊"},
    {to: "/manual-import", label: "手动导入"},
];
</script>

<template>
    <!--
        外壳刻意固定尺寸、不消费任何主题变量，也不消费任何 nb-ui 组件：
        · 不吃主题变量 —— 切主题时外壳保持不动，才能把变化都归因到内容区
        · 不吃 nb-ui 组件 —— 阶段 2/3 要逐批重写它们，外壳不能跟着一起坏
        只允许消费配色的颜色变量，这样切配色时外壳仍然跟着走。
    -->
    <div class="flex min-h-screen flex-col bg-[var(--bg-main)] text-[var(--text-main)]">
        <header
            class="sticky top-0 z-40 flex flex-wrap items-center gap-x-6 gap-y-2 border-b px-4 py-2"
            style="border-color: var(--border-color); background: var(--bg-panel); font-size: 13px; font-family: system-ui, sans-serif"
        >
            <div class="flex items-center gap-2">
                <span class="i-lucide-shapes h-4 w-4" style="color: var(--accent-main)"></span>
                <span style="font-weight: 600">nb-ui 设计实验室</span>
            </div>

            <nav class="flex items-center gap-1">
                <NuxtLink
                    v-for="item in navItems"
                    :key="item.to"
                    :to="item.to"
                    class="rounded px-2 py-1"
                    active-class="nb-lab-nav-active"
                    style="color: var(--text-secondary)"
                >
                    {{ item.label }}
                </NuxtLink>
            </nav>

            <div class="ml-auto flex min-w-0 max-w-full flex-wrap items-center gap-x-5 gap-y-2">
                <!-- 主题轴。名称与简介直接读各包的 manifest，playground 不再手抄一份 -->
                <div data-nb-theme-switcher class="flex min-w-0 max-w-full flex-wrap items-center gap-1">
                    <span class="pr-1" style="color: var(--text-muted); font-size: 11px">主题</span>
                    <button
                        v-for="installed in theme.themes.value"
                        :key="installed.manifest.id"
                        type="button"
                        class="cursor-pointer rounded px-2 py-1"
                        :style="{
                            background: theme.current.value === installed.manifest.id ? 'var(--accent-bg)' : 'transparent',
                            color: theme.current.value === installed.manifest.id ? 'var(--accent-main)' : 'var(--text-secondary)',
                            fontWeight: theme.current.value === installed.manifest.id ? 600 : 400,
                        }"
                        :aria-pressed="theme.current.value === installed.manifest.id"
                        :title="installed.manifest.description"
                        @click="theme.setTheme(installed.manifest.id)"
                    >
                        {{ installed.manifest.name }}
                    </button>
                </div>

                <!-- 配色轴 -->
                <div data-nb-colorway-switcher class="flex min-w-0 max-w-full flex-wrap items-center gap-1">
                    <span class="pr-1" style="color: var(--text-muted); font-size: 11px">配色</span>
                    <button
                        v-for="id in colorway.colorwayIds"
                        :key="id"
                        type="button"
                        class="cursor-pointer rounded px-2 py-1"
                        :style="{
                            background: colorway.current.value === id ? 'var(--accent-bg)' : 'transparent',
                            color: colorway.current.value === id ? 'var(--accent-main)' : 'var(--text-secondary)',
                            fontWeight: colorway.current.value === id ? 600 : 400,
                        }"
                        :aria-pressed="colorway.current.value === id"
                        @click="colorway.setColorway(id)"
                    >
                        {{ colorway.colorwayMeta[id]?.label ?? id }}
                    </button>
                </div>
            </div>
        </header>

        <NuxtPage class="flex-1" />
        <NotificationViewport />
    </div>
</template>

<style>
.nb-lab-nav-active {
    background: var(--bg-subtle);
    color: var(--text-main) !important;
    font-weight: 600;
}
</style>
