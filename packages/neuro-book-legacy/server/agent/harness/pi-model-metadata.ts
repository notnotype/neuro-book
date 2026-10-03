import type {Api, Model} from "@earendil-works/pi-ai";
import type {ConfiguredModelConfig, ConfiguredProviderConfig} from "nbook/server/config/types";
import {resolvePiRuntimeCost} from "nbook/server/utils/pi-model-cost";
import {SupportedPiApiSchema} from "nbook/shared/dto/app-settings.dto";
import {assertConfiguredModel} from "nbook/server/models/model-config-validation";

export type ResolvedPiModel = Model<Api> & {
    /** Session selection 使用的本地 Provider Config ID。 */
    providerConfigId: string;
};

/**
 * 将完整、自包含的用户 Provider Config 解析为 Pi Model。
 * Runtime 不读取 Provider Preset、Model Catalog 或远程发现结果，也不猜测任何必需能力。
 */
export function resolvePiModelMetadata(
    providerConfigId: string,
    provider: ConfiguredProviderConfig,
    model: ConfiguredModelConfig,
): ResolvedPiModel {
    assertConfiguredModel(providerConfigId, provider, model);
    const api = SupportedPiApiSchema.parse(model.api);
    const baseUrl = provider.options.baseURL.trim();

    return {
        id: model.id,
        name: model.name || model.id,
        api,
        provider: providerConfigId,
        providerConfigId,
        baseUrl,
        reasoning: model.reasoning,
        input: [...model.input],
        cost: resolvePiRuntimeCost(undefined, model.cost),
        contextWindow: model.contextWindowTokens,
        maxTokens: model.maxTokens,
        headers: Object.fromEntries(Object.entries(model.headers ?? {}).filter((entry): entry is [string, string] => entry[1] !== null)),
        ...(model.compat ? {compat: model.compat as Model<Api>["compat"]} : {}),
        ...(model.thinkingLevelMap ? {thinkingLevelMap: model.thinkingLevelMap} : {}),
    };
}
