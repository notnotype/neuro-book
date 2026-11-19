/**
 * 存档的断行（docs/specs/web/tools.md 输出 6）：超过上限的行在上限以内最近的句末标点或空白处断开，没有就硬断；硬断不切开非 BMP
 * 字。断出来的每段接起来就是原文。
 */

import {describe, expect, it} from "bun:test";

import {wrapLongLines} from "./backend/tools";

describe("存档的断行（输出 6）", () => {
    it("在上限以内最近的句末标点或空白后断开；没有就在上限处硬断；接起来是原文", () => {
        const punctuated = `${"甲".repeat(6)}。${"乙".repeat(6)}`;
        expect(wrapLongLines(punctuated, 10).split("\n")).toEqual([`${"甲".repeat(6)}。`, "乙".repeat(6)]);
        const spaced = "aaaa bbbb cccc";
        expect(wrapLongLines(spaced, 10).split("\n")).toEqual(["aaaa bbbb ", "cccc"]);
        const plain = "丙".repeat(25);
        expect(wrapLongLines(plain, 10).split("\n")).toEqual(["丙".repeat(10), "丙".repeat(10), "丙".repeat(5)]);
        for (const text of [punctuated, spaced, plain]) expect(wrapLongLines(text, 10).replaceAll("\n", "")).toBe(text);
    });

    it("硬断处正好是一个非 BMP 字的中间：整个字留到下一段", () => {
        const text = `${"丁".repeat(9)}𠀋${"丁".repeat(5)}`;
        const lines = wrapLongLines(text, 10).split("\n");
        expect(lines).toEqual(["丁".repeat(9), `𠀋${"丁".repeat(5)}`]);
        expect(lines.every((line) => !/[\uD800-\uDFFF]/u.test(line))).toBe(true);
    });

    it("不超过上限的行与已有的换行原样保留", () => {
        expect(wrapLongLines("短行\n\n另一行", 10)).toBe("短行\n\n另一行");
    });
});
