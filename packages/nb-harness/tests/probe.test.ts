/**
 * 协议检测（`probeProtocol`，docs/specs/models/service.md 的“协议检测”）：本机起一个四种协议都会说的端点（真实 HTTP、真实 OMP
 * 的请求构造与解析），按场景回应，数端点实收的请求。密钥是假的，只发往本机端点。
 */

import {afterAll, beforeEach, describe, expect, test} from "bun:test";
import {probeProtocol, type ProviderTarget, type WireApi} from "@notnotype/nb-harness/models";

const KEY = "sk-probe-SECRET-0123456789";

type Mode = "ok" | "status-500" | "status-400-echo" | "status-400-boundary" | "stream-error" | "stream-error-then-hang" | "usage-only" | "evidence-then-hang" | "handshake-then-hang";
let mode: Mode = "ok";
const seen: {path: string; query: string; closed: Promise<void>}[] = [];
/** 端点收到下一个请求时 resolve。 */
let arrived: () => void = () => undefined;
const requested = (): Promise<void> => new Promise((resolve) => (arrived = resolve));

const encoder = new TextEncoder();
const sse = (frames: readonly string[], hang: boolean, onClose: () => void): Response => {
    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            for (const frame of frames) controller.enqueue(encoder.encode(frame));
            if (!hang) controller.close();
        },
        cancel: onClose,
    });
    return new Response(body, {headers: {"content-type": "text/event-stream"}});
};
const data = (value: object): string => `data: ${JSON.stringify(value)}\n\n`;
const event = (name: string, value: object): string => `event: ${name}\ndata: ${JSON.stringify(value)}\n\n`;

