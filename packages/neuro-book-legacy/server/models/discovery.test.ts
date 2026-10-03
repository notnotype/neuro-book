import {afterEach, describe, expect, it, vi} from "vitest";
import {discoverProviderModelMetadata} from "nbook/server/models/discovery";
import type {ModelProviderDraftDto} from "nbook/shared/dto/app-settings.dto";

describe("Automatic Model Discovery", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it("OpenRouter 主机优先使用扩展字段并归一化字符串价格", async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({data: [{
            id: "vendor/model",
            context_length: 128000,
            top_provider: {max_completion_tokens: 16000},
            architecture: {input_modalities: ["text", "image"]},
            pricing: {prompt: "0.000001", completion: "0.000002"},
        }]})));
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const result = await discoverProviderModelMetadata(createProvider("https://openrouter.ai/api/v1"));
        expect(result.models[0]).toMatchObject({
            id: "vendor/model",
            api: "openai-completions",
            contextWindowTokens: 128000,
            maxTokens: 16000,
            input: ["text", "image"],
            cost: {input: 1, output: 2},
        });
        expect(result.diagnostics).toEqual({
            fetchedCount: 1,
            returnedCount: 1,
            skippedCount: 0,
            duplicateCount: 0,
            pageCount: 1,
            truncated: false,
            partial: false,
        });
        expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({redirect: "error"});
    });

    it("普通 OpenAI-compatible /models 不猜测 Completions 或 Responses", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({data: [{id: "responses-only"}]}))) as unknown as typeof fetch;

        const result = await discoverProviderModelMetadata(createProvider("https://example.com/v1", "", "openai-responses"));
        expect(result.models[0]).toMatchObject({id: "responses-only", api: null});
    });

    it("OpenAI-compatible /models 接受数字 pricing 元数据", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({data: [{
            id: "deepseek-v4-flash",
            context_length: 1_000_000,
            max_completion_tokens: 384_000,
            supports_reasoning: true,
            pricing: {prompt: 1, completion: 2, cache_read: 0.2},
        }]}))) as unknown as typeof fetch;

        const result = await discoverProviderModelMetadata(createProvider("https://tokenrhythm.example/v1", "secret"));
        expect(result.models[0]).toMatchObject({
            id: "deepseek-v4-flash",
            contextWindowTokens: 1_000_000,
            maxTokens: 384_000,
            reasoning: true,
            cost: null,
        });
    });

    it("OpenRouter pricing 为 null 时不生成不完整价格", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({data: [{
            id: "nullable-price",
            pricing: {prompt: null, completion: null},
        }]}))) as unknown as typeof fetch;

        const result = await discoverProviderModelMetadata(createProvider("https://openrouter.ai/api/v1"));

        expect(result.models[0]?.cost).toBeNull();
    });

    it("逐条容错并统计跳过、重复和数字字符串能力字段", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({data: [
            {id: "good", context_length: "128000", max_completion_tokens: "4096", supports_reasoning: true},
            {id: "good", context_length: 64_000},
            {id: "missing-id", context_length: "not-a-number", input_modalities: ["text", 42]},
            {id: ""},
            {id: 42},
            "not-an-object",
        ]}))) as unknown as typeof fetch;

        const result = await discoverProviderModelMetadata(createProvider("https://example.com/v1"));
        expect(result.models).toEqual([expect.objectContaining({
            id: "good",
            contextWindowTokens: 128000,
            maxTokens: 4096,
            reasoning: true,
        }), expect.objectContaining({
            id: "missing-id",
            contextWindowTokens: null,
            input: null,
        })]);
        expect(result.diagnostics).toMatchObject({
            fetchedCount: 6,
            returnedCount: 2,
            skippedCount: 3,
            duplicateCount: 1,
            partial: true,
        });
    });

    it("仅有重复模型时标记 partial", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({data: [
            {id: "duplicate"},
            {id: "duplicate"},
        ]}))) as unknown as typeof fetch;

        const result = await discoverProviderModelMetadata(createProvider("https://example.com/v1"));

        expect(result.models.map((model) => model.id)).toEqual(["duplicate"]);
        expect(result.diagnostics).toEqual({
            fetchedCount: 2,
            returnedCount: 1,
            skippedCount: 0,
            duplicateCount: 1,
            pageCount: 1,
            truncated: false,
            partial: true,
        });
    });

    it("普通 Provider 的 pricing 保持未配置，避免猜测价格单位", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({data: [{
            id: "custom-model",
            pricing: {prompt: 1, completion: 2},
        }]}))) as unknown as typeof fetch;

        const result = await discoverProviderModelMetadata(createProvider("https://example.com/v1"));
        expect(result.models[0]?.cost).toBeNull();
    });

    it("非法可选能力字段只归一化为 null，不丢弃模型", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({data: [{
            id: "invalid-capabilities",
            reasoning: "yes",
            input_modalities: ["text", 42],
            context_length: {},
            max_output_tokens: "not-a-number",
        }]}))) as unknown as typeof fetch;

        const result = await discoverProviderModelMetadata(createProvider("https://example.com/v1"));

        expect(result.models[0]).toMatchObject({
            id: "invalid-capabilities",
            reasoning: null,
            input: null,
            contextWindowTokens: null,
            maxTokens: null,
        });
        expect(result.diagnostics).toMatchObject({returnedCount: 1, skippedCount: 0, partial: false});
    });

    it("自定义 Header 可以发送，但不能覆盖系统认证 Header", async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({data: [{id: "custom-model"}]})));
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        await discoverProviderModelMetadata(createProvider("https://example.com/v1", "secret", "openai-completions", {
            headers: {
                "X-Tenant": "tenant-a",
                Authorization: "Bearer forged",
                accept: "text/plain",
                "X-Remove": null,
            },
        }));
        const headers = new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit).headers);
        expect(headers.get("x-tenant")).toBe("tenant-a");
        expect(headers.get("authorization")).toBe("Bearer secret");
        expect(headers.get("accept")).toBe("application/json");
        expect(headers.has("x-remove")).toBe(false);
    });

    it("Google 主机使用 query key、不发送 Authorization 并合并分页", async () => {
        const fetchMock = vi.fn(async (input: URL) => {
            const pageToken = input.searchParams.get("pageToken");
            return new Response(JSON.stringify(pageToken
                ? {models: [{name: "models/gemini-second", inputTokenLimit: 128000, outputTokenLimit: 8192}]}
                : {models: [{name: "models/gemini-first", inputTokenLimit: 1048576, outputTokenLimit: 65536}], nextPageToken: "page-2"}));
        });
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const result = await discoverProviderModelMetadata(createProvider("https://generativelanguage.googleapis.com/v1beta", "secret"));
        expect(result.models.map((model) => model.id)).toEqual(["gemini-first", "gemini-second"]);
        expect(result.models.map((model) => model.input)).toEqual([["text"], ["text"]]);
        expect(result.diagnostics).toMatchObject({fetchedCount: 2, returnedCount: 2, pageCount: 2, partial: false});
        const [firstUrl, firstInit] = fetchMock.mock.calls[0] as [URL, RequestInit];
        const [secondUrl] = fetchMock.mock.calls[1] as [URL, RequestInit];
        expect(firstUrl.searchParams.get("key")).toBe("secret");
        expect(secondUrl.searchParams.get("pageToken")).toBe("page-2");
        expect(new Headers(firstInit.headers).has("authorization")).toBe(false);
        expect(JSON.stringify(result)).not.toContain("secret");
    });


    it("Google 达到分页上限时保留结果并标记截断", async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({
            models: Array.from({length: 1000}, (_, index) => ({name: `models/gemini-${fetchMock.mock.calls.length}-${index}`})),
            nextPageToken: "next",
        })));
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const result = await discoverProviderModelMetadata(createProvider("https://generativelanguage.googleapis.com/v1beta", "secret"));
        expect(fetchMock).toHaveBeenCalledTimes(5);
        expect(result.models).toHaveLength(5000);
        expect(result.diagnostics).toMatchObject({fetchedCount: 5000, returnedCount: 5000, pageCount: 5, truncated: true, partial: true});
    });

    it("Google 分页共用一次总超时预算", async () => {
        const timeoutProvider = createProvider("https://generativelanguage.googleapis.com/v1beta", "secret");
        timeoutProvider.options.timeoutMs = 50;
        const fetchMock = vi.fn(async (_input: URL, init?: RequestInit) => {
            const delayMs = fetchMock.mock.calls.length === 1 ? 35 : 20;
            await new Promise<void>((resolve, reject) => {
                const timer = globalThis.setTimeout(resolve, delayMs);
                init?.signal?.addEventListener("abort", () => {
                    globalThis.clearTimeout(timer);
                    const error = new Error("aborted");
                    error.name = "AbortError";
                    reject(error);
                }, {once: true});
            });
            return fetchMock.mock.calls.length === 1
                ? new Response(JSON.stringify({models: [{name: "models/gemini-first"}], nextPageToken: "page-2"}))
                : new Response(JSON.stringify({models: [{name: "models/gemini-second"}]}));
        });
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        await expect(discoverProviderModelMetadata(timeoutProvider)).rejects.toMatchObject({code: "timeout"});
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("Google 后续页面失败时整次发现失败，不静默返回首屏", async () => {
        const fetchMock = vi.fn(async (input: URL) => new Response(input.searchParams.has("pageToken") ? "{}" : JSON.stringify({
            models: [{name: "models/gemini-first"}],
            nextPageToken: "page-2",
        }), input.searchParams.has("pageToken") ? {status: 503} : undefined));
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        await expect(discoverProviderModelMetadata(createProvider("https://generativelanguage.googleapis.com/v1beta", "secret"))).rejects.toMatchObject({
            code: "upstream-error",
        });
    });

    it("发现请求不使用 maxRetries，也不自动重试 5xx", async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response("{}", {status: 503}));
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        await expect(discoverProviderModelMetadata(createProvider("https://example.com/v1", "secret", "openai-completions", {maxRetries: 5}))).rejects.toMatchObject({code: "upstream-error"});
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("非 HTTP(S) API Base 和代理在网络调用前返回配置错误", async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({data: [{id: "unexpected"}]})));
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        for (const baseURL of ["file:///tmp/provider", "data:application/json,%7B%7D"]) {
            await expect(discoverProviderModelMetadata(createProvider(baseURL))).rejects.toMatchObject({code: "invalid-base-url"});
        }

        const provider = createProvider("https://example.com/v1");
        provider.options.proxy = "file:///tmp/proxy";
        await expect(discoverProviderModelMetadata(provider)).rejects.toMatchObject({code: "invalid-base-url"});
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("配置代理时通过 Bun fetch proxy 选项发起发现请求", async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({data: [{id: "proxied-model"}]})));
        globalThis.fetch = fetchMock as unknown as typeof fetch;
        const provider = createProvider("https://example.com/v1");
        provider.options.proxy = "http://127.0.0.1:7890";

        await discoverProviderModelMetadata(provider);

        const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit & {proxy?: string}];
        expect(init.proxy).toBe("http://127.0.0.1:7890");
    });

    it("空列表和全坏列表分别返回结构化错误", async () => {
        globalThis.fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({data: []}))).mockResolvedValueOnce(new Response(JSON.stringify({data: [{id: 42}]}))) as unknown as typeof fetch;

        await expect(discoverProviderModelMetadata(createProvider("https://example.com/v1"))).rejects.toMatchObject({code: "empty-result"});
        await expect(discoverProviderModelMetadata(createProvider("https://example.com/v1"))).rejects.toMatchObject({code: "invalid-response"});
    });

    it("失败摘要不暴露 Adapter 名称、远端 URL 或 API Key", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({object: "list"}))) as unknown as typeof fetch;

        const error = await discoverProviderModelMetadata({
            ...createProvider("https://secret.example/v1", "sk-secret-value"),
            name: "tokenrhythm",
        }).then(() => null, (caught) => caught);
        expect(error).toMatchObject({
            code: "invalid-response",
            message: expect.stringContaining("tokenrhythm 未发现可用模型"),
        });
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).not.toMatch(/openai-models|secret\.example|sk-secret-value/u);
    });

    it("上游 401、403、429、超时和响应体过大返回稳定错误码", async () => {
        for (const [status, code] of [[401, "unauthorized"], [403, "forbidden"], [429, "rate-limited"]] as const) {
            globalThis.fetch = vi.fn().mockResolvedValue(new Response("{}", {status})) as unknown as typeof fetch;
            await expect(discoverProviderModelMetadata(createProvider("https://example.com/v1", "secret"))).rejects.toMatchObject({code});
        }

        const timeoutProvider = createProvider("https://example.com/v1", "secret");
        timeoutProvider.options.timeoutMs = 5;
        globalThis.fetch = vi.fn((_url, init) => new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
                const error = new Error("aborted");
                error.name = "AbortError";
                reject(error);
            }, {once: true});
        })) as unknown as typeof fetch;
        await expect(discoverProviderModelMetadata(timeoutProvider)).rejects.toMatchObject({code: "timeout"});

        globalThis.fetch = vi.fn().mockResolvedValue(new Response("{}", {
            headers: {"content-length": String(6 * 1024 * 1024)},
        })) as unknown as typeof fetch;
        await expect(discoverProviderModelMetadata(createProvider("https://example.com/v1"))).rejects.toMatchObject({code: "response-too-large"});
    });

    it("明确选择 Anthropic Messages 后使用 x-api-key", async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({data: [{
            id: "mimo-v2.5-pro",
            display_name: "MiMo V2.5 Pro",
        }]})));
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const result = await discoverProviderModelMetadata(createProvider("https://api.xiaomimimo.com/v1", "secret", "anthropic-messages"));
        expect(result.models[0]).toMatchObject({id: "mimo-v2.5-pro", name: "MiMo V2.5 Pro", api: "anthropic-messages"});
        const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
        expect(url.pathname).toBe("/v1/models");
        const headers = new Headers(init.headers);
        expect(headers.get("x-api-key")).toBe("secret");
        expect(headers.get("anthropic-version")).toBe("2023-06-01");
        expect(headers.has("authorization")).toBe(false);
    });

    it("Bedrock 明确提示不支持自动发现且不发送请求", async () => {
        const fetchMock = vi.fn();
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        await expect(discoverProviderModelMetadata(createProvider("https://example.com", "secret", "bedrock-converse-stream"))).rejects.toMatchObject({code: "unsupported-discovery"});
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

function createProvider(
    baseURL: string,
    apiKey = "",
    modelApi: ModelProviderDraftDto["modelApi"] = "openai-completions",
    requestOptions: ModelProviderDraftDto["options"]["requestOptions"] = {},
): ModelProviderDraftDto {
    return {
        id: "test",
        name: "Test",
        modelApi,
        options: {apiKey, baseURL, proxy: "", timeoutMs: null, requestOptions},
    };
}
