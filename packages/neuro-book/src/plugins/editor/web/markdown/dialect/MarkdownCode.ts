import {Code} from "@tiptap/extension-code";

/**
 * Markdown Studio 的原生 inline code mark。
 * 只调整边界扩展语义，解析、输入规则和 Markdown 序列化沿用 Tiptap 官方 Code 扩展。
 */
export const MarkdownCode = Code.extend({
    inclusive: false,
});
