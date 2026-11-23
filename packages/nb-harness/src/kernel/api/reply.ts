/** 一条回复的文字：内容块里全部文字块按顺序相连（思考与图片不算）。日志里不另存，用到时现算。 */

import type {RunResultValue} from "./events.js";
import type {ContentBlock} from "./model.js";

export function replyText(content: readonly ContentBlock[]): string {
    let text = "";
    for (const block of content) if (block.kind === "text") text += block.text;
    return text;
}

/** 首句至多几个字符（码点）。 */
export const SENTENCE_MAX = 120;

/** 一段文字的第一句：到第一个句末标点或换行为止；超长按码点截短加省略号，不切开代理对。 */
export function firstSentence(text: string): string {
    const trimmed = text.trim();
    const end = trimmed.search(/[。！？!?\n]|\.(\s|$)/u);
    const sentence = end === -1 ? trimmed : trimmed.slice(0, end + 1).trim();
    const chars = [...sentence];
    return chars.length > SENTENCE_MAX ? `${chars.slice(0, SENTENCE_MAX).join("")}…` : sentence;
}

/**
 * 一次运行交给调用方的一行（harness/session.md 输出 22）：最后一条回复有文字时取它的首句，没有文字时取结构化结果的 JSON 的首句；
 * 都没有为 undefined。子代理工具结果的 `line` 与会话索引的 `runs[].line` 用同一种取法。
 */
export function runLine(text: string, result: RunResultValue | null | undefined): string | undefined {
    if (text !== "") return firstSentence(text);
    return result === null || result === undefined ? undefined : firstSentence(JSON.stringify(result.value));
}
