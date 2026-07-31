import {z} from "zod";
import {LowCodeJsonObjectSchema, LowCodeResourceMutationDtoSchema} from "nbook/shared/dto/low-code-form.dto";

// 这里用 any 是为了避免和 profile-template.dto.ts 形成运行时循环；字段仍在本地 schema 中校验。
const AgentProfilePromptNodeDtoSchema: z.ZodType<any> = z.lazy(() => z.object({
    id: z.string().trim().min(1),
    type: z.string().trim().min(1),
    props: z.record(z.string(), z.json()).default({}),
    children: z.array(AgentProfilePromptNodeDtoSchema as z.ZodType<any>).default([]),
    text: z.string().optional(),
    textKind: z.string().optional(),
    editable: z.boolean().default(true),
    sourceRange: z.object({
        start: z.number().int().nonnegative(),
        end: z.number().int().nonnegative(),
    }).optional(),
}));

export const AgentProfileSourceSchema = z.enum(["system", "user", "contract"]);
export const AgentProfileKindSchema = z.enum(["agent"]);
export const AgentProfileLoadStatusSchema = z.enum([
    "loaded",
    "compiling",
    "compile_failed",
    "not_compiled",
    "compile_stale",
    "compiled_load_failed",
    "source_error",
    "missing",
]);
export const AgentProfileOverrideStateSchema = z.enum(["system", "user_override", "user_only", "contract_only"]);
export const AgentProfileSchemaEditModeSchema = z.enum(["locked", "source", "unavailable"]);
export type AgentProfileSchemaJsonValue = z.infer<ReturnType<typeof z.json>>;

/**
 * profile 加载、解析与预览统一问题结构。
 */
export const AgentProfileIssueDtoSchema = z.object({
    severity: z.enum(["error", "warning"]),
    message: z.string().trim().min(1),
    code: z.string().trim().min(1).optional(),
    profileKey: z.string().trim().min(1).optional(),
    fileName: z.string().trim().min(1).optional(),
    /**
     * 仅开发环境返回，用于定位动态 TSX 编译/运行错误。
     */
    stack: z.string().optional(),
});

/**
 * Schema Builder 的旧字段 DTO。TSX Profile Workbench V1 只保留类型给旧 UI 使用，
 * TypeBox schema 的低代码写回暂不开放。
 */
export const AgentProfileSchemaFieldDtoSchema = z.object({
    name: z.string().trim().min(1),
    type: z.enum(["string", "number", "boolean", "array", "object", "enum"]),
    required: z.boolean().default(false),
    description: z.string().optional(),
    defaultValue: z.json().optional(),
    itemType: z.enum(["string", "number", "boolean", "object", "enum"]).optional(),
    enumValues: z.array(z.string()).optional(),
});

export const AgentProfileVariableItemDtoSchema = z.object({
    label: z.string().trim().min(1),
    value: z.string(),
    path: z.string().trim().min(1),
    editable: z.boolean().default(false),
    valueType: z.string().trim().min(1).nullable().default(null),
    source: z.string().trim().min(1).nullable().default(null),
    schema: z.record(z.string(), z.json()).nullable().default(null),
});

export const AgentProfileVariableGroupDtoSchema = z.object({
    group: z.string().trim().min(1),
    items: z.array(AgentProfileVariableItemDtoSchema),
});

/**
 * profile 模块 manifest 摘要。
 */
export const AgentProfileManifestDtoSchema = z.object({
    key: z.string().trim().min(1),
    kind: AgentProfileKindSchema,
    name: z.string().trim().min(1),
    description: z.string().trim().min(1).nullable(),
});

/**
 * profile catalog 列表项。
 */
export const AgentProfileCatalogItemDtoSchema = z.object({
    profileKey: z.string().trim().min(1),
    kind: AgentProfileKindSchema.nullable(),
    name: z.string().trim().min(1),
    description: z.string().trim().min(1).nullable(),
    fileName: z.string().trim().min(1).nullable(),
    source: AgentProfileSourceSchema,
    overrideState: AgentProfileOverrideStateSchema,
    loadStatus: AgentProfileLoadStatusSchema,
    schemaLocked: z.boolean(),
    canEdit: z.boolean(),
    canRestore: z.boolean(),
    creationMode: z.enum(["public", "system_only"]),
    issues: z.array(AgentProfileIssueDtoSchema),
});

/**
 * profile schema 在源码中的可编辑状态。
 */
export const AgentProfileSchemaDetailDtoSchema = z.object({
    jsonSchema: z.record(z.string(), z.json()).nullable(),
    editMode: AgentProfileSchemaEditModeSchema,
    reason: z.string().trim().min(1),
    sourceRange: z.object({
        start: z.number().int().nonnegative(),
        end: z.number().int().nonnegative(),
    }).nullable(),
});

/**
 * profile 详情请求。
 */
export const AgentProfileDetailRequestDtoSchema = z.object({
    profileKey: z.string().trim().min(1).optional(),
    fileName: z.string().trim().min(1).optional(),
}).refine((value) => Boolean(value.profileKey || value.fileName), {
    message: "profileKey 和 fileName 至少提供一个",
});

