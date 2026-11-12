/**
 * 注音是一个整体（docs/specs/workbench/markdown-editing.md 输出 26）：格式只盖住一段注音的一部分时，整段注音一起改。真实语言与真实
 * Tiptap；入口有编辑动作、编辑内核自己的快捷键与命令，判据是写回的 Markdown。
 */
import {Editor} from "@tiptap/core";
import {closeHistory} from "@tiptap/pm/history";
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

    it("去掉注音只盖住一半：整段注音去掉", () => {
        const {editor, select, write} = open(SOURCE);
        select(2, 4);
        editor.commands.unsetMarkdownRuby();
        expect(write()).toBe("前注音后");
    });

    it("改注音时保留原文的写法（`<rt>`）", () => {
        const {editor, select, write} = open("前<ruby>注音<rt>zhù yīn</rt></ruby>后\n");
        select(1, 3);
        act(editor, "ruby", {text: "x"});
        expect(write()).toBe("前<ruby>注音<rt>x</rt></ruby>后");
    });

    // 事务里有替换步时，标记步的位置与事务之前的文档不同（输入规则先删掉 `**`、再加粗）。
    it("同一个事务里先插入文字、再给注音的一半加粗：仍扩到整段注音", () => {
        const {editor, write} = open(SOURCE);
        // 插入“新”之后：新前注音后，注音盖住第 2、3 个字；选“音后”。
        editor.chain().insertContentAt(1, "新").setTextSelection({from: 4, to: 6}).toggleMark("bold").run();
        expect(write()).toBe("新前**<ruby text=\"zhù yīn\">注音</ruby>后**");
    });

    it("去掉一条批注时只扩它自己：盖在同一段注音上的另一条批注不受牵连", () => {
        const {editor, select} = open(SOURCE);
        select(0, 4);
        editor.commands.addComment("甲");
        select(1, 3);
        editor.commands.addComment("乙");
        const commentOf = (body: string) => editor.state.doc.firstChild!.child(1).marks.find((mark) => mark.attrs.body === body)!;
        // 从“音”去掉“甲”，只盖住注音的后一半。
        editor.view.dispatch(editor.state.tr.removeMark(3, 5, commentOf("甲")));
        const bodies = (text: string): string[] => {
            const bodiesOf: string[] = [];
            editor.state.doc.descendants((node) => {
                if (node.isText && node.text === text) bodiesOf.push(...node.marks.filter((mark) => mark.type.name === "comment").map((mark) => String(mark.attrs.body)));
            });
            return bodiesOf;
        };
        expect(bodies("注音")).toEqual(["乙"]);
    });

    it("同一个事务里先给注音的一半加粗、再在前面插入文字：按加粗那一步时的位置认注音", () => {
        const {editor, select, write} = open(SOURCE);
        select(2, 4);
        editor.chain().toggleMark("bold").insertContentAt(1, "新新").run();
        expect(write()).toBe("新新前**<ruby text=\"zhù yīn\">注音</ruby>后**");
    });

    it("撤销一整组改动（读入原文、打字、输入规则）不出错", () => {
        const {editor} = open(SOURCE);
        editor.view.dispatch(editor.state.tr.insertText(" **字*", editor.state.doc.content.size - 1));
        editor.commands.setTextSelection(editor.state.doc.content.size - 1);
        const {from, to} = editor.state.selection;
        editor.view.someProp("handleTextInput", (handle) => handle(editor.view, from, to, "*", () => editor.state.tr.insertText("*", from, to)));
        expect(() => editor.commands.undo()).not.toThrow();
        expect(editor.can().undo()).toBe(false);
    });

    it("经输入入口打 `**…**`：输入规则加上粗体，撤销回到原样", () => {
        const {editor, write} = open(SOURCE);
        // 原文 `**字*` 读进来已经是一个星号加斜体，所以直接放一段字面的文字；不进撤销历史，免得和输入规则并成一步。
        editor.view.dispatch(editor.state.tr.insertText(" **字*", editor.state.doc.content.size - 1).setMeta("addToHistory", false));
        editor.commands.setTextSelection(editor.state.doc.content.size - 1);
        // 读入原文那一步也在撤销历史里，与输入规则挨着会并成一组：先关上这一组，撤销只撤输入规则。
        editor.view.dispatch(closeHistory(editor.state.tr));
        const before = editor.state.doc.toJSON();
        const {from, to} = editor.state.selection;
        const handled = editor.view.someProp("handleTextInput", (handle) => handle(editor.view, from, to, "*", () => editor.state.tr.insertText("*", from, to)));
        expect(handled).toBe(true);
        expect(write()).toBe("前<ruby text=\"zhù yīn\">注音</ruby>后 **字**");
        editor.commands.undo();
        expect(editor.state.doc.toJSON()).toEqual(before);
    });

    it("两段相邻的不同注音：只扩被盖住一半的那一段", () => {
        const {editor, select, write} = open("<ruby text=\"a\">甲乙</ruby><ruby text=\"b\">丙丁</ruby>\n");
        select(1, 2);
        act(editor, "bold");
        expect(write()).toBe("**<ruby text=\"a\">甲乙</ruby>**<ruby text=\"b\">丙丁</ruby>");
    });
});
