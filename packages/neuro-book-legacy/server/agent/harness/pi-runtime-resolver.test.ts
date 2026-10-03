import {describe, expect, it} from "vitest";
import {createServer} from "node:http";
import {once} from "node:events";
import type {Api, Model} from "@earendil-works/pi-ai";
import {resolvePiModelsFromConfig} from "nbook/server/agent/harness/pi-runtime-resolver";
import {SUPPORTED_PI_APIS} from "@notnotype/neuro-book-contracts/provider-config";
import {piRequestAuthOptions} from "nbook/server/agent/harness/pi-request-options";
import type {EffectiveConfig} from "nbook/server/config/types";

describe("Pi runtime resolver", () => {
    it("即使来源是正式预设，每次 invocation 也创建独立 Models", () => {
        const model = createModel("openai", "openai-completions", "http://127.0.0.1:11434/v1");
        const config = createConfig("openai", model);
        expect(resolvePiModelsFromConfig(config, model)).not.toBe(resolvePiModelsFromConfig(config, model));
    });

    it.each(SUPPORTED_PI_APIS)("自定义 Provider 映射 %s adapter", (api) => {
        const model = createModel("local", api, "http://127.0.0.1:11434/v1");
        const runtime = resolvePiModelsFromConfig(createConfig("local", model, api), model);
        expect(runtime.getProvider("local")).toBeDefined();
        expect(runtime.getModel("local", model.id)?.api).toBe(api);
    });

    it("未知 API 明确失败，不猜测或回退", () => {
        const model = createModel("local", "unknown-api", "http://127.0.0.1:11434/v1");
        expect(() => resolvePiModelsFromConfig(createConfig("local", model, "unknown-api"), model))
            .toThrow("不支持的 Pi API：unknown-api");
    });

    it("同类 Provider 的两份本地连接创建独立 runtime", () => {
        const left = {...createModel("left", "openai-completions", "http://127.0.0.1:8001/v1"), headers: {"X-Connection": "left"}};
        const right = {...left, provider: "right", baseUrl: "http://127.0.0.1:8002/v1", providerConfigId: "right", headers: {"X-Connection": "right"}};
        const leftRuntime = resolvePiModelsFromConfig(createConfig("left", left, "openai-completions"), left);
        const rightRuntime = resolvePiModelsFromConfig(createConfig("right", right, "openai-completions"), right);

        expect(leftRuntime).not.toBe(rightRuntime);
        expect(leftRuntime.getModel("left", left.id)?.baseUrl).toBe("http://127.0.0.1:8001/v1");
        expect(rightRuntime.getModel("right", right.id)?.baseUrl).toBe("http://127.0.0.1:8002/v1");
        expect(leftRuntime.getModel("left", left.id)?.headers).toEqual({"X-Connection": "left"});
        expect(rightRuntime.getModel("right", right.id)?.headers).toEqual({"X-Connection": "right"});
    });

    it("同类 Provider 两份本地连接不会串 API key 或 base URL", async () => {
        const leftServer = await startOpenAIServer("left");
        const rightServer = await startOpenAIServer("right");
        try {
            const left = createModel("left", "openai-completions", leftServer.baseUrl);
            const right = {...left, provider: "right", baseUrl: rightServer.baseUrl, providerConfigId: "right"};
            const [leftMessage, rightMessage] = await Promise.all([
                resolvePiModelsFromConfig(createConfig("left", left, "openai-completions"), left)
                    .completeSimple(left, {messages: []}, {apiKey: "left-key"}),
                resolvePiModelsFromConfig(createConfig("right", right, "openai-completions"), right)
                    .completeSimple(right, {messages: []}, {apiKey: "right-key"}),
            ]);

            expect(leftMessage.content).toEqual([{type: "text", text: "left"}]);
            expect(rightMessage.content).toEqual([{type: "text", text: "right"}]);
            expect(leftServer.authorization).toEqual(["Bearer left-key"]);
            expect(rightServer.authorization).toEqual(["Bearer right-key"]);
        } finally {
            await Promise.all([leftServer.close(), rightServer.close()]);
        }
    });

    it("自定义 OpenAI-compatible 无 API key 时可连接无认证端点", async () => {
        const server = await startOpenAIServer("no-auth");
        try {
            const model = createModel("local-openai", "openai-completions", server.baseUrl);
            const runtime = resolvePiModelsFromConfig(createConfig("local-openai", model), model);
            const message = await runtime.completeSimple(model, {messages: []}, piRequestAuthOptions({
                api: model.api,
            }));

            expect(message.content).toEqual([{type: "text", text: "no-auth"}]);
            expect(server.authorization).toEqual(["Bearer neurobook-no-auth"]);
        } finally {
            await server.close();
        }
    });

    it("OpenAI Completions adapter 对无响应体的 500 按 maxRetries 重试", async () => {
        const server = await startOpenAIServer("recovered", 1);
        try {
            const model = createModel("local-openai", "openai-completions", server.baseUrl);
            const runtime = resolvePiModelsFromConfig(createConfig("local-openai", model), model);
            const message = await runtime.completeSimple(model, {messages: []}, {
                ...piRequestAuthOptions({api: model.api}),
                maxRetries: 1,
            });

            expect(message.content).toEqual([{type: "text", text: "recovered"}]);
            expect(server.authorization).toHaveLength(2);
        } finally {
            await server.close();
        }
    });

    it("自定义 OpenAI Responses 无 API key 时可连接无认证端点", async () => {
        const server = await startOpenAIResponsesServer("responses-no-auth");
        try {
            const model = createModel("local-openai", "openai-responses", server.baseUrl);
            const runtime = resolvePiModelsFromConfig(createConfig("local-openai", model), model);
            const message = await runtime.completeSimple(model, {messages: []}, piRequestAuthOptions({
                api: model.api,
            }));

            expect(message.content).toEqual([expect.objectContaining({type: "text", text: "responses-no-auth"})]);
            expect(server.authorization).toEqual(["Bearer neurobook-no-auth"]);
        } finally {
            await server.close();
        }
    });
});

