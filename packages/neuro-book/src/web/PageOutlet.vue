<script setup lang="ts">
/**
 * 窗口 ready 后的根组件：按路由渲染页面，页面根元素带上窗口状态与实例标记。实例停止后（例如页面进入往返缓存后
 * 又被恢复）不再显示页面，改为宿主页，提示刷新。
 */
import {computed, onUnmounted, shallowRef} from "vue";
import {RouterView} from "vue-router";

import FailurePage from "./FailurePage.vue";
import type {BrowserWindow, WindowState} from "./host/window";

const props = defineProps<{browserWindow: BrowserWindow}>();
const emit = defineEmits<{reload: []}>();

const state = shallowRef<WindowState>(props.browserWindow.state);
onUnmounted(props.browserWindow.onChange((next) => {
    state.value = next;
}));

const ready = computed(() => (state.value.status === "ready" ? state.value : null));
const pending = computed(() => (state.value.status === "ready" ? null : state.value));
</script>

<template>
    <RouterView v-if="ready" v-slot="{Component}">
        <component :is="Component" data-window-state="ready" :data-window-instance="ready.instanceId" />
    </RouterView>
    <FailurePage v-else-if="pending" :state="pending" @reload="emit('reload')" />
</template>
