import {defineComponent, h, inject, onBeforeUnmount, onMounted, ref, type PropType} from "vue";
import type {
    EditorChangeResult,
    EditorContribution,
    EditorDocumentSnapshot,
    EditorDocumentTarget,
    EditorResource,
    EditorViewEvents,
    EditorViewHandle,
    EditorViewProps,
} from "nbook/app/components/editor-workbench/editor-view.types";
import {createEditorRegistry, type EditorRegistry} from "nbook/app/utils/editor-workbench/registry";

/** 替身共用的提交签名：与真实 wrapper 的 commitChange prop 同形，回执决定本地草稿是否被确认。 */
type CommitChange = (target: EditorDocumentTarget, baseRevision: number, content: string) => EditorChangeResult;

/** 1. 源码视图示例 */
export const LabCodeEditorView = defineComponent({
    name: "LabCodeEditorView",
    props: {
        document: {type: Object as PropType<EditorDocumentSnapshot>, required: true},
        visible: {type: Boolean, default: true},
        viewInstanceId: {type: String, required: true},
        commitChange: {type: Function as PropType<CommitChange>, required: true},
    },
    emits: ["save", "focus", "ready"],
    setup(viewProps, {emit}) {
        const textareaRef = ref<HTMLTextAreaElement | null>(null);
        const reportCursor = inject<((line: number, col: number, len: number) => void) | null>("lab-editor-cursor", null);

        function updateCursor(el: HTMLTextAreaElement | null): void {
            if (!el) return;
            const pos = el.selectionStart || 0;
            const textBefore = el.value.substring(0, pos);
            const lines = textBefore.split("\n");
            reportCursor?.(lines.length, lines[lines.length - 1]!.length + 1, el.value.length);
        }

        const handle: EditorViewHandle = {
            flushPendingChange: () => "settled",
            focus() { textareaRef.value?.focus(); },
            undo() { document.execCommand?.("undo"); },
            redo() { document.execCommand?.("redo"); },
        };

        onMounted(() => {
            emit("ready", handle);
            updateCursor(textareaRef.value);
        });
        onBeforeUnmount(() => emit("ready", null));

        return () => h("div", {class: "flex h-full w-full min-h-0 flex-1 flex-col overflow-hidden bg-[var(--panel-surface)] font-mono text-xs"}, [
            h("textarea", {
                ref: textareaRef,
                value: viewProps.document.content,
                "data-view-instance": viewProps.viewInstanceId,
                class: "h-full w-full flex-1 resize-none bg-transparent p-3 font-mono text-xs leading-5 text-[var(--text-main)] outline-none selection:bg-[var(--accent-main)] selection:text-white",
                spellcheck: false,
                onInput: (e: Event) => {
                    const el = e.target as HTMLTextAreaElement;
                    viewProps.commitChange(viewProps.document.target, viewProps.document.contentRevision, el.value);
                    updateCursor(el);
                },
                onClick: (e: MouseEvent) => updateCursor(e.target as HTMLTextAreaElement),
                onKeyup: (e: KeyboardEvent) => updateCursor(e.target as HTMLTextAreaElement),
                onKeydown: (e: KeyboardEvent) => {
                    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
                        e.preventDefault();
                        emit("save", viewProps.document.target);
                    }
                },
                onFocus: (e: FocusEvent) => {
                    emit("focus", viewProps.document.target, true);
                    updateCursor(e.target as HTMLTextAreaElement);
                },
                onBlur: () => emit("focus", viewProps.document.target, false),
            }),
        ]);
    },
});

