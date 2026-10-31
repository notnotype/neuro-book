/**
 * OMP 适配器：本机起的 OpenAI 兼容端点（真实 HTTP、真实 OMP 服务商实现），不替换模型输出。
 * 这里的密钥都是假的，只发往本机端点。
 */

import {afterAll, describe, expect, test} from "bun:test";
import {defineModel} from "@notnotype/nb-harness";
import type {ModelDelta, ModelRequest, ToolDeclaration} from "../api/index.js";
import {ompCall, ompModelInfo} from "./omp.js";
import {REDACTED_KEY} from "./redact.js";

interface Reply {
    status?: number;
    text?: string;
    reasoning?: string;
    tool?: {name: string; args: object};
    echoKey?: boolean;
    noFinish?: boolean;
    /** 发完第一块就停住，直到请求被中止。 */
    hang?: boolean;
}

const bodies: {messages: {role: string; content: unknown; tool_call_id?: string; name?: string; tool_calls?: unknown}[]; tools?: {function: {name: string}}[]; tool_choice?: unknown}[] = [];
let replies: Reply[] = [];
let requestCount = 0;

const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
        requestCount += 1;
        bodies.push(JSON.parse(await request.text()));
        const reply = replies.shift() ?? {text: "默认"};
        if ((reply.status ?? 200) !== 200) {
            const message = reply.echoKey ? `invalid api key: ${request.headers.get("authorization") ?? ""}` : "unavailable";
            return new Response(JSON.stringify({error: {message}}), {status: reply.status, headers: {"content-type": "application/json", "retry-after": "0"}});
        }
        const chunk = (body: object) => `data: ${JSON.stringify({id: "c", object: "chat.completion.chunk", created: 0, model: "m", ...body})}\n\n`;
        const delta = reply.tool
            ? {role: "assistant", tool_calls: [{index: 0, id: "call_1", type: "function", function: {name: reply.tool.name, arguments: JSON.stringify(reply.tool.args)}}]}
            : {role: "assistant", ...(reply.reasoning === undefined ? {} : {reasoning_content: reply.reasoning}), content: reply.text ?? ""};
        const first = chunk({choices: [{index: 0, delta, finish_reason: null}]});
        if (reply.hang) {
            return new Response(new ReadableStream({start(controller) {
                controller.enqueue(new TextEncoder().encode(first));
                request.signal.addEventListener("abort", () => controller.close());
            }}), {headers: {"content-type": "text/event-stream"}});
        }
        const sse = first
            + (reply.noFinish ? "" : chunk({choices: [{index: 0, delta: {}, finish_reason: reply.tool ? "tool_calls" : "stop"}]}))
            + chunk({choices: [], usage: {prompt_tokens: 12, completion_tokens: 3, total_tokens: 15}})
            + "data: [DONE]\n\n";
        return new Response(sse, {headers: {"content-type": "text/event-stream"}});
    },
});
afterAll(() => server.stop(true));

const KEY = "sk-test-not-a-real-key-123456";
process.env.NB_KERNEL_ADAPTER_TEST_KEY = KEY;
const resolved = defineModel({provider: "local-test", api: "openai-completions", baseUrl: `http://127.0.0.1:${server.port}/v1`, id: "m", apiKeyEnv: "NB_KERNEL_ADAPTER_TEST_KEY", contextWindow: 32_000, maxTokens: 4_000});
const call = ompCall({model: resolved.model, apiKey: resolved.apiKey, priceKnown: false});

const search: ToolDeclaration = {id: "story.search", description: "检索", parameters: {type: "object", properties: {q: {type: "string"}}}, provider: "story", version: "1", finish: false, concurrency: "shared", strict: false, effect: "read"};

function request(patch: Partial<ModelRequest> = {}): ModelRequest {
    return {
        purpose: "turn",
        model: "local-test/m",
        params: {},
        headers: {},
        system: [{kind: "text", text: "你是测试。", origin: {kind: "fixed", by: "profile"}}],
        messages: [{role: "user", content: [{kind: "text", text: "你好", origin: {kind: "fixed", by: "kernel"}}]}],
        tools: [],
        ...patch,
    };
}
const text = (value: string) => ({kind: "text" as const, text: value, origin: {kind: "fixed" as const, by: "kernel" as const}});

async function run(req: ModelRequest, ...next: Reply[]) {
    replies = next;
    requestCount = 0;
    const deltas: ModelDelta[] = [];
    const response = await call(req, new AbortController().signal, (delta) => deltas.push(delta));
    return {response, deltas, requests: requestCount, body: bodies.at(-1)!};
}

