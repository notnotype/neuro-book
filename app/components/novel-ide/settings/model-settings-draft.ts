import type {
    ConfiguredModelDto,
    ModelLibraryEntryDto,
    ModelInputKind,
} from "nbook/shared/dto/app-settings.dto";
import type {GlobalConfigUpdateDto, SecretConfigValueDto} from "nbook/shared/dto/config.dto";
import {parsePiMaxRetries, PiSimpleRequestOptionsSchema, type PiSimpleRequestOptionsDto} from "nbook/shared/dto/pi-request-options.dto";
import {parseModelCostDraft, type ModelCostDraft} from "nbook/app/components/novel-ide/settings/model-cost-draft";
import {
    inspectModelCapability,
    inspectModelSettings,
    inspectRunnableModel,
    isSupportedPiApi,
    type ModelReferenceInput,
    type ProviderConfigIssue,
    type ProviderConfigInput,
    type SupportedPiApi,
} from "nbook/shared/models/provider-config-contract";

/** 设置页用于业务校验的最小模型草稿。 */
export type ContractModelDraft = {
    id: string;
    enabled: boolean;
    api: string;
    reasoning: "inherit" | "true" | "false";
    input: string;
    contextWindowTokens: string;
    maxTokens: string;
};

/** 设置页用于业务校验的最小 Provider 草稿。 */
export type ContractProviderDraft<TModel extends ContractModelDraft = ContractModelDraft> = {
    id: string;
    enabled: boolean;
    modelApi: string;
    options: {baseURL: string};
    models: TModel[];
};

/** 设置页模型草稿的最小合同。 */
export type ContractSettingsDraft<TProvider extends ContractProviderDraft = ContractProviderDraft> = {
    defaultModelKey: string | null;
    providers: TProvider[];
};

/** 模型设置页保存使用的完整模型草稿。 */
export type ModelSettingsModelDraft = ContractModelDraft & {
    localKey: string;
    name: string;
    group: string;
    cost: ModelCostDraft;
    compat: string;
    headers: string;
    thinkingLevelMap: string;
};

/** 模型设置页保存使用的完整 Provider 草稿。 */
export type ModelSettingsProviderDraft = ContractProviderDraft<ModelSettingsModelDraft> & {
    localKey: string;
    /** 已保存原始 Provider 数组位置；新建 Provider 为空。 */
    sourceIndex?: number;
    name: string;
    options: {
        apiKey: string;
        apiKeyConfigured: boolean;
        apiKeyMaskedValue: string | null;
        apiKeyCleared: boolean;
        baseURL: string;
        proxy: string;
        timeoutMs: string;
        maxRetries: string;
        requestOptions: string;
    };
};

/** Agent 可见模型清单的前端草稿。顺序就是 prompt 中的展示顺序。 */
export type AgentVisibleModelDraft = {
    modelKey: string;
    note: string;
};

/** 设置页的完整模型草稿文档。 */
export type ModelSettingsDraft = ContractSettingsDraft<ModelSettingsProviderDraft> & {
    agentVisibleModels: AgentVisibleModelDraft[];
};

type AgentModelConfig = {
    profileModelDefaults?: {modelKey?: string | null};
    profiles?: Record<string, {model?: {modelKey?: string | null}}>;
    visibleModels?: AgentVisibleModelDraft[];
};

/** Model Library 批量补全中单个模型的可审计变更。 */
export type ModelLibraryRepair = {
    providerIndex: number;
    modelIndex: number;
    providerId: string;
    modelId: string;
    source: string;
    previousIssueCodes: string[];
    replacement: ConfiguredModelDto;
};

/** 一键修复中可由已有完整模型 API 确定的 Provider 默认接口补全。 */
export type ProviderModelApiRepair = {
    providerIndex: number;
    providerId: string;
    api: SupportedPiApi;
};

/** 将 UI 字符串草稿转换成 shared Provider Config contract 输入。 */
export function modelContractInput(model: ContractModelDraft) {
    return {
        id: model.id.trim(),
        enabled: model.enabled,
        api: model.api.trim() || null,
        reasoning: model.reasoning === "true" ? true : model.reasoning === "false" ? false : null,
        input: parseInput(model.input),
        contextWindowTokens: parsePositiveInteger(model.contextWindowTokens),
        maxTokens: parsePositiveInteger(model.maxTokens),
    };
}

