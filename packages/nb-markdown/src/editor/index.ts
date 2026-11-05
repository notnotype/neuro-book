/**
 * `@notnotype/nb-markdown/editor`：Markdown 富文本编辑器的扩展组（语言的全部语法扩展，加作品内链接的小块装饰、图片的节点视图、
 * 占位与行内代码快捷输入）。编辑器实例、文档绑定与工作台对接归宿主（neuro-book 的 `MarkdownControl.vue`）。
 */

export {markdownEditingActions} from "./editing-actions";
export type {EditingAction, EditingArgs} from "./editing-actions";
export {createMarkdownEditorExtensions} from "./markdown-editor-extensions";
export {REFRESH_REFERENCE_LINKS} from "./reference-links";
export type {MarkdownViewAssets, MarkdownViewHost} from "./view-host";
