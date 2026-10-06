<script setup lang="ts">
/**
 * 页面上的命令宿主：建面板宿主、接入工作台的面板槽位、在 window 上挂 keydown 分发、渲染命令面板；随页面卸载全部释放。
 *
 * 键位监听挂在页面上而不是插件激活里：同一文档里的 Lab 也激活工作台，但不挂这个宿主，快捷键在那里不响应
 * （ui.component-lab 场景 16）。监听用捕获阶段，页面里的控件先处理按键会让组合键漏掉。
 */
import {onBeforeUnmount, onMounted} from "vue";

import type {CommandService, Release} from "nbook/plugins/commands/shared/contracts";

import WorkbenchCommandPalette from "../components/WorkbenchCommandPalette.vue";
import {createKeymapDispatcher, currentKeyPlatform} from "./keymap";
import {createPaletteHost} from "./palette-host";
import type {PaletteHost} from "./palette-host";

const props = defineProps<{
    commands: CommandService;
    /** 接入工作台的面板槽位，返回断开函数。 */
    attach: (host: PaletteHost) => Release;
    /** 键位不合法、冲突与快捷键执行失败的去处。 */
    report: (error: Error) => void;
}>();

const host = createPaletteHost({commands: props.commands});
const detach = props.attach(host);
const keymap = createKeymapDispatcher(props.commands, currentKeyPlatform(), props.report);

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
