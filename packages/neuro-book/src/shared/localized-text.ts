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

/** 设置插件加入之前界面语言固定为简体中文；有了语言设置后由它给出。 */
export const DISPLAY_LOCALE: DisplayLocale = "zh-CN";

export function localize(text: LocalizedText, locale: DisplayLocale): string {
    return text[locale];
}
