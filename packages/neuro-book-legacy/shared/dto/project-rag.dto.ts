import {z} from "zod";

const ProjectRagSubjectPathSchema = z.string()
    .trim()
    .min(1, "subjectPath 不能为空")
    .regex(/^simulation\/subjects\/[^/]+$/u, "subjectPath 必须形如 simulation/subjects/<subject-id>");

const ProjectRagTextSchema = z.string().trim().min(1, "text 不能为空");
const ProjectRagSourceSchema = z.enum(["events", "memory"]);
const ProjectRagInspectorLimitSchema = z.union([z.literal(100), z.literal(200), z.literal(500)]);

export const ProjectRagIndexStatusDtoSchema = z.enum(["synced", "dirty", "error", "not_indexed", "unknown"]);

export const ProjectRagSourceStatusDtoSchema = z.object({
    source: ProjectRagSourceSchema,
    status: ProjectRagIndexStatusDtoSchema,
    recordCount: z.number().int().nonnegative(),
    indexedAt: z.string().nullable(),
    lastError: z.string().nullable(),
});

export const ProjectRagSubjectSummaryDtoSchema = z.object({
    subjectPath: ProjectRagSubjectPathSchema,
    subjectId: z.string().trim().min(1),
    metadata: z.object({
        id: z.string().trim().min(1).nullable(),
        name: z.string().trim().min(1).nullable(),
        kind: z.string().trim().min(1).nullable(),
        profile: z.string().trim().min(1).nullable(),
        controlledBy: z.string().trim().min(1).nullable(),
        canonicalSource: z.string().trim().min(1).nullable(),
        frontmatterError: z.string().nullable(),
    }),
    eventCount: z.number().int().nonnegative(),
    memoryCount: z.number().int().nonnegative(),
    subjectFileExists: z.boolean(),
    soulFileExists: z.boolean(),
    mindFileExists: z.boolean(),
    stateFileExists: z.boolean(),
    sourceStatuses: z.array(ProjectRagSourceStatusDtoSchema),
    errors: z.array(z.object({
        source: ProjectRagSourceSchema,
        message: z.string(),
    })),
});

export const ProjectRagOverviewDtoSchema = z.object({
    projectRoot: z.string().trim().min(1),
    subjects: z.array(ProjectRagSubjectSummaryDtoSchema),
});

export const ProjectRagEventDtoSchema = z.object({
    line: z.number().int().positive(),
    tick: z.string().optional(),
    time: z.string().optional(),
    text: ProjectRagTextSchema,
});

export const ProjectRagMemoryDtoSchema = z.object({
    line: z.number().int().positive(),
    topic: z.string().trim().min(1, "topic 不能为空"),
    aliases: z.array(z.string().trim().min(1)).optional(),
    view: z.string().trim().min(1, "view 不能为空"),
});

export const ProjectRagSubjectDtoSchema = z.object({
    projectRoot: z.string().trim().min(1),
    subjectPath: ProjectRagSubjectPathSchema,
    subjectId: z.string().trim().min(1),
    events: z.array(ProjectRagEventDtoSchema),
    memories: z.array(ProjectRagMemoryDtoSchema),
    sourceStatuses: z.array(ProjectRagSourceStatusDtoSchema),
    errors: z.array(z.object({
        source: ProjectRagSourceSchema,
        message: z.string(),
    })),
});

export const ProjectRagSearchRequestDtoSchema = z.object({
    subjectPath: ProjectRagSubjectPathSchema,
    query: ProjectRagTextSchema,
    sources: z.array(ProjectRagSourceSchema).min(1).optional(),
    limit: z.number().int().min(1).max(20).optional(),
});

export const ProjectRagSearchResultDtoSchema = z.object({
    projectRoot: z.string().trim().min(1),
    subjectPath: ProjectRagSubjectPathSchema,
    candidates: z.array(z.object({
        source: ProjectRagSourceSchema,
        text: z.string(),
        topic: z.string().optional(),
        tick: z.string().optional(),
        time: z.string().optional(),
        rank: z.number().int().positive(),
        sourcePath: z.string(),
    })),
});

export const ProjectRagRebuildRequestDtoSchema = z.object({
    subjectPath: ProjectRagSubjectPathSchema.optional(),
});

