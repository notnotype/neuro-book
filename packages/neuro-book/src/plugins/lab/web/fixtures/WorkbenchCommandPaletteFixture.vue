<script setup lang="ts">
/**
 * WorkbenchCommandPalette 的 Lab 场景（ui.component-lab 场景 16）：面板由本场景的局部命令宿主挂载，Lab 外壳不提供命令宿主。
 *
 * 画布里是样板编辑器，作为编辑器命令与行号模式的作用对象；打开中的面板是受检零件。控制抽屉里有与命令同源的按钮
 * （可用性与执行都走本场景的命令表）、模拟 Agent 调用模式，以及命令检视。Lab 按“组件:场景”重挂本 fixture，
 * 换场景就是换一个实例，所以这里不处理场景切换。
 */
import {Button, SegmentedControl} from "@notnotype/nb-ui/components";
import {computed, onBeforeUnmount, ref} from "vue";

import type {AgentMode, CommandInvocation, Release} from "nbook/plugins/commands/shared/contracts";

import {useLabEventSink} from "../lab-event-sink";
import type {LabFixtureProps} from "../lab-subject";
import LabFixtureControls from "../LabFixtureControls.vue";
import type {CommandEditorHandle} from "./command-scene/editor-binding";
import {registerEditorCommands} from "./command-scene/editor-commands";
import LabCommandInspector from "./command-scene/LabCommandInspector.vue";
import LabCommandSceneLayer from "./command-scene/LabCommandSceneLayer.vue";
import {useLabCommandScene} from "./command-scene/lab-command-scene";
import SampleTextEditor from "./command-scene/SampleTextEditor.vue";

const props = defineProps<LabFixtureProps>();
const emitLabEvent = useLabEventSink();
const scene = useLabCommandScene();

interface SampleDocument {
    readonly path: string;
    readonly readonly: boolean;
    readonly text: string;
}

const NAVIGATION_TEXT = Array.from({length: 60}, (_, index) => `第 ${index + 1} 行：命令导航验收`).join("\n");

/** 场景 → 样板文档；没有文档的场景演示“没有活动编辑器时编辑器命令不登记”。 */
const DOCUMENTS: Readonly<Record<string, SampleDocument | null>> = {
    "command-navigation": {path: "lab/command-navigation.txt", readonly: false, text: NAVIGATION_TEXT},
    readonly: {path: "assets/导出的旧稿.txt", readonly: true, text: "这是一份只读文档：撤销与重做不可用，行号跳转照常。\n第二行\n第三行"},
    "commands-unavailable": null,
};

const sample = computed(() => DOCUMENTS[props.scene] ?? null);
const lastResult = ref("尚未执行命令");
const agentModes = [{value: "normal", label: "normal"}, {value: "discuss", label: "discuss"}, {value: "plan", label: "plan"}];
const agentMode = computed({
    get: () => scene.agentMode.value,
    set: (mode: string | number | boolean) => {
        scene.agentMode.value = mode as AgentMode;
    },
});
let releaseEditorCommands: Release | null = null;

function onReady(handle: CommandEditorHandle): void {
    const document = sample.value;
    if (document === null) return;
    scene.activeEditor.value = {target: {workspaceKey: "lab:command-palette", generation: 1, documentId: `lab-doc:${document.path}`, path: document.path}, handle, readonly: document.readonly};
    const registration = registerEditorCommands(scene.registry, () => scene.activeEditor.value);
    if (!registration.ok) {
        scene.failure.value = registration.reason;
        emitLabEvent("command-registration-error", registration.reason);
        return;
    }
    releaseEditorCommands = registration.value;
    emitLabEvent("commands-registered", document.path);
}

function onChange(text: string): void {
    scene.palette.editorRevision.value += 1;
    emitLabEvent("change", {chars: text.length});
}

function onFocus(focused: boolean): void {
    scene.patchContext({"editor-focus": focused});
}

/** 按钮与面板、快捷键同源：可用性读同一份命令表。 */
function enabled(id: string): boolean {
    void scene.palette.revision.value;
    return scene.registry.isEnabled(id).ok;
}

async function run(id: string, invocation?: CommandInvocation): Promise<void> {
    const result = await scene.registry.execute(id, {}, invocation);
    lastResult.value = result.ok ? `${id}：完成` : `${id}：${result.code}（${result.reason}）`;
}

onBeforeUnmount(() => {
    releaseEditorCommands?.();
    scene.activeEditor.value = null;
});
</script>

<template>
    <div class="flex h-full min-h-[420px] min-w-0 flex-col bg-[var(--panel-surface)]">
        <LabFixtureControls>
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[var(--text-xs)] text-[var(--text-muted)]">
                <span class="font-mono text-[var(--text-main)]">{{ sample?.path ?? "无活动编辑器" }}</span>
                <span class="max-w-[280px] truncate font-mono text-[var(--text-secondary)]" data-lab-command-result>{{ lastResult }}</span>
                <div class="flex-1"></div>
                <SegmentedControl v-model="agentMode" :options="agentModes" size="xs" aria-label="模拟 Agent 调用模式" />
                <Button size="sm" variant="secondary" :disabled="!enabled('nbook.editor.focus')" @click="run('nbook.editor.focus')">聚焦</Button>
                <Button size="sm" variant="secondary" :disabled="!enabled('nbook.edit.undo')" @click="run('nbook.edit.undo')">撤销</Button>
                <Button size="sm" variant="secondary" :disabled="!enabled('nbook.edit.redo')" @click="run('nbook.edit.redo')">重做</Button>
                <Button size="sm" variant="secondary" :disabled="!enabled('nbook.edit.undo')" @click="run('nbook.edit.undo', {source: 'agent', callerId: 'lab'})">以 Agent 撤销</Button>
                <Button size="sm" variant="secondary" @click="run('nbook.quick-open.open-commands')">命令面板</Button>
            </div>
            <p class="mt-1.5 text-[var(--text-xs)] text-[var(--text-muted)]">面板由本场景的局部命令宿主挂载：点“命令面板”或在本场景内按 Ctrl/Cmd+Shift+P 打开，打开时它是受检零件。</p>
            <LabCommandInspector :scene="scene" />
        </LabFixtureControls>

        <LabCommandSceneLayer :scene="scene" />

        <div v-if="sample === null" class="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-[var(--text-sm)] text-[var(--text-muted)]">
            <p class="text-[var(--text-main)]">这个场景没有活动编辑器。</p>
            <p>编辑器命令不登记，行号跳转不可用：触发面应当拒绝，而不是猜一个目标。</p>
        </div>
        <div v-else class="min-h-0 flex-1 p-3">
            <SampleTextEditor :initial-text="sample.text" :readonly="sample.readonly" :label="sample.path" @ready="onReady" @change="onChange" @focus="onFocus" />
        </div>
    </div>
</template>
