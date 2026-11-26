/**
 * 语言的两项选项（docs/specs/workspace/markdown-syntaxes.md 的“可选的原子”，条目的主文字用）：不读 frontmatter 时开头的
 * `---…---` 照 Markdown 读、写回不变；模块的转义规则让写出的文字里会被认成原子开头的写法带上反斜杠，读回不变。
 */

import {getSchema} from "@tiptap/core";
import {describe, expect, it} from "bun:test";

import {createMarkdownLanguage} from "../language";
import {coreSyntax} from "../syntax/core";
import type {MarkdownSyntax} from "../syntax/types";
import {codecFor} from "./codec";

function codecOf(syntaxes: ReadonlyArray<MarkdownSyntax>, frontmatter: boolean) {
    const language = createMarkdownLanguage(syntaxes, {frontmatter});
    const schema = getSchema([...language.extensions]);
    return {codec: codecFor(schema, language), schema};
}

/** 只给转义规则的模块：`<` 紧跟大写字母会被认成原子的开头。 */
const escaping: MarkdownSyntax = {name: "escape-test", extensions: [], atomEscape: (text, index) => text[index] === "<" && /[A-Z]/u.test(text[index + 1] ?? "")};

describe("语言的选项", () => {
    it("不读 frontmatter：开头的 `---…---` 是分割线与正文，原样写回逐字不变，整篇重写也不改成 `***`", () => {
        const {codec} = codecOf([coreSyntax], false);
        const source = "---\n第一节\n\n---\n\n第二节";
        const read = codec.read(source);
        expect(read.doc.attrs.frontmatter ?? null).toBe(null);
        expect(read.doc.firstChild?.type.name).toBe("horizontalRule");
        const kept = codec.write(read.doc, read.map);
        expect(kept.ok && kept.text).toBe(source);
        // 不带来源的整篇重写按规范的间隔写（分割线后补空行），开头仍是 `---`。
        const rewritten = codec.write(read.doc, codec.read("").map);
        expect(rewritten.ok && rewritten.text).toBe("---\n\n第一节\n\n---\n\n第二节");
    });

    it("读 frontmatter（缺省）：开头的 `---…---` 仍拆成文件头", () => {
        const {codec} = codecOf([coreSyntax], true);
        const read = codec.read("---\na: 1\n---\n正文");
        expect(read.doc.attrs.frontmatter).toBe("---\na: 1\n---\n");
    });

    it("转义规则：文字里的 `<A` 写成 `\\<A`，读回是同样的文字；规则不认的 `<a` 照旧", () => {
        const {codec, schema} = codecOf([escaping, coreSyntax], true);
        const doc = schema.nodes.doc!.create(null, schema.nodes.paragraph!.create(null, schema.text("评级 <A 级，小写 <a 级")));
        const written = codec.write(doc, codec.read("").map);
        expect(written.ok && written.text).toBe("评级 \\<A 级，小写 <a 级");
        const again = codec.read(written.ok ? written.text : "");
        expect(again.doc.textContent).toBe("评级 <A 级，小写 <a 级");
    });
});