export const ProjectRagRebuildResultDtoSchema = z.object({
    projectRoot: z.string().trim().min(1),
    rebuiltSubjects: z.number().int().nonnegative(),
    skippedSubjects: z.number().int().nonnegative(),
    results: z.array(z.object({
        subjectPath: ProjectRagSubjectPathSchema,
        ok: z.boolean(),
        message: z.string().nullable(),
    })),
});

export const ProjectRagEventInputDtoSchema = z.object({
    tick: z.string().optional(),
    time: z.string().optional(),
    text: ProjectRagTextSchema,
});

export const ProjectRagEventWriteRequestDtoSchema = z.object({
    subjectPath: ProjectRagSubjectPathSchema,
    index: z.number().int().nonnegative().optional(),
    event: ProjectRagEventInputDtoSchema,
});

export const ProjectRagEventDeleteRequestDtoSchema = z.object({
    subjectPath: ProjectRagSubjectPathSchema,
    index: z.number().int().nonnegative(),
});

export const ProjectRagEventReorderRequestDtoSchema = z.object({
    subjectPath: ProjectRagSubjectPathSchema,
    fromIndex: z.number().int().nonnegative(),
    toIndex: z.number().int().nonnegative(),
});

export const ProjectRagMemoryInputDtoSchema = z.object({
    topic: z.string().trim().min(1, "topic 不能为空"),
    aliases: z.array(z.string().trim().min(1)).optional(),
    view: z.string().trim().min(1, "view 不能为空"),
});

export const ProjectRagMemoryWriteRequestDtoSchema = z.object({
    subjectPath: ProjectRagSubjectPathSchema,
    topic: z.string().trim().min(1, "topic 不能为空").optional(),
    memory: ProjectRagMemoryInputDtoSchema,
});

export const ProjectRagMemoryDeleteRequestDtoSchema = z.object({
    subjectPath: ProjectRagSubjectPathSchema,
    topic: z.string().trim().min(1, "topic 不能为空"),
});

export const ProjectRagDebugActionDtoSchema = z.enum([
    "mark-dirty",
    "delete-subject-index",
    "clear-index-cache",
    "clear-index-cache-and-rebuild",
]);

export const ProjectRagInspectorRequestDtoSchema = z.object({
    subjectPath: ProjectRagSubjectPathSchema.optional(),
    sources: z.array(ProjectRagSourceSchema).min(1).optional(),
    limit: ProjectRagInspectorLimitSchema.optional(),
});

export const ProjectRagInspectorDtoSchema = z.object({
    projectRoot: z.string().trim().min(1),
    selectedSubjectPath: ProjectRagSubjectPathSchema.nullable(),
    sourceFilter: z.array(ProjectRagSourceSchema).min(1),
    limit: ProjectRagInspectorLimitSchema,
    embedding: z.object({
        enabled: z.boolean(),
        provider: z.string(),
        model: z.string().nullable(),
        dimensions: z.number().int().positive().nullable(),
        baseURLConfigured: z.boolean(),
        baseURLLabel: z.string().nullable(),
        apiKeyConfigured: z.boolean(),
    }),
    index: z.object({
        dbExists: z.boolean(),
        schemaVersion: z.string().nullable(),
        embeddingProvider: z.string().nullable(),
        embeddingModel: z.string().nullable(),
        embeddingDimensions: z.number().int().positive().nullable(),
        metaMatchesEffectiveConfig: z.boolean().nullable(),
        readError: z.string().nullable(),
        sourceCount: z.number().int().nonnegative(),
        chunkCount: z.number().int().nonnegative(),
        vectorCount: z.number().int().nonnegative(),
    }),
    subjects: z.array(ProjectRagSubjectSummaryDtoSchema),
    selectedSubject: z.object({
        subjectPath: ProjectRagSubjectPathSchema,
        subjectId: z.string().trim().min(1),
        sourceStatuses: z.array(ProjectRagSourceStatusDtoSchema),
        chunkSourceCounts: z.object({
            events: z.number().int().nonnegative(),
            memory: z.number().int().nonnegative(),
        }),
        chunks: z.array(z.object({
            id: z.number().int().positive(),
            source: ProjectRagSourceSchema,
            sourcePath: z.string(),
            sourceKey: z.string(),
            chunkIndex: z.number().int().nonnegative(),
            topic: z.string().nullable(),
            tick: z.string().nullable(),
            time: z.string().nullable(),
            text: z.string(),
            contentHash: z.string(),
            createdAt: z.string(),
            vector: z.object({
                exists: z.boolean(),
                dimensions: z.number().int().positive().nullable(),
                preview: z.array(z.number()),
                previewDimensions: z.number().int().nonnegative(),
                embeddingProvider: z.string().nullable(),
                embeddingModel: z.string().nullable(),
                embeddingDimensions: z.number().int().positive().nullable(),
                embeddingIndexedAt: z.string().nullable(),
            }),
        })),
        chunksTruncated: z.boolean(),
    }).nullable(),
});

