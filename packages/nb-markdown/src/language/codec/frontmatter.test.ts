/**
 * frontmatter 在编辑器文档的属性上（docs/specs/workspace/markdown-dialect.md 输出 22）：读入放进属性，没编辑时逐字节写原文；
 * 换了属性只换正文前的那一段，正文字节不变；重载按新原文换属性；属性的改动走 ProseMirror 的历史，全选删除碰不到它；属性里
 * 放了不完整的原文时写不出，抢救正文把它留成文字。编解码器与 schema 是编辑器用的那一份，历史插件是 `@tiptap/pm` 里的
 * prosemirror-history，与编辑器的撤销是同一个库。种子固定，本地要换种子时设 `MARKDOWN_PROPERTY_SEED`。
 */

import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";

import {getSchema} from "@tiptap/core";
import {Fragment} from "@tiptap/pm/model";
import type {Node as PMNode} from "@tiptap/pm/model";
import {history, redo, undo} from "@tiptap/pm/history";
import {EditorState} from "@tiptap/pm/state";
import {Transform} from "@tiptap/pm/transform";
import {describe, expect, it} from "bun:test";
import fc from "fast-check";

import {defaultMarkdownLanguage} from "../syntax";
import {codecFor} from "./codec";
import {frontmatterOf} from "./read";
import {isWholeFrontmatter} from "./source";

const language = defaultMarkdownLanguage();
const schema = getSchema([...language.extensions]);
const codec = codecFor(schema, language);
const CORPUS = join(import.meta.dir, "corpus");
const corpus = readdirSync(CORPUS).filter((name) => name.endsWith(".md")).sort().map((name) => readFileSync(join(CORPUS, name), "utf8"));
const seed = Number(process.env.MARKDOWN_PROPERTY_SEED ?? 20261116);

function written(doc: PMNode, map: Parameters<typeof codec.write>[1]): string {
    const result = codec.write(doc, map);
    if (!result.ok) throw new Error(`写不出：${result.reason}`);
    return result.text;
}

function withAttr(doc: PMNode, frontmatter: string | null): PMNode {
    return new Transform(doc).setDocAttribute("frontmatter", frontmatter).doc;
}

/** 一段 frontmatter：开栏、几行 YAML（含注释、空行、长得像 `---` 却不是闭栏的行）、闭栏（后面可以有空白）。 */
const fenceLine = fc.constantFrom("a: 1", "标题: 长夜", "tags: [甲, 乙]", "# 注释", "", "list:", "  - x", "date: 2025-12-21", "k: '---'", "---x", "  ---");
const frontmatter = (eol: string): fc.Arbitrary<{readonly raw: string; readonly closedWithBreak: boolean}> =>
    fc.tuple(fc.array(fenceLine, {maxLength: 5}), fc.constantFrom("", " ", "\t"), fc.boolean()).map(([lines, trail, closedWithBreak]) => ({
        raw: `---${eol}${lines.map((line) => line + eol).join("")}---${trail}${closedWithBreak ? eol : ""}`,
        closedWithBreak,
    }));
const body = (eol: string): fc.Arbitrary<string> =>
    fc.oneof(
        fc.constantFrom("", eol, eol + eol, `甲${eol}`, `# 标题${eol}${eol}乙${eol}`, `---${eol}${eol}丙`, `  ${eol}丁`),
        fc.nat({max: corpus.length - 1}).map((index) => (corpus[index] as string).replace(/\n/gu, eol)),
    );
/**
 * 一篇带 frontmatter 的原文。frontmatter 与正文的换行符分别取，混用的文件也在其中。闭栏后没有换行只在文件到此为止时成立
 * （否则闭栏不独占一行，不是 frontmatter）。
 */
const source = fc.tuple(fc.constantFrom("", "\uFEFF"), fc.constantFrom("\n", "\r\n"), fc.constantFrom("\n", "\r\n")).chain(([bom, frontEol, bodyEol]) =>
    fc.tuple(frontmatter(frontEol), body(bodyEol)).map(([front, rest]) => ({bom, raw: front.closedWithBreak || rest === "" ? front.raw : front.raw + frontEol, body: rest})),
);

