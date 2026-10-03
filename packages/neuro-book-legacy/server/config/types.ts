import type {JsonValue} from "nbook/server/agent/messages/types";
import type {MarkdownEditorPreferences, MonacoEditorPreferences} from "nbook/shared/editor-workbench";
import type {ThinkingLevelDto} from "nbook/shared/dto/app-settings.dto";
import type {ModelInputKind} from "nbook/shared/dto/app-settings.dto";
import type {ProductAppearance, ProductThemeId} from "nbook/shared/theme/theme-axes";
import type {UserColorwayDto} from "nbook/shared/dto/config.dto";
import type {ProfileRuntimeSettingsPatch} from "nbook/shared/agent/profile-runtime-settings";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";

export type ConfigScope = "boot" | "global" | "global-workspace";
export type ConfigEffect = "hot" | "next-run" | "next-session" | "restart-required";
export type ConfigMerge = "replace" | "deep-merge";

export type ConfigItemMeta = {
    key: string;
    scope: ConfigScope;
    effect: ConfigEffect;
    merge: ConfigMerge;
    secret: boolean;
    description: string;
};

export type AgentProfileModelConfig = {
    modelKey: string | null;
    temperature: number | null;
    topK: number | null;
    reasoningEffort: ThinkingLevelDto | null;
    stream: boolean;
};

export type AgentProfileSettingsConfig = {
    [key: string]: JsonValue;
};

export type AgentProfileConfig = {
    model: AgentProfileModelConfig;
    settings: AgentProfileSettingsConfig;
    runtime?: ProfileRuntimeSettingsPatch;
};

export type StoredAgentProfileConfig = {
    model: Partial<AgentProfileModelConfig>;
    settings?: AgentProfileSettingsConfig;
    runtime?: ProfileRuntimeSettingsPatch;
};

export type StoredAgentProfileModelDefaultsConfig = Partial<AgentProfileModelConfig>;

/** agent 可见模型清单条目：modelKey = "provider-id/model-id"；note 是给 agent 看的一句用途描述 */
export type AgentVisibleModelConfig = {
    modelKey: string;
    note: string;
};

export type ConfiguredModelConfig = {
    name: string;
    id: string;
    group: string | null;
    enabled: boolean;
    api: string | null;
    reasoning: boolean | null;
    input: ModelInputKind[] | null;
    maxTokens: number | null;
    cost: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
        tiers: Array<{
            inputTokensAbove: number;
            input: number;
            output: number;
            cacheRead: number;
            cacheWrite: number;
        }>;
    } | null;
    compat: Record<string, JsonValue> | null;
    headers: Record<string, string | null> | null;
    thinkingLevelMap: Record<string, string | null> | null;
    contextWindowTokens: number | null;
};

export type ModelProviderOptionsConfig = {
    apiKey: string;
    baseURL: string;
    proxy: string;
    timeoutMs: number | null;
    requestOptions: Record<string, JsonValue>;
};

export type ConfiguredProviderConfig = {
    name: string;
    enabled: boolean;
    /** 创建、发现和手动添加候选时使用；runtime 始终读取最终 model.api。 */
    modelApi: string | null;
    options: ModelProviderOptionsConfig;
    models: Record<string, ConfiguredModelConfig>;
};

export type ModelSettingsConfig = {
    defaultModelKey: string | null;
    providers: Record<string, ConfiguredProviderConfig>;
};

export type EmbeddingModelConfig = {
    model: string | null;
    dimensions: number | null;
};

export type EmbeddingServiceProvider = "openai-compatible";

export type EmbeddingServiceConfig = EmbeddingModelConfig & {
    enabled: boolean;
    provider: EmbeddingServiceProvider;
    apiKey: string;
    baseURL: string;
    timeoutMs: number | null;
    requestOptions: Record<string, JsonValue>;
};

export type WebSearchProviderKey = "tavily" | "brave";

export type WebProviderSecretConfig = {
    enabled: boolean;
    apiKey: string;
    timeoutMs: number | null;
};

export type BraveSearchProviderConfig = WebProviderSecretConfig & {
    country: string;
    searchLang: string;
};

export type TavilySearchProviderConfig = WebProviderSecretConfig;

export type WebSettingsConfig = {
    search: {
        order: WebSearchProviderKey[];
        providers: {
            tavily: TavilySearchProviderConfig;
            brave: BraveSearchProviderConfig;
        };
    };
    fetch: {
        local: {
            enabled: boolean;
            timeoutMs: number;
            maxRedirects: number;
            maxBytes: number;
            maxCharacters: number;
            minCharactersForLocal: number;
        };
        tavilyFallback: {
            enabled: boolean;
            timeoutMs: number | null;
        };
    };
};

export type StoredWebSettingsConfig = {
    search?: {
        order?: WebSearchProviderKey[];
        providers?: {
            tavily?: Partial<TavilySearchProviderConfig>;
            brave?: Partial<BraveSearchProviderConfig>;
        };
    };
    fetch?: {
        local?: Partial<WebSettingsConfig["fetch"]["local"]>;
        tavilyFallback?: Partial<WebSettingsConfig["fetch"]["tavilyFallback"]>;
    };
};

