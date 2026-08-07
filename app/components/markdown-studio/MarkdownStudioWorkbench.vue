<script setup lang="ts">
import type {AgentTriggerMenuContext, AgentTriggerMenuState} from "nbook/app/components/novel-ide/agent/trigger-menu";
import type {MarkdownStudioController} from "nbook/app/composables/useMarkdownStudioController";
import type {IdeTheme} from "nbook/app/utils/theme/theme-tokens";
import type {WorkspaceEditorKind, WorkspaceEditorTab, WorkspaceEditorViewMode, WorkspaceFileNode} from "nbook/app/stores/novel-ide";
import type {WorkspaceReferenceResolver} from "nbook/app/components/markdown-studio/tiptap/WorkspaceReference";
import type {FrontmatterProfileKind, MarkdownEditorPreferences, MonacoEditorPreferences} from "nbook/shared/editor-workbench";
import {resolveMonacoLanguage, resolveWorkspaceFileExtension} from "nbook/shared/editor-workbench";
import MarkdownStudio from "nbook/app/components/markdown-studio/MarkdownStudio.vue";
import MarkdownSourceEditor from "nbook/app/components/markdown-studio/MarkdownSourceEditor.vue";
import MarkdownStudioToolbar from "nbook/app/components/markdown-studio/MarkdownStudioToolbar.vue";
import MarkdownStudioWelcome from "nbook/app/components/markdown-studio/MarkdownStudioWelcome.vue";
import MarkdownCommentFlowPanel from "nbook/app/components/markdown-studio/MarkdownCommentFlowPanel.vue";
import type {InlineEditReference} from "nbook/app/utils/inline-editor-selection";

type WorkspaceMode = "novel" | "user-assets";

const props = withDefaults(defineProps<{
    controller: MarkdownStudioController;
    content: string;
    tabs: WorkspaceEditorTab[];
    activePath: string;
    node: WorkspaceFileNode | null;
    editorKind: WorkspaceEditorKind;
    workspaceViewMode: WorkspaceEditorViewMode;
    theme: IdeTheme;
    editorPreferences: MarkdownEditorPreferences;
    monacoPreferences: MonacoEditorPreferences;
    monacoTemporaryFontSize?: number | null;
    activeTabRows?: number;
    compact?: boolean;
    workspaceMode?: WorkspaceMode;
    referenceRefreshKey?: string | number;
    resolveMenu?: (context: AgentTriggerMenuContext) => AgentTriggerMenuState;
    openReference?: (target: string) => void;
    resolveReference?: WorkspaceReferenceResolver;
    inlineAiReferences?: InlineEditReference[];
    inlineAiHighlightReference?: InlineEditReference | null;
    enableQuickTriggers?: boolean;
}>(), {
    activeTabRows: 3,
    workspaceMode: "novel",
    referenceRefreshKey: "",
    resolveMenu: () => ({
        title: "",
        prefix: "",
        sections: [],
    }),
    openReference: () => {},
    inlineAiReferences: () => [],
    enableQuickTriggers: false,
});

const emit = defineEmits<{
    (e: "update:content", value: string): void;
    (e: "select-tab", path: string): void;
    (e: "close-tab", path: string): void;
    (e: "set-pin", path: string, pinned: boolean): void;
    (e: "keep-tab", path: string): void;
    (e: "move-tab", path: string, targetPath: string | null, targetPinned: boolean, position: "before" | "after"): void;
    (e: "set-view-mode", mode: WorkspaceEditorViewMode): void;
    (e: "save-request"): void;
    (e: "open-frontmatter-profile", kind: FrontmatterProfileKind): void;
    (e: "update-monaco-temporary-font-size", value: number): void;
    (e: "open-path", path: string): void;
    (e: "open-files"): void;
    (e: "create-chapter"): void;
    (e: "create-markdown-file"): void;
    (e: "create-lorebook-entry"): void;
    (e: "open-agent-panel"): void;
    (e: "open-profile-workbench"): void;
    (e: "more"): void;
    (e: "inline-ai-reference", reference: InlineEditReference): void;
}>();

const isMarkdownFile = computed(() => resolveWorkspaceFileExtension(props.activePath) === ".md");
const monacoLanguage = computed(() => resolveMonacoLanguage(props.activePath));
const canEditCurrentFile = computed(() => props.node?.editable === true);

watch(() => props.activePath, () => {
    props.controller.closeCommentView();
    props.controller.setInlineComments([]);
});
</script>

