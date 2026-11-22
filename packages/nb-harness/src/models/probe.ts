/**
 * 协议检测：用对话同一条路径（`buildResolution` 到 OMP 的请求构造与认证，含各家的特判）对一个地址试一种协议，判它能不能生成
 * （docs/specs/models/service.md 的“协议检测”）。
 *
 * - **恰好一次 HTTP**：OMP 的几种协议在内层自己重发（`b1-probes.txt`：500 时 Responses 实收 6 次、Anthropic 11 次，
 *   `maxHttpAttempts` 挡不住），所以经 `ResolveHooks.send` 接管最内层的发送：第一次照发，第二次不发、整次就此结束。
 * - **首个生成证据**：适配器交出第一段非空的文字、思考或工具参数增量才算；握手、角色帧、`created`/`start` 事件、空候选不交增量，
 *   不算。证据一到就中止（取消读取、中止 fetch），不等模型说完。正常收尾、报了输出 token 却没交增量的（思考全在不外露的推理里）
 *   以“结束原因是停止或截断、且输出 token 大于 0”为证据：为此关掉适配器的空回复重发（`acceptEmptyResponse`，经一个空的
 *   `transport` 打开）。不流式、整段回 JSON 的网关对话也用不了，判失败。
 * - **证据之前的错误优先**：非 2xx 的回应读正文（有上限）当原文，立即结束；不把它交给适配器（交了它会把请求全文写进日志目录，
 *   而中止后的调用不经删除那一步）。2xx 的正文在交给适配器的那一路上顺手留下开头（只有一个读者：分两路时一路不读、另一路的
 *   取消要等它，流里报错会被拖到时限），流里报错又被适配器重发时用它当原文。
 */

import {sanitizeProviderText, type ModelRequest} from "../kernel/index.js";
import {buildResolution, requestAuth, type KeyAccess, type ModelTarget, type ProviderTarget} from "./target.js";

/** 一次检测的结果。`message` 是遮盖过的服务商原文或英文开发者文字；通过时为空串。 */
export interface ProbeOutcome {
    readonly ok: boolean;
    /** 那一次请求的 HTTP 状态；没发出（本地拦下、连不上）为 null。 */
    readonly status: number | null;
    /** 从发出到拿到证据或失败的毫秒数；没发出为 null。 */
    readonly ms: number | null;
    /** 实际请求的地址（只到路径，不带查询串）；没发出为 null。 */
    readonly url: string | null;
    /**
     * 失败的码：`http`（非 2xx）、`network`（连不上、读断）、`no-content`（回应结束或要重发时还没有生成内容）、`timeout`、
     * `cancelled`；请求发出前的：`unknown-model`、`transport-unsupported`、`missing-key`、`endpoint-mismatch`；其余是适配器的错误码。
     */
    readonly code: string | null;
    readonly message: string;
}

export interface ProbeOptions {
    readonly signal: AbortSignal;
    /** 整次的时限。 */
    readonly timeoutMs: number;
    /** 计时用；缺省 `performance.now`。 */
    readonly now?: () => number;
}

/** 检测请求的最大输出：证据一到就中止，上限只在不交增量的回应上起作用；推理模型要留出能报出输出的余地。 */
const PROBE_MAX_OUTPUT = 64;
/** 物化不出来只因为没有上下文窗口时（用户填的、目录里没有的 id）补的窗口：检测不发它，只是让模型对象建得出来。 */
const PROBE_WINDOW = 8192;
/** 原文读到这么多为止。 */
const BODY_LIMIT = 8 * 1024;

const request: ModelRequest = {purpose: "background", model: "", params: {maxTokens: PROBE_MAX_OUTPUT}, headers: {}, system: [], messages: [{role: "user", content: [{kind: "text", text: "ping", origin: {kind: "fixed", by: "kernel"}}]}], tools: []};

/**
 * 留下的开头解成文字。截在上限处时，末尾若是某个密钥的前半段就一并去掉：遮盖只认完整的密钥，截断处的半个会原样留下。
 */
function headText(chunks: readonly Uint8Array[], secrets: readonly string[]): string {
    const bytes = Buffer.concat(chunks);
    let text = new TextDecoder().decode(bytes.subarray(0, BODY_LIMIT));
    if (bytes.byteLength <= BODY_LIMIT) return text;
    for (const secret of secrets) {
        for (let length = Math.min(secret.length - 1, text.length); length > 0; length -= 1) {
            if (text.endsWith(secret.slice(0, length))) {
                text = text.slice(0, -length);
                break;
            }
        }
    }
    return text;
}

/** 读正文的开头至多 `BODY_LIMIT` 字节，然后取消。 */
async function readHead(body: ReadableStream<Uint8Array> | null): Promise<Uint8Array[]> {
    const chunks: Uint8Array[] = [];
    if (body === null) return chunks;
    const reader = body.getReader();
    let size = 0;
    try {
        while (size <= BODY_LIMIT) {
            const {done, value} = await reader.read();
            if (done) break;
            chunks.push(value);
            size += value.byteLength;
        }
    } catch {
        // 读断了（被中止或连接断开）：已读到的照用，读不到的原因由调用方的结果说明。
    } finally {
        void reader.cancel().catch(() => undefined);
    }
    return chunks;
}

