/**
 * Markdown 富文本编辑器的扩展组（docs/specs/workbench/editor.md 输出 19）：Markdown 语言的全部语法扩展（编解码器按这份 schema
 * 读写），加编辑器界面层：作品内链接的引用小块装饰、图片与表情的节点视图、占位、行内代码快捷输入、焦点在卡片里时仍画出的选区、正在看的那条批注的标出与批注末尾的小符号。旧应用的 Agent 触发菜单、斜杠命令
 * 与行内 AI 引用不迁：它们依赖新应用还没有的服务。
 */

import type {AnyExtension} from "@tiptap/core";
import {Placeholder} from "@tiptap/extension-placeholder";

import type {MarkdownLanguage} from "../language/language";
import {MarkdownCommentMarkers, MarkdownShownComment} from "./comments";
import {MarkdownHeldSelection} from "./held-selection";
import {MarkdownImageViews} from "./image-views";
import {MarkdownImagePaste} from "./image-paste";
import {MarkdownInlineCodeShortcut} from "./inline-code-shortcut";
import {MarkdownLinkOpener} from "./link-open";
import {MarkdownReferenceLinks} from "./reference-links";
import {MarkdownBlockKeymap} from "./block-actions";
import {MarkdownSlashTrigger} from "./slash-trigger";
import {MarkdownStickerTrigger} from "./sticker-trigger";
import {MarkdownStickerViews} from "./sticker-views";
import type {MarkdownViewHost} from "./view-host";
import {MarkdownFrontmatter} from "./frontmatter";

export function createMarkdownEditorExtensions(options: {readonly language: MarkdownLanguage; readonly placeholder: string; readonly host: MarkdownViewHost; /** 批注末尾小符号的可访问名称（输出 38），宿主按显示语言给；null 是不画符号（没有批注层接点击的宿主）。 */ readonly commentMarkerLabel: string | null}): AnyExtension[] {
    return [...options.language.extensions, MarkdownSlashTrigger, MarkdownStickerTrigger, MarkdownBlockKeymap, MarkdownReferenceLinks.configure({host: options.host}), MarkdownImageViews.configure({host: options.host}), MarkdownStickerViews.configure({host: options.host}), MarkdownLinkOpener.configure({host: options.host}), MarkdownImagePaste.configure({host: options.host}), Placeholder.configure({placeholder: options.placeholder, emptyEditorClass: "is-editor-empty"}), MarkdownInlineCodeShortcut, MarkdownHeldSelection, MarkdownShownComment, MarkdownFrontmatter, ...(options.commentMarkerLabel === null ? [] : [MarkdownCommentMarkers.configure({label: options.commentMarkerLabel})])];
}
