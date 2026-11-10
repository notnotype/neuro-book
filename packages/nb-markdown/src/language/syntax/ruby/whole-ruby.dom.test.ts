/**
 * 注音是一个整体（docs/specs/workbench/markdown-editing.md 输出 26）：格式只盖住一段注音的一部分时，整段注音一起改。真实语言与真实
 * Tiptap；入口有编辑动作、编辑内核自己的快捷键与命令，判据是写回的 Markdown。
 */
import {Editor} from "@tiptap/core";
import {TextSelection} from "@tiptap/pm/state";
import {afterEach, describe, expect, it} from "vitest";

import {markdownEditingActions} from "../../../editor/editing-actions";
import {codecFor} from "../../codec/codec";
import {defaultMarkdownLanguage} from "..";

const language = defaultMarkdownLanguage();
const editors: Editor[] = [];
afterEach(() => {
    for (const editor of editors.splice(0)) editor.destroy();
});

/**
 * 读入一段 Markdown；`select(from, to)` 按段落里的字算位置（0 是第一个字之前），与 ProseMirror 的位置差段落开头的 1。
 * 用例的原文都只有一段、没有行内节点，所以字的序号就是文字偏移。
 */
function open(markdown: string) {
    const element = document.createElement("div");
    document.body.append(element);
    const editor = new Editor({element, extensions: [...language.extensions]});
    editors.push(editor);
    const codec = codecFor(editor.schema, language);
    const read = codec.read(markdown);
    editor.commands.setContent(read.doc.toJSON());
    return {
        editor,
        select(from: number, to: number): void {
            editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from + 1, to + 1)));
        },
        write(): string {
            const written = codec.write(editor.state.doc, read.map);
            if (!written.ok) throw new Error(`写不出：${written.reason}`);
            return written.text.trim();
        },
    };
}

const act = (editor: Editor, id: string, args: Record<string, unknown> = {}): void => {
    const action = markdownEditingActions[id];
    if (action === undefined) throw new Error(`没有动作 ${id}`);
    expect(action.run(editor, args)).toBe(true);
};

// “前注音后”：注音盖住第 1、2 个字。
const SOURCE = "前<ruby text=\"zhù yīn\">注音</ruby>后\n";

describe("注音是一个整体", () => {
    it("从注音中间选到注音之后加粗：整段注音一起加粗，写回只有一个注音", () => {
        const {editor, select, write} = open(SOURCE);
        select(2, 4);
        act(editor, "bold");
        expect(write()).toBe("前**<ruby text=\"zhù yīn\">注音</ruby>后**");
    });

    it("编辑内核自己的快捷键也一样（Ctrl+B 不经编辑动作）", () => {
        const {editor, select, write} = open(SOURCE);
        select(2, 4);
        editor.commands.keyboardShortcut("Mod-b");
        expect(write()).toBe("前**<ruby text=\"zhù yīn\">注音</ruby>后**");
    });

    it("选区整个在注音里面：盖住整段注音", () => {
        const {editor, select, write} = open(SOURCE);
        select(2, 3);
        act(editor, "italic");
        expect(write()).toBe("前*<ruby text=\"zhù yīn\">注音</ruby>*后");
    });

    it("带属性的格式（文字颜色）同样扩到整段注音", () => {
        const {editor, select, write} = open(SOURCE);
        select(0, 2);
        act(editor, "text-color", {color: "#ef4444"});
        const written = write();
        expect(written.match(/<ruby/gu)).toHaveLength(1);
        expect(written).toMatch(/^<span style="color: #ef4444">前<ruby text="zhù yīn">注音<\/ruby><\/span>后$/u);
    });

    it("从注音中间去掉格式：整段注音一起去掉", () => {
        const {editor, select, write} = open("**前<ruby text=\"zhù yīn\">注音</ruby>后**\n");
        select(0, 2);
        act(editor, "bold");
        expect(write()).toBe("前<ruby text=\"zhù yīn\">注音</ruby>**后**");
    });

    it("清除格式只盖住注音一半：整段注音的格式都清掉，注音留着", () => {
        const {editor, select, write} = open("~~前<ruby text=\"zhù yīn\">注音</ruby>后~~\n");
        select(2, 4);
        act(editor, "clear-format");
        expect(write()).toBe("~~前~~<ruby text=\"zhù yīn\">注音</ruby>后");
    });

    it("新注音盖住旧注音的一半：整段旧注音换成新注音", () => {
        const {editor, select, write} = open(SOURCE);
        select(2, 4);
        act(editor, "ruby", {text: "x"});
        expect(write()).toBe("前<ruby text=\"x\">注音后</ruby>");
    });

    it("行内代码盖住注音一半：整段注音变成代码", () => {
        const {editor, select, write} = open(SOURCE);
        select(2, 4);
        act(editor, "code");
        expect(write()).toBe("前`注音后`");
    });

    it("一次撤销回到原样", () => {
        const {editor, select, write} = open(SOURCE);
        select(2, 4);
        act(editor, "bold");
        editor.commands.undo();
        expect(write()).toBe(SOURCE.trim());
    });

    it("不碰注音的格式照旧只盖选区", () => {
        const {editor, select, write} = open("前前<ruby text=\"zhù yīn\">注音</ruby>后\n");
        select(0, 1);
        act(editor, "bold");
        expect(write()).toBe("**前**前<ruby text=\"zhù yīn\">注音</ruby>后");
    });

    it("两段相邻的不同注音：只扩被盖住一半的那一段", () => {
        const {editor, select, write} = open("<ruby text=\"a\">甲乙</ruby><ruby text=\"b\">丙丁</ruby>\n");
        select(1, 2);
        act(editor, "bold");
        expect(write()).toBe("**<ruby text=\"a\">甲乙</ruby>**<ruby text=\"b\">丙丁</ruby>");
    });
});
