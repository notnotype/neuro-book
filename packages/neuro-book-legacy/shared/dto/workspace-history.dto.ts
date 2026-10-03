import {z} from "zod";

/**
 * Workspace 文件历史（Task 95）收件箱 DTO。
 * 收件箱只传摘要与 hash 引用；正文必须通过按当前 inbox path 授权的安全 diff 接口按需读取。
 */

/** 收件箱条目摘要。 */
export const WorkspaceHistoryEntryDtoSchema = z.object({
    id: z.number(),
    /** ISO-8601 UTC */
    occurredAt: z.string(),
    actorKind: z.enum(["user", "agent", "system", "external"]),
    /** 归因细节：agent = sessionId、system = source、user = userId；external 为 null */
    actorDetail: z.string().nullable(),
    /** file.create / file.edit / file.delete / file.rename / file.revert / file.restore */
    operationType: z.string(),
});
export type WorkspaceHistoryEntryDto = z.infer<typeof WorkspaceHistoryEntryDtoSchema>;

/** 收件箱分组（每文件一组）。 */
export const WorkspaceHistoryInboxGroupDtoSchema = z.object({
    /** 现名（rename 已跟随） */
    path: z.string(),
    /** 当前分组最后一条 entry id；diff / accept / revert 的并发前置条件 */
    revision: z.number().int().positive(),
    /** diff 基准内容 hash；null = 基准是「文件不存在」（按空文本 diff） */
    baseHash: z.string().nullable(),
    /** 账面末态内容 hash；null = 文件现已删除（按空文本 diff） */
    endHash: z.string().nullable(),
    entries: z.array(WorkspaceHistoryEntryDtoSchema),
});
export type WorkspaceHistoryInboxGroupDto = z.infer<typeof WorkspaceHistoryInboxGroupDtoSchema>;

export const WorkspaceHistoryInboxDtoSchema = z.object({
    /** 当前收件箱内最大的 group revision；空收件箱为 0 */
    revision: z.number().int().nonnegative(),
    groups: z.array(WorkspaceHistoryInboxGroupDtoSchema),
});
export type WorkspaceHistoryInboxDto = z.infer<typeof WorkspaceHistoryInboxDtoSchema>;

export const WorkspaceHistoryDiffChangeDtoSchema = z.object({
    value: z.string(),
    added: z.boolean().optional(),
    removed: z.boolean().optional(),
    count: z.number().optional(),
});
export type WorkspaceHistoryDiffChangeDto = z.infer<typeof WorkspaceHistoryDiffChangeDtoSchema>;

/**
 * 安全 diff 契约：blocked / too_large / unavailable 分支绝不携带文件正文。
 */
export const WorkspaceHistoryDiffDtoSchema = z.discriminatedUnion("status", [
    z.object({
        status: z.literal("available"),
        original: z.string(),
        modified: z.string(),
        changes: z.array(WorkspaceHistoryDiffChangeDtoSchema),
        byteSize: z.number(),
        changedLineCount: z.number(),
    }),
    z.object({
        status: z.literal("blocked"),
        reason: z.literal("sensitive_path"),
    }),
    z.object({
        status: z.literal("too_large"),
        reason: z.literal("inline_limit"),
        byteSize: z.number(),
        changedLineCount: z.number(),
    }),
    z.object({
        status: z.literal("unavailable"),
        reason: z.enum(["before-missing", "after-missing", "binary", "history_disabled"]),
    }),
]);
export type WorkspaceHistoryDiffDto = z.infer<typeof WorkspaceHistoryDiffDtoSchema>;
