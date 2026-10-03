/**
 * Pi 请求可观测：统一入口（透明代理）。
 *
 * 所有 provider 调用（harness turn、compaction、model 连通性检查）都经过这里，避免逐处
 * 手挂钩子而漏记。职责：
 *  - 注入 onPayload/onResponse 采集 provider 原生请求体与响应元数据（不覆盖调用方自己的回调）。
 *  - 用委托式 pass-through 迭代器透传流事件，顺带测 TTFT；关闭时直接返回原始流不套壳。
 *  - finalize 挂在 original.result() 上（error/abort 也 resolve 成最终 message），不依赖 caller
 *    是否消费/abort，确保总能落一条记录。
 *  - 记录内容走**字段白名单**：只取 context/payload/model/reasoning + 响应健康度，绝不触碰
 *    options.apiKey / options.headers / options.metadata（请求侧 headers 从不落盘）；
 *    response.headers 经 sanitizeResponseHeaders 敏感头 denylist 过滤后落盘。
 *  - binding 缺省等同关闭：直接透传原始调用，零开销。
 */
import type {Api, AssistantMessage, AssistantMessageEvent, Context, Model, Models, ProviderResponse, SimpleStreamOptions} from "@earendil-works/pi-ai";
import {PiRequestRecorder} from "nbook/server/agent/observability/pi-request-recorder";
import type {PiTraceCorrelation, PiTraceDraft, PiTraceSegment} from "nbook/server/agent/observability/pi-request-recorder";
import {providerErrorText, sanitizeProviderErrorMessage} from "nbook/server/agent/observability/provider-error-sanitizer";

/** 每次调用的 trace 开关（由 config 解析后传入；recorder/代理都不读 config）。 */
export type PiTraceSettings = {
    enabled: boolean;
    capturePayload: boolean;
    maxRecords: number;
};

/** 一次 traced 调用的绑定：recorder 实例 + 开关 + 领域关联。 */
export type PiTraceBinding = {
    recorder: PiRequestRecorder;
    settings: PiTraceSettings;
    correlation: PiTraceCorrelation;
};

/** 调用方提供的 bounded trace 投影；与真实 Provider Context 分离。 */
export type PiTraceProjection = {
    context: Context;
    /**
     * 上下文分区归因（Task 126）。只有走 profile prepare 的主 turn 能算出它；
     * compaction / health-check 不提供，落盘时该字段缺省。
     */
    segments?: PiTraceSegment[];
    /** 分区归因来源；`legacy` 表示由位置推断而来。 */
    attribution?: "full" | "legacy";
    /** 工具集指纹，用于跨请求检测缓存断点前移。 */
    toolsHash?: string;
    /** attachment 请求不捕获 provider 原生 payload。 */
    payloadOmittedReason?: "attachment";
};

/**
 * 调用方实际用到的流能力子集：`for await` + `result()`。
 * 用结构化接口而非 AssistantMessageEventStream，这样代理可返回普通对象，
 * 关闭时直接返回原始流实例（它的 public 成员满足本接口）。
 */
export interface ObservableAssistantStream {
    [Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent>;
    result(): Promise<AssistantMessage>;
}

/** 固定敏感响应头（凭据 / 会话类），不落盘。 */
const SENSITIVE_RESPONSE_HEADERS = new Set(["set-cookie", "cookie", "authorization", "proxy-authorization", "www-authenticate"]);

/**
 * 过滤响应头：用敏感头 denylist 而非逐 provider 白名单——未知网关头保留 debug 价值。
 * 注意 ratelimit 头（如 anthropic-ratelimit-input-tokens-remaining）名字含 "token"，
 * 必须先豁免再做 token/secret/api-key 子串匹配，否则会误杀限流排查的核心信息。
 */
export function sanitizeResponseHeaders(headers?: Record<string, string>): Record<string, string> | undefined {
    if (!headers) {
        return undefined;
    }
    const kept: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) {
        const lower = name.toLowerCase();
        const compact = lower.replaceAll("-", "").replaceAll("_", "");
        const sensitive = SENSITIVE_RESPONSE_HEADERS.has(lower)
            || (!lower.includes("ratelimit") && (compact.includes("token") || compact.includes("secret") || compact.includes("apikey")));
        if (!sensitive) {
            kept[name] = value;
        }
    }
    return kept;
}

/**
 * 组装一条 trace 记录：从 onPayload/onResponse/流事件/最终 message 收集，finalize 时交给 recorder。
 *
 * 约定：collector 持有 context/payload 的**引用**，真正 JSON 序列化在 recorder 串行队列中延后执行。
 * 调用方必须每次调用传入新建的 context 对象、事后不 mutate（现状 streamAssistant 与 compaction 均满足），
 * 否则落盘内容会失真。
 */
class TraceCollector {
    private readonly startedAtMs = Date.now();
    private readonly startedAtIso = new Date().toISOString();
    private capturedPayload: unknown;
    private reasoning?: string;
    private httpStatus?: number;
    private headers?: Record<string, string>;
    private ttftMs?: number;
    private finalized = false;

    constructor(
        private readonly model: Model<Api>,
        private readonly context: Context,
        private readonly binding: PiTraceBinding,
        /** 投影中除 context 外的附加事实（分区归因、工具指纹、payload 省略原因）。 */
        private readonly extras: Omit<PiTraceProjection, "context"> = {},
    ) {}

