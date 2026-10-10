/** 写作字数（docs/specs/workbench/editor.md 输出 27）。 */

import {describe, expect, it} from "bun:test";

import {countWords} from "./word-count";

describe("字数", () => {
    it("汉字、假名、谚文每字计 1；拉丁字母与数字连在一起算一个词，可夹撇号与连字符", () => {
        expect(countWords("他把灯放低一些。")).toBe(7);
        expect(countWords("ひらがなカタカナ한국어")).toBe(11);
        expect(countWords("Don't stop, well-known 2026 rain’s end")).toBe(6);
    });

    it("中文与数字、字母紧挨着时分开数", () => {
        expect(countWords("第3章写于2026年")).toBe(7);
        expect(countWords("用Monaco写")).toBe(3);
    });

    it("标点、空白与 Markdown 标记不计；开头的 frontmatter 不计，正文里的分隔线照常不计", () => {
        expect(countWords("# 标题\n\n- **加粗** 与 _斜体_\n\n> 引用")).toBe(9);
        expect(countWords("---\ntitle: 第三章\ntags: [a, b]\n---\n\n雨下了一整夜。")).toBe(6);
        expect(countWords("---\r\ntitle: x\r\n---\r\n雨")).toBe(1);
        expect(countWords("甲\n\n---\n\n乙")).toBe(2);
        expect(countWords("")).toBe(0);
    });
});
