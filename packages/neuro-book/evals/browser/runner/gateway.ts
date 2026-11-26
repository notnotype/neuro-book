/**
 * 评测的模型网关：两边的执行者都把它当模型服务（OpenAI 兼容的 Chat Completions，假密钥），由它带上真实密钥转发。
 * 这样两边的 token 在同一处、按同一种口径计数，执行者手里没有真实密钥，也能核对两边实际发出的推理参数。
 *
 * - 只绑 127.0.0.1；只认本次登记过的假密钥，别的回 401、不转发。每个假密钥登记时绑一个模型，请求别的模型回 400（记下次数）：
 *   一回运行只用一个模型，不靠执行者自觉。
 * - 每个请求不设空闲期限：非流式的模型请求常常十几秒以上没有一个字节。Bun 1.4.4 实测，没读请求体的请求 10 到 12 秒被缺省的
 *   空闲期限断开，读过请求体的不会（网关总是先读请求体，所以这里眼下看不出差别）；仍按仓库的 TypeScript 规范显式关掉，
 *   免得换了 Bun 版本行为跟着变。上游有自己的时限。
 * - 上游请求同时挂三个取消：执行者断开连接（记 `client-abort`）、这一回注销（记 `cancelled`）、上游时限（记 `timeout`）。
 *   注销时先取消在途的请求、等它们记下再交出记录，这样最后那次请求的用量与结局也在运行记录里。
 * - 预算在转发之前就按“已记下的加在途的”算请求数，几个并发的请求不会一起越过上限。
 * - 转发时只带白名单里的请求头并要求不压缩；回给执行者的头也只留白名单（内容类型与退避时间），上游的诊断头不透出去。
 *   上游的错误正文里出现真实密钥或 `sk-` 开头的串时换掉再交给执行者。
 * - 走不走代理按路由定：`proxy` 为 null 时直连。调度器进程的环境里不能有代理变量（Bun 的 `fetch` 缺省会读它们，
 *   传空串也关不掉），这一条由命令行在启动时检查。
 * - 对上游不重试：执行者自己的重试照常起作用，网关只如实记下每一次。
 */

import {randomUUID} from "node:crypto";

import type {GatewayCallRecord} from "../record/schema";

export interface GatewayRoute {
    /** 执行者请求里写的模型名。 */
    readonly model: string;
    /** 发给上游的模型名；不给时与 `model` 相同。 */
    readonly upstreamModel?: string;
    /** 上游的 OpenAI 兼容地址，到 `/v1` 为止。 */
    readonly baseUrl: string;
    readonly apiKey: string;
    /** 经这个代理转发；null 为直连。 */
    readonly proxy: string | null;
}

export interface GatewayBudget {
    readonly requests: number;
    readonly inputTokens: number;
}

export interface GatewayRegistration {
    /** 给执行者用的假密钥。 */
    readonly key: string;
    /** 已记下的调用；`release` 之后是全部（含收尾时被取消的在途请求）。 */
    calls(): GatewayCallRecord[];
    budgetExceeded(): boolean;
    /** 请求了别的模型、被拒的次数。 */
    refused(): number;
    /** 注销：之后用这个假密钥的请求回 401；取消在途的上游请求，等它们记下（最多 `RELEASE_WAIT_MS`）。 */
    release(): Promise<void>;
}

export interface Gateway {
    /** `http://127.0.0.1:<端口>/v1` */
    readonly url: string;
    /** 登记一个假密钥，绑定到这个模型的路由；不认识的模型抛错。 */
    register(model: string): GatewayRegistration;
    stop(): Promise<void>;
}

interface Entry {
    readonly route: GatewayRoute;
    readonly calls: GatewayCallRecord[];
    readonly abort: AbortController;
    budgetExceeded: boolean;
    refused: number;
    inflight: number;
    idle: Array<() => void>;
}

/** 回给执行者时留下的上游响应头。 */
const RESPONSE_HEADERS_KEPT = new Set(["content-type", "retry-after"]);
const RELEASE_WAIT_MS = 5_000;

