/** 斜杠的触发（docs/specs/workbench/markdown-editing.md 输出 10、13）：真实语言与真实 Tiptap。 */
import {Editor} from "@tiptap/core";
import {undoDepth} from "@tiptap/pm/history";
import {afterEach, describe, expect, it} from "vitest";

import {codecFor, defaultMarkdownLanguage} from "../language";
import {activeSlash, dismissSlash, MarkdownSlashTrigger, removeSlashQuery} from "./slash-trigger";

const editors: Editor[] = [];
afterEach(() => {
    for (const editor of editors.splice(0)) editor.destroy();
});
const language = defaultMarkdownLanguage();

function open(markdown: string): Editor {
    const element = document.createElement("div");
    document.body.append(element);
    const editor = new Editor({element, extensions: [...language.extensions, MarkdownSlashTrigger]});
    editors.push(editor);
    editor.commands.setContent(codecFor(editor.schema, language).read(markdown).doc.toJSON());
    return editor;
}
/** 光标放到第一个文本块末尾，打 `typed`。 */
function type(editor: Editor, typed: string): void {
    editor.commands.focus("start");
    let end = 1;
    editor.state.doc.descendants((node, pos) => {
        if (end === 1 && node.isTextblock) end = pos + 1 + node.content.size;
        return end === 1;
    });
    editor.commands.setTextSelection(end);
    for (const char of typed) editor.view.dispatch(editor.state.tr.insertText(char));
}

describe("斜杠的触发", () => {
    it.each([
        ["行首", "\n", "/", ""],
        ["行首带查询", "\n", "/bt", "bt"],
        ["空白之后", "字 \n", "/标", "标"],
        ["行首的顿号", "\n", "、标", "标"],
    ])("%s 打开", (_name, markdown, typed, query) => {
        const editor = open(markdown);
        type(editor, typed);
        expect(activeSlash(editor)?.query).toBe(query);
    });

    it.each([
        ["紧贴文字的斜杠", "字\n", "/"],
        ["中文标点之后的斜杠", "字，\n", "/"],
        ["行中的顿号", "字\n", "、"],
        ["查询里有空格", "\n", "/a b"],
    ])("%s 不打开", (_name, markdown, typed) => {
        const editor = open(markdown);
        type(editor, typed);
        expect(activeSlash(editor)).toBeNull();
    });

    it("代码块、表格单元格里不打开", () => {
        const code = open("```\nx\n```\n");
        type(code, " /");
        expect(activeSlash(code)).toBeNull();
        const table = open("| a |\n| --- |\n| b |\n");
        table.commands.setTextSelection(3);
        table.view.dispatch(table.state.tr.insertText(" /"));
        expect(activeSlash(table)).toBeNull();
    });

    it("收起后同一处不再打开，接着打字查询变了才打开", () => {
        const editor = open("\n");
        type(editor, "/");
        dismissSlash(editor);
        expect(activeSlash(editor)).toBeNull();
        editor.commands.setTextSelection(editor.state.selection.from);
        expect(activeSlash(editor)).toBeNull();
        editor.view.dispatch(editor.state.tr.insertText("b"));
        expect(activeSlash(editor)?.query).toBe("b");
    });

    it("删掉查询与打字分开：撤销一步回到 /查询", () => {
        const editor = open("\n");
        type(editor, "/bt");
        const depth = undoDepth(editor.state);
        removeSlashQuery(editor);
        expect(undoDepth(editor.state)).toBe(depth + 1);
        expect(editor.getText()).toBe("");
        editor.commands.undo();
        expect(editor.getText()).toBe("/bt");
    });
});
