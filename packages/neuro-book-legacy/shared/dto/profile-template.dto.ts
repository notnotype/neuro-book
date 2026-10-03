import {z} from "zod";

/**
 * 可视化编辑器支持的 profile 模板节点类型。
 */
export const ProfileTemplateNodeTypeSchema = z.enum([
    "ProfilePrompt",
    "System",
    "HistorySet",
    "ModelContext",
    "AppendingSet",
    "FileChangeNotice",
    "Compaction",
    "CompactionPrompt",
    "CompactionSummaryPrefix",
    "Text",
    "Message",
    "AIMessage",
    "ToolCall",
    "ToolResult",
    "Reminder",
    "Watch",
    "If",
    "SystemReminder",
    "LinkedAgentsSummary",
    "LinkedAgentsReminder",
    "WorkspaceFocusReminder",
    "ModeAvailabilityReminder",
    "TaskReminder",
    "ModeReminder",
    "ModeSlot",
    "MentionedSkillsReminder",
    "AgentCatalog",
    "SkillCatalog",
    "WorkflowCatalog",
    "ActivatedSkills",
    "SqlSchemaSummary",
    "Import",
]);

/**
 * 可视化编辑器支持的表达式值。
 */
export const ProfileTemplateExpressionValueSchema = z.object({
    kind: z.literal("expression"),
    code: z.string(),
});

/**
 * 模板节点属性值。
 * 低代码编辑器第一版只保存字符串、数字、布尔和空值。
 */
export const ProfileTemplatePropValueSchema = z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    ProfileTemplateExpressionValueSchema,
]);

/**
 * 模板节点文本类型。
 */
export const ProfileTemplateTextKindSchema = z.enum([
    "text",
    "source",
    "template",
]);

export const ProfileTemplateIssueSeveritySchema = z.enum(["error", "warning"]);

export type ProfileTemplateNodeType = z.infer<typeof ProfileTemplateNodeTypeSchema>;
export type ProfileTemplateExpressionValue = z.infer<typeof ProfileTemplateExpressionValueSchema>;
export type ProfileTemplatePropValue = z.infer<typeof ProfileTemplatePropValueSchema>;
export type ProfileTemplateTextKind = z.infer<typeof ProfileTemplateTextKindSchema>;
export type ProfileTemplateIssueSeverity = z.infer<typeof ProfileTemplateIssueSeveritySchema>;

export type ProfileTemplateNodeDto = {
    id: string;
    type: ProfileTemplateNodeType;
    props: Record<string, ProfileTemplatePropValue>;
    children: ProfileTemplateNodeDto[];
    text?: string;
    textKind?: ProfileTemplateTextKind;
    editable: boolean;
    sourceRange?: {
        start: number;
        end: number;
    };
};

/**
 * 可视化编辑器内部模板节点。
 */
export const ProfileTemplateNodeDtoSchema: z.ZodType<ProfileTemplateNodeDto> = z.lazy(() => z.object({
    id: z.string().trim().min(1, "节点 id 不能为空"),
    type: ProfileTemplateNodeTypeSchema,
    props: z.record(z.string(), ProfileTemplatePropValueSchema).default({}),
    children: z.array(ProfileTemplateNodeDtoSchema).default([]),
    text: z.string().optional(),
    textKind: ProfileTemplateTextKindSchema.optional(),
    editable: z.boolean().default(true),
    sourceRange: z.object({
        start: z.number().int().nonnegative(),
        end: z.number().int().nonnegative(),
    }).optional(),
}));

/**
 * 模板校验问题。
 */
export const ProfileTemplateIssueDtoSchema = z.object({
    severity: ProfileTemplateIssueSeveritySchema,
    message: z.string().trim().min(1),
    nodeId: z.string().trim().min(1).optional(),
    path: z.string().trim().min(1).optional(),
    sourceText: z.string().optional(),
    sourceRange: z.object({
        start: z.number().int().nonnegative(),
        end: z.number().int().nonnegative(),
    }).optional(),
});

/**
 * 模板摘要。
 */
export const ProfileTemplateSummaryDtoSchema = z.object({
    name: z.string().trim().min(1),
    fileName: z.string().trim().min(1),
    profileKey: z.string().trim().min(1).nullable(),
});

/**
 * 用户 assets profile 文件请求。
 */
export const UserProfileTemplateFileRequestDtoSchema = z.object({
    fileName: z.string().trim().min(1),
});

/**
 * 新建用户 assets profile 请求。
 */
export const CreateUserProfileTemplateRequestDtoSchema = z.object({
    profileKey: z.string().trim().min(1),
    kind: z.enum(["basic", "report"]),
    name: z.string().trim().min(1),
    description: z.string().trim().min(1).optional(),
    prompt: z.string().trim().min(1),
    fileName: z.string().trim().min(1).optional(),
});

/**
 * 模板变量面板中的单个变量。
 */
