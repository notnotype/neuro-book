<script setup lang="ts">
import {loadMonacoEditor, type MonacoEditorApi} from "nbook/app/components/markdown-studio/load-monaco-editor";
import {applyMonacoDiffTheme} from "nbook/app/components/common/diff/monaco-diff-theme";
import {useProductTheme} from "nbook/app/utils/theme/theme-session";
import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";

const props = withDefaults(defineProps<{
    originalContent: string;
    modifiedContent: string;
    originalLabel?: string;
    modifiedLabel?: string;
    language?: string;
    readonly?: boolean;
    renderSideBySide?: boolean;
    modelKey?: string;
    showWhitespace?: boolean;
}>(), {
    originalLabel: "Original",
    modifiedLabel: "Modified",
    language: "markdown",
    readonly: true,
    renderSideBySide: true,
    modelKey: "diff",
    showWhitespace: false,
});

const emit = defineEmits<{
    (e: "ready"): void;
    (e: "layout"): void;
}>();

const {appearance} = useProductTheme();

const rootRef = ref<HTMLDivElement | null>(null);
let monacoApi: MonacoEditorApi | null = null;
let diffEditor: Monaco.editor.IStandaloneDiffEditor | null = null;
let originalModel: Monaco.editor.ITextModel | null = null;
let modifiedModel: Monaco.editor.ITextModel | null = null;

function disposeModels(): void {
    originalModel?.dispose();
    modifiedModel?.dispose();
    originalModel = null;
    modifiedModel = null;
}

function updateModels(): void {
    if (!monacoApi || !diffEditor) {
        return;
    }
    disposeModels();
    const suffix = encodeURIComponent(`${props.modelKey}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    originalModel = monacoApi.editor.createModel(props.originalContent, props.language, monacoApi.Uri.parse(`file:///diff/${suffix}/original`));
    modifiedModel = monacoApi.editor.createModel(props.modifiedContent, props.language, monacoApi.Uri.parse(`file:///diff/${suffix}/modified`));
    diffEditor.setModel({original: originalModel, modified: modifiedModel});
}

function updateOptions(): void {
    diffEditor?.updateOptions({
        readOnly: props.readonly,
        originalEditable: false,
        renderSideBySide: props.renderSideBySide,
        renderWhitespace: props.showWhitespace ? "boundary" : "none",
    });
}

async function ensureEditor(): Promise<void> {
    if (!rootRef.value) {
        return;
    }
    monacoApi = monacoApi ?? await loadMonacoEditor();
    applyMonacoDiffTheme(monacoApi, rootRef.value);
    if (!diffEditor) {
        diffEditor = monacoApi.editor.createDiffEditor(rootRef.value, {
            automaticLayout: true,
            readOnly: props.readonly,
            originalEditable: false,
            renderSideBySide: props.renderSideBySide,
            minimap: {enabled: false},
            scrollBeyondLastLine: false,
            renderWhitespace: props.showWhitespace ? "boundary" : "none",
        });
        emit("ready");
    }
    updateOptions();
    updateModels();
    requestAnimationFrame(() => {
        diffEditor?.layout();
        emit("layout");
    });
}

onMounted(() => {
    void ensureEditor();
});

watch(() => [
    props.originalContent,
    props.modifiedContent,
    props.language,
    props.modelKey,
], () => {
    updateModels();
});

watch(() => [props.readonly, props.renderSideBySide, props.showWhitespace], () => {
    updateOptions();
});

watch(appearance, () => {
    if (monacoApi) {
        applyMonacoDiffTheme(monacoApi, rootRef.value);
    }
});

onBeforeUnmount(() => {
    diffEditor?.dispose();
    disposeModels();
    diffEditor = null;
    monacoApi = null;
});
</script>

<template>
    <div class="shared-diff-editor">
        <div class="shared-diff-editor__labels">
            <span>{{ originalLabel }}</span>
            <span>{{ modifiedLabel }}</span>
        </div>
        <div ref="rootRef" class="shared-diff-editor__editor"></div>
    </div>
</template>

<style scoped>
.shared-diff-editor {
    display: flex;
    width: 100%;
    height: 100%;
    min-height: 0;
    flex: 1;
    flex-direction: column;
}

.shared-diff-editor__labels {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    padding-bottom: 8px;
    color: var(--text-muted);
    font-size: 12px;
}

.shared-diff-editor__editor {
    width: 100%;
    height: 100%;
    min-height: 0;
    flex: 1;
    overflow: hidden;
}
</style>
