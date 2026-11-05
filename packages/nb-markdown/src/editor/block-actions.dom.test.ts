/** 块模型与块的操作（docs/specs/workbench/markdown-editing.md 的块模型表、输出 15、18、19）：真实语言与真实编解码器。 */
import {Editor} from "@tiptap/core";
import {undoDepth} from "@tiptap/pm/history";
import {afterEach, describe, expect, it} from "vitest";

import {codecFor, defaultMarkdownLanguage} from "../language";
import {blockAt, canConvertTo, deleteBlock, duplicateBlock, insertSlashBlock, moveBlock, removeSlashBlock, selectBlock, unwrapBlock} from "./block-actions";
import {markdownEditingActions} from "./editing-actions";

const editors: Editor[] = [];
afterEach(() => {
    for (const editor of editors.splice(0)) editor.destroy();
});
const language = defaultMarkdownLanguage();

function open(markdown: string) {
    const element = document.createElement("div");
    document.body.append(element);
    const editor = new Editor({element, extensions: [...language.extensions]});
    editors.push(editor);
    const codec = codecFor(editor.schema, language);
    const read = codec.read(markdown);
    editor.view.updateState(editor.state.apply(editor.state.tr.replaceWith(0, editor.state.doc.content.size, read.doc.content).setMeta("addToHistory", false)));
    const write = (): string => {
        const written = codec.write(editor.state.doc, read.map);
        if (!written.ok) throw new Error("写不出");
        return written.text;
    };
    return {editor, write};
}

/** 第一处 `text` 所在的位置。 */
function at(editor: Editor, text: string): number {
    let found = -1;
    editor.state.doc.descendants((node, pos) => {
        if (found < 0 && node.isText && node.text?.includes(text)) found = pos + (node.text.indexOf(text));
        return found < 0;
    });
    if (found < 0) throw new Error(`找不到 ${text}`);
    return found;
}
function select(editor: Editor, text: string) {
    const target = blockAt(editor.state.doc, at(editor, text));
    if (target === null) throw new Error("没有块");
    selectBlock(editor, target);
    return target;
}

describe("块模型", () => {
    it.each([
        ["段落", "一\n\n二\n", "二", "text", "paragraph"],
        ["标题", "# 一\n", "一", "text", "heading"],
        ["代码块", "```\n一\n```\n", "一", "code", "codeBlock"],
        ["列表项", "- 一\n- 二\n", "二", "list-item", "listItem"],
        ["嵌套的列表项", "- 一\n  - 二\n", "二", "list-item", "listItem"],
        ["任务项", "- [ ] 一\n", "一", "list-item", "taskItem"],
        ["引用里的第二段", "> 一\n>\n> 二\n", "二", "container", "blockquote"],
        ["提示块", "> [!NOTE]\n> 一\n", "一", "container", "callout"],
        ["表格", "| 一 |\n| --- |\n| 二 |\n", "二", "whole", "table"],
    ])("%s", (_name, markdown, text, kind, node) => {
        const {editor} = open(markdown);
        const target = blockAt(editor.state.doc, at(editor, text));
        expect(target?.kind).toBe(kind);
        expect(target?.node.type.name).toBe(node);
    });

    it("转换为的可用项按块模型表", () => {
        const list = open("- 一\n");
        select(list.editor, "一");
        expect(canConvertTo(list.editor.state, "heading-1")).toBe(true);
        expect(canConvertTo(list.editor.state, "ordered-list")).toBe(true);
        expect(canConvertTo(list.editor.state, "quote")).toBe(false);
        const quote = open("> 一\n");
        select(quote.editor, "一");
        expect(canConvertTo(quote.editor.state, "paragraph")).toBe(true);
        expect(canConvertTo(quote.editor.state, "heading-1")).toBe(false);
    });
});

