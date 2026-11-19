/**
 * `nbook.bots` 的消息目录：bot 视图的文字。`web/plugins.ts` 的 `builtinPluginCatalogs` 登记它，窗口挂载界面前登记进翻译引擎。
 */

import type {PluginCatalogs} from "nbook/shared/convention-keys";
import {usePluginText} from "nbook/shared/use-plugin-text";
import type {BoundText} from "nbook/shared/use-plugin-text";

import enUS from "../locales/en-US.json";
import zhCN from "../locales/zh-CN.json";
import {BOTS_TEXT_NAMESPACE} from "../shared/text";

export const botsCatalogs: PluginCatalogs = {source: "zh-CN", catalogs: {"zh-CN": zhCN, "en-US": enUS}};

/** 组件里取文字：`const t = useBotsText();` 然后 `t("chat.retry")`。 */
export const useBotsText = (): BoundText<typeof zhCN> => usePluginText<typeof zhCN>(BOTS_TEXT_NAMESPACE);
