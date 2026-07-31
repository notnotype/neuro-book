import {z} from "zod";
import {PiSimpleRequestOptionsSchema} from "nbook/shared/dto/pi-request-options.dto";
import {PROVIDER_CONFIG_ISSUE_CODES, SUPPORTED_PI_APIS} from "nbook/shared/models/provider-config-contract";

const ProviderIdSchema = z.string().trim().min(1, "providerId 不能为空").regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "providerId 格式不合法");
const ModelIdSchema = z.string().trim().min(1, "modelId 不能为空");
const NullableTextSchema = z.string().trim().nullable().optional().transform((value) => {
    const normalized = value?.trim() ?? "";
    return normalized ? normalized : null;
});
const ProviderOptionTextSchema = z.string().trim().default("");
const ProviderTimeoutMsSchema = z.number().int("timeoutMs 必须是整数").positive("timeoutMs 必须大于 0").nullable().default(null);
const DefaultModelKeySchema = z.string().trim().min(1, "默认模型不能为空").nullable().default(null);
const TemperatureSchema = z.number().nonnegative("temperature 不能小于 0").nullable().default(null);
const ContextWindowTokensSchema = z.number().int("contextWindowTokens 必须是整数").positive("contextWindowTokens 必须大于 0").nullable().default(null);
export const ThinkingLevelSchema = z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const ReasoningEffortSchema = ThinkingLevelSchema.nullable().default(null);
const ModelInputKindSchema = z.enum(["text", "image"]);
const PiModelApiSchema = z.string().trim().min(1, "api 不能为空").nullable().default(null);
export const SupportedPiApiSchema = z.enum(SUPPORTED_PI_APIS);
const PiModelInputSchema = z.array(ModelInputKindSchema).min(1, "input 至少需要声明一种输入类型").nullable().default(null);
const PiModelReasoningSchema = z.boolean().nullable().default(null);
const PiModelMaxTokensSchema = z.number().int("maxTokens 必须是整数").positive("maxTokens 必须大于 0").nullable().default(null);
const PiPriceSchema = z.number().finite("价格必须是有限数字").nonnegative("价格不能小于 0");
const PiModelCostTierSchema = z.object({
    inputTokensAbove: z.number().int("tier threshold 必须是整数").nonnegative("tier threshold 不能小于 0"),
    input: PiPriceSchema,
    output: PiPriceSchema,
    cacheRead: PiPriceSchema,
    cacheWrite: PiPriceSchema,
});
const PiModelCostObjectSchema = z.object({
    input: PiPriceSchema,
    output: PiPriceSchema,
    cacheRead: PiPriceSchema,
    cacheWrite: PiPriceSchema,
    tiers: z.array(PiModelCostTierSchema).default([]),
}).superRefine((cost, ctx) => {
    const thresholds = new Set<number>();
    for (const [index, tier] of cost.tiers.entries()) {
        if (thresholds.has(tier.inputTokensAbove)) {
            ctx.addIssue({
                code: "custom",
                path: ["tiers", index, "inputTokensAbove"],
                message: `tier threshold 重复：${tier.inputTokensAbove}`,
            });
        }
        thresholds.add(tier.inputTokensAbove);
    }
});
const PiModelCostSchema = PiModelCostObjectSchema.nullable().default(null);
const PiModelCompatSchema = z.record(z.string(), z.json()).nullable().default(null);
const PiModelHeadersSchema = z.record(z.string(), z.string().nullable()).nullable().default(null);
const PiThinkingLevelMapSchema = z.record(z.string(), z.string().nullable()).nullable().default(null);
/**
 * Provider 连接配置。
 */
export const ModelProviderOptionsDtoSchema = z.object({
    apiKey: ProviderOptionTextSchema,
    baseURL: ProviderOptionTextSchema,
    proxy: ProviderOptionTextSchema,
    timeoutMs: ProviderTimeoutMsSchema,
    requestOptions: PiSimpleRequestOptionsSchema,
});

/**
 * 单个已配置模型。
 */
