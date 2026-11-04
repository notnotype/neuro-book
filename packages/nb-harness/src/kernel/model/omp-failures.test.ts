/**
 * OMP 适配器的失败与传输（docs/specs/harness/models.md 输出 1、2、17–19）：本机端点上真实 HTTP、真实 OMP 服务商实现。
 * 归类表是重发策略的依据：`pi-ai` 升级后错误标记变了，这里先失败。这里的密钥都是假的，只发往本机端点。
 */

import {afterAll, describe, expect, test} from "bun:test";
import {defineModel} from "@notnotype/nb-harness";
import type {ModelErrorKind, ModelRequest} from "../api/index.js";
import {ompCall, type OmpTarget, type OmpTransport} from "./omp.js";

const encoder = new TextEncoder();
const chunk = (body: object): string => `data: ${JSON.stringify({id: "c", object: "chat.completion.chunk", created: 0, model: "m", ...body})}\n\n`;
const failure = (status: number, message: string, headers: Record<string, string> = {}): Response => new Response(JSON.stringify({error: {message}}), {status, headers: {"content-type": "application/json", ...headers}});
const finish = (reason: string): Response => new Response(chunk({choices: [{index: 0, delta: {role: "assistant", content: ""}, finish_reason: reason}]}) + "data: [DONE]\n\n", {headers: {"content-type": "text/event-stream"}});
const events = (start: (controller: ReadableStreamDefaultController<Uint8Array>) => void): Response => new Response(new ReadableStream({start}), {headers: {"content-type": "text/event-stream"}});
const half = chunk({choices: [{index: 0, delta: {role: "assistant", content: "半句"}, finish_reason: null}]});

let respond: () => Response = () => new Response("unset", {status: 500});
let requests = 0;
const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    idleTimeout: 0,
    async fetch(request) {
        requests += 1;
        await request.text();
        return respond();
    },
});
afterAll(() => server.stop(true));

type Api = "openai-completions" | "openai-responses" | "anthropic-messages";
function target(api: Api, extra: Partial<OmpTarget> = {}): OmpTarget {
    const {model} = defineModel({provider: "local-test", api, baseUrl: `http://127.0.0.1:${server.port}${api === "anthropic-messages" ? "" : "/v1"}`, id: "m", apiKey: "none"});
    return {model, apiKey: () => "sk-test-not-a-real-key", priceKnown: false, ...extra};
}
const request: ModelRequest = {purpose: "turn", model: "local-test/m", params: {}, headers: {}, system: [], messages: [{role: "user", content: [{kind: "text", text: "你好", origin: {kind: "fixed", by: "kernel"}}]}], tools: []};

async function run(respondWith: () => Response, transport: OmpTransport = {maxHttpAttempts: 1}, api: Api = "openai-completions", signal = new AbortController().signal) {
    respond = respondWith;
    requests = 0;
    return {response: await ompCall(target(api, {transport}))(request, signal, () => undefined), requests};
}

describe("失败的归类", () => {
    const cases: readonly [string, () => Response, ModelErrorKind, boolean][] = [
        ["400", () => failure(400, "bad input"), "provider", false],
        ["401", () => failure(401, "bad key"), "auth", false],
        ["402", () => failure(402, "pay"), "quota", false],
        ["403", () => failure(403, "no"), "auth", false],
        ["404", () => failure(404, "no model"), "provider", false],
        ["408", () => failure(408, "timeout"), "network", true],
        ["413", () => failure(413, "too big"), "provider", false],
        ["429 有正文", () => failure(429, "Too many requests"), "rate_limit", true],
        ["429 没有正文", () => new Response("", {status: 429}), "quota", true],
        ["500", () => failure(500, "internal"), "provider", true],
        ["503", () => failure(503, "Service overloaded"), "network", true],
        ["529", () => failure(529, "overloaded"), "provider", true],
        ["上下文溢出", () => failure(400, "This model's maximum context length is 100 tokens"), "context_overflow", false],
        ["HTTP 200 的流内错误", () => finish("error"), "provider", true],
        ["内容拦截", () => finish("content_filter"), "provider", false],
        ["流中断", () => events((controller) => {
            controller.enqueue(encoder.encode(half));
            controller.close();
        }), "network", true],
    ];
    for (const [name, response, kind, retryable] of cases) {
        test(`${name}：${kind}，${retryable ? "可重发" : "不重发"}，只发一次`, async () => {
            const result = await run(response);
            expect(result.response.stopReason).toBe("error");
            expect(result.response.error?.kind).toBe(kind);
            expect(result.response.error?.retryable === true).toBe(retryable);
            expect(result.requests).toBe(1);
        });
    }

    test("模型重复循环：不重发，码 thinking-loop", async () => {
        const {response} = await run(() => finish("repetition_detected"));
        expect(response.error?.code).toBe("thinking-loop");
        expect(response.error?.retryable).toBeUndefined();
    });

    test("服务商要求的等待时间：有头就交回，没有头不写", async () => {
        const told = await run(() => failure(429, "Too many requests", {"retry-after": "30"}));
        expect(told.response.error?.retryAfterMs).toBe(30_000);
        const silent = await run(() => failure(429, "Too many requests"));
        expect(silent.response.error?.retryAfterMs).toBeUndefined();
    });

    test("撞上输出上限不算失败", async () => {
        const {response} = await run(() => finish("length"));
        expect(response.stopReason).toBe("length");
        expect(response.error).toBeUndefined();
    });

    test("流中断时半截内容交回", async () => {
        const {response} = await run(() => events((controller) => {
            controller.enqueue(encoder.encode(half));
            controller.close();
        }));
        expect(response.content).toEqual([{kind: "text", text: "半句"}]);
    });
});