export const ProjectRagDebugRequestDtoSchema = z.discriminatedUnion("action", [
    z.object({
        action: z.literal("mark-dirty"),
        subjectPath: ProjectRagSubjectPathSchema.optional(),
        sources: z.array(ProjectRagSourceSchema).min(1).optional(),
    }),
    z.object({
        action: z.literal("delete-subject-index"),
        subjectPath: ProjectRagSubjectPathSchema,
    }),
    z.object({
        action: z.literal("clear-index-cache"),
    }),
    z.object({
        action: z.literal("clear-index-cache-and-rebuild"),
        subjectPath: ProjectRagSubjectPathSchema.optional(),
    }),
]);

export const ProjectRagDebugResultDtoSchema = z.object({
    projectRoot: z.string().trim().min(1),
    action: ProjectRagDebugActionDtoSchema,
    message: z.string(),
    rebuild: ProjectRagRebuildResultDtoSchema.optional(),
});

export type ProjectRagIndexStatusDto = z.infer<typeof ProjectRagIndexStatusDtoSchema>;
export type ProjectRagSourceStatusDto = z.infer<typeof ProjectRagSourceStatusDtoSchema>;
export type ProjectRagSubjectSummaryDto = z.infer<typeof ProjectRagSubjectSummaryDtoSchema>;
export type ProjectRagOverviewDto = z.infer<typeof ProjectRagOverviewDtoSchema>;
export type ProjectRagEventDto = z.infer<typeof ProjectRagEventDtoSchema>;
export type ProjectRagMemoryDto = z.infer<typeof ProjectRagMemoryDtoSchema>;
export type ProjectRagSubjectDto = z.infer<typeof ProjectRagSubjectDtoSchema>;
export type ProjectRagSearchRequestDto = z.infer<typeof ProjectRagSearchRequestDtoSchema>;
export type ProjectRagSearchResultDto = z.infer<typeof ProjectRagSearchResultDtoSchema>;
export type ProjectRagRebuildRequestDto = z.infer<typeof ProjectRagRebuildRequestDtoSchema>;
export type ProjectRagRebuildResultDto = z.infer<typeof ProjectRagRebuildResultDtoSchema>;
export type ProjectRagEventWriteRequestDto = z.infer<typeof ProjectRagEventWriteRequestDtoSchema>;
export type ProjectRagEventDeleteRequestDto = z.infer<typeof ProjectRagEventDeleteRequestDtoSchema>;
export type ProjectRagEventReorderRequestDto = z.infer<typeof ProjectRagEventReorderRequestDtoSchema>;
export type ProjectRagMemoryWriteRequestDto = z.infer<typeof ProjectRagMemoryWriteRequestDtoSchema>;
export type ProjectRagMemoryDeleteRequestDto = z.infer<typeof ProjectRagMemoryDeleteRequestDtoSchema>;
export type ProjectRagInspectorRequestDto = z.infer<typeof ProjectRagInspectorRequestDtoSchema>;
export type ProjectRagInspectorDto = z.infer<typeof ProjectRagInspectorDtoSchema>;
export type ProjectRagDebugRequestDto = z.infer<typeof ProjectRagDebugRequestDtoSchema>;
export type ProjectRagDebugResultDto = z.infer<typeof ProjectRagDebugResultDtoSchema>;
