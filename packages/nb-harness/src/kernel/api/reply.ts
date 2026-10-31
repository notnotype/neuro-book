/** 一条回复的文字：内容块里全部文字块按顺序相连（思考与图片不算）。日志里不另存，用到时现算。 */

import type {ContentBlock} from "./model.js";

export function replyText(content: readonly ContentBlock[]): string {
    let text = "";
    for (const block of content) if (block.kind === "text") text += block.text;
    return text;
}
