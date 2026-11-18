/**
 * 编辑器里的表情补全与插入（docs/specs/agent/stickers.md 输出 41、42，workbench/markdown-editing.md 输出 62）：真实语言、真实 Tiptap 与
 * 编解码器，看触发、替换后写出的原文与撤销。
 */
import {Editor} from "@tiptap/core";
import {afterEach, describe, expect, it} from "vitest";

import {codecFor, defaultMarkdownLanguage} from "../language";
import {markdownEditingActions} from "./editing-actions";
import {activeSticker, canInsertSticker, dismissSticker, insertStickerAtTrigger, MarkdownStickerTrigger} from "./sticker-trigger";

const editors: Editor[] = [];
afterEach(() => {
    for (const editor of editors.splice(0)) editor.destroy();
});
const language = defaultMarkdownLanguage();

function open(markdown: string): {editor: Editor; write: () => string} {
    const element = document.createElement("div");
    document.body.append(element);
    const editor = new Editor({element, extensions: [...language.extensions, MarkdownStickerTrigger]});
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

/** 光标放到第一个文本块末尾，一个字一个字地打。 */
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

describe("`:` 的触发", () => {
    it.each([
        ["紧跟汉字", "写完啦\n", ":开", "开"],
        ["行首", "\n", ":kx", "kx"],
        ["空白之后、带包", "好 \n", ":lyra/", "lyra/"],
        ["标题里", "# 标题\n", ":开", "开"],
    ])("%s 打开", (_name, markdown, typed, query) => {
        const {editor} = open(markdown);
        type(editor, typed);
        expect(activeSticker(editor)?.query).toBe(query);
    });

    it.each([
        ["只有冒号", "\n", ":"],
        ["一个英文字母（颜文字）", "好的 \n", ":D"],
        ["紧跟英文字母", "abc\n", ":开"],
        ["紧跟数字（时间）", "10\n", ":30"],
        ["查询里有空格", "\n", ":开 心"],
    ])("%s 不打开", (_name, markdown, typed) => {
        const {editor} = open(markdown);
        type(editor, typed);
        expect(activeSticker(editor)).toBeNull();
    });

    it("代码块与行内代码里不打开", () => {
        const {editor: code} = open("```\nx\n```\n");
        type(code, ":开");
        expect(activeSticker(code)).toBeNull();
        const {editor: inline} = open("看 `code`\n");
        // 光标放进行内代码里打字。
        inline.commands.setTextSelection(6);
        for (const char of ":开") inline.view.dispatch(inline.state.tr.insertText(char));
        expect(activeSticker(inline)).toBeNull();
    });

    it("收起后这一处查询不变时不再打开，接着打字又打开", () => {
        const {editor} = open("写完啦\n");
        type(editor, ":开");
        dismissSticker(editor);
        expect(activeSticker(editor)).toBeNull();
        editor.view.dispatch(editor.state.tr.insertText("心"));
        expect(activeSticker(editor)?.query).toBe("开心");
    });
});

describe("插入", () => {
    it("确认补全：`:查询` 换成表情，写出写法原文，光标在表情后面；撤销一步回到 `:查询`", () => {
        const {editor, write} = open("写完啦\n");
        type(editor, ":开");
        expect(insertStickerAtTrigger(editor, ":lyra/开心:")).toBe(true);
        expect(write()).toBe("写完啦:lyra/开心:\n");
        editor.commands.undo();
        expect(write()).toBe("写完啦:开\n");
        editor.commands.redo();
        editor.view.dispatch(editor.state.tr.insertText("！"));
        expect(write()).toBe("写完啦:lyra/开心:！\n");
    });

    it("不是一个完整写法时不插（节点的原文一定是写法）", () => {
        const {editor, write} = open("写完啦\n");
        type(editor, ":开");
        expect(insertStickerAtTrigger(editor, "开心")).toBe(false);
        expect(insertStickerAtTrigger(editor, ":lyra/开心: ")).toBe(false);
        expect(markdownEditingActions.sticker?.run(editor, {text: "x"})).toBe(false);
        expect(write()).toBe("写完啦:开\n");
    });

    it("命令 sticker：插在光标处，有选区时替换；行内代码与代码块里不可用", () => {
        const {editor, write} = open("今天很开心\n");
        editor.commands.setTextSelection({from: 4, to: 6});
        expect(markdownEditingActions.sticker?.enabled(editor, {})).toBe(true);
        expect(markdownEditingActions.sticker?.run(editor, {text: ":lyra/开心:"})).toBe(true);
        expect(write()).toBe("今天很:lyra/开心:\n");
        const {editor: inline} = open("看 `code`\n");
        inline.commands.setTextSelection(6);
        expect(canInsertSticker(inline)).toBe(false);
        expect(markdownEditingActions.sticker?.run(inline, {text: ":lyra/开心:"})).toBe(false);
        const {editor: code} = open("```\nx\n```\n");
        code.commands.setTextSelection(2);
        expect(canInsertSticker(code)).toBe(false);
    });
});
