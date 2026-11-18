/**
 * `nbook.canon` 的消息目录（docs/specs/ui/i18n.md 的“目录与键”）。目录随前端构建：`web/plugins.ts` 的 `builtinPluginCatalogs`
 * 登记它，窗口挂载界面前登记进翻译引擎，命名空间是插件 id。
 */

import type {PluginCatalogs} from "nbook/shared/convention-keys";
import {usePluginText} from "nbook/shared/use-plugin-text";

import enUS from "../locales/en-US.json";
import zhCN from "../locales/zh-CN.json";
import {CANON_TEXT_NAMESPACE} from "../shared/text";

export const canonCatalogs: PluginCatalogs = {source: "zh-CN", catalogs: {"zh-CN": zhCN, "en-US": enUS}};

/** 组件里取文字：`const text = useCanonText();`，之后用 `text(键, 参数)`。 */
export const useCanonText = (): ReturnType<typeof usePluginText<typeof zhCN>> => usePluginText<typeof zhCN>(CANON_TEXT_NAMESPACE);
