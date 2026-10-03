import {z} from "zod";
import {EditorAssociationMapSchema, EditorAssociationSettingsSchema} from "nbook/shared/editor-associations";
import {
    AgentProfileModelConfigDtoSchema,
    ConfiguredModelDtoSchema,
    EnabledModelOptionDtoSchema,
    ModelValidationIssueDtoSchema,
} from "nbook/shared/dto/app-settings.dto";
import {
    DEFAULT_MARKDOWN_EDITOR_PREFERENCES,
    DEFAULT_MONACO_EDITOR_PREFERENCES,
} from "nbook/shared/editor-workbench";
import {
    LowCodeFormDtoSchema,
    LowCodeFormIssueDtoSchema,
    LowCodeJsonObjectSchema,
    LowCodeResourceMutationDtoSchema,
} from "nbook/shared/dto/low-code-form.dto";
import {DEFAULT_PRODUCT_APPEARANCE, DEFAULT_PRODUCT_THEME_ID, productAppearances, productThemeIds} from "nbook/shared/theme/theme-axes";
import {
    MAX_COLORWAY_VAR_VALUE_LENGTH,
    MAX_USER_COLORWAY_LABEL_LENGTH,
    MAX_USER_COLORWAYS,
    USER_COLORWAY_ID_PATTERN,
} from "nbook/shared/theme/user-colorway";
import {
    CompactionKeepRecentSchema,
    CompactionTriggerSchema,
    ProfileCompactionRuntimePatchSchema,
    ProfileFileChangeNoticeRuntimePatchSchema,
    ProfileRuntimeSettingsPatchSchema,
    ProfileSummarizerRuntimePatchSchema,
    SummarizerIntervalSchema,
} from "nbook/shared/agent/profile-runtime-settings";
import {MAX_AGENT_DIFF_MAX_CHARS} from "nbook/shared/agent/file-change-policy";
import {PiSimpleRequestOptionsSchema} from "nbook/shared/dto/pi-request-options.dto";

const JsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
]));

const ConfigPathTextSchema = z.string().trim().min(1);
const NullableModelKeySchema = z.string().trim().min(1).nullable().default(null);
const EmbeddingDimensionsSchema = z.number().int().positive().nullable().default(null);
const EmbeddingProviderSchema = z.enum(["openai-compatible"]);
const EmbeddingModelSchema = z.string().trim().nullable().optional().transform((value) => {
    const normalized = value?.trim() ?? "";
    return normalized ? normalized : null;
});
const ProviderIdSchema = z.string().trim().min(1).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u);
const NullableTextSchema = z.string().trim().nullable().optional().transform((value) => {
    const normalized = value?.trim() ?? "";
    return normalized ? normalized : null;
});
const ProviderOptionTextSchema = z.string().trim().default("");
const ProviderTimeoutMsSchema = z.number().int().positive().nullable().default(null);
const ProviderRequestOptionsSchema = z.record(z.string(), JsonValueSchema).default({});
const ProfileKeySchema = z.string().trim().min(1);
const WebSearchProviderKeySchema = z.enum(["tavily", "brave"]);
const WebTimeoutMsSchema = z.number().int().positive().nullable().default(null);
/**
 * Secret 字段的编辑态。GET 不返回 value；PUT 中 value 缺失表示保留。
 */
export const SecretConfigValueDtoSchema = z.object({
    configured: z.boolean(),
    maskedValue: z.string().nullable(),
    value: z.string().optional(),
});

export const ConfigScopeDtoSchema = z.enum(["boot", "global", "global-workspace"]);
export const ConfigEffectDtoSchema = z.enum(["hot", "next-run", "next-session", "restart-required"]);
export const ConfigMergeDtoSchema = z.enum(["replace", "deep-merge"]);

export const ConfigItemMetaDtoSchema = z.object({
    key: z.string().trim().min(1),
    scope: ConfigScopeDtoSchema,
    effect: ConfigEffectDtoSchema,
    merge: ConfigMergeDtoSchema,
    secret: z.boolean(),
    description: z.string().trim().min(1),
});

