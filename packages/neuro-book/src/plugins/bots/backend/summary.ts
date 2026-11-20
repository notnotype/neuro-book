/**
 * bot 列表里“最后一句话”的摘要（docs/specs/bots/bots.md 输出 7）：从一条计数消息（`assistant` 事件）的内容取一行短文字。
 */

import {replyText} from "@notnotype/nb-harness/kernel/contracts";
import type {ContentBlock} from "@notnotype/nb-harness/kernel/contracts";
import {stickerAt} from "@notnotype/nb-markdown";

/** 摘要至多多少个码点（不算末尾的“…”）。 */
export const SUMMARY_MAX = 80;

/**
 * 只取文字块（`replyText`）；表情写法换成“[表情]”，转义的（`\:lyra/开心:`，聊天里显示成字面）去掉反斜杠、原样留着；空白折叠成一个空格；按码点截到 `SUMMARY_MAX`，超了加“…”。没有文字时有图片写“[图片]”，
 * 否则写“[消息]”。Markdown 标记（加粗、链接的写法）原样留着：列表一行放不下渲染结果，去标记要再解析一遍，收益小（已知限制）。
 */
export function messageSummary(content: readonly ContentBlock[]): string {
    const raw = replyText(content);
    let text = "";
    for (let index = 0; index < raw.length;) {
        // 转义的冒号：Markdown 显示成字面的冒号，后面那段不是表情。
        if (raw[index] === "\\" && raw[index + 1] === ":") {
            text += ":";
            index += 2;
            continue;
        }
        const sticker = stickerAt(raw, index);
        if (sticker === null) {
            text += raw[index];
            index += 1;
        } else {
            text += "[表情]";
            index += sticker.raw.length;
        }
    }
    const collapsed = text.replace(/\s+/gu, " ").trim();
    if (collapsed === "") return content.some((block) => block.kind === "image" || block.kind === "imageRef") ? "[图片]" : "[消息]";
    const points = Array.from(collapsed);
    return points.length > SUMMARY_MAX ? `${points.slice(0, SUMMARY_MAX).join("")}…` : collapsed;
}
