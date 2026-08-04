import {ref} from "vue";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {useProviderTemplateSession} from "nbook/app/components/novel-ide/settings/useProviderTemplateSession";
import {createModelCostDraft} from "nbook/app/components/novel-ide/settings/model-cost-draft";
import type {ModelSettingsDraft, ModelSettingsModelDraft} from "nbook/app/components/novel-ide/settings/model-settings-draft";
import type {ConfiguredModelDto} from "nbook/shared/dto/app-settings.dto";

vi.mock("nbook/app/composables/useNotification", () => ({
    useNotification: () => ({success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn()}),
}));

vi.mock("nbook/app/composables/useConfigApi", () => ({
    useConfigApi: () => ({
        modelLibrary: async () => ({models: []}),
        providerTemplates: async () => ({templates: [{
            id: "responses-provider",
            name: "Responses Provider",
            baseUrl: "https://example.com/v1",
            defaultModelApi: "openai-responses",
            models: [configuredModel()],
        }]}),
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
});

/** 将模板模型转换为前端草稿。 */
function cloneModel(model: ConfiguredModelDto): ModelSettingsModelDraft {
    return {
        localKey: `model-${model.id}`,
        name: model.name,
        id: model.id,
        group: model.group ?? "",
        enabled: model.enabled,
        api: model.api ?? "",
        reasoning: model.reasoning ? "true" : "false",
        input: model.input?.join(",") ?? "",
        maxTokens: String(model.maxTokens ?? ""),
        cost: createModelCostDraft(model.cost),
        compat: "",
        headers: "",
        thinkingLevelMap: "",
        contextWindowTokens: String(model.contextWindowTokens ?? ""),
    };
}

/** 创建模板内的完整模型快照。 */
function configuredModel(): ConfiguredModelDto {
    return {
        name: "Model",
        id: "model",
        group: "group",
        enabled: true,
        api: "openai-responses",
        reasoning: false,
        input: ["text"],
        maxTokens: 4096,
        cost: null,
        compat: null,
        headers: null,
        thinkingLevelMap: null,
        contextWindowTokens: 8192,
    };
}
