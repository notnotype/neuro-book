/**
 * `nbook.network` 的文字引用构造函数（docs/specs/ui/i18n.md 的“目录与键”）；目录本身只在浏览器的构建里（`web/text.ts`），这里只取它的
 * 类型核对键。
 */

import {pluginText} from "nbook/shared/plugin-text";

import type zhCN from "../locales/zh-CN.json";

/** 命名空间 = 插件 id；写字面量是因为取 `descriptor` 会成环。 */
export const NETWORK_TEXT_NAMESPACE = "nbook.network";
export const networkText = pluginText<typeof zhCN>(NETWORK_TEXT_NAMESPACE);
