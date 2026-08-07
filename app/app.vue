<script setup lang="ts">
import NotificationViewport from "nbook/app/components/common/NotificationViewport.vue";
import DesktopTitleBar from "nbook/app/components/common/DesktopTitleBar.vue";
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
    <DesktopTitleBar />
    <div :class="{ 'desktop-page-shell': desktopAvailable }">
        <NuxtPage/>
    </div>
    <NotificationViewport :desktop="desktopAvailable" />
</template>

<style>

.desktop-page-shell {
    display: flex;
    height: calc(100dvh - 36px);
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