function openAiError(status: number, message: string, type: string): Response {
    return Response.json({error: {message, type}}, {status});
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 请求体里的几个形状：推理参数、输出上限、工具数、图片数、消息数。消息与内容块里不是对象的项不数。 */
function describeRequest(body: Record<string, unknown>) {
    const messages = Array.isArray(body.messages) ? body.messages.filter(isObject) : [];
    const images = messages.reduce((sum, message) => sum + (Array.isArray(message.content) ? message.content.filter((part) => isObject(part) && part.type === "image_url").length : 0), 0);
    const maxTokens = typeof body.max_tokens === "number" ? body.max_tokens : typeof body.max_completion_tokens === "number" ? body.max_completion_tokens : null;
    return {
        reasoningEffort: typeof body.reasoning_effort === "string" ? body.reasoning_effort : null,
        maxTokens,
        tools: Array.isArray(body.tools) ? body.tools.length : 0,
        images,
        messages: messages.length,
        stream: body.stream === true,
    };
}

/** 上游回的用量：`prompt_tokens` 含缓存读（OpenAI 的口径）。没有用量时为 null，不填 0。 */
export function normalizeUsage(usage: unknown): GatewayCallRecord["usage"] {
    if (usage === null || typeof usage !== "object") return null;
    const value = usage as {prompt_tokens?: unknown; completion_tokens?: unknown; prompt_tokens_details?: {cached_tokens?: unknown}};
    if (typeof value.prompt_tokens !== "number" || typeof value.completion_tokens !== "number") return null;
    const cached = value.prompt_tokens_details?.cached_tokens;
    return {input: value.prompt_tokens, cacheRead: typeof cached === "number" ? cached : null, output: value.completion_tokens};
}

/** 转发失败的原因：超时、连不上、中途断开。 */
export function classifyFetchError(error: unknown): "timeout" | "connect-error" | "reset" {
    const name = error instanceof Error ? error.name : "";
    const code = (error as {code?: unknown})?.code;
    if (name === "TimeoutError" || name === "AbortError") return "timeout";
    if (code === "ConnectionRefused" || code === "ECONNREFUSED" || code === "FailedToOpenSocket" || code === "ENOTFOUND" || code === "EHOSTUNREACH") return "connect-error";
    return "reset";
}

/** 上游的错误正文交给执行者前，换掉真实密钥与 `sk-` 开头的串。 */
function scrub(text: string, apiKey: string): string {
    return (apiKey === "" ? text : text.split(apiKey).join("[redacted]")).replace(/sk-[A-Za-z0-9_-]{8,}/gu, "[redacted]");
}

export function startGateway(options: {routes: readonly GatewayRoute[]; upstreamTimeoutMs?: number; budget?: GatewayBudget}): Gateway {
    const routes = new Map(options.routes.map((route) => [route.model, route]));
    const entries = new Map<string, Entry>();
    const budget = options.budget ?? {requests: 150, inputTokens: 15_000_000};
    const upstreamTimeoutMs = options.upstreamTimeoutMs ?? 600_000;

    const forward = async (request: Request, entry: Entry, body: Record<string, unknown>): Promise<Response> => {
        const {route} = entry;
        const shape = describeRequest(body);
        const startedAt = performance.now();
        entry.inflight += 1;
        let recorded = false;
        const record = (upstream: GatewayCallRecord["upstream"], usage: GatewayCallRecord["usage"]) => {
            if (recorded) return;
            recorded = true;
            entry.calls.push({model: route.model, ...shape, upstream, usage, startedAt, endedAt: performance.now()});
            entry.inflight -= 1;
            if (entry.inflight === 0) for (const wake of entry.idle.splice(0)) wake();
        };
        // 这一回注销、执行者断开在前，上游时限在后：先看前两个，才分得清是谁取消的。
        const failure = (error: unknown): GatewayCallRecord["upstream"] => (entry.abort.signal.aborted ? "cancelled" : request.signal.aborted ? "client-abort" : classifyFetchError(error));
        const signal = AbortSignal.any([request.signal, entry.abort.signal, AbortSignal.timeout(upstreamTimeoutMs)]);
        let upstream: Response;
        try {
            upstream = await fetch(`${route.baseUrl}/chat/completions`, {
                method: "POST",
                headers: {"content-type": "application/json", accept: request.headers.get("accept") ?? "application/json", authorization: `Bearer ${route.apiKey}`, "accept-encoding": "identity"},
                body: JSON.stringify({...body, model: route.upstreamModel ?? route.model}),
                signal,
                ...(route.proxy === null ? {} : {proxy: route.proxy}),
            });
        } catch (error) {
            const reason = failure(error);
            record(reason, null);
            return openAiError(502, `upstream ${reason}`, "upstream_error");
        }
        const headers = new Headers();
        upstream.headers.forEach((value, name) => {
            if (RESPONSE_HEADERS_KEPT.has(name.toLowerCase())) headers.set(name, value);
        });

        // 非流式与上游的错误响应（不管请求要不要流式，错误都是一整份正文）：读完再交回。
        if (!shape.stream || upstream.body === null || !upstream.ok) {
            let text: string;
            try {
                text = await upstream.text();
            } catch (error) {
                const reason = failure(error);
                record(reason, null);
                return openAiError(502, `upstream ${reason} while reading the response`, "upstream_error");
            }
            let usage: GatewayCallRecord["usage"] = null;
            try {
                usage = normalizeUsage((JSON.parse(text) as {usage?: unknown}).usage);
            } catch {
                usage = null;
            }
            record(upstream.status, usage);
            return new Response(upstream.ok ? text : scrub(text, route.apiKey), {status: upstream.status, headers});
        }

        // 流式：原样转发，同时逐行读 SSE，取最后一个带 usage 的块。流读完、中途断开或执行者不读了才记这一次。
        let usage: GatewayCallRecord["usage"] = null;
        let buffer = "";
        const decoder = new TextDecoder();
        const scan = (text: string) => {
            buffer += text;
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
                const data = line.startsWith("data:") ? line.slice(5).trim() : "";
                if (data === "" || data === "[DONE]") continue;
                try {
                    usage = normalizeUsage((JSON.parse(data) as {usage?: unknown}).usage) ?? usage;
                } catch {
                    // 不是 JSON 的行（注释、心跳）跳过。
                }
            }
        };
        const reader = upstream.body.getReader();
        const status = upstream.status;
        // 执行者不再读（背压）时 pull 不被调用、看不到取消：注销时直接把上游的读停掉并记下。
        entry.abort.signal.addEventListener("abort", () => {
            record("cancelled", usage);
            void reader.cancel().catch(() => undefined);
        }, {once: true});
        const stream = new ReadableStream<Uint8Array>({
            async pull(controller) {
                try {
                    const {done, value} = await reader.read();
                    if (done) {
                        scan(`${decoder.decode()}\n`);
                        record(status, usage);
                        controller.close();
                        return;
                    }
                    scan(decoder.decode(value, {stream: true}));
                    controller.enqueue(value);
                } catch (error) {
                    record(failure(error), usage);
                    controller.error(error);
                }
            },
            cancel(reason) {
                record("client-abort", usage);
                return reader.cancel(reason);
            },
        });
        return new Response(stream, {status, headers});
    };

    const handle = async (request: Request): Promise<Response> => {
        const path = new URL(request.url).pathname;
        const key = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/iu, "");
        const entry = entries.get(key);
        if (entry === undefined) return openAiError(401, "unknown gateway key", "invalid_api_key");
        if (request.method === "GET" && path === "/v1/models") return Response.json({object: "list", data: [{id: entry.route.model, object: "model"}]});
        if (request.method !== "POST" || path !== "/v1/chat/completions") return openAiError(404, `not supported by the evaluation gateway: ${request.method} ${path}`, "not_found");
        let body: unknown;
        try {
            body = await request.json();
        } catch {
            return openAiError(400, "request body is not JSON", "invalid_request_error");
        }
        if (!isObject(body)) return openAiError(400, "request body must be a JSON object", "invalid_request_error");
        if (body.model !== entry.route.model) {
            entry.refused += 1;
            return openAiError(400, `this key is for model ${entry.route.model}`, "invalid_request_error");
        }
        const spentInput = entry.calls.reduce((sum, call) => sum + (call.usage?.input ?? 0), 0);
        if (entry.calls.length + entry.inflight >= budget.requests || spentInput >= budget.inputTokens) {
            entry.budgetExceeded = true;
            return openAiError(429, "evaluation budget for this run is exhausted", "budget_exceeded");
        }
        return forward(request, entry, body);
    };

    const server = Bun.serve({hostname: "127.0.0.1", port: 0, idleTimeout: 255, fetch: async (request, srv) => {
        srv.timeout(request, 0);
        try {
            return await handle(request);
        } catch {
            // 网关自己的缺陷：回 OpenAI 形状的 500，不让 Bun 的缺省错误页（带源码路径）交到执行者手里。
            return openAiError(500, "evaluation gateway failed", "gateway_error");
        }
    }});

    return {
        url: `http://127.0.0.1:${server.port}/v1`,
        register: (model) => {
            const route = routes.get(model);
            if (route === undefined) throw new Error(`no gateway route for model ${model}`);
            const key = randomUUID();
            const entry: Entry = {route, calls: [], abort: new AbortController(), budgetExceeded: false, refused: 0, inflight: 0, idle: []};
            entries.set(key, entry);
            return {
                key,
                calls: () => [...entry.calls],
                budgetExceeded: () => entry.budgetExceeded,
                refused: () => entry.refused,
                release: async () => {
                    entries.delete(key);
                    if (entry.inflight === 0) return;
                    const settled = new Promise<void>((resolve) => entry.idle.push(resolve));
                    entry.abort.abort();
                    let timer: ReturnType<typeof setTimeout> | undefined;
                    await Promise.race([settled, new Promise<void>((resolve) => {
                        timer = setTimeout(resolve, RELEASE_WAIT_MS);
                    })]);
                    clearTimeout(timer);
                },
            };
        },
        stop: async () => {
            await server.stop(true);
        },
    };
}
