<script setup lang="ts">
import {computed, onBeforeUnmount, ref, watch} from "vue";
import MonacoCodeEditor from "./MonacoCodeEditor.vue";
import type {EditorDocumentSnapshot, EditorDocumentTarget, EditorViewHandle, TextEditorHandle} from "./editor-view.types";
import type {MonacoEditorPreferences} from "nbook/shared/editor-workbench";

const props = defineProps<{
    document: EditorDocumentSnapshot;
    visible: boolean;
    monacoPreferences: MonacoEditorPreferences;
    temporaryFontSize?: number | null;
}>();
const emit = defineEmits<{
    change: [target: EditorDocumentTarget, content: string];
    save: [target: EditorDocumentTarget];
    focus: [target: EditorDocumentTarget, focused: boolean];
    ready: [handle: EditorViewHandle | null];
    "update-temporary-font-size": [size: number];
}>();
const core = ref<TextEditorHandle | null>(null);
const initialValue = props.document.content;
let currentValue = initialValue;
let coreReady = false;
const modelPath = computed(() => {
    const target = props.document.target;
    return `${encodeURIComponent(target.workspaceKey)}/${target.generation}/${target.documentId}/${target.path}`;
});
function change(content: string): void {
    currentValue = content;
    emit("change", props.document.target, content);
}
function ready(): void {
    coreReady = true;
    core.value?.update(props.document.content);
    currentValue = props.document.content;
    emit("ready", {
        flushPendingChange: () => core.value?.flushPendingChange(),
        focus: () => core.value?.focus(),
        undo: () => core.value?.undo(),
        redo: () => core.value?.redo(),
    });
}
watch(() => props.document.content, (content) => {
    if (coreReady && content !== currentValue) {
        core.value?.update(content);
        currentValue = content;
    }
});
onBeforeUnmount(() => emit("ready", null));
</script>

<template>
    <MonacoCodeEditor
        ref="core"
        class="h-full min-h-0 min-w-0"
        :initial-value="initialValue"
        :language="document.languageId"
        :model-path="modelPath"
        :visible="visible"
        :readonly="document.readonly"
        :monaco-preferences="monacoPreferences"
        :temporary-font-size="temporaryFontSize"
        @ready="ready"
        @change="change"
        @focus="emit('focus', document.target, true)"
        @blur="emit('focus', document.target, false)"
        @save-request="emit('save', document.target)"
        @update-temporary-font-size="emit('update-temporary-font-size', $event)"
    />
</template>
