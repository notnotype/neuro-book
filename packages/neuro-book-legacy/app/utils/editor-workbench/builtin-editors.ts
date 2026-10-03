import {defineAsyncComponent, h} from "vue";
import type {EditorContribution, EditorDocumentTarget} from "nbook/app/components/editor-workbench/editor-view.types";
import type {FrontmatterProfileKind, MarkdownEditorPreferences, MonacoEditorPreferences} from "nbook/shared/editor-workbench";
import type {AgentTriggerMenuContext, AgentTriggerMenuState} from "nbook/app/components/novel-ide/agent/trigger-menu";
import type {WorkspaceReferenceResolver} from "nbook/app/components/markdown-studio/tiptap/WorkspaceReference";
import type {InlineEditReference} from "nbook/app/utils/inline-editor-selection";

// 注册表惰性装载视图，未打开的编辑器不加载其昂贵内核。
const CodeEditorView = defineAsyncComponent(() => import("nbook/app/components/editor-workbench/CodeEditorView.vue"));
const MarkdownEditorView = defineAsyncComponent(() => import("nbook/app/components/editor-workbench/MarkdownEditorView.vue"));

export type BuiltinEditorBindings = {
    code: {
        preferences(): MonacoEditorPreferences;
        temporaryFontSize(path: string): number | null;
        setTemporaryFontSize(target: EditorDocumentTarget, size: number): void;
    };
    markdown: {
        preferences(): MarkdownEditorPreferences;
        canEditFrontmatter(target: EditorDocumentTarget): boolean;
        referenceRefreshKey(): string | number;
        resolveMenu(context: AgentTriggerMenuContext): AgentTriggerMenuState;
        openReference(target: string): void;
        resolveReference: WorkspaceReferenceResolver;
        inlineAiReferences(): InlineEditReference[];
        inlineAiHighlightReference(): InlineEditReference | null;
        enableQuickTriggers(): boolean;
        openFrontmatterProfile(kind: FrontmatterProfileKind): void;
        addInlineAiReference(reference: InlineEditReference): void;
    };
};

export function createBuiltinEditorContributions(bindings: BuiltinEditorBindings): readonly EditorContribution[] {
    return [{
        id: "code", titleKey: "editorWorkbench.code", iconClass: "i-lucide-file-code-2",
        supports: (resource) => resource.editable,
        render: (props, events, bind) => h(CodeEditorView, {
            ...props, commitChange: events.change, monacoPreferences: bindings.code.preferences(), temporaryFontSize: bindings.code.temporaryFontSize(props.document.target.path),
            onSave: events.save, onFocus: events.focus, onReady: bind,
            "onUpdate-temporary-font-size": (size: number) => bindings.code.setTemporaryFontSize(props.document.target, size),
        }),
    }, {
        id: "markdown", titleKey: "editorWorkbench.markdown", iconClass: "i-lucide-file-text",
        supports: (resource) => resource.editable && resource.languageId === "markdown",
        render: (props, events, bind) => h(MarkdownEditorView, {
            ...props, commitChange: events.change, editorPreferences: bindings.markdown.preferences(), showFrontmatterPanel: bindings.markdown.canEditFrontmatter(props.document.target),
            referenceRefreshKey: bindings.markdown.referenceRefreshKey(), resolveMenu: bindings.markdown.resolveMenu,
            openReference: bindings.markdown.openReference, resolveReference: bindings.markdown.resolveReference,
            inlineAiReferences: bindings.markdown.inlineAiReferences(), inlineAiHighlightReference: bindings.markdown.inlineAiHighlightReference(),
            enableQuickTriggers: bindings.markdown.enableQuickTriggers(),
            onSave: events.save, onFocus: events.focus, onActions: events.actions, onReady: bind,
            "onOpen-frontmatter-profile": bindings.markdown.openFrontmatterProfile,
            "onInline-ai-reference": bindings.markdown.addInlineAiReference,
        }),
    }];
}
