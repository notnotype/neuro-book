/**
 * 不是用户说的话给模型看的来源行（docs/specs/harness/runtime.md 输出 115）。宿主写 `[系统 · <label>]`，会话写 `[会话 <id>]`。
 *
 * `label` 由调用方给：渲染前把换行、控制字符与方括号换成空格、截短，免得一个 `label` 在来源行里伪造出另一行或另一个来源。
 */

import type {Issuer} from "../api/index.js";

const LABEL_MAX_CHARS = 40;

function cleanLabel(label: string): string {
    const flat = label.replace(/[\p{Cc}[\]]/gu, " ").replace(/\s+/g, " ").trim();
    return [...flat].slice(0, LABEL_MAX_CHARS).join("");
}

export function sourceLine(by: Issuer): string {
    if (by.kind === "session") return `[会话 ${cleanLabel(by.id)}]`;
    if (by.kind === "host") return `[系统 · ${cleanLabel(by.source.label) || cleanLabel(by.source.plugin)}]`;
    return "[用户]";
}

/** 正文里的 `<system-reminder>` 标签转义：正文是发出方给的，不能提前合上外面那一层。 */
const escapeReminderTags = (text: string): string => text.replace(/<(\/?)system-reminder>/giu, "&lt;$1system-reminder&gt;");

/** `hostNotice` 的缺省文字。 */
export function hostNoticeText(data: {readonly by: Issuer; readonly text: string}): string {
    return `<system-reminder>\n${sourceLine(data.by)}\n${escapeReminderTags(data.text)}\n</system-reminder>`;
}