/** 每种协议的帧：握手（不算证据）、一段文字（证据）、收尾，以及不交文字、只报了输出 token 的收尾（思考不外露）。 */
function frames(api: WireApi): {handshake: string[]; text: string[]; end: string[]; error: string[]; usageOnly: string[]} {
    switch (api) {
        case "openai-completions": {
            const chunk = (body: object) => data({id: "c", object: "chat.completion.chunk", created: 0, model: "m", ...body});
            return {
                handshake: [chunk({choices: [{index: 0, delta: {role: "assistant", content: ""}, finish_reason: null}]})],
                text: [chunk({choices: [{index: 0, delta: {content: "好"}, finish_reason: null}]})],
                end: [chunk({choices: [{index: 0, delta: {}, finish_reason: "stop"}]}), chunk({choices: [], usage: {prompt_tokens: 3, completion_tokens: 1, total_tokens: 4}}), "data: [DONE]\n\n"],
                error: [data({error: {message: "upstream overloaded", type: "server_error"}})],
                usageOnly: [chunk({choices: [{index: 0, delta: {}, finish_reason: "stop"}]}), chunk({choices: [], usage: {prompt_tokens: 3, completion_tokens: 1, total_tokens: 4}}), "data: [DONE]\n\n"],
            };
        }
        case "openai-responses": {
            const response = {id: "r", object: "response", created_at: 0, status: "in_progress", model: "m", output: []};
            return {
                handshake: [event("response.created", {type: "response.created", sequence_number: 0, response}), event("response.in_progress", {type: "response.in_progress", sequence_number: 1, response})],
                text: [
                    event("response.output_item.added", {type: "response.output_item.added", sequence_number: 2, output_index: 0, item: {id: "msg", type: "message", status: "in_progress", role: "assistant", content: []}}),
                    event("response.content_part.added", {type: "response.content_part.added", sequence_number: 3, item_id: "msg", output_index: 0, content_index: 0, part: {type: "output_text", text: "", annotations: []}}),
                    event("response.output_text.delta", {type: "response.output_text.delta", sequence_number: 4, item_id: "msg", output_index: 0, content_index: 0, delta: "好"}),
                ],
                end: [
                    event("response.output_item.done", {type: "response.output_item.done", sequence_number: 5, output_index: 0, item: {id: "msg", type: "message", status: "completed", role: "assistant", content: [{type: "output_text", text: "好", annotations: []}]}}),
                    event("response.completed", {type: "response.completed", sequence_number: 6, response: {...response, status: "completed", output: [{id: "msg", type: "message", status: "completed", role: "assistant", content: [{type: "output_text", text: "好", annotations: []}]}], usage: {input_tokens: 3, output_tokens: 1, total_tokens: 4}}}),
                ],
                error: [event("error", {type: "error", sequence_number: 2, code: "server_error", message: "upstream overloaded"})],
                usageOnly: [event("response.completed", {type: "response.completed", sequence_number: 2, response: {...response, status: "completed", usage: {input_tokens: 3, output_tokens: 1, total_tokens: 4}}})],
            };
        }
        case "anthropic-messages":
            return {
                handshake: [event("message_start", {type: "message_start", message: {id: "msg", type: "message", role: "assistant", content: [], model: "m", stop_reason: null, usage: {input_tokens: 3, output_tokens: 0}}}), event("ping", {type: "ping"})],
                text: [event("content_block_start", {type: "content_block_start", index: 0, content_block: {type: "text", text: ""}}), event("content_block_delta", {type: "content_block_delta", index: 0, delta: {type: "text_delta", text: "好"}})],
                end: [event("content_block_stop", {type: "content_block_stop", index: 0}), event("message_delta", {type: "message_delta", delta: {stop_reason: "end_turn"}, usage: {output_tokens: 1}}), event("message_stop", {type: "message_stop"})],
                error: [event("error", {type: "error", error: {type: "overloaded_error", message: "upstream overloaded"}})],
                usageOnly: [event("message_delta", {type: "message_delta", delta: {stop_reason: "end_turn"}, usage: {output_tokens: 1}}), event("message_stop", {type: "message_stop"})],
            };
        case "google-generative-ai":
            return {
                handshake: [data({candidates: [], usageMetadata: {promptTokenCount: 3}})],
                text: [data({candidates: [{content: {parts: [{text: "好"}], role: "model"}, index: 0}]})],
                end: [data({candidates: [{content: {parts: [{text: ""}], role: "model"}, finishReason: "STOP", index: 0}], usageMetadata: {promptTokenCount: 3, candidatesTokenCount: 1, totalTokenCount: 4}})],
                error: [data({error: {code: 503, message: "upstream overloaded", status: "UNAVAILABLE"}})],
                usageOnly: [data({candidates: [{content: {parts: [{text: ""}], role: "model"}, finishReason: "STOP", index: 0}], usageMetadata: {promptTokenCount: 3, candidatesTokenCount: 1, totalTokenCount: 4}})],
            };
    }
}

const apiOf = (path: string): WireApi => (path.endsWith("/chat/completions") ? "openai-completions" : path.endsWith("/responses") ? "openai-responses" : path.endsWith("/messages") ? "anthropic-messages" : "google-generative-ai");

const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(incoming) {
        const url = new URL(incoming.url);
        let close = (): void => undefined;
        const closed = new Promise<void>((resolve) => (close = resolve));
        seen.push({path: url.pathname, query: url.search, closed});
        arrived();
        await incoming.text();
        const parts = frames(apiOf(url.pathname));
        switch (mode) {
            case "status-500":
                return Response.json({error: {message: "internal error"}}, {status: 500});
            case "status-400-echo":
                // 一处原样、一处中间夹着控制字符（去掉控制字符之后才是完整的密钥）。
                return new Response(`${JSON.stringify({error: {message: `bad key ${KEY} for max_tokens`}})}\ngot ${KEY.slice(0, 8)}\u0000${KEY.slice(8)}`, {status: 400});
            case "status-400-boundary":
                // 密钥跨在原文上限上：截下来的是它的前半段。
                return new Response(`${"A".repeat(8 * 1024 - 8)}${KEY} more`, {status: 400});
            case "stream-error":
                return sse([...parts.handshake, ...parts.error], false, close);
            case "stream-error-then-hang":
                return sse([...parts.handshake, ...parts.error], true, close);
            case "usage-only":
                return sse([...parts.handshake, ...parts.usageOnly], false, close);
            case "evidence-then-hang":
                return sse([...parts.handshake, ...parts.text], true, close);
            case "handshake-then-hang":
                return sse(parts.handshake, true, close);
            case "ok":
                return sse([...parts.handshake, ...parts.text, ...parts.end], false, close);
        }
    },
});
const BASE = `http://127.0.0.1:${String(server.port)}/v1`;
afterAll(() => server.stop(true));
beforeEach(() => {
    seen.length = 0;
    mode = "ok";
});

