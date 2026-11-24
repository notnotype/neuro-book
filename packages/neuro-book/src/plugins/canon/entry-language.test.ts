/**
 * 条目主文字的着色规则（web/entry-language.ts；docs/specs/canon/author-ui.md 输出 48）：用 Monaco 真实的 Monarch 编译器与分词器
 * 跑这份规则，看各种写法分成了哪些记号。颜色由编辑器的主题按记号的种类给（`editor/web/code/monaco-theme.ts`），真实页面里
 * 的着色在 e2e（`canon-write`）。
 */

import {beforeAll, describe, expect, it} from "bun:test";

import {entryLanguageDefinition} from "./web/entry-language";

interface Token {
    readonly offset: number;
    readonly type: string;
}
interface Tokenizer {
    getInitialState(): unknown;
    tokenize(line: string, hasEOL: boolean, state: unknown): {readonly tokens: readonly Token[]; readonly endState: unknown};
}

/** Monaco 的分词器没有公开的类型入口：按路径取，路径写成变量免得类型检查去解析它。 */
const MONARCH: string = "monaco-editor/esm/vs/editor/standalone/common/monarch";
let tokenizer: Tokenizer;

beforeAll(async () => {
    const {compile} = await import(`${MONARCH}/monarchCompile.js`) as {compile(id: string, language: unknown): unknown};
    const {MonarchTokenizer} = await import(`${MONARCH}/monarchLexer.js`) as {MonarchTokenizer: new (languages: unknown, themes: unknown, id: string, lexer: unknown, configuration: unknown) => Tokenizer};
    // 这份规则不嵌入别的语言，语言服务只被问“登记过没有”；配置只被问一行最长分多少字。
    tokenizer = new MonarchTokenizer({languageIdCodec: {encodeLanguageId: () => 1}, isRegisteredLanguageId: () => false}, {}, "canon-entry", compile("canon-entry", entryLanguageDefinition.language), {getValue: () => 20000, onDidChangeConfiguration: () => ({dispose: () => undefined})});
});

/** 每一行分出的记号：`[文字, 种类]`，种类去掉语言后缀；没有着色的是空串。 */
function tokens(source: string): Array<Array<[string, string]>> {
    let state = tokenizer.getInitialState();
    return source.split("\n").map((line) => {
        const result = tokenizer.tokenize(line, true, state);
        state = result.endState;
        return result.tokens.map((token, index): [string, string] => [line.slice(token.offset, result.tokens[index + 1]?.offset ?? line.length), token.type.replace(/\.canon-entry$/u, "")]);
    });
}
/** 只留着了色的记号。 */
const colored = (source: string) => tokens(source).map((line) => line.filter(([, type]) => type !== ""));

describe("author-ui 输出 48：条目主文字的着色", () => {
    it("花括号里的字段：名字（含中文）是变量，点是分隔符；条件里的数、字符串与运算符各自着色", () => {
        expect(colored("魔力 {character.外观}")).toEqual([[["{", "delimiter.bracket"], ["character", "variable"], [".", "delimiter"], ["外观", "variable"], ["}", "delimiter.bracket"]]]);
        expect(colored('{panel.魔力 >= 1000 ? "能" : "不能"}')[0]!.filter(([, type]) => !type.startsWith("delimiter") && type !== "variable")).toEqual([[">=", "operator"], ["1000", "number"], ["?", "operator"], ['"能"', "string"], [":", "operator"], ['"不能"', "string"]]);
        // 相邻的同类记号合成一个（`)` 与 `.`）。
        expect(colored('{ref("e2").panel.存款}')[0]!.slice(1, 5)).toEqual([["ref", "type"], ["(", "delimiter"], ['"e2"', "string"], [").", "delimiter"]]);
    });

    it("标签：名字、属性名、属性值；属性里的花括号照表达式画", () => {
        expect(colored('同行的是 <Ref id="e2" />。')).toEqual([[["<Ref", "tag"], ["id", "attribute.name"], ["=", "delimiter"], ['"e2"', "attribute.value"], ["/>", "tag"]]]);
        expect(colored('<Image src={panel.图} alt="说明" />')[0]!.map(([, type]) => type)).toEqual(["tag", "attribute.name", "delimiter", "delimiter.bracket", "variable", "delimiter", "variable", "delimiter.bracket", "attribute.name", "delimiter", "attribute.value", "tag"]);
    });

    it("Markdown 的记号：标题整行、列表与引用的记号、分隔线、加粗与强调、行内代码、链接", () => {
        expect(colored("## 近况")).toEqual([[["## 近况", "keyword"]]]);
        expect(colored("- 一项\n1. 二项\n> 引用\n---")).toEqual([[["-", "keyword"]], [["1.", "keyword"]], [[">", "comment"]], [["---", "keyword"]]]);
        expect(colored("**加粗** 与 *强调* 与 `代码` 与 [链接](https://example.com)")).toEqual([[["**加粗**", "strong"], ["*强调*", "emphasis"], ["`代码`", "variable"], ["[", "string.link"], ["](https://example.com)", "string.link"]]]);
    });

    it("标题里的表达式照表达式画；标题在行尾结束，行尾正好是花括号时也不带到下一行", () => {
        expect(colored("# 近况 {panel.魔力}\n下一行")).toEqual([[["# 近况 ", "keyword"], ["{", "delimiter.bracket"], ["panel", "variable"], [".", "delimiter"], ["魔力", "variable"], ["}", "delimiter.bracket"]], []]);
    });

    it("不是写法的地方不着色：比较号、转义的花括号、代码围栏里的花括号", () => {
        expect(colored("a < b、1<2")).toEqual([[]]);
        expect(colored("他说\\{+5}")).toEqual([[["\\{", "string.escape"]]]);
        expect(colored("```\n{不是表达式}\n```\n{panel.魔力}").map((line) => line.map(([, type]) => type))).toEqual([["string"], ["variable.source"], ["string"], ["delimiter.bracket", "variable", "delimiter", "variable", "delimiter.bracket"]]);
    });

    it("只含注释的表达式整个是注释", () => {
        expect(colored("{/* 待补 */}")).toEqual([[["{/* 待补 */}", "comment"]]]);
    });

    it("认不出的字照正文画，不标成错误：没配平的花括号、白名单以外的标签、表达式里的怪字符", () => {
        const all = tokens("他说{+5 # ¥ @\n<Foo bar=1>\n{panel.任务[3]}").flat().map(([, type]) => type);
        expect(all.filter((type) => type.includes("invalid"))).toEqual([]);
    });
});