const ConfigWorkspaceQueryBaseDtoSchema = z.object({
    workspaceKind: z.enum(["novel", "user-assets"]).default("novel"),
    projectRoot: z.string().trim().min(1).optional(),
});

function refineConfigWorkspaceQuery(
    value: z.infer<typeof ConfigWorkspaceQueryBaseDtoSchema>,
    ctx: z.RefinementCtx,
): void {
    if (value.workspaceKind === "novel" && !value.projectRoot) {
        ctx.addIssue({
            code: "custom",
            path: ["projectRoot"],
            message: "Project Workspace 配置必须提供 projectRoot",
        });
    }
}

export const ConfigWorkspaceQueryDtoSchema = ConfigWorkspaceQueryBaseDtoSchema.superRefine(refineConfigWorkspaceQuery);

export const ConfigEditorSnapshotQueryDtoSchema = ConfigWorkspaceQueryBaseDtoSchema.superRefine(refineConfigWorkspaceQuery);

export const ConfigAgentProfileSettingsQueryDtoSchema = ConfigWorkspaceQueryBaseDtoSchema.extend({
    scope: z.enum(["global", "project"]).default("global"),
}).superRefine(refineConfigWorkspaceQuery);

export const ConfigProfileHomeResetRequestDtoSchema = z.object({
    profileKey: ProfileKeySchema,
});

export const ConfigModelProviderOptionsDtoSchema = z.object({
    apiKey: SecretConfigValueDtoSchema,
    baseURL: ProviderOptionTextSchema,
    proxy: ProviderOptionTextSchema,
    timeoutMs: ProviderTimeoutMsSchema,
    requestOptions: PiSimpleRequestOptionsSchema,
});

export const ConfiguredProviderConfigDtoSchema = z.object({
    /**
     * 编辑快照中的原始数组位置。仅用于坏配置修复时保留对应 secret，
     * 新建 Provider 可缺省；服务端写盘前必须移除。
     */
    sourceIndex: z.number().int().nonnegative().optional(),
    id: ProviderIdSchema,
    name: z.string().trim().min(1),
    enabled: z.boolean().default(true),
    modelApi: NullableTextSchema,
    options: ConfigModelProviderOptionsDtoSchema,
    models: z.array(ConfiguredModelDtoSchema).default([]),
});

/** Agent / Workflow 可选择的模型清单条目。 */
export const AgentVisibleModelConfigDtoSchema = z.object({
    modelKey: z.string().trim().min(1),
    note: z.string().trim().default(""),
});

export const ConfigModelSettingsDtoSchema = z.object({
    defaultModelKey: NullableModelKeySchema,
    defaultModelLabel: z.string().trim().nullable().default(null),
    enabledModels: z.array(EnabledModelOptionDtoSchema).default([]),
    agentVisibleModels: z.array(AgentVisibleModelConfigDtoSchema).default([]),
    providers: z.array(ConfiguredProviderConfigDtoSchema).default([]),
    validationIssues: z.array(ModelValidationIssueDtoSchema).default([]),
});

export const EmbeddingServiceConfigDtoSchema = z.object({
    enabled: z.boolean().default(false),
    provider: EmbeddingProviderSchema.default("openai-compatible"),
    model: EmbeddingModelSchema,
    dimensions: EmbeddingDimensionsSchema,
    apiKey: SecretConfigValueDtoSchema,
    baseURL: ProviderOptionTextSchema,
    timeoutMs: ProviderTimeoutMsSchema,
    requestOptions: ProviderRequestOptionsSchema,
});

export const EmbeddingProjectConfigDtoSchema = z.object({
    model: EmbeddingModelSchema,
    dimensions: EmbeddingDimensionsSchema,
}).partial().default({});

