import type {VNode} from "vue";

/** 运行期文档身份；同路径重开或切换工作面会失效，不进入恢复快照。 */
export type EditorDocumentTarget = Readonly<{
    workspaceKey: string;
    generation: number;
    documentId: string;
    path: string;
}>;
export type EditorDocumentSnapshot = Readonly<{
    target: EditorDocumentTarget;
    content: string;
    languageId: string;
    readonly: boolean;
}>;
export type EditorResource = Readonly<{path: string; languageId: string; editable: boolean}>;
export type EditorAction = Readonly<{
    id: string;
    label: string;
    iconClass?: string;
    disabled: boolean;
    checked?: boolean;
}>;
export type EditorViewHandle = {
    flushPendingChange(): void;
    focus(): void;
    undo?: () => void;
    redo?: () => void;
    runAction?: (id: string) => void;
};
export type EditorViewProps = Readonly<{document: EditorDocumentSnapshot; visible: boolean}>;
export type EditorViewEvents = {
    change(target: EditorDocumentTarget, content: string): void;
    save(target: EditorDocumentTarget): void;
    focus(target: EditorDocumentTarget, focused: boolean): void;
    actions(target: EditorDocumentTarget, actions: readonly EditorAction[]): void;
};
export type EditorContribution = Readonly<{
    id: string;
    titleKey: string;
    iconClass: string;
    supports(resource: EditorResource): boolean;
    render(props: EditorViewProps, events: EditorViewEvents, bindHandle: (handle: EditorViewHandle | null) => void): VNode;
}>;

/** 源码内核的文本操作，不包含富文本格式或文件读写。 */
export type TextEditorHandle = {
    update(text: string): void;
    focus(): void;
    getValue(): string;
    flushPendingChange(): void;
    undo(): void;
    redo(): void;
    insertText(text: string): void;
    replaceSelection(text: string): void;
    appendText(text: string): void;
    scrollToTop(): void;
};

export type EditorTabPresentation = Readonly<{
    path: string;
    title: string;
    pinned: boolean;
    preview: boolean;
    dirty: boolean;
    iconClass: string;
    statusText?: string;
    description?: string;
}>;
export type EditorTabDropPosition = "before" | "after";
export type EditorSplitDirection = "left" | "right" | "top" | "bottom";

export function matchesEditorDocument(a: EditorDocumentTarget | null, b: EditorDocumentTarget | null): boolean {
    return a !== null && b !== null && a.workspaceKey === b.workspaceKey
        && a.generation === b.generation && a.documentId === b.documentId && a.path === b.path;
}
