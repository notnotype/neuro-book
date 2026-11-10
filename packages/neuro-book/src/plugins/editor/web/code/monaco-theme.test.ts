/**
 * 语法着色的规则表（docs/specs/workbench/editor.md 输出 65）：表的形状。颜色的换算要真实的计算样式与画布，由
 * `e2e/editor-code-menu.e2e.ts` 在浏览器里验。
 */

import {describe, expect, it} from "bun:test";

import {nbThemeSyntaxTokens} from "@notnotype/nb-ui/theme";

import {SYNTAX_RULES} from "./monaco-theme";

describe("Spec workbench.editor 输出 65：语法着色的规则表", () => {
    it("每种语法变量都有成分用到；规则只取语法变量（invalid 取危险色）", () => {
        const used = new Set(SYNTAX_RULES.flatMap((rule) => (rule.color === undefined ? [] : [rule.color])));
        expect([...nbThemeSyntaxTokens].filter((token) => !used.has(token))).toEqual([]);
        expect([...used].filter((color) => !(nbThemeSyntaxTokens as ReadonlyArray<string>).includes(color))).toEqual(["--status-danger"]);
    });

    it("同一个 token 只有一条规则；JSON 的键与字符串值、属性名与属性值不同色", () => {
        const tokens = SYNTAX_RULES.map((rule) => rule.token);
        expect(new Set(tokens).size).toBe(tokens.length);
        const colorOf = (token: string): string | undefined => SYNTAX_RULES.find((rule) => rule.token === token)?.color;
        expect(colorOf("string.key")).not.toBe(colorOf("string"));
        expect(colorOf("attribute.name")).not.toBe(colorOf("attribute.value"));
    });
});
