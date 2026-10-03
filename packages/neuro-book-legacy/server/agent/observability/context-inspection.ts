/**
 * 上下文检查面板的装配助手（Task 126 批次 D）。
 *
 * 只做形状转换与 provider 缓存语义判定，不碰 IO、不读 config。
 */
import type {JsonValue} from "nbook/server/agent/messages/types";
import type {Model} from "nbook/server/agent/messages/types";
import type {PiTraceIndexEntry} from "nbook/server/agent/observability/pi-request-recorder";
import type {CacheRetention} from "nbook/server/agent/observability/context-diagnostics";
import type {AgentContextInspectionDto, AgentContextTimelineEntryDto} from "nbook/shared/dto/agent-context-inspection.dto";

/** Anthropic ephemeral 缓存的两档保留期。 */
const ANTHROPIC_SHORT_SECONDS = 5 * 60;
const ANTHROPIC_LONG_SECONDS = 60 * 60;
/** OpenAI Responses 的 `prompt_cache_retention: "24h"`。 */
const OPENAI_RESPONSES_LONG_SECONDS = 24 * 60 * 60;

/** 事实全部未知时的兜底。面板据此仍能打开，并由 `contextWindowUnset` 诊断说明原因。 */
export function emptyContextFacts(): AgentContextInspectionDto["facts"] {
    return {contextWindowTokens: null, compactionTriggerTokens: null, cacheRetention: null};
}

/** index 条目 → 时间轴 DTO。只取面板用得到的字段，不透传 bytes / ttft 等无关列。 */
export function timelineDto(entries: readonly PiTraceIndexEntry[]): AgentContextTimelineEntryDto[] {
    return entries.map((entry) => ({
        id: entry.id,
        ts: entry.ts,
        kind: entry.kind,
        model: entry.model,
        ...(entry.toolsHash === undefined ? {} : {toolsHash: entry.toolsHash}),
        ...(entry.usage === undefined ? {} : {usage: entry.usage}),
    }));
}

/**
 * 判定该模型的缓存断点是否由我们显式控制，以及保留期。
 *
 * 返回 null = 该 provider 走**自动前缀缓存**，断点不由我们放置（OpenAI Completions、
 * 各家兼容网关等）。面板据此显示「自动前缀缓存」而不是编一个保留期出来。
 *
 * 判据对齐 pi 适配器的实际行为，不是按厂商名猜：
 *  - `anthropic-messages` / `bedrock-converse-stream` 会写 `cache_control`，分 5 分钟 / 1 小时两档；
 *  - `openai-responses` 只在 long 档传 `prompt_cache_retention: "24h"`，其余档位仍是自动缓存；
 *  - 其余 api 一律自动。
 *
 * 保留期档位的解析顺序也对齐 pi：显式 `cacheRetention` > `PI_CACHE_RETENTION=long` > 默认 `short`。
 */
export function resolveModelCacheRetention(model: Model<any>, requestOptions: Record<string, JsonValue>): CacheRetention {
    const kind = resolveRetentionKind(requestOptions);
    const api = String(model.api);
    if (api === "anthropic-messages" || api === "bedrock-converse-stream") {
        if (kind === "none") {
            return {kind, seconds: 0};
        }
        return {kind, seconds: kind === "long" ? ANTHROPIC_LONG_SECONDS : ANTHROPIC_SHORT_SECONDS};
    }
    if (api === "openai-responses" && kind === "long") {
        return {kind, seconds: OPENAI_RESPONSES_LONG_SECONDS};
    }
    return null;
}

/** 档位解析。env 只认 `PI_CACHE_RETENTION=long`，与 pi 一致。 */
function resolveRetentionKind(requestOptions: Record<string, JsonValue>): "none" | "short" | "long" {
    const explicit = requestOptions.cacheRetention;
    if (explicit === "none" || explicit === "short" || explicit === "long") {
        return explicit;
    }
    const env = requestOptions.env;
    if (env && typeof env === "object" && !Array.isArray(env) && env.PI_CACHE_RETENTION === "long") {
        return "long";
    }
    return "short";
}
