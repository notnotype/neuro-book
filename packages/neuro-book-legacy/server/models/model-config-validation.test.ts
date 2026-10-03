import {describe, expect, it} from "vitest";
import type {ConfiguredModelConfig, ConfiguredProviderConfig, ModelSettingsConfig} from "nbook/server/config/types";
import {assertConfiguredModel, ModelConfigError, validateConfiguredModel, validateModelSettings} from "nbook/server/models/model-config-validation";

describe("model config validation", () => {
    it("Provider 连接不会替代缺失的 model.api", () => {
        const provider = createProvider();
        const issues = validateConfiguredModel("local", provider, createModel({api: null}));
        expect(issues.map((issue) => issue.code)).toContain("missing_api");
    });

    it("区分缺失 API 与不支持 API", () => {
        const provider = createProvider();
        expect(validateConfiguredModel("local", provider, createModel({api: null}))[0]?.code).toBe("missing_api");
        expect(validateConfiguredModel("local", provider, createModel({api: "mystery-api"}))[0]?.code).toBe("unsupported_api");
    });

    it("返回默认模型不可运行问题", () => {
        const config = createSettings({defaultModelKey: "missing/model"});
        expect(validateModelSettings(config).at(-1)).toMatchObject({
            code: "invalid_model_reference",
            modelKey: "missing/model",
        });
    });

    it("assertion 携带字段级错误", () => {
        expect(() => assertConfiguredModel("local", createProvider(), createModel({api: null}))).toThrow(ModelConfigError);
        try {
            assertConfiguredModel("local", createProvider(), createModel({api: null}));
        } catch (error) {
            expect(error).toMatchObject({issue: {code: "missing_api", modelKey: "local/model"}});
        }
    });
});

function createProvider(overrides: Partial<ConfiguredProviderConfig> = {}): ConfiguredProviderConfig {
    return {
        name: "Local",
        enabled: true,
        modelApi: null,
        options: {apiKey: "", baseURL: "http://127.0.0.1:11434/v1", proxy: "", timeoutMs: null, requestOptions: {}},
        models: {},
        ...overrides,
    };
}

function createModel(overrides: Partial<ConfiguredModelConfig> = {}): ConfiguredModelConfig {
    return {
        name: "Model",
        id: "model",
        group: null,
        enabled: true,
        api: "openai-completions",
        reasoning: false,
        input: ["text"],
        maxTokens: 4096,
        cost: null,
        compat: null,
        headers: null,
        thinkingLevelMap: null,
        contextWindowTokens: 8192,
        ...overrides,
    };
}

function createSettings(overrides: Partial<ModelSettingsConfig> = {}): ModelSettingsConfig {
    const provider = createProvider({models: {model: createModel()}});
    return {
        defaultModelKey: null,
        providers: {local: provider},
        ...overrides,
    };
}
