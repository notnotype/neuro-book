/**
 * 抽取的模型调用（docs/specs/story/ingest.md 输出 9）：OpenAI 兼容服务、流式、推理档与 JSON 输出原样发送，渠道失败
 * 按固定的延迟表重发；端点 400 明确拒绝推理档并列出合法档位时，改用最近的档位重发一次。
 *
 * 用 `openai` SDK 而不是问答用的 nb-harness：SDK 设 `maxRetries: 0` 后一次调用就是一次 HTTP 请求，推理档原样发送；
 * nb-harness 底下的 OMP 在一次调用里自带最多 6 次重试，端点拒绝 `minimal` 时还会自动降成 `low` 重发，两样都关不掉，
 * 与“只一层重试、只在端点列出合法档位时降一次”的合同冲突（w00024 t06 计划审查第 4、5 条的实测）。错误归类沿用
 * nb-harness 的口径（docs/specs/agent/harness.md），密钥的遮盖记号与它的 `REDACTED_KEY` 相同。不导入 nb-harness：
 * 它的入口会加载整个 OMP，抽取线程用不到。
 *
 * 这一层只管渠道：一次逻辑请求的重发、流的中止、用量与取出 JSON 对象。回复成不成形（缺本章、没有段落块）由
 * 调用方按各步自己的形状判断。
 */

import OpenAI from "openai";

/** 抽取的推理档：写时间点和段落块用最低档，其余步骤用中档；端点明确拒绝时会按它列出的合法档位降一次档。 */
export const INGEST_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;
export type IngestEffort = (typeof INGEST_EFFORTS)[number];

export type ErrorKind = "network" | "rate_limit" | "auth" | "quota" | "context_overflow" | "provider" | "local";

export interface ModelEndpoint {
    baseUrl: string;
    model: string;
    /** 密钥：调用时才从环境变量读出；没有设置时为空串（以 `auth` 失败，不发请求）。 */
    apiKey: string;
    /** 一次回复的输出上限（token）。 */
    maxTokens: number;
}

/** 一次 HTTP 尝试的用量。拿不到（中止、流中断、跑飞）时 `complete` 为 false，数值是已知的下界。 */
export interface AttemptUsage {
    input: number;
    output: number;
    cacheRead: number;
    complete: boolean;
}

export interface Attempt {
    /** 同一逻辑请求里的第几次 HTTP 尝试，从 1 起。 */
    attempt: number;
    ms: number;
    usage: AttemptUsage;
    /** 这次失败的原因；成功为 null。 */
    error: ModelError | null;
}

export class ModelError extends Error {
    readonly kind: ErrorKind;
    readonly status: number | null;

    constructor(kind: ErrorKind, status: number | null, message: string) {
        super(message);
        this.name = "ModelError";
        this.kind = kind;
        this.status = status;
    }
}

/** 调用方中止（停止抽取）。 */
export class ModelAborted extends Error {
    constructor() {
        super("模型请求被中止");
        this.name = "ModelAborted";
    }
}

export interface ModelReply {
    text: string;
    /** 服务给的结束原因（`stop`、`length` 等）。 */
    finishReason: string | null;
    /** 从回复里取出的 JSON 对象（第一个“{”到最后一个“}”）；取不出或解析失败为 null。 */
    json: unknown;
}

export interface CallOptions {
    system: string;
    user: string;
    effort: IngestEffort;
    signal?: AbortSignal;
    /**
     * 每次 HTTP 尝试发出之前调用，等它完成才发请求：进程在这次尝试中途被杀时，账上一定已经留下“发出过、用量不知道”。
     * 它失败时请求不发，错误原样抛给调用方。
     */
    onAttemptStart?: (attempt: number) => void | Promise<void>;
    /** 每次 HTTP 尝试结束时调用（成功或失败），用来记账。 */
    onAttempt?: (attempt: Attempt) => void;
    /** 至多几次 HTTP 尝试，默认按重发的延迟表（6 次）。`config test --ingest` 只试一次。 */
    maxAttempts?: number;
    /** 这次调用的身份（写进请求头 `X-Nbstory-Step`），渠道重发时不变。 */
    tag?: string;
    /** 一次 HTTP 尝试的时限；默认 10 分钟。 */
    timeoutMs?: number;
    /** 决定重发、开始等待时调用。 */
    onRetry?: (info: {attempt: number; waitMs: number; error: ModelError}) => void;
    /** 端点拒绝这个推理档、并列出合法档位时调用；随后用降后的档重发一次。 */
    onEffortFallback?: (info: {from: IngestEffort; to: IngestEffort; error: ModelError}) => void;
    /** 等待；测试注入，默认真的等。被中止时 reject。 */
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
    /** 替换 HTTP（测试用本机端点时不需要）。 */
    fetch?: typeof fetch;
}

