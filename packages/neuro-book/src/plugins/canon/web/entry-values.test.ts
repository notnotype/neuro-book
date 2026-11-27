/**
 * 富文本里小块的值（w00055 t03 计划“值怎么到小块上”）与写入前的检查（“编辑器一侧的条目语法”、canon.author-ui 输出 48）。值表是照
 * 内核的形状手写的（标签名与起点，canon.rendering 输出 7）；检查与写出用真实的内核文法与编解码器。
 */

import {getSchema} from "@tiptap/core";
import {Transform} from "@tiptap/pm/transform";
import {describe, expect, it} from "bun:test";

import {codecFor, coreSyntax, createMarkdownLanguage} from "@notnotype/nb-markdown/language";

import type {EntryTextValue} from "./components/entry-text";
import {baselineOf, checkedWrite, entryTextProblem} from "./entry-check";
import {documentTags, ENTRY_TAG_NODE, entrySyntax} from "./entry-syntax";
import {alignValues, tagHasValue, valueSequence} from "./entry-values";

/** 照内核的形状给源文里第 n 个某名字的标签一项值。 */
function valueAt(source: string, needle: string, item: Record<string, unknown>): EntryTextValue {
    const start = source.indexOf(needle);
    if (start < 0) throw new Error(`没有 ${needle}`);
    const name = /^<\/?([A-Za-z]+)/u.exec(needle)![1]!;
    return {tag: name, start, ...item} as unknown as EntryTextValue;
}

describe("一版源文里该有值的标签（canon.rendering 输出 7）", () => {
    const source = '魔力 <V of="panel.魔力" />，`<V of="panel.代码里" />`，<If test="panel.a">有<ElseIf test="panel.b" /><Ref id="e2" /><Else />无</If>';
    const values = [
        valueAt(source, '<V of="panel.魔力" />', {path: "panel.魔力", raw: 1200, display: "1,200"}),
        valueAt(source, '<If test="panel.a">', {result: false, taken: 1}),
        valueAt(source, '<ElseIf test="panel.b" />', {result: true}),
        valueAt(source, '<Ref id="e2" />', {id: "e2", name: "星瑾", deleted: false}),
    ];

    it("按先后列出活标签的原文与值：代码里的、Else、闭标签没有", () => {
        const sequence = valueSequence(source, values);
        if ("mismatch" in sequence) throw new Error(sequence.mismatch);
        expect(sequence.map((item) => item.source)).toEqual(['<V of="panel.魔力" />', '<If test="panel.a">', '<ElseIf test="panel.b" />', '<Ref id="e2" />']);
        expect(sequence[0]!.value).toBe(values[0]!);
    });

    it("值表对不上这一版源文（起点错了、多一项）：交回原因，不按位置猜", () => {
        expect("mismatch" in valueSequence(source, [{...values[0]!, start: 1} as EntryTextValue, ...values.slice(1)])).toBe(true);
        expect("mismatch" in valueSequence(source, [...values, ({tag: "V", start: 999, path: "x", raw: 1, display: "1"}) as unknown as EntryTextValue])).toBe(true);
    });

    it("哪些标签该有值", () => {
        expect(['<V of="a" />', '<If test="a">', '<ElseIf test="b" />', "<Else />", "</If>", '<Ref id="e2" />', '<StatusBar />'].map(tagHasValue)).toEqual([true, true, true, false, false, true, true]);
    });
});

describe("按原文把值对到文档里的标签", () => {
    const value = (display: string) => ({tag: "V", start: 0, raw: display, display}) as unknown as EntryTextValue;
    const a = {source: '<V of="panel.a" />', value: value("A")};
    const b = {source: '<V of="panel.b" />', value: value("B")};
    const c = {source: '<V of="panel.c" />', value: value("C")};
    const displays = (aligned: ReadonlyArray<EntryTextValue | undefined>) => aligned.map((item) => (item === undefined ? null : (item as {display: string}).display));

    it("相同的一一对上", () => {
        expect(displays(alignValues([a.source, b.source, c.source], [a, b, c]))).toEqual(["A", "B", "C"]);
    });

    it("中间新插了一个：新的没有值，前后的照样对上", () => {
        expect(displays(alignValues([a.source, '<V of="panel.new" />', b.source, c.source], [a, b, c]))).toEqual(["A", null, "B", "C"]);
    });

    it("中间改了一个、删了一个：改过的没有值，没改的对上", () => {
        expect(displays(alignValues([a.source, '<V of="panel.b2" />', c.source], [a, b, c]))).toEqual(["A", null, "C"]);
        expect(displays(alignValues([a.source, c.source], [a, b, c]))).toEqual(["A", "C"]);
    });

    it("顺序换了：按最长的一段对上，其余没有值", () => {
        expect(displays(alignValues([c.source, a.source, b.source], [a, b, c]))).toEqual([null, "A", "B"]);
    });

    it("同一个原文出现几次：各自对上一个", () => {
        expect(displays(alignValues([a.source, a.source, b.source], [a, a, b]))).toEqual(["A", "A", "B"]);
    });

    it("没有值表时全是没有值", () => {
        expect(displays(alignValues([a.source], []))).toEqual([null]);
    });
});

const language = createMarkdownLanguage([entrySyntax, coreSyntax], {frontmatter: false});
const schema = getSchema([...language.extensions]);
const codec = codecFor(schema, language);

describe("写入前的检查（canon.rendering 输出 1、19）", () => {
    it("没登记的标签：开始编辑时就有的放行，新写的报出行与列", () => {
        const stored = "状态 <StatusBar />";
        const baseline = baselineOf(stored);
        expect(entryTextProblem(stored, baseline)).toBeNull();
        expect(entryTextProblem(`${stored}\n\n仪表 <Gauge />`, baseline)).toEqual({line: 3, column: 4, message: expect.stringContaining("Gauge") as unknown as string});
        // 代码里的只是字面，不查。
        expect(entryTextProblem("写法 `<Gauge />`", baseline)).toBeNull();
    });

    it("写坏的标签、空的地址：报出原因", () => {
        expect(entryTextProblem('<V of="" />', new Set())?.line).toBe(1);
        expect(entryTextProblem("<If test=\"panel.a\">甲", new Set())).not.toBeNull();
    });

    it("改一个小块：写得出、过检查才交回文字；改坏了交回原因", () => {
        const source = '魔力 <V of="panel.魔力" />。';
        const read = codec.read(source);
        let at = -1;
        read.doc.descendants((node, pos) => {
            if (node.type.name === ENTRY_TAG_NODE) at = pos;
        });
        const good = checkedWrite(codec, new Transform(read.doc).setNodeMarkup(at, undefined, {source: '<V of="panel.上限" />'}).doc, read.map, new Set());
        expect(good).toEqual({ok: true, text: '魔力 <V of="panel.上限" />。'});
        const bad = checkedWrite(codec, new Transform(read.doc).setNodeMarkup(at, undefined, {source: '<V of="" />'}).doc, read.map, new Set());
        expect(bad.ok).toBe(false);
        // 写出的文字读不回同一个节点（原文不像一个标签）：写不出，没有行列可指。
        const broken = checkedWrite(codec, new Transform(read.doc).setNodeMarkup(at, undefined, {source: "不是标签"}).doc, read.map, new Set());
        expect(broken).toEqual({ok: false, problem: null});
        expect(documentTags(read.doc)).toEqual(['<V of="panel.魔力" />']);
    });
});
