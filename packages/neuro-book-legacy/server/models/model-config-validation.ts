import type {ConfiguredModelConfig, ConfiguredProviderConfig, ModelSettingsConfig} from "nbook/server/config/types";
import type {ModelValidationIssueDto} from "nbook/shared/dto/app-settings.dto";
import {
    inspectModelSettings,
    inspectRunnableModel,
    type ModelReferenceInput,
    type ModelSettingsContractInput,
    type ProviderConfigInput,
} from "@notnotype/neuro-book-contracts/provider-config";

/** 模型配置错误。运行时携带首个字段级问题，不引入额外错误层级。 */
export class ModelConfigError extends Error {
    readonly issue: ModelValidationIssueDto;

    constructor(issue: ModelValidationIssueDto) {
        super(issue.message);
        this.name = "ModelConfigError";
        this.issue = issue;
    }
}

type RunnableConfiguredModel = ConfiguredModelConfig & {
    api: string;
    reasoning: boolean;
    input: NonNullable<ConfiguredModelConfig["input"]>;
    contextWindowTokens: number;
    maxTokens: number;
};

/** 将运行时 Provider Config 转换为 shared contract 输入。 */
export function modelSettingsContractInput(config: ModelSettingsConfig): ModelSettingsContractInput {
    return {
        defaultModelKey: config.defaultModelKey,
        providers: Object.entries(config.providers).map(([providerId, provider]) => providerContractInput(providerId, provider)),
    };
}

/** 校验一个模型是否具备完整运行能力。 */
export function validateConfiguredModel(
    providerId: string,
    provider: ConfiguredProviderConfig,
    model: ConfiguredModelConfig,
): ModelValidationIssueDto[] {
    return inspectRunnableModel(providerContractInput(providerId, provider), model);
}

/** 校验全部启用模型、默认模型和调用方提供的其他模型引用。 */
export function validateModelSettings(
    config: ModelSettingsConfig,
    references: readonly ModelReferenceInput[] = [],
): ModelValidationIssueDto[] {
    return inspectModelSettings(modelSettingsContractInput(config), references).issues;
}

/** 返回当前真正可运行的模型 key。 */
export function runnableModelKeys(config: ModelSettingsConfig): Set<string> {
    return inspectModelSettings(modelSettingsContractInput(config)).runnableModelKeys;
}

/** 断言模型可运行，失败时抛出首个字段级配置错误。 */
export function assertConfiguredModel(
    providerId: string,
    provider: ConfiguredProviderConfig,
    model: ConfiguredModelConfig,
): asserts model is RunnableConfiguredModel {
    const firstIssue = validateConfiguredModel(providerId, provider, model)[0];
    if (firstIssue) {
        throw new ModelConfigError(firstIssue);
    }
}

function providerContractInput(providerId: string, provider: ConfiguredProviderConfig): ProviderConfigInput {
    return {
        id: providerId,
        enabled: provider.enabled,
        modelApi: provider.modelApi,
        options: {baseURL: provider.options.baseURL},
        models: Object.values(provider.models),
    };
}
