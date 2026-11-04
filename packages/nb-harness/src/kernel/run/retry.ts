/**
 * 模型请求的重发策略（docs/specs/harness/runtime.md 输出 62–69）。这里只判断，写日志与等待在调用方：对话请求回到运行循环的边界，
 * 所以退避期间到达的插话、设置都在下一次请求生效，拦截链（费用检查）也每次都跑。
 */

import type {ModelResponse, RetryPolicy} from "../api/index.js";

const RETRY_BASE_MS = 500;
const RETRY_BACKOFF_CAP_MS = 8_000;
const RETRY_AFTER_CAP_MS = 300_000;
export const EMPTY_REPLY_RETRIES = 3;

export const NO_RETRY: RetryPolicy = {maxRetries: 0};

/** 第 `retries` 次（从 0 算）重发前的退避。不加随机抖动：单人本地应用，抖动防的是大量客户端同时重试。 */
export const backoffDelay = (retries: number): number => Math.min(RETRY_BASE_MS * 2 ** retries, RETRY_BACKOFF_CAP_MS);

/** 这次失败要不要重发；要就交回等多久（毫秒）。可不可重发由模型端口判断（`error.retryable`），这里不看类别。 */
export function retryDelay(response: ModelResponse, retries: number, policy: RetryPolicy): number | null {
    if (response.stopReason !== "error" || response.error?.retryable !== true || retries >= policy.maxRetries) return null;
    const asked = response.error.retryAfterMs ?? 0;
    if (asked > RETRY_AFTER_CAP_MS) return null;
    return Math.max(backoffDelay(retries), asked);
}

/**
 * 对话回复算不算空：没有工具调用、没有非空白文字。只有思考块也算。停止原因 `length` 只在内容完全为空时算：
 * 真被截断的内容不为空，而网关只送 `[DONE]` 不送结束原因时适配器也记 `length`。
 */
export function isEmptyReply(response: ModelResponse): boolean {
    if (response.toolCalls.length > 0) return false;
    if (response.stopReason === "length") return response.content.length === 0;
    if (response.stopReason !== "stop" && response.stopReason !== "tool") return false;
    return !response.content.some((block) => block.kind === "text" && /\S/u.test(block.text));
}
