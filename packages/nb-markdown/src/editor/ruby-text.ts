/**
 * 点注音小字打开修改（docs/specs/workbench/markdown-editing.md 输出 9）：小字（`<rt>`）不在正文里，点它时浏览器放不下光标，
 * ProseMirror 也认不出点的是哪里。这里按它所在的 `<ruby>` 找到这段注音，选中整段；打开注音卡片归宿主。DOM 结构见
 * `language/syntax/ruby` 的 `renderHTML`。
 */

import {getMarkRange} from "@tiptap/core";
import type {Editor} from "@tiptap/core";
import {TextSelection} from "@tiptap/pm/state";

/** `target` 是这个编辑器里的注音小字时选中它那一段注音，返回 true；否则什么都不做，返回 false。 */
export function selectRubyAt(editor: Editor, target: EventTarget | null): boolean {
    const type = editor.schema.marks.markdownRuby;
    if (type === undefined || !(target instanceof Element)) return false;
    const text = target.closest(".nb-ruby-text");
    if (text === null || !editor.view.dom.contains(text)) return false;
    const base = text.parentElement?.querySelector(":scope > .nb-ruby-base");
    if (base === null || base === undefined) return false;
    const range = getMarkRange(editor.state.doc.resolve(editor.view.posAtDOM(base, 0)), type);
    if (range === undefined) return false;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, range.from, range.to)));
    return true;
}
