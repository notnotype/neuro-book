import {afterEach, describe, expect, it, vi} from "vitest";
import {fauxAssistantMessage, fauxText} from "@earendil-works/pi-ai";
import {createFauxModels} from "nbook/server/agent/test-utils/faux-models";
import {checkModelHealth, checkProviderConnection, discoverProviderModels, MODEL_SMOKE_CHECK_PROMPTS, pickModelSmokeCheckPrompt, resolveConfiguredModel, withSavedProviderApiKey} from "nbook/server/utils/model-settings";
import type {ModelSettingsConfig} from "nbook/server/config/types";
import type {ConfiguredModelDto, ModelProviderDraftDto} from "nbook/shared/dto/app-settings.dto";
import type {PiTraceBinding} from "nbook/server/agent/observability/traced-provider";

function createProviderDraft(overrides: Partial<ModelProviderDraftDto> = {}): ModelProviderDraftDto {
    return {
        id: "qwen",
        name: "Qwen",
        modelApi: "openai-completions",
        options: {
            apiKey: "sk-test",
            baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1/",
            proxy: "",
            timeoutMs: 1000,
            requestOptions: {},
        },
        ...overrides,
    };
}

function createModelDraft(overrides: Partial<Omit<ConfiguredModelDto, "enabled">> = {}): Omit<ConfiguredModelDto, "enabled"> {
    return {
        name: "Faux",
        id: "faux-fast",
        group: null,
        api: "openai-completions",
        reasoning: false,
        input: ["text"],
        maxTokens: 1024,
        cost: null,
        compat: null,
        headers: null,
        thinkingLevelMap: null,
        contextWindowTokens: 8192,
        ...overrides,
    };
}

function createConfiguredModel(overrides: Partial<ConfiguredModelDto> = {}): ConfiguredModelDto {
    return {
        ...createModelDraft(),
        enabled: true,
        ...overrides,
    };
}

describe("model settings provider enabled", () => {
    it("disabled Provider 下的模型不进入 enabledModels，也不能被解析为默认模型", () => {
        const config: ModelSettingsConfig = {
            defaultModelKey: "enabled-provider/enabled-model",
            providers: {
                "disabled-provider": {
                name: "Disabled Provider",
                enabled: false,
                modelApi: "openai-completions",
                options: createProviderDraft().options,
                models: {"disabled-model": createConfiguredModel({id: "disabled-model", name: "Disabled Model"})},
            },
                "enabled-provider": {
                name: "Enabled Provider",
                enabled: true,
                modelApi: "openai-completions",
                options: createProviderDraft().options,
                models: {"enabled-model": createConfiguredModel({id: "enabled-model", name: "Enabled Model"})},
            },
            },
        };

        expect(resolveConfiguredModel(config, "disabled-provider/disabled-model")).toBeNull();
    });

    it("smoke prompt 从固定问题列表抽取，不再发送简单 ok 请求", () => {
        expect(MODEL_SMOKE_CHECK_PROMPTS).not.toContain("Reply with ok.");
        expect(pickModelSmokeCheckPrompt(() => 0)).toBe(MODEL_SMOKE_CHECK_PROMPTS[0]);
        expect(pickModelSmokeCheckPrompt(() => 0.999)).toBe(MODEL_SMOKE_CHECK_PROMPTS[MODEL_SMOKE_CHECK_PROMPTS.length - 1]);
    });
});

