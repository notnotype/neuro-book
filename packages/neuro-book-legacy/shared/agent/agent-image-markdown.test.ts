import {describe, expect, it} from "vitest";
import {
    attachmentIdFromMarkdownTarget,
    attachmentMarkdownTarget,
    parseAgentImageMarkdown,
    serializeAgentImageMarkdown,
} from "nbook/shared/agent/agent-image-markdown";

describe("Agent 图片 Markdown", () => {
    it("按正文顺序解析文字、连续图片和重复图片", () => {
        const target = `workspace/.nbook/agent/attachments/sha256/aa/${"b".repeat(62)}`;
        const markdown = `前${serializeAgentImageMarkdown("一", target)}${serializeAgentImageMarkdown("二", target)}后`;

        expect(parseAgentImageMarkdown(markdown)).toEqual([
            {type: "text", text: "前"},
            {type: "image", label: "一", target, raw: serializeAgentImageMarkdown("一", target)},
            {type: "image", label: "二", target, raw: serializeAgentImageMarkdown("二", target)},
            {type: "text", text: "后"},
        ]);
    });

    it("忽略普通链接、转义图片、行内代码、fenced 与缩进代码块", () => {
        const markdown = [
            "[普通](workspace/a.png)",
            "\\![转义](workspace/b.png)",
            "`![行内](workspace/c.png)`",
            "```md",
            "![围栏](workspace/d.png)",
            "```",
            "    ![缩进](workspace/e.png)",
            "![真实](workspace/f.png)",
        ].join("\n");

        expect(parseAgentImageMarkdown(markdown).filter((part) => part.type === "image"))
            .toEqual([{type: "image", label: "真实", target: "workspace/f.png", raw: "![真实](workspace/f.png)"}]);
    });

    it("支持 angle destination、Windows 路径与必要转义", () => {
        const serialized = serializeAgentImageMarkdown("图[一]\\稿", "C:\\My Files\\a(1).png");

        expect(serialized).toBe("![图\\[一\\]\\稿](<C:/My Files/a(1).png>)");
        expect(parseAgentImageMarkdown(serialized)).toEqual([{
            type: "image",
            label: "图[一]\\稿",
            target: "C:/My Files/a(1).png",
            raw: serialized,
        }]);
        expect(parseAgentImageMarkdown("![图](<D:\\资料\\封面.webp>)")[0]).toMatchObject({
            type: "image",
            target: "D:/资料/封面.webp",
        });
    });

    it("解析 inline title、引用式图片、跨行 alt，并保留 definition 与普通链接原文", () => {
        const markdown = [
            "[普通链接](workspace/book/link.png)",
            "![内联](workspace/book/inline.png \"封面标题\")",
            "![跨",
            "行][cover]",
            "",
            "[cover]: <workspace/book/My Images/cover.webp> '引用标题'",
        ].join("\n");
        const images = parseAgentImageMarkdown(markdown).filter((part) => part.type === "image");

        expect(images).toEqual([
            {
                type: "image",
                label: "内联",
                target: "workspace/book/inline.png",
                raw: "![内联](workspace/book/inline.png \"封面标题\")",
            },
            {
                type: "image",
                label: "跨\n行",
                target: "workspace/book/My Images/cover.webp",
                raw: "![跨\n行][cover]",
            },
        ]);
        const text = parseAgentImageMarkdown(markdown)
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("");
        expect(text).toContain("[普通链接](workspace/book/link.png)");
        expect(text).toContain("[cover]: <workspace/book/My Images/cover.webp> '引用标题'");
    });

    it("识别 blockquote 图片，但忽略 blockquote fenced code 与 HTML pre", () => {
        const markdown = [
            "> ![引用图](workspace/book/quote.png)",
            "> ```md",
            "> ![围栏图](workspace/book/fenced.png)",
            "> ```",
            "",
            "<pre>",
            "![HTML 图](workspace/book/html.png)",
            "</pre>",
        ].join("\n");

        expect(parseAgentImageMarkdown(markdown).filter((part) => part.type === "image"))
            .toEqual([{
                type: "image",
                label: "引用图",
                target: "workspace/book/quote.png",
                raw: "![引用图](workspace/book/quote.png)",
            }]);
    });

    it("serializer 对 POSIX、空格与括号 destination 保持可重解析 round-trip", () => {
        for (const target of [
            "/srv/novel/cover.png",
            "workspace/book/My Images/cover.webp",
            "workspace/book/cover(1).gif",
        ]) {
            const serialized = serializeAgentImageMarkdown("封面 [终稿]", target);
            expect(parseAgentImageMarkdown(serialized)).toEqual([{
                type: "image",
                label: "封面 [终稿]",
                target,
                raw: serialized,
            }]);
        }
    });

    it("Attachment ID 与稳定 destination 可逆", () => {
        const id = `sha256:${"c".repeat(64)}` as const;
        const target = attachmentMarkdownTarget(id);

        expect(target).toBe(`workspace/.nbook/agent/attachments/sha256/cc/${"c".repeat(62)}`);
        expect(attachmentIdFromMarkdownTarget(target)).toBe(id);
        expect(attachmentIdFromMarkdownTarget("workspace/book/cover.png")).toBeNull();
    });
});
