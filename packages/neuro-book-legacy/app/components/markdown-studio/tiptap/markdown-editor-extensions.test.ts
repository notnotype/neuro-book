import {MarkdownManager} from "@tiptap/markdown";
import {describe, expect, it} from "vitest";
import {createMarkdownDialectExtensions} from "nbook/app/components/markdown-studio/tiptap/markdown-dialect-extensions";
import {normalizeMarkdownDialectBlocks} from "nbook/shared/markdown-workbench";

/**
 * 创建 Markdown Studio 的真实 TipTap Markdown manager，方言扩展组与真实编辑器共用单一来源。
 */
function createManager(): MarkdownManager {
    return new MarkdownManager({
        extensions: createMarkdownDialectExtensions(),
    });
}

describe("markdown-studio TipTap Markdown extensions", () => {
    it("align 后续普通段落和行内 HTML 格式不会被解析成空段落", () => {
        const manager = createManager();
        const source = [
            "# 第一章：醒来",
            "",
            "## 正文草稿",
            "",
            "<align value=\"center\">*— 在记忆断裂的地方，世界重新开始。—*</align>",
            "",
            "林屿睁开眼睛的时候，后脑勺正贴着一块冰凉的石板。",
            "",
            "空气里有股陈旧的纸张味道，混着某种说不上来的甜腥。<mark>那些符号在缓慢移动。</mark>",
            "",
            "架上摆的是一团 <span style=\"color: #60a5fa\">淡蓝色的雾气</span>。",
            "",
            "<inline-comment body=\"后续确认\">她抬头看了林屿一眼。</inline-comment>",
        ].join("\n");

        const parsed = manager.parse(source);
        const content = parsed.content ?? [];

        expect(parsed.type).toBe("doc");
        expect(content[2]).toMatchObject({
            type: "markdownAlign",
            attrs: {align: "center"},
        });
        expect(content[3]).toMatchObject({
            type: "paragraph",
            content: [{
                type: "text",
                text: "林屿睁开眼睛的时候，后脑勺正贴着一块冰凉的石板。",
            }],
        });
        expect(JSON.stringify(parsed)).toContain("那些符号在缓慢移动。");
        expect(JSON.stringify(parsed)).toContain("\"type\":\"markdownHighlight\"");
        expect(JSON.stringify(parsed)).toContain("\"type\":\"markdownTextColor\"");
        // 旧 <inline-comment> 标签仍可解析（兼容读旧），落到新 comment mark。
        expect(JSON.stringify(parsed)).toContain("\"type\":\"comment\"");
    });

    it("行内评论不拆散句子，round-trip 输出 canonical <comment>", () => {
        const manager = createManager();
        const source = "她抬头<comment body=\"这里节奏太快\">看了他一眼</comment>。";

        const parsed = manager.parse(source);
        const content = parsed.content ?? [];
        // 整句仍是一个段落（块级 tokenizer 不得在段内截断）
        expect(content).toHaveLength(1);
        expect(content[0]?.type).toBe("paragraph");

        expect(manager.serialize(parsed)).toBe(source);
    });

    it("旧 <inline-comment> 兼容读入，保存统一输出 <comment>", () => {
        const manager = createManager();
        const parsed = manager.parse("前文<inline-comment body=\"需要核对\">原文</inline-comment>后文");
        expect(JSON.stringify(parsed)).toContain("\"type\":\"comment\"");
        expect(manager.serialize(parsed)).toBe("前文<comment body=\"需要核对\">原文</comment>后文");
    });

    it("块级评论跨空行段落 round-trip", () => {
        const manager = createManager();
        const source = [
            "<comment body=\"整段视角混乱，需要重写\">",
            "老人走向祭坛。",
            "",
            "风里带着灰烬的味道。",
            "</comment>",
        ].join("\n");

        const parsed = manager.parse(source);
        const block = (parsed.content ?? [])[0];
        expect(block?.type).toBe("commentBlock");
        expect(block?.attrs).toMatchObject({body: "整段视角混乱，需要重写"});
        expect(block?.content).toHaveLength(2);

        expect(manager.serialize(parsed)).toBe(source);
    });

    it("ruby 属性式 round-trip，标准 <rt> 形式读入后统一输出属性式", () => {
        const manager = createManager();
        const source = "远处站着<ruby text=\"hàn zì\">汉字</ruby>先生。";
        expect(manager.serialize(manager.parse(source))).toBe(source);

        const standard = manager.parse("远处站着<ruby>汉字<rt>hàn zì</rt></ruby>先生。");
        expect(manager.serialize(standard)).toBe(source);
    });

    it("bilingual 段落对照块 round-trip", () => {
        const manager = createManager();
        const source = [
            "<bilingual text=\"老人缓缓走向祭坛。\">",
            "The old man walked toward the altar.",
            "</bilingual>",
        ].join("\n");

        const parsed = manager.parse(source);
        const block = (parsed.content ?? [])[0];
        expect(block?.type).toBe("markdownBilingual");
        expect(block?.attrs).toMatchObject({text: "老人缓缓走向祭坛。"});

        expect(manager.serialize(parsed)).toBe(source);
    });

    it("块级未知 HTML（含跨空行内容）进 HtmlBlock 兜底，序列化原样保留", () => {
        const manager = createManager();
        const source = [
            "<figure class=\"scene-card\">",
            "",
            "<img src=\"altar.png\">",
            "",
            "</figure>",
        ].join("\n");

        const parsed = manager.parse(source);
        const block = (parsed.content ?? [])[0];
        expect(block?.type).toBe("htmlBlock");
        expect(block?.attrs?.html).toBe(source);

        expect(manager.serialize(parsed)).toBe(source);
    });

    it("显式 <html> 块进 HtmlEmbed（唯一可渲染形态），round-trip 保留内部内容", () => {
        const manager = createManager();
        const source = [
            "<html>",
            "<div class=\"card\">状态面板</div>",
            "<script>console.log(1)</script>",
            "</html>",
        ].join("\n");

        const parsed = manager.parse(source);
        const block = (parsed.content ?? [])[0];
        expect(block?.type).toBe("htmlEmbed");
        expect(block?.attrs?.html).toBe("<div class=\"card\">状态面板</div>\n<script>console.log(1)</script>");

        expect(manager.serialize(parsed)).toBe(source);
    });

    it("<br> 等已知行内标签独占一行不再误变 HTML 块（空文件卡片回归钉子）", () => {
        const manager = createManager();
        const parsed = manager.parse("第一行\n\n<br>\n\n第二行");
        const types = (parsed.content ?? []).map((node) => node.type);
        expect(types).not.toContain("htmlBlock");
        expect(types).not.toContain("htmlEmbed");
    });

    it("行内未知标签进 RawInlineHtml 原样保留，不再静默丢标签", () => {
        const manager = createManager();
        const source = "按下 <key-combo keys=\"ctrl+s\">保存</key-combo> 即可。";

        const parsed = manager.parse(source);
        expect(JSON.stringify(parsed)).toContain("\"type\":\"rawInlineHtml\"");
        expect(manager.serialize(parsed)).toBe(source);
    });

    it("已知行内标签不被兜底抢走：mark/span 颜色仍走各自 mark", () => {
        const manager = createManager();
        const source = "有<mark>高亮</mark>和<span style=\"color: #ef4444\">红字</span>。";
        const parsed = manager.parse(source);
        expect(JSON.stringify(parsed)).toContain("\"type\":\"markdownHighlight\"");
        expect(JSON.stringify(parsed)).toContain("\"type\":\"markdownTextColor\"");
        expect(JSON.stringify(parsed)).not.toContain("rawInlineHtml");
        expect(manager.serialize(parsed)).toBe(source);
    });

    it("混合形态经规范化后解析为标准块级评论", () => {
        const manager = createManager();
        const normalized = normalizeMarkdownDialectBlocks("abc<comment>\npara1\n\npara2\n</comment>\n");
        const parsed = manager.parse(normalized);
        const types = (parsed.content ?? []).map((node) => node.type);
        expect(types).toEqual(["paragraph", "commentBlock"]);
        expect(manager.serialize(parsed)).toBe("abc\n\n<comment>\npara1\n\npara2\n</comment>");
    });

    it("多段混合残片（未经规范化）不再静默丢标签：开闭标签均保留", () => {
        const manager = createManager();
        const source = "abc<comment>\npara1\n\npara2\n</comment>";
        const roundTrip = manager.serialize(manager.parse(source));
        // 此前 <comment> / </comment> 会被 DOM 解析剥掉（静默数据丢失）
        expect(roundTrip).toContain("<comment>");
        expect(roundTrip).toContain("</comment>");
        expect(roundTrip).toContain("para1");
        expect(roundTrip).toContain("para2");
    });

    it("跨空行截断的畸形块保数据：源码块 + 闭标签残片 chip，不静默改写评论范围", () => {
        const manager = createManager();
        const source = "<comment>\npara1\n\npara2</comment>";
        const parsed = manager.parse(source);
        expect(JSON.stringify(parsed)).toContain("\"type\":\"htmlBlock\"");
        expect(manager.serialize(parsed)).toBe(source);
    });

    it("<ruby> 单独成段不被块级兜底吃成源码块（排除名单全量并集不变量）", () => {
        const manager = createManager();
        const source = "<ruby text=\"hàn zì\">汉字</ruby>";
        const parsed = manager.parse(source);
        expect(JSON.stringify(parsed)).toContain("\"type\":\"markdownRuby\"");
        expect(JSON.stringify(parsed)).not.toContain("htmlBlock");
        expect(manager.serialize(parsed)).toBe(source);
    });

    it("无注音的 <ruby> 退化为可编辑纯文本，不冻结成 chip", () => {
        const manager = createManager();
        const parsed = manager.parse("前<ruby>汉字</ruby>后");
        expect(JSON.stringify(parsed)).not.toContain("rawInlineHtml");
        expect(manager.serialize(parsed)).toBe("前汉字后");
    });

    it("正文中的伪标签（Vec<String>）保 chip 不再被剥掉", () => {
        const manager = createManager();
        const source = "返回值是 Vec<String> 列表。";
        const parsed = manager.parse(source);
        expect(JSON.stringify(parsed)).toContain("\"type\":\"rawInlineHtml\"");
        expect(manager.serialize(parsed)).toBe(source);
    });

    it("配对闭合后还挂残片的畸形块不交 DOM 自愈，保源码块（防残片被静默丢弃）", () => {
        const manager = createManager();
        const source = "<comment>\na</comment>x</comment>";
        const parsed = manager.parse(source);
        expect(JSON.stringify(parsed)).toContain("\"type\":\"htmlBlock\"");
        expect(manager.serialize(parsed)).toBe(source);
    });
});
