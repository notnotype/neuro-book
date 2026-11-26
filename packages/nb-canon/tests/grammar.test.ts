/**
 * 条目主文字的写法（docs/specs/canon/rendering.md 输出 1、2、5、9、17、18、22）：标签的落点、条件的配对、写入检查的各个码、式子的
 * 节点表与三值逻辑、带值写法与去值的往返。全部用真实的 nb-markdown 词法与 acorn，没有替身。
 */

import {describe, expect, it} from "bun:test";
import fc from "fast-check";

import {
    agentJson,
    canonicalEntryText,
    checkEntryText,
    decorateEntryText,
    evaluate,
    normalizeEntrySource,
    parseAddress,
    parseEntryText,
    parseExpression,
    positionOf,
    stripEntryText,
    type Decoration,
    type EntryTag,
    type FieldReference,
    type Resolved,
} from "../src/grammar/index";

const placesOf = (source: string): string[] => parseEntryText(source).tags.map((tag) => `${source.slice(tag.start, tag.end)} ${tag.place}`);
const codesOf = (source: string, registered?: ReadonlySet<string>): string[] => checkEntryText(parseEntryText(source), {registered}).map((problem) => `${problem.code}@${source.slice(problem.offset, problem.offset + 6)}`);

describe("标签的落点（输出 17）", () => {
    const cases: ReadonlyArray<readonly [string, string, readonly string[]]> = [
        ["列表与续行", "- 魔力 <V of=\"panel.魔力\" />\n  续行 <V of=\"panel.上限\" />\n- 第二项 <Ref id=\"e2\" />", ["<V of=\"panel.魔力\" /> live", "<V of=\"panel.上限\" /> live", "<Ref id=\"e2\" /> live"]],
        ["嵌套的列表与引用", "1. 外层\n   - 内层 <V of=\"panel.a\" />\n     > 引用里 <V of=\"panel.b\" />", ["<V of=\"panel.a\" /> live", "<V of=\"panel.b\" /> live"]],
        ["引用的懒续行", "> 引用 <V of=\"panel.a\" />\n懒续行 <V of=\"panel.b\" />", ["<V of=\"panel.a\" /> live", "<V of=\"panel.b\" /> live"]],
        ["表格里带 `||` 的条件不切开单元格", "| 名 | 值 |\n|---|---|\n| 条件 | <If test=\"panel.a || panel.b\">是<Else />否</If> |", ["<If test=\"panel.a || panel.b\"> live", "<Else /> live", "</If> live"]],
        ["表格里转义的竖线", "| a |\n|---|\n| x \\| <V of=\"panel.a\" /> |", ["<V of=\"panel.a\" /> live"]],
        ["表格里多出来的单元格被丢掉", "| a |\n|---|\n| x | <V of=\"panel.a\" /> |", ["<V of=\"panel.a\" /> lost"]],
        ["行内代码、围栏代码、缩进代码", "`<V of=\"panel.x\" />`\n\n```\n<V of=\"panel.y\" />\n```\n\n    <V of=\"panel.z\" />", ["<V of=\"panel.x\" /> code", "<V of=\"panel.y\" /> code", "<V of=\"panel.z\" /> code"]],
        ["转义", "\\<V of=\"panel.x\" /> 与 <V of=\"panel.a\" />", ["<V of=\"panel.x\" /> escaped", "<V of=\"panel.a\" /> live"]],
        ["链接文字是正文，标题与地址不是", "[看<V of=\"panel.a\" />](http://x '<V of=\"panel.b\" />') [文](<V of=\"panel.c\" />)", ["<V of=\"panel.a\" /> live", "<V of=\"panel.b\" /> link", "<V of=\"panel.c\" /> link"]],
        ["引用定义", "[文][r]\n\n[r]: <V of=\"panel.a\" />", ["<V of=\"panel.a\" /> link"]],
        ["图片说明", "![<V of=\"panel.a\" />](x.png)", ["<V of=\"panel.a\" /> image"]],
        ["原样 HTML、脚注、数学里", "<div><V of=\"panel.a\" /></div>\n\n正文[^1] $<V of=\"panel.b\" />$\n\n[^1]: 注 <V of=\"panel.c\" />", ["<V of=\"panel.a\" /> opaque", "<V of=\"panel.b\" /> opaque", "<V of=\"panel.c\" /> opaque"]],
        ["强调两侧与标题", "# 标题 <V of=\"panel.a\" />\n\n中**<V of=\"panel.b\" />**文", ["<V of=\"panel.a\" /> live", "<V of=\"panel.b\" /> live"]],
        ["泛型的尖括号：`<K,` 不是标签，`<V>` 是", "`Map<K, V>` 与 `List<V>`", ["<V> code"]],
        ["属性值里的 `<V` 不另算", "<If test=\"panel.名字 == '<V of=bad />'\">有<Else />无</If>", ["<If test=\"panel.名字 == '<V of=bad />'\"> live", "<Else /> live", "</If> live"]],
        ["写坏的：正文、代码里、转义的", "他说 <V of=\"panel.a\" 没写完 `<V of=` \\<V of=\"b", ["<V prose", "<V code", "<V escaped"]],
        ["带值的 V 与带描述的标签整体算一个", "<V of=\"panel.a\" label=\"魔力\">3110</V> <StatBar of=\"panel.魔力\">魔力 *3* | x</StatBar>", ["<V of=\"panel.a\" label=\"魔力\">3110</V> live", "<StatBar of=\"panel.魔力\">魔力 *3* | x</StatBar> live"]],
        // 配成一个之前不知道落点：开闭标签有一个转义了、中间有反引号时各算各的，中间的强调与代码照常读（S3 审查）。
        ["字面的开闭标签不配成一个", "`<V of=\"panel.a\">` **粗** `</V>` 与 \\<V of=\"panel.a\"> **粗** \\</V> 与 <V of=\"panel.a\">1\\</V>", ["<V of=\"panel.a\"> code", "</V> code", "<V of=\"panel.a\"> escaped", "</V> escaped", "<V of=\"panel.a\"> live", "</V> escaped"]],
        ["HTML 的强调与换行不是标签", "<STRONG>甲</STRONG> <Br> <EM>乙</EM>", []],
    ];
    for (const [name, source, expected] of cases) it(name, () => expect(placesOf(source)).toEqual([...expected]));

    it("原文里的私用区字照常是文字，不影响旁边的标签", () => {
        const source = `甲${String.fromCharCode(0xe000)}乙${String.fromCharCode(0xf8fe)} <V of="panel.a" />`;
        expect(placesOf(source)).toEqual(["<V of=\"panel.a\" /> live"]);
        expect(parseEntryText(source).tokens.map((token) => token.raw).join("")).toBe(source);
    });
});

