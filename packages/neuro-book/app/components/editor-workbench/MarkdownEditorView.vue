<script setup lang="ts">
import {onBeforeUnmount, ref, watch} from "vue";
import TipTapMarkdownEditor from "nbook/app/components/markdown-studio/TipTapMarkdownEditor.vue";
import MarkdownCommentFlowPanel from "nbook/app/components/markdown-studio/MarkdownCommentFlowPanel.vue";
import {useMarkdownEditorController} from "nbook/app/composables/useMarkdownEditorController";
import type {MarkdownEditorHandle} from "nbook/app/components/markdown-studio/markdown-editor.types";
import type {EditorAction, EditorChangeResult, EditorDocumentSnapshot, EditorDocumentTarget, EditorFlushResult, EditorViewHandle} from "./editor-view.types";
import type {FrontmatterProfileKind, MarkdownEditorPreferences} from "nbook/shared/editor-workbench";
import type {AgentTriggerMenuContext, AgentTriggerMenuState} from "nbook/app/components/novel-ide/agent/trigger-menu";
import type {WorkspaceReferenceResolver} from "nbook/app/components/markdown-studio/tiptap/WorkspaceReference";
import type {InlineEditReference} from "nbook/app/utils/inline-editor-selection";

const props = defineProps<{
    document: EditorDocumentSnapshot;
    visible: boolean;
    /** 实例 token：富文本内核天然独占自己的编辑器，token 只体现在宿主路由与输入回执上。 */
    viewInstanceId: string;
    commitChange: (target: EditorDocumentTarget, baseRevision: number, content: string) => EditorChangeResult;
    editorPreferences: MarkdownEditorPreferences;
    showFrontmatterPanel: boolean;
    referenceRefreshKey?: string | number;
    resolveMenu?: (context: AgentTriggerMenuContext) => AgentTriggerMenuState;
    openReference?: (target: string) => void;
    resolveReference?: WorkspaceReferenceResolver;
    inlineAiReferences?: InlineEditReference[];
    inlineAiHighlightReference?: InlineEditReference | null;
    enableQuickTriggers?: boolean;
}>();
const emit = defineEmits<{
    save: [target: EditorDocumentTarget];
    focus: [target: EditorDocumentTarget, focused: boolean];
    ready: [handle: EditorViewHandle | null];
    actions: [target: EditorDocumentTarget, actions: readonly EditorAction[]];
    "open-frontmatter-profile": [kind: FrontmatterProfileKind];
    "inline-ai-reference": [reference: InlineEditReference];
}>();
const {t} = useI18n();
const core = ref<MarkdownEditorHandle | null>(null);
const comments = useMarkdownEditorController(core);
const {commentViewOpen, inlineComments, activeInlineCommentIndex} = comments;
const initialValue = props.document.content;
/** 本实例确认到的正文：accepted 回声不算外部更新，不重设富文本的 history 基线。 */
let confirmedValue = initialValue;
/** 已被拒绝但必须保留的候选：裁决前不被兄弟回灌覆盖，也不能当作已进入权威缓冲。 */
let unresolvedCandidate: string | null = null;
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
    core.value?.flushPendingChange?.();
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
        undo: () => core.value?.undo?.(),
        redo: () => core.value?.redo?.(),
        runAction: (id) => {
            if (id === "markdown.comments") commentViewOpen.value = !commentViewOpen.value;
        },
        resolveConflict,
    });
}
watch([commentViewOpen, () => inlineComments.value.length, () => props.visible], () => {
    emit("actions", props.document.target, [{id: "markdown.comments", label: t("markdownStudio.comments.title"), iconClass: "i-lucide-message-square-text", checked: commentViewOpen.value, disabled: false}]);
}, {immediate: true});
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
    <div class="markdown-editor-view flex h-full min-h-0 min-w-0 overflow-hidden">
        <TipTapMarkdownEditor
            ref="core"
            class="min-h-0 min-w-0 flex-1"
            :initial-value="initialValue"
            :visible="visible"
            :readonly="document.readonly"
            :editor-preferences="editorPreferences"
            :active-path="document.target.path"
            :show-frontmatter-panel="showFrontmatterPanel"
            :reference-refresh-key="referenceRefreshKey"
            :resolve-menu="resolveMenu"
            :open-reference="openReference"
            :resolve-reference="resolveReference"
            :inline-ai-references="inlineAiReferences"
            :inline-ai-highlight-reference="inlineAiHighlightReference"
            :enable-quick-triggers="enableQuickTriggers"
            @ready="ready"
            @change="change"
            @focus="emit('focus', document.target, true)"
            @blur="emit('focus', document.target, false)"
            @save-request="emit('save', document.target)"
            @open-frontmatter-profile="emit('open-frontmatter-profile', $event)"
            @inline-ai-reference="emit('inline-ai-reference', $event)"
            @inline-comments-change="comments.setInlineComments"
            @inline-comment-select="comments.activateInlineComment"
        />
        <MarkdownCommentFlowPanel
            v-if="commentViewOpen"
            class="editor-comment-panel"
            :comments="inlineComments"
            :active-index="activeInlineCommentIndex"
            @select="comments.selectInlineComment"
            @update="(index, body) => core?.updateInlineComment?.(index, body)"
            @delete="(index) => core?.deleteInlineComment?.(index)"
            @close="commentViewOpen = false"
        />
    </div>
</template>

<style scoped>
.markdown-editor-view { container-type: inline-size; }
@container (max-width: 700px) {
    .editor-comment-panel { position: absolute; inset: 0; width: 100%; z-index: 1; }
}
</style>
