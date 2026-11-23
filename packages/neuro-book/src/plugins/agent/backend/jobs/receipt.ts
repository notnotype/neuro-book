/**
 * 回执的正文（docs/specs/agent/jobs.md 的回执）：后台任务经提醒送回启动它的会话时，模型看到的那段文字。
 *
 * 每件一段、有上限：超长的留头留尾、中间写省略，全文地址放在段末，截断不会切掉它（后台命令的报错多在结尾）。一条提醒装几段由送达决定，
 * 单条至多 `RECEIPT_MAX_BYTES`（内核单条上限 32 KiB，留出开头与来源行的余量）。
 */

import type {Job} from "./center";

/** 每件任务一段至多多少字节（UTF-8）。 */
export const SEGMENT_MAX_BYTES = 12 * 1024;
/** 一条回执提醒至多多少字节。 */
export const RECEIPT_MAX_BYTES = 30 * 1024;

export const RECEIPT_HEAD = "以下是你启动的后台任务的回执，不是用户说的话；已经交给你了，不用再 wait 它们。";

const bytes = (text: string): number => Buffer.byteLength(text, "utf8");

/** 按字节截出开头或结尾，不切开多字节字符。 */
function headBytes(text: string, max: number): string {
    const buffer = Buffer.from(text, "utf8");
    if (buffer.length <= max) return text;
    let end = max;
    while (end > 0 && (buffer[end]! & 0xc0) === 0x80) end -= 1;
    return buffer.subarray(0, end).toString("utf8");
}

function tailBytes(text: string, max: number): string {
    const buffer = Buffer.from(text, "utf8");
    if (buffer.length <= max) return text;
    let start = buffer.length - max;
    while (start < buffer.length && (buffer[start]! & 0xc0) === 0x80) start += 1;
    return buffer.subarray(start).toString("utf8");
}

/**
 * 一件任务的段落：`body` 是驱动交回的结果文字。放得下就原样；放不下时留头留尾，段末写全文在哪（`address`），没有地址时写明全文只在
 * 任务的输出里。
 */
export function segment(body: string, address: string | null, max = SEGMENT_MAX_BYTES): string {
    if (bytes(body) <= max) return body;
    const tail = address === null ? "\n（全文太长，只给开头与结尾）" : `\n全文：${address}`;
    const room = Math.max(0, max - bytes(tail) - 64);
    const head = headBytes(body, Math.floor(room / 2));
    const end = tailBytes(body, room - bytes(head));
    const omitted = bytes(body) - bytes(head) - bytes(end);
    return `${head}\n……（中间省略 ${String(omitted)} 字节）……\n${end}${tail}`;
}

/** 回执里一件任务的标题行。 */
export function receiptTitle(job: Job): string {
    const how = job.state === "question" ? "在问你" : job.outcome?.byUser === true ? "被用户停止" : STATE_TEXT[job.state] ?? job.state;
    return `【${job.label} ${job.id}：${job.summary}｜${how}】`;
}

const STATE_TEXT: Readonly<Record<string, string>> = {completed: "完成", failed: "失败", aborted: "已停止", interrupted: "已中断"};

/** 把几段装进一条或几条提醒，每条至多 `RECEIPT_MAX_BYTES`；交回每条的正文与装进去的段落下标。 */
export function pack(parts: readonly string[]): {readonly text: string; readonly indexes: readonly number[]}[] {
    const notices: {text: string; indexes: number[]}[] = [];
    let current: {text: string; indexes: number[]} | null = null;
    parts.forEach((part, index) => {
        const piece = `\n\n${part}`;
        if (current !== null && bytes(current.text) + bytes(piece) > RECEIPT_MAX_BYTES) {
            notices.push(current);
            current = null;
        }
        current ??= {text: RECEIPT_HEAD, indexes: []};
        current.text += piece;
        current.indexes.push(index);
    });
    if (current !== null) notices.push(current);
    return notices;
}

/** 放不下全文时的短回执：至少让模型知道还有哪几件、怎样取（审查第 6 条）。 */
export function shortReceipt(jobs: readonly Job[]): string {
    return `还有 ${String(jobs.length)} 件后台任务的回执没放下：${jobs.map((job) => job.id).join("、")}。用 wait 取（给 jobs 参数只取这几件）。`;
}
