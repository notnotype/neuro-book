/**
 * 编辑器与内核读条目主文字一致（docs/specs/canon/rendering.md 输出 21）：同一段文字经章节编辑器的编解码器（核心语法加条目语法模块，
 * 不读 frontmatter）读出的条目节点，与内核认出的活的标签逐个相同；编辑器原样写回逐字不变，整篇重写写出的文字过得了内核的写入检查、
 * 活的标签不变。用真实的编解码器与内核文法，没有替身。
 */

import {getSchema} from "@tiptap/core";
import type {Node as PMNode} from "@tiptap/pm/model";
import {describe, expect, it} from "bun:test";
import fc from "fast-check";

import {checkEntryText, parseEntryText} from "@notnotype/nb-canon/grammar";
import {codecFor, coreSyntax, createMarkdownLanguage} from "@notnotype/nb-markdown/language";

import {ENTRY_TAG_NODE, entrySyntax} from "./entry-syntax";

const language = createMarkdownLanguage([entrySyntax, coreSyntax], {frontmatter: false});
const schema = getSchema([...language.extensions]);
const codec = codecFor(schema, language);

/** 文档里的条目节点（按文档顺序）与原样节点的个数。 */
function nodesOf(doc: PMNode): {tags: string[]; raw: number} {
    const tags: string[] = [];
    let raw = 0;
    doc.descendants((node) => {
        if (node.type.name === ENTRY_TAG_NODE) tags.push(node.attrs.source as string);
        if (node.type.name === "rawBlock" || node.type.name === "rawInline") raw += 1;
    });
    return {tags, raw};
}

const liveOf = (source: string): string[] => parseEntryText(source).tags.filter((tag) => tag.place === "live").map((tag) => source.slice(tag.start, tag.end));
const problemsOf = (source: string): string[] => checkEntryText(parseEntryText(source)).map((problem) => problem.code);

/** 读、原样写回、整篇重写，交回三样。 */
function roundTrip(source: string) {
    const read = codec.read(source);
    const kept = codec.write(read.doc, read.map);
    const rewritten = codec.write(read.doc, codec.read("").map);
    if (!kept.ok || !rewritten.ok) throw new Error(`write failed for ${JSON.stringify(source)}`);
    return {nodes: nodesOf(read.doc), kept: kept.text, rewritten: rewritten.text};
}