describe("读入", () => {
    it("frontmatter 原样放在文档的属性上，BOM 不在其中；没有 frontmatter 时为 null", () => {
        expect(frontmatterOf(codec.read("\uFEFF---\r\na: 1\r\n---\r\n正文\r\n").doc)).toBe("---\r\na: 1\r\n---\r\n");
        expect(frontmatterOf(codec.read("---\na: 1\n---").doc)).toBe("---\na: 1\n---");
        expect(frontmatterOf(codec.read("\uFEFF正文\n").doc)).toBeNull();
        expect(frontmatterOf(codec.read("---\na: 1\n正文\n").doc)).toBeNull();
    });
});

describe("写回（输出 22）", () => {
    it("没编辑：任意带 frontmatter 的文档逐字节写原文（BOM、CRLF、闭栏后没有换行、空 frontmatter、正文为空或只有空行）", () => {
        fc.assert(fc.property(source, ({bom, raw, body: rest}) => {
            const text = bom + raw + rest;
            const read = codec.read(text);
            expect(frontmatterOf(read.doc)).toBe(raw);
            expect(written(read.doc, read.map)).toBe(text);
        }), {seed, numRuns: 150});
    });

    it("换了 frontmatter：写出是 BOM、新的原文、原来的正文字节；新原文闭栏后没有换行而正文有内容时，补它自己的换行符", () => {
        const replacement = fc.constantFrom("\n", "\r\n").chain((eol) => frontmatter(eol).map((front) => ({...front, eol})));
        fc.assert(fc.property(source, replacement, ({bom, raw, body: rest}, next) => {
            expect(isWholeFrontmatter(next.raw)).toBe(true);
            const read = codec.read(bom + raw + rest);
            // 生成的正文只有空白时没有块：那段空白自己就在闭栏之后，不补。
            const glue = next.closedWithBreak || rest.trim() === "" ? "" : next.eol;
            expect(written(withAttr(read.doc, next.raw), read.map)).toBe(bom + next.raw + glue + rest);
        }), {seed, numRuns: 150});
    });

    it("不完整的原文（缺闭栏、中间有独占一行的 ---）不算 frontmatter", () => {
        fc.assert(fc.property(fc.constantFrom("\n", "\r\n").chain((eol) => fc.tuple(fc.constant(eol), frontmatter(eol))), fc.boolean(), ([eol, front], dropClose) => {
            const broken = dropClose ? front.raw.slice(0, front.raw.lastIndexOf("---")) : `${front.raw}${front.closedWithBreak ? "" : eol}---${eol}`;
            expect(isWholeFrontmatter(broken)).toBe(false);
        }), {seed, numRuns: 100});
    });

    it("闭栏后没有换行的 frontmatter 换进有正文的文档：闭栏后补一个换行，用 frontmatter 自己的换行符", () => {
        const read = codec.read("---\na: 1\n---\n甲\n");
        expect(written(withAttr(read.doc, "---\na: 2\n---"), read.map)).toBe("---\na: 2\n---\n甲\n");
        const crlf = codec.read("\uFEFF甲\r\n");
        expect(written(withAttr(crlf.doc, "---\r\na: 2\r\n---"), crlf.map)).toBe("\uFEFF---\r\na: 2\r\n---\r\n甲\r\n");
    });

    it("给没有 frontmatter 的文档加上、把有的去掉：只差正文前的那一段", () => {
        const plain = codec.read("甲\n\n乙\n");
        expect(written(withAttr(plain.doc, "---\n---\n"), plain.map)).toBe("---\n---\n甲\n\n乙\n");
        const fronted = codec.read("\uFEFF---\na: 1\n---\n甲\n");
        expect(written(withAttr(fronted.doc, null), fronted.map)).toBe("\uFEFF甲\n");
    });

    it("去掉 frontmatter 后正文开头的分隔线会和后面的 --- 配成 frontmatter：分隔线改写成 ***", () => {
        const read = codec.read("---\na: 1\n---\n---\n\n甲\n\n---\n");
        expect(written(withAttr(read.doc, null), read.map)).toBe("***\n\n甲\n\n---\n");
    });
});

