import {describe, expect, it} from "vitest";
import {
    canEditContentFrontmatter,
    composeMarkdownFrontmatter,
    resolveMonacoLanguage,
    resolveWorkspaceFileExtension,
    splitMarkdownFrontmatter,
} from "nbook/shared/editor-workbench";

describe("editor-workbench", () => {

    it("映射 Monaco language，未知扩展回退 plaintext", () => {
        expect(resolveMonacoLanguage("data/config.json")).toBe("json");
        expect(resolveMonacoLanguage("scripts/run.ts")).toBe("typescript");
        expect(resolveMonacoLanguage("components/App.vue")).toBe("html");
        expect(resolveMonacoLanguage("styles/main.css")).toBe("css");
        expect(resolveMonacoLanguage("page/index.html")).toBe("html");
        expect(resolveMonacoLanguage("data/book.yaml")).toBe("yaml");
        expect(resolveMonacoLanguage("README.txt")).toBe("plaintext");
        expect(resolveMonacoLanguage("scratch")).toBe("plaintext");
        expect(resolveMonacoLanguage("binary.custom")).toBe("plaintext");
    });

    it("解析扩展名时不把隐藏文件名当扩展", () => {
        expect(resolveWorkspaceFileExtension(".gitignore")).toBe("");
        expect(resolveWorkspaceFileExtension("dir/name.MD")).toBe(".md");
    });

    it("frontmatter split/compose 不丢正文", () => {
        const source = "---\ntitle: 第一章\nstatus: draft\n---\n\n# 开头\n\n正文";
        const split = splitMarkdownFrontmatter(source);
        expect(split.frontmatterText).toBe("title: 第一章\nstatus: draft");
        expect(split.body).toBe("\n# 开头\n\n正文");
        expect(composeMarkdownFrontmatter(split.prefix, split.body)).toBe(source);
    });

    it("不完整 frontmatter 会保留原文", () => {
        const source = "---\ntitle: 未闭合\n正文";
        const split = splitMarkdownFrontmatter(source);
        expect(split.hasFrontmatter).toBe(false);
        expect(split.body).toBe(source);
    });

    it("只允许 manuscript/lorebook 内容节点编辑 frontmatter", () => {
        expect(canEditContentFrontmatter("manuscript/ch1/index.md", true, true)).toBe(true);
        expect(canEditContentFrontmatter("workspace/manuscript/ch1/index.md", true, true)).toBe(true);
        expect(canEditContentFrontmatter("lorebook/world/index.md", true, true)).toBe(true);
        expect(canEditContentFrontmatter("notes/index.md", true, true)).toBe(false);
        expect(canEditContentFrontmatter("manuscript/ch1/readme.txt", true, true)).toBe(false);
    });
});
