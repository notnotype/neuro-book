/**
 * 不带编辑器的词法与原子（docs/specs/workspace/markdown-syntaxes.md 的“可选的原子”）：没有原子的模块读法与编辑器的语言逐字相同；
 * 原子在表格、列表、引用里不被 Markdown 的规则切开，分完逐字还原；几次分词的原子表互不串；原子多于上限时照原文分词。
 */

import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";

import {describe, expect, it} from "bun:test";
import type {Token, TokensList} from "marked";

import {createMarkdownLanguage} from "../language/language";
import {coreSyntax} from "../language/syntax/core";
import {ATOM_CAPACITY, atomAt, coreLexing, createLexing, lexAtoms, type MarkdownLexing} from "./index";

const CORPUS = join(import.meta.dir, "..", "language", "codec", "corpus");

/** 测试用的模块：`<大写名 …>` 是原子，范围不含两头的 `<`、`>`；分词规则经 `atomAt` 查回原文，产出 `tagAtom` 单元。 */
function tagModule(onAtom?: (lexer: object, identity: string) => void): MarkdownLexing {
    return {
        name: "tag-test",
        atoms: (source) => [...source.matchAll(/<[A-Z][^<>\n]*>/gu)].map((matched) => ({from: matched.index + 1, to: matched.index + matched[0].length - 1})),
        marked: [{
            extensions: [{
                name: "tagAtom",
                level: "inline",
                start: (src: string) => {
                    const at = src.search(/<[\ue000-\uf76f]/u);
                    return at < 0 ? undefined : at;
                },
                tokenizer(src: string) {
                    const matched = /^<([\ue000-\uf76f])\uf8fe*>/u.exec(src);
                    if (matched === null) return undefined;
                    const identity = matched[1] as string;
                    onAtom?.(this.lexer, identity);
                    const atom = atomAt(this.lexer, identity);
                    return atom === undefined ? undefined : {type: "tagAtom", raw: matched[0], source: atom.source, index: atom.index};
                },
            }],
        }],
    };
}

function flatten(tokens: readonly Token[]): Token[] {
    return tokens.flatMap((token) => {
        const nested: Token[] = [];
        const record = token as unknown as {tokens?: Token[]; items?: Token[]; header?: Array<{tokens: Token[]}>; rows?: Array<Array<{tokens: Token[]}>>};
        if (Array.isArray(record.tokens)) nested.push(...flatten(record.tokens));
        if (Array.isArray(record.items)) nested.push(...flatten(record.items));
        for (const cell of record.header ?? []) nested.push(...flatten(cell.tokens));
        for (const row of record.rows ?? []) for (const cell of row) nested.push(...flatten(cell.tokens));
        return [token, ...nested];
    });
}

const atomsOf = (tokens: TokensList): string[] => flatten(tokens).filter((token) => token.type === "tagAtom").map((token) => (token as unknown as {source: string}).source);

