/** 保持选区高亮（docs/specs/workbench/markdown-editing.md 输出 9）：真实语言与真实 Tiptap，判据是正文里画出来的那一段。 */
import {Editor} from "@tiptap/core";
import {undoDepth} from "@tiptap/pm/history";
import {afterEach, describe, expect, it} from "vitest";

import {codecFor, defaultMarkdownLanguage} from "../language";
import {HELD_SELECTION_CLASS, holdSelection, MarkdownHeldSelection, releaseSelection} from "./held-selection";

const editors: Editor[] = [];
afterEach(() => {
    for (const editor of editors.splice(0)) editor.destroy();
});

const language = defaultMarkdownLanguage();

function open(markdown: string): Editor {
    const element = document.createElement("div");
    document.body.append(element);
    const editor = new Editor({element, extensions: [...language.extensions, MarkdownHeldSelection]});
    editors.push(editor);
    editor.commands.setContent(codecFor(editor.schema, language).read(markdown).doc.toJSON());
    return editor;
}

const held = (editor: Editor): string[] => [...editor.view.dom.querySelectorAll(`.${HELD_SELECTION_CLASS}`)].map((element) => element.textContent ?? "");

describe("保持选区高亮", () => {
    it("画出选中的字，前面插入文字后跟着移动，撤掉后不再画", () => {
        const editor = open("林汐把缆绳绕在手上\n");
        // 选“缆绳”：段落从位置 1 开始。
        editor.commands.setTextSelection({from: 4, to: 6});
        expect(holdSelection(editor)).toBe(true);
        expect(held(editor)).toEqual(["缆绳"]);
        editor.commands.insertContentAt(1, "雾里，");
        expect(held(editor)).toEqual(["缆绳"]);
        releaseSelection(editor);
        expect(held(editor)).toEqual([]);
    });

    it("选区是空的时不画", () => {
        const editor = open("林汐\n");
        editor.commands.setTextSelection(2);
        expect(holdSelection(editor)).toBe(false);
        expect(held(editor)).toEqual([]);
    });

    it("画与撤掉都不进撤销历史", () => {
        const editor = open("林汐把缆绳绕在手上\n");
        editor.commands.setTextSelection({from: 4, to: 6});
        const depth = undoDepth(editor.state);
        holdSelection(editor);
        releaseSelection(editor);
        expect(undoDepth(editor.state)).toBe(depth);
    });
});
