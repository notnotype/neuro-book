import type {Api, Model} from "@earendil-works/pi-ai";
import {resolvePiModelMetadata, type ResolvedPiModel} from "nbook/server/agent/harness/pi-model-metadata";
import type {AgentProfileModelConfig} from "nbook/server/config/types";
import {loadGlobalEffectiveConfigSync} from "nbook/server/config/config-service";
import type {EffectiveConfig} from "nbook/server/config/types";

type ModelOverrideInput = Partial<AgentProfileModelConfig> & {
    model?: string | null;
};

export type {ResolvedPiModel} from "nbook/server/agent/harness/pi-model-metadata";

/**
 * 将当前 effective config 的模型引用解析成 Pi Model。
 */
export function resolvePiModelFromConfig(
    config: Pick<EffectiveConfig, "agent" | "models">,
    profileKey: string,
    override?: ModelOverrideInput | null,
): ResolvedPiModel {
    const profileModelKey = config.agent.profiles[profileKey]?.model.modelKey ?? config.agent.profileModelDefaults.modelKey ?? null;
    const modelKey = override?.modelKey ?? override?.model ?? profileModelKey ?? config.models.defaultModelKey;
    if (!modelKey) {
        throw new Error("配置未设置 models.default");
    }

    const [providerId, ...modelIdParts] = modelKey.split("/");
    const modelId = modelIdParts.join("/");
    if (!providerId || !modelId) {
        throw new Error(`模型 key 格式错误：${modelKey}`);
    }
    const provider = config.models.providers[providerId];
    const model = provider?.models[modelId];
    if (!provider || !provider.enabled || !model || !model.enabled) {
        throw new Error(`模型未启用或不存在：${modelKey}`);
    }

    return resolvePiModelMetadata(providerId, provider, model);
}

/**
 * 将 Global Config 的模型引用解析成 Pi Model。主要给测试和旧同步入口使用。
 */
export function resolvePiModel(profileKey: string, override?: ModelOverrideInput | null): ResolvedPiModel {
    return resolvePiModelFromConfig(loadGlobalEffectiveConfigSync(), profileKey, override);
}

/**
 * 从 effective config 返回当前模型 provider 的 API key。
 */
export function resolvePiApiKeyFromConfig(
    config: Pick<EffectiveConfig, "models">,
    providerId: string,
): string | undefined {
    return config.models.providers[providerId]?.options.apiKey || undefined;
}

/**
 * resolved model.provider 永远是本地 Provider Config ID。
 */
export function resolvePiApiKeyForModelFromConfig(
    config: Pick<EffectiveConfig, "models">,
    model: Model<Api>,
): string | undefined {
    return resolvePiApiKeyFromConfig(config, model.provider);
}

/**
 * 返回 Global Config 中当前模型 provider 的 API key。
 */
export function resolvePiApiKey(providerId: string): string | undefined {
    return resolvePiApiKeyFromConfig(loadGlobalEffectiveConfigSync(), providerId);
}
