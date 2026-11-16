/**
 * 批注卡片贴的那一行（docs/specs/workbench/markdown-editing.md 输出 30）：happy-dom 没有排版，`coordsAtPos` 与 `Range` 的盒子用桩喂
 * （桩的是浏览器的几何，选哪一行、哪个盒子的算法是真实的）。真实布局里的对齐在 `e2e/markdown-comments.e2e.ts` 里量。
 */
import {codecFor, defaultMarkdownLanguage} from "@notnotype/nb-markdown/language";
import {Editor} from "@tiptap/core";
import {EditorState} from "@tiptap/pm/state";
import {afterEach, describe, expect, it} from "vitest";

import {blockAnchor, commentLineAnchor} from "./selection-anchor";

const language = defaultMarkdownLanguage();
const cleanups: Array<() => void> = [];
afterEach(() => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

const box = (left: number, top: number, width: number, height: number): DOMRect => ({left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({})}) as DOMRect;

function setup(rects: ReadonlyArray<DOMRect>) {
    const element = document.createElement("div");
    document.body.append(element);
    const editor = new Editor({element, extensions: [...language.extensions]});
    editor.view.updateState(EditorState.create({doc: codecFor(editor.schema, language).read("甲乙丙丁戊\n").doc, plugins: editor.state.plugins}));
    // 光标那一行：垂直 100 到 120，光标在水平 200。
    editor.view.coordsAtPos = () => ({top: 100, bottom: 120, left: 200, right: 201});
    const original = Object.getOwnPropertyDescriptor(Range.prototype, "getClientRects");
    Object.defineProperty(Range.prototype, "getClientRects", {configurable: true, value: () => rects});
    cleanups.push(() => {
        if (original === undefined) Reflect.deleteProperty(Range.prototype, "getClientRects");
        else Object.defineProperty(Range.prototype, "getClientRects", original);
        editor.destroy();
        element.remove();
    });
    return editor;
}

describe("commentLineAnchor", () => {
    it("上下沿是光标所在那一行，左边取这条批注的文字在这一行最靠左的盒子", () => {
        const editor = setup([box(80, 100, 20, 20), box(130, 100, 20, 20)]);
        const rect = commentLineAnchor(editor, null, () => 4, () => [{from: 1, to: 5}]).getBoundingClientRect();
        expect([rect.left, rect.top, rect.height, rect.width]).toEqual([80, 100, 20, 0]);
    });

    it("别的行上的盒子、比一行高得多的盒子（块的外框，左边是版心左缘）都不算", () => {
        const editor = setup([box(10, 140, 100, 20), box(10, 100, 300, 200), box(90, 100, 20, 20)]);
        const rect = commentLineAnchor(editor, null, () => 4, () => [{from: 1, to: 5}]).getBoundingClientRect();
        expect(rect.left).toBe(90);
    });

    it("重叠的几条取最左的；这一行上没有这段文字时用光标自己的位置", () => {
        const editor = setup([box(95, 100, 20, 20)]);
        expect(commentLineAnchor(editor, null, () => 4, () => [{from: 1, to: 3}, {from: 3, to: 5}]).getBoundingClientRect().left).toBe(95);
        const none = setup([box(10, 300, 20, 20)]);
        expect(commentLineAnchor(none, null, () => 4, () => [{from: 1, to: 5}]).getBoundingClientRect().left).toBe(200);
    });

    it("位置或范围超出文档（换文档之后）夹在文档里，不抛错", () => {
        const editor = setup([]);
        expect(() => commentLineAnchor(editor, null, () => 4, () => [{from: -5, to: 9999}]).getBoundingClientRect()).not.toThrow();
    });
});

describe("blockAnchor", () => {
    it("块的左缘、块顶上一行高的地方；块不在时给空矩形", () => {
        const editor = setup([]);
        const dom = editor.view.dom.firstElementChild as HTMLElement;
        dom.getBoundingClientRect = () => box(40, 60, 500, 300);
        dom.style.lineHeight = "30px";
        const rect = blockAnchor(editor, null, () => 0).getBoundingClientRect();
        expect([rect.left, rect.top, rect.height]).toEqual([40, 60, 30]);
        expect(blockAnchor(editor, null, () => 9999).getBoundingClientRect().height).toBe(0);
    });
});
