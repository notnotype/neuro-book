/**
 * `@notnotype/nb-markdown/prompt`：写给 Agent 的编辑组件与已发送文字的显示（docs/specs/ui/prompt-editor.md），以及宿主拼
 * 触发菜单插入文字用的写法函数。附件条与粘贴块外框是它们的零件，导出给 Component Lab 单独挂。
 */

export {default as PromptEditor} from "./PromptEditor.vue";
export {default as PromptTextView} from "./PromptTextView.vue";
export {default as PromptAttachmentStrip} from "./PromptAttachmentStrip.vue";
export {default as PromptPasteFrame} from "./PromptPasteFrame.vue";
export * from "./prompt-editor.types";
export {parsePromptText, promptReferenceText, stickerOnlyMessage} from "./prompt-text";
export type {StickerKnown} from "./prompt-text";
export type {PromptNodeJSON} from "./prompt-text";
