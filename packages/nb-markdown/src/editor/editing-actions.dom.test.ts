/** 编辑动作（docs/specs/workbench/markdown-editing.md）：真实语言与真实 Tiptap，按键走 ProseMirror 的 keymap。 */
import {Editor} from "@tiptap/core";
import {afterEach, describe, expect, it} from "vitest";

import {codecFor, defaultMarkdownLanguage} from "../language";
import {markdownEditingActions} from "./editing-actions";

const editors: Editor[] = [];
afterEach(() => {
    for (const editor of editors.splice(0)) editor.destroy();
});

const language = defaultMarkdownLanguage();

function open(markdown: string): {editor: Editor; write: () => string} {
    const element = document.createElement("div");
    document.body.append(element);
    const editor = new Editor({element, extensions: [...language.extensions]});
    editors.push(editor);
    const codec = codecFor(editor.schema, language);
    const read = codec.read(markdown);
    editor.commands.setContent(read.doc.toJSON());
    return {editor, write: () => {
        const written = codec.write(editor.state.doc, read.map);
        if (!written.ok) throw new Error("写不出");
        return written.text;
    }};
}

const act = (editor: Editor, id: string, args: Record<string, unknown> = {}): boolean => {
    const action = markdownEditingActions[id];
    if (action === undefined) throw new Error(`没有动作 ${id}`);
    return action.run(editor, args);
};
const enabled = (editor: Editor, id: string): boolean => markdownEditingActions[id]?.enabled(editor, {}) === true;
const active = (editor: Editor, id: string): boolean => markdownEditingActions[id]?.active?.(editor) === true;

describe("编辑动作", () => {
    it.each([
        ["bold", "**字**"],
        ["italic", "*字*"],
        ["strike", "~~字~~"],
        ["code", "`字`"],
    ])("%s 给选区加上标记，再做一次去掉", (id, written) => {
        const {editor, write} = open("字\n");
        editor.commands.selectAll();
        expect(act(editor, id)).toBe(true);
        expect(active(editor, id)).toBe(true);
        expect(write().trim()).toBe(written);
        act(editor, id);
        expect(active(editor, id)).toBe(false);
        expect(write().trim()).toBe("字");
    });

    it("块类型互换，勾选状态跟着变", () => {
        const {editor} = open("字\n");
        act(editor, "heading-2");
        expect(active(editor, "heading-2")).toBe(true);
        expect(active(editor, "paragraph")).toBe(false);
        act(editor, "bullet-list");
        expect(active(editor, "bullet-list")).toBe(true);
        act(editor, "paragraph");
        expect(active(editor, "paragraph")).toBe(true);
    });

    it("光标在代码块里时格式动作不可用", () => {
        const {editor} = open("```\ncode\n```\n");
        editor.commands.selectAll();
        expect(enabled(editor, "bold")).toBe(false);
        expect(enabled(editor, "text-color")).toBe(false);
    });

    it("清除格式移除格式标记，留下批注与注音", () => {
        const {editor, write} = open('**粗**<comment body="看这里">批注</comment><ruby text="zhù">注</ruby>\n');
        editor.commands.selectAll();
        act(editor, "clear-format");
        expect(active(editor, "bold")).toBe(false);
        const written = write();
        expect(written).not.toContain("**");
        expect(written).toContain("<comment");
        expect(written).toContain("<ruby");
    });

    it("文字颜色写回方言，传 null 去掉", () => {
        const {editor, write} = open("字\n");
        editor.commands.selectAll();
        act(editor, "text-color", {color: "#ef4444"});
        expect(write()).toContain("color: #ef4444");
        act(editor, "text-color", {color: null});
        expect(write().trim()).toBe("字");
    });

    it("注音没有选区时不可用", () => {
        const {editor} = open("字\n");
        expect(enabled(editor, "ruby")).toBe(false);
        editor.commands.selectAll();
        expect(enabled(editor, "ruby")).toBe(true);
    });

    // 菜单上写的快捷键（docs/specs/workbench/markdown-editing.md 的命令表）要真的管用：键位在 Tiptap 里，这里核对两边一致。
    it.each([
        ["bold", {key: "b", ctrlKey: true}],
        ["italic", {key: "i", ctrlKey: true}],
        ["strike", {key: "s", ctrlKey: true, shiftKey: true}],
        ["code", {key: "e", ctrlKey: true}],
        ["heading-1", {key: "1", ctrlKey: true, altKey: true}],
        ["heading-2", {key: "2", ctrlKey: true, altKey: true}],
        ["heading-3", {key: "3", ctrlKey: true, altKey: true}],
        ["bullet-list", {key: "8", ctrlKey: true, shiftKey: true}],
        ["ordered-list", {key: "7", ctrlKey: true, shiftKey: true}],
        ["task-list", {key: "9", ctrlKey: true, shiftKey: true}],
        ["quote", {key: "b", ctrlKey: true, shiftKey: true}],
        ["code-block", {key: "c", ctrlKey: true, altKey: true}],
    ])("%s 的快捷键生效", (id, init) => {
        const {editor} = open("字\n");
        editor.commands.selectAll();
        editor.view.someProp("handleKeyDown", (handler) => handler(editor.view, new KeyboardEvent("keydown", {...init, bubbles: true})));
        expect(active(editor, id)).toBe(true);
    });
});