describe("编辑器与内核读法一致（输出 21）", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
        ["段落、强调、链接文字", "魔力 <V of=\"panel.魔力\" />，**<V of=\"panel.b\" />** [看 <Ref id=\"e2\" />](u)"],
        ["列表与引用", "- 项 <V of=\"panel.a\" />\n  续 <V of=\"panel.b\" />\n\n> 引 <Ref id=\"e1\" />\n> 续 <If test=\"panel.a > 0\">有<Else />无</If>"],
        ["表格里带 `||` 的条件", "| 条件 | 值 |\n|---|---|\n| <If test=\"panel.a || panel.b\">有<Else />无</If> | <V of=\"panel.c\" /> |"],
        ["表格单元格里的 <br>", "| a | b |\n|---|---|\n| 甲<br>乙 <V of=\"panel.a\" /> | 丙 |"],
        ["开头的 `---`（不读 frontmatter）", "---\n<V of=\"panel.a\" />\n---\n\n正文"],
        ["列表项与引用里只有 <br> 的一行", "- 甲\n\n  <br>\n\n> 乙\n>\n> <br>"],
        ["字面的标签：代码里、转义的", "写法是 `<V of=\"panel.魔力\" />` 与 \\<V of=\"panel.a\" />，正文 <V of=\"panel.b\" />"],
        ["`<` 加大写字母与空白、没有 `>` 的纯文字", "评级 <A 级，<V 是一个字母，a < b，1<2"],
        ["行首是标签的一行不是 HTML 块", "<V of=\"panel.a\" /> 开头\n\n<Ref id=\"e2\" />"],
        ["标题与私用区的字", `# 标题 <V of="panel.a" />\n\n甲${String.fromCharCode(0xe000)}乙`],
        ["表格单元格里的行内代码写着带 `||` 的条件", "| 名 |\n| --- |\n| `<If test=\"a || b\">` 与 <V of=\"panel.a\" /> |"],
    ];
    for (const [name, source] of cases) {
        it(name, () => {
            expect(problemsOf(source)).toEqual([]);
            const {nodes, kept, rewritten} = roundTrip(source);
            expect(nodes.tags).toEqual(liveOf(source));
            expect(nodes.raw).toBe(0);
            expect(kept).toBe(source);
            expect(problemsOf(rewritten)).toEqual([]);
            expect(liveOf(rewritten)).toEqual(liveOf(source));
        });
    }

    it("从文档写出：加粗、表格里的写坏的标签与 `</If` 也带转义，过得了内核的检查（完全转义的试撤撤不掉它）", () => {
        const bold = schema.marks.bold!.create();
        const texts = ["<V of=\"a*", "</If 与 *号", "<Ref id=\"e2"];
        for (const text of texts) {
            const doc = schema.nodes.doc!.create(null, schema.nodes.paragraph!.create(null, schema.text(text, [bold])));
            const written = codec.write(doc, codec.read("").map);
            expect(written.ok).toBe(true);
            const output = written.ok ? written.text : "";
            expect([output, problemsOf(output)]).toEqual([output, []]);
            expect(codec.read(output).doc.textContent).toBe(text);
        }
    });

    it("编辑器里文字里的 `<A`、`</If>` 写出来带转义，内核当文字", () => {
        const doc = schema.nodes.doc!.create(null, schema.nodes.paragraph!.create(null, schema.text("评级 <A 级，写法 </If> 与 <V of=\"x\" />")));
        const written = codec.write(doc, codec.read("").map);
        expect(written.ok && written.text).toBe("评级 \\<A 级，写法 \\</If> 与 \\<V of=\"x\" />");
        const text = written.ok ? written.text : "";
        expect(problemsOf(text)).toEqual([]);
        expect(liveOf(text)).toEqual([]);
        expect(codec.read(text).doc.textContent).toBe("评级 <A 级，写法 </If> 与 <V of=\"x\" />");
    });

    // 与内核文法测试同一类的随机主文字：标签夹在正文的各种写法里。
    const word = fc.constantFrom("甲", "乙丙", " ", "*强调*", "**粗**", "~~删~~", "`码 <V of=\"x\" />`", "\\<V of=\"y\" />", "评级 <A 级", "a < b", "[链](u)", String.fromCharCode(0xe000));
    const tag = fc.oneof(
        fc.constantFrom("<V of=\"panel.a\" />", "<V entry=\"e2\" of=\"att.态度[e1].称呼\" />", "<V expr=\"panel.a > 0 ? '有 < 无' : '|'\" />", "<Ref id=\"e2\" />", "<Image src=\"a.png\" alt=\"说明\" />"),
        fc.tuple(fc.array(word, {maxLength: 3}), fc.array(word, {maxLength: 3})).map(([yes, no]) => `<If test="panel.a || panel.b">${yes.join("")}<Else />${no.join("")}</If>`),
    );
    const line = fc.array(fc.oneof(word, tag), {minLength: 1, maxLength: 6}).map((parts) => parts.join("").trim()).filter((text) => text !== "");
    const block = fc.oneof(line, line.map((text) => `- ${text}`), line.map((text) => `> ${text}`), line.map((text) => `## ${text}`), fc.tuple(line, line).map(([a, b]) => `| 名 | 值 |\n|---|---|\n| ${a} | ${b} |`));
    const document = fc.array(block, {minLength: 1, maxLength: 4}).map((blocks) => blocks.join("\n\n"));

    it("随机的主文字：条目节点与内核的活标签逐个相同，原样写回不变，整篇重写过写入检查", () => {
        fc.assert(
            fc.property(document, (source) => {
                fc.pre(problemsOf(source).length === 0);
                const {nodes, kept, rewritten} = roundTrip(source);
                expect(nodes.tags).toEqual(liveOf(source));
                expect(kept).toBe(source);
                expect(problemsOf(rewritten)).toEqual([]);
                expect(liveOf(rewritten)).toEqual(liveOf(source));
            }),
            {numRuns: 300},
        );
    });
});