describe("写不出时的抢救正文（editor 输出 61）", () => {
    // 段首是会开启 HTML 块的原样片段，哪一级写法都写不出（同 editing.test.ts）。
    const blocked = (text: string): PMNode => schema.nodes.paragraph!.create(null, [schema.nodes.rawInline!.create({raw: "<div>"}), schema.text(text)]);

    it("正文有写不出的块、frontmatter 闭栏后没有换行：抢救正文照样在闭栏后补换行", () => {
        const read = codec.read("---\na: 1\n---");
        const result = codec.write(read.doc.copy(Fragment.from(blocked("甲"))), read.map);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.fallback()).toBe("---\na: 1\n---\n\\<div>甲");
    });

    it("frontmatter 属性不是完整的一段：写不出；抢救正文把它的原文留成开头的几段文字，不再是 frontmatter", () => {
        const read = codec.read("甲\n");
        const result = codec.write(withAttr(read.doc, "---\na: 1\n"), read.map);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            const rescued = codec.read(result.fallback()).doc;
            expect(frontmatterOf(rescued)).toBeNull();
            expect(rescued.textBetween(0, rescued.content.size, "\n")).toBe("---\na: 1\n甲");
        }
        // 正文为空时写出走另一条路，同样挡下。
        const empty = codec.read("");
        expect(codec.write(withAttr(empty.doc, "---\n"), empty.map).ok).toBe(false);
    });
});

describe("编辑器里的属性", () => {
    const stateOf = (text: string) => {
        const read = codec.read(text);
        return {read, state: EditorState.create({doc: read.doc, plugins: [history()]})};
    };
    const run = (state: EditorState, command: typeof undo): EditorState => {
        let next = state;
        command(state, (tr) => {
            next = state.apply(tr);
        });
        return next;
    };

    it("改 frontmatter 进撤销历史：撤销写回原文，重做写回改后的", () => {
        const {read, state} = stateOf("---\na: 1\n---\n甲\n");
        const changed = state.apply(state.tr.setDocAttribute("frontmatter", "---\na: 2\n---\n"));
        expect(written(changed.doc, read.map)).toBe("---\na: 2\n---\n甲\n");
        const undone = run(changed, undo);
        expect(written(undone.doc, read.map)).toBe("---\na: 1\n---\n甲\n");
        expect(written(run(undone, redo).doc, read.map)).toBe("---\na: 2\n---\n甲\n");
    });

    it("全选删除只删正文，frontmatter 还在", () => {
        const {read, state} = stateOf("---\na: 1\n---\n甲\n\n乙\n");
        const cleared = state.apply(state.tr.delete(0, state.doc.content.size));
        expect(frontmatterOf(cleared.doc)).toBe("---\na: 1\n---\n");
        expect(written(cleared.doc, read.map)).toBe("---\na: 1\n---\n");
    });

    it("重载：只有 frontmatter 变了时换属性，正文的块还是原来的对象", () => {
        const read = codec.read("---\na: 1\n---\n甲\n\n乙\n");
        const tr = new Transform(read.doc);
        const map = codec.reload(tr, "---\na: 2\n---\n甲\n\n乙\n");
        expect(frontmatterOf(tr.doc)).toBe("---\na: 2\n---\n");
        expect(tr.doc.child(0)).toBe(read.doc.child(0));
        expect(tr.doc.child(1)).toBe(read.doc.child(1));
        expect(written(tr.doc, map)).toBe("---\na: 2\n---\n甲\n\n乙\n");
    });

    it("重载：外面去掉了 frontmatter，属性变成 null", () => {
        const read = codec.read("---\na: 1\n---\n甲\n");
        const tr = new Transform(read.doc);
        codec.reload(tr, "甲\n");
        expect(frontmatterOf(tr.doc)).toBeNull();
        expect(tr.doc.child(0)).toBe(read.doc.child(0));
    });
});