/**
 * profile 详情。
 */
export const AgentProfileDetailDtoSchema = z.object({
    catalogItem: AgentProfileCatalogItemDtoSchema,
    manifest: AgentProfileManifestDtoSchema.nullable(),
    fileName: z.string().trim().min(1).nullable(),
    source: z.string(),
    issues: z.array(AgentProfileIssueDtoSchema),
    variables: z.array(AgentProfileVariableGroupDtoSchema),
    toolKeys: z.array(z.string()),
    initialSchema: AgentProfileSchemaDetailDtoSchema,
    payloadSchema: AgentProfileSchemaDetailDtoSchema,
    outputSchema: AgentProfileSchemaDetailDtoSchema,
    reportResultSchema: z.record(z.string(), z.json()).nullable().optional(),
    reportSidecarResultSchema: z.record(z.string(), z.json()).nullable().optional(),
    root: AgentProfilePromptNodeDtoSchema.nullable().optional(),
});

/**
 * 真实 profile.prepare 预览请求。
 */
export const AgentProfilePreparePreviewRequestDtoSchema = z.object({
    profileKey: z.string().trim().min(1),
    /** 不依赖既有 Session 时，用于构造 Project scope 的真实 effective config。 */
    projectPath: z.string().trim().min(1).optional(),
    /** 配置中心尚未保存的完整有效 settings；缺省时预览当前已保存配置。 */
    settingsOverride: LowCodeJsonObjectSchema.optional(),
    /** 与 settingsOverride 一起应用到只读 Profile Home 覆盖层，不写真实资源。 */
    resourceMutations: z.array(LowCodeResourceMutationDtoSchema).optional(),
    /** 完整 initial JSON；优先级高于 Session 与 initialOverrides。 */
    initial: z.json().optional(),
    /** 可选真实 Session 上下文；未显式传 initial 时复用该 Session 的创建期 initial。 */
    sessionId: z.string().trim().min(1).optional(),
    /** Workbench 自由文本字段构造的 initial；仅在没有 initial 和 Session 时使用。 */
    initialOverrides: z.record(z.string(), z.string()).optional(),
    /**
     * 仅用于 Workbench 显式验证未保存源码；服务端会在临时 profile root 中预览。
     */
    sourceOverride: z.object({
        fileName: z.string().trim().min(1),
        source: z.string(),
    }).optional(),
    historyMessages: z.array(z.object({
        role: z.enum(["system", "human", "assistant"]),
        text: z.string(),
    })).optional(),
}).superRefine((value, ctx) => {
    if ((value.resourceMutations?.length ?? 0) > 0 && value.settingsOverride === undefined) {
        ctx.addIssue({code: "custom", path: ["settingsOverride"], message: "预览资源草稿时必须同时提供 settingsOverride"});
    }
});

/**
 * 真实 profile.prepare 预览结果。
 */
export const AgentProfilePreparePreviewDtoSchema = z.object({
    profileKey: z.string().trim().min(1),
    ok: z.boolean(),
    issues: z.array(AgentProfileIssueDtoSchema),
    messages: z.array(z.object({
        role: z.string().trim().min(1),
        text: z.string(),
        source: z.string().trim().min(1).nullable(),
        toolCalls: z.array(z.object({
            id: z.string().trim().min(1),
            name: z.string().trim().min(1),
            argsText: z.string(),
        })).optional(),
    })),
    persistedMessageCount: z.number().int().nonnegative(),
    variables: z.array(AgentProfileVariableGroupDtoSchema),
    reportResultSchema: z.record(z.string(), z.json()).nullable().optional(),
    reportSidecarResultSchema: z.record(z.string(), z.json()).nullable().optional(),
});

/**
 * 用户 profile 文件摘要。这里面可以包含坏文件，和 runtime catalog 分开。
 */
export const AgentProfileFileItemDtoSchema = z.object({
    fileName: z.string().trim().min(1),
    profileKey: z.string().trim().min(1).nullable(),
    name: z.string().trim().min(1),
    loadStatus: AgentProfileLoadStatusSchema,
    issues: z.array(AgentProfileIssueDtoSchema),
});

/**
 * profile 源码文件详情请求。fileName 是用户 profile root 下的相对路径。
 */
export const AgentProfileSourceRequestDtoSchema = z.object({
    fileName: z.string().trim().min(1),
    /**
     * 仅用于显式验证未保存源码；普通读取不传，仍读取磁盘文件。
     */
    source: z.string().optional(),
});

/**
 * 轻量源码草稿解析请求。只解析 TSX DSL tree，不加载 runtime profile。
 */
export const AgentProfileSourceDraftRequestDtoSchema = z.object({
    fileName: z.string().trim().min(1),
    source: z.string().optional(),
});

/**
 * profile 源码保存请求。
 */
export const AgentProfileSaveRequestDtoSchema = z.object({
    fileName: z.string().trim().min(1),
    source: z.string(),
});

/**
 * 手动编译用户 profile 源码。编译在后台 worker 中执行，避免阻塞 Nitro 主线程。
 */