describe("条件的配对", () => {
    const cases: ReadonlyArray<readonly [string, string, readonly string[]]> = [
        ["转义的闭标签不算", "<If test=\"panel.x\">a \\</If> b</If>", []],
        ["代码里的闭标签不算", "<If test=\"panel.x\">a `</If>` b<Else />c</If>", []],
        ["转义的 Else 不切分支", "<If test=\"panel.x\">a \\<Else /> b<Else />c</If>", []],
        ["跨段", "开头 <If test=\"panel.x\">一\n\n二</If>", ["cross-block@<If te", "tag-malformed@</If>"]],
        ["被粗体切开", "**粗 <If test=\"panel.x\">一** 二</If>", ["cross-block@<If te", "tag-malformed@</If>"]],
        ["分支标签在强调里", "<If test=\"panel.x\">**甲<Else />乙**</If>", ["cross-block@<Else "]],
        ["分支标签在链接文字里", "<If test=\"panel.x\">[甲<Else />乙](u)</If>", ["cross-block@<Else "]],
        ["套着的 If", "<If test=\"panel.x\">a <If test=\"panel.y\">b</If></If>", ["cross-block@<If te"]],
        ["Else 之后还有 ElseIf", "<If test=\"panel.x\">a<Else />b<ElseIf test=\"panel.y\" />c</If>", ["tag-malformed@<ElseI"]],
        ["孤立的 Else", "文字 <Else /> 文字", ["tag-malformed@<Else "]],
    ];
    for (const [name, source, expected] of cases) it(name, () => expect(codesOf(source)).toEqual([...expected]));

    it("配好的条件按分支标签切开，各支是行内的单元", () => {
        const parsed = parseEntryText("前 <If test=\"panel.a > 0\">**有**<ElseIf test=\"panel.b\" />少<Else />无</If> 后");
        const paragraph = parsed.tokens[0] as unknown as {tokens: Array<{type: string; branches?: Array<{head: number; tokens: Array<{type: string; raw: string}>}>}>};
        const entryIf = paragraph.tokens.find((token) => token.type === "entryIf");
        expect(entryIf?.branches?.map((branch) => [parsed.tags[branch.head]?.name, branch.tokens.map((token) => `${token.type}:${token.raw}`)])).toEqual([
            ["If", ["strong:**有**"]],
            ["ElseIf", ["text:少"]],
            ["Else", ["text:无"]],
        ]);
    });
});