export type ProfileTemplateVariableItemDto = {
    label: string;
    value: string;
    path: string;
    currentValue?: unknown;
    editable: boolean;
    description?: string;
    valueType: string;
    source: string;
    schema?: Record<string, unknown> | null;
    children?: ProfileTemplateVariableItemDto[];
};

export const ProfileTemplateVariableItemDtoSchema: z.ZodType<ProfileTemplateVariableItemDto> = z.lazy(() => z.object({
    label: z.string().trim().min(1),
    value: z.string().trim().min(1),
    path: z.string().trim().min(1),
    currentValue: z.json().nullable().optional(),
    editable: z.boolean().default(false),
    description: z.string().trim().min(1).optional(),
    valueType: z.string().trim().min(1),
    source: z.string().trim().min(1),
    schema: z.record(z.string(), z.json()).nullable().optional(),
    children: z.array(ProfileTemplateVariableItemDtoSchema).optional(),
}));

/**
 * 模板变量分组。
 */
export const ProfileTemplateVariableGroupDtoSchema = z.object({
    group: z.string().trim().min(1),
    items: z.array(ProfileTemplateVariableItemDtoSchema),
});

/**
 * 模板详情。
 */
export const ProfileTemplateDetailDtoSchema = z.object({
    name: z.string().trim().min(1),
    fileName: z.string().trim().min(1),
    source: z.string(),
    root: ProfileTemplateNodeDtoSchema.nullable(),
    issues: z.array(ProfileTemplateIssueDtoSchema),
    variables: z.array(ProfileTemplateVariableGroupDtoSchema),
});

/**
 * 保存模板请求。
 */
export const SaveProfileTemplateRequestDtoSchema = z.object({
    source: z.string().optional(),
    root: ProfileTemplateNodeDtoSchema.optional(),
}).refine((value) => value.source !== undefined || value.root !== undefined, {
    message: "source 和 root 至少提供一个",
});

/**
 * 校验模板请求。
 */
export const ValidateProfileTemplateRequestDtoSchema = z.object({
    source: z.string().optional(),
    root: ProfileTemplateNodeDtoSchema.optional(),
}).refine((value) => value.source !== undefined || value.root !== undefined, {
    message: "source 和 root 至少提供一个",
});

/**
 * 预览模板请求。
 */
export const PreviewProfileTemplateRequestDtoSchema = z.object({
    source: z.string().optional(),
    root: ProfileTemplateNodeDtoSchema.optional(),
    threadId: z.string().trim().min(1).optional(),
    initialOverrides: z.record(z.string(), z.json()).optional(),
}).refine((value) => value.source !== undefined || value.root !== undefined, {
    message: "source 和 root 至少提供一个",
});

/**
 * 渲染后的预览消息。
 */
export const ProfileTemplatePreviewMessageDtoSchema = z.object({
    role: z.string().trim().min(1),
    text: z.string(),
    source: z.string().trim().min(1).nullable(),
    toolCalls: z.array(z.object({
        id: z.string().trim().min(1),
        name: z.string().trim().min(1),
        argsText: z.string(),
    })).optional(),
});

/**
 * 模板预览结果。
 */
export const ProfileTemplatePreviewDtoSchema = z.object({
    source: z.string(),
    root: ProfileTemplateNodeDtoSchema.nullable(),
    issues: z.array(ProfileTemplateIssueDtoSchema),
    messages: z.array(ProfileTemplatePreviewMessageDtoSchema),
    variables: z.array(ProfileTemplateVariableGroupDtoSchema),
});

export type ProfileTemplateIssueDto = z.infer<typeof ProfileTemplateIssueDtoSchema>;
export type ProfileTemplateSummaryDto = z.infer<typeof ProfileTemplateSummaryDtoSchema>;
export type UserProfileTemplateFileRequestDto = z.infer<typeof UserProfileTemplateFileRequestDtoSchema>;
export type CreateUserProfileTemplateRequestDto = z.infer<typeof CreateUserProfileTemplateRequestDtoSchema>;
export type ProfileTemplateVariableGroupDto = z.infer<typeof ProfileTemplateVariableGroupDtoSchema>;
export type ProfileTemplateDetailDto = z.infer<typeof ProfileTemplateDetailDtoSchema>;
export type SaveProfileTemplateRequestDto = z.infer<typeof SaveProfileTemplateRequestDtoSchema>;
export type ValidateProfileTemplateRequestDto = z.infer<typeof ValidateProfileTemplateRequestDtoSchema>;
export type PreviewProfileTemplateRequestDto = z.infer<typeof PreviewProfileTemplateRequestDtoSchema>;
export type ProfileTemplatePreviewMessageDto = z.infer<typeof ProfileTemplatePreviewMessageDtoSchema>;
export type ProfileTemplatePreviewDto = z.infer<typeof ProfileTemplatePreviewDtoSchema>;
