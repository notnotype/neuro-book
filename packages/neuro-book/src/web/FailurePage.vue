<script setup lang="ts">
/**
 * 宿主页：窗口还没有可挂载的工作台、或已不能继续使用时显示。连接失败与无法打开项目可以原地重试；协议或插件
 * 版本不一致、启动失败要刷新页面（取得与服务端同一次构建的外壳）才可能恢复，服务端已重启要刷新页面与新的服务端
 * 进程重新握手，所以都只给刷新。服务端重启、项目关闭后都不自动刷新：页面上以后可能有未保存的内容。
 * 与项目有关的两页另给“不打开项目”：回到 `/`，窗口不绑定项目。终态页另列出插件交出的未保存正文，可以选中或复制。
 */
import {computed, ref} from "vue";

import type {TextRef} from "@notnotype/nb-ui/text";
import {useText} from "@notnotype/nb-ui/text-port";

import type {WindowState} from "./host/window";
import {hostText} from "./host-text";

const props = defineProps<{state: Exclude<WindowState, {status: "ready"}>}>();
const emit = defineEmits<{retry: []; reload: []}>();
const {t} = useText();

interface PageView {
    readonly title: TextRef;
    readonly hint: TextRef | null;
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
            return {title: hostText("failure.starting.title"), hint: null, reason: null, action: null, home: false};
        case "connection-failed":
            return {title: hostText("failure.connectionFailed.title"), hint: hostText("failure.connectionFailed.hint"), reason: state.reason, action: "retry", home: false};
        case "project-unavailable":
            return {title: hostText("failure.projectUnavailable.title"), hint: hostText("failure.projectUnavailable.hint"), reason: state.reason, action: "retry", home: true};
        case "incompatible":
            return {title: hostText("failure.incompatible.title"), hint: hostText("failure.incompatible.hint"), reason: state.reason, action: "reload", home: false};
        case "startup-failed":
            return {title: hostText("failure.startupFailed.title"), hint: hostText("failure.startupFailed.hint"), reason: state.reason, action: "reload", home: false};
        case "server-restarted":
            return {title: hostText("failure.serverRestarted.title"), hint: hostText("failure.serverRestarted.hint"), reason: state.reason, action: "reload", home: false};
        case "project-gone":
            return {title: hostText("failure.projectGone.title"), hint: hostText("failure.projectGone.hint"), reason: state.reason, action: "reload", home: true};
        case "closed":
            return {title: hostText("failure.closed.title"), hint: null, reason: null, action: "reload", home: false};
    }
});
const loadingTitle = computed(() => (props.state.status === "starting" ? props.state.projectTitle ?? "" : ""));
const rescued = computed(() => ("rescued" in props.state ? props.state.rescued ?? [] : []));
const copied = ref<number | null>(null);
const copy = async (index: number, text: string): Promise<void> => {
    try {
        await navigator.clipboard.writeText(text);
        copied.value = index;
    } catch {
        // 剪贴板不可用（权限、非安全上下文）：正文仍在下面的文本框里，可以手动选中复制。
        copied.value = null;
    }
};
</script>

<template>
    <!-- 启动中与 index.html 的静态加载页同一个样子（host-loading.css），失败后重试时不换版式。 -->
    <main v-if="state.status === 'idle' || state.status === 'starting'" class="nb-host-loading" :data-browser-host-status="state.status" role="status" :aria-label="t(hostText('loading.label'))">
        <p class="nb-host-loading__title">{{ loadingTitle }}</p>
        <div class="nb-host-loading__bar nb-host-indicator"></div>
        <p class="nb-host-loading__hint">{{ t(hostText(loadingTitle === '' ? 'loading.connecting' : 'loading.opening')) }}</p>
    </main>
    <main v-else class="nb-host-page" :data-browser-host-status="state.status" role="alert">
        <h1>{{ t(view.title) }}</h1>
        <p v-if="view.reason" class="nb-host-reason">{{ view.reason }}</p>
        <p v-if="view.hint">{{ t(view.hint) }}</p>
        <button v-if="view.action === 'retry'" type="button" @click="emit('retry')">{{ t(hostText('failure.action.retry')) }}</button>
        <button v-else-if="view.action === 'reload'" type="button" @click="emit('reload')">{{ t(hostText('failure.action.reload')) }}</button>
        <a v-if="view.home" class="nb-host-home" href="/">{{ t(hostText('failure.action.noProject')) }}</a>
        <section v-if="rescued.length > 0" class="nb-host-rescued" data-host-rescued>
            <h2>{{ t(hostText('failure.rescued.title')) }}</h2>
            <p>{{ t(hostText('failure.rescued.hint')) }}</p>
            <div v-for="(item, index) in rescued" :key="index" class="nb-host-rescued-item" data-host-rescued-item>
                <div class="nb-host-rescued-head">
                    <code>{{ item.path }}</code>
                    <button type="button" @click="copy(index, item.text)">{{ t(hostText(copied === index ? 'failure.rescued.copied' : 'failure.rescued.copy')) }}</button>
                </div>
                <p v-if="item.note !== undefined" data-host-rescued-note>{{ t(item.note) }}</p>
                <textarea readonly :value="item.text" :aria-label="t(hostText('failure.rescued.textLabel', {path: item.path}))" rows="6" />
            </div>
        </section>
    </main>
</template>
