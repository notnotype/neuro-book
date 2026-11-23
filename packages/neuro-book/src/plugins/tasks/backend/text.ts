/**
 * 清单里文字值与进度的校验与归一（docs/specs/workbench/background-tasks.md 的“输入与前置条件”）：自己的任务与提供方的行共用。
 * 进了清单的每一项都要过远程合同的 schema，所以在登记、更新与读行的入口处校验、截短。
 */

import type {Text} from "@notnotype/nb-ui/text";
import {Value} from "typebox/value";

import {TextSchema} from "nbook/shared/text";

export const TITLE_MAX = 200;
export const MESSAGE_MAX = 500;
/** 文字引用与语言映射序列化后的上限（UTF-8 字节）。 */
const STRUCTURED_TEXT_MAX_BYTES = 1024;

/** 截到 `max` 个码元，不切开代理对。 */
export function truncate(text: string, max: number): {readonly text: string; readonly truncated: boolean} {
    if (text.length <= max) return {text, truncated: false};
    let end = max;
    const last = text.charCodeAt(end - 1);
    if (last >= 0xd800 && last <= 0xdbff) end -= 1;
    return {text: text.slice(0, end), truncated: true};
}

/** 校验并归一一个文字值；不合格时交回原因。文字引用与语言映射存一份副本：发起方之后改它手里的对象，不能绕过这里的校验。 */
export function normalizeText(value: unknown, max: number): {readonly ok: true; readonly text: Text} | {readonly ok: false; readonly reason: string} {
    if (!Value.Check(TextSchema, value)) return {ok: false, reason: "not a text value"};
    if (typeof value === "string") return {ok: true, text: truncate(value, max).text};
    // 语言映射的键是语言标签，不会是 `kind`（四个字母的主标签不合法），所以有 `kind: "text"` 的就是文字引用。
    const reference = value as {readonly kind?: unknown; readonly ns?: unknown};
    if (reference.kind === "text" && reference.ns === undefined) return {ok: false, reason: "a text reference must carry its namespace"};
    const json = JSON.stringify(value);
    if (Buffer.byteLength(json, "utf8") > STRUCTURED_TEXT_MAX_BYTES) return {ok: false, reason: `a structured text value is over ${STRUCTURED_TEXT_MAX_BYTES} bytes`};
    return {ok: true, text: JSON.parse(json) as Text};
}

export function normalizeProgress(value: number | null | undefined): number | null {
    if (value === null || value === undefined || !Number.isFinite(value)) return null;
    return Math.min(100, Math.max(0, value));
}

