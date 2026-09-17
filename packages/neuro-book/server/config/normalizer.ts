import {mergeEditorAssociations} from "nbook/shared/editor-associations";
import {
    DEFAULT_MARKDOWN_EDITOR_PREFERENCES,
    DEFAULT_MONACO_EDITOR_PREFERENCES,
    type MarkdownEditorPreferences,
    type MonacoEditorPreferences,
} from "nbook/shared/editor-workbench";
import type {
    AgentProfileConfig,
    AgentProfileModelConfig,
    AgentProfileSettingsConfig,
    AgentVisibleModelConfig,
    ConfiguredModelConfig,
    ConfiguredProviderConfig,
    EffectiveConfig,
    ModelProviderOptionsConfig,
    ModelSettingsConfig,
    EmbeddingModelConfig,
    EmbeddingServiceConfig,
    StoredGlobalConfig,
    StoredAgentProfileConfig,
    StoredProjectConfig,
    StoredProviderConfig,
    StoredWebSettingsConfig,
    WebSearchProviderKey,
    WebSettingsConfig,
    ObservabilityConfig,
    PiTraceConfig,
    WorkspaceHistorySettingsConfig,
} from "nbook/server/config/types";
import type {JsonValue} from "nbook/server/agent/messages/types";
import {ThinkingLevelSchema} from "nbook/shared/dto/app-settings.dto";
import {
    EditorConfigPatchDtoSchema,
    ProfileCompactionRuntimePatchDtoSchema,
    ProfileFileChangeNoticeRuntimePatchDtoSchema,
    ProfileSummarizerRuntimePatchDtoSchema,
} from "nbook/shared/dto/config.dto";
import {
    DEFAULT_PRODUCT_APPEARANCE,
    DEFAULT_PRODUCT_THEME_ID,
    productAppearances,
    productThemeIds,
    type ProductAppearance,
    type ProductThemeId,
} from "nbook/shared/theme/theme-axes";
import {COLORWAY_ID_PATTERN, MAX_COLORWAY_ID_LENGTH, MAX_USER_COLORWAY_LABEL_LENGTH, MAX_USER_COLORWAYS, sanitizeColorwayVars, USER_COLORWAY_ID_PATTERN} from "nbook/shared/theme/user-colorway";
import type {UserColorwayDto} from "nbook/shared/dto/config.dto";
import {mergeProfileRuntimePatches} from "nbook/server/agent/profiles/profile-runtime-settings";
import type {ProfileRuntimeSettingsPatch} from "nbook/shared/agent/profile-runtime-settings";

const DEFAULT_COST_CURRENCY: EffectiveConfig["ui"]["costCurrency"] = "USD";
/** 白名单查表：清单外的取值（老体系 id / 打错的值）一律读作无效。 */
const productThemeIdLookup: Record<string, true> = Object.fromEntries(productThemeIds.map((id) => [id, true]));
const productAppearanceLookup: Record<string, true> = Object.fromEntries(productAppearances.map((appearance) => [appearance, true]));
const DEFAULT_AGENT_PROFILE_MODEL_DEFAULTS: AgentProfileModelConfig = {
    modelKey: null,
    temperature: null,
    topK: null,
    reasoningEffort: "off",
    stream: true,
};
const DEFAULT_EMBEDDING_SERVICE: EmbeddingServiceConfig = {
    enabled: false,
    provider: "openai-compatible",
    model: null,
    dimensions: null,
    apiKey: "",
    baseURL: "",
    timeoutMs: 30_000,
    requestOptions: {},
};
const DEFAULT_WEB_SETTINGS: WebSettingsConfig = {
    search: {
        order: ["tavily", "brave"],
        providers: {
            tavily: {
                enabled: false,
                apiKey: "",
                timeoutMs: 15_000,
            },
            brave: {
                enabled: false,
                apiKey: "",
                country: "US",
                searchLang: "en",
                timeoutMs: 15_000,
            },
        },
    },
    fetch: {
        local: {
            enabled: true,
            timeoutMs: 15_000,
            maxRedirects: 5,
            maxBytes: 2_000_000,
            maxCharacters: 20_000,
            minCharactersForLocal: 300,
        },
        tavilyFallback: {
            enabled: false,
            timeoutMs: 20_000,
        },
    },
};

const DEFAULT_PI_TRACE: PiTraceConfig = {
    enabled: true,
    maxRecords: 100,
    capturePayload: true,
};

/**
 * 归一化可观测配置：从存储层 partial 覆盖默认值，带类型守卫。
 */
function normalizeObservability(input: StoredGlobalConfig["observability"]): ObservabilityConfig {
    const raw = input?.piTrace && typeof input.piTrace === "object" ? input.piTrace : {};
    return {
        piTrace: {
            enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_PI_TRACE.enabled,
            maxRecords: typeof raw.maxRecords === "number" && Number.isInteger(raw.maxRecords) && raw.maxRecords >= 0 ? raw.maxRecords : DEFAULT_PI_TRACE.maxRecords,
            capturePayload: typeof raw.capturePayload === "boolean" ? raw.capturePayload : DEFAULT_PI_TRACE.capturePayload,
        },
    };
}

const DEFAULT_WORKSPACE_HISTORY: WorkspaceHistorySettingsConfig = {
    enabled: true,
    retentionFullDays: 90,
    keepDailyLastAfterWindow: true,
    autoAcceptEnabled: true,
    autoAcceptDays: 14,
};