/** 渠道失败后的等待（毫秒）：第 n 次重发前等第 n 项。表的长度就是重发次数，连同第一次合计至多 6 次。 */
export const RETRY_DELAYS_MS = [30_000, 60_000, 120_000, 180_000, 300_000];

/** 连续这么多个空白字符，判定为“跑飞”：模型写坏一段 JSON 后只输出空白，直到输出上限。 */
export const RUNAWAY_WHITESPACE = 2000;

/** 一次 HTTP 尝试（含读完整个流）的时限。 */
const ATTEMPT_TIMEOUT_MS = 600_000;
/** 请求头里写这次调用的身份（章、步骤、轮次）：渠道重发时不变。只是诊断信息，服务可以忽略；回放端点按它认请求。 */
export const STEP_HEADER = "X-Nbstory-Step";
/** 错误文字里回显的密钥换成它（与 nb-harness 的 `REDACTED_KEY` 相同）。 */
const REDACTED_KEY = "[REDACTED]";
const NETWORK_STATUSES = new Set([408, 502, 503, 504, 520, 521, 522, 523, 524]);

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new ModelAborted());
            return;
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(new ModelAborted());
        };
        signal?.addEventListener("abort", onAbort, {once: true});
    });
}

const redactKey = (text: string, apiKey: string) => (apiKey === "" ? text : text.split(apiKey).join(REDACTED_KEY));

/**
 * 给 SDK 的日志：每一项都先遮盖密钥再写到标准错误。SDK 解析坏的流数据时会把原始数据打进日志，早于本层归类错误时的
 * 遮盖（实现审查第 6 条）。
 */
function redactingLogger(apiKey: string) {
    const write = (level: string) => (...args: unknown[]) => {
        const text = args.map(arg => (typeof arg === "string" ? arg : arg instanceof Error ? arg.message : JSON.stringify(arg))).join(" ");
        console.error(`[openai ${level}] ${redactKey(text, apiKey)}`);
    };
    return {error: write("error"), warn: write("warn"), info: write("info"), debug: write("debug")};
}

/** 把服务的错误归成 Spec 的 `kind`（与 nb-harness 的归类同口径）；错误文字里回显的密钥遮盖掉。 */
function classify(error: unknown, apiKey: string): ModelError {
    const redact = (text: string) => redactKey(text, apiKey);
    if (error instanceof OpenAI.APIConnectionTimeoutError) return new ModelError("network", null, "请求超时");
    if (error instanceof OpenAI.APIConnectionError) return new ModelError("network", null, redact(`连接失败：${error.message}`));
    if (error instanceof OpenAI.APIError) {
        const status = typeof error.status === "number" ? error.status : null;
        // 没有状态码：请求已经成功、错误是流到一半服务发来的错误事件（例如 luna 渠道的 upstream_error）。这是渠道侧
        // 的临时故障，按网络失败重发（与 nb-harness 把没有状态码的临时错误归为 network 同口径）。
        if (status === null) return new ModelError("network", null, redact(error.message));
        const code = typeof error.code === "string" ? error.code : "";
        const message = redact(error.message);
        if (status === 401 || status === 403) return new ModelError("auth", status, message);
        if (status === 402 || code === "insufficient_quota") return new ModelError("quota", status, message);
        if (status === 429) return new ModelError("rate_limit", status, message);
        if (code === "context_length_exceeded") return new ModelError("context_overflow", status, message);
        if (status !== null && (NETWORK_STATUSES.has(status) || status >= 500)) return new ModelError("network", status, message);
        return new ModelError("provider", status, message);
    }
    return new ModelError("local", null, redact(error instanceof Error ? error.message : String(error)));
}