/** 严格解析正整数；空值或小数都返回 null，由 shared contract 生成字段问题。 */
export function parseDraftInteger(value: string): number | null {
    return parsePositiveInteger(value);
}

/** 解析模型 input 草稿；只接受 NeuroBook 当前支持的 text/image。 */
export function parseModelInput(value: string): ModelInputKind[] | null {
    return parseInput(value);
}

/** 解析显式 reasoning 能力；inherit 表示未完成草稿。 */
export function parseModelReasoning(value: ContractModelDraft["reasoning"]): boolean | null {
    return value === "true" ? true : value === "false" ? false : null;
}

/** 解析 Pi compat JSON；空值表示不覆盖。 */
export function parseModelCompat(value: string): ConfiguredModelDto["compat"] {
    return parseJsonObject(value, "Compat") as ConfiguredModelDto["compat"];
}

/** 解析 headers/thinking map；值只能是 string 或 null。 */
export function parseStringMap(value: string): Record<string, string | null> | null {
    const parsed = parseJsonObject(value, "模型 JSON 映射");
    if (!parsed) {
        return null;
    }
    const result: Record<string, string | null> = {};
    for (const [key, item] of Object.entries(parsed)) {
        if (typeof item !== "string" && item !== null) {
            throw new Error(`模型 JSON 映射字段 ${key} 必须是字符串或 null`);
        }
        result[key] = item;
    }
    return result;
}

/** 合并 Provider 的结构化 maxRetries 与高级 JSON；重复配置时明确拒绝保存和临时请求。 */
export function buildProviderRequestOptions(requestOptions: string, maxRetries: string): PiSimpleRequestOptionsDto {
    const parsed = parseJsonObject(requestOptions, "Provider request options") ?? {};
    if (Object.hasOwn(parsed, "maxRetries")) {
        throw new Error("maxRetries 已由独立的最大重试次数字段管理，请从请求扩展参数 JSON 中删除它。");
    }
    return {
        ...PiSimpleRequestOptionsSchema.parse(parsed),
        maxRetries: parsePiMaxRetries(maxRetries.trim() ? Number(maxRetries) : undefined),
    };
}

/** 将已保存 Provider requestOptions 拆成结构化字段和高级 JSON 草稿。 */
export function splitProviderRequestOptions(requestOptions: PiSimpleRequestOptionsDto): {maxRetries: string; requestOptions: string} {
    const {maxRetries, ...advancedRequestOptions} = requestOptions;
    return {
        maxRetries: typeof maxRetries === "number" ? String(maxRetries) : "",
        requestOptions: Object.keys(advancedRequestOptions).length ? JSON.stringify(advancedRequestOptions, null, 2) : "",
    };
}

/** 将完整前端草稿转换成 Global Config 的 models section。 */
export function buildModelsSection(draft: ModelSettingsDraft): NonNullable<GlobalConfigUpdateDto["models"]> {
    const runnableModelKeys = inspectSettingsDraft({...draft, defaultModelKey: null}).runnableModelKeys;
    return {
        default: cleanModelKey(draft.defaultModelKey, runnableModelKeys),
        providers: draft.providers.map((provider) => ({
            ...(provider.sourceIndex !== undefined ? {sourceIndex: provider.sourceIndex} : {}),
            id: provider.id.trim(),
            name: provider.name.trim(),
            enabled: provider.enabled,
            modelApi: provider.modelApi.trim() || null,
            options: {
                apiKey: secretPayload(provider),
                baseURL: provider.options.baseURL.trim(),
                proxy: provider.options.proxy.trim(),
                timeoutMs: parsePositiveInteger(provider.options.timeoutMs),
                requestOptions: buildProviderRequestOptions(provider.options.requestOptions, provider.options.maxRetries),
            },
            models: provider.models.map((model) => ({
                name: model.name.trim(),
                id: model.id.trim(),
                group: model.group.trim() || null,
                enabled: model.enabled,
                api: model.api.trim() || null,
                reasoning: parseModelReasoning(model.reasoning),
                input: parseInput(model.input),
                maxTokens: parsePositiveInteger(model.maxTokens),
                cost: parseModelCostDraft(model.cost),
                compat: parseModelCompat(model.compat),
                headers: parseStringMap(model.headers),
                thinkingLevelMap: parseStringMap(model.thinkingLevelMap),
                contextWindowTokens: parsePositiveInteger(model.contextWindowTokens),
            })),
        })),
    };
}

