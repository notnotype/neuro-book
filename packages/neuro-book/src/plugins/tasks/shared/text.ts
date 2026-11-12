/**
 * `nbook.tasks` 的文字引用构造函数（docs/specs/ui/i18n.md 的“目录与键”）。声明里的文字（视图、条目、命令标题）三个位置都要
 * 登记，所以放在 `shared/`；目录本身只在浏览器的构建里，这里只取它的类型核对键。
 */

import {pluginText} from "nbook/shared/plugin-text";
import type {CatalogKey} from "nbook/shared/plugin-text";

import type zhCN from "../locales/zh-CN.json";

/** 命名空间 = 插件 id；写字面量是因为取 `descriptor` 会成环。 */
export const TASKS_TEXT_NAMESPACE = "nbook.tasks";
export const tasksText = pluginText<typeof zhCN>(TASKS_TEXT_NAMESPACE);

export type TasksTextKey = CatalogKey<typeof zhCN>;
