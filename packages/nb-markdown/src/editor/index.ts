/**
 * `@notnotype/nb-markdown/editor`：Markdown 富文本编辑器的扩展组（语言的全部语法扩展，加作品内链接的小块装饰、图片的节点视图、
 * 占位、行内代码快捷输入与保持的选区高亮）、编辑动作与 frontmatter 的属性面板。编辑器实例、文档绑定与工作台对接归宿主（neuro-book 的 `MarkdownControl.vue`）。
 */

export {blockAt, blockTextRange, canConvertTo, insertSlashBlock, removeSlashBlock, selectBlock, selectBlockText, selectWholeBlock} from "./block-actions";
export type {BlockKind, BlockTarget} from "./block-actions";
export {markdownEditingActions} from "./editing-actions";
export {canInsertImages, insertImages} from "./images";
export type {ImageToInsert} from "./images";
export {isSafeHref, linksTouching, sharedHref} from "./links";
export type {LinkRange} from "./links";
export type {EditingAction, EditingArgs} from "./editing-actions";
export {addBlockComment, canCommentBlockAt, commentsAt, commentsAtPos, commentsEndingAt, findComment, gotoComment, listComments, markShownComment, MarkdownCommentMarkers, MarkdownShownComment, matchComment, nextTerritory, refOf, removeComment, SHOWN_COMMENT_CLASS, setCommentBody, territoryAt, territoryOf} from "./comments";
export type {CommentInfo, CommentRef} from "./comments";
export {holdBlock, holdCaret, holdSelection, releaseSelection} from "./held-selection";
export {selectRubyAt, selectedRubyText} from "./ruby-text";
export {createMarkdownEditorExtensions} from "./markdown-editor-extensions";
export {activeSlash, dismissSlash, markdownSlashKey, removeSlashQuery} from "./slash-trigger";
export type {SlashMatch} from "./slash-trigger";
export {activeSticker, canInsertSticker, dismissSticker, insertSticker, insertStickerAtTrigger, markdownStickerKey} from "./sticker-trigger";
export type {StickerMatch} from "./sticker-trigger";
export {REFRESH_REFERENCE_LINKS} from "./reference-links";
export {default as MarkdownProperties} from "./properties/MarkdownProperties.vue";
export type {PropertyDescription} from "./properties/model";
export {FRONTMATTER_REQUEST, setFrontmatterEol} from "./frontmatter";
export type {ImageFailure, ImageUploadResult, MarkdownViewAssets, MarkdownViewHost, MarkdownViewImages} from "./view-host";