describe("写入检查（输出 1、19）", () => {
    const cases: ReadonlyArray<readonly [string, string, readonly string[]]> = [
        ["合格的几种标签", "<V of=\"panel.魔力\" /> <V entry=\"e2\" of=\"att.态度[e1].称呼\" /> <V expr=\"percent(panel.a, panel.b)\" /> <Ref id=\"e2\" /> <Image src=\"a.png\" alt=\"说明\" /> <Image of=\"panel.头像\" />", []],
        ["白名单以外的 Markdown", "<div>甲</div>\n\n正文[^1] 与 $x$ <!-- 注 -->\n\n[^1]: 注", ["unsupported-markdown@<div>甲", "unsupported-markdown@[^1] 与", "unsupported-markdown@$x$ <!", "unsupported-markdown@<!-- 注", "unsupported-markdown@[^1]: "]],
        ["只有 <br> 的一行与 HTML 的强调放行", "甲<br>乙 <strong>粗</strong>\n\n<br>\n\n丙", []],
        ["没登记的标签可以免（看条目）", "<StatBar of=\"panel.魔力\" />", ["unknown-tag@<StatB"]],
        ["程序加的属性写进源文", "<V of=\"panel.a\" label=\"魔力\" /> <If test=\"panel.a\" value=\"true\">有</If> <Ref id=\"e2\" name=\"星瑾\" /> <Image src=\"a\" path=\"b\" />", ["unknown-tag@<V of=", "unknown-tag@<If te", "unknown-tag@<Ref i", "unknown-tag@<Image"]],
        ["带值的 V 写进源文", "<V of=\"panel.a\">3110</V>", ["unknown-tag@<V of="]],
        ["只抄了开标签的 V", "<V of=\"panel.a\">3110", ["unknown-tag@<V of="]],
        ["属性不认、缺了、重复", "<V of=\"panel.a\" expr=\"panel.b\" /> <V entry=\"e2\" expr=\"panel.a\" /> <Ref /> <V of=\"panel.a\" of=\"panel.b\" /> <Else test=\"x\" />", ["unknown-tag@<V of=", "unknown-tag@<V ent", "unknown-tag@<Ref /", "unknown-tag@<V of=", "tag-malformed@<Else ", "unknown-tag@<Else "]],
        ["式子写错、带注释、用了 ??、地址写错", "<V expr=\"panel.a +\" /> <V expr=\"panel.a /* c */\" /> <V expr=\"panel.a ?? 1\" /> <V of=\"ref('e2').a.b\" /> <V of=\"panel\" />", ["forbidden-syntax@\" /> <", "forbidden-syntax@/* c *", "forbidden-syntax@panel.", "forbidden-syntax@ref('e", "forbidden-syntax@panel\""]],
        ["expr 不引用字段", "<V expr=\"1 + 2\" />", ["no-field-expression@1 + 2\""]],
        ["写坏的内置标签在正文里；代码里、转义的与不像标签的照文字", "他说 <V of=\"panel.a\" 没写完 `<V of=` \\<V of=\"b 评级 <A 级 <V 是", ["tag-malformed@<V of="]],
        ["标签在链接与图片说明里", "[文](<V of=\"panel.a\" />) ![<V of=\"panel.b\" />](x.png)", ["tag-not-live@<V of=", "tag-not-live@<V of="]],
        ["链接标题里转义的完整标签也算标签", "[链](u \"写法 \\<V of=\"panel.a\" />\")", ["tag-not-live@<V of="]],
        ["链接与引用定义里不成标签的 `<A` 是文字；写坏的内置标签照正文的判据", "[链](u \"评级 <A 级\") [x](https://a.com/<A/b)\n\n[r]: u \"评级 <A 级\"\n\n[链](u \"<V of=\"panel.a 没写完\")", ["tag-malformed@<V of="]],
        ["表格某行的单元格比表头多", "| a |\n|---|\n| <Ref id=\"e2\" /> | 多余 |", ["unsupported-markdown@| a |\n"]],
        ["引用里的问题不记到后文同样的块上", "> <!-- 注\n> 释 -->\n\n正文\n\n<!-- 注\n释 -->", ["unsupported-markdown@<!-- 注", "unsupported-markdown@<!-- 注"]],
        ["近似的写法：单引号、不加引号、等号两边有空格", "<V of='panel.a' /> <V of=panel.a /> <V of = \"panel.a\" /> <Ref id='e2' />", ["tag-malformed@<V of=", "tag-malformed@<V of=", "tag-malformed@<V of ", "tag-malformed@<Ref i"]],
    ];
    for (const [name, source, expected] of cases) it(name, () => expect(codesOf(source)).toEqual([...expected]));

    it("登记的标签放行；必须自闭合；写坏了报 tag-malformed（没登记的写坏了照文字）", () => {
        expect(codesOf("<StatBar of=\"panel.魔力\" />", new Set(["StatBar"]))).toEqual([]);
        expect(codesOf("<StatBar of=\"panel.a 没写完", new Set(["StatBar"]))).toEqual(["tag-malformed@<StatB"]);
        expect(codesOf("<StatBar of=\"panel.a 没写完")).toEqual([]);
        expect(codesOf("<StatBar of=\"panel.魔力\">描述</StatBar>", new Set(["StatBar"]))).toEqual(["unknown-tag@<StatB"]);
    });

    it("没登记的标签的问题带标签序号与可免的标记，别的不带", () => {
        const problems = checkEntryText(parseEntryText("<V of=\"panel.a\" /> <StatBar of=\"panel.魔力\" />"));
        expect(problems.map((problem) => [problem.code, problem.tag, problem.excusable ?? false])).toEqual([["unknown-tag", 1, true]]);
    });

    it("一块的标签与私用区的字合计超过 6000 个时拒收", () => {
        expect(codesOf("<V of=\"panel.a\" />".repeat(6001))).toEqual(["too-many-tags@<V of="]);
        expect(codesOf("<V of=\"panel.a\" />".repeat(6000))).toEqual([]);
    });

    it("式子出错的行列落在属性值里", () => {
        const source = "第一行\n魔力 <V expr=\"panel.a + * 2\" />";
        const [problem] = checkEntryText(parseEntryText(source));
        expect(problem?.code).toBe("forbidden-syntax");
        expect(positionOf(source, problem!.offset)).toEqual({line: 2, column: 23});
    });

    it("一块几万个 `<` 的解析是线性的（外部的世界观可能这样写）", () => {
        // 平方级时 4 万个要几十秒（w00055 t02 S3 审查第 4 条）；线性时不到一秒，上限放宽到 5 秒，负载高时也不误报。
        for (const source of ["<".repeat(40000) + "<V of=\"panel.a\" />", "a<".repeat(20000)]) {
            const started = performance.now();
            parseEntryText(source);
            expect(performance.now() - started).toBeLessThan(5000);
        }
    });

    it("写入前的规范化：去掉 BOM，换行规范成 LF", () => {
        expect(normalizeEntrySource(`${String.fromCharCode(0xfeff)}甲\r\n乙\r丙\n丁`)).toBe("甲\n乙\n丙\n丁");
    });
});