/**
 * 归一化文件历史的 Project 可覆盖字段（retention / auto-accept 四项），非法值丢弃不参与遮蔽。
 * 结构性不输出 enabled——Project 覆盖走本函数即天然剥掉总开关。
 */
function normalizeWorkspaceHistoryPatch(input: Partial<WorkspaceHistorySettingsConfig> | undefined): Partial<Omit<WorkspaceHistorySettingsConfig, "enabled">> {
    if (!input || typeof input !== "object") {
        return {};
    }
    const patch: Partial<Omit<WorkspaceHistorySettingsConfig, "enabled">> = {};
    if (typeof input.retentionFullDays === "number" && Number.isInteger(input.retentionFullDays) && input.retentionFullDays >= 1) {
        patch.retentionFullDays = input.retentionFullDays;
    }
    if (typeof input.keepDailyLastAfterWindow === "boolean") {
        patch.keepDailyLastAfterWindow = input.keepDailyLastAfterWindow;
    }
    if (typeof input.autoAcceptEnabled === "boolean") {
        patch.autoAcceptEnabled = input.autoAcceptEnabled;
    }
    if (typeof input.autoAcceptDays === "number" && Number.isInteger(input.autoAcceptDays) && input.autoAcceptDays >= 1) {
        patch.autoAcceptDays = input.autoAcceptDays;
    }
    return patch;
}

/**
 * 归一化 Global 的文件历史配置：默认值兜底 + enabled 总开关（仅 Global 持有）。
 */
function normalizeWorkspaceHistory(input: Partial<WorkspaceHistorySettingsConfig> | undefined): WorkspaceHistorySettingsConfig {
    return {
        ...DEFAULT_WORKSPACE_HISTORY,
        ...normalizeWorkspaceHistoryPatch(input),
        enabled: typeof input?.enabled === "boolean" ? input.enabled : DEFAULT_WORKSPACE_HISTORY.enabled,
    };
}

/**
 * 创建完整的默认 effective config。
 */
export function createDefaultEffectiveConfig(): EffectiveConfig {
    return {
        models: {
            defaultModelKey: null,
            providers: {},
        },
        embedding: {...DEFAULT_EMBEDDING_SERVICE},
        agent: {
            defaultProfileKey: {
                novel: null,
                userAssets: null,
            },
            profileModelDefaults: {...DEFAULT_AGENT_PROFILE_MODEL_DEFAULTS},
            profileRuntimeDefaults: {},
            profiles: {},
            visibleModels: [],
        },
        ui: {
            themeId: DEFAULT_PRODUCT_THEME_ID,
            appearance: DEFAULT_PRODUCT_APPEARANCE,
            colorwayId: "",
            userColorways: [],
            costCurrency: DEFAULT_COST_CURRENCY,
        },
        editor: {
            markdown: {...DEFAULT_MARKDOWN_EDITOR_PREFERENCES},
            monaco: {...DEFAULT_MONACO_EDITOR_PREFERENCES},
            ...mergeEditorAssociations(undefined),
        },
        web: normalizeWebSettings(undefined),
        observability: normalizeObservability(undefined),
        history: normalizeWorkspaceHistory(undefined),
    };
}

/**
 * 把 Global Config 文件对象规范化，避免缺失字段泄漏到运行时。
 */
export function normalizeGlobalConfig(input: Partial<StoredGlobalConfig> | null | undefined): StoredGlobalConfig {
    const raw = input && typeof input === "object" ? input : {};
    const editor = EditorConfigPatchDtoSchema.parse(raw.editor === undefined ? {} : raw.editor);
    return {
        ...(raw.observability ? {observability: raw.observability} : {}),
        ...(raw.history ? {history: raw.history} : {}),
        models: {
            default: normalizeNullableModelKey(raw.models?.default),
            providers: normalizeStoredProviders(raw.models?.providers),
        },
        embedding: normalizeStoredEmbeddingService(raw.embedding, readLegacyEmbedding(raw.models)),
        agent: {
            defaultProfileKey: {
                novel: normalizeNullableModelKey(raw.agent?.defaultProfileKey?.novel),
                userAssets: normalizeNullableModelKey(raw.agent?.defaultProfileKey?.userAssets),
            },
            profileModelDefaults: normalizeAgentProfileModelPatch(raw.agent?.profileModelDefaults),
            profileRuntimeDefaults: normalizeProfileRuntimeSettingsPatch(raw.agent?.profileRuntimeDefaults),
            profiles: normalizeAgentProfiles(raw.agent?.profiles),
            visibleModels: normalizeAgentVisibleModels(raw.agent?.visibleModels),
        },
        ui: {
            themeId: normalizeProductThemeId(raw.ui?.themeId),
            appearance: normalizeProductAppearance(raw.ui?.appearance),
            colorwayId: normalizeColorwayId(raw.ui?.colorwayId),
            userColorways: normalizeUserColorways(raw.ui?.userColorways),
            costCurrency: normalizeCostCurrency(raw.ui?.costCurrency),
        },
        editor: {
            markdown: normalizeMarkdownPreferences(editor.markdown),
            monaco: normalizeMonacoPreferences(editor.monaco),
            associations: editor.associations ?? {},
            languageAssociations: editor.languageAssociations ?? {},
        },
        web: normalizeStoredWebSettings(raw.web),
    };
}

/**
 * 把 Project Config 文件对象规范化。这里只保留允许覆盖的字段。
 */
