/**
 * OMP 适配器：本机起的 OpenAI 兼容端点（真实 HTTP、真实 OMP 服务商实现），不替换模型输出。
 * 这里的密钥都是假的，只发往本机端点。
 */

import {afterAll, describe, expect, test} from "bun:test";
import {defineModel} from "@notnotype/nb-harness";
import type {ModelDelta, ModelRequest, ToolDeclaration} from "../api/index.js";
import {lacksWebp, ompCall, ompModelInfo} from "./omp.js";
import {REDACTED_KEY} from "./redact.js";

interface Reply {
    status?: number;
    text?: string;
    reasoning?: string;
    tool?: {name: string; args: object};
    /** 把这个工具的参数拆成几块发（参数很长时服务商就是这样流式给的）。 */
    toolChunks?: {name: string; chunks: string[]};
    echoKey?: boolean;
    /** 错误正文回显这个请求头的值。 */
    echoHeader?: string;
    /** 错误正文另加的内容（测截断、网址遮盖）。 */
    errorExtra?: string;
    noFinish?: boolean;
    /** 发完第一块就停住，直到请求被中止。 */
    hang?: boolean;
}

const bodies: {messages: {role: string; content: unknown; tool_call_id?: string; name?: string; tool_calls?: unknown}[]; tools?: {function: {name: string}}[]; tool_choice?: unknown}[] = [];
let replies: Reply[] = [];
let requestCount = 0;
const headersSeen: Headers[] = [];

