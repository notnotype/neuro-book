/**
 * `nbook.network` 的消息目录与组件里取文字的函数：`web/plugins.ts` 的 `builtinPluginCatalogs` 登记目录，窗口挂载界面前登记进翻译
 * 引擎；文字引用的构造函数在 `shared/text.ts`。
 */

import type {PluginCatalogs} from "nbook/shared/convention-keys";
import {usePluginText} from "nbook/shared/use-plugin-text";
import type {BoundText} from "nbook/shared/use-plugin-text";

import enUS from "../locales/en-US.json";
import zhCN from "../locales/zh-CN.json";
import {NETWORK_TEXT_NAMESPACE} from "../shared/text";

export const networkCatalogs: PluginCatalogs = {source: "zh-CN", catalogs: {"zh-CN": zhCN, "en-US": enUS}};

export type NetworkText = BoundText<typeof zhCN>;

/** 组件里取文字：`const text = useNetworkText();` 然后 `text("page.proxy.title")`。 */
export const useNetworkText = (): NetworkText => usePluginText<typeof zhCN>(NETWORK_TEXT_NAMESPACE);
