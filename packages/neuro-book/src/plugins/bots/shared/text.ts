/**
 * `nbook.bots` 的文字引用构造函数（docs/specs/ui/i18n.md 的“目录与键”）。视图的标题取约定键（`views.chat.title`）。
 */

import {pluginText} from "nbook/shared/plugin-text";

import type zhCN from "../locales/zh-CN.json";

/** 命名空间 = 插件 id；写字面量是因为取 `descriptor` 会成环。 */
export const BOTS_TEXT_NAMESPACE = "nbook.bots";
export const botsText = pluginText<typeof zhCN>(BOTS_TEXT_NAMESPACE);