/** 把正文原样交给适配器，经过时留下开头（多读一字节，好知道截没截）；适配器取消时取消源头。 */
function recording(body: ReadableStream<Uint8Array>, chunks: Uint8Array[]): ReadableStream<Uint8Array> {
    const reader = body.getReader();
    let size = 0;
    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            const {done, value} = await reader.read();
            if (done) {
                controller.close();
                return;
            }
            if (size <= BODY_LIMIT) {
                chunks.push(value);
                size += value.byteLength;
            }
            controller.enqueue(value);
        },
        cancel: (reason) => reader.cancel(reason),
    });
}

/**
 * 结果已定、不让适配器再往下走时 `send` 抛的错：用中止错误，文字里不带状态码（Gemini 的 SDK 从抛错的文字里认状态码，认出 400
 * 就把请求全文写进日志目录）。
 */
const stopped = (): DOMException => new DOMException("protocol check stopped after its one request", "AbortError");

/** 对 `provider` 的有效地址用它的协议（`provider.api` 或模型的目录协议）试一次。不抛错。 */
export async function probeProtocol(provider: ProviderTarget, model: ModelTarget, access: KeyAccess, options: ProbeOptions): Promise<ProbeOutcome> {
    const now = options.now ?? (() => performance.now());
    const local = (code: string, message = ""): ProbeOutcome => ({ok: false, status: null, ms: null, url: null, code, message});
    const stop = new AbortController();
    const timeout = AbortSignal.timeout(options.timeoutMs);
    const signal = AbortSignal.any([options.signal, timeout, stop.signal]);
    const secrets = ((): string[] => {
        const {key, headers} = requestAuth(provider, model, access);
        // 短值（`writing` 这类标记）不像凭据，与适配器同一个门槛（`omp.ts` 的 `SECRET_HEADER_MIN`）。
        return [...(key === null ? [] : [key]), ...Object.values(headers).filter((value) => value.length >= 8)];
    })();
    const sanitize = (text: string): string => sanitizeProviderText(text, secrets);

    let sent = 0;
    let startedAt = 0;
    let url: string | null = null;
    let status: number | null = null;
    /** 证据或证据之前的错误；先到的定结果。放在对象里：它在回调里赋值，局部变量会被类型收窄成一直是 null。 */
    const outcome: {settled: {ok: true; ms: number} | {ok: false; code: string; message: string; ms: number | null} | null} = {settled: null};
    /** 2xx 正文经过时留下的开头（流里报错、适配器要重发时当原文）。 */
    const head: Uint8Array[] = [];
    const settle = (value: NonNullable<typeof outcome.settled>): void => {
        outcome.settled ??= value;
        stop.abort();
    };

    const send = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        sent += 1;
        if (sent > 1) {
            // 适配器要重发：第一次的回应里没有生成内容（或已经定了结果、适配器还在按抛错退避重试）。不发第二次。
            settle({ok: false, code: "no-content", message: sanitize(headText(head, secrets)), ms: now() - startedAt});
            throw stopped();
        }
        const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const parsed = new URL(href);
        url = `${parsed.origin}${parsed.pathname}`;
        startedAt = now();
        let response: Response;
        try {
            // 自己的中止也接上：Anthropic 的 SDK 交给 fetch 的是它自己的信号，中止调用时不一定关掉连接（证据到了、读开头的那一路还挂着）。
            response = await fetch(input, {...init, signal: init?.signal == null ? signal : AbortSignal.any([init.signal, signal])});
        } catch (error) {
            if (!signal.aborted) settle({ok: false, code: "network", message: sanitize(error instanceof Error ? error.message : String(error)), ms: now() - startedAt});
            throw error;
        }
        status = response.status;
        if (!response.ok) {
            const text = headText(await readHead(response.body), secrets);
            settle({ok: false, code: "http", message: sanitize(text), ms: now() - startedAt});
            throw stopped();
        }
        if (response.body === null) return response;
        return new Response(recording(response.body, head), {status: response.status, statusText: response.statusText, headers: response.headers});
    }) as typeof fetch;

    const hooks = {send, transport: () => ({})};
    let built = buildResolution(provider, model, access, hooks);
    if (!built.ok && built.code === "unknown-model" && model.contextWindow === undefined) built = buildResolution(provider, {...model, contextWindow: PROBE_WINDOW}, access, hooks);
    if (!built.ok) return local(built.code);

    const response = await built.resolution.call({...request, model: built.resolution.info.id}, signal, (delta) => {
        if (delta.text.length > 0 && sent === 1) settle({ok: true, ms: now() - startedAt});
    });
    const result = outcome.settled;
    const base = {status, url};
    if (result !== null) return result.ok ? {...base, ok: true, ms: result.ms, code: null, message: ""} : {...base, ok: false, ms: result.ms, code: result.code, message: result.message};
    if (options.signal.aborted) return {...base, ok: false, ms: null, code: "cancelled", message: ""};
    if (timeout.aborted) return {...base, ok: false, ms: sent === 0 ? null : now() - startedAt, code: "timeout", message: ""};
    const ms = sent === 0 ? null : now() - startedAt;
    if (response.stopReason === "error") return {...base, ok: false, ms, code: response.error?.code ?? response.error?.kind ?? "provider", message: response.error?.message ?? ""};
    // 没交增量，但正常收尾并报了输出（思考不外露）。
    if ((response.stopReason === "stop" || response.stopReason === "length" || response.stopReason === "tool") && response.usage.output > 0) return {...base, ok: true, ms, code: null, message: ""};
    stop.abort();
    return {...base, ok: false, ms, code: "no-content", message: sanitize(headText(head, secrets))};
}
