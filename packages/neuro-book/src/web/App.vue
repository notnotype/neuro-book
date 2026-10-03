<script setup lang="ts">
/**
 * 根组件：窗口 ready 时挂载工作台交出的根界面，其余状态显示宿主页（启动中或失败）。
 * 窗口状态由宿主拥有，这里只订阅、不改写；重试与刷新经宿主或浏览器完成。
 */
import {computed, onUnmounted, shallowRef} from "vue";

import FailurePage from "./FailurePage.vue";
import type {BrowserWindow, WindowState} from "./host/window";

const props = defineProps<{browserWindow: BrowserWindow}>();

const state = shallowRef<WindowState>(props.browserWindow.state);
onUnmounted(props.browserWindow.onChange((next) => {
    state.value = next;
}));

const ready = computed(() => (state.value.status === "ready" ? state.value : null));
const pending = computed(() => (state.value.status === "ready" ? null : state.value));

function retry(): void {
    void props.browserWindow.start();
}

function reload(): void {
    window.location.reload();
}
</script>

<template>
    <component :is="ready.root.component" v-if="ready" data-window-state="ready" :data-window-instance="ready.instanceId" />
    <FailurePage v-else-if="pending" :state="pending" @retry="retry" @reload="reload" />
</template>
