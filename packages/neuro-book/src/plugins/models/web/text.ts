/**
 * `nbook.models` 的消息目录（docs/specs/ui/i18n.md 的“目录与键”）。目录随前端构建：`web/plugins.ts` 的
 * `builtinPluginCatalogs` 登记它，窗口挂载界面前登记进翻译引擎，命名空间是插件 id；文字引用的构造函数在 `shared/text.ts`。
 */

import type {PluginCatalogs} from "nbook/shared/convention-keys";

import enUS from "../locales/en-US.json";
import zhCN from "../locales/zh-CN.json";

export const modelsCatalogs: PluginCatalogs = {source: "zh-CN", catalogs: {"zh-CN": zhCN, "en-US": enUS}};
