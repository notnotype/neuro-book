/**
 * 表情目录的注入键（docs/specs/agent/stickers.md 输出 10）：展示器（`MarkdownHosted`）与 Markdown 编辑器（`MarkdownControl`）
 * 从这里取 nb-markdown 的宿主端口 `stickers`。没有提供时（Lab、组件测试、没有表情包插件）表情写法显示原文。
 */

import type {InjectionKey} from "vue";

import type {StickerResolver} from "@notnotype/nb-markdown";

export const markdownStickersKey: InjectionKey<StickerResolver> = Symbol("nbook.markdown/stickers");