export const ConfigEmbeddingSettingsDtoSchema = z.object({
    global: EmbeddingServiceConfigDtoSchema,
    project: EmbeddingProjectConfigDtoSchema.nullable(),
    effective: EmbeddingServiceConfigDtoSchema,
});

export const ConfigAgentProfileLoadStatusDtoSchema = z.enum([
    "loaded",
    "compiling",
    "compile_failed",
    "not_compiled",
    "compile_stale",
    "compiled_load_failed",
    "source_error",
]);

export const ConfigAgentProfileIssueDtoSchema = z.object({
    code: z.string().trim().min(1),
    message: z.string().trim().min(1),
    profileKey: ProfileKeySchema.nullable().default(null),
    sourcePath: z.string().trim().min(1).nullable().default(null),
});

export const ConfigAgentProfileBuildStateDtoSchema = z.object({
    running: z.boolean().default(false),
    queued: z.boolean().default(false),
    reason: z.string().trim().min(1).nullable().default(null),
    updatedAt: z.string().trim().min(1).nullable().default(null),
});

export const ConfigAgentProfileSettingsDtoSchema = z.object({
    enabledModels: z.array(EnabledModelOptionDtoSchema).default([]),
    validationIssues: z.array(ModelValidationIssueDtoSchema).default([]),
    profileModelDefaults: AgentProfileModelConfigDtoSchema,
    harnessRuntimeDefaults: z.lazy(() => ProfileRuntimeSettingsDtoSchema),
    profileRuntimeDefaults: z.lazy(() => ProfileRuntimeSettingsDtoSchema),
    globalRuntimeDefaultsPatch: z.lazy(() => ProfileRuntimeSettingsPatchDtoSchema).default({}),
    projectRuntimeDefaultsPatch: z.lazy(() => ProfileRuntimeSettingsPatchDtoSchema).default({}),
    agentProfiles: z.array(z.object({
        profileKey: ProfileKeySchema,
        name: z.string().trim().min(1),
        canResetHome: z.boolean().default(false),
        model: AgentProfileModelConfigDtoSchema,
        loadStatus: ConfigAgentProfileLoadStatusDtoSchema,
        hasSettingsForm: z.boolean().default(false),
        runtime: z.object({
            profileDefaults: z.lazy(() => ProfileRuntimeSettingsPatchDtoSchema).default({}),
            effective: z.lazy(() => ProfileRuntimeSettingsDtoSchema),
            globalDefaultsPatch: z.lazy(() => ProfileRuntimeSettingsPatchDtoSchema).default({}),
            globalProfilePatch: z.lazy(() => ProfileRuntimeSettingsPatchDtoSchema).default({}),
            projectDefaultsPatch: z.lazy(() => ProfileRuntimeSettingsPatchDtoSchema).default({}),
            projectProfilePatch: z.lazy(() => ProfileRuntimeSettingsPatchDtoSchema).default({}),
        }),
        issue: ConfigAgentProfileIssueDtoSchema.nullable().default(null),
        sourcePath: z.string().trim().min(1).nullable().default(null),
        buildState: ConfigAgentProfileBuildStateDtoSchema,
        settings: z.object({
            form: LowCodeFormDtoSchema,
            value: LowCodeJsonObjectSchema,
            inheritedValue: LowCodeJsonObjectSchema.default({}),
            effectivePatch: LowCodeJsonObjectSchema.default({}),
            globalPatch: LowCodeJsonObjectSchema.default({}),
            projectPatch: LowCodeJsonObjectSchema.default({}),
            issues: z.array(LowCodeFormIssueDtoSchema).default([]),
        }).nullable().default(null),
    })).default([]),
});

