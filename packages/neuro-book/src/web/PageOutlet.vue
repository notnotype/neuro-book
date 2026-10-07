<script setup lang="ts">
/**
 * 窗口 ready 后的根组件：按路由渲染页面，页面根元素带上窗口状态、实例与远程服务链路的标记。链路断开时页面保留，
 * 顶部浮出一条离线横幅，重连成功后收起。实例停止后（例如页面进入往返缓存后又被恢复）或服务端已换进程时不再
 * 显示页面，改为宿主页，提示刷新。
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
    <template v-if="ready">
        <RouterView v-slot="{Component}">
            <component :is="Component" data-window-state="ready" :data-window-instance="ready.instanceId" :data-rpc-state="ready.connection" />
        </RouterView>
        <p v-if="ready.connection === 'offline'" class="nb-offline-banner" role="status">与服务端的连接已断开，正在重新连接…</p>
    </template>
    <FailurePage v-else-if="pending" :state="pending" @reload="emit('reload')" />
</template>
