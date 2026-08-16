import {describe, expect, it} from "vitest";
import {stripFrontmatterBody} from "nbook/server/utils/frontmatter-document";

describe("stripFrontmatterBody", () => {
    it("剥离 LF 与 CRLF frontmatter，返回正文", () => {
        expect(stripFrontmatterBody("---\ntitle: a\n---\n正文")).toBe("正文");
        expect(stripFrontmatterBody("---\r\ntitle: a\r\n---\r\n正文")).toBe("正文");
    });

    it("frontmatter 后的空行保留在正文开头", () => {
        expect(stripFrontmatterBody("---\ntitle: a\n---\n\n正文")).toBe("\n正文");
    });

    it("多字段 frontmatter 整体剥离", () => {
        expect(stripFrontmatterBody("---\ntitle: a\ntags:\n  - x\n---\n正文")).toBe("正文");
    });

    it("无 frontmatter、未闭合分隔符或 frontmatter 前有内容时原样返回", () => {
        expect(stripFrontmatterBody("正文直接开始")).toBe("正文直接开始");
        expect(stripFrontmatterBody("---\ntitle: a\n正文")).toBe("---\ntitle: a\n正文");
        expect(stripFrontmatterBody("x\n---\ntitle: a\n---\n正文")).toBe("x\n---\ntitle: a\n---\n正文");
    });

    it("结束分隔符位于末尾且无换行时按权威解析器语义剥离", () => {
        expect(stripFrontmatterBody("---\ntitle: a\n---")).toBe("");
    });
});
