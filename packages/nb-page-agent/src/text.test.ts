/** 快照文字的截断、转义与计量（docs/specs/agent/page-agent.md 输出 3、12）。 */

import {describe, expect, it} from "bun:test";

import {estimateTokens, quote, truncate, utf8Length} from "./text";

const char = (code: number) => String.fromCodePoint(code);
const bs = String.fromCharCode(0x5c);
/** JSON 里一个字符的转义：反斜杠、u 加四位小写十六进制，与 quote 的输出一致。 */
const jsonEscape = (code: number) => `${bs}u${code.toString(16).padStart(4, "0")}`;

describe("truncate 与 quote", () => {
    it("按码点截断，不切开代理对；截掉了补省略号，没截就原样", () => {
        const emoji = char(0x1f600);
        expect(truncate(`${emoji}${emoji}${emoji}`, 2)).toBe(`${emoji}${emoji}…`);
        expect(truncate("短", 5)).toBe("短");
    });

    it("先截断再转义：引号、换行、控制字符、双向控制字符与行分隔符都写成转义，输出里没有原字符", () => {
        const raw = `"a"\n${char(0x202e)}b${char(0x2028)}${char(0x7)}`;
        const quoted = quote(raw, 100);
        expect(quoted).toBe(`"${bs}"a${bs}"${bs}n${jsonEscape(0x202e)}b${jsonEscape(0x2028)}${jsonEscape(0x7)}"`);
        for (const code of [0x202e, 0x2028, 0x7, 0x0a]) expect(quoted.includes(char(code))).toBe(false);
        expect(JSON.parse(quoted)).toBe(raw);
        // 截断发生在转义之前：截到的是原文的字数，不是转义后的字数。
        expect(quote(`${char(0x202e)}${"x".repeat(10)}`, 3)).toBe(`"${jsonEscape(0x202e)}xx…"`);
    });
});

describe("utf8Length 与 estimateTokens", () => {
    it("UTF-8 字节数与 TextEncoder 一致（含多字节、代理对与孤立代理项）", () => {
        for (const text of ["abc", "雾港", `${char(0x1f600)}x`, `a${char(0xd800)}b`, "é"]) {
            expect(utf8Length(text), text).toBe(new TextEncoder().encode(text).length);
        }
    });

    it("ASCII 约 4 个字符一个 token，其余字符一个一个；代理对算一个", () => {
        expect(estimateTokens("abcdefgh")).toBe(2);
        expect(estimateTokens("雾港")).toBe(2);
        expect(estimateTokens(`${char(0x1f600)}`)).toBe(1);
    });
});
