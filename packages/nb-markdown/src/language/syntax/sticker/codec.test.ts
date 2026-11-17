/**
 * 表情写法的读写（docs/specs/agent/stickers.md 输出 21、23 与“表情写法”）：真实语言与编解码器。邻接汉字、字母时写得出读得回，
 * 留作文字的写法写成 `\:` 且同一块别处的写法不变。
 */
import {getSchema} from "@tiptap/core";
import type {JSONContent} from "@tiptap/core";
import type {Node as PMNode} from "@tiptap/pm/model";
import {Transform} from "@tiptap/pm/transform";
import {describe, expect, it} from "bun:test";

import {codecFor} from "../../codec/codec";
import {defaultMarkdownLanguage} from "..";

const language = defaultMarkdownLanguage();
const schema = getSchema([...language.extensions]);
const codec = codecFor(schema, language);

const paragraph = (source: string): JSONContent[] => ((codec.read(source).doc.toJSON().content ?? [])[0]?.content ?? []) as JSONContent[];
const sticker = (raw: string): PMNode => schema.nodes.sticker!.create({raw});
const text = (value: string): PMNode => schema.text(value);

/** 一篇新文档写出的正文；写不出时抛错。 */
function written(...content: PMNode[]): string {
    const doc = schema.nodes.doc!.create(null, [schema.nodes.paragraph!.create(null, content)]);
    const result = codec.write(doc, codec.read("").map);
    if (!result.ok) throw new Error(`写不出：${result.reason}`);
    return result.text;
}

/** 在原文第一段的末尾追加一些内容后写回（只有这一块被改过）。 */
function appended(source: string, ...content: PMNode[]): string {
    const read = codec.read(source);
    const doc = new Transform(read.doc).insert(read.doc.child(0).nodeSize - 1, content).doc;
    const result = codec.write(doc, read.map);
    if (!result.ok) throw new Error(`写不出：${result.reason}`);
    return result.text;
}

describe("读", () => {
    it("写法读成表情节点，紧挨汉字也认", () => {
        expect(paragraph("今天:开心:好\n")).toEqual([
            {type: "text", text: "今天"},
            {type: "sticker", attrs: {raw: ":开心:"}},
            {type: "text", text: "好"},
        ]);
        expect(paragraph(":lyra/害羞:\n")).toEqual([{type: "sticker", attrs: {raw: ":lyra/害羞:"}}]);
    });

    it("时间、转义的冒号、行内代码里的写法都是文字", () => {
        expect(paragraph("10:30:00\n")).toEqual([{type: "text", text: "10:30:00"}]);
        expect(paragraph("\\:开心:\n")).toEqual([{type: "text", text: ":开心:"}]);
        expect(paragraph("`:开心:`\n")).toEqual([{type: "text", text: ":开心:", marks: [{type: "code", attrs: {markdown: 1}}]}]);
    });

    it("不编辑时字节不变", () => {
        const source = "好:lyra/开心:和 _斜体_ :x:\n";
        const read = codec.read(source);
        const result = codec.write(read.doc, read.map);
        expect(result.ok && result.text).toBe(source);
    });
});

describe("写", () => {
    it("表情紧挨汉字、字母时写得出", () => {
        expect(written(text("好"), sticker(":开心:"))).toBe("好:开心:");
        expect(written(sticker(":开心:"), text("ab"))).toBe(":开心:ab");
        expect(written(sticker(":a:"), sticker(":b:"))).toBe(":a::b:");
    });

    it("留作文字的写法开头写成 \\:，读回仍是文字", () => {
        const out = written(text("打了 :abc: 不想要"));
        expect(out).toBe("打了 \\:abc: 不想要");
        expect(paragraph(out)).toEqual([{type: "text", text: "打了 :abc: 不想要"}]);
        expect(written(text(":a:b:"))).toBe("\\:a\\:b:");
    });

    it("同一块里加了留作文字的写法，别处的写法不变", () => {
        expect(appended("你好 _斜体_ 和 __粗体__\n", text(" :abc: 新增"))).toBe("你好 _斜体_ 和 __粗体__ \\:abc: 新增\n");
    });
});