    /** 合并 onPayload/onResponse，链式保留调用方原有回调，不覆盖。 */
    mergeOptions(options?: SimpleStreamOptions): SimpleStreamOptions {
        this.reasoning = options?.reasoning;
        const prevPayload = options?.onPayload;
        const prevResponse = options?.onResponse;
        return {
            ...options,
            onPayload: async (payload: unknown, model: Model<Api>) => {
                if (this.binding.settings.capturePayload && !this.extras.payloadOmittedReason) {
                    this.capturedPayload = payload;
                }
                return prevPayload ? prevPayload(payload, model) : undefined;
            },
            onResponse: async (response: ProviderResponse, model: Model<Api>) => {
                this.httpStatus = response.status;
                this.headers = sanitizeResponseHeaders(response.headers);
                await prevResponse?.(response, model);
            },
        };
    }

    /** 首个非 "start" 事件即视为首 token，记 TTFT。 */
    markFirstToken(event: AssistantMessageEvent): void {
        if (this.ttftMs === undefined && event.type !== "start") {
            this.ttftMs = Date.now() - this.startedAtMs;
        }
    }

    /**
     * message 为空表示未拿到最终消息（pi 违反契约抛异常的兜底路径），status 直接判 error，
     * 绝不能落成误导性的 "ok"；fallbackError 用于此时保留错误文本。幂等。
     */
    finalize(message: AssistantMessage | undefined, fallbackError?: string): void {
        if (this.finalized) {
            return;
        }
        this.finalized = true;
        const stop = message?.stopReason;
        const status: PiTraceDraft["status"] = !message ? "error" : stop === "error" ? "error" : stop === "aborted" ? "aborted" : "ok";
        const draft: PiTraceDraft = {
            status,
            correlation: this.binding.correlation,
            request: {
                provider: String(this.model.provider),
                api: String(this.model.api),
                model: this.model.id,
                baseUrl: this.model.baseUrl,
                reasoning: this.reasoning,
                context: this.context,
                segments: this.extras.segments,
                attribution: this.extras.attribution,
                toolsHash: this.extras.toolsHash,
                payload: this.capturedPayload,
                payloadOmittedReason: this.extras.payloadOmittedReason,
            },
            response: {
                httpStatus: this.httpStatus,
                headers: this.headers,
                stopReason: message?.stopReason,
                usage: message?.usage
                    ? {
                        input: message.usage.input,
                        output: message.usage.output,
                        cacheRead: message.usage.cacheRead,
                        cacheWrite: message.usage.cacheWrite,
                        cacheWrite1h: message.usage.cacheWrite1h,
                        reasoning: message.usage.reasoning,
                        totalTokens: message.usage.totalTokens,
                    }
                    : undefined,
                errorMessage: message?.errorMessage
                    ? sanitizeProviderErrorMessage(message.errorMessage)
                    : fallbackError,
            },
            timing: {startedAt: this.startedAtIso, ttftMs: this.ttftMs, durationMs: Date.now() - this.startedAtMs},
        };
        // fire-and-forget：recorder 内部串行 + best-effort，不阻塞、不抛。
        void this.binding.recorder.record(draft, {maxRecords: this.binding.settings.maxRecords});
    }
}

/**
 * 带 trace 的 streamSimple。binding 缺省或关闭时返回原始流不套壳，零开销零风险。
 * 开启时返回委托式 pass-through 流（caller 拉 wrapper → wrapper 拉 original，单消费链）。
 */
export function tracedStreamSimple(
    models: Models,
    model: Model<Api>,
    context: Context,
    options: SimpleStreamOptions | undefined,
    binding?: PiTraceBinding,
    projection?: PiTraceProjection,
): ObservableAssistantStream {
    if (!binding?.settings.enabled) {
        return models.streamSimple(model, context, options);
    }
    const collector = new TraceCollector(model, structuredClone(projection?.context ?? context), binding, {
        segments: projection?.segments,
        attribution: projection?.attribution,
        toolsHash: projection?.toolsHash,
        payloadOmittedReason: projection?.payloadOmittedReason,
    });
    const original = models.streamSimple(model, context, collector.mergeOptions(options));
    // finalize 挂 result()：无论 caller 是否消费/abort 都能落记录；error/abort 也 resolve 成最终 message。
    void original.result().then((message) => collector.finalize(message)).catch((error: unknown) => collector.finalize(undefined, providerErrorText(error)));
    return {
        [Symbol.asyncIterator]() {
            return (async function* () {
                for await (const event of original) {
                    collector.markFirstToken(event);
                    yield event;
                }
            })();
        },
        result() {
            return original.result();
        },
    };
}

/**
 * 带 trace 的 completeSimple。它内部流式收集、不对外暴露流，故无 TTFT。
 * onPayload/onResponse 仍在 provider 内触发，请求体与响应元数据照常采集；binding 缺省等同关闭。
 */
export async function tracedCompleteSimple(
    models: Models,
    model: Model<Api>,
    context: Context,
    options: SimpleStreamOptions | undefined,
    binding?: PiTraceBinding,
    projection?: PiTraceProjection,
): Promise<AssistantMessage> {
    if (!binding?.settings.enabled) {
        return models.completeSimple(model, context, options);
    }
    const collector = new TraceCollector(model, structuredClone(projection?.context ?? context), binding, {
        segments: projection?.segments,
        attribution: projection?.attribution,
        toolsHash: projection?.toolsHash,
        payloadOmittedReason: projection?.payloadOmittedReason,
    });
    try {
        const message = await models.completeSimple(model, context, collector.mergeOptions(options));
        collector.finalize(message);
        return message;
    } catch (error) {
        collector.finalize(undefined, providerErrorText(error));
        throw error;
    }
}
