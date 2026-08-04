import {z} from "zod";

/** Pi OpenAI adapter 在首次请求之外最多发起的默认重试次数。 */
export const DEFAULT_PI_MAX_RETRIES = 5;

const PiMaxRetriesSchema = z.number().int("maxRetries 必须是整数").nonnegative("maxRetries 不能小于 0");

/**
 * Pi `streamSimple` 中由 NeuroBook 正式开放的 JSON-safe 请求参数。
 *
 * API key、超时、reasoning、session、signal 和观测回调由 runtime 独占，不能从
 * Config/requestOptions 覆盖。未知字段使用 strict object 明确失败，避免保存成功后
 * 被 Pi `streamSimple` 静默丢弃。
 */
export const PiSimpleRequestOptionsSchema = z.object({
    temperature: z.number().finite("temperature 必须是有限数字").nonnegative("temperature 不能小于 0").optional(),
    headers: z.record(z.string(), z.string().nullable()).optional(),
    websocketConnectTimeoutMs: z.number().int("websocketConnectTimeoutMs 必须是整数").positive("websocketConnectTimeoutMs 必须大于 0").optional(),
    maxRetries: PiMaxRetriesSchema.optional(),
    maxRetryDelayMs: z.number().int("maxRetryDelayMs 必须是整数").nonnegative("maxRetryDelayMs 不能小于 0").optional(),
    metadata: z.record(z.string(), z.json()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    transport: z.enum(["sse", "websocket", "websocket-cached", "auto"]).optional(),
    cacheRetention: z.enum(["none", "short", "long"]).optional(),
    thinkingBudgets: z.object({
        minimal: z.number().int().positive().optional(),
        low: z.number().int().positive().optional(),
        medium: z.number().int().positive().optional(),
        high: z.number().int().positive().optional(),
    }).strict().optional(),
}).strict().default({});

export type PiSimpleRequestOptionsDto = z.infer<typeof PiSimpleRequestOptionsSchema>;

/** 解析 Provider 的 maxRetries；未配置时使用产品默认值，0 仍表示关闭重试。 */
export function parsePiMaxRetries(value: unknown): number {
    return PiMaxRetriesSchema.parse(value === undefined ? DEFAULT_PI_MAX_RETRIES : value);
}
