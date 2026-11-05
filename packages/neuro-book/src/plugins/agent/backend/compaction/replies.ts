/** 两种要调模型的方法共用：判回复能不能当摘要、输出上限、累计用量。 */

import type {JsonValue, ModelResponse, Usage} from "@notnotype/nb-harness/kernel/contracts";

/** 摘要的上限（t11 决定 1）。 */
const SUMMARY_MAX_TOKENS = 16_384;

/** 输出上限：不超过模型的输出上限；窗口知道时不超过四分之一，小窗口的模型还要放得下输入。 */
export function outputLimit(info: {readonly contextWindow: number; readonly maxOutput?: number}): number {
    return Math.min(SUMMARY_MAX_TOKENS, info.maxOutput ?? SUMMARY_MAX_TOKENS, info.contextWindow > 0 ? Math.floor(info.contextWindow / 4) : SUMMARY_MAX_TOKENS);
}

export const responseText = (response: ModelResponse): string => response.content.flatMap((block) => (block.kind === "text" ? [block.text] : [])).join("").trim();

/** 这条回复不能当摘要的原因；能当时是 null。写到一半被截断的也不要：最后的“下一步”正好在那里。 */
export function modelFailure(response: ModelResponse): string | null {
    if (response.stopReason === "error" || response.stopReason === "aborted") return response.error?.code ?? response.error?.kind ?? response.stopReason;
    if (response.toolCalls.length > 0) return "called-a-tool";
    if (response.stopReason === "length") return "truncated";
    if (responseText(response) === "") return "empty-reply";
    return null;
}

/** 这个方法各次调用的用量之和，写进 `details` 给界面看。有一次没有单价，费用就是未知。 */
export function sumUsage(usages: readonly Usage[]): JsonValue {
    const total = (pick: (usage: Usage) => number): number => usages.reduce((sum, usage) => sum + pick(usage), 0);
    return {
        input: total((usage) => usage.input),
        output: total((usage) => usage.output),
        cacheRead: total((usage) => usage.cacheRead),
        cacheWrite: total((usage) => usage.cacheWrite),
        cost: usages.some((usage) => usage.cost === null) ? null : total((usage) => usage.cost ?? 0),
    };
}
