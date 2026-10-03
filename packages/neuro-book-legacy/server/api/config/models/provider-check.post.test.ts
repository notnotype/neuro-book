import {beforeEach, describe, expect, it, vi} from "vitest";

describe("POST /api/config/models/provider-check", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
        vi.stubGlobal("defineRouteMeta", () => undefined);
        vi.doMock("nbook/server/utils/novel-chapter", () => ({
            validateBody: vi.fn(async (event: {body?: unknown}) => event.body),
        }));
    });

    it("草稿没有启用模型且禁用保存模型回退时不会使用旧模型", async () => {
        const checkProviderConnection = vi.fn(async (_provider, modelDrafts) => ({
            success: false,
            latencyMs: null,
            message: String(modelDrafts.length),
        }));
        vi.doMock("nbook/server/config/config-service", () => ({
            loadGlobalEffectiveConfigSync: vi.fn(() => ({
                models: {
                    providers: {
                        custom: {
                            enabled: true,
                            modelApi: "openai-completions",
                            options: {apiKey: "sk-saved", baseURL: "https://example.com/v1", proxy: ""},
                            models: {
                                "saved-model": {
                                    name: "Saved",
                                    id: "saved-model",
                                    group: null,
                                    enabled: true,
                                    api: "openai-completions",
                                    reasoning: false,
                                    input: ["text"],
                                    maxTokens: 1024,
                                    cost: null,
                                    compat: null,
                                    headers: null,
                                    thinkingLevelMap: null,
                                    contextWindowTokens: 8192,
                                },
                            },
                        },
                    },
                },
            })),
        }));
        vi.doMock("nbook/server/utils/model-settings", () => ({
            checkProviderConnection,
            withSavedProviderApiKey: vi.fn((provider, savedApiKey) => ({
                ...provider,
                options: {
                    ...provider.options,
                    apiKey: provider.options.apiKey || savedApiKey || "",
                },
            })),
        }));
        vi.doMock("nbook/server/agent/http", () => ({
            useAgentHarness: vi.fn(() => ({
                traceBinding: vi.fn(() => ({kind: "test-trace"})),
            })),
        }));

        const handler = (await import("nbook/server/api/config/models/provider-check.post")).default;
        await handler({
            body: {
                provider: {
                    id: "custom",
                    name: "Custom",
                    modelApi: "openai-completions",
                    options: {
                        apiKey: "",
                        baseURL: "https://example.com/v1",
                        proxy: "",
                        timeoutMs: null,
                        requestOptions: {},
                    },
                },
                models: [],
                credentialSource: "saved",
                useSavedModels: false,
            },
        } as never);

        expect(checkProviderConnection).toHaveBeenCalledWith(expect.objectContaining({
            options: expect.objectContaining({apiKey: "sk-saved"}),
        }), [], {
            trace: {kind: "test-trace"},
        });
    });

    it("saved连接身份不匹配时返回400且网络Adapter零调用", async () => {
        const checkProviderConnection = vi.fn();
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
        vi.doMock("nbook/server/utils/model-settings", () => ({checkProviderConnection}));
        vi.doMock("nbook/server/agent/http", () => ({useAgentHarness: vi.fn()}));

        const handler = (await import("nbook/server/api/config/models/provider-check.post")).default;
        await expect(handler({body: {
            provider: {
                id: "custom",
                name: "Custom",
                modelApi: "openai-completions",
                options: {apiKey: "request-secret", baseURL: "https://changed.example/v1", proxy: "", timeoutMs: null, requestOptions: {}},
            },
            models: [],
            credentialSource: "saved",
            useSavedModels: false,
        }} as never)).rejects.toMatchObject({statusCode: 400});
        expect(checkProviderConnection).not.toHaveBeenCalled();
    });
});