<template>
    <!-- Markdown Studio 工作台 -->
    <section class="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--editor-bg)]" :class="props.compact ? 'min-w-[260px]' : 'min-w-[640px]'">
        <MarkdownStudioToolbar
            :tabs="props.tabs"
            :active-path="props.activePath"
            :editor-kind="props.editorKind"
            :workspace-view-mode="props.workspaceViewMode"
            :comment-view-open="props.controller.commentViewOpen.value"
            :comment-count="props.controller.inlineComments.value.length"
            :active-tab-rows="props.activeTabRows"
            @select-tab="emit('select-tab', $event)"
            @close-tab="emit('close-tab', $event)"
            @set-pin="(path, pinned) => emit('set-pin', path, pinned)"
            @keep-tab="emit('keep-tab', $event)"
            @move-tab="(path, targetPath, targetPinned, position) => emit('move-tab', path, targetPath, targetPinned, position)"
            @set-view-mode="emit('set-view-mode', $event)"
            @toggle-comment-view="props.controller.commentViewOpen.value ? props.controller.closeCommentView() : props.controller.openCommentView()"
            @more="emit('more')"
        />

        <div class="relative flex min-h-0 flex-1 overflow-hidden bg-[var(--editor-bg)]">
            <MarkdownStudioWelcome
                v-if="!props.activePath || !props.node"
                :node="props.node"
                :tabs="props.tabs"
                :compact="props.compact"
                :workspace-mode="props.workspaceMode"
                @select-tab="emit('select-tab', $event)"
                @open-path="emit('open-path', $event)"
                @open-files="emit('open-files')"
                @create-chapter="emit('create-chapter')"
                @create-markdown-file="emit('create-markdown-file')"
                @create-lorebook-entry="emit('create-lorebook-entry')"
                @open-agent-panel="emit('open-agent-panel')"
                @open-profile-workbench="emit('open-profile-workbench')"
            />

            <template v-else-if="canEditCurrentFile && isMarkdownFile">
                <div class="markdown-comment-layout min-w-0 flex-1" :class="props.controller.commentViewOpen.value ? 'is-comment-view' : ''">
                    <div class="markdown-comment-layout__spacer"></div>
                    <MarkdownStudio
                        :key="`${props.activePath}:markdown`"
                        class="ide-editor-shell min-w-0"
                        :class="props.controller.commentViewOpen.value ? 'markdown-comment-layout__editor' : 'flex-1'"
                        :controller="props.controller"
                        :theme="props.theme"
                        :editor-preferences="props.editorPreferences"
                        :monaco-preferences="props.monacoPreferences"
                        :monaco-temporary-font-size="props.monacoTemporaryFontSize"
                        :active-path="props.activePath"
                        :reference-refresh-key="props.referenceRefreshKey"
                        :resolve-menu="props.resolveMenu"
                        :open-reference="props.openReference"
                        :resolve-reference="props.resolveReference"
                        :inline-ai-references="props.inlineAiReferences"
                        :inline-ai-highlight-reference="props.inlineAiHighlightReference"
                        :enable-quick-triggers="props.enableQuickTriggers"
                        @save-request="emit('save-request')"
                        @open-frontmatter-profile="emit('open-frontmatter-profile', $event)"
                        @update-monaco-temporary-font-size="emit('update-monaco-temporary-font-size', $event)"
                        @inline-ai-reference="emit('inline-ai-reference', $event)"
                    />
                    <MarkdownCommentFlowPanel
                        v-if="props.controller.commentViewOpen.value"
                        :comments="props.controller.inlineComments.value"
                        :active-index="props.controller.activeInlineCommentIndex.value"
                        @select="props.controller.selectInlineComment"
                        @update="props.controller.updateInlineComment"
                        @delete="props.controller.deleteInlineComment"
                        @close="props.controller.closeCommentView"
                    />
                    <div class="markdown-comment-layout__spacer"></div>
                </div>
            </template>

            <MarkdownSourceEditor
                v-else-if="canEditCurrentFile && props.editorKind === 'monaco'"
                :key="`${props.activePath}:monaco`"
                class="min-h-0 flex-1"
                :initial-value="props.content"
                :theme="props.theme"
                :language="monacoLanguage"
                :model-path="props.activePath"
                :monaco-preferences="props.monacoPreferences"
                :temporary-font-size="props.monacoTemporaryFontSize"
                visible
                @change="emit('update:content', $event)"
                @focus="props.controller.onSourceFocus"
                @blur="props.controller.onSourceBlur(); emit('save-request')"
                @save-request="emit('save-request')"
                @update-temporary-font-size="emit('update-monaco-temporary-font-size', $event)"
            />

            <MarkdownStudioWelcome
                v-else
                :node="props.node"
                :tabs="props.tabs"
                :compact="props.compact"
                :workspace-mode="props.workspaceMode"
                @select-tab="emit('select-tab', $event)"
                @open-path="emit('open-path', $event)"
                @open-files="emit('open-files')"
                @create-chapter="emit('create-chapter')"
                @create-markdown-file="emit('create-markdown-file')"
                @create-lorebook-entry="emit('create-lorebook-entry')"
                @open-agent-panel="emit('open-agent-panel')"
                @open-profile-workbench="emit('open-profile-workbench')"
            />
        </div>
    </section>
</template>

<style scoped>
.markdown-comment-layout {
    display: flex;
    min-height: 0;
    overflow: hidden;
    background: var(--editor-bg);
}

.markdown-comment-layout__spacer {
    display: none;
    min-width: 24px;
    flex: 1 1 24px;
}

.markdown-comment-layout.is-comment-view {
    gap: 0;
}

.markdown-comment-layout.is-comment-view .markdown-comment-layout__spacer {
    display: block;
}

.markdown-comment-layout__editor {
    width: min(58vw, 860px);
    flex: 0 1 860px;
    border-left: 1px solid transparent;
}

@media (max-width: 1180px) {
    .markdown-comment-layout.is-comment-view .markdown-comment-layout__spacer {
        display: none;
    }

    .markdown-comment-layout__editor {
        width: auto;
        flex: 1 1 auto;
    }
}
</style>
