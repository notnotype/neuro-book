/**
 * Markdown 保存时保持原文字节（docs/specs/workbench/editor.md 输出 19）：frontmatter 按原始偏移拆分；按行三方合并只把
 * 编辑过的行换成编辑器的写法。真实场景用 Tiptap 的 MarkdownManager 与编辑器同一组方言扩展制造 base 与 theirs。
 */

import {describe, expect, it} from "bun:test";

import {MarkdownManager} from "@tiptap/markdown";
import type {JSONContent} from "@tiptap/core";

import {createMarkdownDialectExtensions} from "./markdown-dialect-extensions";
import {mergeSource, splitFrontmatter} from "./source-merge";

describe("frontmatter 的拆分", () => {
    it("按原始偏移切出前缀：CRLF、BOM、闭合线在文件末尾都原样保留，正文是其余部分", () => {
        expect(splitFrontmatter("---\r\ntitle: 第一章\r\n---\r\n\r\n正文\r\n")).toEqual({prefix: "---\r\ntitle: 第一章\r\n---\r\n", body: "\r\n正文\r\n"});
        expect(splitFrontmatter("\uFEFF---\ntitle: x\n---\n正文")).toEqual({prefix: "\uFEFF---\ntitle: x\n---\n", body: "正文"});
        expect(splitFrontmatter("---\ntitle: x\n---")).toEqual({prefix: "---\ntitle: x\n---", body: ""});
        expect(splitFrontmatter("---\n---\n正文")).toEqual({prefix: "---\n---\n", body: "正文"});
    });

    it("没有 frontmatter、没有闭合线、分隔线不在开头：整段都是正文（BOM 除外）", () => {
        expect(splitFrontmatter("# 标题\n")).toEqual({prefix: "", body: "# 标题\n"});
        expect(splitFrontmatter("---\ntitle: x\n正文")).toEqual({prefix: "", body: "---\ntitle: x\n正文"});
        expect(splitFrontmatter("\n---\na: 1\n---\n")).toEqual({prefix: "", body: "\n---\na: 1\n---\n"});
        expect(splitFrontmatter("\uFEFF正文")).toEqual({prefix: "\uFEFF", body: "正文"});
    });
});

describe("按行三方合并", () => {
    it("theirs 与 base 相同：原样返回原文", () => {
        expect(mergeSource("* a\r\n* b\r\n", "- a\n- b\n", "- a\n- b\n")).toBe("* a\r\n* b\r\n");
    });

    it("只把编辑过的行换成编辑器的写法；规范化造成的差异保留原文；原文的换行符逐行保留，新行用主导换行符", () => {
        const ours = "* 甲\r\n* 乙\r\n\r\n第一段\r\n\r\n第二段\r\n";
        const base = "- 甲\n- 乙\n\n第一段\n\n第二段\n";
        expect(mergeSource(ours, base, "- 甲\n- 乙\n\n第一段（改）\n\n第二段\n")).toBe("* 甲\r\n* 乙\r\n\r\n第一段（改）\r\n\r\n第二段\r\n");
        expect(mergeSource(ours, base, "- 甲\n- 乙\n\n第一段\n\n新段\n\n第二段\n")).toBe("* 甲\r\n* 乙\r\n\r\n第一段\r\n\r\n新段\r\n\r\n第二段\r\n");
        expect(mergeSource(ours, base, "- 甲\n- 乙\n\n第二段\n")).toBe("* 甲\r\n* 乙\r\n\r\n第二段\r\n");
    });

    it("换行符混用的原文：没改的行各自保留自己的换行符", () => {
        expect(mergeSource("a\r\nb\nc\r\nd\r\n", "a\nb\nc\nd", "a\nb\nc\nD")).toBe("a\r\nb\nc\r\nD\r\n");
    });

    it("两边都改的区域取编辑后的写法；末尾换行的有无跟着编辑结果", () => {
        expect(mergeSource("* 甲\n", "- 甲\n", "- 甲甲\n")).toBe("- 甲甲\n");
        expect(mergeSource("a\nb", "a\nb", "a\nb\n")).toBe("a\nb\n");
        expect(mergeSource("a\nb\n", "a\nb\n", "a\nb")).toBe("a\nb");
        expect(mergeSource("", "", "新")).toBe("新");
    });

    it("真实的方言章节：打开后不编辑字节不变；编辑一个段落后只有那一行变化", () => {
        const manager = new MarkdownManager({extensions: createMarkdownDialectExtensions()});
        const source = [
            "---",
            "title: 第三章",
            "tags: [雨, 夜]",
            "---",
            "",
            "# 第三章",
            "",
            "* 线索一",
            "* 线索二",
            "",
            "她念出<ruby>临川<rt>línchuān</rt></ruby>这个名字。",
            "",
            "<align value=\"center\">——</align>",
            "",
            "她抬头<comment body=\"节奏\">看了他一眼</comment>。",
            "",
            "雨下了一整夜。",
            "",
        ].join("\r\n");
        const {prefix, body} = splitFrontmatter(source);
        expect(prefix).toBe("---\r\ntitle: 第三章\r\ntags: [雨, 夜]\r\n---\r\n");
        const parsed = manager.parse(body);
        const base = manager.serialize(parsed);
        // 不编辑：编辑器的序列化就是 base，保存原样返回原文。
        expect(prefix + mergeSource(body, base, manager.serialize(parsed))).toBe(source);

        const edited = structuredClone(parsed);
        const last = (edited.content ?? []).findLast((node: JSONContent) => node.type === "paragraph" && JSON.stringify(node).includes("雨下了一整夜"));
        if (last === undefined) throw new Error("没有找到最后一段");
        last.content = [{type: "text", text: "雨停了。"}];
        const saved = prefix + mergeSource(body, base, manager.serialize(edited));
        const before = source.split("\r\n");
        const after = saved.split("\r\n");
        expect(after).toHaveLength(before.length);
        expect(before.flatMap((line, index) => (line === after[index] ? [] : [[line, after[index]]]))).toEqual([["雨下了一整夜。", "雨停了。"]]);
    });
});
