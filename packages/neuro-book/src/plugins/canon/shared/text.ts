/**
 * `nbook.canon` 的文字引用构造函数（docs/specs/ui/i18n.md 的“目录与键”）。放在 `shared/` 是因为视图与命令的声明里的文字三个
 * 位置都要登记；目录本身只在浏览器的构建里（`web/text.ts`），这里只取它的类型核对键，不引入目录内容。
 */

import {pluginText} from "nbook/shared/plugin-text";
import type {CatalogKey} from "nbook/shared/plugin-text";

import type zhCN from "../locales/zh-CN.json";

/** 命名空间 = 插件 id；写字面量是因为取 `descriptor` 会成环。浏览器端的 `useCanonText` 也用它。 */
export const CANON_TEXT_NAMESPACE = "nbook.canon";
export const canonText = pluginText<typeof zhCN>(CANON_TEXT_NAMESPACE);

/** 源语言目录里的键。 */
export type CanonTextKey = CatalogKey<typeof zhCN>;
