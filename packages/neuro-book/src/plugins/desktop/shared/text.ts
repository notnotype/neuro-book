/**
 * `nbook.desktop` 的文字引用构造函数（docs/specs/ui/i18n.md 的“目录与键”）。放在 `shared/` 是因为 `shared/contracts.ts`
 * 的设置项说明要构造引用；目录本身只在浏览器构建里（`web/text.ts`），这里只取它的类型核对键。命名空间写字面量而不取
 * `descriptor.id`：`plugin.ts` 经 `shared/contracts.ts` 引到这里，取 `descriptor` 会成环；与插件 id 的一致由 `locales.test.ts` 核对。
 */

import {pluginText} from "nbook/shared/plugin-text";
import type {CatalogKey} from "nbook/shared/plugin-text";

import type zhCN from "../locales/zh-CN.json";

export const DESKTOP_TEXT_NAMESPACE = "nbook.desktop";
export const desktopText = pluginText<typeof zhCN>(DESKTOP_TEXT_NAMESPACE);

/** 源语言目录里的键（复数形归到不带后缀的键）。 */
export type DesktopTextKey = CatalogKey<typeof zhCN>;
