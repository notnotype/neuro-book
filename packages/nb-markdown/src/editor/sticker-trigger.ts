/**
 * 编辑器里的表情补全与插入（docs/specs/agent/stickers.md 输出 41、42，workbench/markdown-editing.md 输出 62）：打 `:` 的触发状态
 * （照斜杠菜单，`createTriggerPlugin`），确认补全时把 `:查询` 换成表情节点，选择器选定时在光标处插入。节点的原文一定是一个完整写法
 * （同读法与输入规则），所以两种插入都先核对写法。
 *
 * 触发的边界：`:` 在开头、或前一个字不是 ASCII 字母与数字；查询至少 1 个字、没有空白与 `:`，只有 1 个英文字母时不算。能放表情的
 * 文本块里才算（代码块、原样块放不了），行内代码里不算；是否在组字由宿主看视图判断。
 */

import {Extension} from "@tiptap/core";
import type {Editor} from "@tiptap/core";
import {closeHistory} from "@tiptap/pm/history";
import type {NodeType} from "@tiptap/pm/model";
import {PluginKey, TextSelection} from "@tiptap/pm/state";
import type {EditorState} from "@tiptap/pm/state";

import {STICKER_NODE} from "../language/syntax/sticker";
import {parseSticker} from "../stickers";
import {createTriggerPlugin, DISMISS_TRIGGER} from "../trigger/trigger-plugin";
import type {TriggerState} from "../trigger/trigger-plugin";

export interface StickerMatch {
    /** `:` 的位置。 */
    readonly from: number;
    /** 光标位置，确认时替换 [from, to)。 */
    readonly to: number;
    readonly query: string;
}

export const markdownStickerKey = new PluginKey<TriggerState<StickerMatch>>("markdownStickerTrigger");

/** 行内原子节点在匹配里读成这个字符：查询里不能跨过它。 */
const ATOM = "￼";

const stickerType = (state: EditorState): NodeType | undefined => state.schema.nodes[STICKER_NODE];

/** 光标或选区处能不能放一个表情：可写、同一个文本块、这个块收得下表情节点、不在行内代码里。 */
function canPlaceSticker(state: EditorState): boolean {
    const type = stickerType(state);
    const {$from, $to, empty, from, to} = state.selection;
    if (type === undefined || !$from.sameParent($to) || !$from.parent.inlineContent || !$from.parent.canReplaceWith($from.index(), $to.index(), type)) return false;
    const code = state.schema.marks.code;
    if (code === undefined) return true;
    return empty ? code.isInSet(state.storedMarks ?? $from.marks()) === undefined : !state.doc.rangeHasMark(from, to, code);
}

function readSticker(state: EditorState): StickerMatch | null {
    const {selection} = state;
    if (!selection.empty || !(selection instanceof TextSelection) || !canPlaceSticker(state)) return null;
    const {$from} = selection;
    const before = $from.parent.textBetween(0, $from.parentOffset, undefined, ATOM);
    const colon = before.lastIndexOf(":");
    if (colon < 0) return null;
    const query = before.slice(colon + 1);
    if (query.length === 0 || /[\s￼]/u.test(query) || /^[A-Za-z]$/u.test(query)) return null;
    if (colon > 0 && /[A-Za-z0-9]/u.test(before.charAt(colon - 1))) return null;
    return {from: $from.pos - query.length - 1, to: $from.pos, query};
}

export const MarkdownStickerTrigger = Extension.create({
    name: "markdownStickerTrigger",
    addProseMirrorPlugins() {
        const editor = this.editor;
        return [createTriggerPlugin(markdownStickerKey, (state) => (editor.isEditable ? readSticker(state) : null))];
    },
});

/** 此刻的触发；没有为 null。 */
export function activeSticker(editor: Editor): StickerMatch | null {
    return markdownStickerKey.getState(editor.state)?.active ?? null;
}

/** 收起：这一处查询不变时不再打开。 */
export function dismissSticker(editor: Editor): void {
    editor.view.dispatch(editor.state.tr.setMeta(markdownStickerKey, DISMISS_TRIGGER));
}

/** 能不能在光标处插入表情（选择器的按钮置灰用）。 */
export function canInsertSticker(editor: Editor): boolean {
    return editor.isEditable && canPlaceSticker(editor.state);
}

/** `raw` 是不是一个完整写法；节点只收完整写法。 */
const isWriting = (raw: string): boolean => {
    const ref = parseSticker(raw);
    return ref !== null && ref.raw === raw;
};

/** 选择器选定：在光标处插入（有选区时替换），光标落在表情后面。不是完整写法、此处放不了时返回 false。 */
export function insertSticker(editor: Editor, raw: string): boolean {
    const type = stickerType(editor.state);
    if (type === undefined || !isWriting(raw) || !canInsertSticker(editor)) return false;
    // 不继承光标处的标记：行内代码已排除，粗体、颜色这些对图片没有意义，写出时也不必为它拆开标记。
    editor.view.dispatch(editor.state.tr.replaceSelectionWith(type.create({raw}), false).scrollIntoView());
    editor.view.focus();
    return true;
}

/** 确认补全：把 `:查询` 换成表情节点。`closeHistory` 把它和打字分开，撤销一步回到 `:查询`。 */
export function insertStickerAtTrigger(editor: Editor, raw: string): boolean {
    const match = activeSticker(editor);
    const type = stickerType(editor.state);
    if (match === null || type === undefined || !isWriting(raw)) return false;
    const tr = closeHistory(editor.state.tr).replaceWith(match.from, match.to, type.create({raw}));
    tr.setSelection(TextSelection.create(tr.doc, match.from + 1));
    editor.view.dispatch(tr.scrollIntoView());
    return true;
}
