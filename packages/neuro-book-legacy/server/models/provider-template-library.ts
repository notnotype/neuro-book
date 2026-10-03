import type {Api, Model} from "@earendil-works/pi-ai";
import {builtinProviders} from "@earendil-works/pi-ai/providers/all";
import {normalizePiRegistryCost} from "nbook/server/utils/pi-model-cost";
import {
    ProviderTemplateLibraryDtoSchema,
    type ConfiguredModelDto,
    type ProviderTemplateDto,
    type ProviderTemplateLibraryDto,
} from "nbook/shared/dto/app-settings.dto";
import {deriveModelGroup} from "nbook/shared/models/model-group";
import {isSupportedPiApi, type SupportedPiApi} from "@notnotype/neuro-book-contracts/provider-config";

const TEMPLATE_PROVIDER_IDS = new Set([
    "anthropic", "openai", "google", "deepseek", "xai", "xiaomi", "mistral", "minimax", "minimax-cn",
    "moonshotai", "moonshotai-cn", "zai", "zai-coding-cn", "kimi-coding", "cerebras", "groq", "nvidia",
    "fireworks", "together", "huggingface", "openrouter", "xiaomi-token-plan-cn", "xiaomi-token-plan-ams",
    "xiaomi-token-plan-sgp",
]);

/**
 * 只有明确承诺 Secret-only 创建体验的模板携带模型快照。
 * 其他连接模板只预填连接和 modelApi，避免把 Registry 全量模型机械写入用户配置。
 */
const TEMPLATE_MODEL_PROVIDER_IDS = new Set([
    "xiaomi-token-plan-cn",
    "xiaomi-token-plan-ams",
    "xiaomi-token-plan-sgp",
]);

const MODEL_COMPAT_PATCHES: Readonly<Record<string, Partial<Record<SupportedPiApi, Record<string, boolean | string>>>>> = {
    "mimo-v2.5-pro": {
        "openai-completions": {
            supportsDeveloperRole: false,
            maxTokensField: "max_tokens",
        },
    },
};

let cachedTemplates: ProviderTemplateLibraryDto | null = null;

/** 返回精选 Provider Template Library。 */
export function providerTemplateLibrary(): ProviderTemplateLibraryDto {
    cachedTemplates ??= ProviderTemplateLibraryDtoSchema.parse(buildTemplates());
    return cachedTemplates;
}

/** 按模板 ID 查询 Provider Template。 */
export function providerTemplate(templateId: string): ProviderTemplateDto | null {
    return providerTemplateLibrary().templates.find((template) => template.id === templateId.trim()) ?? null;
}

function buildTemplates(): ProviderTemplateLibraryDto {
    const templates = builtinProviders()
        .filter((provider) => TEMPLATE_PROVIDER_IDS.has(provider.id) && provider.baseUrl && !provider.baseUrl.includes("{"))
        .map((provider): ProviderTemplateDto => {
            const providerModels = provider.getModels();
            return {
                id: provider.id,
                name: provider.name,
                baseUrl: provider.baseUrl ?? "",
                defaultModelApi: defaultApi(providerModels),
                models: TEMPLATE_MODEL_PROVIDER_IDS.has(provider.id) ? providerModels.flatMap(templateModel) : [],
            };
        });

    templates.push({
        id: "custom",
        name: "Custom Provider",
        baseUrl: "",
        defaultModelApi: null,
        models: [],
    });

    return {templates: templates.sort((left, right) => left.name.localeCompare(right.name))};
}

function templateModel(model: Model<Api>): ConfiguredModelDto[] {
    if (!isSupportedPiApi(model.api)) {
        return [];
    }
    const patch = MODEL_COMPAT_PATCHES[model.id]?.[model.api];
    const compat = {...(model.compat ?? {}), ...(patch ?? {})};
    return [{
        id: model.id,
        name: model.name,
        group: deriveModelGroup(model.id),
        enabled: true,
        api: model.api,
        reasoning: model.reasoning,
        input: [...model.input],
        maxTokens: model.maxTokens,
        cost: normalizePiRegistryCost(model.cost),
        compat: Object.keys(compat).length ? compat as ConfiguredModelDto["compat"] : null,
        headers: model.headers && Object.keys(model.headers).length ? {...model.headers} : null,
        thinkingLevelMap: model.thinkingLevelMap ? {...model.thinkingLevelMap} : null,
        contextWindowTokens: model.contextWindow,
    }];
}

function defaultApi(models: readonly Model<Api>[]): SupportedPiApi | null {
    const counts = new Map<SupportedPiApi, number>();
    for (const model of models) {
        if (isSupportedPiApi(model.api)) {
            counts.set(model.api, (counts.get(model.api) ?? 0) + 1);
        }
    }
    return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? null;
}