const APIS: WireApi[] = ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"];
const target = (api: WireApi): ProviderTarget => ({id: "relay", template: null, follows: false, api, baseUrl: BASE, auth: "default"});
const access = {stored: () => KEY, env: {}};
const probe = (api: WireApi, options: {signal?: AbortSignal; timeoutMs?: number} = {}) =>
    probeProtocol(target(api), {id: "m"}, access, {signal: options.signal ?? new AbortController().signal, timeoutMs: options.timeoutMs ?? 5000});

describe("协议检测：每种协议恰好一次 HTTP", () => {
    test.each(APIS)("%s：能生成的端点判通过，记下实际地址与状态", async (api) => {
        const outcome = await probe(api);
        expect(outcome).toMatchObject({ok: true, status: 200, code: null, message: ""});
        expect(outcome.ms).toBeGreaterThanOrEqual(0);
        expect(seen).toHaveLength(1);
        expect(outcome.url).toBe(`http://127.0.0.1:${String(server.port)}${seen[0]!.path}`);
    });

    test.each(APIS)("%s：500 只发一次，不让适配器重发；原文是正文", async (api) => {
        mode = "status-500";
        const outcome = await probe(api);
        expect(outcome).toMatchObject({ok: false, status: 500, code: "http"});
        expect(outcome.message).toContain("internal error");
        expect(seen).toHaveLength(1);
    });

    test.each(APIS)("%s：200 里流报错，判失败且只发一次", async (api) => {
        mode = "stream-error";
        const outcome = await probe(api);
        expect(outcome.ok).toBe(false);
        expect(outcome.status).toBe(200);
        expect(seen).toHaveLength(1);
    });

    test("参数被拒的 4xx 原文照给，回显的密钥遮盖掉", async () => {
        mode = "status-400-echo";
        const outcome = await probe("openai-completions");
        expect(outcome).toMatchObject({ok: false, status: 400, code: "http"});
        expect(outcome.message).toContain("max_tokens");
        expect(outcome.message).not.toContain(KEY);
        expect(outcome.message).toContain("got [REDACTED]");
    });

    test("密钥跨在原文上限上：截下来的半个也不留", async () => {
        mode = "status-400-boundary";
        const outcome = await probe("openai-completions");
        expect(outcome).toMatchObject({ok: false, status: 400, code: "http"});
        expect(outcome.message).toMatch(/^A+$/u);
    });

    test.each(APIS)("%s：流里报错之后连接挂着，也按报错结束，不等到时限", async (api) => {
        mode = "stream-error-then-hang";
        const outcome = await probe(api, {timeoutMs: 10_000});
        expect(outcome).toMatchObject({ok: false, status: 200});
        expect(outcome.code).not.toBe("timeout");
        expect(outcome.message).toContain("upstream overloaded");
        expect(seen).toHaveLength(1);
    });
});

