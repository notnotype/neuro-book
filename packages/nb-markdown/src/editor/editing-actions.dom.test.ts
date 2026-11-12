/** 编辑动作（docs/specs/workbench/markdown-editing.md）：真实语言与真实 Tiptap，按键走 ProseMirror 的 keymap。 */
import {Editor} from "@tiptap/core";
import {closeHistory} from "@tiptap/pm/history";
import {afterEach, describe, expect, it} from "vitest";

import {codecFor, defaultMarkdownLanguage} from "../language";
import {blockAt, selectBlockText} from "./block-actions";
import {listComments} from "./comments";
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

    it("从标题也能换成列表、引用与提示块", () => {
        for (const id of ["bullet-list", "ordered-list", "task-list", "quote", "callout", "code-block"]) {
            const {editor} = open("# 字\n");
            editor.commands.setTextSelection(2);
            expect(enabled(editor, id), id).toBe(true);
            expect(act(editor, id), id).toBe(true);
            expect(active(editor, id), id).toBe(true);
        }
    });

    it("全选后也能换块类型", () => {
        const {editor} = open("一\n\n二\n");
        editor.commands.selectAll();
        expect(enabled(editor, "bullet-list")).toBe(true);
    });

    it("表格单元格里不能换块类型", () => {
        const {editor} = open("| a |\n| --- |\n| b |\n");
        editor.commands.setTextSelection(3);
        expect(enabled(editor, "heading-1")).toBe(false);
        expect(enabled(editor, "bullet-list")).toBe(false);
        expect(enabled(editor, "bold")).toBe(true);
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

    // “前注音后”：注音盖住第 1、2 个字，ProseMirror 的位置比字的序号多 1。
    const RUBY = "前<ruby text=\"zhù yīn\">注音</ruby>后\n";

    it("选区里有注音（盖住一部分也算）时注音按下，没有时不按下", () => {
        const {editor} = open(RUBY);
        editor.commands.setTextSelection({from: 1, to: 3});
        expect(active(editor, "ruby")).toBe(true);
        editor.commands.setTextSelection({from: 1, to: 2});
        expect(active(editor, "ruby")).toBe(false);
        editor.commands.setTextSelection(3);
        expect(active(editor, "ruby")).toBe(true);
        // 光标在注音的边上不算在注音里。
        editor.commands.setTextSelection(4);
        expect(active(editor, "ruby")).toBe(false);
    });

    it("移除注音：选区盖住注音的一部分、或光标在注音中间，都整段去掉；没有注音时不可用", () => {
        for (const select of [{from: 1, to: 3}, 3] as const) {
            const {editor, write} = open(RUBY);
            editor.commands.setTextSelection(select);
            expect(enabled(editor, "ruby-remove")).toBe(true);
            expect(act(editor, "ruby-remove")).toBe(true);
            expect(write().trim()).toBe("前注音后");
            expect(enabled(editor, "ruby-remove")).toBe(false);
        }
        const {editor} = open("前注音后\n");
        editor.commands.selectAll();
        expect(enabled(editor, "ruby-remove")).toBe(false);
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

describe("批注（输出 28、29、34、35）", () => {
    const find = (editor: Editor, text: string): {from: number; to: number} => {
        let found: {from: number; to: number} | null = null;
        editor.state.doc.descendants((node, pos) => {
            const at = node.isText ? (node.text as string).indexOf(text) : -1;
            if (found === null && at >= 0) found = {from: pos + at, to: pos + at + text.length};
        });
        if (found === null) throw new Error(`找不到 ${text}`);
        return found;
    };

    it("加批注：选区里有字才可用；意见去掉首尾空白，空的不加；写回是行内批注", () => {
        const {editor, write} = open("甲乙丙\n");
        editor.commands.setTextSelection(2);
        expect(enabled(editor, "comment")).toBe(false);
        editor.commands.setTextSelection(find(editor, "乙"));
        expect(enabled(editor, "comment")).toBe(true);
        expect(act(editor, "comment", {text: "  \n "})).toBe(false);
        expect(write().trim()).toBe("甲乙丙");
        expect(act(editor, "comment", {text: " 意见 "})).toBe(true);
        expect(write().trim()).toBe("甲<comment body=\"意见\">乙</comment>丙");
    });

    it("选区在代码块里不可用；只选了空白不可用；选区跨了代码块与段落时只给段落那部分加", () => {
        const {editor, write} = open("甲乙\n\n```\ncode\n```\n");
        editor.commands.setTextSelection(find(editor, "code"));
        expect(enabled(editor, "comment")).toBe(false);
        // `can()` 在这里为真但文档不会变：动作自己判断，不用它。
        expect(editor.can().addComment("x")).toBe(true);
        expect(act(editor, "comment", {text: "x"})).toBe(false);
        expect(write()).not.toContain("<comment");
        const {editor: spaces} = open("甲  乙\n");
        spaces.commands.setTextSelection(find(spaces, "  "));
        expect(enabled(spaces, "comment")).toBe(false);
        editor.commands.setTextSelection({from: find(editor, "乙").from, to: find(editor, "code").to});
        expect(enabled(editor, "comment")).toBe(true);
        expect(act(editor, "comment", {text: "跨"})).toBe(true);
        expect(write()).toContain("<comment body=\"跨\">乙</comment>");
    });

    it("改意见与删除按卡片给的指纹：指纹不齐、对不上时不可用也不执行", () => {
        const {editor, write} = open("甲<comment body=\"一\">乙</comment>丙\n");
        const ref = {index: 0, body: "一", quote: "乙"};
        expect(markdownEditingActions["comment-edit"]?.enabled(editor, ref)).toBe(true);
        expect(markdownEditingActions["comment-edit"]?.enabled(editor, {index: 0, body: "旧", quote: "乙"})).toBe(false);
        expect(markdownEditingActions["comment-edit"]?.enabled(editor, {index: "0", body: "一", quote: "乙"})).toBe(false);
        expect(act(editor, "comment-edit", {...ref, text: "  "})).toBe(false);
        expect(act(editor, "comment-edit", {...ref, text: " 新 "})).toBe(true);
        expect(write().trim()).toBe("甲<comment body=\"新\">乙</comment>丙");
        expect(act(editor, "comment-delete", ref)).toBe(false);
        expect(act(editor, "comment-delete", {...ref, body: "新"})).toBe(true);
        expect(write().trim()).toBe("甲乙丙");
    });
});

describe("块菜单的批注（输出 28）", () => {
    /** 点块菜单的“批注”：文字块（段落、标题、列表项）选中自己的文字再走选区上加批注的动作，别的块按位置整块包起来。 */
    const comment = (editor: Editor, position: number, text: string): boolean => {
        const target = blockAt(editor.state.doc, position);
        if (target === null) return false;
        if (target.kind === "text" || target.kind === "list-item") return selectBlockText(editor, target) && enabled(editor, "comment") && act(editor, "comment", {text});
        return markdownEditingActions["comment-block"]?.enabled(editor, {pos: target.pos}) === true && act(editor, "comment-block", {pos: target.pos, text});
    };
    /** 写回再读回：块批注与行内批注都读得回来，而且只有一条。 */
    const reopened = (write: () => string): ReturnType<typeof listComments> => listComments(open(write()).editor.state.doc);

    it("段落、标题与列表项：给这一块自己的文字加一条行内批注，写回读回仍是一条", () => {
        const paragraph = open("甲乙\n\n丙\n");
        expect(comment(paragraph.editor, 1, "意见")).toBe(true);
        expect(paragraph.write()).toBe("<comment body=\"意见\">甲乙</comment>\n\n丙\n");
        expect(reopened(paragraph.write).map((info) => [info.block, info.body, info.quote])).toEqual([[false, "意见", "甲乙"]]);
        const heading = open("## 标题\n");
        expect(comment(heading.editor, 1, "意见")).toBe(true);
        expect(heading.write()).toContain("<comment body=\"意见\">标题</comment>");
        const flat = open("- 甲\n- 乙\n");
        expect(comment(flat.editor, 3, "意见")).toBe(true);
        expect(flat.write()).toBe("- <comment body=\"意见\">甲</comment>\n- 乙\n");
        // 带子项的列表项只算这一项自己的第一段，不含子项（写回时这个列表整块重写，项之间可能多一个空行，见输出 35 的已知行为）。
        const nested = open("- 甲\n  - 乙\n- 丙\n");
        expect(comment(nested.editor, 3, "意见")).toBe(true);
        expect(listComments(nested.editor.state.doc).map((info) => info.quote)).toEqual(["甲"]);
    });

    it("空的文字块不能加：选不出文字", () => {
        const {editor} = open("甲\n\n\n\n丙\n");
        const empty = blockAt(editor.state.doc, 3);
        expect(empty?.node.content.size).toBe(0);
        expect(empty !== null && selectBlockText(editor, empty)).toBe(false);
    });

    it.each([
        ["代码块", "```\ncode\n```\n"],
        ["引用", "> 引文\n> 第二行\n"],
        ["表格", "| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |\n"],
        ["分割线", "上\n\n---\n\n下\n"],
    ])("%s：整块包进一条块批注，写回读回仍是一条，撤销一步回到没有批注", (_name, source) => {
        const {editor, write} = open(source);
        editor.view.dispatch(closeHistory(editor.state.tr));
        const original = editor.state.doc;
        const block = [...Array(editor.state.doc.content.size).keys()].map((position) => blockAt(editor.state.doc, position)).find((target) => target !== null && target.kind !== "text");
        if (block === undefined || block === null) throw new Error("没有找到这一块");
        expect(comment(editor, block.pos, "整块的意见")).toBe(true);
        expect(listComments(editor.state.doc).map((info) => [info.block, info.body])).toEqual([[true, "整块的意见"]]);
        expect(reopened(write).map((info) => [info.block, info.body])).toEqual([[true, "整块的意见"]]);
        editor.commands.undo();
        expect(editor.state.doc.eq(original)).toBe(true);
    });

    it("意见去掉空白后为空不加，文档不变；位置上没有块时不可用也不执行", () => {
        const {editor} = open("```\ncode\n```\n");
        expect(act(editor, "comment-block", {pos: 0, text: "  "})).toBe(false);
        expect(listComments(editor.state.doc)).toEqual([]);
        expect(markdownEditingActions["comment-block"]?.enabled(editor, {pos: 999})).toBe(false);
        expect(markdownEditingActions["comment-block"]?.enabled(editor, {pos: "0"})).toBe(false);
        expect(act(editor, "comment-block", {pos: 999, text: "x"})).toBe(false);
    });
});