export function normalizeProjectConfig(input: Partial<StoredProjectConfig> | null | undefined): StoredProjectConfig {
    const raw = input && typeof input === "object" ? input : {};
    const editor = raw.editor === undefined ? undefined : EditorConfigPatchDtoSchema.parse(raw.editor);
    return {
        ...raw,
        ...(raw.models ? {
            models: {
                default: normalizeNullableModelKey(raw.models.default),
            },
        } : {}),
        ...(raw.embedding ? {
            embedding: normalizeEmbeddingModelConfig(raw.embedding),
        } : readLegacyEmbedding(raw.models) ? {
            embedding: normalizeEmbeddingModelConfig(readLegacyEmbedding(raw.models)),
        } : {}),
        ...(raw.agent ? {
            agent: {
                defaultProfileKey: normalizeNullableModelKey(raw.agent.defaultProfileKey),
                profileModelDefaults: raw.agent.profileModelDefaults ? normalizeAgentProfileModelPatch(raw.agent.profileModelDefaults) : undefined,
                profileRuntimeDefaults: raw.agent.profileRuntimeDefaults ? normalizeProfileRuntimeSettingsPatch(raw.agent.profileRuntimeDefaults) : undefined,
                profiles: raw.agent.profiles ? normalizeAgentProfiles(raw.agent.profiles) : undefined,
            },
        } : {}),
        ...(editor ? {editor} : {}),
        ...(raw.history ? {
            history: normalizeWorkspaceHistoryPatch(raw.history),
        } : {}),
    };
}

/** 规范化 agent 可见模型清单：丢弃缺 modelKey 的条目并去重（首见优先）；note 缺省为空串 */
function normalizeAgentVisibleModels(input: AgentVisibleModelConfig[] | null | undefined): AgentVisibleModelConfig[] {
    if (!Array.isArray(input)) return [];
    const seen = new Set<string>();
    const out: AgentVisibleModelConfig[] = [];
    for (const raw of input) {
        const modelKey = typeof raw?.modelKey === "string" ? raw.modelKey.trim() : "";
        if (!modelKey || seen.has(modelKey)) continue;
        seen.add(modelKey);
        out.push({modelKey, note: typeof raw.note === "string" ? raw.note.trim() : ""});
    }
    return out;
}

/**
 * 将 Global + Project 合并为业务运行使用的 effective config。
 */
export function resolveEffectiveConfig(globalConfig: StoredGlobalConfig, projectConfig: StoredProjectConfig | null): EffectiveConfig {
    const effective = createDefaultEffectiveConfig();
    const globalProfilePatches = normalizeAgentProfiles(globalConfig.agent?.profiles);

    effective.models = normalizeModelSettings(globalConfig.models);
    effective.embedding = normalizeEmbeddingService(globalConfig.embedding, readLegacyEmbedding(globalConfig.models));
    effective.agent.defaultProfileKey = {
        novel: normalizeNullableModelKey(globalConfig.agent?.defaultProfileKey?.novel),
        userAssets: normalizeNullableModelKey(globalConfig.agent?.defaultProfileKey?.userAssets),
    };
    effective.agent.profileModelDefaults = normalizeAgentProfileModelDefaults(globalConfig.agent?.profileModelDefaults);
    const globalRuntimeDefaults = normalizeProfileRuntimeSettingsPatch(globalConfig.agent?.profileRuntimeDefaults);
    effective.agent.profileRuntimeDefaults = globalRuntimeDefaults;
    effective.agent.profiles = normalizeCompleteAgentProfiles(globalProfilePatches, effective.agent.profileModelDefaults, globalRuntimeDefaults);
    effective.agent.visibleModels = normalizeAgentVisibleModels(globalConfig.agent?.visibleModels);
    effective.ui.themeId = normalizeProductThemeId(globalConfig.ui?.themeId);
    effective.ui.appearance = normalizeProductAppearance(globalConfig.ui?.appearance);
    effective.ui.colorwayId = normalizeColorwayId(globalConfig.ui?.colorwayId);
    effective.ui.userColorways = normalizeUserColorways(globalConfig.ui?.userColorways);
    effective.ui.costCurrency = normalizeCostCurrency(globalConfig.ui?.costCurrency);
    effective.editor.markdown = normalizeMarkdownPreferences(globalConfig.editor?.markdown);
    effective.editor.monaco = normalizeMonacoPreferences(globalConfig.editor?.monaco);
    Object.assign(effective.editor, mergeEditorAssociations(globalConfig.editor, projectConfig?.editor));
    effective.web = normalizeWebSettings(globalConfig.web);
    effective.observability = normalizeObservability(globalConfig.observability);
    effective.history = normalizeWorkspaceHistory(globalConfig.history);

    if (!projectConfig) {
        return effective;
    }

    if (projectConfig.models && Object.hasOwn(projectConfig.models, "default") && projectConfig.models.default !== null) {
        effective.models.defaultModelKey = normalizeNullableModelKey(projectConfig.models.default);
    }
    if (projectConfig.embedding) {
        const embedding = normalizeEmbeddingModelConfig(projectConfig.embedding);
        if (embedding.model !== null) {
            effective.embedding.model = embedding.model;
        }
        if (embedding.dimensions !== null) {
            effective.embedding.dimensions = embedding.dimensions;
        }
    }
    if (projectConfig.agent && Object.hasOwn(projectConfig.agent, "defaultProfileKey") && projectConfig.agent.defaultProfileKey !== null) {
        effective.agent.defaultProfileKey.novel = normalizeNullableModelKey(projectConfig.agent.defaultProfileKey);
    }
    if (projectConfig.agent?.profileModelDefaults) {
        effective.agent.profileModelDefaults = mergeAgentProfileModelConfig(
            effective.agent.profileModelDefaults,
            projectConfig.agent.profileModelDefaults,
        );
    }
    const projectRuntimeDefaults = normalizeProfileRuntimeSettingsPatch(projectConfig.agent?.profileRuntimeDefaults);
    effective.agent.profileRuntimeDefaults = mergeProfileRuntimePatches(globalRuntimeDefaults, projectRuntimeDefaults);
    if (projectConfig.agent?.profileModelDefaults || projectConfig.agent?.profileRuntimeDefaults || projectConfig.agent?.profiles) {
        const projectProfiles = normalizeAgentProfiles(projectConfig.agent.profiles);
        effective.agent.profiles = Object.fromEntries(
            [...new Set([...Object.keys(globalProfilePatches), ...Object.keys(projectProfiles)])]
                .map((profileKey) => {
                    return [profileKey, {
                        model: mergeAgentProfileModelConfig(
                            mergeAgentProfileModelConfig(
                                effective.agent.profileModelDefaults,
                                globalProfilePatches[profileKey]?.model,
                            ),
                            projectProfiles[profileKey]?.model,
                        ),
                        settings: mergeAgentProfileSettingsConfig(
                            globalProfilePatches[profileKey]?.settings,
                            projectProfiles[profileKey]?.settings,
                        ),
                        runtime: mergeProfileRuntimePatches(
                            globalRuntimeDefaults,
                            globalProfilePatches[profileKey]?.runtime,
                            projectRuntimeDefaults,
                            projectProfiles[profileKey]?.runtime,
                        ),
                    } satisfies AgentProfileConfig];
                }),
        );
    }
    if (projectConfig.editor?.markdown) {
        effective.editor.markdown = {
            ...effective.editor.markdown,
            ...projectConfig.editor.markdown,
        };
    }
    if (projectConfig.editor?.monaco) {
        effective.editor.monaco = {
            ...effective.editor.monaco,
            ...projectConfig.editor.monaco,
        };
    }
    if (projectConfig.history) {
        // Project 覆盖 retention / auto-accept；enabled 由 patch 归一化结构性剥离，Global 总开关不可被遮蔽。
        effective.history = {
            ...effective.history,
            ...normalizeWorkspaceHistoryPatch(projectConfig.history),
        };
    }

    return effective;
}

