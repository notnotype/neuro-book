import {describe, expect, it} from "vitest";
import {buildReferenceMarkdown, parseReferenceLink} from "nbook/shared/reference-link";
import {
    findMarkdownBlockTagStart,
    normalizeAlign,
    normalizeMarkdownDialectBlocks,
    parseMarkdownAlign,
    parseMarkdownBilingualBlock,
    parseMarkdownCommentBlock,
    parseMarkdownCommentInline,
    parseMarkdownRuby,
    renderMarkdownAlign,
    renderMarkdownBilingualBlock,
    renderMarkdownCommentBlock,
    renderMarkdownCommentInline,
    renderMarkdownRuby,
} from "nbook/shared/markdown-workbench";

describe("markdown-workbench", () => {
    it("引用 Markdown 使用 canonical scheme URI 往返", () => {
        const source = "[青铜门](lorebook://world/bronze-gate)";
        const parsed = parseReferenceLink(source);
        expect(parsed).toEqual({
            kind: "lorebook",
            title: "青铜门",
            targetId: "world/bronze-gate",
        });
        expect(buildReferenceMarkdown(parsed!)).toBe(source);
    });

    it("行内评论兼容读旧 <inline-comment>,序列化统一输出 <comment> 并转义属性", () => {
        const source = "<inline-comment body=\"改成 &quot;低语&quot;\">青铜门</inline-comment>";
        const parsed = parseMarkdownCommentInline(source);
        expect(parsed).toMatchObject({
            raw: source,
            id: null,
            body: "改成 \"低语\"",
            text: "青铜门",
        });
        expect(renderMarkdownCommentInline({body: "A&B\"C"}, "青铜门")).toBe("<comment body=\"A&amp;B&quot;C\">青铜门</comment>");
        expect(renderMarkdownCommentInline({id: "draft:1", body: "A&B\"C"}, "青铜门")).toBe("<comment id=\"draft:1\" body=\"A&amp;B&quot;C\">青铜门</comment>");
    });

    it("align 支持四种值并回退 left", () => {
        for (const align of ["left", "center", "right", "justify"] as const) {
            const source = `<align value="${align}">\n正文\n</align>`;
            const parsed = parseMarkdownAlign(source);
            expect(parsed?.align).toBe(align);
            expect(renderMarkdownAlign(parsed?.align, "正文")).toBe(source);
        }
        expect(normalizeAlign("bad")).toBe("left");
    });

    it("块级评论跨空行段落解析，行内形态不被块级 pattern 误吃", () => {
        const source = "<comment body=\"整段重写\">\n第一段。\n\n第二段。\n</comment>";
        const parsed = parseMarkdownCommentBlock(source);
        expect(parsed).toMatchObject({
            body: "整段重写",
            text: "第一段。\n\n第二段。",
        });
        expect(renderMarkdownCommentBlock({body: "整段重写"}, "第一段。\n\n第二段。")).toBe(source);
        // 行内形态（开标签后无换行）不是块级
        expect(parseMarkdownCommentBlock("<comment body=\"x\">同行</comment>")).toBeNull();
    });

    it("findMarkdownBlockTagStart 只认换行后的行首块级形态，段内行内用法不产生截断点", () => {
        expect(findMarkdownBlockTagStart("前文\n<comment>\n正文\n</comment>", "comment")).toBe(3);
        // src 开头的标签不由 start 认领（marked 段落中断检测会传 slice(1) 伪装开头），块首由 tokenize 直接兜住
        expect(findMarkdownBlockTagStart("<comment body=\"x\">\n正文\n</comment>", "comment")).toBe(-1);
        // 段内行内用法：无换行紧随开标签，不截断
        expect(findMarkdownBlockTagStart("她抬头<comment body=\"x\">看了他一眼</comment>。", "comment")).toBe(-1);
    });

    it("ruby 属性式解析与渲染，兼容标准 <rt> 形式读入", () => {
        const parsed = parseMarkdownRuby("<ruby text=\"hàn zì\">汉字</ruby>");
        expect(parsed).toMatchObject({text: "hàn zì", base: "汉字"});
        expect(renderMarkdownRuby("hàn zì", "汉字")).toBe("<ruby text=\"hàn zì\">汉字</ruby>");

        const standard = parseMarkdownRuby("<ruby>汉字<rt>hàn zì</rt></ruby>");
        expect(standard).toMatchObject({text: "hàn zì", base: "汉字"});
        // 无标注文本的 ruby 按空注音接管（序列化侧退化为纯正文），不能返回 null——
        // 返回 null 会让残片兜底把「可编辑纯文本」捕成不可编辑 chip
        expect(parseMarkdownRuby("<ruby>汉字</ruby>")).toMatchObject({text: "", base: "汉字"});
    });

    it("bilingual 块级对照解析与渲染", () => {
        const source = "<bilingual text=\"老人缓缓走向祭坛。\">\nThe old man walked toward the altar.\n</bilingual>";
        const parsed = parseMarkdownBilingualBlock(source);
        expect(parsed).toMatchObject({
            text: "老人缓缓走向祭坛。",
            body: "The old man walked toward the altar.",
        });
        expect(renderMarkdownBilingualBlock("老人缓缓走向祭坛。", "The old man walked toward the altar.")).toBe(source);
    });
});

