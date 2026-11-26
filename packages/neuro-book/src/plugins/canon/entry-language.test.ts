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
    it("标签：名字、属性名、属性值；of 的值里字段名（含中文）是字段名一类，点是分隔符", () => {
        expect(colored('魔力 <V of="character.外观" />')).toEqual([[["<V", "tag"], ["of", "attribute.name"], ["=", "delimiter"], ['"', "attribute.value"], ["character", "type.field"], [".", "delimiter"], ["外观", "type.field"], ['"', "attribute.value"], ["/>", "tag"]]]);
        expect(colored('同行的是 <Ref id="e2" />。')).toEqual([[["<Ref", "tag"], ["id", "attribute.name"], ["=", "delimiter"], ['"e2"', "attribute.value"], ["/>", "tag"]]]);
    });

    it("expr 与 test 的值照式子画：数、单引号的字符串、运算符、ref 与内置函数", () => {
        expect(colored('<V expr="round(panel.魔力 / 3, 1)" />')[0]!.filter(([, type]) => type === "keyword" || type === "number" || type === "operator")).toEqual([["round", "keyword"], ["/", "operator"], ["3", "number"], ["1", "number"]]);
        expect(colored("<If test=\"ref('e2').panel.存款 >= 1000\">有<Else />无</If>")[0]!.filter(([, type]) => !type.startsWith("delimiter") && type !== "type.field" && type !== "attribute.value")).toEqual([["<If", "tag"], ["test", "attribute.name"], ["ref", "keyword"], ["'e2'", "string"], [">=", "operator"], ["1000", "number"], [">", "tag"], ["<Else", "tag"], ["/>", "tag"], ["</If>", "tag"]]);
    });

    it("Markdown 的记号：标题整行、列表与引用的记号、分隔线、加粗与强调、行内代码、链接", () => {
        expect(colored("## 近况")).toEqual([[["## 近况", "keyword.heading"]]]);
        expect(colored("- 一项\n1. 二项\n> 引用\n---")).toEqual([[["-", "keyword"]], [["1.", "keyword"]], [[">", "comment"]], [["---", "keyword"]]]);
        expect(colored("**加粗** 与 *强调* 与 `代码` 与 [链接](https://example.com)")).toEqual([[["**加粗**", "strong"], ["*强调*", "emphasis"], ["`代码`", "string"], ["[", "string.link"], ["](https://example.com)", "string.link"]]]);
    });

    it("标题里的标签照标签画；标题在行尾结束", () => {
        expect(colored('# 近况 <V of="panel.魔力" />\n下一行')).toEqual([[["# 近况 ", "keyword.heading"], ["<V", "tag"], ["of", "attribute.name"], ["=", "delimiter"], ['"', "attribute.value"], ["panel", "type.field"], [".", "delimiter"], ["魔力", "type.field"], ['"', "attribute.value"], ["/>", "tag"]], []]);
    });

    it("不是写法的地方不着色：比较号、不成标签的 <A、转义的 <、花括号、代码围栏里的标签", () => {
        expect(colored("a < b、1<2、评级 <A 级、他说{+5}")).toEqual([[]]);
        expect(colored('\\<V of="panel.魔力" />')[0]![0]).toEqual(["\\<", "string.escape"]);
        expect(colored('```\n<V of="x" />\n```\n<V of="panel.魔力" />').map((line) => line.map(([, type]) => type)).slice(0, 3)).toEqual([["string"], ["variable.source"], ["string"]]);
    });

    it("没写完的标签只影响它那一段：空行以后照正文与标题画", () => {
        expect(colored('先写 <Ref id="e2"\n\n后面 word = 1\n# 标题').slice(2)).toEqual([[], [["# 标题", "keyword.heading"]]]);
    });

    it("加粗里的标签照样着色；两边带空格的星号不是强调", () => {
        expect(colored('**<V of="panel.魔力" />**')[0]!.some(([text, type]) => text === "魔力" && type === "type.field")).toBe(true);
        expect(colored("2 * 3 * 4")).toEqual([[]]);
    });

    it("认不出的字照正文画，不标成错误：白名单以外的标签、式子里的怪字符", () => {
        const all = tokens('他说 # ¥ @\n<Foo bar="1">\n<V expr="panel.任务[3] ¥ @" />').flat().map(([, type]) => type);
        expect(all.filter((type) => type.includes("invalid"))).toEqual([]);
    });
});
