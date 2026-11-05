/**
 * Markdown 富文本编辑器的扩展组（docs/specs/workbench/editor.md 输出 19）：Markdown 语言的全部语法扩展（编解码器按这份 schema
 * 读写），加编辑器界面层：作品内链接的引用小块装饰、图片的节点视图、占位与行内代码快捷输入。旧应用的 Agent 触发菜单、斜杠命令
 * 与行内 AI 引用不迁：它们依赖新应用还没有的服务。
 */

import type {AnyExtension} from "@tiptap/core";
import {Placeholder} from "@tiptap/extension-placeholder";

import type {MarkdownLanguage} from "../language/language";
import {MarkdownImageViews} from "./image-views";
import {MarkdownInlineCodeShortcut} from "./inline-code-shortcut";
import {MarkdownReferenceLinks} from "./reference-links";
import {MarkdownBlockKeymap} from "./block-actions";
import {MarkdownSlashTrigger} from "./slash-trigger";
import type {MarkdownViewHost} from "./view-host";

export function createMarkdownEditorExtensions(options: {readonly language: MarkdownLanguage; readonly placeholder: string; readonly host: MarkdownViewHost}): AnyExtension[] {
    return [...options.language.extensions, MarkdownSlashTrigger, MarkdownBlockKeymap, MarkdownReferenceLinks.configure({host: options.host}), MarkdownImageViews.configure({host: options.host}), Placeholder.configure({placeholder: options.placeholder, emptyEditorClass: "is-editor-empty"}), MarkdownInlineCodeShortcut];
}
