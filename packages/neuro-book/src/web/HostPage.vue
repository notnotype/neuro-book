<script setup lang="ts">
/**
 * 窗口还没有 ready 时的根组件：显示宿主页，重试成功（窗口变为 ready）时交给装配方换成页面。
 * 窗口状态由宿主拥有，这里只订阅、不改写。
 */
import {onUnmounted, shallowRef} from "vue";

import FailurePage from "./FailurePage.vue";
import type {BrowserWindow, ReadyWindowState, WindowState} from "./host/window";

const props = defineProps<{browserWindow: BrowserWindow}>();
const emit = defineEmits<{ready: [state: ReadyWindowState]; reload: []}>();

type PendingState = Exclude<WindowState, ReadyWindowState>;
const state = shallowRef<PendingState>(pendingOf(props.browserWindow.state));
onUnmounted(props.browserWindow.onChange((next) => {
    if (next.status === "ready") emit("ready", next);
    else state.value = next;
}));

function pendingOf(current: WindowState): PendingState {
    return current.status === "ready" ? {status: "starting"} : current;
}

function retry(): void {
    void props.browserWindow.start();
}
</script>

<template>
    <FailurePage :state="state" @retry="retry" @reload="emit('reload')" />
</template>