describe("式子（输出 2、5）", () => {
    const fields: Readonly<Record<string, unknown>> = {"panel.max": Number.MAX_VALUE, "panel.a": 3110, "panel.b": 12000, "panel.zero": 0, "panel.name": "星瑕", "panel.flag": true, "panel.none": null, "round.计数": 3};
    const resolve = (reference: FieldReference): Resolved<string> =>
        reference.path === "panel.gone" ? {value: null, unavailable: "未启用"} : reference.path === "panel.part" ? {value: 1, incomplete: "c7 constraint-violated"} : {value: fields[reference.path] ?? null};
    const value = (text: string): unknown => {
        const parsed = parseExpression(text);
        if (!parsed.ok) throw new Error(`${text}: ${parsed.error.message}`);
        return evaluate(parsed.expression, resolve).value;
    };
    const cases: ReadonlyArray<readonly [string, unknown]> = [
        ["panel.a + panel.b", 15110],
        ["panel.a - 10 * 2", 3090],
        ["panel.a / 3", 1036.66666666667],
        ["0.1 + 0.2 + panel.zero", 0.3],
        ["panel.a % 1000", 110],
        ["-panel.a", -3110],
        ["round(panel.a / 7, 2)", 444.29],
        ["round(panel.a / 7)", 444],
        ["floor(panel.a / 1000) + ceil(panel.a / 1000)", 7],
        ["min(panel.a, panel.b, 5000)", 3110],
        ["max(panel.a, panel.b)", 12000],
        ["abs(panel.zero - panel.a)", 3110],
        ["percent(panel.a, panel.b)", "26%"],
        ["panel.a >= 1000 ? '能' : '不能'", "能"],
        ["round.计数 + 1", 4],
        ["(panel.a > 0)", true],
        ["((panel.a))", 3110],
        ["(panel.a + panel.b) / 2", 7555],
        ["round(panel.a / 3110 * 1.005, 2)", 1.01],
        ["round(-2.5 + panel.zero)", -3],
        ["round(panel.a, -2)", 3100],
        ["percent(-1 + panel.zero, 8)", "-13%"],
        ["percent(panel.zero - 0.01, 8)", "0%"],
        ["panel.max * 1", Number.MAX_VALUE],
        // 未知按三值逻辑传。
        ["-panel.none", null],
        ["-panel.name", null],
        ["panel.name + 1", null],
        ["panel.a / panel.zero", null],
        ["panel.a % panel.zero", null],
        ["percent(panel.a, panel.zero)", null],
        ["panel.a * 1e308", null],
        ["round(panel.a, 400)", null],
        ["panel.none > 1", null],
        ["panel.a > 'x'", null],
        ["!panel.none", null],
        ["false && panel.none", false],
        ["true && panel.none", null],
        ["true || panel.none", true],
        ["false || panel.none", null],
        ["panel.none ? 1 : 2", null],
        ["panel.gone + 1", null],
        ["min(panel.a, panel.none)", null],
    ];
    for (const [text, expected] of cases) it(`${text} → ${JSON.stringify(expected)}`, () => expect(value(text)).toBe(expected as never));

    it("读不到与不完整的标记按出现的先后取第一个", () => {
        const parsed = parseExpression("panel.part + panel.gone");
        expect(parsed.ok && evaluate(parsed.expression, resolve)).toEqual({value: null, incomplete: "c7 constraint-violated", unavailable: "未启用"});
    });

    const rejected: ReadonlyArray<readonly [string, string]> = [
        ["1e309 + panel.a", "not finite"],
        ["round(panel.a, panel.b)", "integer literal"],
        ["round(panel.a, 1.5)", "integer literal"],
        ["percent(panel.a)", "takes 2"],
        ["sqrt(panel.a)", "built-in functions"],
        ["panel.a ** 2", "operator ** not allowed"],
        ["panel.a ?? 1", "operator ?? not allowed"],
        ["+panel.a", "operator + not allowed"],
        ["panel.a, panel.b", "SequenceExpression"],
        ["panel.a; 1", "single expression"],
        ["panel.a // 注释", "comments"],
        ["panel[0]", "not a field address"],
        ["`x${panel.a}`", "TemplateLiteral"],
        ["ref('e2')", "built-in functions"],
    ];
    for (const [text, message] of rejected) {
        it(`拒收 ${text}`, () => {
            const parsed = parseExpression(text);
            expect(parsed.ok).toBe(false);
            expect(!parsed.ok && parsed.error.message).toContain(message);
        });
    }

    it("首尾的空白可以有；字段引用：ref 开头的、计算的元素 id 两种写法等价", () => {
        const parsed = parseExpression("  ref('e2').att.态度['e1'].称呼 == att.态度[e1].称呼  ");
        expect(parsed.ok && parsed.expression.references).toEqual([{entry: "e2", path: "att.态度[e1].称呼"}, {entry: null, path: "att.态度[e1].称呼"}]);
    });

    it("地址：只许不带 ref 的成员访问链", () => {
        expect(parseAddress("text[b1]")).toEqual({ok: true, path: "text[b1]"});
        expect(parseAddress("entry.name")).toEqual({ok: true, path: "entry.name"});
        expect(parseAddress("round.计数")).toEqual({ok: true, path: "round.计数"});
        // 存下来的地址里元素 id 可以是 JS 的字面量与关键字：照地址的写法读。
        expect(parseAddress("panel.list[true]")).toEqual({ok: true, path: "panel.list[true]"});
        expect(parseAddress("text[default]")).toEqual({ok: true, path: "text[default]"});
        expect(parseAddress("panel.list[null].name")).toEqual({ok: true, path: "panel.list[null].name"});
        expect(parseAddress("att.态度['e1'].称呼")).toEqual({ok: true, path: "att.态度[e1].称呼"});
        expect(parseAddress("panel.a + 1").ok).toBe(false);
    });
});