/**
 * 规范化 Provider 列表为运行时 Record。
 */
export function normalizeModelSettings(input: StoredGlobalConfig["models"] | undefined): ModelSettingsConfig {
    const providers = normalizeStoredProviders(input?.providers);
    const providerCounts = countIds(providers.map((provider) => provider.id));
    return {
        defaultModelKey: normalizeNullableModelKey(input?.default),
        providers: Object.fromEntries(
            providers
                .filter((provider) => (providerCounts.get(provider.id) ?? 0) === 1)
                .map((provider) => {
                    const modelCounts = countIds(provider.models.map((model) => model.id));
                    return [provider.id, {
                        name: normalizeText(provider.name) || provider.id,
                        enabled: provider.enabled ?? true,
                        modelApi: normalizeNullableText(provider.modelApi),
                        options: normalizeProviderOptions(provider.options),
                        models: Object.fromEntries(provider.models
                            .filter((model) => (modelCounts.get(model.id) ?? 0) === 1)
                            .map((model) => [model.id, normalizeModel(model)])),
                    } satisfies ConfiguredProviderConfig] as const;
                }),
        ),
    };
}

/**
 * 把运行时 ModelSettings 写回 Global Config 的数组结构。
 */
export function serializeModelSettings(config: ModelSettingsConfig): StoredGlobalConfig["models"] {
    return {
        default: config.defaultModelKey,
        providers: Object.entries(config.providers)
            .map(([providerId, provider]) => ({
                id: providerId,
                name: provider.name,
                enabled: provider.enabled,
                modelApi: provider.modelApi,
                options: provider.options,
                models: Object.values(provider.models)
                    .map((model) => ({...model}))
                    .sort((left, right) => left.id.localeCompare(right.id)),
            }))
            .sort((left, right) => left.id.localeCompare(right.id)),
    };
}

/**
 * 规范化 profile 模型配置。
 */
export function normalizeAgentProfileModelConfig(input: Partial<AgentProfileModelConfig> | undefined): AgentProfileModelConfig {
    const patch = normalizeAgentProfileModelPatch(input);
    return {
        modelKey: Object.hasOwn(patch, "modelKey") ? patch.modelKey ?? DEFAULT_AGENT_PROFILE_MODEL_DEFAULTS.modelKey : DEFAULT_AGENT_PROFILE_MODEL_DEFAULTS.modelKey,
        temperature: Object.hasOwn(patch, "temperature") ? patch.temperature ?? DEFAULT_AGENT_PROFILE_MODEL_DEFAULTS.temperature : DEFAULT_AGENT_PROFILE_MODEL_DEFAULTS.temperature,
        topK: Object.hasOwn(patch, "topK") ? patch.topK ?? DEFAULT_AGENT_PROFILE_MODEL_DEFAULTS.topK : DEFAULT_AGENT_PROFILE_MODEL_DEFAULTS.topK,
        reasoningEffort: Object.hasOwn(patch, "reasoningEffort") ? patch.reasoningEffort ?? DEFAULT_AGENT_PROFILE_MODEL_DEFAULTS.reasoningEffort : DEFAULT_AGENT_PROFILE_MODEL_DEFAULTS.reasoningEffort,
        stream: Object.hasOwn(patch, "stream") ? patch.stream ?? DEFAULT_AGENT_PROFILE_MODEL_DEFAULTS.stream : DEFAULT_AGENT_PROFILE_MODEL_DEFAULTS.stream,
    };
}

