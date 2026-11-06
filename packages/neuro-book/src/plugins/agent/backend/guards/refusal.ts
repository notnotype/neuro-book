import type {ModelRequest, ModelResponse} from "@notnotype/nb-harness/kernel/contracts";

/**
 * 不发请求，直接交回失败。形状要完整：缺字段时内核按“拦截交回了不合格的值”跳过这一层，请求照发，保护就静默失效了。
 * `cost` 写 0 而不是 null：null 会把这次运行的费用总和变成未知。
 */
export function refusal(request: ModelRequest, code: string, message: string): ModelResponse {
    return {
        content: [],
        toolCalls: [],
        stopReason: "error",
        usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, complete: true},
        model: request.model,
        error: {kind: "local", code, message},
    };
}