/** 渠道这边的失败（超时、断线、5xx、跑飞、流没有结束原因）重发；认证、额度、限流、模型拒绝请求（含推理档）不重发。 */
const retryable = (error: ModelError) => error.kind === "network";

/**
 * 端点 400 明确拒绝当前推理档、并列出合法档位时，选一个最近的档位（同距离优先更高的档）。
 * 只认带 `Supported values are` 且提到当前档位的错误，避免把别的 400 当成推理档问题。
 */
export function fallbackEffort(message: string, current: IngestEffort): IngestEffort | null {
    const listed = /Supported values are:?\s*([^.\n]+)/i.exec(message);
    if (!listed || (!message.includes(`'${current}'`) && !message.includes(`"${current}"`))) return null;
    const allowed = [...listed[1]!.matchAll(/['"]([a-z]+)['"]/gi)]
        .map(match => match[1]!)
        .filter((value): value is IngestEffort => (INGEST_EFFORTS as readonly string[]).includes(value));
    if (!allowed.length) return null;
    const target = INGEST_EFFORTS.indexOf(current);
    return allowed.sort((a, b) => Math.abs(INGEST_EFFORTS.indexOf(a) - target) - Math.abs(INGEST_EFFORTS.indexOf(b) - target) || INGEST_EFFORTS.indexOf(b) - INGEST_EFFORTS.indexOf(a))[0] ?? null;
}

/** 取出回复里的 JSON 对象。模型偶尔在 JSON 前后多写几个字，取第一个“{”到最后一个“}”。 */
function parseJsonObject(text: string): unknown {
    const start = text.indexOf("{"), end = text.lastIndexOf("}");
    if (start < 0 || end < start) return null;
    try {
        return JSON.parse(text.slice(start, end + 1)) as unknown;
    } catch {
        // 解析失败是回复不成形，由调用方决定重发；这里只报告“取不出”。
        return null;
    }
}

/** 一次逻辑请求：按延迟表重发渠道失败，返回最终的回复；不可重试或重试用完时抛 `ModelError`，被中止时抛 `ModelAborted`。 */
export async function callModel(endpoint: ModelEndpoint, options: CallOptions): Promise<ModelReply> {
    if (endpoint.apiKey === "") throw new ModelError("auth", null, "模型的密钥环境变量没有设置");
    const client = new OpenAI({
        apiKey: endpoint.apiKey,
        baseURL: endpoint.baseUrl,
        maxRetries: 0,
        timeout: ATTEMPT_TIMEOUT_MS,
        logger: redactingLogger(endpoint.apiKey),
        ...(options.fetch ? {fetch: options.fetch} : {}),
    });
    const sleep = options.sleep ?? defaultSleep;
    let effort = options.effort;
    let downgraded = false;
    for (let attempt = 1; ; attempt++) {
        if (options.signal?.aborted) throw new ModelAborted();
        const outcome = await attemptOnce(client, endpoint, {...options, effort}, attempt);
        if (outcome.ok) return outcome.reply;
        if (options.signal?.aborted) throw new ModelAborted();
        const next = !downgraded && outcome.error.kind === "provider" ? fallbackEffort(outcome.error.message, effort) : null;
        if (next !== null && next !== effort) {
            options.onEffortFallback?.({from: effort, to: next, error: outcome.error});
            effort = next;
            downgraded = true;
            continue;
        }
        const waitMs = attempt < (options.maxAttempts ?? Infinity) ? RETRY_DELAYS_MS[attempt - 1] : undefined;
        if (!retryable(outcome.error) || waitMs === undefined) throw outcome.error;
        options.onRetry?.({attempt, waitMs, error: outcome.error});
        await sleep(waitMs, options.signal);
    }
}

type AttemptOutcome = {ok: true; reply: ModelReply} | {ok: false; error: ModelError};

/**
 * 一次 HTTP 尝试。流为什么停下决定结果，按这个先后判断：用户停止 → 跑飞 → 超时 → 出错 → 没有结束原因 → 正常结束。
 * SDK 遇到中止时有时让迭代正常结束、不抛错（计划审查后的实现审查第 7 条），所以不能只在 catch 里认停止，要看
 * 中止是谁发起的。
 */
async function attemptOnce(client: OpenAI, endpoint: ModelEndpoint, options: CallOptions, attempt: number): Promise<AttemptOutcome> {
    await options.onAttemptStart?.(attempt);
    const started = Date.now();
    const controller = new AbortController();
    let abortedBy: "stop" | "runaway" | "timeout" | null = null;
    const abort = (why: "stop" | "runaway" | "timeout") => {
        abortedBy ??= why;
        controller.abort();
    };
    const onStop = () => abort("stop");
    options.signal?.addEventListener("abort", onStop, {once: true});
    // SDK 的 timeout 只管到收到响应头为止，流开始之后就没有计时了；这里的计时覆盖整个流。
    const timer = setTimeout(() => abort("timeout"), options.timeoutMs ?? ATTEMPT_TIMEOUT_MS);
    const usage: AttemptUsage = {input: 0, output: 0, cacheRead: 0, complete: false};
    const record = (error: ModelError | null) => options.onAttempt?.({attempt, ms: Date.now() - started, usage, error});
    let text = "";
    let finishReason: string | null = null;
    let trailingWhitespace = 0;
    /** 收到响应头、开始读流了：之后出的不是 API 错误的异常，都是读流时连接出了事。 */
    let streaming = false;
    let failure: unknown = null;
    try {
        if (options.signal?.aborted) abort("stop");
        const stream = await client.chat.completions.create(
            {
                model: endpoint.model,
                messages: [{role: "system", content: options.system}, {role: "user", content: options.user}],
                max_tokens: endpoint.maxTokens,
                stream: true,
                stream_options: {include_usage: true},
                reasoning_effort: options.effort,
                response_format: {type: "json_object"},
            },
            {signal: controller.signal, ...(options.tag ? {headers: {[STEP_HEADER]: options.tag}} : {})},
        );
        streaming = true;
        for await (const chunk of stream) {
            if (chunk.usage) {
                usage.input = chunk.usage.prompt_tokens;
                usage.output = chunk.usage.completion_tokens;
                usage.cacheRead = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
                usage.complete = true;
            }
            const choice = chunk.choices[0];
            const delta = choice?.delta?.content ?? "";
            if (delta) {
                text += delta;
                const tail = delta.length - delta.trimEnd().length;
                trailingWhitespace = tail === delta.length ? trailingWhitespace + tail : tail;
                if (trailingWhitespace >= RUNAWAY_WHITESPACE) {
                    // 中止并离开循环会取消响应体，服务才不会一直输出到上限。
                    abort("runaway");
                    break;
                }
            }
            if (choice?.finish_reason) finishReason = choice.finish_reason;
        }
    } catch (error) {
        failure = error;
    } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onStop);
    }

    const fail = (error: ModelError): AttemptOutcome => {
        usage.complete = false;
        record(error);
        return {ok: false, error};
    };
    if (abortedBy === "stop") {
        usage.complete = false;
        record(new ModelError("local", null, "被中止"));
        throw new ModelAborted();
    }
    if (abortedBy === "runaway") return fail(new ModelError("network", null, `模型跑飞：写了 ${text.length - trailingWhitespace} 个字之后只输出空白`));
    if (abortedBy === "timeout") return fail(new ModelError("network", null, `一次请求超过 ${Math.round((options.timeoutMs ?? ATTEMPT_TIMEOUT_MS) / 1000)} 秒没有结束`));
    if (failure !== null) {
        // 读流时连接断了（Bun 直接从响应体抛出，SDK 不包装）：按网络失败重发，不看错误文字。
        if (streaming && !(failure instanceof OpenAI.APIError)) return fail(new ModelError("network", null, redactKey(`读回复的流时连接断了：${failure instanceof Error ? failure.message : String(failure)}`, endpoint.apiKey)));
        return fail(classify(failure, endpoint.apiKey));
    }
    if (finishReason === null) return fail(new ModelError("network", null, "回复的流没有结束原因就断了"));
    record(null);
    return {ok: true, reply: {text, finishReason, json: parseJsonObject(text)}};
}