describe("首个生成证据", () => {
    test.each(APIS)("%s：证据一到就停，不等流结束（连接被关）", async (api) => {
        mode = "evidence-then-hang";
        const outcome = await probe(api, {timeoutMs: 10_000});
        expect(outcome).toMatchObject({ok: true, status: 200});
        await seen[0]!.closed;
        expect(seen).toHaveLength(1);
    });

    test.each(APIS)("%s：没交文字、正常收尾且报了输出 token（思考不外露）判通过，不让适配器按空回复重发", async (api) => {
        mode = "usage-only";
        const outcome = await probe(api);
        expect(outcome).toMatchObject({ok: true, status: 200, code: null});
        expect(seen).toHaveLength(1);
    });

    test.each(APIS)("%s：只有握手、角色帧或空候选不算，到时限判超时", async (api) => {
        mode = "handshake-then-hang";
        const outcome = await probe(api, {timeoutMs: 400});
        expect(outcome).toMatchObject({ok: false, status: 200, code: "timeout"});
        expect(seen).toHaveLength(1);
    });

    test("调用方取消：判取消，连接关掉", async () => {
        mode = "handshake-then-hang";
        const controller = new AbortController();
        const arriving = requested();
        const pending = probe("anthropic-messages", {signal: controller.signal, timeoutMs: 10_000});
        await arriving;
        controller.abort();
        expect(await pending).toMatchObject({ok: false, code: "cancelled"});
        await seen[0]!.closed;
    });
});

describe("发出之前", () => {
    test("地址里协议没有路径可走（核对不过）：本地拦下，端点什么也没收到", async () => {
        const outcome = await probeProtocol({...target("openai-completions"), baseUrl: "http://127.0.0.1:1/v1?x=1"}, {id: "m"}, access, {signal: new AbortController().signal, timeoutMs: 2000});
        expect(outcome.ok).toBe(false);
        expect(outcome.status).toBeNull();
        expect(seen).toHaveLength(0);
    });

    test("没有密钥：不发请求", async () => {
        const outcome = await probeProtocol(target("openai-completions"), {id: "m"}, {stored: () => null, env: {}}, {signal: new AbortController().signal, timeoutMs: 2000});
        expect(outcome).toMatchObject({ok: false, status: null, code: "missing-key"});
        expect(seen).toHaveLength(0);
    });

    test.each(APIS)("%s：网络出口选不出路，交回出口的码，请求不发", async (api) => {
        const outcome = await probeProtocol(target(api), {id: "m"}, access, {signal: new AbortController().signal, timeoutMs: 2000, route: async () => ({ok: false, code: "proxy-unsupported", message: "the system proxy uses an automatic configuration script"})});
        expect(outcome).toMatchObject({ok: false, status: null, url: null, code: "proxy-unsupported"});
        expect(seen).toHaveLength(0);
    });

    test("经带凭据的代理、代理在 407 正文里回显认证头：检测的原文里没有凭据", async () => {
        const proxy = Bun.serve({port: 0, hostname: "127.0.0.1", fetch: (incoming) => new Response(`echo ${incoming.headers.get("proxy-authorization") ?? ""}`, {status: 407})});
        try {
            const outcome = await probeProtocol({...target("openai-completions"), baseUrl: "http://models.test/v1"}, {id: "m"}, access, {signal: new AbortController().signal, timeoutMs: 5000, route: async () => ({ok: true, proxy: `http://ann:hunter22secret@127.0.0.1:${String(proxy.port)}`})});
            expect(outcome).toMatchObject({ok: false, status: 407});
            expect(outcome.message).toContain("echo");
            for (const leaked of ["hunter22secret", Buffer.from("ann:hunter22secret").toString("base64")]) expect(outcome.message).not.toContain(leaked);
        } finally {
            await proxy.stop(true);
        }
    });

    test("网络出口给直连时照常检测，出口问的是完整的请求地址", async () => {
        const asked: string[] = [];
        const outcome = await probeProtocol(target("openai-completions"), {id: "m"}, access, {signal: new AbortController().signal, timeoutMs: 5000, route: async (url) => {
            asked.push(url.href);
            return {ok: true, proxy: false};
        }});
        expect(outcome).toMatchObject({ok: true, status: 200});
        expect(asked).toEqual([`${BASE}/chat/completions`]);
    });
});