/**
 * 规范化所有 Agent Profile 共同继承的默认模型参数。
 */
export function normalizeAgentProfileModelDefaults(input: Partial<AgentProfileModelConfig> | undefined): AgentProfileModelConfig {
    return normalizeAgentProfileModelConfig({
        ...DEFAULT_AGENT_PROFILE_MODEL_DEFAULTS,
        ...(input ?? {}),
    });
}

/**
 * 规范化 profile 配置 map。
 */
export function normalizeAgentProfiles(input: Record<string, Partial<StoredAgentProfileConfig>> | undefined): Record<string, StoredAgentProfileConfig> {
    if (!input) {
        return {};
    }
    const entries: Array<readonly [string, StoredAgentProfileConfig]> = [];
    for (const [profileKey, profile] of Object.entries(input)) {
        const key = normalizeText(profileKey);
        if (!key) {
            continue;
        }
        entries.push([key, {
            model: normalizeAgentProfileModelPatch(profile.model),
            settings: normalizeAgentProfileSettings(profile.settings),
            runtime: normalizeProfileRuntimeSettingsPatch(profile.runtime),
        }]);
    }
    return Object.fromEntries(entries.sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey)));
}

function normalizeCompleteAgentProfiles(
    input: Record<string, StoredAgentProfileConfig> | undefined,
    defaults: AgentProfileModelConfig,
    runtimeDefaults: ProfileRuntimeSettingsPatch,
): Record<string, AgentProfileConfig> {
    return Object.fromEntries(
        Object.entries(input ?? {}).map(([profileKey, profile]) => [profileKey, {
            model: mergeAgentProfileModelConfig(defaults, profile.model),
            settings: normalizeAgentProfileSettings(profile.settings),
            runtime: mergeProfileRuntimePatches(runtimeDefaults, profile.runtime),
        } satisfies AgentProfileConfig]),
    );
}

function mergeAgentProfileModelConfig(
    base: AgentProfileModelConfig,
    patchInput: Partial<AgentProfileModelConfig> | undefined,
): AgentProfileModelConfig {
    const patch = normalizeAgentProfileModelPatch(patchInput);
    return {
        modelKey: Object.hasOwn(patch, "modelKey") ? patch.modelKey ?? base.modelKey : base.modelKey,
        temperature: Object.hasOwn(patch, "temperature") ? patch.temperature ?? base.temperature : base.temperature,
        topK: Object.hasOwn(patch, "topK") ? patch.topK ?? base.topK : base.topK,
        reasoningEffort: Object.hasOwn(patch, "reasoningEffort") ? patch.reasoningEffort ?? base.reasoningEffort : base.reasoningEffort,
        stream: Object.hasOwn(patch, "stream") && typeof patch.stream === "boolean" ? patch.stream : base.stream,
    };
}

function normalizeAgentProfileModelPatch(input: Partial<AgentProfileModelConfig> | undefined): Partial<AgentProfileModelConfig> {
    if (!input) {
        return {};
    }
    return {
        ...(Object.hasOwn(input, "modelKey") ? {modelKey: normalizeNullableModelKey(input.modelKey)} : {}),
        ...(Object.hasOwn(input, "temperature") ? {temperature: normalizeNullableNumber(input.temperature)} : {}),
        ...(Object.hasOwn(input, "topK") ? {topK: normalizeNullableInteger(input.topK)} : {}),
        ...(Object.hasOwn(input, "reasoningEffort") ? {reasoningEffort: normalizeThinkingLevel(input.reasoningEffort)} : {}),
        ...(Object.hasOwn(input, "stream") && typeof input.stream === "boolean" ? {stream: input.stream} : {}),
    };
}

/**
 * 规范化 profile settings patch。
 */
export function normalizeAgentProfileSettings(input: unknown): AgentProfileSettingsConfig {
    return normalizeJsonRecord(input);
}

/** 逐子策略规范化通用运行配置，单个非法分组不会遮蔽其他合法分组。 */
export function normalizeProfileRuntimeSettingsPatch(input: unknown): ProfileRuntimeSettingsPatch {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        return {};
    }
    const record = input as Record<string, unknown>;
    const summarizer = ProfileSummarizerRuntimePatchDtoSchema.safeParse(record.summarizer);
    const compaction = ProfileCompactionRuntimePatchDtoSchema.safeParse(record.compaction);
    const fileChangeNotice = ProfileFileChangeNoticeRuntimePatchDtoSchema.safeParse(record.fileChangeNotice);
    return {
        ...(summarizer.success && Object.keys(summarizer.data).length > 0 ? {summarizer: summarizer.data} : {}),
        ...(compaction.success && Object.keys(compaction.data).length > 0 ? {compaction: compaction.data} : {}),
        ...(fileChangeNotice.success && Object.keys(fileChangeNotice.data).length > 0 ? {fileChangeNotice: fileChangeNotice.data} : {}),
    };
}

/**
 * 合并 profile settings patch。当前第一版只做浅合并。
 */