export const ConfiguredModelDtoSchema = z.object({
    name: z.string().trim().min(1, "模型名称不能为空"),
    id: ModelIdSchema,
    group: NullableTextSchema,
    enabled: z.boolean().default(true),
    api: PiModelApiSchema,
    reasoning: PiModelReasoningSchema,
    input: PiModelInputSchema,
    maxTokens: PiModelMaxTokensSchema,
    cost: PiModelCostSchema,
    compat: PiModelCompatSchema,
    headers: PiModelHeadersSchema,
    thinkingLevelMap: PiThinkingLevelMapSchema,
    contextWindowTokens: ContextWindowTokensSchema,
});

/** 已保存模型配置的字段级校验问题。 */
export const ModelValidationIssueDtoSchema = z.object({
    code: z.enum(PROVIDER_CONFIG_ISSUE_CODES),
    path: z.array(z.union([z.string(), z.number().int()])),
    modelKey: z.string().trim().min(1).nullable(),
    message: z.string().trim().min(1),
});

/**
 * 启用模型选项。
 */
export const EnabledModelOptionDtoSchema = z.object({
    key: z.string().trim().min(1, "模型 key 不能为空"),
    label: z.string().trim().min(1, "模型标签不能为空"),
    providerId: ProviderIdSchema,
    modelId: ModelIdSchema,
    contextWindowTokens: ContextWindowTokensSchema,
});

/**
 * Agent Profile 模型配置。
 */
export const AgentProfileModelConfigDtoSchema = z.object({
    modelKey: DefaultModelKeySchema,
    temperature: TemperatureSchema,
    reasoningEffort: ReasoningEffortSchema,
    realtimeOutput: z.boolean().default(true),
});

/**
 * Provider 草稿，请求连通性测试与远程模型发现时使用。
 */
export const ModelProviderDraftDtoSchema = z.object({
    id: ProviderIdSchema,
    name: z.string().trim().min(1, "Provider 名称不能为空"),
    modelApi: SupportedPiApiSchema,
    options: ModelProviderOptionsDtoSchema,
});

/**
 * 远程发现到的 Provider 模型。
 */
export const DiscoveredProviderModelDtoSchema = z.object({
    id: ModelIdSchema,
    name: z.string().trim().min(1, "模型名称不能为空"),
    group: NullableTextSchema,
    api: PiModelApiSchema,
    reasoning: PiModelReasoningSchema,
    input: PiModelInputSchema,
    contextWindowTokens: ContextWindowTokensSchema,
    maxTokens: PiModelMaxTokensSchema,
    cost: PiModelCostSchema,
    compat: PiModelCompatSchema,
    headers: PiModelHeadersSchema,
    thinkingLevelMap: PiThinkingLevelMapSchema,
});

/** 设置页连接请求明确选择的凭据来源，禁止服务端根据空字符串猜测。 */
export const ProviderCredentialSourceSchema = z.enum(["provided", "saved", "cleared"]);

/** Provider 删除前引用检查。 */
export const CheckProviderReferencesRequestDtoSchema = z.object({providerId: ProviderIdSchema});
export const CheckProviderReferencesResponseDtoSchema = z.object({
    references: z.array(z.object({label: z.string(), modelKey: z.string()})),
});

/**
 * Provider 连通性测试请求。
 */
export const CheckProviderRequestDtoSchema = z.object({
    provider: ModelProviderDraftDtoSchema,
    models: z.array(ConfiguredModelDtoSchema.omit({
        enabled: true,
    })).default([]),
    credentialSource: ProviderCredentialSourceSchema,
    useSavedModels: z.boolean().default(true),
});

/**
 * Provider 连通性测试响应。
 */
export const CheckProviderResponseDtoSchema = z.object({
    success: z.boolean(),
    latencyMs: z.number().int().nonnegative().nullable(),
    message: z.string().trim().min(1),
});

/**
 * Provider 远程模型发现请求。
 */
export const DiscoverProviderModelsRequestDtoSchema = z.object({
    provider: ModelProviderDraftDtoSchema,
    credentialSource: ProviderCredentialSourceSchema,
});

/**
 * Provider 远程模型发现响应。
 */
export const DiscoverProviderModelsResponseDtoSchema = z.object({
    models: z.array(DiscoveredProviderModelDtoSchema).default([]),
    message: z.string().trim().min(1),
});

