export const DEFAULT_AGENT_DIFF_MAX_CHARS = 512;
export const MAX_AGENT_DIFF_MAX_CHARS = 8_192;
export const MAX_AGENT_DIFF_TOTAL_CHARS = 8_192;
export const MAX_AGENT_CHANGE_DETAIL_FILES = 4;
export const MAX_AGENT_CHANGE_LISTED_FILES = 50;
export const MAX_AGENT_CHANGE_NOTICE_CHARS = 12_288;
const APPROX_CHARS_PER_CHANGED_LINE = 32;

/**
 * 按字符预算推导变更行预算。512 字符约等于 256 token，默认对应 16 条 added/removed 行。
 * 字符预算为 0 时关闭直接内联，但仍可生成位置摘要。
 */
export function agentDiffLineLimit(maxChars: number): number {
    if (maxChars <= 0) {
        return 0;
    }
    return Math.max(1, Math.floor(maxChars / APPROX_CHARS_PER_CHANGED_LINE));
}

/**
 * 计算一轮 notice 可使用的 inline diff 总预算。
 * 默认单文件 512 字符时总额为 2048；用户提高单文件上限时，总额最多放宽到 8192。
 */
export function agentDiffTotalLimit(maxChars: number): number {
    if (maxChars <= 0) {
        return 0;
    }
    return Math.min(MAX_AGENT_DIFF_TOTAL_CHARS, maxChars * MAX_AGENT_CHANGE_DETAIL_FILES);
}