export const ConfigDefaultProfileSettingsDtoSchema = z.object({
    workspaceKind: z.enum(["novel", "user-assets"]),
    projectConfigAvailable: z.boolean(),
    systemDefaultProfileKey: ProfileKeySchema,
    globalDefaultProfileKey: ProfileKeySchema.nullable(),
    projectDefaultProfileKey: ProfileKeySchema.nullable(),
    effectiveProfileKey: ProfileKeySchema,
    profiles: z.array(z.object({
        profileKey: ProfileKeySchema,
        name: z.string().trim().min(1),
        description: z.string().trim().nullable(),
        loadStatus: ConfigAgentProfileLoadStatusDtoSchema,
    })).default([]),
});

export const ConfigAgentProfileBuildStatusDtoSchema = z.object({
    profiles: z.array(z.object({
        profileKey: ProfileKeySchema,
        name: z.string().trim().min(1),
        loadStatus: ConfigAgentProfileLoadStatusDtoSchema,
        issue: ConfigAgentProfileIssueDtoSchema.nullable().default(null),
        buildState: ConfigAgentProfileBuildStateDtoSchema,
    })).default([]),
});

const MarkdownEditorFields = {
    fontFamily: z.string(),
    fontSize: z.number().positive(),
    lineHeight: z.number().positive(),
    contentWidth: z.number().positive(),
    paragraphIndentEnabled: z.boolean(),
    paragraphIndentEm: z.number().nonnegative(),
};
const MonacoEditorFields = {
    fontFamily: z.string(),
    fontSize: z.number().positive(),
    lineHeight: z.number().positive(),
    tabSize: z.number().int().positive(),
    wordWrap: z.boolean(),
    minimapEnabled: z.boolean(),
    lineNumbers: z.boolean(),
    renderWhitespace: z.boolean(),
};

export const MarkdownEditorConfigDtoSchema = z.object({
    fontFamily: MarkdownEditorFields.fontFamily.default(DEFAULT_MARKDOWN_EDITOR_PREFERENCES.fontFamily),
    fontSize: MarkdownEditorFields.fontSize.default(DEFAULT_MARKDOWN_EDITOR_PREFERENCES.fontSize),
    lineHeight: MarkdownEditorFields.lineHeight.default(DEFAULT_MARKDOWN_EDITOR_PREFERENCES.lineHeight),
    contentWidth: MarkdownEditorFields.contentWidth.default(DEFAULT_MARKDOWN_EDITOR_PREFERENCES.contentWidth),
    paragraphIndentEnabled: MarkdownEditorFields.paragraphIndentEnabled.default(DEFAULT_MARKDOWN_EDITOR_PREFERENCES.paragraphIndentEnabled),
    paragraphIndentEm: MarkdownEditorFields.paragraphIndentEm.default(DEFAULT_MARKDOWN_EDITOR_PREFERENCES.paragraphIndentEm),
});

export const MonacoEditorConfigDtoSchema = z.object({
    fontFamily: MonacoEditorFields.fontFamily.default(DEFAULT_MONACO_EDITOR_PREFERENCES.fontFamily),
    fontSize: MonacoEditorFields.fontSize.default(DEFAULT_MONACO_EDITOR_PREFERENCES.fontSize),
    lineHeight: MonacoEditorFields.lineHeight.default(DEFAULT_MONACO_EDITOR_PREFERENCES.lineHeight),
    tabSize: MonacoEditorFields.tabSize.default(DEFAULT_MONACO_EDITOR_PREFERENCES.tabSize),
    wordWrap: MonacoEditorFields.wordWrap.default(DEFAULT_MONACO_EDITOR_PREFERENCES.wordWrap),
    minimapEnabled: MonacoEditorFields.minimapEnabled.default(DEFAULT_MONACO_EDITOR_PREFERENCES.minimapEnabled),
    lineNumbers: MonacoEditorFields.lineNumbers.default(DEFAULT_MONACO_EDITOR_PREFERENCES.lineNumbers),
    renderWhitespace: MonacoEditorFields.renderWhitespace.default(DEFAULT_MONACO_EDITOR_PREFERENCES.renderWhitespace),
});

