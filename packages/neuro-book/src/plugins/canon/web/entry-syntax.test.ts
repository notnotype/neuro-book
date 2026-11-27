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

import {Transform} from "@tiptap/pm/transform";

import {conditionCount, documentTags, ENTRY_IF_NODE, entrySyntax} from "./entry-syntax";
import type {EntryIfBranch} from "./entry-syntax";

const language = createMarkdownLanguage([entrySyntax, coreSyntax], {frontmatter: false});
const schema = getSchema([...language.extensions]);
const codec = codecFor(schema, language);

/** 文档里的活标签（条件展开）与原样节点的个数。 */
function nodesOf(doc: PMNode): {tags: string[]; raw: number} {
    let raw = 0;
    doc.descendants((node) => {
        if (node.type.name === "rawBlock" || node.type.name === "rawInline") raw += 1;
    });
    return {tags: documentTags(doc), raw};
}

/** 内核读出的配好对的条件个数。 */
function kernelConditions(source: string): number {
    let count = 0;
    const walk = (tokens: ReadonlyArray<Record<string, unknown>>): void => {
        for (const token of tokens) {
            if (token.type === "entryIf") count += 1;
            for (const key of ["tokens", "items"]) if (Array.isArray(token[key])) walk(token[key] as never);
            for (const row of [(token.header as unknown[] | undefined) ?? [], ...((token.rows as unknown[][] | undefined) ?? [])]) for (const cell of row as Array<{tokens: never}>) walk(cell.tokens);
            for (const branch of (token.branches as Array<{tokens: never}> | undefined) ?? []) walk(branch.tokens);
        }
    };
    walk(parseEntryText(source).tokens as never);
    return count;
}

const liveOf = (source: string): string[] => parseEntryText(source).tags.filter((tag) => tag.place === "live").map((tag) => source.slice(tag.start, tag.end));
const problemsOf = (source: string): string[] => checkEntryText(parseEntryText(source)).map((problem) => problem.code);

/** 读、原样写回、整篇重写，交回三样。 */
function roundTrip(source: string) {
    const read = codec.read(source);
    const kept = codec.write(read.doc, read.map);
    const rewritten = codec.write(read.doc, codec.read("").map);
    if (!kept.ok || !rewritten.ok) throw new Error(`write failed for ${JSON.stringify(source)}`);
    // 整篇重写以后读回来的文字与原来的相同（字面的标签、转义与表格里的 `|` 都不能变）。
    expect(codec.read(rewritten.text).doc.textContent).toBe(read.doc.textContent);
    // 编辑器合成的条件与内核配好对的条件一样多（进编辑时的运行时比较就是这一条）。
    expect(conditionCount(read.doc)).toBe(kernelConditions(source));
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
        ["表格单元格里转义的标签带 `||`，与带标点、实体的转义标签", "| 一 | 二 |\n| --- | --- |\n| \\<V expr=\"panel.a || panel.b\" /> | <Ref id=\"e2\" /> |\n\n\\<Image src=\"a.png\" alt=\"*粗* 与 `code`\" />"],
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
        // 300 次读写各一遍：负载高时会超过缺省的 5 秒。
    }, 30_000);
});

