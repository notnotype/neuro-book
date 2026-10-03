import {z} from "zod";

export const WorkspaceIssueLevelDtoSchema = z.enum(["P1", "P2", "P3", "WARN"]);

export const WorkspaceFileIssueDtoSchema = z.object({
    level: WorkspaceIssueLevelDtoSchema,
    code: z.string(),
    path: z.string(),
    message: z.string(),
    line: z.number().optional(),
});

export const WorkspaceIssueSummaryDtoSchema = z.object({
    selfCount: z.number().int().nonnegative(),
    subtreeCount: z.number().int().nonnegative(),
    count: z.number().int().nonnegative(),
    highestLevel: WorkspaceIssueLevelDtoSchema.nullable(),
});

export type WorkspaceFileIssueDto = z.infer<typeof WorkspaceFileIssueDtoSchema>;
export type WorkspaceIssueSummaryDto = z.infer<typeof WorkspaceIssueSummaryDtoSchema>;

export type WorkspaceTreeSnapshotDto<TNode = unknown> = {
    nodes: TNode[];
    issues: WorkspaceFileIssueDto[];
    revision: number;
    validatedAt: string;
};