/** 2. Markdown 富文本视图示例 */
export const LabMarkdownEditorView = defineComponent({
    name: "LabMarkdownEditorView",
    props: {
        document: {type: Object as PropType<EditorDocumentSnapshot>, required: true},
        visible: {type: Boolean, default: true},
        viewInstanceId: {type: String, required: true},
        commitChange: {type: Function as PropType<CommitChange>, required: true},
    },
    emits: ["save", "focus", "actions", "ready"],
    setup(viewProps, {emit}) {
        const textareaRef = ref<HTMLTextAreaElement | null>(null);
        const commentsOpen = ref(true);
        const reportCursor = inject<((line: number, col: number, len: number) => void) | null>("lab-editor-cursor", null);

        function updateCursor(el: HTMLTextAreaElement | null): void {
            if (!el) return;
            const pos = el.selectionStart || 0;
            const textBefore = el.value.substring(0, pos);
            const lines = textBefore.split("\n");
            reportCursor?.(lines.length, lines[lines.length - 1]!.length + 1, el.value.length);
        }

        function emitActions(): void {
            emit("actions", viewProps.document.target, [
                {id: "markdown.comments", label: "批注侧面板", iconClass: "i-lucide-message-square", disabled: false, checked: commentsOpen.value},
            ]);
        }

        const handle: EditorViewHandle = {
            flushPendingChange: () => "settled",
            focus() { textareaRef.value?.focus(); },
            runAction(actionId: string) {
                if (actionId === "markdown.comments") {
                    commentsOpen.value = !commentsOpen.value;
                    emitActions();
                }
            },
        };

        onMounted(() => {
            emit("ready", handle);
            emitActions();
            updateCursor(textareaRef.value);
        });
        onBeforeUnmount(() => emit("ready", null));

        return () => h("div", {class: "flex h-full w-full min-h-0 flex-1 flex-col overflow-hidden bg-[var(--panel-surface)] text-xs"}, [
            h("div", {class: "flex min-h-0 flex-1 overflow-hidden"}, [
                h("textarea", {
                    ref: textareaRef,
                    value: viewProps.document.content,
                    "data-view-instance": viewProps.viewInstanceId,
                    class: "min-h-0 flex-1 resize-none bg-transparent p-3 font-sans text-sm leading-6 text-[var(--text-main)] outline-none",
                    onInput: (e: Event) => {
                        const el = e.target as HTMLTextAreaElement;
                        viewProps.commitChange(viewProps.document.target, viewProps.document.contentRevision, el.value);
                        updateCursor(el);
                    },
                    onClick: (e: MouseEvent) => updateCursor(e.target as HTMLTextAreaElement),
                    onKeyup: (e: KeyboardEvent) => updateCursor(e.target as HTMLTextAreaElement),
                    onFocus: (e: FocusEvent) => {
                        emit("focus", viewProps.document.target, true);
                        updateCursor(e.target as HTMLTextAreaElement);
                    },
                    onBlur: () => emit("focus", viewProps.document.target, false),
                }),
                commentsOpen.value ? h("aside", {class: "w-56 shrink-0 border-l border-[var(--divider)] bg-[var(--bg-panel)] p-3 text-[11px] text-[var(--text-secondary)] flex flex-col gap-2"}, [
                    h("div", {class: "font-medium text-[var(--text-main)] border-b border-[var(--divider)] pb-1.5"}, "批注侧面板"),
                    h("div", {class: "rounded border border-[var(--border-color)] bg-[var(--panel-surface)] p-2"}, "示例批注：此处描写生动。"),
                ]) : null,
            ]),
        ]);
    },
});

/** 3. 第三注册视图 (test.preview) */
export const LabPreviewEditorView = defineComponent({
    name: "LabPreviewEditorView",
    props: {
        document: {type: Object as PropType<EditorDocumentSnapshot>, required: true},
        visible: {type: Boolean, default: true},
        viewInstanceId: {type: String, required: true},
    },
    emits: ["save", "focus", "ready"],
    setup(viewProps, {emit}) {
        const handle: EditorViewHandle = {
            flushPendingChange: () => "settled",
            focus() {},
        };

        onMounted(() => emit("ready", handle));
        onBeforeUnmount(() => emit("ready", null));

        return () => h("div", {class: "flex h-full w-full min-h-0 flex-1 flex-col overflow-hidden bg-[var(--panel-surface)] text-xs"}, [
            h("div", {class: "flex min-h-0 flex-1 flex-col overflow-y-auto p-4 max-w-2xl mx-auto w-full"}, [
                h("div", {class: "prose max-w-none text-sm leading-6 text-[var(--text-main)] whitespace-pre-wrap font-serif"}, viewProps.document.content || "（空文档）"),
            ]),
        ]);
    },
});

/** 构建用于 Lab 测试的 EditorRegistry */
export function buildLabRegistry(): EditorRegistry {
    const code: EditorContribution = {
        id: "code", titleKey: "editorWorkbench.code", iconClass: "i-lucide-file-code-2",
        supports: (res: EditorResource) => res.editable,
        render: (vp: EditorViewProps, ev: EditorViewEvents, bind: (h: EditorViewHandle | null) => void) => h(LabCodeEditorView, {
            document: vp.document, visible: vp.visible, viewInstanceId: vp.viewInstanceId, commitChange: ev.change,
            onSave: ev.save, onFocus: ev.focus, onReady: bind,
        }),
    };
    const markdown: EditorContribution = {
        id: "markdown", titleKey: "editorWorkbench.markdown", iconClass: "i-lucide-file-text",
        supports: (res: EditorResource) => res.editable && res.languageId === "markdown",
        render: (vp: EditorViewProps, ev: EditorViewEvents, bind: (h: EditorViewHandle | null) => void) => h(LabMarkdownEditorView, {
            document: vp.document, visible: vp.visible, viewInstanceId: vp.viewInstanceId, commitChange: ev.change,
            onSave: ev.save, onFocus: ev.focus, onActions: ev.actions, onReady: bind,
        }),
    };
    const preview: EditorContribution = {
        id: "test.preview", titleKey: "测试预览视图 (第3视图)", iconClass: "i-lucide-eye",
        supports: (res: EditorResource) => res.editable,
        render: (vp: EditorViewProps, ev: EditorViewEvents, bind: (h: EditorViewHandle | null) => void) => h(LabPreviewEditorView, {
            document: vp.document, visible: vp.visible, viewInstanceId: vp.viewInstanceId,
            onSave: ev.save, onFocus: ev.focus, onReady: bind,
        }),
    };

    const created = createEditorRegistry([code, markdown, preview]);
    if (!created.ok) throw new Error(`无法创建 Lab 注册表：${created.reason}`);
    return created.value;
}
