import {Markdown} from "@tiptap/markdown";
import {StarterKit} from "@tiptap/starter-kit";
import type {AnyExtension} from "@tiptap/core";
import {Comment, CommentBlock} from "nbook/app/components/markdown-studio/tiptap/Comment";
import {HtmlBlock, HtmlBlockBridge, RawInlineHtml} from "nbook/app/components/markdown-studio/tiptap/HtmlFallback";
import {HtmlEmbed} from "nbook/app/components/markdown-studio/tiptap/HtmlEmbed";
import {MarkdownAlign} from "nbook/app/components/markdown-studio/tiptap/MarkdownAlign";
import {MarkdownBilingual} from "nbook/app/components/markdown-studio/tiptap/MarkdownBilingual";
import {MarkdownCode} from "nbook/app/components/markdown-studio/tiptap/MarkdownCode";
import {MarkdownParagraph} from "nbook/app/components/markdown-studio/tiptap/MarkdownParagraph";
import {MarkdownRuby} from "nbook/app/components/markdown-studio/tiptap/MarkdownRuby";
import {MarkdownHighlight, MarkdownSubscript, MarkdownSuperscript, MarkdownTextColor} from "nbook/app/components/markdown-studio/tiptap/MarkdownTextMarks";

export interface MarkdownDialectExtensionOptions {
    /** Comment 扩展回调（onSelect / onCommentsChange）；缺省用扩展默认 no-op */
    comment?: Parameters<typeof Comment.configure>[0];
    /** HtmlEmbed 的 i18n 文案与数据接口注入；缺省用扩展内置文案、数据请求统一拒绝 */
    htmlEmbed?: Parameters<typeof HtmlEmbed.configure>[0];
}

/**
 * Markdown 方言核心扩展组：schema 基座（Markdown / StarterKit / 高 priority 段落）
 * + 全部带 markdownTokenizer / markdownTokenName 的方言与兜底扩展。
 *
 * 无 .vue / UI 依赖——真实编辑器（markdown-editor-extensions.ts）与 vitest 测试
 * 共用此单一来源，防止测试 schema 与真实 schema 静默分叉（此前四份手拼列表已经
 * 漂移过：测试环境缺 MarkdownParagraph 的 1500 priority）。
 * 表格、图片、硬换行、菜单、引用 chip 等编辑器 UI 层扩展由 markdown-editor-extensions.ts 追加。
 */
export function createMarkdownDialectExtensions(options: MarkdownDialectExtensionOptions = {}): AnyExtension[] {
    return [
        Markdown,
        StarterKit.configure({
            code: false,
            hardBreak: false,
            link: false,
            trailingNode: false,
            // paragraph 用高 priority 版本单独注册（见 MarkdownParagraph.ts 的 defaultType 陷阱说明）
            paragraph: false,
        }),
        MarkdownParagraph,
        options.comment ? Comment.configure(options.comment) : Comment,
        CommentBlock,
        MarkdownRuby,
        MarkdownBilingual,
        options.htmlEmbed ? HtmlEmbed.configure(options.htmlEmbed) : HtmlEmbed,
        HtmlBlock,
        HtmlBlockBridge,
        RawInlineHtml,
        MarkdownCode,
        MarkdownAlign,
        MarkdownTextColor,
        MarkdownHighlight,
        MarkdownSuperscript,
        MarkdownSubscript,
    ];
}