export const AgentProfileCompileRequestDtoSchema = z.object({
    fileName: z.string().trim().min(1),
    /**
     * 兼容旧 Workbench 请求；runtime artifact 编译只读取已保存磁盘源码。
     * 传入时仅用于 compile 前保存，或后续 dry-run preview。
     */
    source: z.string().optional(),
    /**
     * 为 true 时只在后台 worker 中用临时 profile root 做 prepare preview，不写用户 `.compiled`。
     */
    dryRun: z.boolean().default(false),
    preview: z.boolean().default(false),
    sessionId: z.string().trim().min(1).optional(),
    initial: z.json().optional(),
    initialOverrides: z.record(z.string(), z.string()).optional(),
});

/**
 * 手动编译全部用户 profile 源码。只写用户 profile root 的 `.compiled`。
 */
export const AgentProfileCompileAllRequestDtoSchema = z.object({
    preview: z.boolean().default(false),
});

/**
 * 手动编译结果。detail 是 runtime profile 详情，preview 只有请求 preview=true 时返回。
 */
export const AgentProfileCompileResultDtoSchema = z.object({
    ok: z.boolean(),
    stale: z.boolean().default(false),
    detail: AgentProfileDetailDtoSchema.nullable(),
    preview: AgentProfilePreparePreviewDtoSchema.nullable().optional(),
    issues: z.array(AgentProfileIssueDtoSchema),
    elapsedMs: z.number().nonnegative().optional(),
    compiledCount: z.number().int().nonnegative().optional(),
    profiles: z.array(z.object({
        profileKey: z.string().trim().min(1),
        fileName: z.string().trim().min(1),
        loadStatus: AgentProfileLoadStatusSchema,
    })).optional(),
});

/**
 * 新建用户 profile 请求。
 */
export const AgentProfileCreateRequestDtoSchema = z.object({
    profileKey: z.string().trim().min(1),
    templateName: z.enum(["basic-agent", "report-agent"]).default("basic-agent"),
    name: z.string().trim().min(1),
    description: z.string().optional(),
    systemPrompt: z.string().trim().min(1),
    fileName: z.string().trim().min(1).optional(),
});

/**
 * profile 模板摘要。
 */
export const AgentProfileTemplateItemDtoSchema = z.object({
    name: z.string().trim().min(1),
    fileName: z.string().trim().min(1),
    label: z.string().trim().min(1),
    description: z.string().trim().min(1),
});

export type AgentProfileIssueDto = z.infer<typeof AgentProfileIssueDtoSchema>;
export type AgentProfileSchemaFieldDto = z.infer<typeof AgentProfileSchemaFieldDtoSchema>;
export type AgentProfileVariableItemDto = z.infer<typeof AgentProfileVariableItemDtoSchema>;
export type AgentProfileVariableGroupDto = z.infer<typeof AgentProfileVariableGroupDtoSchema>;
export type AgentProfileCatalogItemDto = z.infer<typeof AgentProfileCatalogItemDtoSchema>;
export type AgentProfileManifestDto = z.infer<typeof AgentProfileManifestDtoSchema>;
export type AgentProfileSchemaDetailDto = z.infer<typeof AgentProfileSchemaDetailDtoSchema>;
export type AgentProfileDetailRequestDto = z.infer<typeof AgentProfileDetailRequestDtoSchema>;
export type AgentProfileDetailDto = Omit<z.infer<typeof AgentProfileDetailDtoSchema>, "issues" | "variables"> & {
    issues: AgentProfileIssueDto[];
    variables: AgentProfileVariableGroupDto[];
};
export type AgentProfilePreparePreviewRequestDto = z.infer<typeof AgentProfilePreparePreviewRequestDtoSchema>;
export type AgentProfilePreparePreviewDto = z.infer<typeof AgentProfilePreparePreviewDtoSchema>;
export type AgentProfileFileItemDto = z.infer<typeof AgentProfileFileItemDtoSchema>;
export type AgentProfileSourceRequestDto = z.infer<typeof AgentProfileSourceRequestDtoSchema>;
export type AgentProfileSourceDraftRequestDto = z.infer<typeof AgentProfileSourceDraftRequestDtoSchema>;
export type AgentProfileSaveRequestDto = z.infer<typeof AgentProfileSaveRequestDtoSchema>;
export type AgentProfileCompileRequestDto = z.infer<typeof AgentProfileCompileRequestDtoSchema>;
export type AgentProfileCompileAllRequestDto = z.infer<typeof AgentProfileCompileAllRequestDtoSchema>;
export type AgentProfileCompileResultDto = Omit<z.infer<typeof AgentProfileCompileResultDtoSchema>, "detail" | "preview" | "issues"> & {
    detail: AgentProfileDetailDto | null;
    preview?: AgentProfilePreparePreviewDto | null;
    issues: AgentProfileIssueDto[];
};
export type AgentProfileCreateRequestDto = z.infer<typeof AgentProfileCreateRequestDtoSchema>;
export type AgentProfileTemplateItemDto = z.infer<typeof AgentProfileTemplateItemDtoSchema>;
