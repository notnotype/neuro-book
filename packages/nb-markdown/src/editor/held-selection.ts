/**
 * 保持选区高亮（docs/specs/workbench/markdown-editing.md 输出 9）：焦点去了正文外面的输入框（注音卡片）时，浏览器不再画正文的选区，
 * 用户看不出要改的是哪几个字。宿主打开这类输入时把当前选区画成装饰，关上时撤掉。装饰随文档变化移动；换文档时编辑器的状态整个
 * 重建，插件状态回到空。只是装饰：不进撤销历史，也不改选区。
 */

import {Extension} from "@tiptap/core";
import type {Editor} from "@tiptap/core";
import {Plugin, PluginKey} from "@tiptap/pm/state";
import {Decoration, DecorationSet} from "@tiptap/pm/view";

type Hold = {readonly ranges: ReadonlyArray<{readonly from: number; readonly to: number}>} | "release";

const heldSelectionKey = new PluginKey<DecorationSet>("markdownHeldSelection");

export const HELD_SELECTION_CLASS = "nb-markdown-held-selection";

export const MarkdownHeldSelection = Extension.create({
    name: "markdownHeldSelection",
    addProseMirrorPlugins() {
        return [new Plugin<DecorationSet>({
            key: heldSelectionKey,
            state: {
                init: () => DecorationSet.empty,
                apply(tr, held) {
                    const hold = tr.getMeta(heldSelectionKey) as Hold | undefined;
                    if (hold === "release") return DecorationSet.empty;
                    if (hold !== undefined) return DecorationSet.create(tr.doc, hold.ranges.map(({from, to}) => Decoration.inline(from, to, {class: HELD_SELECTION_CLASS})));
                    return held.map(tr.mapping, tr.doc);
                },
            },
            props: {decorations: (state) => heldSelectionKey.getState(state)},
        })];
    },
});

/** 把此刻的选区画成高亮，直到 `releaseSelection`；选区是空的时什么都不画，返回 false。 */
export function holdSelection(editor: Editor): boolean {
    const {selection} = editor.state;
    if (selection.empty) return false;
    const ranges = selection.ranges.map((range) => ({from: range.$from.pos, to: range.$to.pos}));
    editor.view.dispatch(editor.state.tr.setMeta(heldSelectionKey, {ranges} satisfies Hold).setMeta("addToHistory", false));
    return true;
}

export function releaseSelection(editor: Editor): void {
    if (heldSelectionKey.getState(editor.state) === DecorationSet.empty) return;
    editor.view.dispatch(editor.state.tr.setMeta(heldSelectionKey, "release" satisfies Hold).setMeta("addToHistory", false));
}
