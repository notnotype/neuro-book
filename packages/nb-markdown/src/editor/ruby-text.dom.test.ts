/** 点注音小字选中整段注音（docs/specs/workbench/markdown-editing.md 输出 9）：真实语言与真实 Tiptap 画出的 DOM。 */
import {Editor} from "@tiptap/core";
import {afterEach, describe, expect, it} from "vitest";

import {codecFor, defaultMarkdownLanguage} from "../language";
import {selectRubyAt} from "./ruby-text";

const editors: Editor[] = [];
afterEach(() => {
    for (const editor of editors.splice(0)) editor.destroy();
});

const language = defaultMarkdownLanguage();

function open(markdown: string): Editor {
    const element = document.createElement("div");
    document.body.append(element);
    const editor = new Editor({element, extensions: [...language.extensions]});
    editors.push(editor);
    editor.commands.setContent(codecFor(editor.schema, language).read(markdown).doc.toJSON());
    return editor;
}

const selected = (editor: Editor): string => editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to);

describe("点注音小字", () => {
    it("选中这一段注音；中间有一个字另带格式时也是一整段", () => {
        const editor = open("前<ruby text=\"lín xī\">林汐</ruby>后\n");
        // 在注音中间带着粗体打一个字（替换步，注音被切成几个文字节点，各画一份小字）。
        const ruby = editor.state.doc.nodeAt(2)?.marks.find((mark) => mark.type.name === "markdownRuby");
        if (ruby === undefined) throw new Error("读不出注音");
        editor.view.dispatch(editor.state.tr.insert(3, editor.schema.text("小", [editor.schema.marks.bold!.create(), ruby])));
        editor.commands.setTextSelection(1);
        const rubies = editor.view.dom.querySelectorAll(".nb-ruby-text");
        expect(rubies.length).toBeGreaterThan(1);
        expect(selectRubyAt(editor, rubies[rubies.length - 1] ?? null)).toBe(true);
        expect(selected(editor)).toBe("林小汐");
    });

    it("相邻的两段注音只选点的那一段", () => {
        const editor = open("<ruby text=\"a\">甲乙</ruby><ruby text=\"b\">丙丁</ruby>\n");
        const second = [...editor.view.dom.querySelectorAll(".nb-ruby-text")].find((element) => element.textContent === "b") ?? null;
        expect(selectRubyAt(editor, second)).toBe(true);
        expect(selected(editor)).toBe("丙丁");
    });

    it("点的不是注音小字时不动选区", () => {
        const editor = open("前<ruby text=\"lín xī\">林汐</ruby>后\n");
        editor.commands.setTextSelection(1);
        expect(selectRubyAt(editor, editor.view.dom.querySelector(".nb-ruby-base"))).toBe(false);
        expect(selectRubyAt(editor, null)).toBe(false);
        expect(editor.state.selection.empty).toBe(true);
    });
});
