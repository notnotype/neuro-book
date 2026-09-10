import {createEmptyModelCostDraft} from "nbook/app/components/novel-ide/settings/views/model/model-cost-draft";
import type {
    ModelSettingsDraft,
    ModelSettingsModelDraft,
    ModelSettingsProviderDraft,
} from "nbook/app/components/novel-ide/settings/views/model/model-settings-draft";
import type {ModelApiOption, SavedModelGroupView} from "nbook/app/components/novel-ide/settings/views/model/model-settings-view";
import type {EnabledModelOptionDto} from "nbook/shared/dto/app-settings.dto";

/**
 * 模型区段 Lab 场景的确定性数据：只构造草稿与视图数据，不碰会话、store 或网络。
 * 两个 fixture（模型区段自己的与设置外壳的）共用这一份，避免同一份假数据写两遍。
 */

export const MODEL_API_OPTIONS: ModelApiOption[] = [
    {value: "openai-completions", label: "OpenAI Completions", description: "OpenAI-compatible Chat Completions"},
    {value: "openai-responses", label: "OpenAI Responses", description: "OpenAI Responses API"},
    {value: "anthropic-messages", label: "Anthropic Messages", description: "Anthropic Claude Messages"},
    {value: "google-generative-ai", label: "Google Generative AI", description: "Gemini / Google GenAI"},
    {value: "bedrock-converse-stream", label: "Bedrock Converse", description: "AWS Bedrock Converse Stream"},
];

export const MODEL_PROVIDER_TEMPLATES = [
    {id: "openai", name: "OpenAI"},
    {id: "anthropic", name: "Anthropic"},
    {id: "deepseek", name: "DeepSeek"},
];

export const MODEL_DEFAULT_MODEL_OPTIONS: EnabledModelOptionDto[] = [
    {key: "openai/gpt-5.1", label: "GPT-5.1", providerId: "openai", modelId: "gpt-5.1", input: ["text"], contextWindowTokens: 400000},
    {key: "openai/o4-mini", label: "o4-mini", providerId: "openai", modelId: "o4-mini", input: ["text"], contextWindowTokens: 200000},
];

function buildModel(localKey: string, id: string, name: string): ModelSettingsModelDraft {
    return {
        localKey,
        id,
        name,
        group: "gpt",
        enabled: true,
        api: "openai-completions",
        reasoning: "true",
        input: "text",
        contextWindowTokens: "400000",
        maxTokens: "128000",
        cost: createEmptyModelCostDraft(),
        compat: "",
        headers: "",
        thinkingLevelMap: "",
    };
}

function buildProvider(): ModelSettingsProviderDraft {
    return {
        localKey: "provider-openai",
        sourceIndex: 0,
        id: "openai",
        name: "OpenAI",
        enabled: true,
        modelApi: "openai-completions",
        options: {
            apiKey: "",
            apiKeyConfigured: true,
            apiKeyMaskedValue: "sk-****1234",
            apiKeyCleared: false,
            baseURL: "https://api.openai.com/v1",
            proxy: "",
            timeoutMs: "",
            maxRetries: "",
            requestOptions: "",
        },
        models: [buildModel("model-gpt51", "gpt-5.1", "GPT-5.1"), buildModel("model-o4mini", "o4-mini", "o4-mini")],
    };
}

/** 默认场景：一个启用的 Provider、两个可运行模型、默认模型已选。 */
export function buildModelSettingsDraft(): ModelSettingsDraft {
    return {
        defaultModelKey: "openai/gpt-5.1",
        providers: [buildProvider()],
        agentVisibleModels: [{modelKey: "openai/gpt-5.1", note: "主力写作模型"}],
    };
}

/** 停用场景：Provider 停用、一个模型停用并带 issues、草稿另有两条校验问题。 */
export function buildDisabledModelSettingsDraft(): ModelSettingsDraft {
    const draft = buildModelSettingsDraft();
    const provider = draft.providers[0]!;
    provider.enabled = false;
    provider.models[1]!.enabled = false;
    provider.models[1]!.api = "";
    return draft;
}

/** 停用清单：与 `buildDisabledModelSettingsDraft` 里的停用模型同源。 */
export function buildDisabledModels(draft: ModelSettingsDraft): ModelSettingsModelDraft[] {
    return draft.providers.flatMap((provider) => provider.models.filter((model) => !model.enabled));
}

/** 已保存模型清单的视图数据：第一条带一次成功的连通检查，第二条还没有结果。 */
export function buildSavedModelGroups(draft: ModelSettingsDraft): SavedModelGroupView[] {
    return draft.providers.map((provider) => ({
        group: provider.models[0]?.group ?? provider.id,
        models: provider.models.filter((model) => model.enabled).map((model, index) => ({
            model,
            apiLabel: model.api,
            apiSourceLabel: "模型覆盖",
            contextWindowLabel: "400,000",
            issues: [],
            checkResult: index === 0 ? {success: true, latencyMs: 412, message: "连通正常"} : null,
            checking: false,
            runnable: true,
        })),
    }));
}
