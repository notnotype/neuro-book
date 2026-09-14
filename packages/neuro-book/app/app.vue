<script setup lang="ts">
import NotificationViewport from "nbook/app/components/common/NotificationViewport.vue";
import { useDialog } from "nbook/app/composables/useDialog";
import { useNotification } from "nbook/app/composables/useNotification";
import {provideWorkbenchChrome} from "nbook/app/composables/useWorkbenchChrome";

provideWorkbenchChrome();

if (import.meta.client) {
    const dialog = useDialog();
    const notification = useNotification();
    window.alert = dialog.alert as any;
    window.confirm = dialog.confirm as any;
    window.prompt = dialog.prompt as any;
    (window as any).$dialog = dialog;
    (window as any).$notify = notification;
}

const desktopAvailable = computed(() => import.meta.client && Boolean(window.neuroBookDesktop));
</script>

<template>
    <!-- 自绘标题栏已随 #192 阶段 1 步骤 4 纳入主页面外壳（titlebar 叶），平台边界（bridge 命令、安全区、菜单数据）仍在 DesktopTitleBar 内。 -->
    <div :class="{ 'desktop-page-shell': desktopAvailable }">
        <NuxtPage/>
    </div>
    <NotificationViewport :desktop="desktopAvailable" />
</template>

<style>

.desktop-page-shell {
    display: flex;
    /* 标题栏（36px）现已在外壳的 titlebar 叶里随页面一起渲染，页面承接整窗高度：
       接入前 = 标题栏 36 + 页面 (100dvh − 36)；接入后 = 页面 100dvh = 标题栏 36 + main(外壳高 − 36)。 */
    height: 100dvh;
    min-height: 0;
    overflow: hidden;
    flex-direction: column;
}

.desktop-page-shell > * {
    height: 100%;
    min-height: 0;
}

*, ::after, ::before, ::backdrop, ::file-selector-button {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
    border: 0 solid;
}

/* Firefox support */
* {
    scrollbar-width: thin;
    scrollbar-color: var(--text-muted) transparent;
}

/* WebKit-based browsers support */
::-webkit-scrollbar {
    width: 6px;
    height: 6px;
}

::-webkit-scrollbar-track {
    background: transparent;
}

::-webkit-scrollbar-thumb {
    background-color: var(--text-muted);
    border-radius: 3px;
    opacity: 0.5;
}

::-webkit-scrollbar-thumb:hover {
    background-color: var(--text-secondary);
}

::-webkit-scrollbar-corner {
    background: transparent;
}

span[class^="i-"],
span[class*=" i-"] {
    display: block;
}
</style>