export function mergeAgentProfileSettingsConfig(
    base: AgentProfileSettingsConfig | undefined,
    patchInput: AgentProfileSettingsConfig | undefined,
): AgentProfileSettingsConfig {
    return {
        ...normalizeAgentProfileSettings(base),
        ...normalizeAgentProfileSettings(patchInput),
    };
}

function normalizeThinkingLevel(value: unknown): AgentProfileModelConfig["reasoningEffort"] {
    const parsed = ThinkingLevelSchema.nullable().safeParse(value ?? null);
    return parsed.success ? parsed.data : null;
}

function normalizeStoredProviders(input: StoredProviderConfig[] | undefined): StoredProviderConfig[] {
    if (!Array.isArray(input)) {
        return [];
    }
    return input
        .map((provider) => ({
            id: normalizeText(provider.id),
            name: normalizeText(provider.name),
            enabled: provider.enabled ?? true,
            modelApi: normalizeNullableText(provider.modelApi),
            options: normalizeProviderOptions(provider.options),
            models: Array.isArray(provider.models) ? provider.models.map(normalizeModel) : [],
        }))
        .filter((provider) => provider.id)
        .sort((left, right) => left.id.localeCompare(right.id));
}

/** 统计原始数组身份，runtime Record 化时跳过所有重复组而不是后项覆盖前项。 */
function countIds(values: string[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const value of values) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return counts;
}

function normalizeModel(input: Partial<ConfiguredModelConfig>): ConfiguredModelConfig {
    const id = normalizeText(input.id);
    return {
        name: normalizeText(input.name) || id,
        id,
        group: normalizeNullableText(input.group),
        enabled: input.enabled ?? true,
        api: normalizeNullableText(input.api),
        reasoning: typeof input.reasoning === "boolean" ? input.reasoning : null,
        input: normalizeModelInput(input.input),
        maxTokens: normalizeNullablePositiveInteger(input.maxTokens),
        cost: normalizeModelCost(input.cost),
        compat: normalizeNullableJsonRecord(input.compat),
        headers: normalizeNullableStringRecord(input.headers),
        thinkingLevelMap: normalizeNullableStringRecord(input.thinkingLevelMap),
        contextWindowTokens: normalizeNullablePositiveInteger(input.contextWindowTokens),
    };
}

function normalizeProviderOptions(input: Partial<ModelProviderOptionsConfig> | undefined): ModelProviderOptionsConfig {
    return {
        apiKey: normalizeText(input?.apiKey),
        baseURL: normalizeText(input?.baseURL),
        proxy: normalizeText(input?.proxy),
        timeoutMs: normalizeNullableInteger(input?.timeoutMs),
        requestOptions: normalizeJsonRecord(input?.requestOptions),
    };
}

function normalizeMarkdownPreferences(input: Partial<MarkdownEditorPreferences> | undefined): MarkdownEditorPreferences {
    return {
        ...DEFAULT_MARKDOWN_EDITOR_PREFERENCES,
        ...(input ?? {}),
    };
}

function normalizeMonacoPreferences(input: Partial<MonacoEditorPreferences> | undefined): MonacoEditorPreferences {
    return {
        ...DEFAULT_MONACO_EDITOR_PREFERENCES,
        ...(input ?? {}),
    };
}

function normalizeProductThemeId(input: unknown): ProductThemeId {
    const themeId = normalizeText(input);
    return Object.hasOwn(productThemeIdLookup, themeId) ? themeId as ProductThemeId : DEFAULT_PRODUCT_THEME_ID;
}

function normalizeProductAppearance(input: unknown): ProductAppearance {
    const appearance = normalizeText(input);
    return Object.hasOwn(productAppearanceLookup, appearance) ? appearance as ProductAppearance : DEFAULT_PRODUCT_APPEARANCE;
}

/**
 * 当前配色 id。
 *
 * 只校验**形状**，不校验存在性：主题自带配色由主题包给出，而主题包 `import "./vars.css"`，
 * Node 侧装不进它们（同 `shared/theme/theme-axes.ts` 里把主题 id 放进 shared 的理由）。
 * 于是不认识的 id 一律原样保留，由客户端在应用时回答「这套配色在不在」——
 * 答不上来就回落主题默认配色，不报错、不清用户的配置（见 app/utils/theme/theme-session.ts）。
 */
function normalizeColorwayId(input: unknown): string {
    const colorwayId = normalizeText(input);
    if (colorwayId.length > MAX_COLORWAY_ID_LENGTH) {
        return "";
    }
    return COLORWAY_ID_PATTERN.test(colorwayId) ? colorwayId : "";
}

/**
 * 用户自定义配色库。
 *
 * 丢掉的只有「形状坏了」的项：id / 展示名 / 明暗不合法、变量名不在 `--kebab-case` 形状里、
 * 取值过不了结构底线（长度 / 控制字符 / `;{}`）。同 id 首见优先，条数封顶。
 * 具体变量白名单与颜色合法性是客户端的事，这里**不假装能判定**——服务端没有 CSS。
 */
