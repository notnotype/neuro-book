import {describe, expect, it} from "vitest";
import {CheckModelRequestDtoSchema, CheckProviderRequestDtoSchema, ConfiguredModelDtoSchema, DiscoveryDiagnosticsDtoSchema, DiscoverProviderModelsResponseDtoSchema, EnabledModelOptionDtoSchema, ModelProviderDraftDtoSchema, ThinkingLevelSchema} from "nbook/shared/dto/app-settings.dto";
import {PiSimpleRequestOptionsSchema} from "nbook/shared/dto/pi-request-options.dto";
import {inspectModelSettings} from "nbook/shared/models/provider-config-contract";

describe("Pi settings contracts", () => {
    it("thinking level 接受 max", () => {
        expect(ThinkingLevelSchema.parse("max")).toBe("max");
    });

    it("Provider requestOptions 拒绝 runtime-owned 字段", () => {
        expect(() => PiSimpleRequestOptionsSchema.parse({apiKey: "hidden"})).toThrow("apiKey");
    });

    it("Provider 草稿必须明确默认接口格式", () => {
        expect(() => ModelProviderDraftDtoSchema.parse({...providerDraft(), modelApi: null})).toThrow();
    });

    it("保存时拒绝未知 Pi API", () => {
        const request = modelSettingsRequest();
        request.providers[0]!.models[0]!.api = "mystery-api";
        const result = inspectModelSettings({
            defaultModelKey: request.defaultModelKey,
            providers: request.providers,
        });
        expect(result.issues[0]?.code).toBe("unsupported_api");
    });

    it("启用模型必须保存完整能力", () => {
        const request = modelSettingsRequest();
        (request.providers[0]!.models[0] as {reasoning: boolean | null}).reasoning = null;
        const result = inspectModelSettings({defaultModelKey: request.defaultModelKey, providers: request.providers});
        expect(result.issues[0]?.code).toBe("missing_reasoning");
    });

    it("公开模型选项未声明输入能力时按纯文本处理", () => {
        expect(EnabledModelOptionDtoSchema.parse({
            key: "custom/model",
            label: "Custom / Model",
            providerId: "custom",
            modelId: "model",
            contextWindowTokens: 128000,
        }).input).toEqual(["text"]);
    });

    it("cost tiers 拒绝重复 threshold", () => {
        const request = modelSettingsRequest();
        const cost = {input: 1, output: 2, cacheRead: 0, cacheWrite: 0};
        (request.providers[0]!.models[0] as {cost: null | {input: number; output: number; cacheRead: number; cacheWrite: number; tiers: Array<{inputTokensAbove: number; input: number; output: number; cacheRead: number; cacheWrite: number}>}}).cost = {...cost, tiers: [{...cost, inputTokensAbove: 100}, {...cost, inputTokensAbove: 100}]};
        expect(() => ConfiguredModelDtoSchema.parse(request.providers[0]!.models[0])).toThrow("tier threshold 重复");
    });

    it("discovery diagnostics 保留部分结果统计", () => {
        const diagnostics = DiscoveryDiagnosticsDtoSchema.parse({
            fetchedCount: 4,
            returnedCount: 2,
            skippedCount: 1,
            duplicateCount: 1,
            pageCount: 1,
            truncated: false,
            partial: true,
        });
        expect(DiscoverProviderModelsResponseDtoSchema.parse({models: [], message: "ok", diagnostics}).diagnostics).toEqual(diagnostics);
    });
});

describe("Provider/model check DTO", () => {
    it("保留完整 Provider 与模型草稿", () => {
        const provider = providerDraft();
        const model = modelDraft();
        const parsed = CheckProviderRequestDtoSchema.parse({provider, models: [model], credentialSource: "saved"});

        expect(parsed.provider).not.toHaveProperty("discovery");
        expect(parsed.models).toEqual([expect.objectContaining({id: "draft-model", headers: {"X-Test": "value"}})]);
        expect(parsed.credentialSource).toBe("saved");
        expect(parsed.useSavedModels).toBe(true);
    });

    it("未传模型草稿时使用空列表默认值", () => {
        expect(CheckProviderRequestDtoSchema.parse({provider: providerDraft(), credentialSource: "cleared"}).models).toEqual([]);
    });

    it("保留检查回退开关", () => {
        const parsed = CheckProviderRequestDtoSchema.parse({provider: providerDraft(), models: [], credentialSource: "provided", useSavedModels: false});
        expect(parsed.credentialSource).toBe("provided");
        expect(parsed.useSavedModels).toBe(false);
    });

    it("单模型检查保留 API Key 回退开关", () => {
        expect(CheckModelRequestDtoSchema.parse({provider: providerDraft(), model: modelDraft(), credentialSource: "cleared"}).credentialSource).toBe("cleared");
    });

    it("凭据来源不能缺省，避免隐式读取已保存 Secret", () => {
        expect(() => CheckProviderRequestDtoSchema.parse({provider: providerDraft()})).toThrow();
        expect(() => CheckModelRequestDtoSchema.parse({provider: providerDraft(), model: modelDraft()})).toThrow();
    });
});

function modelSettingsRequest() {
    return {
        defaultModelKey: "custom/model",
        providers: [{
            id: "custom",
            name: "Custom",
            enabled: true,
            modelApi: "openai-completions",
            options: {apiKey: "", baseURL: "https://example.com/v1", proxy: "", timeoutMs: null, requestOptions: {}},
            models: [{...modelDraft(), id: "model", name: "Model", enabled: true}],
        }],
    };
}

function providerDraft() {
    return {
        id: "custom",
        name: "Custom",
        modelApi: "openai-completions",
        options: {apiKey: "", baseURL: "https://example.com/v1", proxy: "", timeoutMs: null, requestOptions: {}},
    };
}

function modelDraft() {
    return {
        name: "Draft Model",
        id: "draft-model",
        group: null,
        api: "openai-completions",
        reasoning: true,
        input: ["text"],
        maxTokens: 4096,
        cost: null,
        compat: {maxTokensField: "max_tokens"},
        headers: {"X-Test": "value"},
        thinkingLevelMap: null,
        contextWindowTokens: 128000,
    };
}
