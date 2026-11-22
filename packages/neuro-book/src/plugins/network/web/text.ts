/**
 * `nbook.network` 的消息目录：`web/plugins.ts` 的 `builtinPluginCatalogs` 登记它，窗口挂载界面前登记进翻译引擎。
 */

import type {PluginCatalogs} from "nbook/shared/convention-keys";

import enUS from "../locales/en-US.json";
import zhCN from "../locales/zh-CN.json";

export const networkCatalogs: PluginCatalogs = {source: "zh-CN", catalogs: {"zh-CN": zhCN, "en-US": enUS}};