function normalizeUserColorways(input: unknown): UserColorwayDto[] {
    if (!Array.isArray(input)) {
        return [];
    }
    const seen = new Set<string>();
    const out: UserColorwayDto[] = [];
    for (const entry of input) {
        if (out.length >= MAX_USER_COLORWAYS) {
            break;
        }
        if (!entry || typeof entry !== "object") {
            continue;
        }
        const candidate = entry as Partial<UserColorwayDto>;
        const id = normalizeText(candidate.id);
        const label = normalizeText(candidate.label).slice(0, MAX_USER_COLORWAY_LABEL_LENGTH);
        const appearance = normalizeText(candidate.appearance);
        if (!USER_COLORWAY_ID_PATTERN.test(id) || !label || !Object.hasOwn(productAppearanceLookup, appearance) || seen.has(id)) {
            continue;
        }
        seen.add(id);
        out.push({
            id,
            label,
            appearance: appearance as ProductAppearance,
            vars: sanitizeColorwayVars(candidate.vars),
        });
    }
    return out;
}

function normalizeCostCurrency(input: unknown): EffectiveConfig["ui"]["costCurrency"] {
    return input === "CNY" ? "CNY" : DEFAULT_COST_CURRENCY;
}

function normalizeText(input: unknown): string {
    return typeof input === "string" ? input.trim() : "";
}

function normalizeNullableText(input: unknown): string | null {
    const text = normalizeText(input);
    return text || null;
}

function normalizeNullableModelKey(input: unknown): string | null {
    return normalizeNullableText(input);
}

function normalizeNullableNumber(input: unknown): number | null {
    return typeof input === "number" && Number.isFinite(input) ? input : null;
}

function normalizeNullableInteger(input: unknown): number | null {
    const value = normalizeNullableNumber(input);
    return value === null ? null : Math.trunc(value);
}

function normalizeNullablePositiveInteger(input: unknown): number | null {
    const value = normalizeNullableInteger(input);
    return value !== null && value > 0 ? value : null;
}

function normalizeJsonRecord(input: unknown): Record<string, JsonValue> {
    return input && typeof input === "object" && !Array.isArray(input)
        ? input as Record<string, JsonValue>
        : {};
}

function normalizeNullableJsonRecord(input: unknown): Record<string, JsonValue> | null {
    const record = normalizeJsonRecord(input);
    return Object.keys(record).length > 0 ? record : null;
}

function normalizeModelInput(input: unknown): ConfiguredModelConfig["input"] {
    if (!Array.isArray(input)) {
        return null;
    }
    const values = [...new Set(input.filter((item): item is NonNullable<ConfiguredModelConfig["input"]>[number] => item === "text" || item === "image"))];
    return values.length > 0 ? values : null;
}

export function normalizeEmbeddingService(
    input: Partial<EmbeddingServiceConfig> | undefined,
    legacyInput?: unknown,
): EmbeddingServiceConfig {
    const legacy = normalizeEmbeddingModelConfig(legacyInput);
    const record = input && typeof input === "object" && !Array.isArray(input)
        ? input as Record<string, unknown>
        : {};
    const model = normalizeNullableText(record.model) ?? legacy.model;
    const dimensions = normalizeNullablePositiveInteger(record.dimensions) ?? legacy.dimensions;
    return {
        enabled: typeof record.enabled === "boolean" ? record.enabled : Boolean(model && dimensions),
        provider: record.provider === "openai-compatible" ? "openai-compatible" : DEFAULT_EMBEDDING_SERVICE.provider,
        model,
        dimensions,
        apiKey: normalizeText(record.apiKey),
        baseURL: normalizeText(record.baseURL),
        timeoutMs: normalizeNullablePositiveInteger(record.timeoutMs) ?? DEFAULT_EMBEDDING_SERVICE.timeoutMs,
        requestOptions: normalizeJsonRecord(record.requestOptions),
    };
}

export function normalizeEmbeddingModelConfig(input: unknown): EmbeddingModelConfig {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        return {model: null, dimensions: null};
    }
    const record = input as Record<string, unknown>;
    const legacyModelKey = normalizeNullableModelKey(record.modelKey);
    const legacyModel = legacyModelKey?.includes("/")
        ? legacyModelKey.slice(legacyModelKey.indexOf("/") + 1)
        : legacyModelKey;
    return {
        model: normalizeNullableText(record.model) ?? legacyModel,
        dimensions: normalizeNullablePositiveInteger(record.dimensions),
    };
}

function normalizeStoredEmbeddingService(
    input: Partial<EmbeddingServiceConfig> | undefined,
    legacyInput?: unknown,
): EmbeddingServiceConfig {
    return normalizeEmbeddingService(input, legacyInput);
}

function readLegacyEmbedding(models: StoredGlobalConfig["models"] | StoredProjectConfig["models"] | undefined): unknown {
    if (!models || typeof models !== "object" || Array.isArray(models)) {
        return undefined;
    }
    const record = models as Record<string, unknown>;
    return record.embedding;
}

/**
 * 规范化 Global Web 配置，运行时只消费这个 complete shape。
 */