export type EffectiveConfig = {
    models: ModelSettingsConfig;
    embedding: EmbeddingServiceConfig;
    agent: {
        defaultProfileKey: {
            novel: string | null;
            userAssets: string | null;
        };
        profileModelDefaults: AgentProfileModelConfig;
        profileRuntimeDefaults?: ProfileRuntimeSettingsPatch;
        profiles: Record<string, AgentProfileConfig>;
        /**
         * agent 可见模型清单（Task 111）：agent/workflow 指定模型时只能从这里选。
         * 为空表示未配置，消费方兜底为单条默认模型；通常不超过 5 条。
         */
        visibleModels: AgentVisibleModelConfig[];
    };
    ui: {
        themeId: ProductThemeId;
        appearance: ProductAppearance;
        /** 当前配色 id；空串 = 跟随主题包按明暗给出的默认配色。 */
        colorwayId: string;
        /** 用户自定义配色库（配色契约变量取值 + 展示名 + 明暗）。 */
        userColorways: UserColorwayDto[];
        costCurrency: "USD" | "CNY";
    };
    editor: {
        markdown: MarkdownEditorPreferences;
        monaco: MonacoEditorPreferences;
        associations: Record<string, string>;
        languageAssociations: Record<string, string>;
    };
    web: WebSettingsConfig;
    observability: ObservabilityConfig;
    history: WorkspaceHistorySettingsConfig;
};

/** 可观测配置。第一版只有 Pi 请求 trace。 */
export type ObservabilityConfig = {
    piTrace: PiTraceConfig;
};

/** Pi 请求 trace 开关。enabled 默认开；maxRecords 是每 session 保留条数。 */
export type PiTraceConfig = {
    enabled: boolean;
    /** 每 session 保留最近多少条 trace。 */
    maxRecords: number;
    /** 是否完整存 provider 原生请求体（含 prompt）。false 时只留元数据（暂未实现摘要）。 */
    capturePayload: boolean;
};

/**
 * 工作区文件历史（操作日志）配置。enabled 是 Global 独有总开关；其余四项 Project 可覆盖。
 * 改动在项目下次 open 时生效（history 库随 ProjectSession 生命周期打开）。
 */
export type WorkspaceHistorySettingsConfig = {
    /** 总开关。false 时不开库、不记账、不注入变更提醒。 */
    enabled: boolean;
    /** 保留窗口天数：窗口内日志条目全量保留。 */
    retentionFullDays: number;
    /** 窗口外是否每文件每自然日保留末条（false = 窗口外全删，未接受段等保护规则仍生效）。 */
    keepDailyLastAfterWindow: boolean;
    /** 是否自动接受长期未审查的收件箱条目（防止「未接受段永不 prune」导致库只增不减）。 */
    autoAcceptEnabled: boolean;
    /** 收件箱组内最后一条条目超过该天数未审查时，整组自动接受。 */
    autoAcceptDays: number;
};

export type StoredProviderConfig = Omit<ConfiguredProviderConfig, "models"> & {
    id: string;
    models: ConfiguredModelConfig[];
};

export type StoredGlobalConfig = {
    models?: {
        default?: string | null;
        providers?: StoredProviderConfig[];
    };
    embedding?: Partial<EmbeddingServiceConfig>;
    agent?: {
        defaultProfileKey?: {
            novel?: string | null;
            userAssets?: string | null;
        };
        profileModelDefaults?: StoredAgentProfileModelDefaultsConfig;
        profileRuntimeDefaults?: ProfileRuntimeSettingsPatch;
        profiles?: Record<string, StoredAgentProfileConfig>;
        visibleModels?: AgentVisibleModelConfig[];
    };
    ui?: Partial<EffectiveConfig["ui"]>;
    editor?: {
        markdown?: Partial<MarkdownEditorPreferences>;
        monaco?: Partial<MonacoEditorPreferences>;
        associations?: Record<string, string>;
        languageAssociations?: Record<string, string>;
    };
    web?: StoredWebSettingsConfig;
    observability?: {
        piTrace?: Partial<PiTraceConfig>;
    };
    history?: Partial<WorkspaceHistorySettingsConfig>;
};

export type StoredProjectConfig = {
    models?: {
        default?: string | null;
    };
    embedding?: Partial<EmbeddingModelConfig>;
    agent?: {
        defaultProfileKey?: string | null;
        profileModelDefaults?: StoredAgentProfileModelDefaultsConfig;
        profileRuntimeDefaults?: ProfileRuntimeSettingsPatch;
        profiles?: Record<string, StoredAgentProfileConfig>;
    };
    editor?: {
        markdown?: Partial<MarkdownEditorPreferences>;
        monaco?: Partial<MonacoEditorPreferences>;
        associations?: Record<string, string>;
        languageAssociations?: Record<string, string>;
    };
    /** Project 侧只允许覆盖 retention / auto-accept 四项；enabled 是 Global 独有。 */
    history?: Partial<Omit<WorkspaceHistorySettingsConfig, "enabled">>;
};

/** Config 公开字符串入口完成解析后的内部目标；Project 分支必定已经 ready。 */
export type ConfigTarget = {
    workspaceKind: "user-assets";
    workspaceRoot: AbsoluteFsPath;
    project: null;
} | {
    workspaceKind: "novel";
    workspaceRoot: AbsoluteFsPath;
    project: ReadyProjectSessionRef;
};

/** Agent runtime 读取配置时使用的结构化目标；Project 分支只能来自 ready generation。 */
export type RuntimeConfigTarget = {
    scope: "global";
    workspaceRoot: AbsoluteFsPath;
    project: null;
} | {
    scope: "project";
    workspaceRoot: AbsoluteFsPath;
    project: ReadyProjectSessionRef;
};
