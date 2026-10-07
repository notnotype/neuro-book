<script setup lang="ts">
/**
 * 宿主页：窗口还没有可挂载的工作台、或已不能继续使用时显示。连接失败与无法打开项目可以原地重试；协议或插件
 * 版本不一致、启动失败要刷新页面（取得与服务端同一次构建的外壳）才可能恢复，服务端已重启要刷新页面与新的服务端
 * 进程重新握手，所以都只给刷新。服务端重启、项目关闭后都不自动刷新：页面上以后可能有未保存的内容。
 * 与项目有关的两页另给“不打开项目”：回到 `/`，窗口不绑定项目。
 */
import {computed} from "vue";

import type {WindowState} from "./host/window";

const props = defineProps<{state: Exclude<WindowState, {status: "ready"}>}>();
const emit = defineEmits<{retry: []; reload: []}>();

interface PageView {
    readonly title: string;
    readonly hint: string;
    readonly reason: string | null;
    readonly action: "retry" | "reload" | null;
    /** 给“不打开项目”的链接（整页加载 `/`）。 */
    readonly home: boolean;
}

const view = computed<PageView>(() => {
    const state = props.state;
    switch (state.status) {
        case "idle":
        case "starting":
            return {title: "正在连接服务端…", hint: "", reason: null, action: null, home: false};
        case "connection-failed":
            return {title: "无法连接服务端", hint: "服务端可能正在重启或网络中断，稍后重试。", reason: state.reason, action: "retry", home: false};
        case "project-unavailable":
            return {title: "无法打开项目", hint: "项目可能还没有登记、目录不可用或服务端正在停止。可以重试，或不打开项目。", reason: state.reason, action: "retry", home: true};
        case "incompatible":
            return {title: "页面与服务端版本不一致", hint: "刷新页面以加载与服务端匹配的版本。", reason: state.reason, action: "reload", home: false};
        case "startup-failed":
            return {title: "工作台启动失败", hint: "刷新页面重试；仍然失败时请查看服务端日志。", reason: state.reason, action: "reload", home: false};
        case "server-restarted":
            return {title: "服务端已重启", hint: "刷新页面以重新连接服务端。", reason: state.reason, action: "reload", home: false};
        case "project-gone":
            return {title: "项目已关闭", hint: "项目已在服务端关闭（长时间没有窗口使用、意外退出或服务端重启）。刷新页面重新打开它，或不打开项目。", reason: state.reason, action: "reload", home: true};
        case "closed":
            return {title: "窗口已关闭", hint: "", reason: null, action: "reload", home: false};
    }
});
const busy = computed(() => props.state.status === "idle" || props.state.status === "starting");
</script>

<template>
    <main class="nb-host-page" :data-browser-host-status="state.status" :role="busy ? 'status' : 'alert'">
        <h1>{{ view.title }}</h1>
        <p v-if="view.reason" class="nb-host-reason">{{ view.reason }}</p>
        <p v-if="view.hint">{{ view.hint }}</p>
        <button v-if="view.action === 'retry'" type="button" @click="emit('retry')">重试</button>
        <button v-else-if="view.action === 'reload'" type="button" @click="emit('reload')">刷新页面</button>
        <a v-if="view.home" class="nb-host-home" href="/">不打开项目</a>
    </main>
</template>
