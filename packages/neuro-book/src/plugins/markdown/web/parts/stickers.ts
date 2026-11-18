/**
 * 表情目录的注入键（docs/specs/agent/stickers.md 输出 10）：展示器（`MarkdownHosted`）与 Markdown 编辑器（`MarkdownControl`）
 * 从这里取 nb-markdown 的宿主端口 `stickers`。没有提供时（Lab、组件测试、没有表情包插件）表情写法显示原文。
 */

import type {InjectionKey} from "vue";

import type {StickerResolver} from "@notnotype/nb-markdown";

import type {StickerPicker} from "nbook/plugins/stickers/shared/contracts";

export const markdownStickersKey: InjectionKey<StickerResolver> = Symbol("nbook.markdown/stickers");

/**
 * 表情选择器的注入键（docs/specs/agent/stickers.md 输出 39 到 44）：编辑器的工具栏、斜杠菜单、`:` 补全与选择器弹层，以及提示词编辑器
 * 认表情写法（`stickerKnown`）从这里取。没有提供时（没装表情包插件、Lab）这些入口都不出现，提示词里的表情写法是文字。
 */
export const markdownStickerPickerKey: InjectionKey<StickerPicker> = Symbol("nbook.markdown/sticker-picker");