/**
 * 用户自定义配色。变量键的形状是 `--kebab-case`，取值只做长度与「不是别的 CSS 语句」的底线检查——
 * 「这个值是不是合法颜色」要求助浏览器，见 shared/theme/user-colorway.ts 里的分工说明。
 */
export const UserColorwayDtoSchema = z.object({
    id: z.string().trim().regex(USER_COLORWAY_ID_PATTERN).max(64),
    label: z.string().trim().min(1).max(MAX_USER_COLORWAY_LABEL_LENGTH),
    appearance: z.enum(productAppearances),
    vars: z.record(z.string().regex(/^--[a-z0-9-]+$/), z.string().trim().min(1).max(MAX_COLORWAY_VAR_VALUE_LENGTH)),
});

export const UiConfigDtoSchema = z.object({
    themeId: z.enum(productThemeIds).default(DEFAULT_PRODUCT_THEME_ID),
    appearance: z.enum(productAppearances).default(DEFAULT_PRODUCT_APPEARANCE),
    /** 当前配色 id；空串 = 跟随主题包按明暗给出的默认配色。主题自带配色 id 与 `custom-*` 都在这里出现。 */
    colorwayId: z.string().trim().max(64).default(""),
    /** 用户自定义配色库。条数有上限：这是配置写入的一部分，不该被刷成无界列表。 */
    userColorways: z.array(UserColorwayDtoSchema).max(MAX_USER_COLORWAYS).default([]),
    costCurrency: z.enum(["USD", "CNY"]).default("USD"),
});

export const EditorConfigDtoSchema = z.object({
    markdown: MarkdownEditorConfigDtoSchema.default(DEFAULT_MARKDOWN_EDITOR_PREFERENCES),
    monaco: MonacoEditorConfigDtoSchema.default(DEFAULT_MONACO_EDITOR_PREFERENCES),
    associations: EditorAssociationMapSchema.default({}),
    languageAssociations: EditorAssociationMapSchema.default({}),
});

/** 不从含 default 的读取 schema partial：Zod 的 default 会填回未提交字段。 */
export const EditorConfigPatchDtoSchema = z.object({
    markdown: z.object(MarkdownEditorFields).partial().optional(),
    monaco: z.object(MonacoEditorFields).partial().optional(),
    associations: EditorAssociationMapSchema.optional(),
    languageAssociations: EditorAssociationMapSchema.optional(),
});

export const SummarizerIntervalDtoSchema = SummarizerIntervalSchema;
export const CompactionTriggerDtoSchema = CompactionTriggerSchema;
export const CompactionKeepRecentDtoSchema = CompactionKeepRecentSchema;
export const ProfileSummarizerRuntimePatchDtoSchema = ProfileSummarizerRuntimePatchSchema;
export const ProfileCompactionRuntimePatchDtoSchema = ProfileCompactionRuntimePatchSchema;
export const ProfileFileChangeNoticeRuntimePatchDtoSchema = ProfileFileChangeNoticeRuntimePatchSchema;
export const ProfileRuntimeSettingsPatchDtoSchema = ProfileRuntimeSettingsPatchSchema;

export const ProfileRuntimeSettingsDtoSchema = z.object({
    summarizer: z.object({
        enabled: z.boolean(),
        profileKey: ProfileKeySchema,
        trigger: z.literal("afterInvocation"),
        interval: SummarizerIntervalDtoSchema,
        maxDialogueContentTokens: z.number().positive(),
    }),
    compaction: z.object({
        enabled: z.boolean(),
        trigger: CompactionTriggerDtoSchema,
        reserveTokens: z.number().int().positive(),
        keepRecent: CompactionKeepRecentDtoSchema,
        prompt: z.string().min(1),
        summaryPrefix: z.string().min(1),
    }),
    fileChangeNotice: z.object({
        diffMaxChars: z.number().int().min(0).max(MAX_AGENT_DIFF_MAX_CHARS),
    }),
});