/** 将可见模型草稿转换为 Global Agent Config；空数组保留运行时默认模型兜底语义。 */
export function buildAgentVisibleModels(draft: Pick<ModelSettingsDraft, "agentVisibleModels">): NonNullable<GlobalConfigUpdateDto["agent"]>["visibleModels"] {
    const seen = new Set<string>();
    return draft.agentVisibleModels.flatMap((entry) => {
        const modelKey = entry.modelKey.trim();
        if (!modelKey || seen.has(modelKey)) {
            return [];
        }
        seen.add(modelKey);
        return [{modelKey, note: entry.note.trim()}];
    });
}

/** 清理失效模型 key；Project 的 null 仍表示继承 Global。 */
export function cleanModelKey(modelKey: string | null | undefined, modelKeys: ReadonlySet<string>): string | null {
    const normalized = modelKey?.trim() ?? "";
    return normalized && modelKeys.has(normalized) ? normalized : null;
}

/** 清理 Global Agent 中失效模型引用；Global 显式保存 null。 */
export function cleanGlobalAgent<T extends AgentModelConfig>(agent: T | undefined, modelKeys: ReadonlySet<string>): T | undefined {
    if (!agent) {
        return agent;
    }
    return {
        ...agent,
        profileModelDefaults: agent.profileModelDefaults
            ? {...agent.profileModelDefaults, modelKey: cleanModelKey(agent.profileModelDefaults.modelKey, modelKeys)}
            : agent.profileModelDefaults,
        profiles: agent.profiles
            ? Object.fromEntries(Object.entries(agent.profiles).map(([profileKey, profile]) => [profileKey, {
                ...profile,
                model: profile.model
                    ? {...profile.model, modelKey: cleanModelKey(profile.model.modelKey, modelKeys)}
                    : profile.model,
            }]))
            : agent.profiles,
        visibleModels: agent.visibleModels ? cleanVisibleModels(agent.visibleModels, modelKeys) : agent.visibleModels,
    };
}

/** 清理 Project Agent 中失效模型引用；删除 modelKey 才表示继承 Global。 */
export function cleanProjectAgent<T extends AgentModelConfig>(agent: T | undefined, modelKeys: ReadonlySet<string>): T | undefined {
    if (!agent) {
        return agent;
    }
    const profileModelDefaults = agent.profileModelDefaults && Object.hasOwn(agent.profileModelDefaults, "modelKey")
        ? omitInvalidModelKey(agent.profileModelDefaults, modelKeys)
        : agent.profileModelDefaults;
    return {
        ...agent,
        profileModelDefaults,
        profiles: agent.profiles
            ? Object.fromEntries(Object.entries(agent.profiles).map(([profileKey, profile]) => [profileKey, {
                ...profile,
                model: profile.model && Object.hasOwn(profile.model, "modelKey")
                    ? omitInvalidModelKey(profile.model, modelKeys)
                    : profile.model,
            }]))
            : agent.profiles,
    };
}

/** Provider ID 重命名时迁移同一 scope 内显式保存的模型引用。 */
export function renameAgentProvider<T extends AgentModelConfig>(
    agent: T | undefined,
    previousProviderId: string,
    nextProviderId: string,
): {agent: T | undefined; changed: boolean} {
    if (!agent) {
        return {agent, changed: false};
    }
    let changed = false;
    const rename = (modelKey: string | null | undefined): string | null | undefined => {
        if (!modelKey?.startsWith(`${previousProviderId}/`)) {
            return modelKey;
        }
        changed = true;
        return modelKey.replace(`${previousProviderId}/`, `${nextProviderId}/`);
    };
    return {
        agent: {
            ...agent,
            profileModelDefaults: agent.profileModelDefaults
                ? {...agent.profileModelDefaults, modelKey: rename(agent.profileModelDefaults.modelKey)}
                : agent.profileModelDefaults,
            profiles: agent.profiles
                ? Object.fromEntries(Object.entries(agent.profiles).map(([profileKey, profile]) => [profileKey, {
                    ...profile,
                    model: profile.model ? {...profile.model, modelKey: rename(profile.model.modelKey)} : profile.model,
                }]))
                : agent.profiles,
            visibleModels: agent.visibleModels?.map((entry) => ({
                ...entry,
                modelKey: rename(entry.modelKey) ?? entry.modelKey,
            })),
        },
        changed,
    };
}

