/**
 * `nbook.agent` 的文字引用构造函数（docs/specs/ui/i18n.md 的“目录与键”）。设置声明的文字在每个位置都要登记，所以放在
 * `shared/`；目录本身只取它的类型核对键。
 */

import {pluginText} from "nbook/shared/plugin-text";

import type zhCN from "../locales/zh-CN.json";

/** 命名空间 = 插件 id；写字面量是因为取 `descriptor` 会成环。 */
export const AGENT_TEXT_NAMESPACE = "nbook.agent";
export const agentText = pluginText<typeof zhCN>(AGENT_TEXT_NAMESPACE);