describe("移动", () => {
    it("和相邻的块换位置，没动的块字节不变", () => {
        const {editor, write} = open("第一段  有两个空格\n\n第二段\n\n第三段\n");
        select(editor, "第三段");
        expect(moveBlock(editor, -1)).toBe(true);
        expect(write()).toBe("第一段  有两个空格\n\n第三段\n\n第二段\n");
    });

    it("到头时不动", () => {
        const {editor, write} = open("一\n\n二\n");
        select(editor, "一");
        expect(moveBlock(editor, -1)).toBe(false);
        expect(markdownEditingActions["block-up"]?.enabled(editor, {})).toBe(false);
        expect(markdownEditingActions["block-down"]?.enabled(editor, {})).toBe(true);
        expect(write()).toBe("一\n\n二\n");
    });

    it("列表项只在同一个列表里移动", () => {
        const {editor, write} = open("- 一\n- 二\n\n段落\n");
        select(editor, "二");
        expect(moveBlock(editor, -1)).toBe(true);
        expect(write()).toBe("- 二\n- 一\n\n段落\n");
        expect(moveBlock(editor, 1)).toBe(true);
        expect(moveBlock(editor, 1)).toBe(false);
    });
});

describe("副本与删除", () => {
    it("副本紧接在后面，带批注的块写回读得回来", () => {
        const {editor, write} = open('<comment body="看">一</comment>\n\n二\n');
        select(editor, "一");
        expect(duplicateBlock(editor)).toBe(true);
        const written = write();
        expect(written.match(/<comment/gu)?.length).toBe(2);
        const reread = codecFor(editor.schema, language).read(written);
        expect(reread.doc.childCount).toBe(3);
    });

    it("删掉列表唯一的一项时列表也没了", () => {
        const {editor} = open("- 一\n\n段落\n");
        select(editor, "一");
        expect(deleteBlock(editor)).toBe(true);
        expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
    });

    it("删掉唯一的一块时留一个空段落", () => {
        const {editor} = open("一\n");
        select(editor, "一");
        expect(deleteBlock(editor)).toBe(true);
        expect(editor.state.doc.childCount).toBe(1);
        expect(editor.getText()).toBe("");
    });
});

describe("解开", () => {
    it("列表项提出列表，列表从这里断开", () => {
        const {editor, write} = open("- 一\n- 二\n- 三\n");
        select(editor, "二");
        expect(unwrapBlock(editor)).toBe(true);
        expect(write()).toBe("- 一\n\n二\n\n- 三\n");
    });

    it("容器解开成里面的块", () => {
        const {editor} = open("> 一\n>\n> 二\n");
        select(editor, "一");
        expect(unwrapBlock(editor)).toBe(true);
        expect(editor.state.doc.child(0).type.name).toBe("paragraph");
        expect(editor.state.doc.childCount).toBe(2);
    });

    it("从列表项转成标题", () => {
        const {editor} = open("- 一\n");
        select(editor, "一");
        expect(markdownEditingActions["heading-1"]?.run(editor, {})).toBe(true);
        expect(editor.state.doc.firstChild?.type.name).toBe("heading");
    });
});

describe("+", () => {
    it("放弃时删掉这一块，文档不变，也不留撤销步骤", () => {
        const {editor, write} = open("一\n\n二\n");
        const before = write();
        const depth = undoDepth(editor.state);
        const target = select(editor, "一");
        const pos = insertSlashBlock(editor, target, "after");
        expect(editor.state.doc.childCount).toBe(3);
        expect(editor.state.doc.nodeAt(pos)?.textContent).toBe("/");
        removeSlashBlock(editor, pos);
        expect(write()).toBe(before);
        expect(undoDepth(editor.state)).toBe(depth);
    });

    it("放弃时这一块已经有别的字就不删", () => {
        const {editor} = open("一\n");
        const pos = insertSlashBlock(editor, select(editor, "一"), "after");
        editor.view.dispatch(editor.state.tr.insertText("x"));
        removeSlashBlock(editor, pos);
        expect(editor.state.doc.childCount).toBe(2);
    });

    it("在上方插入；列表里是新的一项", () => {
        const before = open("一\n");
        const pos = insertSlashBlock(before.editor, select(before.editor, "一"), "before");
        expect(pos).toBe(0);
        expect(before.editor.state.doc.firstChild?.textContent).toBe("/");
        const list = open("- 一\n");
        insertSlashBlock(list.editor, select(list.editor, "一"), "after");
        expect(list.editor.state.doc.firstChild?.childCount).toBe(2);
        expect(list.editor.state.selection.$from.parent.textContent).toBe("/");
    });
});
