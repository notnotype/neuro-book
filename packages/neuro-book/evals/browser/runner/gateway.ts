/**
 * 评测的模型网关：两边的执行者都把它当模型服务（OpenAI 兼容的 Chat Completions，假密钥），由它带上真实密钥转发。
 * 这样两边的 token 在同一处、按同一种口径计数，执行者手里没有真实密钥，也能核对两边实际发出的推理参数。
 *
 * - 只绑 127.0.0.1；只认本次登记过的假密钥，别的回 401、不转发。
 * - 每个请求不设空闲期限：非流式的模型请求常常十几秒以上没有一个字节，Bun 缺省 10 秒就断开。上游有自己的时限。
 * - 转发时只带白名单里的请求头并要求不压缩；回给执行者时去掉编码与长度类的头（`fetch` 已经解压过正文）。
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
    calls(): GatewayCallRecord[];
    budgetExceeded(): boolean;
    /** 注销：之后用这个假密钥的请求回 401。 */
    release(): void;
}

export interface Gateway {
    /** `http://127.0.0.1:<端口>/v1` */
    readonly url: string;
    register(): GatewayRegistration;
    stop(): Promise<void>;
}

interface Entry {
    readonly calls: GatewayCallRecord[];
    budgetExceeded: boolean;
}

const RESPONSE_HEADERS_DROPPED = new Set(["content-encoding", "content-length", "transfer-encoding", "connection", "set-cookie", "keep-alive"]);

function openAiError(status: number, message: string, type: string): Response {
    return Response.json({error: {message, type}}, {status});
}

/** 请求体里的几个形状：推理参数、输出上限、工具数、图片数、消息数。 */
function describeRequest(body: Record<string, unknown>) {
    const messages = Array.isArray(body.messages) ? body.messages as Array<{content?: unknown}> : [];
    const images = messages.reduce((sum, message) => sum + (Array.isArray(message.content) ? (message.content as Array<{type?: unknown}>).filter((part) => part?.type === "image_url").length : 0), 0);
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

export function startGateway(options: {routes: readonly GatewayRoute[]; upstreamTimeoutMs?: number; budget?: GatewayBudget}): Gateway {
    const routes = new Map(options.routes.map((route) => [route.model, route]));
    const entries = new Map<string, Entry>();
    const budget = options.budget ?? {requests: 150, inputTokens: 15_000_000};
    const upstreamTimeoutMs = options.upstreamTimeoutMs ?? 600_000;

    const handle = async (request: Request): Promise<Response> => {
        const path = new URL(request.url).pathname;
        const key = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/iu, "");
        const entry = entries.get(key);
        if (entry === undefined) return openAiError(401, "unknown gateway key", "invalid_api_key");
        if (request.method === "GET" && path === "/v1/models") return Response.json({object: "list", data: [...routes.keys()].map((id) => ({id, object: "model"}))});
        if (request.method !== "POST" || path !== "/v1/chat/completions") return openAiError(404, `not supported by the evaluation gateway: ${request.method} ${path}`, "not_found");
        let body: Record<string, unknown>;
        try {
            body = await request.json() as Record<string, unknown>;
        } catch {
            return openAiError(400, "request body is not JSON", "invalid_request_error");
        }
        const route = typeof body.model === "string" ? routes.get(body.model) : undefined;
        if (route === undefined) return openAiError(400, `unknown model: ${String(body.model)}`, "invalid_request_error");
        const spentInput = entry.calls.reduce((sum, call) => sum + (call.usage?.input ?? 0), 0);
        if (entry.calls.length >= budget.requests || spentInput >= budget.inputTokens) {
            entry.budgetExceeded = true;
            return openAiError(429, "evaluation budget for this run is exhausted", "budget_exceeded");
        }

        const shape = describeRequest(body);
        const startedAt = performance.now();
        const record = (upstream: GatewayCallRecord["upstream"], usage: GatewayCallRecord["usage"]) => {
            entry.calls.push({model: route.model, ...shape, upstream, usage, startedAt, endedAt: performance.now()});
        };
        let upstream: Response;
        try {
            upstream = await fetch(`${route.baseUrl}/chat/completions`, {
                method: "POST",
                headers: {"content-type": "application/json", accept: request.headers.get("accept") ?? "application/json", authorization: `Bearer ${route.apiKey}`, "accept-encoding": "identity"},
                body: JSON.stringify({...body, model: route.upstreamModel ?? route.model}),
                signal: AbortSignal.timeout(upstreamTimeoutMs),
                ...(route.proxy === null ? {} : {proxy: route.proxy}),
            });
        } catch (error) {
            const failure = classifyFetchError(error);
            record(failure, null);
            return openAiError(502, `upstream ${failure}`, "upstream_error");
        }
        const headers = new Headers();
        upstream.headers.forEach((value, name) => {
            if (!RESPONSE_HEADERS_DROPPED.has(name.toLowerCase())) headers.set(name, value);
        });

        if (!shape.stream || upstream.body === null) {
            let text: string;
            try {
                text = await upstream.text();
            } catch (error) {
                record(classifyFetchError(error), null);
                return openAiError(502, "upstream reset while reading the response", "upstream_error");
            }
            let usage: GatewayCallRecord["usage"] = null;
            try {
                usage = normalizeUsage((JSON.parse(text) as {usage?: unknown}).usage);
            } catch {
                usage = null;
            }
            record(upstream.status, usage);
            return new Response(text, {status: upstream.status, headers});
        }

        // 流式：原样转发，同时逐行读 SSE，取最后一个带 usage 的块。流读完（或中途断开）才记这一次。
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
                    record(classifyFetchError(error), usage);
                    controller.error(error);
                }
            },
            cancel(reason) {
                record(status, usage);
                return reader.cancel(reason);
            },
        });
        return new Response(stream, {status, headers});
    };

    const server = Bun.serve({hostname: "127.0.0.1", port: 0, idleTimeout: 255, fetch: (request, srv) => {
        srv.timeout(request, 0);
        return handle(request);
    }});

    return {
        url: `http://127.0.0.1:${server.port}/v1`,
        register: () => {
            const key = randomUUID();
            const entry: Entry = {calls: [], budgetExceeded: false};
            entries.set(key, entry);
            return {key, calls: () => [...entry.calls], budgetExceeded: () => entry.budgetExceeded, release: () => entries.delete(key)};
        },
        stop: async () => {
            await server.stop(true);
        },
    };
}
