/**
 * 选切点与定位保留部分（docs/specs/agent/compaction.md 输出 4）。切点按路径顺序，`tokensKept` 递减。
 */

import type {CompactionCut, CompactionJob, Message} from "@notnotype/nb-harness/kernel/contracts";

/** 要摘要的方法留原文的量（t11 决定 1）。 */
export const KEEP_TOKENS = 20_000;
/** 留下的原文不超过会话模型窗口的这个比例：小窗口的模型留两万放不下，压缩完马上又溢出。 */
const WINDOW_SHARE = 0.25;

/**
 * 要摘要的两种方法用：保留量不超过上限的最早切点，没有时取最后一个（不可切的最后一轮可以超过上限）。第一个切点什么都不去掉，
 * 摘要就没有意义，所以不选它；只有一个切点时交回 null，整段对话换成摘要。`sessionWindow` 是会话模型的窗口（0 是未知），
 * 上限按它收紧：压缩后留下的原文最终发给的是会话模型。
 */
export function pickCut(cuts: readonly CompactionCut[], sessionWindow = 0): CompactionCut | null {
    const keep = sessionWindow > 0 ? Math.min(KEEP_TOKENS, Math.floor(sessionWindow * WINDOW_SHARE)) : KEEP_TOKENS;
    const usable = cuts.slice(1);
    return usable.find((cut) => cut.tokensKept <= keep) ?? usable.at(-1) ?? null;
}

/**
 * 请求里保留部分从哪条消息开始；切点是 null 时没有保留部分，是消息的条数。步切点下这一轮的输入也留着，它排在切点之前、
 * 照样会被摘要一次：用户的要求在摘要里本来就要引原话，重复无害。定位不到（Profile 把消息改写成没有事件来源的样子）时交回 null：
 * 调用方应当改成整段换成摘要，否则切点之后的消息既进摘要又原样留下。
 */
export function keptMessageIndex(messages: readonly Message[], cut: CompactionCut | null): number | null {
    if (cut === null) return messages.length;
    const index = messages.findIndex((message) => (cut.firstEventId !== null && message.content.some((block) => block.origin.kind === "event" && block.origin.eventId === cut.firstEventId))
        || (cut.firstCallId !== null && (message.toolCalls ?? []).some((call) => call.id === cut.firstCallId)));
    return index === -1 ? null : index;
}

/** 方法成功时的公共部分：切点与 token。`tokensAfter` 和 `job.tokens` 同一口径：摘要的估算加保留量。 */
export function summaryResult(job: CompactionJob, cut: CompactionCut | null, summaryTokens: number): {readonly firstKeptEntryId: string | null; readonly tokensBefore: number; readonly tokensAfter: number} {
    return {firstKeptEntryId: cut?.entryId ?? null, tokensBefore: job.tokens, tokensAfter: summaryTokens + (cut?.tokensKept ?? 0)};
}
