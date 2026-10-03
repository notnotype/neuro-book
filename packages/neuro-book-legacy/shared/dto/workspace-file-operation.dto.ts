import {z} from "zod";
import {WorkspaceFileBindingDtoSchema} from "nbook/shared/dto/workspace-file-binding.dto";

export const WorkspaceFileOperationKindSchema = z.enum(["copy", "move"]);
export type WorkspaceFileOperationKind = z.infer<typeof WorkspaceFileOperationKindSchema>;

const TargetNameSchema = z.string().min(1).refine(
    (name) => name.trim().length > 0 && name === name.trim() && name !== "." && name !== ".." && !/[\\/]/u.test(name),
    "目标名称必须是单个文件名",
);
export const WorkspaceFileSourceIdentitySchema = z.object({
    dev: z.number().finite(),
    ino: z.number().finite(),
    birthtimeMs: z.number().finite(),
    mtimeMs: z.number().finite(),
    size: z.number().finite(),
}).strict();
export type WorkspaceFileSourceIdentity = z.infer<typeof WorkspaceFileSourceIdentitySchema>;

const OperationFieldsSchema = z.object({
    kind: WorkspaceFileOperationKindSchema,
    sources: z.array(z.string().trim().min(1)).min(1).max(256),
    destination: z.string().trim(),
    targetNames: z.record(z.string(), TargetNameSchema).optional(),
    expectedSources: z.record(z.string(), WorkspaceFileSourceIdentitySchema).optional(),
});

export const WorkspaceFileOperationRequestSchema = z.union([
    WorkspaceFileBindingDtoSchema.options[0].extend(OperationFieldsSchema.shape),
    WorkspaceFileBindingDtoSchema.options[1].extend(OperationFieldsSchema.shape),
]);
export type WorkspaceFileOperationRequest = z.infer<typeof WorkspaceFileOperationRequestSchema>;

export const WorkspaceFileOperationItemSchema = z.object({
    source: z.string(),
    target: z.string(),
    status: z.enum(["success", "failed", "skipped", "not-executed", "cancelled", "unknown"]),
    stopReason: z.enum(["binding", "authorization"]).optional(),
    reason: z.string().optional(),
    residualPaths: z.array(z.string()).optional(),
});
export type WorkspaceFileOperationItem = z.infer<typeof WorkspaceFileOperationItemSchema>;

export const WorkspaceFileOperationResponseSchema = z.object({
    kind: WorkspaceFileOperationKindSchema,
    destination: z.string(),
    items: z.array(WorkspaceFileOperationItemSchema),
});
export type WorkspaceFileOperationResponse = z.infer<typeof WorkspaceFileOperationResponseSchema>;
