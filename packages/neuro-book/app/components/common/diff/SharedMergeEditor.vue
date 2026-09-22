<script setup lang="ts">
import {loadMonacoEditor, type MonacoEditorApi} from "nbook/app/components/markdown-studio/load-monaco-editor";
import {applyMonacoDiffTheme} from "nbook/app/components/common/diff/monaco-diff-theme";
import {useProductTheme} from "nbook/app/utils/theme/theme-session";
import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";

const props = withDefaults(defineProps<{
    modelValue: string;
    currentContent?: string;
    incomingContent?: string;
    currentLabel?: string;
    incomingLabel?: string;
    language?: string;
    readonly?: boolean;
    modelKey?: string;
    showWhitespace?: boolean;
    resultLabel?: string;
}>(), {
    currentContent: "",
    incomingContent: "",
    currentLabel: "Current",
    incomingLabel: "Incoming",
    language: "markdown",
    readonly: false,
    modelKey: "merge",
    showWhitespace: false,
    resultLabel: "Result",
});

const emit = defineEmits<{
    (e: "update:modelValue", value: string): void;
    (e: "save-request"): void;
    (e: "ready"): void;
}>();

const {appearance} = useProductTheme();

const rootRef = ref<HTMLDivElement | null>(null);
const currentRef = ref<HTMLDivElement | null>(null);
const incomingRef = ref<HTMLDivElement | null>(null);
let monacoApi: MonacoEditorApi | null = null;
let editor: Monaco.editor.IStandaloneCodeEditor | null = null;
let model: Monaco.editor.ITextModel | null = null;
let currentEditor: Monaco.editor.IStandaloneCodeEditor | null = null;
let incomingEditor: Monaco.editor.IStandaloneCodeEditor | null = null;
let currentModel: Monaco.editor.ITextModel | null = null;
let incomingModel: Monaco.editor.ITextModel | null = null;
let changeListener: Monaco.IDisposable | null = null;
let suppressChange = false;

function disposeModel(): void {
    changeListener?.dispose();
    model?.dispose();
    currentModel?.dispose();
    incomingModel?.dispose();
    changeListener = null;
    model = null;
    currentModel = null;
    incomingModel = null;
}

function updateOptions(): void {
    editor?.updateOptions({
        readOnly: props.readonly,
        renderWhitespace: props.showWhitespace ? "boundary" : "none",
    });
    currentEditor?.updateOptions({renderWhitespace: props.showWhitespace ? "boundary" : "none"});
    incomingEditor?.updateOptions({renderWhitespace: props.showWhitespace ? "boundary" : "none"});
}

function syncModelValue(value: string): void {
    if (!model || model.getValue() === value) {
        return;
    }
    suppressChange = true;
    model.pushEditOperations([], [{range: model.getFullModelRange(), text: value}], () => null);
    queueMicrotask(() => {
        suppressChange = false;
    });
}

function createModel(): void {
    if (!monacoApi || !editor) {
        return;
    }
    disposeModel();
    const suffix = encodeURIComponent(`${props.modelKey}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    currentModel = monacoApi.editor.createModel(props.currentContent, props.language, monacoApi.Uri.parse(`file:///merge/${suffix}/current`));
    incomingModel = monacoApi.editor.createModel(props.incomingContent, props.language, monacoApi.Uri.parse(`file:///merge/${suffix}/incoming`));
    model = monacoApi.editor.createModel(props.modelValue, props.language, monacoApi.Uri.parse(`file:///merge/${suffix}/result`));
    changeListener = model.onDidChangeContent(() => {
        if (!suppressChange) {
            emit("update:modelValue", model?.getValue() ?? "");
        }
    });
    currentEditor?.setModel(currentModel);
    incomingEditor?.setModel(incomingModel);
    editor.setModel(model);
}

async function ensureEditor(): Promise<void> {
    if (!rootRef.value || !currentRef.value || !incomingRef.value) {
        return;
    }
    monacoApi = monacoApi ?? await loadMonacoEditor();
    applyMonacoDiffTheme(monacoApi, rootRef.value);
    applyMonacoDiffTheme(monacoApi, currentRef.value);
    applyMonacoDiffTheme(monacoApi, incomingRef.value);
    if (!currentEditor) {
        currentEditor = monacoApi.editor.create(currentRef.value, {
            automaticLayout: true,
            readOnly: true,
            minimap: {enabled: false},
            scrollBeyondLastLine: false,
            wordWrap: "on",
            language: props.language,
            renderWhitespace: props.showWhitespace ? "boundary" : "none",
        });
    }
    if (!incomingEditor) {
        incomingEditor = monacoApi.editor.create(incomingRef.value, {
            automaticLayout: true,
            readOnly: true,
            minimap: {enabled: false},
            scrollBeyondLastLine: false,
            wordWrap: "on",
            language: props.language,
            renderWhitespace: props.showWhitespace ? "boundary" : "none",
        });
    }
    if (!editor) {
        editor = monacoApi.editor.create(rootRef.value, {
            automaticLayout: true,
            readOnly: props.readonly,
            minimap: {enabled: false},
            scrollBeyondLastLine: false,
            wordWrap: "on",
            language: props.language,
            renderWhitespace: props.showWhitespace ? "boundary" : "none",
        });
        editor.addCommand(monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyS, () => emit("save-request"));
        emit("ready");
    }
    updateOptions();
    createModel();
    requestAnimationFrame(() => {
        currentEditor?.layout();
        incomingEditor?.layout();
        editor?.layout();
    });
}

onMounted(() => {
    void ensureEditor();
});

watch(() => props.modelValue, (value) => syncModelValue(value));

watch(() => [
    props.language,
    props.modelKey,
    props.currentContent,
    props.incomingContent,
], () => createModel());

watch(() => [props.readonly, props.showWhitespace], () => {
    updateOptions();
});

watch(appearance, () => {
    if (monacoApi) {
        applyMonacoDiffTheme(monacoApi, rootRef.value);
        applyMonacoDiffTheme(monacoApi, currentRef.value);
        applyMonacoDiffTheme(monacoApi, incomingRef.value);
    }
});

onBeforeUnmount(() => {
    currentEditor?.dispose();
    incomingEditor?.dispose();
    editor?.dispose();
    disposeModel();
    currentEditor = null;
    incomingEditor = null;
    editor = null;
    monacoApi = null;
});
</script>

<template>
    <div class="shared-merge-editor">
        <div class="shared-merge-editor__labels">
            <span>{{ currentLabel }}</span>
            <span>{{ incomingLabel }}</span>
            <span>{{ resultLabel }}</span>
        </div>
        <div class="shared-merge-editor__grid">
            <div ref="currentRef" class="shared-merge-editor__editor"></div>
            <div ref="incomingRef" class="shared-merge-editor__editor"></div>
            <div ref="rootRef" class="shared-merge-editor__editor"></div>
        </div>
    </div>
</template>

<style scoped>
.shared-merge-editor {
    display: flex;
    width: 100%;
    height: 100%;
    min-height: 0;
    flex: 1;
    flex-direction: column;
}

.shared-merge-editor__labels {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    padding-bottom: 8px;
    color: var(--text-muted);
    font-size: 12px;
}

.shared-merge-editor__grid {
    display: grid;
    min-height: 0;
    flex: 1;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
}

.shared-merge-editor__editor {
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow: hidden;
}

@media (max-width: 1100px) {
    .shared-merge-editor__labels,
    .shared-merge-editor__grid {
        grid-template-columns: minmax(0, 1fr);
    }

    .shared-merge-editor__editor {
        min-height: 240px;
    }
}
</style>