describe("normalizeMarkdownDialectBlocks（读时规范化）", () => {
    it("正文后黏着的块级开标签拆段为标准块级形态", () => {
        expect(normalizeMarkdownDialectBlocks("abc<comment>\ncontent\n</comment>\n"))
            .toBe("abc\n\n<comment>\ncontent\n</comment>\n");
    });

    it("四个块级方言标签都受规范化覆盖", () => {
        expect(normalizeMarkdownDialectBlocks("原文<bilingual text=\"译\">\nsrc\n</bilingual>\n"))
            .toBe("原文\n\n<bilingual text=\"译\">\nsrc\n</bilingual>\n");
        expect(normalizeMarkdownDialectBlocks("正文<align value=\"center\">\n居中\n</align>\n"))
            .toBe("正文\n\n<align value=\"center\">\n居中\n</align>\n");
        expect(normalizeMarkdownDialectBlocks("说明<html>\n<div>x</div>\n</html>\n"))
            .toBe("说明\n\n<html>\n<div>x</div>\n</html>\n");
    });

    it("与方言块 pattern 非同构的伪形态不拆（拆了 tokenizer 也不认领）", () => {
        // align 必须带合法 value 属性（ALIGN_PATTERN）
        const bareAlign = "正文<align>\n内容\n</align>\n";
        expect(normalizeMarkdownDialectBlocks(bareAlign)).toBe(bareAlign);
        // html 嵌入块只认裸 <html>（HTML_EMBED_PATTERN）
        const attrHtml = "说明<html lang=\"x\">\n<div>y</div>\n</html>\n";
        expect(normalizeMarkdownDialectBlocks(attrHtml)).toBe(attrHtml);
    });

    it("已是行首的标准块级形态不动", () => {
        const source = "abc\n\n<comment>\ncontent\n</comment>\n";
        expect(normalizeMarkdownDialectBlocks(source)).toBe(source);
    });

    it("行内合法形态（开标签后非行尾）不动", () => {
        const source = "她抬头<comment body=\"x\">看了他一眼</comment>。\n";
        expect(normalizeMarkdownDialectBlocks(source)).toBe(source);
    });

    it("引用/列表容器标记后的开标签视为逻辑行首，不拆（嵌套块级形态今天正常工作）", () => {
        const quoted = "> <comment>\n> content\n> </comment>\n";
        expect(normalizeMarkdownDialectBlocks(quoted)).toBe(quoted);
        const listed = "- <comment>\n  content\n  </comment>\n";
        expect(normalizeMarkdownDialectBlocks(listed)).toBe(listed);
    });

    it("缩进代码块（≥4 空格 / tab）内不规范化", () => {
        const indented = "    abc<comment>\n    content\n    </comment>\n";
        expect(normalizeMarkdownDialectBlocks(indented)).toBe(indented);
        const tabbed = "\tabc<comment>\n\tcontent\n\t</comment>\n";
        expect(normalizeMarkdownDialectBlocks(tabbed)).toBe(tabbed);
    });

    it("fenced code 内不规范化", () => {
        const fenced = "```\nabc<comment>\ncontent\n</comment>\n```\n";
        expect(normalizeMarkdownDialectBlocks(fenced)).toBe(fenced);
        const tilde = "~~~md\nabc<comment>\n</comment>\n~~~\n";
        expect(normalizeMarkdownDialectBlocks(tilde)).toBe(tilde);
    });

    it("闭标签只出现在 fence 内不算数，不拆", () => {
        const source = "abc<comment>\n```\n</comment>\n```\n";
        expect(normalizeMarkdownDialectBlocks(source)).toBe(source);
    });

    it("向下无独立成行的闭标签（粘贴片段 / 悬尾）不拆", () => {
        const noClose = "abc<comment>\n看看\n";
        expect(normalizeMarkdownDialectBlocks(noClose)).toBe(noClose);
        // 闭标签黏在内容后不算独立成行
        const stuckClose = "abc<comment>\ncontent</comment>\n";
        expect(normalizeMarkdownDialectBlocks(stuckClose)).toBe(stuckClose);
    });

    it("原文不以换行结尾时最后一行不算行尾（流式 chunk 悬尾不被抢拆）", () => {
        const source = "para\n\nabc<comment>";
        expect(normalizeMarkdownDialectBlocks(source)).toBe(source);
    });

    it("CRLF 输入：判据剥 \\r 生效，重组保留行尾", () => {
        expect(normalizeMarkdownDialectBlocks("abc<comment>\r\ncontent\r\n</comment>\r\n"))
            .toBe("abc\r\n\r\n<comment>\r\ncontent\r\n</comment>\r\n");
    });

    it("容器内带真实正文前缀的开标签拆出容器（已决策行为：合法文档优于非法 text node）", () => {
        expect(normalizeMarkdownDialectBlocks("> abc<comment>\ncontent\n</comment>\n"))
            .toBe("> abc\n\n<comment>\ncontent\n</comment>\n");
    });
});
