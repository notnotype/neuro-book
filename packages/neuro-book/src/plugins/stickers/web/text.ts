/**
 * `nbook.stickers` 的消息目录（docs/specs/ui/i18n.md 的“目录与键”）：表情包页的文字。`web/plugins.ts` 的 `builtinPluginCatalogs` 登记它，
 * 窗口挂载界面前登记进翻译引擎。
 */

import type {PluginCatalogs} from "nbook/shared/convention-keys";
import {usePluginText} from "nbook/shared/use-plugin-text";
import type {BoundText} from "nbook/shared/use-plugin-text";

import enUS from "../locales/en-US.json";
import zhCN from "../locales/zh-CN.json";
import {STICKERS_TEXT_NAMESPACE} from "../shared/text";

export const stickersCatalogs: PluginCatalogs = {source: "zh-CN", catalogs: {"zh-CN": zhCN, "en-US": enUS}};

/** 组件里取文字：`const t = useStickersPageText();` 然后 `t("rail.new")`。 */
export const useStickersPageText = (): BoundText<typeof zhCN> => usePluginText<typeof zhCN>(STICKERS_TEXT_NAMESPACE);
