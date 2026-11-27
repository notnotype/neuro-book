/**
 * 语言的两项选项（docs/specs/workspace/markdown-syntaxes.md 的“可选的原子”，条目的主文字用）：不读 frontmatter 时开头的
 * `---…---` 照 Markdown 读、写回不变；模块的转义规则让写出的文字里会被认成原子开头的写法带上反斜杠，读回不变。
 */

import {getSchema, Node} from "@tiptap/core";
import {describe, expect, it} from "bun:test";

import {atomAt, isAtomIdentity} from "../../marked/lexing";
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

/** 带原子的模块：`<大写名 …>` 是原子（范围不含两头的尖括号），读成行内原子节点 `tagAtom`，写回原文。 */
const atomNode = Node.create({name: "tagAtom", group: "inline", inline: true, atom: true, addAttributes: () => ({source: {default: ""}}), renderHTML: ({node}) => ["span", {}, node.attrs.source as string]});
const tagging: MarkdownSyntax = {
    name: "tag-test",
    extensions: [atomNode],
    atoms: (source) => [...source.matchAll(/<[A-Z][^<>\n]*>/gu)].map((matched) => ({from: matched.index + 1, to: matched.index + matched[0].length - 1})),
    marked: [{
        extensions: [{
            name: "tagAtom",
            level: "inline",
            start: (src: string) => {
                for (let at = src.indexOf("<"); at >= 0; at = src.indexOf("<", at + 1)) if (isAtomIdentity(src[at + 1])) return at;
                return undefined;
            },
            tokenizer(src: string) {
                if (src[0] !== "<" || !isAtomIdentity(src[1])) return undefined;
                const atom = atomAt(this.lexer, src[1] as string);
                if (atom === undefined) return undefined;
                const raw = src.slice(0, atom.to - atom.from + 2);
                return raw.endsWith(">") ? {type: "tagAtom", raw} : undefined;
            },
        }],
    }],
    readInline: {tagAtom: (token) => [{type: "tagAtom", attrs: {source: token.raw}}]},
    writeInline: {tagAtom: (node) => node.attrs.source as string},
};

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

    it("原子里的 `|` 不切表格的单元格：读成原子节点、不成原样块，整篇重写时不转义", () => {
        const {codec} = codecOf([tagging, coreSyntax], true);
        const source = "| 条件 | 值 |\n|---|---|\n| <If test=\"a || b\"> | x \\| y |";
        const read = codec.read(source);
        const atoms: string[] = [];
        let raw = 0;
        read.doc.descendants((node) => {
            if (node.type.name === "tagAtom") atoms.push(node.attrs.source as string);
            if (node.type.name === "rawBlock") raw += 1;
        });
        expect([atoms, raw]).toEqual([["<If test=\"a || b\">"], 0]);
        const rewritten = codec.write(read.doc, codec.read("").map);
        expect(rewritten.ok && rewritten.text).toBe("| 条件 | 值 |\n| --- | --- |\n| <If test=\"a || b\"> | x \\| y |");
    });
});
