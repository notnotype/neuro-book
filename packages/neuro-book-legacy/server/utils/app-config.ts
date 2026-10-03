import * as yaml from "yaml";
import {expandEnvTemplate} from "nbook/server/utils/env-template";
import {
    normalizeGlobalConfig,
    resolveEffectiveConfig,
} from "nbook/server/config/normalizer";
import type {
    AgentProfileConfig,
    AgentProfileModelConfig,
    ConfiguredModelConfig,
    EffectiveConfig,
    StoredGlobalConfig,
    StoredProviderConfig,
} from "nbook/server/config/types";

export type {
    AgentProfileConfig,
    AgentProfileModelConfig,
    ConfiguredModelConfig,
};

export type AgentToolAccessConfig = {
    allow: string[];
    deny: string[];
};

export type AppConfig = EffectiveConfig & {
    agent: EffectiveConfig["agent"] & {
        tools: AgentToolAccessConfig;
    };
};

/**
 * 仅用于旧 config.yaml 迁移脚本和 legacy parser 测试。
 *
 * 运行时真值源是 server/config/config-service.ts，不要从新代码导入本文件。
 */
export function parseAppConfigText(rawText: string, env: NodeJS.ProcessEnv = process.env): AppConfig {
    const expandedText = expandEnvTemplate(rawText, env);
    const parsedYaml = expandedText.trim() ? yaml.parse(expandedText) as unknown : {};
    return withLegacyTools(resolveEffectiveConfig(normalizeGlobalConfig(normalizeLegacyConfig(parsedYaml)), null));
}

function withLegacyTools(config: EffectiveConfig): AppConfig {
    return {
        ...config,
        agent: {
            ...config.agent,
            tools: {
                allow: [],
                deny: [],
            },
        },
    };
}

/**
 * 兼容旧 config.yaml 的 provider/model map 形态，新 Global Config 文件仍只写数组形态。
 */
function normalizeLegacyConfig(input: unknown): Partial<StoredGlobalConfig> {
    if (!isRecord(input)) {
        return {};
    }

    const output = {...input} as Partial<StoredGlobalConfig>;
    const models = isRecord(input.models) ? input.models : null;
    if (models) {
        output.models = {
            ...(models as Partial<NonNullable<StoredGlobalConfig["models"]>>),
            providers: normalizeLegacyProviders(models.providers),
        };
    }

    return output;
}

function normalizeLegacyProviders(input: unknown): StoredProviderConfig[] | undefined {
    if (Array.isArray(input)) {
        return input as StoredProviderConfig[];
    }
    if (!isRecord(input)) {
        return undefined;
    }

    return Object.entries(input).map(([providerId, rawProvider]) => {
        const provider = isRecord(rawProvider) ? rawProvider : {};
        return {
            id: providerId,
            name: typeof provider.name === "string" ? provider.name : providerId,
            modelApi: typeof provider.modelApi === "string" ? provider.modelApi : null,
            options: isRecord(provider.options) ? provider.options : {},
            models: normalizeLegacyModels(provider.models),
        } as StoredProviderConfig;
    });
}

function normalizeLegacyModels(input: unknown): ConfiguredModelConfig[] {
    if (Array.isArray(input)) {
        return input as ConfiguredModelConfig[];
    }
    if (!isRecord(input)) {
        return [];
    }

    return Object.entries(input).map(([modelId, rawModel]) => {
        const model = isRecord(rawModel) ? rawModel : {};
        return {
            id: typeof model.id === "string" ? model.id : modelId,
            name: typeof model.name === "string" ? model.name : modelId,
            group: typeof model.group === "string" ? model.group : null,
            enabled: typeof model.enabled === "boolean" ? model.enabled : true,
            api: typeof model.api === "string" ? model.api : null,
            reasoning: typeof model.reasoning === "boolean" ? model.reasoning : null,
            input: Array.isArray(model.input) ? model.input.filter((item): item is NonNullable<ConfiguredModelConfig["input"]>[number] => item === "text" || item === "image") : null,
            maxTokens: typeof model.maxTokens === "number" ? model.maxTokens : null,
            cost: isRecord(model.cost)
                ? {
                    input: typeof model.cost.input === "number" ? model.cost.input : 0,
                    output: typeof model.cost.output === "number" ? model.cost.output : 0,
                    cacheRead: typeof model.cost.cacheRead === "number" ? model.cost.cacheRead : 0,
                    cacheWrite: typeof model.cost.cacheWrite === "number" ? model.cost.cacheWrite : 0,
                    tiers: Array.isArray(model.cost.tiers)
                        ? model.cost.tiers.filter(isRecord).map((tier) => ({
                            inputTokensAbove: typeof tier.inputTokensAbove === "number" ? tier.inputTokensAbove : 0,
                            input: typeof tier.input === "number" ? tier.input : 0,
                            output: typeof tier.output === "number" ? tier.output : 0,
                            cacheRead: typeof tier.cacheRead === "number" ? tier.cacheRead : 0,
                            cacheWrite: typeof tier.cacheWrite === "number" ? tier.cacheWrite : 0,
                        }))
                        : [],
                }
                : null,
            compat: isRecord(model.compat) ? model.compat as ConfiguredModelConfig["compat"] : null,
            headers: isRecord(model.headers) ? model.headers as ConfiguredModelConfig["headers"] : null,
            thinkingLevelMap: isRecord(model.thinkingLevelMap) ? model.thinkingLevelMap as ConfiguredModelConfig["thinkingLevelMap"] : null,
            contextWindowTokens: typeof model.contextWindowTokens === "number" ? model.contextWindowTokens : null,
        };
    });
}

function isRecord(input: unknown): input is Record<string, unknown> {
    return typeof input === "object" && input !== null && !Array.isArray(input);
}