export const ConfigAgentProfileMapDtoSchema = z.record(z.string(), z.object({
    model: AgentProfileModelConfigDtoSchema.partial().default({}),
    settings: LowCodeJsonObjectSchema.optional(),
    resourceMutations: z.array(LowCodeResourceMutationDtoSchema).optional(),
    runtime: ProfileRuntimeSettingsPatchDtoSchema.optional(),
})).default({});

export const WebConfigDtoSchema = z.object({
    search: z.object({
        order: z.array(WebSearchProviderKeySchema).default(["tavily", "brave"]),
        providers: z.object({
            tavily: z.object({
                enabled: z.boolean().default(false),
                apiKey: SecretConfigValueDtoSchema,
                timeoutMs: WebTimeoutMsSchema,
            }).partial().default({}),
            brave: z.object({
                enabled: z.boolean().default(false),
                apiKey: SecretConfigValueDtoSchema,
                country: z.string().trim().min(2).max(2).default("US"),
                searchLang: z.string().trim().min(2).max(5).default("en"),
                timeoutMs: WebTimeoutMsSchema,
            }).partial().default({}),
        }).partial().default({}),
    }).partial().default({}),
    fetch: z.object({
        local: z.object({
            enabled: z.boolean().default(true),
            timeoutMs: z.number().int().positive().default(15000),
            maxRedirects: z.number().int().nonnegative().default(5),
            maxBytes: z.number().int().positive().default(2000000),
            maxCharacters: z.number().int().positive().default(20000),
            minCharactersForLocal: z.number().int().nonnegative().default(300),
        }).partial().default({}),
        tavilyFallback: z.object({
            enabled: z.boolean().default(false),
            timeoutMs: WebTimeoutMsSchema,
        }).partial().default({}),
    }).partial().default({}),
}).partial().default({});

/** 可观测配置（Pi 请求 trace 开关）。无 secret 字段，不需要掩码。 */
export const ObservabilityConfigDtoSchema = z.object({
    piTrace: z.object({
        enabled: z.boolean(),
        maxRecords: z.number().int().nonnegative(),
        capturePayload: z.boolean(),
    }).partial().default({}),
}).partial().default({});

/** 文件历史（操作日志）字段集。enabled 是 Global 独有总开关；其余四项 Project 可覆盖。 */
const WorkspaceHistoryFieldsDtoSchema = z.object({
    enabled: z.boolean(),
    retentionFullDays: z.number().int().min(1),
    keepDailyLastAfterWindow: z.boolean(),
    autoAcceptEnabled: z.boolean(),
    autoAcceptDays: z.number().int().min(1),
});

export const WorkspaceHistoryConfigDtoSchema = WorkspaceHistoryFieldsDtoSchema.partial().default({});

/** Project 侧文件历史覆盖：结构性不含 enabled。 */
export const ProjectWorkspaceHistoryConfigDtoSchema = WorkspaceHistoryFieldsDtoSchema.omit({enabled: true}).partial();

export const GlobalConfigDtoSchema = z.object({
    models: z.object({
        default: NullableModelKeySchema,
        providers: z.array(ConfiguredProviderConfigDtoSchema).default([]),
    }).default({default: null, providers: []}),
    embedding: EmbeddingServiceConfigDtoSchema.partial().default({}),
    agent: z.object({
        defaultProfileKey: z.object({
            novel: ProfileKeySchema.nullable().default(null),
            userAssets: ProfileKeySchema.nullable().default(null),
        }).default({novel: null, userAssets: null}),
        profileModelDefaults: AgentProfileModelConfigDtoSchema.partial().default({}),
        profileRuntimeDefaults: ProfileRuntimeSettingsPatchDtoSchema.default({}),
        profiles: ConfigAgentProfileMapDtoSchema,
        visibleModels: z.array(AgentVisibleModelConfigDtoSchema).default([]),
    }).default({defaultProfileKey: {novel: null, userAssets: null}, profileModelDefaults: {}, profileRuntimeDefaults: {}, profiles: {}, visibleModels: []}),
    ui: UiConfigDtoSchema.default({
        themeId: DEFAULT_PRODUCT_THEME_ID,
        appearance: DEFAULT_PRODUCT_APPEARANCE,
        colorwayId: "",
        userColorways: [],
        costCurrency: "USD",
    }),
    editor: EditorConfigDtoSchema.default({
        markdown: DEFAULT_MARKDOWN_EDITOR_PREFERENCES,
        monaco: DEFAULT_MONACO_EDITOR_PREFERENCES,
        associations: {},
        languageAssociations: {},
    }),
    web: WebConfigDtoSchema,
    observability: ObservabilityConfigDtoSchema,
    history: WorkspaceHistoryConfigDtoSchema,
}).partial().passthrough();

