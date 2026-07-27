<script setup lang="ts">
import type { MarkdownStudioController, MarkdownStudioEditorHandle } from "nbook/app/composables/useMarkdownStudioController";
import { useMarkdownStudioSync } from "nbook/app/composables/useMarkdownStudioSync";
import type { IdeTheme } from "nbook/app/utils/theme/theme-tokens";
import {DEFAULT_MARKDOWN_EDITOR_PREFERENCES, DEFAULT_MONACO_EDITOR_PREFERENCES, type FrontmatterProfileKind, type MarkdownEditorPreferences, type MonacoEditorPreferences} from "nbook/shared/editor-workbench";
import type {AgentTriggerMenuContext, AgentTriggerMenuState} from "nbook/app/components/novel-ide/agent/trigger-menu";
import type {WorkspaceReferenceResolver} from "nbook/app/components/markdown-studio/tiptap/WorkspaceReference";
import type {InlineEditReference} from "nbook/app/utils/inline-editor-selection";

const props = withDefaults(defineProps<{
    controller: MarkdownStudioController;
    readonly?: boolean;
    theme?: IdeTheme;
    editorPreferences?: MarkdownEditorPreferences;
    monacoPreferences?: MonacoEditorPreferences;
    monacoTemporaryFontSize?: number | null;
    activePath?: string;
    referenceRefreshKey?: string | number;
    resolveMenu?: (context: AgentTriggerMenuContext) => AgentTriggerMenuState;
    openReference?: (target: string) => void;
    resolveReference?: WorkspaceReferenceResolver;
    inlineAiReferences?: InlineEditReference[];
    inlineAiHighlightReference?: InlineEditReference | null;
    enableQuickTriggers?: boolean;
}>(), {
    readonly: false,
    theme: "sepia",
    editorPreferences: () => ({...DEFAULT_MARKDOWN_EDITOR_PREFERENCES}),
    monacoPreferences: () => ({...DEFAULT_MONACO_EDITOR_PREFERENCES}),
    monacoTemporaryFontSize: null,
    activePath: "",
    referenceRefreshKey: "",
    resolveMenu: () => ({
        title: "",
        prefix: "",
        sections: [],
    }),
    openReference: () => {},
    inlineAiReferences: () => [],
    inlineAiHighlightReference: null,
    enableQuickTriggers: false,
});

const sourceEditorRef = ref<MarkdownStudioEditorHandle | null>(null);
const previewEditorRef = ref<MarkdownStudioEditorHandle | null>(null);
// 编辑器初值只取挂载时快照；后续外部内容更新一律走 sync 层显式 update()。
// 若这里保持响应式绑定，每次输入都会触发隐藏编辑器 watch(initialValue) 的全文对比。
const initialMarkdown = props.controller.markdown.value;
const {t} = useI18n();
const { onPreviewChange, onSourceChange } = useMarkdownStudioSync({
    controller: props.controller,
    sourceEditorRef,
    previewEditorRef,
});

const emit = defineEmits<{
    (e: "save-request"): void;
    (e: "open-frontmatter-profile", kind: FrontmatterProfileKind): void;
    (e: "update-monaco-temporary-font-size", value: number): void;
    (e: "inline-ai-reference", reference: InlineEditReference): void;
    (e: "generate-illustration", payload: {text: string; insertPos: number}): void;
}>();

/**
 * 富文本区失焦后请求保存当前 Markdown。
 */
function handlePreviewBlur(): void {
    props.controller.onPreviewBlur();
    emit("save-request");
}

/**
 * 源码区失焦后请求保存当前 Markdown。
 */
function handleSourceBlur(): void {
    props.controller.onSourceBlur();
    emit("save-request");
}
</script>

<template>
    <!-- Markdown 工作区正文 -->
    <section class="ide-editor-shell flex min-h-0 flex-1 flex-col">
        <div
            v-show="controller.isPreviewVisible.value"
            class="min-h-0 flex-1 overflow-hidden bg-[var(--editor-bg)]"
        >
            <ClientOnly>
                <TipTapMarkdownEditor
                    ref="previewEditorRef"
                    :initial-value="initialMarkdown"
                    :editor-preferences="props.editorPreferences"
                    :visible="controller.isPreviewVisible.value"
                    :readonly="readonly || controller.editorsLocked.value"
                    :active-path="props.activePath"
                    :reference-refresh-key="props.referenceRefreshKey"
                    :resolve-menu="props.resolveMenu"
                    :open-reference="props.openReference"
                    :resolve-reference="props.resolveReference"
                    :inline-ai-references="props.inlineAiReferences"
                    :inline-ai-highlight-reference="props.inlineAiHighlightReference"
                    :enable-quick-triggers="props.enableQuickTriggers"
                    @change="onPreviewChange"
                    @focus="controller.onPreviewFocus"
                    @blur="handlePreviewBlur"
                    @save-request="emit('save-request')"
                    @open-frontmatter-profile="emit('open-frontmatter-profile', $event)"
                    @inline-comments-change="controller.setInlineComments"
                    @inline-comment-select="controller.activateInlineComment"
                    @inline-ai-reference="emit('inline-ai-reference', $event)"
                    @generate-illustration="emit('generate-illustration', $event)"
                />
                <template #fallback>
                    <div class="flex min-h-[65vh] items-center justify-center text-[var(--text-muted)]">
                        <span class="i-lucide-loader-2 mr-2 h-6 w-6 animate-spin"></span>
                        <span>{{ t("markdownStudio.workbench.loadingRichEngine") }}</span>
                    </div>
                </template>
            </ClientOnly>
        </div>

        <div
            v-show="controller.isSourceVisible.value"
            class="min-h-0 flex-1 overflow-hidden bg-[var(--source-bg)]"
        >
            <MarkdownSourceEditor
                ref="sourceEditorRef"
                :initial-value="initialMarkdown"
                :readonly="readonly || controller.editorsLocked.value"
                :theme="props.theme"
                :visible="controller.isSourceVisible.value"
                :monaco-preferences="props.monacoPreferences"
                :temporary-font-size="props.monacoTemporaryFontSize"
                @change="onSourceChange"
                @focus="controller.onSourceFocus"
                @blur="handleSourceBlur"
                @save-request="emit('save-request')"
                @update-temporary-font-size="emit('update-monaco-temporary-font-size', $event)"
            />
        </div>
    </section>
</template>

<style scoped>
.ide-editor-shell {
    background: color-mix(in srgb, var(--bg-panel) 88%, transparent);
}
</style>
