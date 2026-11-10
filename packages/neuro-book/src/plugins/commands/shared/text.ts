/**
 * 命令表自己产生的失败原因（docs/specs/workbench/commands.md 的“结果合同”）。命令表在服务端与浏览器都运行，服务端没有
 * 翻译端口、翻不了文字引用，所以原因交语言映射：用 nb-ui 的最小翻译实现按两种语言各翻一遍。占位写法与参数整理和窗口的
 * 翻译引擎相同（docs/specs/ui/i18n.md 输出 6、9）；目录只在这里读，不登记进窗口的翻译引擎。
 */

import {textRef} from "@notnotype/nb-ui/text";
import type {LocaleMap} from "@notnotype/nb-ui/text";
import {createMinimalTranslator} from "@notnotype/nb-ui/text/minimal";

import type {CatalogKey} from "nbook/shared/plugin-text";

import enUS from "../locales/en-US.json";
import zhCN from "../locales/zh-CN.json";

export type CommandsTextKey = CatalogKey<typeof zhCN>;

const NAMESPACE = "nbook.commands";
const LOCALES = ["zh-CN", "en-US"] as const;

/** 缺键、缺参数时最小实现退回键名或原样的占位；键由类型约束，目录两种语言的键与占位由目录检查核对。 */
const translator = createMinimalTranslator({catalogs: {[NAMESPACE]: {"zh-CN": zhCN, "en-US": enUS}}});

/** 一条原因的各语言文字。 */
export function commandsMessage(key: CommandsTextKey, params: Readonly<Record<string, string>> = {}): LocaleMap {
    const ref = textRef(key, params, NAMESPACE);
    return Object.fromEntries(LOCALES.map((locale) => [locale, translator.translate(ref, locale)]));
}
