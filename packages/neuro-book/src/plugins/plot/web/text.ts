/**
 * `nbook.plot` 的消息目录（docs/specs/ui/i18n.md 的“目录与键”）。目录随前端构建：`web/plugins.ts` 的 `builtinPluginCatalogs` 登记它。
 */

import type {PluginCatalogs} from "nbook/shared/convention-keys";
import {usePluginText} from "nbook/shared/use-plugin-text";

import enUS from "../locales/en-US.json";
import zhCN from "../locales/zh-CN.json";
import {PLOT_TEXT_NAMESPACE} from "../shared/text";

export const plotCatalogs: PluginCatalogs = {source: "zh-CN", catalogs: {"zh-CN": zhCN, "en-US": enUS}};

/** 组件里取文字：`const text = usePlotText();`，之后用 `text(键, 参数)`。 */
export const usePlotText = (): ReturnType<typeof usePluginText<typeof zhCN>> => usePluginText<typeof zhCN>(PLOT_TEXT_NAMESPACE);
