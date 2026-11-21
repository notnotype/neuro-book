/**
 * 模型服务的配置：形状、内置角色、引用与服务商 id 的纯规则、压缩触发点。浏览器（设置页）与服务端共用；只值导入 `typebox` 与
 * nb-harness 的 `kit/shapes`。
 */

export {
    BLANK_API,
    BLANK_TEMPLATES,
    BUILTIN_ROLES,
    DEFAULT_ROLES,
    isBlankTemplate,
    LegacyProviderConfigSchema,
    MODEL_ROLE_IDS,
    ModelConfigSchema,
    PROVIDER_ID,
    ProviderApiSchema,
    ProviderConfigSchema,
    ProviderIconSchema,
    ProvidersSchema,
    RoleConfigSchema,
    RolesSchema,
} from "./shapes";
export type {BlankTemplate, LegacyProviderConfig, ModelConfig, ProviderApi, ProviderConfig, ProviderIcon, RoleConfig, RolesConfig, StoredProvider} from "./shapes";
export {legacyUid, normalizeProvider, normalizeProviders} from "./normalize";
export {missingContextWindow, providerIdFor, referenceOf, roleOfReference, roleReference, rolesUsing, seriesOf, splitReference} from "./rules";
export {compactionTrigger, CompactionSettingSchema, DEFAULT_COMPACTION, effectiveCompaction} from "./compaction";
export type {CompactionSetting} from "./compaction";