/**
 * 单模型健康检查请求。
 */
export const CheckModelRequestDtoSchema = z.object({
    provider: ModelProviderDraftDtoSchema,
    model: ConfiguredModelDtoSchema.omit({
        enabled: true,
    }),
    credentialSource: ProviderCredentialSourceSchema,
});

/**
 * 单模型健康检查响应。
 */
export const CheckModelResponseDtoSchema = z.object({
    success: z.boolean(),
    latencyMs: z.number().int().nonnegative().nullable(),
    message: z.string().trim().min(1),
});

/** NeuroBook 维护的唯一标准模型资料。 */
export const ModelLibraryEntryDtoSchema = z.object({
    id: ModelIdSchema,
    name: z.string().trim().min(1),
    source: ProviderIdSchema,
    reasoning: z.boolean(),
    thinkingLevelMap: PiThinkingLevelMapSchema,
    input: z.array(ModelInputKindSchema).min(1),
    contextWindowTokens: z.number().int().positive(),
    maxTokens: z.number().int().positive(),
});

/** NeuroBook Provider 创建模板；复制后与用户配置无持续关联。 */
export const ProviderTemplateDtoSchema = z.object({
    id: ProviderIdSchema,
    name: z.string().trim().min(1),
    baseUrl: z.string().trim(),
    defaultModelApi: SupportedPiApiSchema.nullable(),
    models: z.array(ConfiguredModelDtoSchema).default([]),
});

/** 设置页读取的 NeuroBook Model Library。 */
export const ModelLibraryDtoSchema = z.object({
    models: z.array(ModelLibraryEntryDtoSchema).default([]),
});

/** 设置页读取的 NeuroBook Provider Template Library。 */
export const ProviderTemplateLibraryDtoSchema = z.object({
    templates: z.array(ProviderTemplateDtoSchema).default([]),
});

export type ModelInputKind = z.infer<typeof ModelInputKindSchema>;
export type ThinkingLevelDto = z.infer<typeof ThinkingLevelSchema>;
export type ModelProviderOptionsDto = z.infer<typeof ModelProviderOptionsDtoSchema>;
export type ConfiguredModelDto = z.infer<typeof ConfiguredModelDtoSchema>;
export type ModelValidationIssueDto = z.infer<typeof ModelValidationIssueDtoSchema>;
export type EnabledModelOptionDto = z.infer<typeof EnabledModelOptionDtoSchema>;
export type AgentProfileModelConfigDto = z.infer<typeof AgentProfileModelConfigDtoSchema>;
export type ModelProviderDraftDto = z.infer<typeof ModelProviderDraftDtoSchema>;
export type DiscoveredProviderModelDto = z.infer<typeof DiscoveredProviderModelDtoSchema>;
export type CheckProviderRequestDto = z.infer<typeof CheckProviderRequestDtoSchema>;
export type CheckProviderResponseDto = z.infer<typeof CheckProviderResponseDtoSchema>;
export type DiscoverProviderModelsRequestDto = z.infer<typeof DiscoverProviderModelsRequestDtoSchema>;
export type ProviderCredentialSource = z.infer<typeof ProviderCredentialSourceSchema>;
export type CheckProviderReferencesRequestDto = z.infer<typeof CheckProviderReferencesRequestDtoSchema>;
export type CheckProviderReferencesResponseDto = z.infer<typeof CheckProviderReferencesResponseDtoSchema>;
export type DiscoverProviderModelsResponseDto = z.infer<typeof DiscoverProviderModelsResponseDtoSchema>;
export type CheckModelRequestDto = z.infer<typeof CheckModelRequestDtoSchema>;
export type CheckModelResponseDto = z.infer<typeof CheckModelResponseDtoSchema>;
export type ModelLibraryEntryDto = z.infer<typeof ModelLibraryEntryDtoSchema>;
export type ProviderTemplateDto = z.infer<typeof ProviderTemplateDtoSchema>;
export type ModelLibraryDto = z.infer<typeof ModelLibraryDtoSchema>;
export type ProviderTemplateLibraryDto = z.infer<typeof ProviderTemplateLibraryDtoSchema>;
