/**
 * 旧写法到标签写法的转换器（w00055 t02 计划“关键设计”第 4 节）：写法对照表的每一行与转不了的几种。迁移完连同转换器一起删掉。
 */

import {describe, expect, it} from "bun:test";

import {convertLegacyBlock} from "../src/render/legacy/convert";

const converted = (source: string): string => {
    const result = convertLegacyBlock(source);
    if (!result.ok) throw new Error(result.problem);
    return result.source;
};

describe("旧写法转成标签写法", () => {
    const cases: ReadonlyArray<readonly [string, string, string]> = [
        ["单个地址", "魔力 {panel.魔力}/{panel.魔力上限}", "魔力 <V of=\"panel.魔力\" />/<V of=\"panel.魔力上限\" />"],
        ["名字、别名、一块原文、列表元素", "{entry.name}、{entry.aliases}、{text[b1]}、{att.态度[\"e1\"].称呼}", "<V of=\"entry.name\" />、<V of=\"entry.aliases\" />、<V of=\"text[b1]\" />、<V of=\"att.态度[e1].称呼\" />"],
        ["别的条目的字段", "哥哥 {ref(\"brother\").identity.外观}", "哥哥 <V entry=\"brother\" of=\"identity.外观\" />"],
        ["计算值：字符串换成单引号", "{panel.a >= 1} 与 {ref(\"e2\").panel.b == \"有\"}", "<V expr=\"panel.a >= 1\" /> 与 <V expr=\"ref('e2').panel.b == '有'\" />"],
        ["顶层的三元式写成 If，各支的字写成正文", "{panel.魔力 >= 1000 ? \"还能变身。\" : \"魔力不够*变身*。\"}", "<If test=\"panel.魔力 >= 1000\">还能变身。<Else />魔力不够\\*变身\\*。</If>"],
        ["else 支还是三元式的接成 ElseIf；支里的字段与数", "{panel.a > 10 ? panel.b : panel.a > 0 ? 1000 : false}", "<If test=\"panel.a > 10\"><V of=\"panel.b\" /><ElseIf test=\"panel.a > 0\" />1,000<Else />否</If>"],
        ["运算里面的三元式整个写成 expr", "{(panel.a > 0 ? 1 : 0) >= panel.b}", "<V expr=\"(panel.a > 0 ? 1 : 0) >= panel.b\" />"],
        ["只含注释的表达式去掉", "甲{/* 待补 */}乙", "甲乙"],
        ["Ref 写成规范写法", "<Ref id='e2' /> 与 <Ref id=\"e3\"/>", "<Ref id=\"e2\" /> 与 <Ref id=\"e3\" />"],
        ["Image 的 src 是地址时写成 of", "<Image src={panel.头像} alt=\"头像\" /> <Image src=\"a.png\" />", "<Image of=\"panel.头像\" alt=\"头像\" /> <Image src=\"a.png\" />"],
        ["别的字逐字不动：转义的花括号、代码", "他说 \\{+5} 与 `{panel.a}`\n\n- 列表 {panel.a}", "他说 \\{+5} 与 `{panel.a}`\n\n- 列表 <V of=\"panel.a\" />"],
    ];
    for (const [name, source, expected] of cases) it(name, () => expect(converted(source)).toBe(expected));

    it("注释的个数交回", () => {
        expect(convertLegacyBlock("{/* 一 */}{/* 二 */}正文")).toEqual({ok: true, source: "正文", comments: 2});
    });

    const failures: ReadonlyArray<readonly [string, string, string]> = [
        ["字符串里有双引号", "{panel.a == \"说\\\"好\\\"\"}", "double quote"],
        ["旧写法本身读不了", "{panel.a", "legacy parse failed"],
        ["Image 的 alt 是表达式", "<Image src=\"a.png\" alt={panel.说明} />", "alt expression"],
        ["Image 的 src 是别的条目的地址", "<Image src={ref(\"e2\").panel.头像} />", "not an address of this entry"],
        ["转完过不了新的检查（表达式里的注释）", "{panel.a /* 注 */ >= 1}", "fails the new check"],
    ];
    for (const [name, source, message] of failures) {
        it(`转不了：${name}`, () => {
            const result = convertLegacyBlock(source);
            expect(result.ok).toBe(false);
            expect(!result.ok && result.problem).toContain(message);
        });
    }
});
