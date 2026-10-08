/**
 * 界面文本的中英两份。插件把要显示的文本直接写进声明（例如命令标题），声明来自代码也来自以后的清单 JSON，
 * 两种来源都不经过翻译表；界面按显示语言取其中一份。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

export const LocalizedTextSchema = Type.Object({
    "zh-CN": Type.String({pattern: "\\S"}),
    "en-US": Type.String({pattern: "\\S"}),
}, {additionalProperties: false});

export type LocalizedText = Static<typeof LocalizedTextSchema>;

export type DisplayLocale = keyof LocalizedText;

/**
 * 界面上要显示的文字：中英两份，或与语言无关的字符串（路径、项目名）。显示时才按当前语言取，语言切换后已打开的
 * 面板与提示随之换文字；不要提前折成字符串快照。当前语言是配置项 `nbook.settings/locale`。
 */
export type DisplayText = string | LocalizedText;

export function localize(text: LocalizedText, locale: DisplayLocale): string {
    return text[locale];
}

export function textOf(text: DisplayText, locale: DisplayLocale): string {
    return typeof text === "string" ? text : text[locale];
}

/** 两种语言各代入一次 `{name}` 占位。 */
export function formatText(template: LocalizedText, params: Readonly<Record<string, string | number>>): LocalizedText {
    const fill = (text: string): string => text.replace(/\{(\w+)\}/gu, (placeholder, name: string) => (name in params ? String(params[name]) : placeholder));
    return {"zh-CN": fill(template["zh-CN"]), "en-US": fill(template["en-US"])};
}
