<script setup lang="ts">
/**
 * WorkbenchCommandPalette 的 Lab 场景：面板由场景自己的局部命令宿主挂载，LabShell 不再提供全局实例。
 *
 * 夹具直接复用 CodeEditorViewFixture 的真实编辑器、控制栏与局部宿主，只把受检零件标记改到
 * 打开中的面板上；打开方式的提示放在底部控制抽屉，画布里只有被检视的界面。
 */
import {provide, ref, watch} from "vue";
import CodeEditorViewFixture from "./CodeEditorViewFixture.vue";
import {findLabFixture} from "./index";
import {LAB_INPUT_SINK} from "../lab-event-sink";
import type {LabFixtureProps, LabSceneInput} from "../lab-subject";

const props = defineProps<LabFixtureProps>();

function initialEditorInput(scene: string): LabSceneInput {
    const match = findLabFixture("CodeEditorView")?.scenes.find((candidate) => candidate.id === scene);
    if (!match?.input) throw new Error(`WorkbenchCommandPalette 缺少对应 CodeEditorView 场景：${scene}`);
    return structuredClone(match.input);
}
const editorInput = ref<LabSceneInput>(initialEditorInput(props.scene));
watch([() => props.scene, () => props.input], ([scene]) => {editorInput.value = initialEditorInput(scene);});
provide(LAB_INPUT_SINK, (layer, key, value) => {
    editorInput.value = {...editorInput.value, [layer]: {...editorInput.value[layer], [key]: value}};
});
</script>

<template>
    <CodeEditorViewFixture :scene="props.scene" :input="editorInput" :palette-subject="true" />
</template>
