/**
 * `nbook.agent` 的消息目录（docs/specs/ui/i18n.md 的“目录与键”）：设置项与对话界面的文字。
 * `web/plugins.ts` 的 `builtinPluginCatalogs` 登记它，窗口挂载界面前登记进翻译引擎。
 */

import type {PluginCatalogs} from "nbook/shared/convention-keys";

import enUS from "../locales/en-US.json";
import zhCN from "../locales/zh-CN.json";

export const agentCatalogs: PluginCatalogs = {source: "zh-CN", catalogs: {"zh-CN": zhCN, "en-US": enUS}};
