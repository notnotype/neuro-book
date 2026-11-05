/**
 * 选切点与定位保留部分（docs/specs/agent/compaction.md 输出 4）。切点按路径顺序，`tokensKept` 递减。
 */

import type {CompactionCut, CompactionJob, Message} from "@notnotype/nb-harness/kernel/contracts";

/** 要摘要的方法留原文的量（t11 决定 1）。 */
export const KEEP_TOKENS = 20_000;

/**
 * 要摘要的两种方法用：保留量不超过上限的最早切点，没有时取最后一个（不可切的最后一轮可以超过上限）。第一个切点什么都不去掉，
 * 摘要就没有意义，所以不选它；只有一个切点时交回 null，整段对话换成摘要。
 */
export function pickCut(cuts: readonly CompactionCut[]): CompactionCut | null {
    const usable = cuts.slice(1);
    return usable.find((cut) => cut.tokensKept <= KEEP_TOKENS) ?? usable.at(-1) ?? null;
}

/**
 * 请求里保留部分从哪条消息开始；定位不到时算全部要摘要：多摘一点也不丢内容。步切点下这一轮的输入也留着，它排在切点之前、
 * 照样会被摘要一次：用户的要求在摘要里本来就要引原话，重复无害。
 */
export function keptMessageIndex(messages: readonly Message[], cut: CompactionCut | null): number {
    if (cut === null) return messages.length;
    const index = messages.findIndex((message) => (cut.firstEventId !== null && message.content.some((block) => block.origin.kind === "event" && block.origin.eventId === cut.firstEventId))
        || (cut.firstCallId !== null && (message.toolCalls ?? []).some((call) => call.id === cut.firstCallId)));
    return index === -1 ? messages.length : index;
}

/** 方法成功时的公共部分：切点与 token。`tokensAfter` 和 `job.tokens` 同一口径：摘要的估算加保留量。 */
export function summaryResult(job: CompactionJob, cut: CompactionCut | null, summaryTokens: number): {readonly firstKeptEntryId: string | null; readonly tokensBefore: number; readonly tokensAfter: number} {
    return {firstKeptEntryId: cut?.entryId ?? null, tokensBefore: job.tokens, tokensAfter: summaryTokens + (cut?.tokensKept ?? 0)};
}
