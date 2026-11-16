/**
 * 原文预处理（docs/specs/workspace/markdown-dialect.md 输出 1、17）：块与间隔拼回原文逐字节相等；规范化的偏移表；宽容写法。
 * 词法器用真实的 `marked`。
 */

import {describe, expect, it} from "bun:test";
import {Lexer} from "marked";

import {defaultMarkdownLanguage} from "../syntax";
import {isWholeFrontmatter, normalize, segment, splitFrontmatter} from "./source";

// 宽容写法的规则用编辑器的那一份：标签名与“认不认这个开标签”都来自语法模块。
const RULES = defaultMarkdownLanguage().glued;

function cut(body: string) {
    const normalized = normalize(body, RULES);
    const units = new Lexer({gfm: true}).lex(normalized.text);
    return {normalized, ...segment(normalized, body, units)};
}

const rejoin = (blocks: ReadonlyArray<{raw: string}>, gaps: ReadonlyArray<string>): string => blocks.map((block, index) => gaps[index] + block.raw).join("") + gaps[blocks.length];

describe("块与间隔拼回原文", () => {
    const samples: Record<string, string> = {
        "空": "",
        "只有空行": "\n\n\n",
        "普通": "# 标题\n\n第一段。\n第二行\n\n\n* 甲\n* 乙\n\n> 引用\n续\n",
        "CRLF 与 LF 混用": "第一段。\r\n\r\n第二段。\n\n第三段。\r\n",
        "单独的 CR": "甲\r\r乙\r",
        "重复的引用定义": "看[这里][1]。\n\n[1]: https://a.com\n\n[1]: https://b.com\n\n尾段\n",
        "未闭合的代码围栏": "段落\n\n```js\nlet a = 1;\n\n",
        "吞到文末的 HTML 块": "段落\n\n<div>\n内容\n\n",
        "标题紧跟正文": "# 标题\n正文\n",
        "没有结尾换行": "甲\n\n乙",
        "宽容写法": "正文<comment body=\"x\">\n内容\n</comment>\n\n后文\n",
        "宽容写法 CRLF": "正文<comment body=\"x\">\r\n内容\r\n</comment>\r\n",
        "表格与列表": "| a | b |\n|---|---|\n| 1 | 2 |\n\n- [ ] 任务\n- [x] 完成\n",
    };
    for (const [name, body] of Object.entries(samples)) {
        it(name, () => {
            const {blocks, gaps} = cut(body);
            expect(rejoin(blocks, gaps)).toBe(body);
        });
    }

    it("同名的第二条引用定义被解析器丢掉：它成为对不上单元的一块，原文仍在", () => {
        const {blocks, skipped} = cut("看[这里][1]。\n\n[1]: https://a.com\n\n[1]: https://b.com\n\n尾段\n");
        const orphan = blocks.find((block) => block.unit === null);
        expect(orphan?.raw).toBe("[1]: https://b.com");
        expect(skipped).toBe(1);
    });

    it("块的原文不含结尾换行，换行都在间隔里", () => {
        const {blocks, gaps} = cut("# 标题\n正文\n\n\n尾\n");
        expect(blocks.map((block) => block.raw)).toEqual(["# 标题", "正文", "尾"]);
        expect(gaps).toEqual(["", "\n", "\n\n\n", "\n"]);
    });
});

describe("规范化", () => {
    it("换行一律成 LF，偏移表指回原文", () => {
        const body = "甲\r\n乙\r丙\n";
        const {text, toSource} = normalize(body, RULES);
        expect(text).toBe("甲\n乙\n丙\n");
        expect(Array.from(toSource)).toEqual([0, 1, 3, 4, 5, 6, 7]);
    });

    it("宽容写法补的空行不对应原文：正文与块之间的间隔是空串", () => {
        const {blocks, gaps, normalized} = cut("正文<comment body=\"x\">\n内容\n</comment>\n");
        expect(normalized.text).toBe("正文\n\n<comment body=\"x\">\n内容\n</comment>\n");
        expect(blocks[0]?.raw).toBe("正文");
        expect(gaps[1]).toBe("");
    });

    it("不拆的情况：没有闭标签、只有容器标记、在围栏里、最后一行没有换行", () => {
        for (const body of ["正文<comment>\n内容\n", "> <comment>\n内容\n</comment>\n", "```\n正文<comment>\n```\n</comment>\n", "内容\n</comment>\n正文<comment>"]) {
            expect(normalize(body, RULES).text).toBe(body);
        }
    });

    it("宽容扫描是线性的：八千行异常输入在 100 毫秒内", () => {
        for (const body of [`${"正文<comment>\n".repeat(8000)}</comment>\n`, `${"正`文<comment>\n".repeat(8000)}</comment>\n`]) {
            const started = performance.now();
            normalize(body, RULES);
            expect(performance.now() - started).toBeLessThan(100);
        }
    });
});

describe("frontmatter", () => {
    it("BOM 与 frontmatter 原样留在前缀；没有闭合的分隔线不是 frontmatter", () => {
        expect(splitFrontmatter("\uFEFF---\r\na: 1\r\n---\r\n正文")).toEqual({prefix: "\uFEFF---\r\na: 1\r\n---\r\n", bom: "\uFEFF", body: "正文"});
        expect(splitFrontmatter("---\na: 1\n正文")).toEqual({prefix: "", bom: "", body: "---\na: 1\n正文"});
    });

    it("完整的 frontmatter：后面接任何正文都只切出它自己；闭栏后没有换行的也算", () => {
        for (const raw of ["---\n---\n", "---\na: 1\n---\n", "---\r\na: 1\r\n---\r\n", "---\na: 1\n---", "---  \na: 1\n---\t\n"]) expect(isWholeFrontmatter(raw), raw).toBe(true);
    });

    it("缺闭栏、中间有独占一行的 ---、带 BOM、后面还有正文、不以 --- 开头的都不算", () => {
        for (const raw of ["", "---\na: 1\n", "---\na: 1\n---\nb: 2\n---\n", "\uFEFF---\n---\n", "---\na: 1\n---\n正文", "a: 1\n---\n", "---\na: 1\n---\r"]) expect(isWholeFrontmatter(raw), raw).toBe(false);
    });
});