describe("条件合成一个节点（输出 17；w00055 t03 S1 的探针）", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
        ["段落", '魔力 <V of="panel.魔力" />。<If test="panel.魔力 >= 1000">还能变身。<Else />魔力不够。</If>后面'],
        ["ElseIf 与各支里的强调、代码、链接、取值、引用", '<If test="panel.a > 1">**强** `码` [链](u) <V of="panel.b" /><ElseIf test="panel.a > 0" />*斜* <Ref id="e2" /><Else /></If>'],
        ["列表项与引用", '- 项 <If test="panel.a">有<Else />无</If>\n  续\n\n> 引 <If test="panel.a">甲</If>'],
        ["标题", '# 标题 <If test="panel.a">甲<Else />乙</If>'],
        ["表格单元格里带 \\| 的支", '| 条件 | 值 |\n|---|---|\n| <If test="panel.a || panel.b">甲 \\| 乙<Else />丙</If> | <V of="panel.c" /> |'],
        ["一段里两个条件", '<If test="panel.a">一</If>与<If test="panel.b">二<Else />三</If>'],
        ["支两头有空格、以 - 或 # 开头", '前<If test="panel.a"> - 甲 <Else /># 乙</If>后'],
        ["整个条件包在加粗里", '前**<If test="panel.a">甲<Else />乙</If>**后'],
        ["支里连着几段加粗（读法给嵌套的同类标记）", '<If test="panel.a">**粗****粗****粗**<Else />乙</If>'],
    ];
    for (const [name, source] of cases) {
        it(name, () => {
            expect(problemsOf(source)).toEqual([]);
            const read = codec.read(source);
            expect(read.problems).toEqual([]);
            const conditions: Array<{node: PMNode; at: number}> = [];
            read.doc.descendants((node, at) => {
                if (node.type.name === ENTRY_IF_NODE) conditions.push({node, at});
            });
            expect(conditions.length).toBe(kernelConditions(source));
            const kept = codec.write(read.doc, read.map);
            expect(kept.ok && kept.text).toBe(source);
            // 整篇重写：写得出、过内核检查、条件个数不变、读回来的字相同。
            const rewritten = codec.write(read.doc, codec.read("").map);
            if (!rewritten.ok) throw new Error(`整篇重写写不出：${name}`);
            expect([problemsOf(rewritten.text), kernelConditions(rewritten.text), codec.read(rewritten.text).doc.textContent]).toEqual([[], conditions.length, read.doc.textContent]);
            // 改第一个条件的第一支（含表格里要转义的 `|` 与 `*`）：写得出、过内核检查、读回来是同样的字。
            const {node, at} = conditions[0]!;
            const branches = (node.attrs.branches as EntryIfBranch[]).map((branch, index) => (index === 0 ? {...branch, content: [{type: "text", text: "甲 | *乙*"}]} : branch));
            const edited = codec.write(new Transform(read.doc).setNodeMarkup(at, undefined, {...node.attrs, branches}).doc, read.map);
            if (!edited.ok) throw new Error(`改了一支写不出：${name}`);
            expect([problemsOf(edited.text), kernelConditions(edited.text)]).toEqual([[], conditions.length]);
            let reread: PMNode | null = null;
            codec.read(edited.text).doc.descendants((child) => {
                if (reread === null && child.type.name === ENTRY_IF_NODE) reread = child;
            });
            expect(JSON.stringify(((reread as PMNode | null)?.attrs.branches as EntryIfBranch[] | undefined)?.[0]?.content)).toBe(JSON.stringify([{type: "text", text: "甲 | *乙*"}]));
        });
    }

    it("套着的、没闭上的条件：内核拒收，富文本不打开（没闭上的不合成）", () => {
        for (const source of ['<If test="panel.a">甲<If test="panel.b">乙</If></If>', '<If test="panel.a">甲']) expect(problemsOf(source)).not.toEqual([]);
        expect(conditionCount(codec.read('<If test="panel.a">甲').doc)).toBe(0);
    });

    it("条件在富文本里复制粘贴：剪贴板里的整段属性读回同样的条件", () => {
        const read = codec.read('<If test="panel.a">**甲**<Else />乙</If>');
        let condition: PMNode | null = null;
        read.doc.descendants((node) => {
            if (condition === null && node.type.name === ENTRY_IF_NODE) condition = node;
        });
        const spec = schema.nodes[ENTRY_IF_NODE]!.spec;
        const rendered = spec.toDOM!(condition!) as unknown as [string, Record<string, string>];
        const element = {getAttribute: (name: string) => rendered[1][name] ?? null} as unknown as HTMLElement;
        const parsed = (spec.parseDOM![0]!.getAttrs as (element: HTMLElement) => Record<string, unknown>)(element);
        expect(parsed).toEqual((condition as PMNode | null)?.attrs as Record<string, unknown>);
    });
});
