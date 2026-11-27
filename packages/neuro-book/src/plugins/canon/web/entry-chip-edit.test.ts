/**
 * 点开小块以后能改什么（canon/author-ui.md 输出 48 的“改小块”）：读出浮层的几项、改完拼回原文；写得对不对由写入前的检查判断，见
 * `EntryRichInput.dom.test.ts`。
 */

import {describe, expect, it} from "bun:test";

import {lexTags} from "@notnotype/nb-canon/grammar";

import {attributeOf, draftOf, quoteProblem, sourceOf, withAttribute, withElseIf} from "./entry-chip-edit";

describe("读出小块与拼回原文", () => {
    it.each([
        ['<V of="panel.魔力" />', "value"],
        ['<V entry="e2" of="panel.好感度" />', "value"],
        ['<V expr="panel.魔力 * 2" />', "calc"],
        ['<Ref id="e2" />', "ref"],
        ['<If test="panel.魔力 >= 1000">强<ElseIf test="panel.魔力 > 0" />弱，还剩 <V of="panel.魔力" /><Else />没了</If>', "if"],
        ['<If test="a">只有一支</If>', "if"],
        ['<Image src="a.png" alt="脚印" />', "other"],
        ["<Gauge />", "other"],
        ["</If>", "other"],
    ] as const)("%s 读成 %s，原样拼回", (source, kind) => {
        const draft = draftOf(source);
        expect(draft.kind).toBe(kind);
        expect(sourceOf(draft)).toBe(source);
    });

    it("条件按最外层的分支标签切开各支，支里的取值留在文字里", () => {
        const draft = draftOf('<If test="a">甲 <V of="p.q" /><ElseIf test="b" />乙<Else />丙</If>');
        expect(draft.kind === "if" ? draft.branches : null).toEqual([
            {test: "a", text: '甲 <V of="p.q" />'},
            {test: "b", text: "乙"},
            {test: null, text: "丙"},
        ]);
    });

    it("“否则”后面还有支、套着条件的不是浮层能改的形状", () => {
        expect(draftOf('<If test="a">甲<Else />乙<ElseIf test="b" />丙</If>').kind).toBe("other");
        expect(draftOf('<If test="a">甲<If test="b">乙</If></If>').kind).toBe("other");
    });

    it("改一项属性，别的属性原样留着、先后不变", () => {
        const draft = draftOf('<V expr="a + 1" format="percent" />');
        if (draft.kind !== "calc") throw new Error("expected calc");
        expect(sourceOf({...draft, attributes: withAttribute(draft.attributes, "expr", "a + 2")})).toBe('<V expr="a + 2" format="percent" />');
        expect(attributeOf({attributes: withAttribute(draft.attributes, "of", "p.q")}, "of")).toBe("p.q");
        expect(sourceOf({kind: "value", attributes: withAttribute([["entry", "e2"], ["of", "p.q"]], "entry", null)})).toBe('<V of="p.q" />');
    });

    it("加“否则如果”：在“否则”之前，判断抄第一支的；拼出来是一个条件", () => {
        const draft = draftOf('<If test="a > 1">甲<Else />乙</If>');
        if (draft.kind !== "if") throw new Error("expected if");
        const branches = withElseIf(draft.branches);
        expect(branches.map((branch) => branch.test)).toEqual(["a > 1", "a > 1", null]);
        const source = sourceOf({...draft, branches});
        expect(source).toBe('<If test="a > 1">甲<ElseIf test="a > 1" /><Else />乙</If>');
        expect(lexTags(source).map((tag) => tag.name)).toEqual(["If", "ElseIf", "Else", "If"]);
        expect(withElseIf([{test: "a", text: "甲"}]).map((branch) => branch.test)).toEqual(["a", "a"]);
    });

    it("属性值里有双引号算问题（会把标签切坏），单引号不算", () => {
        expect(quoteProblem({kind: "calc", attributes: [["expr", 'a == "x"']]})).toBe(true);
        expect(quoteProblem({kind: "calc", attributes: [["expr", "a == 'x'"]]})).toBe(false);
        expect(quoteProblem({kind: "if", attributes: [["test", "a"]], branches: [{test: "a", text: "x"}, {test: 'b == "y"', text: ""}]})).toBe(true);
        expect(quoteProblem({kind: "if", attributes: [["test", "a"]], branches: [{test: "a", text: '他说"走"'}]})).toBe(false);
    });
});
