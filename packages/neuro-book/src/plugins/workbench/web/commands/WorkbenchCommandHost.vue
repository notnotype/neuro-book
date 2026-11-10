<script setup lang="ts">
/**
 * 页面上的命令宿主：建面板宿主、接入工作台的面板槽位、在 window 上挂 keydown 分发、渲染命令面板；随页面卸载全部释放。
 *
 * 键位监听挂在页面上而不是插件激活里：同一文档里的 Lab 也激活工作台，但不挂这个宿主，快捷键在那里不响应
 * （ui.component-lab 场景 16）。监听用捕获阶段，页面里的控件先处理按键会让组合键漏掉。
 */
import {onBeforeUnmount, onMounted} from "vue";

import {useText} from "@notnotype/nb-ui/text-port";

import {currentKeyPlatform} from "nbook/plugins/commands/shared/contracts";
import type {CommandFailure, CommandService, Release} from "nbook/plugins/commands/shared/contracts";

import type {NotificationInput} from "../../shared/contracts";
import WorkbenchCommandPalette from "../components/WorkbenchCommandPalette.vue";
import {failureDiagnostic, failureNotice} from "./failure-notice";
import {createKeymapDispatcher} from "./keymap";
import {createPaletteHost} from "./palette-host";
import type {PaletteHost} from "./palette-host";

const props = defineProps<{
    commands: CommandService;
    /** 接入工作台的面板槽位，返回断开函数。 */
    attach: (host: PaletteHost) => Release;
    /** 键位不合法、冲突与快捷键执行失败的去处。 */
    report: (error: Error) => void;
    /** 命令面板与快捷键执行失败时弹通知（工作台的通知服务）；不给时只记诊断。 */
    notify?: (input: NotificationInput) => void;
}>();

const resolver = useText();

/** 面板与快捷键两个入口用同一种方式告诉用户失败。 */
function notifyFailure(id: string, failure: CommandFailure): void {
    const found = props.commands.get(id);
    const notice = failureNotice(id, found.ok ? found.value : null, failure, resolver);
    if (notice !== null) props.notify?.(notice);
}

// 快捷键的分发器自己先把失败记进 `report`；面板没有，这里补上，两个入口的失败都留诊断。
const host = createPaletteHost({
    commands: props.commands,
    onFailure: (id, failure) => {
        props.report(failureDiagnostic(id, failure));
        notifyFailure(id, failure);
    },
});
const detach = props.attach(host);
const keymap = createKeymapDispatcher(props.commands, currentKeyPlatform(), props.report, notifyFailure);

function onKeydown(event: KeyboardEvent): void {
    keymap.handle(event);
}

onMounted(() => {
    window.addEventListener("keydown", onKeydown, true);
});

onBeforeUnmount(() => {
    window.removeEventListener("keydown", onKeydown, true);
    keymap.dispose();
    detach();
    host.dispose();
});
</script>

<template>
    <WorkbenchCommandPalette :host="host" />
</template>