describe("provider/model Pi checks", () => {
    it("health-check trace 开启时写入 _system correlation，关闭时零记录", async () => {
        const faux = createFauxModels({provider: "faux-trace-check", api: "openai-completions", models: [{id: "faux-fast"}]});
        faux.setResponses([fauxAssistantMessage(fauxText("ok")), fauxAssistantMessage(fauxText("ok"))]);
        const record = vi.fn(async () => undefined);
        const binding: PiTraceBinding = {
            recorder: {record} as PiTraceBinding["recorder"],
            settings: {enabled: true, capturePayload: true, maxRecords: 100},
            correlation: {kind: "health-check", mode: "model-check"},
        };

        await checkModelHealth(createProviderDraft({id: "faux-trace-check"}), createModelDraft(), {
            runtimeResolver: () => faux.runtime,
            trace: binding,
        });
        await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1));
        expect(record.mock.calls[0]?.[0]).toMatchObject({correlation: {kind: "health-check", mode: "model-check"}});

        await checkModelHealth(createProviderDraft({id: "faux-trace-check"}), createModelDraft(), {
            runtimeResolver: () => faux.runtime,
            trace: {...binding, settings: {...binding.settings, enabled: false}},
        });
        expect(record).toHaveBeenCalledTimes(1);
    });

    it("model check 通过 Pi streamSimple smoke", async () => {
        const faux = createFauxModels({
            provider: "faux-check",
            api: "openai-completions",
            models: [{id: "faux-fast"}],
        });
        faux.setResponses([fauxAssistantMessage(fauxText("ok"))]);
        const result = await checkModelHealth(createProviderDraft({
            id: "faux-check",
            name: "Faux",
            modelApi: "openai-completions",
        }), createModelDraft({
            id: "faux-fast",
        }), {runtimeResolver: () => faux.runtime});

        expect(result.success).toBe(true);
        expect(result.message).toContain("Pi 检查通过");
    });

    it("model check 上下文超窗时不进入 Pi stream", async () => {
        const faux = createFauxModels({
            provider: "faux-overflow-check",
            api: "openai-completions",
            models: [{id: "faux-fast"}],
        });
        const streamSimple = vi.spyOn(faux.runtime, "streamSimple");
        const result = await checkModelHealth(createProviderDraft({
            id: "faux-overflow-check",
            name: "Faux Overflow",
            modelApi: "openai-completions",
        }), createModelDraft({
            id: "faux-fast",
            contextWindowTokens: 2,
            maxTokens: 1,
        }), {runtimeResolver: () => faux.runtime});

        expect(result.success).toBe(false);
        expect(result.message).toContain("Provider 请求上下文");
        expect(streamSimple).not.toHaveBeenCalled();
    });

    it("model check 收到已取消 signal 时不进入 Pi stream", async () => {
        const controller = new AbortController();
        controller.abort();
        const result = await checkModelHealth(createProviderDraft(), createModelDraft(), {
            signal: controller.signal,
        });

        expect(result).toMatchObject({
            success: false,
            latencyMs: null,
        });
        expect(result.message).toContain("检查已取消");
    });

    it("model check 将 active signal 传给 Pi streamSimple", async () => {
        const controller = new AbortController();
        const faux = createFauxModels({
            provider: "faux-signal-check",
            api: "openai-completions",
            models: [{id: "faux-fast"}],
        });
        faux.setResponses([(_context, options) => {
            expect(options?.signal).toBe(controller.signal);
            return fauxAssistantMessage(fauxText("ok"));
        }]);
        const result = await checkModelHealth(createProviderDraft({
            id: "faux-signal-check",
            name: "Faux Signal",
            modelApi: "openai-completions",
        }), createModelDraft({
            id: "faux-fast",
        }), {
            signal: controller.signal,
                runtimeResolver: () => faux.runtime,
        });

        expect(result.success).toBe(true);
    });

    it("provider check 可使用传入的代表模型", async () => {
        const faux = createFauxModels({
            provider: "faux-provider-check",
            api: "openai-completions",
            models: [{id: "faux-fast"}],
        });
        faux.setResponses([fauxAssistantMessage(fauxText("ok"))]);
        const result = await checkProviderConnection(createProviderDraft({
            id: "faux-provider-check",
            name: "Faux Provider",
            modelApi: "openai-completions",
            }), [createModelDraft({id: "faux-fast"})], {runtimeResolver: () => faux.runtime});

        expect(result.success).toBe(true);
        expect(result.message).toContain("Faux Provider Pi 检查通过");
    });

    it("Provider health check 将空配置补为默认重试次数并保留显式 0", async () => {
        const faux = createFauxModels({
            provider: "faux-provider-retries",
            api: "openai-completions",
            models: [{id: "faux-fast"}],
        });
        const observedMaxRetries: Array<number | undefined> = [];
        faux.setResponses([
            (_context, options) => {
                observedMaxRetries.push(options?.maxRetries);
                return fauxAssistantMessage(fauxText("default"));
            },
            (_context, options) => {
                observedMaxRetries.push(options?.maxRetries);
                return fauxAssistantMessage(fauxText("disabled"));
            },
        ]);

        await checkProviderConnection(createProviderDraft({id: "faux-provider-retries"}), [createModelDraft({id: "faux-fast"})], {
            runtimeResolver: () => faux.runtime,
        });
        await checkProviderConnection(createProviderDraft({
            id: "faux-provider-retries",
            options: {
                ...createProviderDraft().options,
                requestOptions: {maxRetries: 0},
            },
        }), [createModelDraft({id: "faux-fast"})], {runtimeResolver: () => faux.runtime});

        expect(observedMaxRetries).toEqual([5, 0]);
    });

    it("provider check 显式空模型列表时不回退 Pi registry", async () => {
        const result = await checkProviderConnection(createProviderDraft({
            id: "xiaomi-token-plan-cn",
            name: "Xiaomi Token Plan CN",
        }), []);

        expect(result).toMatchObject({
            success: false,
            latencyMs: null,
        });
        expect(result.message).toContain("没有可检查的模型");
    });

    it("本地无认证端点允许不填写 API Key", async () => {
        const faux = createFauxModels({provider: "qwen", api: "openai-completions", models: [{id: "faux-fast"}]});
        faux.setResponses([fauxAssistantMessage(fauxText("ok"))]);
        const result = await checkModelHealth(createProviderDraft({
            options: {
                apiKey: "",
                baseURL: "http://127.0.0.1:1234/v1",
                proxy: "",
                timeoutMs: null,
                requestOptions: {},
            },
        }), createModelDraft(), {runtimeResolver: () => faux.runtime});

        expect(result).toMatchObject({
            success: true,
        });
    });

    it("配置 Provider 代理时给出明确不支持提示", async () => {
        const result = await checkModelHealth(createProviderDraft({
            options: {
                apiKey: "sk-test",
                baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1/",
                proxy: "http://127.0.0.1:7890",
                timeoutMs: null,
                requestOptions: {},
            },
        }), createModelDraft());

        expect(result).toMatchObject({
            success: false,
            latencyMs: null,
        });
        expect(result.message).toContain("暂不支持通过 Provider 代理");
    });

    it("provider 错误消息会脱敏", async () => {
        const faux = createFauxModels({
            provider: "faux-error-check",
            api: "openai-completions",
            models: [{id: "faux-fast"}],
        });
        faux.setResponses([fauxAssistantMessage([], {
            stopReason: "error",
            errorMessage: "upstream rejected Bearer sk-secret123456789",
        })]);
        const result = await checkModelHealth(createProviderDraft({
            id: "faux-error-check",
            name: "Faux",
            api: "openai-completions",
        }), createModelDraft({id: "faux-fast"}), {runtimeResolver: () => faux.runtime});

        expect(result.success).toBe(false);
        expect(result.message).toContain("Bearer [REDACTED]");
        expect(result.message).not.toContain("sk-secret123456789");
    });

    it("可补齐已保存的 Provider API Key", () => {
        const provider = withSavedProviderApiKey(createProviderDraft({
            options: {
                apiKey: "",
                baseURL: "",
                proxy: "",
                timeoutMs: null,
                requestOptions: {},
            },
        }), "sk-saved");

        expect(provider.options.apiKey).toBe("sk-saved");
    });
});