describe("OMP 适配器", () => {
    test("文字回复：内容、增量、用量与停止原因；模型信息取自 OMP", async () => {
        const {response, deltas} = await run(request(), {text: "好的"});
        expect(response).toMatchObject({content: [{kind: "text", text: "好的"}], toolCalls: [], stopReason: "stop", model: "local-test/m"});
        expect(response.usage).toEqual({input: 12, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: null, complete: true});
        expect(deltas).toEqual([{part: "text", text: "好的"}]);
        expect(ompModelInfo(resolved.model)).toMatchObject({id: "local-test/m", contextWindow: 32_000, maxOutput: 4_000});
    });

    test("网关没送结束原因：按被截断记 length", async () => {
        const {response} = await run(request(), {text: "半句", noFinish: true});
        expect(response.stopReason).toBe("length");
    });

    test("推理内容收成思考块", async () => {
        const {response} = await run(request(), {reasoning: "先想一想", text: "答"});
        expect(response.content).toEqual([expect.objectContaining({kind: "thinking", text: "先想一想"}), {kind: "text", text: "答"}]);
    });

    test("工具：名字按 id 换算发出，回复里的调用换回 id；工具结果按调用 id 回给模型", async () => {
        const first = await run(request({tools: [search]}), {tool: {name: "story__search", args: {q: "林舟"}}});
        expect(first.body.tools?.map((tool) => tool.function.name)).toEqual(["story__search"]);
        expect(first.response).toMatchObject({stopReason: "tool", toolCalls: [{id: "call_1", tool: "story.search", args: {q: "林舟"}}]});
        const second = await run(request({
            tools: [search],
            messages: [
                {role: "user", content: [text("找林舟")]},
                {role: "assistant", content: [], toolCalls: first.response.toolCalls, model: "local-test/m"},
                {role: "tool", callId: "call_1", content: [text("第 3 章")]},
            ],
        }), {text: "在第 3 章"});
        expect(second.body.messages.map((message) => [message.role, message.tool_call_id ?? null])).toEqual([["system", null], ["user", null], ["assistant", null], ["tool", "call_1"]]);
        expect(second.response.content).toEqual([{kind: "text", text: "在第 3 章"}]);
    });

    test("相邻的 user 消息合成一条发出", async () => {
        const {body} = await run(request({messages: [{role: "user", content: [text("提醒")]}, {role: "user", content: [text("问题")]}]}), {text: "嗯"});
        expect(body.messages.filter((message) => message.role === "user")).toHaveLength(1);
        expect(JSON.stringify(body.messages)).toContain("提醒\\n\\n问题");
    });

    test("服务商报错按状态码归类；错误文字里回显的密钥被遮盖", async () => {
        const auth = await run(request(), {status: 401, echoKey: true});
        expect(auth.response.stopReason).toBe("error");
        expect(auth.response.error).toMatchObject({kind: "auth", status: 401});
        expect(auth.response.error!.message).not.toContain(KEY);
        expect(auth.response.error!.message).toContain(REDACTED_KEY);
        expect((await run(request(), {status: 402})).response.error?.kind).toBe("quota");
        // OMP 自己会重试 429：一直 429 时最终归为 rate_limit，被丢弃的尝试让用量标为不完整。
        const limited = await run(request(), ...Array.from({length: 20}, () => ({status: 429})));
        expect(limited.response.error?.kind).toBe("rate_limit");
        expect(limited.requests).toBeGreaterThan(1);
        expect(limited.response.usage.complete).toBe(false);
    });

    test("密钥取不到：发请求前以 auth 失败，不发请求", async () => {
        const noKey = ompCall({model: resolved.model, apiKey: () => { throw new Error("NB_MISSING_KEY is not set"); }, priceKnown: false});
        requestCount = 0;
        const response = await noKey(request(), new AbortController().signal, () => undefined);
        expect(response.error).toMatchObject({kind: "auth", code: "missing-key"});
        expect(requestCount).toBe(0);
    });

    test("中止：以 aborted 交回，用量标为不完整", async () => {
        replies = [{text: "开头", hang: true}];
        const controller = new AbortController();
        const pending = call(request(), controller.signal, () => controller.abort());
        const response = await pending;
        expect(response.stopReason).toBe("aborted");
        expect(response.usage.complete).toBe(false);
    });

    test("不支持的内容在发请求前失败：unsupported-content", async () => {
        requestCount = 0;
        const response = await call(request({messages: [{role: "user", content: [{kind: "image", blob: "0".repeat(64), mime: "image/png", origin: {kind: "fixed", by: "kernel"}}]}]}), new AbortController().signal, () => undefined);
        expect(response.error).toMatchObject({kind: "local", code: "unsupported-content"});
        expect(requestCount).toBe(0);
    });
});
