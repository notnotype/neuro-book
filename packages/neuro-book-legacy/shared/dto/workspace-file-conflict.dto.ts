import {z} from "zod";
import {WorkspaceFileChangeEventDtoSchema} from "nbook/shared/dto/workspace-file-events.dto";

const WorkspaceConflictNodeSchema = z.object({
    path: z.string(),
    mtimeMs: z.number(),
    editable: z.boolean(),
    isDirectory: z.boolean(),
}).passthrough();

export const WorkspaceWriteConflictDtoSchema = z.object({
    kind: z.literal("workspace_write_conflict"),
    path: z.string(),
    expectedMtimeMs: z.number().nullable(),
    actualMtimeMs: z.number().nullable(),
    remoteExists: z.boolean(),
    baseContent: z.string(),
    localContent: z.string(),
    remoteContent: z.string(),
    mergedContent: z.string(),
    localDiff: z.string(),
    remoteDiff: z.string(),
    node: WorkspaceConflictNodeSchema.nullable(),
    event: WorkspaceFileChangeEventDtoSchema.nullable(),
});

export type WorkspaceWriteConflictDto = z.infer<typeof WorkspaceWriteConflictDtoSchema>;
