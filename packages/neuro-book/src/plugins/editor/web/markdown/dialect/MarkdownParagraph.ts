import {Paragraph} from "@tiptap/extension-paragraph";

/**
 * 段落扩展，priority 提到 1500（全 schema 最高的块级节点）。
 *
 * ⚠️ ProseMirror 空文档 / 空块级容器的默认填充节点（ContentMatch.defaultType）
 * 取 schema 注册序中第一个可默认创建的块节点，而 TipTap 的 schema 顺序按扩展
 * priority 降序。HTML 兜底节点（HtmlFallback.ts）为了 marked tokenizer 的执行
 * 顺序必须持 1390/1400 的高 priority——若 paragraph 停留在默认 100，空文档会被
 * 填充成空 htmlBlock，表现为「空文件显示 HTML 卡片」。
 *
 * 因此 paragraph 必须压过所有块级方言与兜底节点：任何默认填充（空文件、删光
 * 内容、块容器补位）都应生成普通段落。新增块级扩展的 priority 不得超过本值。
 */
export const MarkdownParagraph = Paragraph.extend({
    priority: 1500,
});
