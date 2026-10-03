import type {
    CheckModelResponseDto,
    CheckProviderResponseDto,
    ConfiguredModelDto,
    DiscoverProviderModelsResponseDto,
    ModelProviderDraftDto,
} from "nbook/shared/dto/app-settings.dto";
import type {Api, Model, Models} from "@earendil-works/pi-ai";
import {createUserMessage} from "nbook/server/agent/messages/message-utils";
import type {
    ConfiguredModelConfig,
    ConfiguredProviderConfig,
    ModelProviderOptionsConfig,
    ModelSettingsConfig,
} from "nbook/server/config/types";
import {resolvePiModelsFromConfig} from "nbook/server/agent/harness/pi-runtime-resolver";
import {mergePiRequestHeaders, parsePiSimpleRequestOptions, piRequestAuthOptions} from "nbook/server/agent/harness/pi-request-options";
import {tracedStreamSimple} from "nbook/server/agent/observability/traced-provider";
import type {PiTraceBinding} from "nbook/server/agent/observability/traced-provider";
import {providerErrorText, sanitizeProviderErrorMessage} from "nbook/server/agent/observability/provider-error-sanitizer";
import {resolvePiModelMetadata} from "nbook/server/agent/harness/pi-model-metadata";
import {discoverProviderModelMetadata} from "nbook/server/models/discovery";

type ResolvedDefaultModel = {
    providerId: string;
    provider: ConfiguredProviderConfig;
    model: ConfiguredModelConfig;
};

type ModelHealthCheckOptions = {
    signal?: AbortSignal;
    /** 健康检查写入 `_system` bucket 时使用的正式 trace 绑定；关闭时仍可传入。 */
    trace?: PiTraceBinding;
    /** 可注入与生产一致的 Pi runtime resolver；调用方通常使用默认实现。 */
    runtimeResolver?: (providerDraft: ModelProviderDraftDto, modelDraft: Omit<ConfiguredModelDto, "enabled">, model: Model<Api>) => Models;
};

const DEFAULT_MODEL_SMOKE_TIMEOUT_MS = 30_000;
export const MODEL_SMOKE_CHECK_PROMPTS = [
    "随便想一个问题，然后用一句话自己回答。",
    "用一句话解释一个常见自然现象。",
    "给出一个两步以内的小计划。",
    "用一句话总结今天适合做的一件小事。",
    "提出一个简单判断题，并直接给出答案。",
] as const;

/**
 * 生成 `providerId/modelId` 形式的模型 key。
 */
export function buildModelKey(providerId: string, modelId: string): string {
    return `${providerId}/${modelId}`;
}

/**
 * 构造模型展示名。
 */
export function buildModelLabel(providerName: string, modelName: string): string {
    return `${providerName} / ${modelName}`;
}

/**
 * 解析指定模型 key。
 */
export function resolveConfiguredModel(config: ModelSettingsConfig, modelKey: string | null | undefined): ResolvedDefaultModel | null {
    const normalizedModelKey = modelKey?.trim() ?? "";
    if (!normalizedModelKey) {
        return null;
    }

    const separatorIndex = normalizedModelKey.indexOf("/");
    if (separatorIndex <= 0 || separatorIndex === normalizedModelKey.length - 1) {
        return null;
    }

    const providerId = normalizedModelKey.slice(0, separatorIndex);
    const modelId = normalizedModelKey.slice(separatorIndex + 1);
    const provider = config.providers[providerId];
    const model = provider?.models[modelId];
    if (!provider || !provider.enabled || !model || !model.enabled) {
        return null;
    }

    return {
        providerId,
        provider,
        model,
    };
}

/**
 * 解析默认模型指向的 provider / model。
 */
export function resolveDefaultModel(config: ModelSettingsConfig): ResolvedDefaultModel | null {
    return resolveConfiguredModel(config, config.defaultModelKey);
}

/**
 * 对 Provider 进行 Pi smoke 连通性测试。
 */
export async function checkProviderConnection(
    providerDraft: ModelProviderDraftDto,
    modelDrafts?: Array<Omit<ConfiguredModelDto, "enabled">>,
    options: ModelHealthCheckOptions = {},
): Promise<CheckProviderResponseDto> {
    const modelDraft = modelDrafts?.[0] ?? null;
    if (!modelDraft) {
        return {
            success: false,
            latencyMs: null,
            message: `${providerDraft.name} 没有可检查的模型；请先启用或添加一个模型。`,
        };
    }

    return runPiModelSmokeCheck(providerDraft, modelDraft, "provider", options);
}

/**
 * 从 OpenAI-compatible `/models` 端点抓取 Provider 模型列表。
 */
export async function discoverProviderModels(providerDraft: ModelProviderDraftDto): Promise<DiscoverProviderModelsResponseDto> {
    const startedAt = Date.now();
    const result = await discoverProviderModelMetadata(providerDraft);

    return {
        models: result.models,
        message: `已从 ${providerDraft.name} 发现 ${result.models.length} 个模型，用时 ${String(Date.now() - startedAt)}ms。`,
        diagnostics: result.diagnostics,
    };
}

/**
 * 对单个模型执行 Pi smoke 健康检查。
 */
export async function checkModelHealth(
    providerDraft: ModelProviderDraftDto,
    modelDraft: Omit<ConfiguredModelDto, "enabled">,
    options: ModelHealthCheckOptions = {},
): Promise<CheckModelResponseDto> {
    return runPiModelSmokeCheck(providerDraft, modelDraft, "model", options);
}

/**
 * 从固定 smoke prompt 列表中随机抽取一个检查问题。
 */
