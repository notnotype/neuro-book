// @vitest-environment jsdom
// 空文档默认填充回归测试：真实 Editor（含 schema 填充链路），防止高 priority 兜底节点顶掉 paragraph。
// 背景：ProseMirror 空文档默认块取 schema 注册序（priority 降序）第一个可默认创建的块节点，
// HtmlBlock 为 marked tokenizer 顺序持 1400 高 priority，曾把空文件填充成空 htmlBlock（HTML 卡片 bug）。
import {Editor} from "@tiptap/core";
import {describe, expect, it} from "vitest";
import {createMarkdownDialectExtensions} from "nbook/app/components/markdown-studio/tiptap/markdown-dialect-extensions";

function createEditor(content: string): Editor {
    return new Editor({
        content,
        contentType: "markdown",
        extensions: createMarkdownDialectExtensions(),
    });
}

function docTypes(editor: Editor): string[] {
    return (editor.getJSON().content ?? []).map((node) => node.type ?? "");
}

describe("空文档默认填充（真实 Editor schema 链路）", () => {
    it("空文件初始化的默认块是 paragraph，不是 HTML 兜底节点", () => {
        const editor = createEditor("");
        expect(docTypes(editor)).toEqual(["paragraph"]);
        expect(editor.getMarkdown()).toBe("");
        editor.destroy();
    });

    it("setContent 空字符串后仍是 paragraph", () => {
        const editor = createEditor("正文");
        editor.commands.setContent("", {contentType: "markdown", emitUpdate: false});
        expect(docTypes(editor)).toEqual(["paragraph"]);
        editor.destroy();
    });

    it("内容删光后回到 paragraph", () => {
        const editor = createEditor("你好");
        editor.commands.selectAll();
        editor.commands.deleteSelection();
        expect(docTypes(editor)).toEqual(["paragraph"]);
        expect(editor.getMarkdown()).toBe("");
        editor.destroy();
    });

    it("块级容器（评论块）内部默认填充也是 paragraph", () => {
        const editor = createEditor("正文段落");
        editor.commands.selectAll();
        editor.commands.setCommentBlock("批注");
        const block = editor.getJSON().content?.[0];
        expect(block?.type).toBe("commentBlock");
        expect(block?.content?.every((child) => child.type === "paragraph")).toBe(true);
        editor.destroy();
    });

    it("粘贴纯空白不再抛 RangeError（空 doc insertContent 崩溃回归钉子）", () => {
        const editor = createEditor("");
        expect(() => {
            editor.chain().focus().insertContent("你好", {contentType: "markdown"}).run();
        }).not.toThrow();
        // 模拟 paste handler 对纯空白的处理路径：markdown parse 产生空 doc 会崩，
        // 编辑器组件层已加守卫（insertMarkdown 对纯空白退化为 insertText），
        // 这里锁定底层行为：空白经 markdown parse 后确实是空 doc（守卫存在的理由）。
        const parsed = editor.markdown?.parse("\n");
        expect(parsed?.content ?? []).toHaveLength(0);
        editor.destroy();
    });
});