/** 清理重复或失效的 Agent 可见模型引用，保留原顺序与用途说明。 */
function cleanVisibleModels(entries: readonly AgentVisibleModelDraft[], modelKeys: ReadonlySet<string>): AgentVisibleModelDraft[] {
    const seen = new Set<string>();
    return entries.flatMap((entry) => {
        const modelKey = cleanModelKey(entry.modelKey, modelKeys);
        if (!modelKey || seen.has(modelKey)) {
            return [];
        }
        seen.add(modelKey);
        return [{modelKey, note: entry.note.trim()}];
    });
}

/** 将设置页草稿转换成 shared Provider Config contract 输入。 */
export function settingsContractInput(draft: ContractSettingsDraft) {
    return {
        defaultModelKey: draft.defaultModelKey,
        providers: draft.providers.map(providerContractInput),
    };
}

/** 实时校验当前草稿；不继续展示已保存快照中的过期问题。 */
export function inspectSettingsDraft(
    draft: ContractSettingsDraft,
    references: readonly ModelReferenceInput[] = [],
): {issues: ProviderConfigIssue[]; runnableModelKeys: Set<string>} {
    return inspectModelSettings(settingsContractInput(draft), references);
}

/** 判断当前模型草稿能否进入默认模型、Profile 或健康检查候选。 */
export function isRunnableDraft(provider: ContractProviderDraft, model: ContractModelDraft): boolean {
    return provider.enabled
        && model.enabled
        && inspectRunnableModel(providerContractInput(provider), modelContractInput(model)).length === 0;
}

/** 按 runnable 集合修正默认模型；没有可运行模型时清空。 */
export function ensureRunnableDefault(draft: ContractSettingsDraft): Set<string> {
    const runnableModelKeys = inspectSettingsDraft({...draft, defaultModelKey: null}).runnableModelKeys;
    if (!draft.defaultModelKey || !runnableModelKeys.has(draft.defaultModelKey)) {
        draft.defaultModelKey = runnableModelKeys.values().next().value ?? null;
    }
    return runnableModelKeys;
}

/**
 * 预览 Model Library 可补全项。
 * 所有持久化模型都必须完整；Provider Base URL 与缺失 API 不能由 Model Library 修复。
 */
export function previewModelLibraryRepairs(
    draft: ContractSettingsDraft,
    libraryModels: readonly ModelLibraryEntryDto[],
): ModelLibraryRepair[] {
    const libraryById = new Map(libraryModels.map((model) => [model.id, model]));
    const repairs: ModelLibraryRepair[] = [];
    const providerCounts = countIds(draft.providers.map((provider) => provider.id));
    for (const [providerIndex, provider] of draft.providers.entries()) {
        if ((providerCounts.get(provider.id.trim()) ?? 0) > 1) {
            continue;
        }
        const modelCounts = countIds(provider.models.map((model) => model.id));
        for (const [modelIndex, model] of provider.models.entries()) {
            if ((modelCounts.get(model.id.trim()) ?? 0) > 1) {
                continue;
            }
            const issues = inspectModelCapability(provider.id.trim(), modelContractInput(model));
            const libraryModel = libraryById.get(model.id.trim());
            if (issues.length === 0 || !libraryModel || !isSupportedPiApi(model.api)) {
                continue;
            }
            repairs.push({
                providerIndex,
                modelIndex,
                providerId: provider.id.trim(),
                modelId: model.id.trim(),
                source: libraryModel.source,
                previousIssueCodes: issues.map((issue) => issue.code),
                replacement: {
                    name: libraryModel.name,
                    id: model.id.trim(),
                    group: null,
                    enabled: model.enabled,
                    api: model.api,
                    reasoning: libraryModel.reasoning,
                    input: [...libraryModel.input],
                    contextWindowTokens: libraryModel.contextWindowTokens,
                    maxTokens: libraryModel.maxTokens,
                    cost: null,
                    compat: null,
                    headers: null,
                    thinkingLevelMap: libraryModel.thinkingLevelMap ? {...libraryModel.thinkingLevelMap} : null,
                },
            });
        }
    }
    return repairs;
}

/**
 * 预览缺失 Provider Model API 的确定性补全。
 * 只有 Provider 下每个已保存模型都声明同一种受支持 API 时才补全；空模型、缺失值、
 * 未知值或混合 API 都保留给用户选择，禁止根据名称、Base URL 或 Secret 猜测协议。
 */