export function normalizeWebSettings(input: StoredWebSettingsConfig | undefined): WebSettingsConfig {
    const raw = input ?? {};
    const defaults = DEFAULT_WEB_SETTINGS;
    return {
        search: {
            order: normalizeProviderOrder(raw.search?.order),
            providers: {
                tavily: {
                    enabled: raw.search?.providers?.tavily?.enabled ?? defaults.search.providers.tavily.enabled,
                    apiKey: normalizeText(raw.search?.providers?.tavily?.apiKey),
                    timeoutMs: normalizeNullablePositiveInteger(raw.search?.providers?.tavily?.timeoutMs) ?? defaults.search.providers.tavily.timeoutMs,
                },
                brave: {
                    enabled: raw.search?.providers?.brave?.enabled ?? defaults.search.providers.brave.enabled,
                    apiKey: normalizeText(raw.search?.providers?.brave?.apiKey),
                    country: normalizeCountry(raw.search?.providers?.brave?.country),
                    searchLang: normalizeSearchLang(raw.search?.providers?.brave?.searchLang),
                    timeoutMs: normalizeNullablePositiveInteger(raw.search?.providers?.brave?.timeoutMs) ?? defaults.search.providers.brave.timeoutMs,
                },
            },
        },
        fetch: {
            local: {
                enabled: raw.fetch?.local?.enabled ?? defaults.fetch.local.enabled,
                timeoutMs: normalizePositiveInteger(raw.fetch?.local?.timeoutMs, defaults.fetch.local.timeoutMs),
                maxRedirects: normalizeNonNegativeInteger(raw.fetch?.local?.maxRedirects, defaults.fetch.local.maxRedirects),
                maxBytes: normalizePositiveInteger(raw.fetch?.local?.maxBytes, defaults.fetch.local.maxBytes),
                maxCharacters: normalizePositiveInteger(raw.fetch?.local?.maxCharacters, defaults.fetch.local.maxCharacters),
                minCharactersForLocal: normalizeNonNegativeInteger(raw.fetch?.local?.minCharactersForLocal, defaults.fetch.local.minCharactersForLocal),
            },
            tavilyFallback: {
                enabled: raw.fetch?.tavilyFallback?.enabled ?? defaults.fetch.tavilyFallback.enabled,
                timeoutMs: normalizeNullablePositiveInteger(raw.fetch?.tavilyFallback?.timeoutMs) ?? defaults.fetch.tavilyFallback.timeoutMs,
            },
        },
    };
}

function normalizeStoredWebSettings(input: StoredWebSettingsConfig | undefined): StoredWebSettingsConfig {
    return normalizeWebSettings(input);
}

function normalizeProviderOrder(input: unknown): WebSearchProviderKey[] {
    const allowed: WebSearchProviderKey[] = ["tavily", "brave"];
    if (!Array.isArray(input)) {
        return [...DEFAULT_WEB_SETTINGS.search.order];
    }
    const order = input.filter((value): value is WebSearchProviderKey => allowed.includes(value as WebSearchProviderKey));
    return [...new Set(order)].length > 0 ? [...new Set(order)] : [...DEFAULT_WEB_SETTINGS.search.order];
}

function normalizeCountry(input: unknown): string {
    const country = normalizeText(input).toUpperCase();
    return /^[A-Z]{2}$/u.test(country) ? country : DEFAULT_WEB_SETTINGS.search.providers.brave.country;
}

function normalizeSearchLang(input: unknown): string {
    const lang = normalizeText(input).toLowerCase();
    return /^[a-z]{2}(?:-[a-z]{2})?$/u.test(lang) ? lang : DEFAULT_WEB_SETTINGS.search.providers.brave.searchLang;
}

function normalizePositiveInteger(input: unknown, fallback: number): number {
    const value = normalizeNullablePositiveInteger(input);
    return value ?? fallback;
}

function normalizeNonNegativeInteger(input: unknown, fallback: number): number {
    const value = normalizeNullableInteger(input);
    return value !== null && value >= 0 ? value : fallback;
}

function normalizeModelCost(input: unknown): ConfiguredModelConfig["cost"] {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        return null;
    }
    const cost = input as Record<string, unknown>;
    const normalized = {
        input: normalizeFiniteNumber(cost.input),
        output: normalizeFiniteNumber(cost.output),
        cacheRead: normalizeFiniteNumber(cost.cacheRead),
        cacheWrite: normalizeFiniteNumber(cost.cacheWrite),
        tiers: normalizeModelCostTiers(cost.tiers),
    };
    return normalized;
}

function normalizeNullableStringRecord(input: unknown): Record<string, string | null> | null {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        return null;
    }
    const record = Object.fromEntries(Object.entries(input).flatMap(([key, value]) => typeof value === "string" || value === null ? [[key, value]] : []));
    return Object.keys(record).length ? record : null;
}

function normalizeFiniteNumber(input: unknown): number {
    return typeof input === "number" && Number.isFinite(input) && input >= 0 ? input : 0;
}

/**
 * 规范化 Pi request-wide 价格 tier；重复 threshold 保留最后一项，并按 threshold 升序保存。
 */
function normalizeModelCostTiers(input: unknown): NonNullable<ConfiguredModelConfig["cost"]>["tiers"] {
    if (!Array.isArray(input)) {
        return [];
    }
    const byThreshold = new Map<number, NonNullable<ConfiguredModelConfig["cost"]>["tiers"][number]>();
    for (const item of input) {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
            continue;
        }
        const tier = item as Record<string, unknown>;
        const threshold = typeof tier.inputTokensAbove === "number"
            && Number.isInteger(tier.inputTokensAbove)
            && tier.inputTokensAbove >= 0
            ? tier.inputTokensAbove
            : null;
        if (threshold === null) {
            continue;
        }
        byThreshold.set(threshold, {
            inputTokensAbove: threshold,
            input: normalizeFiniteNumber(tier.input),
            output: normalizeFiniteNumber(tier.output),
            cacheRead: normalizeFiniteNumber(tier.cacheRead),
            cacheWrite: normalizeFiniteNumber(tier.cacheWrite),
        });
    }
    return [...byThreshold.values()].sort((left, right) => left.inputTokensAbove - right.inputTokensAbove);
}
