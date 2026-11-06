/**
 * `nbook.agent` 的消息目录（docs/specs/ui/i18n.md 的“目录与键”）：设置项与对话界面的文字。
 * `web/plugins.ts` 的 `builtinPluginCatalogs` 登记它，窗口挂载界面前登记进翻译引擎。
 */

import type {PluginCatalogs} from "nbook/shared/convention-keys";
import {usePluginText} from "nbook/shared/use-plugin-text";
import type {BoundText} from "nbook/shared/use-plugin-text";

import enUS from "../locales/en-US.json";
import zhCN from "../locales/zh-CN.json";
import {AGENT_TEXT_NAMESPACE} from "../shared/text";

export const agentCatalogs: PluginCatalogs = {source: "zh-CN", catalogs: {"zh-CN": zhCN, "en-US": enUS}};

/** 组件里取文字：`const t = useAgentPageText();` 然后 `t("permissions.add")`。 */
export const useAgentPageText = (): BoundText<typeof zhCN> => usePluginText<typeof zhCN>(AGENT_TEXT_NAMESPACE);
