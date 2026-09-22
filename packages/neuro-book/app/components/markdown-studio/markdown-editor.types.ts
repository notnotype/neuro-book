import type {CommentItem} from "nbook/app/components/markdown-studio/tiptap/Comment";

export type MarkdownFormatCommand = "paragraph" | "heading-2" | "heading-3" | "bold" | "italic" | "underline" | "strike" | "code" | "bullet-list" | "ordered-list" | "blockquote" | "clear-format";
export type MarkdownInlineCommentItem = CommentItem;
export type MarkdownEditorHandle = {
    update(markdown: string): void;
    focus(): void;
    scrollToTop?: () => void;
    undo?: () => void;
    redo?: () => void;
    getValue?: () => string;
    flushPendingChange?: () => void;
    insertMarkdown?: (markdown: string) => void;
    replaceSelection?: (markdown: string) => void;
    appendMarkdown?: (markdown: string) => void;
    addComment?: (body: string) => void;
    getInlineComments?: () => MarkdownInlineCommentItem[];
    selectInlineComment?: (index: number) => void;
    activateInlineComment?: (index: number) => void;
    updateInlineComment?: (index: number, body: string) => void;
    deleteInlineComment?: (index: number) => void;
    setAlign?: (align: "left" | "center" | "right" | "justify") => void;
    applyMarkdownFormat?: (command: MarkdownFormatCommand) => void;
};
