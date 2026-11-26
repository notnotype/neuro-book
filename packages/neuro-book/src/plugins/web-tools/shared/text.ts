/**
 * `nbook.web` 的文字引用构造函数（docs/specs/ui/i18n.md 的“目录与键”）。设置声明的文字三个位置都要登记，所以放在 `shared/`；
 * 目录本身只在浏览器的构建里，这里只取它的类型核对键。
 */

import {pluginText} from "nbook/shared/plugin-text";
import type {CatalogKey} from "nbook/shared/plugin-text";

import type zhCN from "../locales/zh-CN.json";

/** 命名空间 = 插件 id；写字面量是因为取 `descriptor` 会成环。 */
export const WEB_TEXT_NAMESPACE = "nbook.web";

export const webText = pluginText<typeof zhCN>(WEB_TEXT_NAMESPACE);

export type WebTextKey = CatalogKey<typeof zhCN>;
