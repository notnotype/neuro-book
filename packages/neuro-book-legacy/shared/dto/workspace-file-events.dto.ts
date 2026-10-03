import {z} from "zod";

export const WorkspaceFileEventKindSchema = z.enum(["add", "change", "unlink", "addDir", "unlinkDir"]);

export const WorkspaceFileChangeEventDtoSchema = z.object({
    kind: WorkspaceFileEventKindSchema,
    path: z.string(),
});

export const WorkspaceWatchReadyEventDtoSchema = z.object({
    type: z.literal("workspace_watch_ready"),
    root: z.string(),
    sequence: z.number().int().nonnegative(),
    changedAt: z.string(),
});

export const WorkspaceFilesChangedEventDtoSchema = z.object({
    type: z.literal("workspace_files_changed"),
    root: z.string(),
    sequence: z.number().int().nonnegative(),
    revision: z.number().int().nonnegative().optional(),
    validatedAt: z.string().optional(),
    changedAt: z.string(),
    events: z.array(WorkspaceFileChangeEventDtoSchema),
});

export const WorkspaceFileStreamEventDtoSchema = z.discriminatedUnion("type", [
    WorkspaceWatchReadyEventDtoSchema,
    WorkspaceFilesChangedEventDtoSchema,
]);

export type WorkspaceFileEventKind = z.infer<typeof WorkspaceFileEventKindSchema>;
export type WorkspaceFileChangeEventDto = z.infer<typeof WorkspaceFileChangeEventDtoSchema>;
export type WorkspaceWatchReadyEventDto = z.infer<typeof WorkspaceWatchReadyEventDtoSchema>;
export type WorkspaceFilesChangedEventDto = z.infer<typeof WorkspaceFilesChangedEventDtoSchema>;
export type WorkspaceFileStreamEventDto = z.infer<typeof WorkspaceFileStreamEventDtoSchema>;
