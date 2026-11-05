/**
 * Markdown 编辑器的编辑动作（docs/specs/workbench/markdown-editing.md）：纯 Tiptap，不认识工作台。命令、公开键与菜单归宿主，
 * 宿主按 `id` 调这里；`active`、`enabled` 只读编辑状态，`enabled` 用 `editor.can()` 在事务副本上试跑。
 */

import type {Editor} from "@tiptap/core";

import {canMoveBlock, deleteBlock, duplicateBlock, moveBlock, selectedBlock, unwrapBlock} from "./block-actions";

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

/**
 * 块类型能不能换。不用 `editor.can()`：Tiptap 的 `toggleList` 与 `setNode` 先 `clearNodes` 再转换，`can()` 下 `clearNodes`
 * 不改文档，后面的转换按没清过的文档判断，从标题换列表时得到假。这里按光标所在的块判断：原样块是原文，表格单元格只放行内内容。
 */
function canConvertBlock(editor: Editor): boolean {
    const {$from} = editor.state.selection;
    if (!$from.parent.isTextblock || $from.parent.type.name === "rawBlock") return false;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
        if ($from.node(depth).type.spec.tableRole !== undefined) return false;
    }
    return true;
}

export const markdownEditingActions: Readonly<Record<string, EditingAction>> = {
    undo: {run: (editor) => editor.chain().focus().undo().run(), enabled: (editor) => editor.can().undo()},
    redo: {run: (editor) => editor.chain().focus().redo().run(), enabled: (editor) => editor.can().redo()},
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
        enabled: canConvertBlock,
    },
    "heading-1": heading(1),
    "heading-2": heading(2),
    "heading-3": heading(3),
    "bullet-list": {
        run: (editor) => editor.chain().focus().toggleBulletList().run(),
        active: (editor) => editor.isActive("bulletList"),
        enabled: canConvertBlock,
    },
    "ordered-list": {
        run: (editor) => editor.chain().focus().toggleOrderedList().run(),
        active: (editor) => editor.isActive("orderedList"),
        enabled: canConvertBlock,
    },
    "task-list": {
        run: (editor) => editor.chain().focus().toggleTaskList().run(),
        active: (editor) => editor.isActive("taskList"),
        enabled: canConvertBlock,
    },
    quote: {
        run: (editor) => editor.chain().focus().toggleBlockquote().run(),
        active: (editor) => editor.isActive("blockquote"),
        enabled: canConvertBlock,
    },
    callout: {
        run: (editor) => (editor.isActive("callout") ? editor.chain().focus().unsetCallout() : editor.chain().focus().setCallout()).run(),
        active: (editor) => editor.isActive("callout"),
        enabled: canConvertBlock,
    },
    "code-block": {
        run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
        active: (editor) => editor.isActive("codeBlock"),
        enabled: canConvertBlock,
    },
    align: {
        run: (editor, args) => editor.chain().focus().setMarkdownAlign(args.value as "left" | "center" | "right" | "justify").run(),
        active: (editor) => editor.isActive("markdownAlign"),
        enabled: canConvertBlock,
    },
    bilingual: {
        run: (editor, args) => editor.chain().focus().setMarkdownBilingual(text(args)).run(),
        active: (editor) => editor.isActive("markdownBilingual"),
        enabled: canConvertBlock,
    },
    divider: {
        run: (editor) => editor.chain().focus().setHorizontalRule().run(),
        enabled: (editor) => editor.can().setHorizontalRule(),
    },
    table: {
        run: (editor) => editor.chain().focus().insertTable({rows: 3, cols: 3, withHeaderRow: true}).run(),
        enabled: (editor) => editor.can().insertTable({rows: 3, cols: 3, withHeaderRow: true}),
    },
    "block-up": {run: (editor) => moveBlock(editor, -1), enabled: (editor) => canMoveBlock(editor.state, -1)},
    "block-down": {run: (editor) => moveBlock(editor, 1), enabled: (editor) => canMoveBlock(editor.state, 1)},
    "block-duplicate": {run: duplicateBlock, enabled: (editor) => selectedBlock(editor.state) !== null},
    "block-delete": {run: deleteBlock, enabled: (editor) => selectedBlock(editor.state) !== null},
    "block-unwrap": {
        run: unwrapBlock,
        enabled: (editor) => {
            const kind = selectedBlock(editor.state)?.kind;
            return kind === "list-item" || kind === "container";
        },
    },
};

function heading(level: 1 | 2 | 3): EditingAction {
    return {
        run: (editor) => editor.chain().focus().setHeading({level}).run(),
        active: (editor) => editor.isActive("heading", {level}),
        enabled: canConvertBlock,
    };
}
