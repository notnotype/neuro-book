<script setup lang="ts">
/**
 * SettingsWindow 的 Lab 场景（docs/specs/settings/settings-window.md）：窗口由本场景的局部宿主驱动（`settings/web/lab/`），
 * 产品里同一个窗口模型、配置实例与分区注册表，配置层换成内存里的拥有者。窗口发的通知与作者诊断记进事件 tab。
 * Lab 按“组件:场景”重挂本 fixture，换场景就是换一个宿主。
 */
import {Button} from "@notnotype/nb-ui/components";
import {computed, onBeforeUnmount, ref} from "vue";

import SettingsWindow from "nbook/plugins/settings/web/components/SettingsWindow.vue";
import {provideHostText} from "nbook/web/host/host-text";

import {LabFixtureControls, type LabFixtureProps, useLabEventSink} from "nbook/plugins/lab/web/scene-kit";
import {createSettingsScene} from "./scene-data";
import type {SettingsWindowSceneId} from "./scene-settings";

const props = defineProps<LabFixtureProps>();
const record = useLabEventSink();

const scene = createSettingsScene(props.scene as SettingsWindowSceneId, (input) => record("notify", input), (message) => record("report", message));
const host = scene.host;
// 窗口里的零件（行、页面列表、保存栏）经注入拿翻译端口，要与窗口模型用同一个。
provideHostText(host.text);
scene.open();
onBeforeUnmount(() => host.dispose());

const opened = computed(() => host.window.open.value);
const writeMode = ref<"write-failed" | "unknown-outcome" | null>(props.scene === "write-failed" ? "write-failed" : null);
const invalid = ref(props.scene === "user-invalid" || props.scene === "project-invalid");
const unreachable = ref(props.scene === "unreachable");

function setWriteMode(mode: "write-failed" | "unknown-outcome" | null): void {
    writeMode.value = mode;
    host.user.failWrites(mode);
    host.project?.failWrites(mode);
}

function toggleInvalid(): void {
    invalid.value = !invalid.value;
    const layer = props.scene === "project-invalid" ? host.project : host.user;
    layer?.setInvalid(invalid.value ? "第 3 行：缺少逗号" : null);
}

function toggleUnreachable(): void {
    unreachable.value = !unreachable.value;
    host.project?.setUnreachable(unreachable.value);
}

function openUnknownSection(): void {
    record("open", host.window.openWindow({section: "example.unknown"}));
}
</script>

<template>
    <SettingsWindow :window="host.window" data-lab-subject />
    <LabFixtureControls>
        <div class="settings-window-fixture__controls">
            <Button size="sm" variant="secondary" :disabled="opened" @click="scene.open()">打开设置</Button>
            <Button size="sm" variant="ghost" @click="openUnknownSection">打开不存在的分区</Button>
            <template v-if="props.scene === 'write-failed' || props.scene === 'user'">
                <Button size="sm" :variant="writeMode === 'write-failed' ? 'secondary' : 'ghost'" @click="setWriteMode('write-failed')">写入失败</Button>
                <Button size="sm" :variant="writeMode === 'unknown-outcome' ? 'secondary' : 'ghost'" @click="setWriteMode('unknown-outcome')">结果未知</Button>
                <Button size="sm" :variant="writeMode === null ? 'secondary' : 'ghost'" @click="setWriteMode(null)">正常写入</Button>
            </template>
            <Button v-if="props.scene === 'user-invalid' || props.scene === 'project-invalid'" size="sm" variant="ghost" @click="toggleInvalid">{{ invalid ? "修好文件" : "改坏文件" }}</Button>
            <Button v-if="props.scene === 'unreachable'" size="sm" variant="ghost" @click="toggleUnreachable">{{ unreachable ? "恢复连接" : "断开" }}</Button>
            <Button v-if="props.scene === 'page-stopped' || props.scene === 'page-load-failed'" size="sm" variant="ghost" @click="scene.deliver()">再次交付</Button>
        </div>
    </LabFixtureControls>
</template>

<style scoped>
.settings-window-fixture__controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
}
</style>