/** 三种接口正常结束、一个字也没有的回复。 */
const EMPTY_REPLY: Readonly<Record<Api, string>> = {
    "openai-completions": chunk({choices: [{index: 0, delta: {role: "assistant", content: ""}, finish_reason: "stop"}]}) + chunk({choices: [], usage: {prompt_tokens: 1, completion_tokens: 0, total_tokens: 1}}) + "data: [DONE]\n\n",
    "openai-responses": `data: ${JSON.stringify({type: "response.completed", response: {id: "r", status: "completed", output: [], usage: {input_tokens: 1, output_tokens: 0, total_tokens: 1}}})}\n\n`,
    "anthropic-messages": [
        `event: message_start\ndata: ${JSON.stringify({type: "message_start", message: {id: "m", type: "message", role: "assistant", content: [], model: "m", stop_reason: null, usage: {input_tokens: 1, output_tokens: 0}}})}\n\n`,
        `event: message_delta\ndata: ${JSON.stringify({type: "message_delta", delta: {stop_reason: "end_turn"}, usage: {output_tokens: 0}})}\n\n`,
        `event: message_stop\ndata: ${JSON.stringify({type: "message_stop"})}\n\n`,
    ].join(""),
};

describe("传输", () => {
    const silent = (): Response => events(() => undefined);
    for (const api of ["openai-completions", "openai-responses", "anthropic-messages"] as const) {
        test(`${api}：第一个事件超时只发一次，归 network，可重发`, async () => {
            const {response, requests: sent} = await run(silent, {firstEventTimeoutMs: 100}, api);
            expect(response.stopReason).toBe("error");
            expect(response.error).toMatchObject({kind: "network", code: "first-event-timeout", retryable: true});
            expect(sent).toBe(1);
        });

        test(`${api}：空回复不在内层重发`, async () => {
            const {response, requests: sent} = await run(() => new Response(EMPTY_REPLY[api], {headers: {"content-type": "text/event-stream"}}), {firstEventTimeoutMs: 0}, api);
            expect(response.stopReason).toBe("stop");
            expect(sent).toBe(1);
        });
    }

    test("第一事件超时传 0：不计时，OMP 那一层也关掉", async () => {
        // OpenAI 系认最具体的这个变量；只设通用的会被空闲超时兜底，测不出来。
        const previous = process.env.PI_OPENAI_STREAM_FIRST_EVENT_TIMEOUT_MS;
        process.env.PI_OPENAI_STREAM_FIRST_EVENT_TIMEOUT_MS = "20";
        try {
            // 只有调用方的信号结束它：哪一层在计时，交回的就是 `error`。
            const {response} = await run(silent, {firstEventTimeoutMs: 0}, "openai-completions", AbortSignal.timeout(200));
            expect(response.stopReason).toBe("aborted");
        } finally {
            if (previous === undefined) delete process.env.PI_OPENAI_STREAM_FIRST_EVENT_TIMEOUT_MS;
            else process.env.PI_OPENAI_STREAM_FIRST_EVENT_TIMEOUT_MS = previous;
        }
    });

    test("流中途的空闲超时：归 network，可重发，半截内容交回", async () => {
        const {response, requests: sent} = await run(() => events((controller) => controller.enqueue(encoder.encode(half))), {firstEventTimeoutMs: 1000, idleTimeoutMs: 100});
        expect(response.error).toMatchObject({kind: "network", retryable: true});
        expect(response.error?.code).toBeUndefined();
        expect(response.content).toEqual([{kind: "text", text: "半句"}]);
        expect(sent).toBe(1);
    });

    test("等第一个事件时用户中止：按中止交回，不算超时", async () => {
        const {response} = await run(silent, {firstEventTimeoutMs: 5000}, "openai-completions", AbortSignal.timeout(50));
        expect(response.stopReason).toBe("aborted");
    });

    test("收到第一个事件之后不再按第一事件计时", async () => {
        const {response} = await run(() => events((controller) => controller.enqueue(encoder.encode(half))), {firstEventTimeoutMs: 50, idleTimeoutMs: 0}, "openai-completions", AbortSignal.timeout(200));
        expect(response.stopReason).toBe("aborted");
    });

    test("不给 transport：OMP 缺省的内层重试还在（nb-harness 其它调用方不变）", async () => {
        respond = () => failure(400, "bad input");
        requests = 0;
        const response = await ompCall(target("openai-completions"))(request, new AbortController().signal, () => undefined);
        expect(response.error?.retryable).toBeUndefined();
        respond = () => finish("stop");
        requests = 0;
        await ompCall(target("openai-completions"))(request, new AbortController().signal, () => undefined);
        expect(requests).toBeGreaterThan(1);
    });
});

describe("错误文字里的落盘路径", () => {
    const withDump = (): Response => failure(400, "bad input\nraw-http-request=/tmp/some/http-400-requests/a.json\nprovider says more");

    test("路径行在中间也去掉，其余行保留，路径交给宿主", async () => {
        const seen: string[] = [];
        respond = withDump;
        const response = await ompCall(target("openai-completions", {transport: {maxHttpAttempts: 1}, onRequestDump: async (path) => void seen.push(path)}))(request, new AbortController().signal, () => undefined);
        expect(seen).toEqual(["/tmp/some/http-400-requests/a.json"]);
        expect(response.error?.message).not.toContain("raw-http-request");
        expect(response.error?.message).toContain("provider says more");
    });

    test("宿主删除失败：原因写进错误文字", async () => {
        respond = withDump;
        const response = await ompCall(target("openai-completions", {transport: {maxHttpAttempts: 1}, onRequestDump: async () => {
            throw new Error("disk says no");
        }}))(request, new AbortController().signal, () => undefined);
        expect(response.error?.message).toContain("request dump not removed: disk says no");
    });
});