function createConfig(providerConfigId: string, model: Model<Api>, api: string | null = null): Pick<EffectiveConfig, "models"> {
    return {
        models: {
            defaultModelKey: `${providerConfigId}/${model.id}`,
            providers: {
                [providerConfigId]: {
                    name: providerConfigId,
                    enabled: true,
                    modelApi: null,
                    options: {apiKey: "", baseURL: model.baseUrl, proxy: "", timeoutMs: null, requestOptions: {}},
                    models: {
                        [model.id]: {
                            name: model.name,
                            id: model.id,
                            group: null,
                            enabled: true,
                            api,
                            reasoning: model.reasoning,
                            input: [...model.input],
                            maxTokens: model.maxTokens,
                            cost: {...model.cost, tiers: model.cost.tiers ?? []},
                            compat: null,
                            headers: null,
                            thinkingLevelMap: null,
                            contextWindowTokens: model.contextWindow,
                        },
                    },
                },
            },
        },
    };
}

function createModel(provider: string, api: string, baseUrl: string): Model<Api> & {providerConfigId: string} {
    return {
        id: "test-model",
        name: "Test Model",
        provider,
        providerConfigId: provider,
        api,
        baseUrl,
        reasoning: false,
        input: ["text"],
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
        contextWindow: 128_000,
        maxTokens: 8_000,
    };
}

async function startOpenAIServer(text: string, failures = 0): Promise<{baseUrl: string; authorization: string[]; close: () => Promise<void>}> {
    const authorization: string[] = [];
    let requestCount = 0;
    const server = createServer((request, response) => {
        requestCount += 1;
        authorization.push(request.headers.authorization ?? "");
        if (requestCount <= failures) {
            response.writeHead(500);
            response.end();
            return;
        }
        response.writeHead(200, {"content-type": "text/event-stream"});
        response.write(`data: ${JSON.stringify({id: text, object: "chat.completion.chunk", created: 1, model: "test-model", choices: [{index: 0, delta: {role: "assistant", content: text}, finish_reason: null}]})}\n\n`);
        response.write(`data: ${JSON.stringify({id: text, object: "chat.completion.chunk", created: 1, model: "test-model", choices: [{index: 0, delta: {}, finish_reason: "stop"}]})}\n\n`);
        response.end("data: [DONE]\n\n");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") {
        throw new Error("测试 HTTP server 未取得端口");
    }
    return {
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        authorization,
        close: async () => {
            server.close();
            await once(server, "close");
        },
    };
}

async function startOpenAIResponsesServer(text: string): Promise<{baseUrl: string; authorization: string[]; close: () => Promise<void>}> {
    const authorization: string[] = [];
    const server = createServer((request, response) => {
        authorization.push(request.headers.authorization ?? "");
        response.writeHead(200, {"content-type": "text/event-stream"});
        const item = {type: "message", role: "assistant", status: "completed", id: "msg-test", content: [{type: "output_text", text, annotations: []}]};
        const events = [
            {type: "response.created", response: {id: "resp-test"}},
            {type: "response.output_item.added", output_index: 0, item: {...item, status: "in_progress", content: []}},
            {type: "response.output_text.delta", output_index: 0, content_index: 0, delta: text},
            {type: "response.output_item.done", output_index: 0, item},
            {type: "response.completed", response: {id: "resp-test", usage: {input_tokens: 1, output_tokens: 1, total_tokens: 2}}},
        ];
        for (const event of events) {
            response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        }
        response.end();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") {
        throw new Error("测试 HTTP server 未取得端口");
    }
    return {
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        authorization,
        close: async () => {
            server.close();
            await once(server, "close");
        },
    };
}
