<script setup lang="ts">
/**
 * EditorArea 的 Lab 集成场景（docs/specs/workbench/editor.md，同名 .md）：产品里同一个编辑器区控制器、组与标签模型、
 * 文档模型与控件，文件客户端换成内存适配器（`explorer-scene/memory-files.ts`，与真实 Files 对过契约）。保存、外部改写、
 * 外部删除都真的改变场景数据；切场景时控制器与订阅一起释放。场景 `split` 先拆成两组。
 */
import {SegmentedControl} from "@notnotype/nb-ui/components";
import {systemClock} from "@notnotype/nb-runtime/lifecycle";
import {computed, onBeforeUnmount} from "vue";
import type {Component} from "vue";

import {createEditorArea} from "nbook/plugins/editor/web/area";
import EditorArea from "nbook/plugins/editor/web/components/EditorArea.vue";
import PlainTextControl from "nbook/plugins/editor/web/components/PlainTextControl.vue";
import type {EditorKind} from "nbook/plugins/editor/web/groups/groups";
import type {DisplayLocale} from "nbook/shared/localized-text";

import {useLabEventSink} from "../../lab-event-sink";
import LabFixtureControls from "../../LabFixtureControls.vue";
import {createMemoryFiles} from "../explorer-scene/memory-files";

const props = defineProps<{scene: string; locale: DisplayLocale}>();
const record = useLabEventSink();

const memory = createMemoryFiles({
    project: [
        ["chapters/第一章.md", "# 第一章\n\n天色将晚，她推开了门。\n"],
        ["chapters/第二章.md", "# 第二章\n\n雨下了一整夜。\n"],
        ["notes/设定.json", "{\n  \"城市\": \"临川\"\n}\n"],
    ],
    user: [],
});

const area = createEditorArea({
    files: memory.files,
    clock: systemClock,
    workspaceKey: "lab",
    generation: 1,
    initial: null,
    report: (error) => record("error", error instanceof Error ? error.message : String(error)),
});
area.open("project://chapters/第一章.md", {mode: "permanent"});
area.open("project://chapters/第二章.md", {mode: "preview"});
if (props.scene === "split") {
    area.split("right");
    area.open("project://notes/设定.json", {mode: "permanent"});
}

const control = (_kind: EditorKind): Component => PlainTextControl;

const active = computed(() => area.activeDocument.value?.target.value.path ?? null);
const externalWrite = (): void => {
    if (active.value !== null) memory.externalWrite(active.value, `（另一个程序改写于 ${new Date().toLocaleTimeString()}）\n`);
};
const externalDelete = (): void => {
    if (active.value !== null) memory.externalDelete(active.value);
};
const reads = [{value: "normal", label: "正常"}, {value: "held", label: "扣住读取"}];
const setReads = (value: string | number | boolean | null): void => {
    memory.readsHeld.value = value === "held";
};
const onIntent = (intent: string): void => {
    record("intent", intent);
    if (intent === "save") void area.save().then((result) => record("save", result.ok ? "ok" : result.reason));
    if (intent === "close") {
        const tab = area.groups.activeTab();
        if (tab !== null) void area.close(tab.id);
    }
    if (intent === "split-right") area.split("right");
};

onBeforeUnmount(() => {
    area.dispose();
    memory.dispose();
});
</script>

<template>
    <EditorArea :area="area" :locale="props.locale" :control="control" class="h-full w-full" data-lab-subject @intent="onIntent" />
    <LabFixtureControls>
        <div class="flex flex-wrap items-center gap-3 text-xs" data-lab-editor-controls>
            <span class="text-[var(--text-secondary)]">正文读取</span>
            <SegmentedControl :model-value="memory.readsHeld.value ? 'held' : 'normal'" :options="reads" aria-label="正文读取" size="sm" @update:model-value="setReads" />
            <button type="button" class="nb-ui-focus-ring rounded px-2 py-1 text-[var(--accent-text)] hover:bg-[var(--bg-hover)]" data-lab-editor-external-write @click="externalWrite">外部改写当前文件</button>
            <button type="button" class="nb-ui-focus-ring rounded px-2 py-1 text-[var(--accent-text)] hover:bg-[var(--bg-hover)]" data-lab-editor-external-delete @click="externalDelete">外部删除当前文件</button>
            <button type="button" class="nb-ui-focus-ring rounded px-2 py-1 text-[var(--accent-text)] hover:bg-[var(--bg-hover)]" @click="area.open('project://notes/设定.json', {mode: 'preview'})">打开设定.json</button>
        </div>
    </LabFixtureControls>
</template>
