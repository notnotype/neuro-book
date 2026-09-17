<script setup lang="ts">
import {onBeforeUnmount, ref, watch} from "vue";
import TipTapMarkdownEditor from "nbook/app/components/markdown-studio/TipTapMarkdownEditor.vue";
import MarkdownCommentFlowPanel from "nbook/app/components/markdown-studio/MarkdownCommentFlowPanel.vue";
import {useMarkdownEditorController} from "nbook/app/composables/useMarkdownEditorController";
import type {MarkdownEditorHandle} from "nbook/app/components/markdown-studio/markdown-editor.types";
import type {EditorAction, EditorDocumentSnapshot, EditorDocumentTarget, EditorViewHandle} from "./editor-view.types";
import type {FrontmatterProfileKind, MarkdownEditorPreferences} from "nbook/shared/editor-workbench";
import type {AgentTriggerMenuContext, AgentTriggerMenuState} from "nbook/app/components/novel-ide/agent/trigger-menu";
import type {WorkspaceReferenceResolver} from "nbook/app/components/markdown-studio/tiptap/WorkspaceReference";
import type {InlineEditReference} from "nbook/app/utils/inline-editor-selection";

const props = defineProps<{
    document: EditorDocumentSnapshot;
    visible: boolean;
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
    change: [target: EditorDocumentTarget, content: string];
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
let currentValue = initialValue;
function change(content: string): void {
    currentValue = content;
    emit("change", props.document.target, content);
}
function ready(): void {
    emit("ready", {
        flushPendingChange: () => core.value?.flushPendingChange?.(),
        focus: () => core.value?.focus(),
        undo: () => core.value?.undo?.(),
        redo: () => core.value?.redo?.(),
        runAction: (id) => {
            if (id === "markdown.comments") commentViewOpen.value = !commentViewOpen.value;
        },
    });
}
watch([commentViewOpen, () => inlineComments.value.length, () => props.visible], () => {
    emit("actions", props.document.target, [{id: "markdown.comments", label: t("markdownStudio.comments.title"), iconClass: "i-lucide-message-square-text", checked: commentViewOpen.value, disabled: false}]);
}, {immediate: true});
watch(() => props.document.content, (content) => {
    if (content !== currentValue) {
        core.value?.update(content);
        currentValue = content;
    }
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