export const GlobalConfigUpdateDtoSchema = z.object({
    models: z.object({
        default: NullableModelKeySchema,
        providers: z.array(ConfiguredProviderConfigDtoSchema).default([]),
    }).optional(),
    embedding: EmbeddingServiceConfigDtoSchema.partial().optional(),
    agent: z.object({
        defaultProfileKey: z.object({
            novel: ProfileKeySchema.nullable().default(null),
            userAssets: ProfileKeySchema.nullable().default(null),
        }).default({novel: null, userAssets: null}),
        profileModelDefaults: AgentProfileModelConfigDtoSchema.partial().default({}),
        profileRuntimeDefaults: ProfileRuntimeSettingsPatchDtoSchema.default({}),
        profiles: ConfigAgentProfileMapDtoSchema,
        visibleModels: z.array(AgentVisibleModelConfigDtoSchema).default([]),
    }).optional(),
    ui: UiConfigDtoSchema.optional(),
    editor: EditorConfigPatchDtoSchema.optional(),
    web: z.preprocess((value) => value === undefined ? undefined : value, WebConfigDtoSchema).optional(),
    observability: ObservabilityConfigDtoSchema.optional(),
    history: WorkspaceHistoryConfigDtoSchema.optional(),
}).partial().passthrough();

export const ProjectConfigDtoSchema = z.object({
    models: z.object({
        default: NullableModelKeySchema,
    }).partial().optional(),
    embedding: EmbeddingProjectConfigDtoSchema.optional(),
    agent: z.object({
        defaultProfileKey: ProfileKeySchema.nullable().optional(),
        profileModelDefaults: AgentProfileModelConfigDtoSchema.partial().optional(),
        profileRuntimeDefaults: ProfileRuntimeSettingsPatchDtoSchema.optional(),
        profiles: ConfigAgentProfileMapDtoSchema.optional(),
    }).partial().optional(),
    editor: EditorConfigPatchDtoSchema.optional(),
    history: ProjectWorkspaceHistoryConfigDtoSchema.optional(),
}).partial().passthrough();

export const ConfigSnapshotDtoSchema = z.object({
    version: z.string().trim().min(1),
    effective: z.record(z.string(), JsonValueSchema),
    meta: z.array(ConfigItemMetaDtoSchema),
});

export const ConfigEditorSnapshotDtoSchema = z.object({
    version: z.string().trim().min(1),
    workspaceKind: z.enum(["novel", "user-assets"]),
    global: GlobalConfigDtoSchema,
    project: ProjectConfigDtoSchema.nullable(),
    effective: z.record(z.string(), JsonValueSchema),
    meta: z.array(ConfigItemMetaDtoSchema),
    modelSettings: ConfigModelSettingsDtoSchema,
    embeddingSettings: ConfigEmbeddingSettingsDtoSchema,
    defaultProfileSettings: ConfigDefaultProfileSettingsDtoSchema,
});

