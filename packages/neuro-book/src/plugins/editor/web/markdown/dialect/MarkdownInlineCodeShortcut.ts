import {Extension} from "@tiptap/core";
import {Plugin, TextSelection} from "@tiptap/pm/state";
import type {EditorView} from "@tiptap/pm/view";

/**
 * Markdown 行内代码输入增强。
 * 补足 Tiptap 默认 Code input rule 没覆盖的两个 Markdown 编辑习惯：
 * 1. 选中文本后输入 `，直接把选区转成 inline code mark。
 * 2. 先在文字后输入 `，再回到文字前输入 `，也能把中间文本转成 inline code mark。
 */
export const MarkdownInlineCodeShortcut = Extension.create({
    name: "markdownInlineCodeShortcut",

    /**
     * 注册文本输入拦截；只处理反引号，其余输入交回 Tiptap 默认规则。
     */
    addProseMirrorPlugins() {
        return [
            new Plugin({
                props: {
                    handleTextInput: (view, from, to, text) => {
                        if (text !== "`") {
                            return false;
                        }
                        if (from !== to) {
                            return markSelectedTextAsCode(view, from, to);
                        }
                        return markTextBeforeNextBacktick(view, from);
                    },
                },
            }),
        ];
    },
});

/**
 * 选中文本后输入反引号时保留原文，并添加 code mark。
 */
function markSelectedTextAsCode(view: EditorView, from: number, to: number): boolean {
    const {$from, $to} = view.state.selection;
    if (!$from.sameParent($to) || $from.parent.type.spec.code) {
        return false;
    }
    const text = view.state.doc.textBetween(from, to, "\n");
    if (!isValidInlineCodeText(text)) {
        return false;
    }
    const codeMark = view.state.schema.marks.code;
    if (!codeMark) {
        return false;
    }
    const tr = view.state.tr.addMark(from, to, codeMark.create());
    tr.removeStoredMark(codeMark);
    tr.setSelection(TextSelection.create(tr.doc, from, to));
    view.dispatch(tr.scrollIntoView());
    return true;
}

/**
 * 在文字后已有反引号时，光标跳到文字前输入反引号也转成 code mark。
 */
function markTextBeforeNextBacktick(view: EditorView, from: number): boolean {
    const {$from} = view.state.selection;
    if ($from.parent.type.spec.code) {
        return false;
    }
    const textAfter = $from.parent.textBetween($from.parentOffset, $from.parent.content.size, "\n");
    const closingIndex = textAfter.indexOf("`");
    if (closingIndex <= 0) {
        return false;
    }
    const text = textAfter.slice(0, closingIndex);
    if (!isValidInlineCodeText(text)) {
        return false;
    }
    const codeMark = view.state.schema.marks.code;
    if (!codeMark) {
        return false;
    }
    const textTo = from + text.length;
    const closingBacktickTo = textTo + 1;
    const tr = view.state.tr.delete(textTo, closingBacktickTo);
    tr.addMark(from, textTo, codeMark.create());
    tr.removeStoredMark(codeMark);
    tr.setSelection(TextSelection.create(tr.doc, textTo));
    view.dispatch(tr.scrollIntoView());
    return true;
}

/**
 * inline code 只支持单反引号、单行、非空内容。
 */
function isValidInlineCodeText(text: string): boolean {
    return text.length > 0 && !text.includes("`") && !text.includes("\n");
}
