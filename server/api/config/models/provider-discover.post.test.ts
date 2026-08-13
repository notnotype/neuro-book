import {beforeEach, describe, expect, it, vi} from "vitest";
import {ProviderDiscoveryError} from "nbook/server/models/discovery";

describe("POST /api/config/models/provider-discover", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
        vi.stubGlobal("defineRouteMeta", () => undefined);
        vi.doMock("nbook/server/utils/novel-chapter", () => ({
            validateBody: vi.fn(async (event: {body?: unknown}) => event.body),
        }));
    });

    it("saved连接身份不匹配时保留400且发现Adapter零调用", async () => {
        const discoverProviderModels = vi.fn();
        vi.doMock("nbook/server/config/config-service", () => ({
            loadGlobalEffectiveConfigSync: vi.fn(() => ({
                models: {providers: {custom: {
                    enabled: true,
                    modelApi: "openai-completions",
                    options: {apiKey: "sk-saved", baseURL: "https://saved.example/v1", proxy: ""},
                    models: {},
                }}},
            })),
        }));
        vi.doMock("nbook/server/utils/model-settings", () => ({discoverProviderModels}));

        const handler = (await import("nbook/server/api/config/models/provider-discover.post")).default;
        await expect(handler({body: {
            provider: {
                id: "custom",
                name: "Custom",
                modelApi: "openai-completions",
                options: {apiKey: "request-secret", baseURL: "https://changed.example/v1", proxy: "", timeoutMs: null, requestOptions: {}},
            },
            credentialSource: "saved",
        }} as never)).rejects.toMatchObject({statusCode: 400});
        expect(discoverProviderModels).not.toHaveBeenCalled();
    });

    it("saved凭据允许在原端点使用新的 Provider Model API", async () => {
        const discoverProviderModels = vi.fn(async (provider) => ({provider}));
        vi.doMock("nbook/server/config/config-service", () => ({
            loadGlobalEffectiveConfigSync: vi.fn(() => ({
                models: {providers: {custom: {
                    enabled: true,
                    modelApi: "openai-completions",
                    options: {apiKey: "sk-saved", baseURL: "https://saved.example/v1", proxy: ""},
                    models: {},
                }}},
            })),
        }));
        vi.doMock("nbook/server/utils/model-settings", () => ({discoverProviderModels}));

        const handler = (await import("nbook/server/api/config/models/provider-discover.post")).default;
        await handler({body: {
            provider: {
                id: "custom",
                name: "Custom",
                modelApi: "openai-responses",
                options: {apiKey: "", baseURL: "https://saved.example/v1", proxy: "", timeoutMs: null, requestOptions: {}},
            },
            credentialSource: "saved",
        }} as never);

        expect(discoverProviderModels).toHaveBeenCalledWith(expect.objectContaining({
            modelApi: "openai-responses",
            options: expect.objectContaining({apiKey: "sk-saved"}),
        }));
    });

    it("成功响应保留 models、message 和 diagnostics", async () => {
        const response = {
            models: [],
            message: "ok",
            diagnostics: {
                fetchedCount: 0,
                returnedCount: 0,
                skippedCount: 0,
                duplicateCount: 0,
                pageCount: 1,
                truncated: false,
                partial: false,
            },
        };
        const discoverProviderModels = vi.fn(async () => response);
        vi.doMock("nbook/server/config/config-service", () => ({
            loadGlobalEffectiveConfigSync: vi.fn(() => ({models: {providers: {custom: undefined}}})),
        }));
        vi.doMock("nbook/server/utils/model-settings", () => ({discoverProviderModels}));

        const handler = (await import("nbook/server/api/config/models/provider-discover.post")).default;
        await expect(handler({body: {
            provider: {
                id: "custom",
                name: "Custom",
                modelApi: "openai-completions",
                options: {apiKey: "", baseURL: "https://example.com/v1", proxy: "", timeoutMs: null, requestOptions: {}},
            },
            credentialSource: "provided",
        }} as never)).resolves.toEqual(response);
    });

    it.each([
        ["missing-base-url", 400],
        ["invalid-base-url", 400],
        ["unsupported-discovery", 400],
        ["unauthorized", 401],
        ["forbidden", 403],
        ["rate-limited", 429],
        ["timeout", 504],
        ["upstream-error", 502],
        ["invalid-response", 502],
        ["empty-result", 502],
        ["response-too-large", 502],
    ])("结构化 discovery 错误 %s 映射到 HTTP %s", async (code, statusCode) => {
        const discoverProviderModels = vi.fn(async () => {
            throw new ProviderDiscoveryError(code, "safe discovery error");
        });
        vi.doMock("nbook/server/config/config-service", () => ({
            loadGlobalEffectiveConfigSync: vi.fn(() => ({models: {providers: {custom: undefined}}})),
        }));
        vi.doMock("nbook/server/utils/model-settings", () => ({discoverProviderModels}));

        const handler = (await import("nbook/server/api/config/models/provider-discover.post")).default;
        await expect(handler({body: {
            provider: {
                id: "custom",
                name: "Custom",
                modelApi: "openai-completions",
                options: {apiKey: "", baseURL: "https://example.com/v1", proxy: "", timeoutMs: null, requestOptions: {}},
            },
            credentialSource: "provided",
        }} as never)).rejects.toMatchObject({statusCode, message: "safe discovery error"});
        await expect(handler({body: {
            provider: {
                id: "custom",
                name: "Custom",
                modelApi: "openai-completions",
                options: {apiKey: "", baseURL: "https://example.com/v1", proxy: "", timeoutMs: null, requestOptions: {}},
            },
            credentialSource: "provided",
        }} as never)).rejects.toMatchObject({data: {code}});
    });

    it("未知错误只返回安全摘要，不透传 URL 或 API Key", async () => {
        const discoverProviderModels = vi.fn(async () => {
            throw new Error("upstream https://secret.example/v1 Authorization Bearer sk-secret-value");
        });
        vi.doMock("nbook/server/config/config-service", () => ({
            loadGlobalEffectiveConfigSync: vi.fn(() => ({models: {providers: {custom: undefined}}})),
        }));
        vi.doMock("nbook/server/utils/model-settings", () => ({discoverProviderModels}));

        const handler = (await import("nbook/server/api/config/models/provider-discover.post")).default;
        const error = await handler({body: {
            provider: {
                id: "custom",
                name: "Custom",
                modelApi: "openai-completions",
                options: {apiKey: "sk-secret-value", baseURL: "https://secret.example/v1", proxy: "", timeoutMs: null, requestOptions: {}},
            },
            credentialSource: "provided",
        }} as never).then(() => null, (caught) => caught);

        expect(error).toMatchObject({statusCode: 502, message: "Provider 模型发现失败"});
        expect((error as Error).message).not.toMatch(/secret\.example|sk-secret-value/u);
    });
});