export type SecretConfigValueDto = z.infer<typeof SecretConfigValueDtoSchema>;
export type ConfigItemMetaDto = z.infer<typeof ConfigItemMetaDtoSchema>;
export type UserColorwayDto = z.infer<typeof UserColorwayDtoSchema>;
export type ConfigWorkspaceQueryDto = z.infer<typeof ConfigWorkspaceQueryDtoSchema>;
export type ConfigEditorSnapshotQueryDto = z.infer<typeof ConfigEditorSnapshotQueryDtoSchema>;
export type ConfigAgentProfileSettingsQueryDto = z.infer<typeof ConfigAgentProfileSettingsQueryDtoSchema>;
export type ConfigProfileHomeResetRequestDto = z.infer<typeof ConfigProfileHomeResetRequestDtoSchema>;
export type ConfigModelSettingsDto = z.infer<typeof ConfigModelSettingsDtoSchema>;
export type EmbeddingServiceConfigDto = z.infer<typeof EmbeddingServiceConfigDtoSchema>;
export type EmbeddingProjectConfigDto = z.infer<typeof EmbeddingProjectConfigDtoSchema>;
export type ConfigEmbeddingSettingsDto = z.infer<typeof ConfigEmbeddingSettingsDtoSchema>;
export type ProfileRuntimeSettingsPatchDto = z.infer<typeof ProfileRuntimeSettingsPatchDtoSchema>;
export type ProfileRuntimeSettingsDto = z.infer<typeof ProfileRuntimeSettingsDtoSchema>;
export type ConfigAgentProfileBuildStateDto = z.infer<typeof ConfigAgentProfileBuildStateDtoSchema>;
export type ConfigAgentProfileSettingsDto = z.infer<typeof ConfigAgentProfileSettingsDtoSchema>;
export type ConfigAgentProfileBuildStatusDto = z.infer<typeof ConfigAgentProfileBuildStatusDtoSchema>;
export type ConfigDefaultProfileSettingsDto = z.infer<typeof ConfigDefaultProfileSettingsDtoSchema>;
export type WebConfigDto = z.infer<typeof WebConfigDtoSchema>;
export type ObservabilityConfigDto = z.infer<typeof ObservabilityConfigDtoSchema>;
export type GlobalConfigDto = z.infer<typeof GlobalConfigDtoSchema>;
export type GlobalConfigUpdateDto = z.infer<typeof GlobalConfigUpdateDtoSchema>;
export type ProjectConfigDto = z.infer<typeof ProjectConfigDtoSchema>;
export type ConfigSnapshotDto = z.infer<typeof ConfigSnapshotDtoSchema>;
export type ConfigEditorSnapshotDto = z.infer<typeof ConfigEditorSnapshotDtoSchema>;

export const ExchangeRateDtoSchema = z.object({
    base: z.literal("USD"),
    quote: z.literal("CNY"),
    rate: z.number().positive(),
    source: z.literal("frankfurter"),
    fetchedAt: z.string().trim().min(1),
    stale: z.boolean(),
});

export type ExchangeRateDto = z.infer<typeof ExchangeRateDtoSchema>;

export const ConfigBootstrapDtoSchema = z.object({
    modelSettings: z.object({
        defaultModelLabel: z.string().trim().nullable().default(null),
        enabledModels: z.array(EnabledModelOptionDtoSchema).default([]),
    }),
    defaultProfileSettings: z.object({
        effectiveProfileKey: ProfileKeySchema.nullable(),
    }),
    ui: z.object({
        themeId: z.enum(productThemeIds).default(DEFAULT_PRODUCT_THEME_ID),
        appearance: z.enum(productAppearances).default(DEFAULT_PRODUCT_APPEARANCE),
        colorwayId: z.string().trim().max(64).default(""),
        userColorways: z.array(UserColorwayDtoSchema).max(MAX_USER_COLORWAYS).default([]),
        costCurrency: z.enum(["USD", "CNY"]).default("USD"),
    }),
    editor: EditorAssociationSettingsSchema,
});

export type ConfigBootstrapDto = z.infer<typeof ConfigBootstrapDtoSchema>;
