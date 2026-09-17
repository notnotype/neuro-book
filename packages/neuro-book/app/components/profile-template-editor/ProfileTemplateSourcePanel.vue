<script setup lang="ts">
import MonacoCodeEditor from "nbook/app/components/editor-workbench/MonacoCodeEditor.vue";
import type {MonacoEditorPreferences} from "nbook/shared/editor-workbench";

const props = defineProps<{
    sourceText: string;
    sourceLineCount: number;
    parsingSource: boolean;
    selectedTemplateFileName: string;
    monacoPreferences: MonacoEditorPreferences;
    embedded?: boolean;
}>();

const emit = defineEmits<{
    (e: "change", value: string): void;
    (e: "save-request"): void;
}>();
</script>

<template>
    <!-- TSX 模板源码编辑面板 -->
    <section class="panel flex min-h-0 flex-col" :class="props.embedded ? 'h-full border-0 bg-transparent p-0 shadow-none' : 'flex-[0.9]'">
        <div v-if="!props.embedded" class="mb-2 flex shrink-0 items-center justify-between">
            <div class="panel-title">TSX 模板源码</div>
            <div class="flex items-center gap-2">
                <span v-if="props.parsingSource" class="text-[11px] text-[var(--text-muted)]">解析中...</span>
                <span class="text-[11px] text-[var(--text-muted)]">{{ props.sourceLineCount }} 行</span>
            </div>
        </div>
        <MonacoCodeEditor
            class="source-preview min-h-0 flex-1 overflow-hidden rounded-md"
            :class="props.embedded ? 'border-0' : 'border border-[var(--border-color)]'"
            :initial-value="props.sourceText"
            visible
            language="typescript"
            :model-path="props.selectedTemplateFileName"
            :monaco-preferences="props.monacoPreferences"
            @change="emit('change', $event)"
            @save-request="emit('save-request')"
        />
    </section>
</template>

<style scoped>
.panel {
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-panel);
    padding: 12px;
    box-shadow: 0 16px 44px color-mix(in srgb, var(--shadow-color) 5%, transparent);
}

.panel-title {
    color: var(--text-main);
    font-size: 13px;
    font-weight: 700;
}

.source-preview {
    background: var(--panel-surface);
}
</style>
