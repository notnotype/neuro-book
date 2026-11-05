/**
 * Markdown 编辑器的编辑动作（docs/specs/workbench/markdown-editing.md）：纯 Tiptap，不认识工作台。命令、公开键与菜单归宿主，
 * 宿主按 `id` 调这里；`active`、`enabled` 只读编辑状态，`enabled` 用 `editor.can()` 在事务副本上试跑。
 */

import type {Editor} from "@tiptap/core";

export type EditingArgs = Readonly<Record<string, unknown>>;

export interface EditingAction {
    run(editor: Editor, args: EditingArgs): boolean;
    active?(editor: Editor): boolean;
    enabled(editor: Editor, args: EditingArgs): boolean;
}

/** “清除格式”移除的标记。批注是审阅数据，注音与链接是内容，都不算格式（输出 8）。 */
const FORMAT_MARKS: ReadonlyArray<string> = ["bold", "italic", "strike", "code", "markdownTextColor", "markdownHighlight", "markdownSuperscript", "markdownSubscript"];

const toggleMark = (mark: string): EditingAction => ({
    run: (editor) => editor.chain().focus().toggleMark(mark).run(),
    active: (editor) => editor.isActive(mark),
    enabled: (editor) => editor.can().toggleMark(mark),
});

/** 带颜色的标记：`color` 为 null 时移除；移除总是可以试，所以只按能不能加判断。 */
const colorMark = (mark: string): EditingAction => ({
    run: (editor, args) => {
        const color = typeof args.color === "string" ? args.color : null;
        const chain = editor.chain().focus();
        return (color === null ? chain.unsetMark(mark) : chain.setMark(mark, {color})).run();
    },
    active: (editor) => editor.isActive(mark),
    enabled: (editor) => editor.can().setMark(mark, {color: "#000000"}),
});

const text = (args: EditingArgs): string => (typeof args.text === "string" ? args.text : "");

export const markdownEditingActions: Readonly<Record<string, EditingAction>> = {
    bold: toggleMark("bold"),
    italic: toggleMark("italic"),
    strike: toggleMark("strike"),
    code: toggleMark("code"),
    superscript: toggleMark("markdownSuperscript"),
    subscript: toggleMark("markdownSubscript"),
    "text-color": colorMark("markdownTextColor"),
    highlight: colorMark("markdownHighlight"),
    "clear-format": {
        run: (editor) => FORMAT_MARKS.reduce((chain, mark) => chain.unsetMark(mark), editor.chain().focus()).run(),
        enabled: (editor) => editor.can().toggleMark("bold"),
    },
    ruby: {
        run: (editor, args) => editor.chain().focus().setMarkdownRuby(text(args)).run(),
        active: (editor) => editor.isActive("markdownRuby"),
        enabled: (editor) => !editor.state.selection.empty && editor.can().setMarkdownRuby("x"),
    },
    paragraph: {
        run: (editor) => editor.chain().focus().setParagraph().run(),
        active: (editor) => editor.isActive("paragraph"),
        enabled: (editor) => editor.can().setParagraph(),
    },
    "heading-1": heading(1),
    "heading-2": heading(2),
    "heading-3": heading(3),
    "bullet-list": {
        run: (editor) => editor.chain().focus().toggleBulletList().run(),
        active: (editor) => editor.isActive("bulletList"),
        enabled: (editor) => editor.can().toggleBulletList(),
    },
    "ordered-list": {
        run: (editor) => editor.chain().focus().toggleOrderedList().run(),
        active: (editor) => editor.isActive("orderedList"),
        enabled: (editor) => editor.can().toggleOrderedList(),
    },
    "task-list": {
        run: (editor) => editor.chain().focus().toggleTaskList().run(),
        active: (editor) => editor.isActive("taskList"),
        enabled: (editor) => editor.can().toggleTaskList(),
    },
    quote: {
        run: (editor) => editor.chain().focus().toggleBlockquote().run(),
        active: (editor) => editor.isActive("blockquote"),
        enabled: (editor) => editor.can().toggleBlockquote(),
    },
    callout: {
        run: (editor) => (editor.isActive("callout") ? editor.chain().focus().unsetCallout() : editor.chain().focus().setCallout()).run(),
        active: (editor) => editor.isActive("callout"),
        enabled: (editor) => editor.isActive("callout") || editor.can().setCallout(),
    },
    "code-block": {
        run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
        active: (editor) => editor.isActive("codeBlock"),
        enabled: (editor) => editor.can().toggleCodeBlock(),
    },
    align: {
        run: (editor, args) => editor.chain().focus().setMarkdownAlign(args.value as "left" | "center" | "right" | "justify").run(),
        active: (editor) => editor.isActive("markdownAlign"),
        enabled: (editor) => editor.can().setMarkdownAlign("center"),
    },
    bilingual: {
        run: (editor, args) => editor.chain().focus().setMarkdownBilingual(text(args)).run(),
        active: (editor) => editor.isActive("markdownBilingual"),
        enabled: (editor) => editor.can().setMarkdownBilingual("x"),
    },
    divider: {
        run: (editor) => editor.chain().focus().setHorizontalRule().run(),
        enabled: (editor) => editor.can().setHorizontalRule(),
    },
    table: {
        run: (editor) => editor.chain().focus().insertTable({rows: 3, cols: 3, withHeaderRow: true}).run(),
        enabled: (editor) => editor.can().insertTable({rows: 3, cols: 3, withHeaderRow: true}),
    },
};

function heading(level: 1 | 2 | 3): EditingAction {
    return {
        run: (editor) => editor.chain().focus().setHeading({level}).run(),
        active: (editor) => editor.isActive("heading", {level}),
        enabled: (editor) => editor.can().setHeading({level}),
    };
}
