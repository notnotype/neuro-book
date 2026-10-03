import {describe, expect, it} from "vitest";
import {renderMarkdown} from "nbook/app/utils/markdown/render";

describe("renderMarkdown", () => {
    it("会把 skill 文本按普通 Markdown 渲染", () => {
        expect(() => renderMarkdown("$小说初始化流程")).not.toThrow();
        expect(renderMarkdown("$小说初始化流程")).toContain("$小说初始化流程");
    });

    it("会把模板 skill 按普通 Markdown 渲染", () => {
        expect(() => renderMarkdown("${小说初始化流程}")).not.toThrow();
        expect(renderMarkdown("${小说初始化流程}")).toContain("${小说初始化流程}");
    });

    it("会把 inline selection reference 渲染为 chip", () => {
        const html = renderMarkdown("**润色** [[manuscript/001/chapter.md#L12-L18]]");

        expect(html).toContain("nb-reference-chip is-selection");
        expect(html).toContain("data-reference-target=\"manuscript/001/chapter.md\"");
        expect(html).toContain("选区");
    });

    it("会把短格式 selection reference 渲染为 chip", () => {
        const html = renderMarkdown("**润色** src/server.ts#45-67");

        expect(html).toContain("nb-reference-chip is-selection");
        expect(html).toContain("data-reference-target=\"src/server.ts\"");
        expect(html).toContain("server.ts:45-67");
    });

    it("不会把 issue 编号和 URL fragment 渲染为 selection chip", () => {
        const html = renderMarkdown("see issue#123 and https://example.com/a#45");

        expect(html).not.toContain("nb-reference-chip is-selection");
        expect(html).not.toContain("data-reference-target=\"example.com/a\"");
        expect(html).toContain("issue#123");
    });

    it("会修复流式输出中分隔行缺列的 GFM 表格", () => {
        const html = renderMarkdown("| 因果链 | 起因 | 过程 | 结果 |\n|--------|------|------|");

        expect(html).toContain("<table>");
        expect(html).toContain("<th>结果</th>");
    });

    it("会修复流式输出中分隔行缺尾部 pipe 的 GFM 表格", () => {
        const html = renderMarkdown("| 姓名 | 年龄 | 城市 |\n|------|------\n| 张三 | 25 | 北京 |");

        expect(html).toContain("<table>");
        expect(html).toContain("<th>城市</th>");
        expect(html).toMatch(/<td[^>]*>北京<\/td>/);
    });

    it("会修复表头缺列的 GFM 表格", () => {
        const html = renderMarkdown("| One header |\n|:------------- |:-------------|:-----|\n| row | has | 3 cols |");

        expect(html).toContain("<table>");
        expect(html).toMatch(/<td[^>]*>3 cols<\/td>/);
    });

    it("不会修复代码块里的半截 GFM 表格示例", () => {
        const html = renderMarkdown("```md\n| 因果链 | 起因 | 过程 | 结果 |\n|--------|------|------|\n```");

        expect(html).not.toContain("<table>");
        expect(html).toContain("| 因果链 | 起因 | 过程 | 结果 |");
    });
});