describe("不带编辑器的词法", () => {
    it("没有原子的 core：词法单元与编辑器的 core 语言在全部编解码语料上逐字相同", () => {
        const editor = createMarkdownLanguage([coreSyntax]);
        const plain = createLexing([coreLexing]);
        const files = readdirSync(CORPUS).filter((name) => name.endsWith(".md"));
        expect(files.length).toBeGreaterThan(10);
        for (const name of files) {
            const source = readFileSync(join(CORPUS, name), "utf8");
            expect(JSON.stringify(plain.lexer().lex(source))).toBe(JSON.stringify(editor.lexer().lex(source)));
        }
    });

    it("表格里原子带 `|`：单元格不被切开，原子与单元格的原文逐字还原", () => {
        const lexing = createLexing([tagModule(), coreLexing]);
        const source = "| 条件 | 值 |\n|---|---|\n| <If test=\"a || b\"> | 2 |";
        const tokens = lexing.lexer().lex(source);
        const table = tokens.find((token) => token.type === "table") as unknown as {rows: Array<Array<{text: string}>>};
        expect(table.rows[0]!.map((cell) => cell.text)).toEqual(["<If test=\"a || b\">", "2"]);
        expect(atomsOf(tokens)).toEqual(["If test=\"a || b\""]);
    });

    it("列表与引用去了前缀：原子照样认出，顶层单元的原文拼起来等于原文", () => {
        const lexing = createLexing([tagModule(), coreLexing]);
        const source = "- 项 <V of=\"a\">\n  续 <V of=\"b\">\n\n> 引 <Ref id=\"e1\">\n> 续 <Ref id=\"e2\">";
        const tokens = lexing.lexer().lex(source);
        expect(atomsOf(tokens)).toEqual(["V of=\"a\"", "V of=\"b\"", "Ref id=\"e1\"", "Ref id=\"e2\""]);
        expect(tokens.map((token) => token.raw).join("")).toBe(source);
    });

    it("一行以原子开头时不算 HTML 块；行内代码里的照原文", () => {
        const lexing = createLexing([tagModule(), coreLexing]);
        const tokens = lexing.lexer().lex("<V of=\"a\"> 开头\n\n`<V of=\"b\">` 代码");
        expect(tokens[0]!.type).toBe("paragraph");
        expect(atomsOf(tokens)).toEqual(["V of=\"a\""]);
        const code = flatten(tokens).find((token) => token.type === "codespan") as unknown as {text: string};
        expect(code.text).toBe("<V of=\"b\">");
    });

    it("原文里的私用区字照常是文字，不与占位相混", () => {
        const lexing = createLexing([tagModule(), coreLexing]);
        const source = "甲\ue000乙\uf8fe丙 <V of=\"a\">";
        const tokens = lexing.lexer().lex(source);
        expect(tokens[0]!.raw).toBe(source);
        expect(atomsOf(tokens)).toEqual(["V of=\"a\""]);
    });

    it("一次分词进行中另起的分词各查各的原子表", () => {
        const inner = createLexing([tagModule(), coreLexing]);
        const seen: string[] = [];
        const outer = createLexing([tagModule((lexer, identity) => {
            // 外层的分词规则里另起一次分词（写回校验、注释语法的工具都会这样）：两边的原子互不串，回来以后外层照样查得到。
            seen.push(...atomsOf(inner.lexer().lex("<Inner x=\"1\"> 与 <Inner x=\"2\">")));
            seen.push(atomAt(lexer, identity)?.source ?? "（查不到）");
        }), coreLexing]);
        const tokens = outer.lexer().lex("<Outer y=\"1\">");
        expect(atomsOf(tokens)).toEqual(["Outer y=\"1\""]);
        expect(seen).toEqual(["Inner x=\"1\"", "Inner x=\"2\"", "Outer y=\"1\""]);
    });

    it("模块给的范围重叠时分词失败，不读错", () => {
        const overlapping: MarkdownLexing = {name: "overlap", atoms: () => [{from: 0, to: 3}, {from: 2, to: 4}]};
        expect(() => createLexing([overlapping, coreLexing]).lexer().lex("abcdef")).toThrow("overlap");
    });

    it("原子多于上限时不遮罩、照原文分词；lexAtoms 交回没遮罩与原子的个数", () => {
        const lexing = createLexing([tagModule(), coreLexing]);
        const source = "<X>".repeat(ATOM_CAPACITY + 1);
        const tokens = lexing.lexer().lex(source);
        expect(atomsOf(tokens)).toEqual([]);
        expect(tokens[0]!.raw).toBe(source);
        expect(lexAtoms(lexing, source)).toEqual({ok: false, reason: "over-capacity", count: ATOM_CAPACITY + 1});
        // 私用区的字也占名额：上限正好的那一份照常遮罩。
        const exact = lexAtoms(lexing, "<X>".repeat(ATOM_CAPACITY - 1) + "\ue000");
        expect(exact.ok && exact.atoms.length).toBe(ATOM_CAPACITY);
    });

    it("lex() 之外另给一段文字分块或分行内：照样遮罩、分完还原（编解码器的读法这样另分词）", () => {
        const lexing = createLexing([tagModule(), coreLexing]);
        const lexer = lexing.lexer();
        lexer.lex("先分一篇");
        const blocks = lexing.blockTokens(lexer, "| 条件 | 值 |\n|---|---|\n| <If test=\"a || b\"> | 2 |");
        const table = blocks.find((token) => token.type === "table") as unknown as {rows: Array<Array<{text: string}>>};
        expect(table.rows[0]!.map((cell) => cell.text)).toEqual(["<If test=\"a || b\">", "2"]);
        expect(atomsOf(blocks as TokensList)).toEqual(["If test=\"a || b\""]);
        expect(atomsOf(lexing.inlineTokens(lexer, "甲 <V of=\"a\"> 乙") as TokensList)).toEqual(["V of=\"a\""]);
    });

    it("模块给的范围跨行时分词失败", () => {
        const crossing: MarkdownLexing = {name: "crossing", atoms: () => [{from: 0, to: 5}]};
        expect(() => createLexing([crossing, coreLexing]).lexer().lex("ab\ncdef")).toThrow("crosses a line");
    });
});

describe("原子落在哪", () => {
    const lexing = createLexing([tagModule(), coreLexing]);
    /** 每个原子的落点写成“外层单元/所在单元.字段”。 */
    const where = (source: string): string[][] => {
        const lexed = lexAtoms(lexing, source);
        if (!lexed.ok) throw new Error("not masked");
        return lexed.placements.map((list) => list.map((placement) => [...placement.ancestors.map((token) => token.type), `${placement.token.type}.${placement.field}`].join("/")));
    };

    it("正文里被模块认领的、代码里的、链接地址与标题里的、图片说明里的各有各的落点", () => {
        expect(where("甲 <V of=\"a\"> 与 `<V of=\"b\">`")).toEqual([["paragraph/tagAtom.raw"], ["paragraph/codespan.raw", "paragraph/codespan.text"]]);
        expect(where("[文 <V of=\"a\">](<V of=\"b\"> '<V of=\"c\">')")).toEqual([["paragraph/link/tagAtom.raw"], ["paragraph/link.href"], ["paragraph/link.title"]]);
        // 图片说明也分了词：原子在图片下面被认领，模块要看外层判断它算不算正文。
        expect(where("![说明 <V of=\"a\">](x.png)")).toEqual([["paragraph/image/tagAtom.raw"]]);
        expect(where("```\n<V of=\"a\">\n```")).toEqual([["code.raw", "code.text"]]);
    });

    it("引用式链接：定义与用到它的链接各记一处；转义的落在文字里", () => {
        expect(where("[文][r]\n\n[r]: <V of=\"a\">")).toEqual([["paragraph/link.href", "def.raw", "def.href"]]);
        expect(where("\\<V of=\"a\">")).toEqual([["paragraph/text.raw", "paragraph/text.text"]]);
    });

    it("表格里多出来的单元格被丢掉：那里的原子一处也没有", () => {
        expect(where("| a |\n|---|\n| x | <V of=\"a\"> |")).toEqual([[]]);
    });

    it("没有原子时照样分词、落点为空", () => {
        const lexed = lexAtoms(lexing, "正文 *强调*");
        expect(lexed.ok && lexed.atoms).toEqual([]);
        expect(lexed.ok && lexed.tokens[0]!.type).toBe("paragraph");
    });
});