describe("规范写法、带值写法与去值（输出 8、9、18、22）", () => {
    it("活的标签写成规范写法；字面的与别的字不动", () => {
        expect(canonicalEntryText(parseEntryText("<V  of=\"panel.a\"/> `<V  of=\"x\"/>` <If test=\"panel.a\" >有<Else/>无</If >"))).toBe("<V of=\"panel.a\" /> `<V  of=\"x\"/>` <If test=\"panel.a\">有<Else />无</If>");
    });

    it("场景 1 的样子：值、显示名、条件的结果与读不到的原因", () => {
        const source = "魔力 <V of=\"panel.m2\" />/<V of=\"panel.魔力上限\" />，<If test=\"panel.m2 >= 1000\">能变身<Else />变不了身</If> <Ref id=\"e12\" /> <V of=\"panel.x\" />";
        const decorations = new Map<number, Decoration>([
            [0, {attributes: [["label", "魔力"], ["incomplete", "c7 constraint-violated"]], content: agentJson(3110)}],
            [1, {content: agentJson(12000)}],
            [2, {attributes: [["value", "true"]]}],
            [5, {attributes: [["name", "代号 \"灰袍\"\n<队长>&"]]}],
            [6, {attributes: [["unavailable", "面板第 3 章起生效"]], content: agentJson(null)}],
        ]);
        const text = decorateEntryText(parseEntryText(source), (tag) => decorations.get(tag.index) ?? null);
        expect(text).toBe("魔力 <V of=\"panel.m2\" label=\"魔力\" incomplete=\"c7 constraint-violated\">3110</V>/<V of=\"panel.魔力上限\">12000</V>，<If test=\"panel.m2 >= 1000\" value=\"true\">能变身<Else />变不了身</If> <Ref id=\"e12\" name=\"代号 &quot;灰袍&quot; &lt;队长&gt;&amp;\" /> <V of=\"panel.x\" unavailable=\"面板第 3 章起生效\">null</V>");
        expect(stripEntryText(text)).toBe(source);
    });

    it("值里的 `<`、`</V>` 写成转义，带值的 V 仍是一个标签", () => {
        const source = "| a |\n|---|\n| <V of=\"panel.a\" /> |";
        const text = decorateEntryText(parseEntryText(source), () => ({content: agentJson("x</V> | `y` *z*")}));
        expect(parseEntryText(text).tags.map((tag) => [tag.kind, tag.place])).toEqual([["paired", "live"]]);
        expect(stripEntryText(text)).toBe(source);
    });

    it("去值只动活的标签；登记的标签去掉描述，没登记的带内容的标签与别的内置标签照原样", () => {
        const text = "`<V of=\"x\">1</V>` <StatBar of=\"panel.a\">一条进度条</StatBar> <Foo>描述</Foo> <Ref id=\"e2\">星瑾</Ref>";
        expect(stripEntryText(text, new Set(["StatBar"]))).toBe("`<V of=\"x\">1</V>` <StatBar of=\"panel.a\" /> <Foo>描述</Foo> <Ref id=\"e2\">星瑾</Ref>");
    });

    // 随机的主文字：正文的各种写法里夹着标签。只生成规范写法、过得了写入检查的（`fc.pre`），装饰也随机。
    const word = fc.constantFrom("甲", "乙丙", " ", "*强调*", "**粗**", "~~删~~", "`码 <V of=\"x\" />`", "\\<V of=\"y\" />", "评级 <A 级", "a < b", "<br>", "[链](u)", String.fromCharCode(0xe000), "|", "\\|");
    const address = fc.constantFrom("panel.a", "panel.魔力", "att.态度[e1].称呼", "entry.name", "text[b1]");
    // 表格的单元格里不放裸的 `|`（那会多切出一格、被 Markdown 丢掉，属于另一条用例）；标签属性里的 `||` 照放。
    const cellWord = word.filter((text) => !text.includes("|"));
    const tagWith = (words: fc.Arbitrary<string>) =>
        fc.oneof(
            address.map((of) => `<V of="${of}" />`),
            address.map((of) => `<V entry="e2" of="${of}" />`),
            fc.constantFrom("<V expr=\"panel.a + 1\" />", "<V expr=\"percent(panel.a, panel.b)\" />", "<V expr=\"panel.a > 0 ? '有 < 无' : '|'\" />"),
            fc.constantFrom("<Ref id=\"e2\" />", "<Image src=\"a.png\" alt=\"说 *明*\" />", "<Image of=\"panel.图\" />"),
            fc.tuple(fc.array(words, {maxLength: 3}), fc.array(words, {maxLength: 3})).map(([yes, no]) => `<If test="panel.a || panel.b">${yes.join("")}<Else />${no.join("")}</If>`),
        );
    const line = fc.array(fc.oneof(word, tagWith(word)), {minLength: 1, maxLength: 6}).map((parts) => parts.join(""));
    const cell = fc.array(fc.oneof(cellWord, tagWith(cellWord)), {minLength: 1, maxLength: 4}).map((parts) => parts.join(""));
    const block = fc.oneof(line, line.map((text) => `- ${text}`), line.map((text) => `> ${text}`), line.map((text) => `# ${text}`), fc.tuple(cell, cell).map(([a, b]) => `| 名 | 值 |\n|---|---|\n| ${a} | ${b} |`));
    const document = fc.array(block, {minLength: 1, maxLength: 4}).map((blocks) => blocks.join("\n\n"));
    const decoration = fc.string({unit: fc.constantFrom("a", "名", "\"", "<", ">", "&", "\n", "|", "`", "*", "\\", String.fromCharCode(0xe001)), maxLength: 8});
    const value = fc.oneof(fc.integer(), fc.constant(null), fc.boolean(), decoration);

    it("每个标签恰好一个去处，分词还原后拼起来等于原文、没有残留的占位", () => {
        fc.assert(
            fc.property(document, (source) => {
                const parsed = parseEntryText(source);
                // 顶层单元的原文依次拼起来就是原文；只有行尾的空白例外：`marked` 把列表最后一行行尾的空白写成换行（不遮罩时一样）。
                const trimmed = (text: string) => text.replace(/[ \t]+$/gmu, "").replace(/\n+$/u, "");
                expect(trimmed(parsed.tokens.map((token) => token.raw).join(""))).toBe(trimmed(source));
                // 还原完整：词法单元里的私用区字只能是原文里本来就有的；占位的填充字（原文里没有）一个也不剩。
                const privateUse = (text: string) => new Set([...text].filter((char) => char >= String.fromCharCode(0xe000) && char <= String.fromCharCode(0xf8ff)));
                expect([...privateUse(JSON.stringify(parsed.tokens))]).toEqual([...privateUse(source)]);
                for (const entry of parsed.tags) expect(entry.place).not.toBe("lost");
            }),
            {numRuns: 300},
        );
    });

    it("去值(带值写法(源文)) 逐字等于源文；带值写法里的标签与源文的落点相同", () => {
        fc.assert(
            fc.property(document, fc.array(fc.tuple(value, decoration), {minLength: 1, maxLength: 4}), (source, picks) => {
                const parsed = parseEntryText(source);
                fc.pre(checkEntryText(parsed).length === 0 && canonicalEntryText(parsed) === source);
                const pick = (tag: EntryTag) => picks[tag.index % picks.length] as [unknown, string];
                const text = decorateEntryText(parsed, (tag): Decoration | null => {
                    const [raw, label] = pick(tag);
                    if (tag.name === "V") return {attributes: [["label", label]], content: agentJson(raw)};
                    if (tag.name === "If" && tag.kind === "open") return {attributes: [["value", JSON.stringify(raw === null ? null : Boolean(raw))]]};
                    if (tag.name === "Ref") return {attributes: [["name", label]]};
                    if (tag.name === "Image") return {attributes: [["path", label]]};
                    return null;
                });
                expect(parseEntryText(text).tags.map((entry) => `${entry.name} ${entry.place}`)).toEqual(parsed.tags.map((entry) => `${entry.name} ${entry.place}`));
                expect(stripEntryText(text)).toBe(source);
            }),
            {numRuns: 300},
        );
    });
});