const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
        requestCount += 1;
        headersSeen.push(request.headers);
        bodies.push(JSON.parse(await request.text()));
        const reply = replies.shift() ?? {text: "默认"};
        if ((reply.status ?? 200) !== 200) {
            const echoed = reply.echoKey ? `invalid api key: ${request.headers.get("authorization") ?? ""}` : reply.echoHeader !== undefined ? `bad gateway token: ${request.headers.get(reply.echoHeader) ?? ""}` : "unavailable";
            const message = echoed + (reply.errorExtra ?? "");
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
            + (reply.toolChunks?.chunks ?? []).map((part, index) => chunk({choices: [{index: 0, delta: {tool_calls: [{index: 0, ...(index === 0 ? {id: "call_1", type: "function"} : {}), function: {...(index === 0 ? {name: reply.toolChunks!.name} : {}), arguments: part}}]}, finish_reason: null}]})).join("")
            + (reply.noFinish ? "" : chunk({choices: [{index: 0, delta: {}, finish_reason: reply.tool || reply.toolChunks ? "tool_calls" : "stop"}]}))
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

    test("输出 76：工具参数的增量：第一块带工具 id，同一个调用的片段连起来是参数的 JSON", async () => {
        const {response, deltas} = await run(request({tools: [search]}), {toolChunks: {name: "story__search", chunks: ['{"q":', '"钟声', '"}']}});
        expect(response.toolCalls).toMatchObject([{id: "call_1", tool: "story.search", args: {q: "钟声"}}]);
        const parts = deltas.filter((delta) => delta.part === "toolArgs");
        expect(parts.map((delta) => delta.tool)).toEqual(["story.search", undefined, undefined]);
        expect(parts.every((delta) => delta.callId === "call_1")).toBe(true);
        expect(JSON.parse(parts.map((delta) => delta.text).join(""))).toEqual({q: "钟声"});
    });

    test("用户消息的图片：位置不变；能看图的模型收到图片块，不能看图的换成一行文字", async () => {
        const origin = {kind: "fixed", by: "kernel"} as const;
        const messages = [{role: "user" as const, content: [{kind: "text" as const, text: "前", origin}, {kind: "image" as const, data: "QUJD", mime: "image/png", width: 800, height: 600, origin}, {kind: "text" as const, text: "后", origin}]}];
        const seen = async (run: typeof call): Promise<string> => {
            bodies.length = 0;
            await run(request({messages}), new AbortController().signal, () => undefined);
            return JSON.stringify(bodies.at(-1));
        };
        const plain = await seen(call);
        expect(plain).toContain("当前模型不能看图");
        expect(plain).not.toContain("QUJD");
        const vision = await seen(ompCall({model: {...resolved.model, input: ["text", "image"]}, apiKey: resolved.apiKey, priceKnown: false}));
        expect(vision).toContain("data:image/png;base64,QUJD");
        expect(vision.indexOf("前")).toBeLessThan(vision.indexOf("QUJD"));
        expect(vision.indexOf("QUJD")).toBeLessThan(vision.indexOf("后"));
    });

    test("工具消息的图片：能看图的模型收到图片块，不能看图的换成一行文字", async () => {
        const messages = (): ModelRequest["messages"] => [
            {role: "user", content: [text("看图")]},
            {role: "assistant", content: [], toolCalls: [{id: "call_1", tool: "story.search", args: {}}], model: "local-test/m"},
            {role: "tool", callId: "call_1", content: [text("封面"), {kind: "image", data: "QUJD", mime: "image/png", width: 800, height: 600, origin: {kind: "fixed", by: "kernel"}}]},
        ];
        const seen = async (target: ReturnType<typeof ompCall>) => {
            replies = [{text: "好"}];
            const response = await target(request({tools: [search], messages: messages()}), new AbortController().signal, () => undefined);
            expect(response.stopReason).not.toBe("error");
            return JSON.stringify(bodies.at(-1)!.messages);
        };
        const blind = await seen(ompCall({model: {...resolved.model, input: ["text"]}, apiKey: resolved.apiKey, priceKnown: false}));
        expect(blind).toContain("当前模型不能看图");
        expect(blind).toContain("800x600");
        expect(blind).not.toContain("QUJD");
        const vision = await seen(ompCall({model: {...resolved.model, input: ["text", "image"]}, apiKey: resolved.apiKey, priceKnown: false}));
        expect(vision).toContain("data:image/png;base64,QUJD");
    });

    test("本地后端解不了 WebP：发送前转成 PNG，转不了换成文字；云端服务商原样发", async () => {
        const dot = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/7yMK/gAAAABJRU5ErkJggg=="), (char) => char.charCodeAt(0));
        const webp = await new Bun.Image(dot).webp().toBase64();
        const image = (data: string) => ({kind: "image" as const, data, mime: "image/webp", origin: {kind: "fixed" as const, by: "kernel" as const}});
        const messages = (data: string): ModelRequest["messages"] => [
            {role: "user", content: [text("看图")]},
            {role: "assistant", content: [], toolCalls: [{id: "call_1", tool: "story.search", args: {}}], model: "local-test/m"},
            {role: "tool", callId: "call_1", content: [text("封面"), image(data)]},
        ];
        // 这个测试端点在回环地址上，属于本地后端。
        const local = ompCall({model: {...resolved.model, input: ["text", "image"]}, apiKey: resolved.apiKey, priceKnown: false});
        replies = [{text: "好"}];
        await local(request({tools: [search], messages: messages(webp)}), new AbortController().signal, () => undefined);
        expect(JSON.stringify(bodies.at(-1)!.messages)).toContain("data:image/png;base64,");
        expect(JSON.stringify(bodies.at(-1)!.messages)).not.toContain("image/webp");
        replies = [{text: "好"}];
        const broken = await local(request({tools: [search], messages: messages("AAAA")}), new AbortController().signal, () => undefined);
        expect(broken.stopReason).not.toBe("error");
        expect(JSON.stringify(bodies.at(-1)!.messages)).toContain("转换失败");

        // 压不动的图转回 PNG 太大时改用 JPEG（BMP 头加噪声，省得在测试里组 PNG）。
        const width = 1600;
        const height = 1200;
        const bmp = Buffer.alloc(54 + width * height * 3);
        bmp.write("BM");
        bmp.writeUInt32LE(bmp.length, 2);
        bmp.writeUInt32LE(54, 10);
        bmp.writeUInt32LE(40, 14);
        bmp.writeInt32LE(width, 18);
        bmp.writeInt32LE(height, 22);
        bmp.writeUInt16LE(1, 26);
        bmp.writeUInt16LE(24, 28);
        let state = 7;
        for (let at = 54; at < bmp.length; at += 1) {
            state = (state * 1103515245 + 12345) & 0x7fffffff;
            bmp[at] = state >> 16;
        }
        const noisy = await new Bun.Image(bmp).webp({quality: 40}).toBase64();
        replies = [{text: "好"}];
        await local(request({tools: [search], messages: messages(noisy)}), new AbortController().signal, () => undefined);
        expect(JSON.stringify(bodies.at(-1)!.messages)).toContain("data:image/jpeg;base64,");

        const cloud = {provider: "openai", api: "openai-completions", baseUrl: "https://api.openai.com/v1"} as const;
        expect(lacksWebp(cloud as never)).toBe(false);
        for (const model of [{...cloud, provider: "ollama"}, {...cloud, provider: "lm-studio"}, {...cloud, api: "ollama-chat"}, {...cloud, baseUrl: "http://localhost:1234/v1"}, {...cloud, baseUrl: "http://127.0.0.1:8080/v1"}, {...cloud, imageInputDecoder: "stb"}]) {
            expect(lacksWebp(model as never)).toBe(true);
        }
    });

    test("相邻的 user 消息合成一条发出；同一条消息里相邻的文字块合成一块", async () => {
        const {body} = await run(request({messages: [{role: "user", content: [text("提醒")]}, {role: "user", content: [text("附带"), text("问题")]}]}), {text: "嗯"});
        const users = body.messages.filter((message) => message.role === "user");
        expect(users).toHaveLength(1);
        expect(JSON.stringify(users[0]!.content)).toContain("提醒\\n\\n附带\\n\\n问题");
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

    test("密钥取不到：发请求前以 auth 失败，不发请求（同步抛错与异步 reject 一样）", async () => {
        const thrown = ompCall({model: resolved.model, apiKey: () => { throw new Error("NB_MISSING_KEY is not set"); }, priceKnown: false});
        const rejected = ompCall({model: resolved.model, apiKey: async () => Promise.reject(new Error("credential removed")), priceKnown: false});
        requestCount = 0;
        for (const noKey of [thrown, rejected]) {
            const response = await noKey(request(), new AbortController().signal, () => undefined);
            expect(response.error).toMatchObject({kind: "auth", code: "missing-key"});
        }
        expect(requestCount).toBe(0);
    });

    test("宿主配置的请求头随每个请求发出；它们的值与密钥一样被遮盖；服务商原文去掉网址里的凭据并截断", async () => {
        const GATEWAY = "gw-token-not-real-998877";
        const withHeaders = ompCall({model: resolved.model, apiKey: async () => KEY, priceKnown: false, headers: {"X-Gateway-Token": GATEWAY, "X-Team": "writing"}});
        replies = [{status: 401, echoHeader: "x-gateway-token", errorExtra: ` see https://user:pass@relay.example/v1?token=abc ${"x".repeat(20_000)}`}];
        headersSeen.length = 0;
        const response = await withHeaders(request(), new AbortController().signal, () => undefined);
        expect(headersSeen[0]!.get("x-gateway-token")).toBe(GATEWAY);
        expect(headersSeen[0]!.get("x-team")).toBe("writing");
        const message = response.error!.message;
        expect(message).not.toContain(GATEWAY);
        expect(message).toContain(REDACTED_KEY);
        expect(message).not.toContain("user:pass");
        expect(message).not.toContain("token=abc");
        expect(message.length).toBeLessThan(9_000);
        expect(message).toContain("truncated");
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
        const response = await call(request({messages: [{role: "user", content: [{kind: "thinking", text: "想", origin: {kind: "fixed", by: "kernel"}}]}]}), new AbortController().signal, () => undefined);
        expect(response.error).toMatchObject({kind: "local", code: "unsupported-content"});
        expect(requestCount).toBe(0);
    });
});
