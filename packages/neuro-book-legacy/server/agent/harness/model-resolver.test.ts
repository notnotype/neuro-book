import {describe, expect, it} from "vitest";
import {resolvePiApiKeyForModelFromConfig, resolvePiModelFromConfig} from "nbook/server/agent/harness/model-resolver";
import {createDefaultEffectiveConfig} from "nbook/server/config/normalizer";
import type {EffectiveConfig} from "nbook/server/config/types";

describe("model resolver", () => {
    it("按 providerConfigId + model.id 从当前 effective config 解析完整模型", () => {
        const config = createConfig();
        const model = resolvePiModelFromConfig(config, "leader.default");

        expect(model).toMatchObject({
            provider: "local-openai",
            providerConfigId: "local-openai",
            id: "test-model",
            api: "openai-completions",
            baseUrl: "http://127.0.0.1:11434/v1",
            contextWindow: 128_000,
            maxTokens: 8_000,
        });
        expect(resolvePiApiKeyForModelFromConfig(config, model)).toBe("secret");
    });

    it("profile override 只改变 selection key，不读取 Catalog", () => {
        const config = createConfig();
        config.models.providers["local-openai"]!.models["other-model"] = {
            ...config.models.providers["local-openai"]!.models["test-model"]!,
            id: "other-model",
            name: "Other Model",
        };

        expect(resolvePiModelFromConfig(config, "leader.default", {modelKey: "local-openai/other-model"}).id).toBe("other-model");
    });

    it("删除、禁用或格式错误的 selection 明确失败", () => {
        const config = createConfig();
        expect(() => resolvePiModelFromConfig(config, "leader.default", {modelKey: "missing/model"})).toThrow("模型未启用或不存在");
        expect(() => resolvePiModelFromConfig(config, "leader.default", {modelKey: "bad-key"})).toThrow("模型 key 格式错误");
    });
});

function createConfig(): Pick<EffectiveConfig, "agent" | "models"> {
    const config = createDefaultEffectiveConfig();
    config.models = {
            defaultModelKey: "local-openai/test-model",
            providers: {
                "local-openai": {
                    name: "Local OpenAI",
                    enabled: true,
                    modelApi: null,
                    options: {apiKey: "secret", baseURL: "http://127.0.0.1:11434/v1", proxy: "", timeoutMs: null, requestOptions: {}},
                    models: {
                        "test-model": {
                            name: "Test Model",
                            id: "test-model",
                            group: null,
                            enabled: true,
                            api: "openai-completions",
                            reasoning: false,
                            input: ["text"],
                            maxTokens: 8_000,
                            cost: null,
                            compat: null,
                            headers: null,
                            thinkingLevelMap: null,
                            contextWindowTokens: 128_000,
                        },
                    },
                },
            },
        };
    config.agent.profileModelDefaults.modelKey = "local-openai/test-model";
    return config;
}