describe("discoverProviderModels", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it("从 OpenAI-compatible /models 响应解析模型列表", async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            data: [
                {id: "qwen-plus"},
                {id: "qwen-max"},
                {id: "qwen-plus"},
                {id: ""},
            ],
        })));
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const result = await discoverProviderModels(createProviderDraft());

        const [url, init] = fetchMock.mock.calls[0] ?? [];
        expect(String(url)).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1/models");
        expect(init).toMatchObject({
            method: "GET",
            headers: {
                accept: "application/json",
                authorization: "Bearer sk-test",
            },
        });
        expect(result.models.map((model) => ({id: model.id, name: model.name, group: model.group}))).toEqual([
            {id: "qwen-max", name: "qwen-max", group: "qwen"},
            {id: "qwen-plus", name: "qwen-plus", group: "qwen"},
        ]);
        expect(result.diagnostics).toMatchObject({
            fetchedCount: 4,
            returnedCount: 2,
            skippedCount: 1,
            duplicateCount: 1,
            pageCount: 1,
            partial: true,
        });
        expect(result.message).toContain("已从 Qwen 发现 2 个模型");
    });

    it("缺少 API Base 时直接报错", async () => {
        await expect(discoverProviderModels(createProviderDraft({
            options: {
                apiKey: "",
                baseURL: "",
                proxy: "",
                timeoutMs: null,
                requestOptions: {},
            },
        }))).rejects.toThrow("Qwen 缺少 API Base");
    });

    it("远端返回非 2xx 时给出 HTTP 状态", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(new Response("{}", {
            status: 401,
            statusText: "Unauthorized",
        })) as unknown as typeof fetch;

        await expect(discoverProviderModels(createProviderDraft())).rejects.toThrow("HTTP 401");
    });

    it("远端 JSON 缺少 data 数组时给出结构错误", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({object: "list"}))) as unknown as typeof fetch;

        await expect(discoverProviderModels(createProviderDraft())).rejects.toThrow();
    });
});