export function previewProviderModelApiRepairs(draft: ContractSettingsDraft): ProviderModelApiRepair[] {
    const repairs: ProviderModelApiRepair[] = [];
    const providerCounts = countIds(draft.providers.map((provider) => provider.id));
    for (const [providerIndex, provider] of draft.providers.entries()) {
        if (provider.modelApi.trim() || (providerCounts.get(provider.id.trim()) ?? 0) > 1 || provider.models.length === 0) {
            continue;
        }
        const modelApis = provider.models.map((model) => model.api.trim());
        if (!modelApis.every(isSupportedPiApi)) {
            continue;
        }
        const uniqueApis = new Set<SupportedPiApi>(modelApis);
        const api = uniqueApis.size === 1 ? uniqueApis.values().next().value : undefined;
        if (api) {
            repairs.push({providerIndex, providerId: provider.id.trim(), api});
        }
    }
    return repairs;
}

export type RemovedIncompleteDisabledModel = {
    providerId: string;
    modelId: string;
    issueCodes: ProviderConfigIssue["code"][];
};

/**
 * 删除无法满足 Provider Config 合同的已停用模型。
 *
 * 该动作只由用户显式触发的一键修复调用：enabled 模型始终保留给用户编辑，
 * 能力完整的 disabled 模型也保留；只有过去借 disabled 保存的坏草稿会被移除。
 */
export function removeIncompleteDisabledModels(draft: ContractSettingsDraft): RemovedIncompleteDisabledModel[] {
    const removed: RemovedIncompleteDisabledModel[] = [];
    for (const provider of draft.providers) {
        provider.models = provider.models.filter((model) => {
            if (model.enabled) {
                return true;
            }
            const issues = inspectModelCapability(provider.id.trim(), modelContractInput(model));
            if (issues.length === 0) {
                return true;
            }
            removed.push({
                providerId: provider.id.trim(),
                modelId: model.id.trim(),
                issueCodes: issues.map((issue) => issue.code),
            });
            return false;
        });
    }
    return removed;
}

function providerContractInput(provider: ContractProviderDraft): ProviderConfigInput {
    return {
        id: provider.id.trim(),
        enabled: provider.enabled,
        modelApi: provider.modelApi.trim() || null,
        options: {baseURL: provider.options.baseURL.trim()},
        models: provider.models.map(modelContractInput),
    };
}

function parsePositiveInteger(value: string): number | null {
    const normalized = value.trim();
    if (!normalized) {
        return null;
    }
    const parsed = Number(normalized);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseInput(value: string): ModelInputKind[] | null {
    const input = [...new Set(value.split(",")
        .map((item) => item.trim())
        .filter((item): item is ModelInputKind => item === "text" || item === "image"))];
    return input.length > 0 ? input : null;
}

function parseJsonObject(value: string, label: string): Record<string, unknown> | null {
    const normalized = value.trim();
    if (!normalized) {
        return null;
    }
    try {
        const parsed: unknown = JSON.parse(normalized);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("必须是 JSON 对象");
        }
        // JSON.parse 的外部输入必须先作为 unknown 检查，再收窄为普通对象。
        return parsed as Record<string, unknown>;
    } catch (error) {
        throw new Error(`${label} JSON 无效：${error instanceof Error ? error.message : String(error)}`);
    }
}

function secretPayload(provider: ModelSettingsProviderDraft): SecretConfigValueDto {
    return {
        configured: provider.options.apiKeyConfigured,
        maskedValue: provider.options.apiKeyMaskedValue,
        ...(provider.options.apiKeyCleared ? {value: ""} : {}),
        ...(!provider.options.apiKeyCleared && provider.options.apiKey.trim() ? {value: provider.options.apiKey.trim()} : {}),
    };
}

function omitInvalidModelKey<T extends {modelKey?: string | null}>(value: T, modelKeys: ReadonlySet<string>): T {
    const cleanedModelKey = cleanModelKey(value.modelKey, modelKeys);
    if (cleanedModelKey) {
        return {...value, modelKey: cleanedModelKey};
    }
    const {modelKey: _modelKey, ...withoutModelKey} = value;
    return withoutModelKey as T;
}

function countIds(values: string[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const value of values) {
        const id = value.trim();
        counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
}
