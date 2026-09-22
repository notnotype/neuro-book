import {ref} from "vue";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {useProviderTemplateSession} from "nbook/app/components/novel-ide/settings/useProviderTemplateSession";
import {createModelCostDraft} from "nbook/app/components/novel-ide/settings/sections/providers/provider-model-cost-draft";
import {SUPPORTED_PI_APIS} from "@notnotype/neuro-book-contracts/provider-config";
import type {ModelSettingsDraft, ModelSettingsModelDraft} from "nbook/app/components/novel-ide/settings/sections/providers/provider-settings-draft";
import type {ConfiguredModelDto} from "nbook/shared/dto/app-settings.dto";

vi.mock("nbook/app/composables/useNotification", () => ({
    useNotification: () => ({success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn()}),
}));

vi.mock("nbook/app/composables/useConfigApi", () => ({
    useConfigApi: () => ({
        modelLibrary: async () => ({models: []}),
        providerTemplates: async () => ({templates: [
            {
                id: "responses-provider",
                name: "Responses Provider",
                baseUrl: "https://example.com/v1",
                defaultModelApi: "openai-responses",
                models: [configuredModel()],
            },
            {
                id: "custom",
                name: "Custom Provider",
                baseUrl: "",
                defaultModelApi: null,
                models: [],
            },
        ]}),
    }),
}));

describe("Provider Template frontend session", () => {
    beforeEach(() => {
        vi.stubGlobal("useI18n", () => ({t: (key: string) => key}));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("模板实例化为普通 Provider Config，并保留新模型 API 提示", async () => {
        const draft = ref<ModelSettingsDraft>({defaultModelKey: null, agentVisibleModels: [], providers: []});
        const activeProviderKey = ref("");
        const session = useProviderTemplateSession({
            draft,
            activeProviderKey,
            createProviderKey: (providerId) => `provider-${providerId}`,
            cloneModel,
            ensureDefaultModel: () => {
                draft.value.defaultModelKey = "responses-provider/model";
            },
        });

        session.selectedTemplate.value = "responses-provider";
        await session.addProvider();

        expect(draft.value.providers[0]).toMatchObject({
            id: "responses-provider",
            name: "Responses Provider",
            modelApi: "openai-responses",
            options: {baseURL: "https://example.com/v1", maxRetries: ""},
            models: [{id: "model", api: "openai-responses"}],
        });
        expect(draft.value.providers[0]).not.toHaveProperty("templateId");
        expect(activeProviderKey.value).toBe("provider-responses-provider");
    });

    it("模板缺少默认 Pi API 时（Custom Provider）新增结果仍合法", async () => {
        const draft = ref<ModelSettingsDraft>({defaultModelKey: null, agentVisibleModels: [], providers: []});
        const activeProviderKey = ref("");
        const session = useProviderTemplateSession({
            draft,
            activeProviderKey,
            createProviderKey: (providerId) => `provider-${providerId}`,
            cloneModel,
            ensureDefaultModel: () => {},
        });

        // Custom Provider 是回落模板，defaultModelApi 为 null
        session.selectedTemplate.value = "custom";
        await session.addProvider();

        const added = draft.value.providers[0];
        expect(added?.modelApi).toBe("openai-completions");
        expect(SUPPORTED_PI_APIS).toContain(added?.modelApi);
    });
});

function configuredModel(): ConfiguredModelDto {
    return {
        name: "Model",
        id: "model",
        group: null,
        enabled: true,
        api: "openai-responses",
        reasoning: true,
        input: ["text"],
        maxTokens: null,
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, tiers: []},
        compat: null,
        headers: null,
        thinkingLevelMap: null,
        contextWindowTokens: null,
    };
}

/** 与 useModelSettingsDraftSession 的 cloneModel 同形的测试实现。 */
function cloneModel(model: ConfiguredModelDto): ModelSettingsModelDraft {
    return {
        localKey: `model-${model.id}`,
        name: model.name,
        id: model.id,
        group: model.group ?? "",
        enabled: model.enabled,
        api: model.api ?? "",
        reasoning: model.reasoning === null ? "inherit" : model.reasoning ? "true" : "false",
        input: model.input?.join(",") ?? "",
        maxTokens: typeof model.maxTokens === "number" ? String(model.maxTokens) : "",
        cost: createModelCostDraft(model.cost),
        compat: model.compat ? JSON.stringify(model.compat, null, 2) : "",
        headers: model.headers ? JSON.stringify(model.headers, null, 2) : "",
        thinkingLevelMap: model.thinkingLevelMap ? JSON.stringify(model.thinkingLevelMap, null, 2) : "",
        contextWindowTokens: typeof model.contextWindowTokens === "number" ? String(model.contextWindowTokens) : "",
    };
}