export function pickModelSmokeCheckPrompt(random = Math.random): string {
    const index = Math.floor(random() * MODEL_SMOKE_CHECK_PROMPTS.length);
    return MODEL_SMOKE_CHECK_PROMPTS[Math.min(Math.max(index, 0), MODEL_SMOKE_CHECK_PROMPTS.length - 1)] ?? MODEL_SMOKE_CHECK_PROMPTS[0];
}

/**
 * 规范化 provider options，保留类型引用，避免旧导出消费者漂移。
 */
export function normalizeModelProviderOptions(options: ModelProviderOptionsConfig): ModelProviderOptionsConfig {
    return {
        apiKey: options.apiKey.trim(),
        baseURL: options.baseURL.trim(),
        proxy: options.proxy.trim(),
        timeoutMs: options.timeoutMs,
        requestOptions: options.requestOptions,
    };
}

/**
 * 设置页不会回传已保存的 secret；检查类接口在后端补齐旧 key。
 */
export function withSavedProviderApiKey(providerDraft: ModelProviderDraftDto, savedApiKey: string | undefined): ModelProviderDraftDto {
    if (providerDraft.options.apiKey.trim() || !savedApiKey) {
        return providerDraft;
    }
    return {
        ...providerDraft,
        options: {
            ...providerDraft.options,
            apiKey: savedApiKey,
        },
    };
}

async function runPiModelSmokeCheck(
    providerDraft: ModelProviderDraftDto,
    modelDraft: Omit<ConfiguredModelDto, "enabled">,
    scope: "provider" | "model",
    options: ModelHealthCheckOptions = {},
): Promise<CheckModelResponseDto> {
    if (providerDraft.options.proxy.trim()) {
        return {
            success: false,
            latencyMs: null,
            message: `${providerDraft.name} 已配置代理，但 Pi 检查暂不支持通过 Provider 代理发起请求；请先使用 Agent smoke 或移除代理后再检查。`,
        };
    }

    if (options.signal?.aborted) {
        return {
            success: false,
            latencyMs: null,
            message: `${providerDraft.name}/${modelDraft.id} 检查已取消。`,
        };
    }

    const startedAt = Date.now();
    try {
        const model = resolvePiModelMetadata(providerDraft.id, {
            name: providerDraft.name,
            enabled: true,
            modelApi: providerDraft.modelApi,
            options: providerDraft.options,
            models: {},
        }, {...modelDraft, enabled: true});
        const config = {
            models: {
                defaultModelKey: `${providerDraft.id}/${modelDraft.id}`,
                providers: {
                    [providerDraft.id]: {
                        name: providerDraft.name,
                        enabled: true,
                        modelApi: providerDraft.modelApi,
                        options: providerDraft.options,
                        models: {
                            [modelDraft.id]: {...modelDraft, enabled: true},
                        },
                    },
                },
            },
        };
        const models = options.runtimeResolver?.(providerDraft, modelDraft, model) ?? resolvePiModelsFromConfig(config, model);
        const requestOptions = parsePiSimpleRequestOptions(providerDraft.options.requestOptions);
        const apiKey = providerDraft.options.apiKey.trim() || undefined;
        const stream = tracedStreamSimple(models, model, {
            systemPrompt: "You are a concise connectivity smoke test assistant.",
            messages: [createUserMessage({text: pickModelSmokeCheckPrompt()})],
            tools: [],
        }, {
            ...requestOptions,
            ...piRequestAuthOptions({
                api: model.api,
                apiKey,
                env: requestOptions.env,
            }),
            headers: mergePiRequestHeaders(model.headers, requestOptions.headers),
            timeoutMs: providerDraft.options.timeoutMs ?? DEFAULT_MODEL_SMOKE_TIMEOUT_MS,
            maxTokens: Math.min(96, model.maxTokens),
            reasoning: undefined,
            cacheRetention: "none",
            signal: options.signal,
        }, options.trace);
        const response = await stream.result();
        const latencyMs = Date.now() - startedAt;
        if (options.signal?.aborted || response.stopReason === "aborted") {
            return {
                success: false,
                latencyMs,
                message: `${providerDraft.name}/${model.id} 检查已取消。`,
            };
        }
        if (response.stopReason === "error") {
            return {
                success: false,
                latencyMs,
                message: `${providerDraft.name}/${model.id} 检查失败：${sanitizeProviderErrorMessage(response.errorMessage || "provider 未返回错误详情")}`,
            };
        }
        return {
            success: true,
            latencyMs,
            message: scope === "provider"
                ? `${providerDraft.name} Pi 检查通过：${model.id}，用时 ${String(latencyMs)}ms。`
                : `${providerDraft.name}/${model.id} Pi 检查通过，用时 ${String(latencyMs)}ms。`,
        };
    } catch (error) {
        const latencyMs = Date.now() - startedAt;
        if (options.signal?.aborted || isAbortError(error)) {
            return {
                success: false,
                latencyMs,
                message: `${providerDraft.name}/${modelDraft.id} 检查已取消。`,
            };
        }
        return {
            success: false,
            latencyMs,
            message: `${providerDraft.name}/${modelDraft.id} 检查失败：${providerErrorText(error)}`,
        };
    }
}

/**
 * 判断 Provider SDK 抛出的错误是否来自 AbortSignal。
 */
function isAbortError(error: unknown): boolean {
    if (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError") {
        return true;
    }
    const name = typeof error === "object" && error !== null && "name" in error
        ? (error as {name?: unknown}).name
        : null;
    return name === "AbortError";
}
