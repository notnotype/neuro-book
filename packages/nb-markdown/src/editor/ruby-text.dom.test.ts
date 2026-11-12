/** 点注音小字选中整段注音、卡片预填的读音（docs/specs/workbench/markdown-editing.md 输出 9）：真实语言与真实 Tiptap 画出的 DOM。 */
import {Editor} from "@tiptap/core";
import {afterEach, describe, expect, it} from "vitest";

import {codecFor, defaultMarkdownLanguage} from "../language";
import {selectedRubyText, selectRubyAt} from "./ruby-text";

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

describe("卡片预填的读音", () => {
    it("选区盖住一段注音（只盖一部分也算）、光标在注音中间：是这段的读音；碰不到注音：null", () => {
        const editor = open("前<ruby text=\"lín xī\">林汐</ruby>后\n");
        editor.commands.setTextSelection({from: 1, to: 3});
        expect(selectedRubyText(editor)).toBe("lín xī");
        editor.commands.setTextSelection(3);
        expect(selectedRubyText(editor)).toBe("lín xī");
        editor.commands.setTextSelection({from: 4, to: 5});
        expect(selectedRubyText(editor)).toBeNull();
    });

    it("碰到几段注音：读音都相同时是这个读音，有不同的读音时是 null（不拿其中一段的去覆盖全部）", () => {
        const same = open("<ruby text=\"lín\">林</ruby>和<ruby text=\"lín\">霖</ruby>\n");
        same.commands.selectAll();
        expect(selectedRubyText(same)).toBe("lín");
        const different = open("<ruby text=\"a\">甲</ruby>和<ruby text=\"b\">乙</ruby>\n");
        different.commands.selectAll();
        expect(selectedRubyText(different)).toBeNull();
    });
});
