/**
 * Markdown 编辑器的编辑动作（docs/specs/workbench/markdown-editing.md）：纯 Tiptap，不认识工作台。命令、公开键与菜单归宿主，
 * 宿主按 `id` 调这里；`active`、`enabled` 只读编辑状态，`enabled` 用 `editor.can()` 在事务副本上试跑。
 */

import type {Editor} from "@tiptap/core";
import {NodeSelection} from "@tiptap/pm/state";

import {canMoveBlock, deleteBlock, duplicateBlock, moveBlock, selectedBlock, unwrapBlock} from "./block-actions";
import {addBlockComment, canCommentBlockAt, findComment, removeComment, setCommentBody} from "./comments";
import type {CommentRef} from "./comments";
import {requestProperties} from "./frontmatter";

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
 * 选区里有没有注音（输出 9：有就按下注音按钮、可以移除）：盖住一部分也算，不用 `isActive`，它要整个选区都在注音里。
 * 光标在一段注音中间时也算。
 */
function hasRuby(editor: Editor): boolean {
    const type = editor.schema.marks.markdownRuby;
    if (type === undefined) return false;
    const {selection} = editor.state;
    if (selection.empty) return type.isInSet(selection.$from.marks()) !== undefined;
    return selection.ranges.some((range) => editor.state.doc.rangeHasMark(range.$from.pos, range.$to.pos, type));
}

/**
 * 选区里有没有能加批注的文字（输出 28）：有非空白的文字，且碰到的文本块里至少有一个允许批注标记（代码块、原样块不允许）。不用
 * `editor.can().addComment`：选区在代码块里时 `can()` 也为真，`addMark` 对不允许的节点静默跳过，命令照样返回成功、文档不变。
 */
function canComment(editor: Editor): boolean {
    const type = editor.schema.marks.comment;
    const {from, to, empty} = editor.state.selection;
    if (type === undefined || empty || editor.state.doc.textBetween(from, to, "", "").trim() === "") return false;
    let allowed = false;
    editor.state.doc.nodesBetween(from, to, (node) => {
        allowed ||= node.isTextblock && node.type.allowsMarkType(type);
        return !allowed;
    });
    return allowed;
}

/** 块菜单给的块位置；不是非负整数时为 null。 */
function blockPosition(args: EditingArgs): number | null {
    const {pos} = args;
    return typeof pos === "number" && Number.isInteger(pos) && pos >= 0 ? pos : null;
}

/** 卡片给的批注指纹（序号、意见、开头文字）；不齐全时为 null。 */
function commentRef(args: EditingArgs): CommentRef | null {
    const {index, body, quote} = args;
    return typeof index === "number" && Number.isInteger(index) && index >= 0 && typeof body === "string" && typeof quote === "string" ? {index, body, quote} : null;
}

/**
 * 块类型能不能换。不用 `editor.can()`：Tiptap 的 `toggleList` 与 `setNode` 先 `clearNodes` 再转换，`can()` 下 `clearNodes`
 * 不改文档，后面的转换按没清过的文档判断，从标题换列表时得到假。这里按光标所在的块判断：原样块是原文，表格单元格只放行内内容。
 */
function canConvertBlock(editor: Editor): boolean {
    const {$from} = editor.state.selection;
    // 全选（Ctrl+A）的选区落在文档这一层，不在哪一块里：照常能换。节点选区（块菜单选中的容器、分割线）的转换归块菜单。
    if (editor.state.selection instanceof NodeSelection) return false;
    if ($from.depth === 0) return true;
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
        active: hasRuby,
        enabled: (editor) => !editor.state.selection.empty && editor.can().setMarkdownRuby("x"),
    },
    // 加批注：按文档是不是真的变了返回，选区跨了不允许批注的块时不会成功却关掉卡片。
    comment: {
        run: (editor, args) => {
            const body = text(args).trim();
            if (body === "") return false;
            const before = editor.state.doc;
            return editor.chain().focus().addComment(body).run() && editor.state.doc !== before;
        },
        enabled: canComment,
    },
    // 块菜单的“批注”给整块加批注（输出 28）：卡片调用的内部动作，参数是块的位置与意见；不看选区。
    "comment-block": {
        run: (editor, args) => {
            const pos = blockPosition(args);
            return pos !== null && addBlockComment(editor, pos, text(args).trim());
        },
        enabled: (editor, args) => {
            const pos = blockPosition(args);
            return pos !== null && canCommentBlockAt(editor.state.doc, pos);
        },
    },
    // 改意见与删除是卡片调用的内部动作，不在动作目录里（输出 29、34、35）：参数是卡片显示时记下的批注指纹，在最新的文档里核对。
    "comment-edit": {
        run: (editor, args) => {
            const ref = commentRef(args);
            const body = text(args).trim();
            return ref !== null && body !== "" && setCommentBody(editor, ref, body);
        },
        enabled: (editor, args) => {
            const ref = commentRef(args);
            return ref !== null && findComment(editor.state.doc, ref) !== null;
        },
    },
    "comment-delete": {
        run: (editor, args) => {
            const ref = commentRef(args);
            return ref !== null && removeComment(editor, ref);
        },
        enabled: (editor, args) => {
            const ref = commentRef(args);
            return ref !== null && findComment(editor.state.doc, ref) !== null;
        },
    },
    // 只盖住一段注音的一部分时整段去掉（`whole-ruby.ts`）；光标在注音中间时去掉这一段。
    "ruby-remove": {
        run: (editor) => editor.chain().focus().unsetMark("markdownRuby", {extendEmptyMarkRange: true}).run(),
        enabled: hasRuby,
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
        // 取消提示块走解开：标题不丢。
        run: (editor) => (editor.isActive("callout") ? unwrapBlock(editor) && editor.commands.focus() : editor.chain().focus().setCallout().run()),
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
    // 新建 frontmatter 或展开属性面板（输出 48）：随时可用，焦点由宿主交给面板。
    properties: {run: (editor) => requestProperties(editor), enabled: (editor) => editor.isEditable},
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
