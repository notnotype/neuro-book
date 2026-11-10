/**
 * 命令表自己产生的失败原因（docs/specs/workbench/commands.md 的“结果合同”）。命令表在服务端与浏览器都运行，服务端没有
 * 翻译端口、翻不了文字引用，所以原因交语言映射：从本插件的两份目录按键取出，代入参数。目录只在这里读，不登记进窗口的
 * 翻译引擎；格式与占位符由目录检查（scripts/ci/message-catalogs.ts）核对。
 */

import {flattenCatalog} from "@notnotype/nb-ui/text";
import type {LocaleMap} from "@notnotype/nb-ui/text";

import type {CatalogKey} from "nbook/shared/plugin-text";

import enUS from "../locales/en-US.json";
import zhCN from "../locales/zh-CN.json";

export type CommandsTextKey = CatalogKey<typeof zhCN>;

const CATALOGS = {"zh-CN": flattenCatalog(zhCN), "en-US": flattenCatalog(enUS)} as const;

/** 一条原因的各语言文字；`{{name}}` 换成参数，没给的参数原样留着。 */
export function commandsMessage(key: CommandsTextKey, params: Readonly<Record<string, string>> = {}): LocaleMap {
    const fill = (template: string): string => template.replace(/\{\{(\w+)\}\}/gu, (whole, name: string) => params[name] ?? whole);
    return {"zh-CN": fill(CATALOGS["zh-CN"][key] ?? key), "en-US": fill(CATALOGS["en-US"][key] ?? key)};
}
