/**
 * Markdown 富文本编辑器的扩展组（docs/specs/workbench/editor.md 输出 19）：方言核心（与往返测试共用，见
 * `markdown-dialect-extensions.ts`）加编辑器 UI 层的表格、图片、硬换行、占位、行内代码快捷键与链接。旧应用的 Agent
 * 触发菜单、斜杠命令、行内 AI 引用与工作区引用标签不迁：它们依赖新应用还没有的服务；工作区与领域链接由普通链接
 * 保留源码。
 */

import type {AnyExtension} from "@tiptap/core";
import {HardBreak} from "@tiptap/extension-hard-break";
import {Image} from "@tiptap/extension-image";
import {Placeholder} from "@tiptap/extension-placeholder";
import {TableKit} from "@tiptap/extension-table";

import {MarkdownInlineCodeShortcut} from "./dialect/MarkdownInlineCodeShortcut";
import {MarkdownLink} from "./dialect/MarkdownLink";
import {createMarkdownDialectExtensions} from "./markdown-dialect-extensions";

/** 硬换行写成单个 `\n`（沿旧应用）：Tiptap 自带的写法是行尾两个空格，会改写原文里已有的硬换行。 */
export const MarkdownHardBreak = HardBreak.extend({
    renderMarkdown: () => "\n",
});

export function createMarkdownEditorExtensions(options: {readonly placeholder: string}): AnyExtension[] {
    return [
        ...createMarkdownDialectExtensions(),
        TableKit,
        Image.configure({inline: true, allowBase64: false, HTMLAttributes: {class: "nb-markdown-image-node"}}),
        MarkdownHardBreak,
        Placeholder.configure({placeholder: options.placeholder, emptyEditorClass: "is-editor-empty"}),
        MarkdownInlineCodeShortcut,
        // 点击不打开：编辑器里点链接是要编辑它；打开引用随引用插件再定。
        MarkdownLink.configure({openOnClick: false, enableClickSelection: true, linkOnPaste: false}),
    ];
}
