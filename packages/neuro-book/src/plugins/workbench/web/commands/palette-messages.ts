/** 命令面板自己的文案。插件没有翻译表：中英两份写在一起，按显示语言取一份。 */

import {localize} from "nbook/shared/localized-text";
import type {DisplayLocale, LocalizedText} from "nbook/shared/localized-text";

const MESSAGES = {
    title: {"zh-CN": "命令面板", "en-US": "Command Palette"},
    placeholder: {"zh-CN": "输入命令，或输入 : 跳到某一行", "en-US": "Type a command, or : to go to a line"},
    empty: {"zh-CN": "没有匹配的命令", "en-US": "No matching commands"},
    pickEmpty: {"zh-CN": "没有匹配的项", "en-US": "No matching items"},
    linePrompt: {"zh-CN": "输入行号（1–{max}）", "en-US": "Type a line number (1–{max})"},
    goToLine: {"zh-CN": "跳转到第 {line} 行", "en-US": "Go to line {line}"},
    lineInvalid: {"zh-CN": "行号无效：{text}", "en-US": "Invalid line number: {text}"},
    lineOutOfRange: {"zh-CN": "行号超出范围：{line}（共 {total} 行）", "en-US": "Line {line} is out of range ({total} lines)"},
    noEditor: {"zh-CN": "没有活动编辑器", "en-US": "No active editor"},
    editorGone: {"zh-CN": "原编辑器已关闭或切换", "en-US": "The original editor was closed or switched"},
    lineUnsupported: {"zh-CN": "当前编辑器不支持行号跳转", "en-US": "The active editor does not support line navigation"},
    editorNotReady: {"zh-CN": "编辑器尚未就绪", "en-US": "The editor is not ready yet"},
} satisfies Record<string, LocalizedText>;

export type PaletteMessage = keyof typeof MESSAGES;

/** 取当前显示语言的文案并代入 `{name}` 占位。 */
export function paletteText(locale: DisplayLocale, key: PaletteMessage, params: Readonly<Record<string, string | number>> = {}): string {
    return localize(MESSAGES[key], locale).replace(/\{(\w+)\}/gu, (placeholder, name: string) => (name in params ? String(params[name]) : placeholder));
}
