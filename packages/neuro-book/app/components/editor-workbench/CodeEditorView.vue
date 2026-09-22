<script setup lang="ts">
import {computed, onBeforeUnmount, ref, watch} from "vue";
import MonacoCodeEditor from "./MonacoCodeEditor.vue";
import type {
    EditorChangeResult,
    EditorDocumentSnapshot,
    EditorDocumentTarget,
    EditorFlushResult,
    EditorViewHandle,
    TextEditorHandle,
} from "./editor-view.types";
import type {MonacoEditorPreferences} from "nbook/shared/editor-workbench";

const props = defineProps<{
    document: EditorDocumentSnapshot;
    visible: boolean;
    viewInstanceId: string;
    commitChange: (target: EditorDocumentTarget, baseRevision: number, content: string) => EditorChangeResult;
    monacoPreferences: MonacoEditorPreferences;
    temporaryFontSize?: number | null;
}>();
const emit = defineEmits<{
    save: [target: EditorDocumentTarget];
    focus: [target: EditorDocumentTarget, focused: boolean];
    ready: [handle: EditorViewHandle | null];
    "update-temporary-font-size": [size: number];
}>();
const core = ref<TextEditorHandle | null>(null);
const initialValue = props.document.content;
/** 本实例确认到的正文：accepted 回声不算外部更新，不重设撤销基线。 */
let confirmedValue = initialValue;
/** 已被拒绝但必须保留的候选：裁决前不被兄弟回灌覆盖，也不能当作已进入权威缓冲。 */
let unresolvedCandidate: string | null = null;
// 实例 token 进模型路径：同文档多视图各持有自己的 Monaco model，可独立释放。
const modelPath = computed(() => {
    const target = props.document.target;
    return `${encodeURIComponent(target.workspaceKey)}/${target.generation}/${target.documentId}/${target.path}/${props.viewInstanceId}`;
});
/**
 * 输入提交由回执定归属：accepted 才推进确认快照，conflict 保留候选等裁决，
 * stale 表示身份已撤销（宿主正在卸载本实例），内容不属于任何文档。
 */
function change(content: string): void {
    const result = props.commitChange(props.document.target, props.document.contentRevision, content);
    if (result.status === "accepted") {
        confirmedValue = content;
        unresolvedCandidate = null;
        return;
    }
    if (result.status === "conflict") {
        unresolvedCandidate = content;
    }
}
/** 结算本实例：清掉防抖计时器不等于输入已进入权威缓冲，未裁决的候选一律报 conflict。 */
function flushPending(): EditorFlushResult {
    core.value?.flushPendingChange();
    return unresolvedCandidate === null ? "settled" : "conflict";
}
/** 冲突裁决：采用当前正文丢弃候选，保留此视图内容则用最新修订重提一次。 */
function resolveConflict(choice: "adopt-current" | "keep-view"): EditorFlushResult {
    if (choice === "adopt-current") {
        unresolvedCandidate = null;
        confirmedValue = props.document.content;
        core.value?.update(props.document.content);
        return "settled";
    }
    const candidate = unresolvedCandidate;
    if (candidate === null) {
        return "settled";
    }
    const result = props.commitChange(props.document.target, props.document.contentRevision, candidate);
    if (result.status === "accepted") {
        unresolvedCandidate = null;
        confirmedValue = candidate;
    }
    return unresolvedCandidate === null ? "settled" : "conflict";
}
function ready(): void {
    core.value?.update(props.document.content);
    confirmedValue = props.document.content;
    emit("ready", {
        flushPendingChange: flushPending,
        focus: () => core.value?.focus(),
        undo: () => core.value?.undo(),
        redo: () => core.value?.redo(),
        resolveConflict,
        // 能力透传：内核没给出 navigation 时宿主看到的仍是「无行导航」状态。
        navigation: core.value?.navigation,
    });
}
watch(() => props.document.content, (content) => {
    if (content === confirmedValue) {
        return;
    }
    // 候选未被裁决前，权威快照不得覆盖产生它的实例。
    if (unresolvedCandidate !== null) {
        return;
    }
    confirmedValue = content;
    core.value?.update(content);
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
