import {z} from "zod";

/** Composer 草稿只能属于 Workspace Root 或一个单段 Project Root。 */
export const AgentComposerDraftScopeKeySchema = z.union([
    z.literal("workspace-root"),
    z.string().regex(/^project:[^/\\:]+$/u, "Composer 草稿 Project Root 必须是单段名称"),
]);

/** 一个草稿的稳定身份；Session id 在同一 Workspace Root 内唯一。 */
export const AgentComposerDraftIdentitySchema = z.object({
    scopeKey: AgentComposerDraftScopeKeySchema,
    sessionId: z.number().int().positive(),
});

/** GET query 会从 URL 字符串收窄为稳定身份。 */
export const AgentComposerDraftQuerySchema = AgentComposerDraftIdentitySchema.extend({
    sessionId: z.coerce.number().int().positive(),
});

/** 正常保存请求；字节预算由服务端按 UTF-8 重新校验。 */
export const AgentComposerDraftSaveRequestSchema = AgentComposerDraftIdentitySchema.extend({
    text: z.string(),
});

/** 首次迁移保留旧记录的更新时间，服务端据此和已有磁盘草稿合并。 */
export const AgentComposerDraftMigrationRecordSchema = AgentComposerDraftSaveRequestSchema.extend({
    updatedAt: z.number().int().nonnegative(),
});

export const AgentComposerDraftMigrationRequestSchema = z.object({
    drafts: z.array(AgentComposerDraftMigrationRecordSchema).max(10),
});

export type AgentComposerDraftScopeKey = z.infer<typeof AgentComposerDraftScopeKeySchema>;
export type AgentComposerDraftIdentity = z.infer<typeof AgentComposerDraftIdentitySchema>;
export type AgentComposerDraftSaveRequest = z.infer<typeof AgentComposerDraftSaveRequestSchema>;
export type AgentComposerDraftMigrationRecord = z.infer<typeof AgentComposerDraftMigrationRecordSchema>;
export type AgentComposerDraftMigrationRequest = z.infer<typeof AgentComposerDraftMigrationRequestSchema>;

export type AgentComposerDraftLoadResult = {
    text: string;
};

export type AgentComposerDraftSaveResult = "saved" | "cleared" | "oversize" | "unsafe";

export type AgentComposerDraftMigrationResult = {
    migrated: number;
};
