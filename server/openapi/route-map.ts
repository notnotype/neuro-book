/**
 * Route-to-Schema mapping for runtime OpenAPI spec generation.
 *
 * Maps each non-agent API route to its request/response Zod schemas,
 * tags, summary, and query parameters. Used by `generate-spec.ts`
 * to produce the full OpenAPI 3.0 spec at request time.
 *
 * AUTO-MAINTAINED: When you add/change Zod schemas in shared/dto/,
 * update this file.
 */

import type { z } from "zod";

// ─── Novel DTOs ──────────────────────────────────────────────────
import {
    CreateNovelRequestDtoSchema,
    NovelListItemDtoSchema,
    UpdateNovelRequestDtoSchema,
} from "nbook/shared/dto/novel-chapter.dto";

// ─── Plot DTOs ───────────────────────────────────────────────────
import {
    ChapterPlotDetailDtoSchema,
    ChapterWriterBriefDtoSchema,
    CreateStoryDecisionRequestDtoSchema,
    CreateStoryPhaseRequestDtoSchema,
    CreateStoryPromiseRequestDtoSchema,
    CreateStorySceneRequestDtoSchema,
    CreateStoryThreadRequestDtoSchema,
    PlotTreeDtoSchema,
    PlotWorkbenchDtoSchema,
    ReorderStoryPhasesRequestDtoSchema,
    ReorderStoryScenesRequestDtoSchema,
    ReorderStoryThreadsRequestDtoSchema,
    SceneWorldContextDtoSchema,
    SetPromiseBeatRequestDtoSchema,
    StoryDecisionDtoSchema,
    StoryDtoSchema,
    StoryPhaseDtoSchema,
    StoryPromiseDetailDtoSchema,
    StoryPromiseDtoSchema,
    StorySceneDetailDtoSchema,
    StorySceneWriteResponseDtoSchema,
    StoryThreadDetailDtoSchema,
    StoryThreadWriteResponseDtoSchema,
    UpdateStoryDecisionRequestDtoSchema,
    UpdateStoryPhaseRequestDtoSchema,
    UpdateStoryPromiseRequestDtoSchema,
    UpdateStoryRequestDtoSchema,
    UpdateStorySceneRequestDtoSchema,
    UpdateStoryThreadRequestDtoSchema,
} from "nbook/shared/dto/plot.dto";

// ─── Settings DTOs ───────────────────────────────────────────────
import {
    CheckModelRequestDtoSchema,
    CheckModelResponseDtoSchema,
    CheckProviderRequestDtoSchema,
    CheckProviderResponseDtoSchema,
    DiscoverProviderModelsRequestDtoSchema,
    DiscoverProviderModelsResponseDtoSchema,
    ModelLibraryDtoSchema,
    ProviderTemplateLibraryDtoSchema,
} from "nbook/shared/dto/app-settings.dto";
import {
    ConfigBootstrapDtoSchema,
    ConfigEditorSnapshotDtoSchema,
    ExchangeRateDtoSchema,
    ConfigProfileHomeResetRequestDtoSchema,
    ConfigSnapshotDtoSchema,
    ConfigWorkspaceQueryDtoSchema,
    GlobalConfigDtoSchema,
    ProjectConfigDtoSchema,
} from "nbook/shared/dto/config.dto";
import {WorkspaceFileIssueDtoSchema} from "nbook/shared/dto/workspace-tree.dto";
import {
    ProjectRagEventDeleteRequestDtoSchema,
    ProjectRagEventReorderRequestDtoSchema,
    ProjectRagEventWriteRequestDtoSchema,
    ProjectRagDebugRequestDtoSchema,
    ProjectRagDebugResultDtoSchema,
    ProjectRagInspectorDtoSchema,
    ProjectRagMemoryDeleteRequestDtoSchema,
    ProjectRagMemoryWriteRequestDtoSchema,
    ProjectRagOverviewDtoSchema,
    ProjectRagRebuildRequestDtoSchema,
    ProjectRagRebuildResultDtoSchema,
    ProjectRagSearchRequestDtoSchema,
    ProjectRagSearchResultDtoSchema,
    ProjectRagSubjectDtoSchema,
} from "nbook/shared/dto/project-rag.dto";

// ─── AI / Writing DTOs ──────────────────────────────────────────
import {
    FormAnnotationRequestDtoSchema,
    FormAnnotationResponseDtoSchema,
} from "nbook/shared/dto/ai-form-annotation.dto";

// ─── ComfyUI DTOs ────────────────────────────────────────────────
import {
    ComfyUiCheckRequestDtoSchema,
    ComfyUiCheckResponseDtoSchema,
    ComfyUiCreateJobRequestDtoSchema,
    ComfyUiDistillRequestDtoSchema,
    ComfyUiDistillResponseDtoSchema,
    ComfyUiImportWorkflowRequestDtoSchema,
    ComfyUiJobDtoSchema,
    ComfyUiUpdateWorkflowRequestDtoSchema,
    ComfyUiWorkflowSummaryDtoSchema,
    RpInsertIllustrationRequestDtoSchema,
    RpInsertIllustrationResponseDtoSchema,
} from "nbook/shared/dto/comfyui.dto";

// ─── Success response (for DELETE and simple operations) ────────
import { z as z_ } from "zod";
const SuccessResponseSchema = z_.object({ success: z_.boolean() });

// ─── Route meta entry type ──────────────────────────────────────

export interface RouteMetaEntry {
    /** Relative path from server/api/, e.g. "novels/index.post.ts" */
    file: string;
    /**
     * Public route path without the /api prefix. Use this when one physical
     * route file, such as a catch-all route, exposes multiple logical routes.
     */
    path?: string;
    /**
     * Whether this entry should be emitted into the physical route file's
     * route-local defineRouteMeta metadata. Canonical OpenAPI spec generation
     * always uses every entry; this flag only selects the file representative.
     */
    emitRouteMeta?: boolean;
    /** HTTP method */
    method: "get" | "post" | "put" | "patch" | "delete";
    /** OpenAPI tags for grouping */
    tags: string[];
    /** Short summary for the operation */
    summary: string;
    /** Zod schema for request body (null for GET/DELETE) */
    requestBody?: z.ZodType | null;
    /** Zod schema for response body (null to omit) */
    responseBody?: z.ZodType | null;
    /** Query parameter definitions (workspace-files GET routes) */
    queryParams?: z.ZodObject<any> | null;
}

// ─── Inline query param schemas for workspace-files routes ──────

const ReadQuerySchema = z_.object({
    path: z_.string().trim().min(1, "path 不能为空").describe("File path to read"),
    root: z_.string().optional().describe("Workspace root directory"),
    novelId: z_.string().optional().describe("Novel id used to resolve isolated workspace"),
    workspaceKind: z_.literal("user-assets").optional().describe("Use the global user assets workspace"),
});

const StatQuerySchema = z_.object({
    path: z_.string().trim().min(1, "path 不能为空").describe("Path to stat"),
    root: z_.string().optional().describe("Workspace root directory"),
    novelId: z_.string().optional().describe("Novel id used to resolve isolated workspace"),
    workspaceKind: z_.literal("user-assets").optional().describe("Use the global user assets workspace"),
});

const TreeQuerySchema = z_.object({
    projectPath: z_.string().optional().describe("Project Workspace path, for example workspace/<project>"),
    workspaceKind: z_.literal("user-assets").optional().describe("Use the global user assets workspace"),
});

const ProjectRagProjectQuerySchema = z_.object({
    projectPath: z_.string().trim().min(1).describe("Project Workspace path, for example workspace/<project>"),
});

const ProjectPlotProjectQuerySchema = z_.object({
    projectPath: z_.string().trim().min(1).describe("Project Workspace path, for example workspace/<project>"),
});

const ProjectPlotChapterQuerySchema = ProjectPlotProjectQuerySchema.extend({
    chapterId: z_.string().trim().min(1).describe("StoryChapter entity id, for example 12"),
});

const ProjectPlotChapterWriterBriefQuerySchema = ProjectPlotChapterQuerySchema.extend({
    mode: z_.union([z_.literal("autonomous"), z_.literal("curated")]).optional().describe("Anti-omniscience mode. Defaults to autonomous (writer self-queries); curated expands filtered state."),
});

const ProjectRagSubjectQuerySchema = ProjectRagProjectQuerySchema.extend({
    subjectPath: z_.string().trim().min(1).describe("Project-relative subject path, for example simulation/subjects/<subject-id>"),
});

const ProjectRagInspectorQuerySchema = ProjectRagProjectQuerySchema.extend({
    subjectPath: z_.string().trim().min(1).optional().describe("Project-relative subject path, for example simulation/subjects/<subject-id>"),
    sources: z_.string().optional().describe("Comma-separated source filters: events,memory"),
    limit: z_.union([z_.literal("100"), z_.literal("200"), z_.literal("500")]).optional().describe("Chunk limit"),
});

const WorkspaceTreeSnapshotSchema = z_.object({
    nodes: z_.array(z_.unknown()).describe("Workspace file nodes"),
    issues: z_.array(WorkspaceFileIssueDtoSchema).describe("Project Workspace issues; empty for user-assets"),
    revision: z_.number().int().nonnegative().describe("Project Workspace File Index revision"),
    validatedAt: z_.string().describe("ISO timestamp for the latest snapshot validation"),
});

// ─── Inline request schemas for workspace-files routes ──────────

const WriteBodySchema = z_.object({
    root: z_.string().optional().describe("Workspace root directory"),
    novelId: z_.string().optional().describe("Novel id used to resolve isolated workspace"),
    workspaceKind: z_.literal("user-assets").optional().describe("Use the global user assets workspace"),
    path: z_.string().trim().min(1, "path 不能为空").describe("File path"),
    content: z_.string().describe("File content"),
});

const CreateFileBodySchema = z_.object({
    root: z_.string().optional().describe("Workspace root directory"),
    novelId: z_.string().optional().describe("Novel id used to resolve isolated workspace"),
    workspaceKind: z_.literal("user-assets").optional().describe("Use the global user assets workspace"),
    path: z_.string().trim().min(1, "path 不能为空").describe("File path"),
    content: z_.string().optional().describe("Initial file content"),
});

const CreateDirBodySchema = z_.object({
    root: z_.string().optional().describe("Workspace root directory"),
    novelId: z_.string().optional().describe("Novel id used to resolve isolated workspace"),
    workspaceKind: z_.literal("user-assets").optional().describe("Use the global user assets workspace"),
    path: z_.string().trim().min(1, "path 不能为空").describe("Directory path"),
    indexContent: z_.string().nullable().optional().describe("Index file content"),
});

const RenameBodySchema = z_.object({
    root: z_.string().optional().describe("Workspace root directory"),
    novelId: z_.string().optional().describe("Novel id used to resolve isolated workspace"),
    workspaceKind: z_.literal("user-assets").optional().describe("Use the global user assets workspace"),
    from: z_.string().trim().min(1, "from 不能为空").describe("Source path"),
    to: z_.string().trim().min(1, "to 不能为空").describe("Destination path"),
});

const DeleteBodySchema = z_.object({
    root: z_.string().optional().describe("Workspace root directory"),
    novelId: z_.string().optional().describe("Novel id used to resolve isolated workspace"),
    workspaceKind: z_.literal("user-assets").optional().describe("Use the global user assets workspace"),
    path: z_.string().trim().min(1, "path 不能为空").describe("Path to delete"),
    recursive: z_.boolean().optional().default(false).describe("Delete recursively"),
});

const ConvertBodySchema = z_.object({
    root: z_.string().optional().describe("Workspace root directory"),
    novelId: z_.string().optional().describe("Novel id used to resolve isolated workspace"),
    workspaceKind: z_.literal("user-assets").optional().describe("Use the global user assets workspace"),
    path: z_.string().trim().min(1, "path 不能为空").describe("File path to convert"),
});

// ─── Route map ──────────────────────────────────────────────────

export const routeMetaMap: RouteMetaEntry[] = [
    // ═══ Hello ═══
    {
        file: "hello.get.ts",
        method: "get",
        tags: ["Hello"],
        summary: "Server health check — returns message and server time",
    },

    // ═══ Novels ═══
    {
        file: "novels/index.get.ts",
        method: "get",
        tags: ["Novels"],
        summary: "List all novels",
        responseBody: z_.array(NovelListItemDtoSchema),
    },
    {
        file: "novels/index.post.ts",
        method: "post",
        tags: ["Novels"],
        summary: "Create a new novel with an auto-created Story",
        requestBody: CreateNovelRequestDtoSchema,
        responseBody: NovelListItemDtoSchema.omit({
            volumeCount: true,
            chapterCount: true,
            totalWords: true,
            lorebookCount: true,
            sessionCount: true,
            threadCount: true,
            sceneCount: true,
            plotCount: true,
        }),
    },
    {
        file: "novels/[novelId].get.ts",
        method: "get",
        tags: ["Novels"],
        summary: "Get a novel",
        responseBody: NovelListItemDtoSchema.omit({
            volumeCount: true,
            chapterCount: true,
            totalWords: true,
            lorebookCount: true,
            sessionCount: true,
            threadCount: true,
            sceneCount: true,
            plotCount: true,
        }),
    },
    {
        file: "novels/[novelId].patch.ts",
        method: "patch",
        tags: ["Novels"],
        summary: "Update novel title and/or summary",
        requestBody: UpdateNovelRequestDtoSchema,
        responseBody: NovelListItemDtoSchema.omit({
            volumeCount: true,
            chapterCount: true,
            totalWords: true,
            lorebookCount: true,
            sessionCount: true,
            threadCount: true,
            sceneCount: true,
            plotCount: true,
        }),
    },
    {
        file: "novels/[novelId].delete.ts",
        method: "delete",
        tags: ["Novels"],
        summary: "Delete a novel and its plot data",
        responseBody: SuccessResponseSchema,
    },

    // ═══ Plot: Story ═══
    {
        file: "projects/plot/[...segments].ts",
        path: "projects/plot/story",
        emitRouteMeta: false,
        method: "get",
        tags: ["Plot"],
        summary: "Get the story for a Project Workspace",
        queryParams: ProjectPlotProjectQuerySchema,
        responseBody: StoryDtoSchema,
    },
    {
        file: "projects/plot/[...segments].ts",
        path: "projects/plot/story",
        emitRouteMeta: false,
        method: "patch",
        tags: ["Plot"],
        summary: "Update story title, summary, and/or note",
        queryParams: ProjectPlotProjectQuerySchema,
        requestBody: UpdateStoryRequestDtoSchema,
        responseBody: StoryDtoSchema,
    },
    {
        file: "projects/plot/[...segments].ts",
        path: "projects/plot/tree",
        emitRouteMeta: false,
        method: "get",
        tags: ["Plot"],
        summary: "Get the full plot tree (story + phases + threads + scenes)",
        queryParams: ProjectPlotProjectQuerySchema,
        responseBody: PlotTreeDtoSchema,
    },
    {
        file: "projects/plot/[...segments].ts",
        path: "projects/plot/workbench",
        emitRouteMeta: false,
        method: "get",
        tags: ["Plot"],
        summary: "Get plot workbench data with threads, scenes, and scene refs",
        queryParams: ProjectPlotProjectQuerySchema,
        responseBody: PlotWorkbenchDtoSchema,
    },
    {
        file: "projects/plot/[...segments].ts",
        path: "projects/plot/chapter",
        emitRouteMeta: false,
        method: "get",
        tags: ["Plot"],
        summary: "Get plot scenes attached to a chapter",
        queryParams: ProjectPlotChapterQuerySchema,
        responseBody: ChapterPlotDetailDtoSchema,
    },
    {
        file: "projects/plot/[...segments].ts",
        path: "projects/plot/chapter-writer-brief",
        emitRouteMeta: false,
        method: "get",
        tags: ["Plot"],
        summary: "Get a scene/world-context writer brief for a chapter",
        queryParams: ProjectPlotChapterWriterBriefQuerySchema,
        responseBody: ChapterWriterBriefDtoSchema,
    },

    // ═══ Plot: Phases ═══
    {
        file: "projects/plot/[...segments].ts",
        path: "projects/plot/phases",
        emitRouteMeta: false,
        method: "post",
        tags: ["Plot Phases"],
        summary: "Create a new story phase",
        queryParams: ProjectPlotProjectQuerySchema,
        requestBody: CreateStoryPhaseRequestDtoSchema,
        responseBody: StoryPhaseDtoSchema,
    },
    {
        file: "projects/plot/[...segments].ts",
        path: "projects/plot/phases/{phaseId}",
        emitRouteMeta: false,
        method: "get",
        tags: ["Plot Phases"],
        summary: "Get a story phase",
        queryParams: ProjectPlotProjectQuerySchema,
        responseBody: StoryPhaseDtoSchema,
    },
    {
        file: "projects/plot/[...segments].ts",
        path: "projects/plot/phases/{phaseId}",
        emitRouteMeta: false,
        method: "patch",
        tags: ["Plot Phases"],
        summary: "Update a story phase",
        queryParams: ProjectPlotProjectQuerySchema,
        requestBody: UpdateStoryPhaseRequestDtoSchema,
        responseBody: StoryPhaseDtoSchema,
    },
    {
        file: "projects/plot/[...segments].ts",
        path: "projects/plot/phases/{phaseId}",
        emitRouteMeta: false,
        method: "delete",
        tags: ["Plot Phases"],
        summary: "Delete a story phase",
        queryParams: ProjectPlotProjectQuerySchema,
        responseBody: SuccessResponseSchema,
    },
    {
        file: "projects/plot/[...segments].ts",
        path: "projects/plot/phases/reorder",
        emitRouteMeta: false,
        method: "post",
        tags: ["Plot Phases"],
        summary: "Reorder all story phases",
        queryParams: ProjectPlotProjectQuerySchema,
        requestBody: ReorderStoryPhasesRequestDtoSchema,
        responseBody: PlotTreeDtoSchema,
    },

    // ═══ Plot: Threads ═══
    {
        file: "projects/plot/[...segments].ts",
        path: "projects/plot/threads",
        emitRouteMeta: false,
        method: "post",
        tags: ["Plot Threads"],
        summary: "Create a new story thread",
        queryParams: ProjectPlotProjectQuerySchema,
        requestBody: CreateStoryThreadRequestDtoSchema,
        responseBody: StoryThreadWriteResponseDtoSchema,
    },
    {
        file: "projects/plot/[...segments].ts",
        path: "projects/plot/threads/{threadId}",
        emitRouteMeta: false,
        method: "get",
        tags: ["Plot Threads"],
        summary: "Get a story thread with scenes",
        queryParams: ProjectPlotProjectQuerySchema,
        responseBody: StoryThreadDetailDtoSchema,
    },
    {
        file: "projects/plot/[...segments].ts",
        path: "projects/plot/threads/{threadId}",
        emitRouteMeta: false,
        method: "patch",
        tags: ["Plot Threads"],
        summary: "Update a story thread",
        queryParams: ProjectPlotProjectQuerySchema,
        requestBody: UpdateStoryThreadRequestDtoSchema,
        responseBody: StoryThreadWriteResponseDtoSchema,
    },
    {
        file: "projects/plot/[...segments].ts",
        path: "projects/plot/threads/{threadId}",
        emitRouteMeta: false,
        method: "delete",
        tags: ["Plot Threads"],
        summary: "Delete a story thread",
        queryParams: ProjectPlotProjectQuerySchema,
        responseBody: SuccessResponseSchema,
    },
    {
        file: "projects/plot/[...segments].ts",
        path: "projects/plot/threads/reorder",
        emitRouteMeta: false,
        method: "post",
        tags: ["Plot Threads"],
        summary: "Reorder story threads across phases",
        queryParams: ProjectPlotProjectQuerySchema,
        requestBody: ReorderStoryThreadsRequestDtoSchema,
        responseBody: PlotTreeDtoSchema,
    },

    // ═══ Plot: Scenes ═══
    {
        file: "projects/plot/[...segments].ts",
        path: "projects/plot/scenes",
        emitRouteMeta: false,
        method: "post",
        tags: ["Plot Scenes"],
        summary: "Create a new story scene",
        queryParams: ProjectPlotProjectQuerySchema,
        requestBody: CreateStorySceneRequestDtoSchema,
        responseBody: StorySceneWriteResponseDtoSchema,
    },
    {
        file: "projects/plot/[...segments].ts",
        path: "projects/plot/scenes/{sceneId}",
        emitRouteMeta: false,
        method: "get",
        tags: ["Plot Scenes"],
        summary: "Get a story scene with refs and World Engine anchor",
        queryParams: ProjectPlotProjectQuerySchema,
        responseBody: StorySceneDetailDtoSchema,
    },
    {
        file: "projects/plot/[...segments].ts",
        path: "projects/plot/scenes/{sceneId}",
        emitRouteMeta: false,
        method: "patch",
        tags: ["Plot Scenes"],
        summary: "Update a story scene",
        queryParams: ProjectPlotProjectQuerySchema,
        requestBody: UpdateStorySceneRequestDtoSchema,
        responseBody: StorySceneWriteResponseDtoSchema,
    },
    {
        file: "projects/plot/[...segments].ts",
        path: "projects/plot/scenes/{sceneId}",
        emitRouteMeta: false,
        method: "delete",
        tags: ["Plot Scenes"],
        summary: "Delete a story scene",
        queryParams: ProjectPlotProjectQuerySchema,
        responseBody: SuccessResponseSchema,
    },
    {
        file: "projects/plot/[...segments].ts",
        path: "projects/plot/scenes/reorder",
        emitRouteMeta: false,
        method: "post",
        tags: ["Plot Scenes"],
        summary: "Reorder story scenes across threads and chapters",
        queryParams: ProjectPlotProjectQuerySchema,
        requestBody: ReorderStoryScenesRequestDtoSchema,
        responseBody: PlotTreeDtoSchema,
    },
    {
        file: "projects/plot/[...segments].ts",
        path: "projects/plot/scenes/{sceneId}/world-context",
        emitRouteMeta: true,
        method: "get",
        tags: ["Plot Scenes"],
        summary: "Get a story scene's filtered World Engine context via /projects/plot/scenes/:sceneId/world-context",
        queryParams: ProjectRagProjectQuerySchema,
        responseBody: SceneWorldContextDtoSchema,
    },

    // ═══ Plot: Promises ═══
    {
        file: "projects/plot/[...segments].ts",
        path: "projects/plot/promises",
        emitRouteMeta: false,
        method: "get",
        tags: ["Plot Promises"],
        summary: "List reader promises (open first) with derived stage and beat stats",
        queryParams: ProjectPlotProjectQuerySchema,
        responseBody: z_.array(StoryPromiseDtoSchema),
    },
    {
        file: "projects/plot/[...segments].ts",
        path: "projects/plot/promises",
        emitRouteMeta: false,
        method: "post",
        tags: ["Plot Promises"],
        summary: "Create a reader promise (ledger entry)",
        queryParams: ProjectPlotProjectQuerySchema,
        requestBody: CreateStoryPromiseRequestDtoSchema,
        responseBody: StoryPromiseDetailDtoSchema,
    },
    {
        file: "projects/plot/[...segments].ts",
        path: "projects/plot/promises/{promiseId}",
        emitRouteMeta: false,
        method: "get",
        tags: ["Plot Promises"],
        summary: "Get a reader promise with its beats and their scenes",
        queryParams: ProjectPlotProjectQuerySchema,
        responseBody: StoryPromiseDetailDtoSchema,
    },
    {
        file: "projects/plot/[...segments].ts",
        path: "projects/plot/promises/{promiseId}",
        emitRouteMeta: false,
        method: "patch",
        tags: ["Plot Promises"],
        summary: "Update a reader promise (status change carries abandon/fulfill/reopen)",
        queryParams: ProjectPlotProjectQuerySchema,
        requestBody: UpdateStoryPromiseRequestDtoSchema,
        responseBody: StoryPromiseDetailDtoSchema,
    },
    {
        file: "projects/plot/[...segments].ts",
        path: "projects/plot/promises/{promiseId}",
        emitRouteMeta: false,
        method: "delete",
        tags: ["Plot Promises"],
        summary: "Hard-delete a reader promise and its beats (UI only; agents use abandon)",
        queryParams: ProjectPlotProjectQuerySchema,
        responseBody: SuccessResponseSchema,
    },
    {
        file: "projects/plot/[...segments].ts",
        path: "projects/plot/promises/{promiseId}/beats",
        emitRouteMeta: false,
        method: "put",
        tags: ["Plot Promises"],
        summary: "Upsert this promise's beat on a scene (one beat per promise x scene)",
        queryParams: ProjectPlotProjectQuerySchema,
        requestBody: SetPromiseBeatRequestDtoSchema,
        responseBody: StoryPromiseDetailDtoSchema,
    },
    {
        file: "projects/plot/[...segments].ts",
        path: "projects/plot/promises/{promiseId}/beats/{sceneId}",
        emitRouteMeta: false,
        method: "delete",
        tags: ["Plot Promises"],
        summary: "Remove this promise's beat from a scene (re-checks fulfilled revert boundary)",
        queryParams: ProjectPlotProjectQuerySchema,
        responseBody: StoryPromiseDetailDtoSchema,
    },

    // ═══ Plot: Decisions ═══
    {
        file: "projects/plot/[...segments].ts",
        path: "projects/plot/decisions",
        emitRouteMeta: false,
        method: "get",
        tags: ["Plot Decisions"],
        summary: "List story decisions (open first) with dangling-reference marks",
        queryParams: ProjectPlotProjectQuerySchema,
        responseBody: z_.array(StoryDecisionDtoSchema),
    },
    {
        file: "projects/plot/[...segments].ts",
        path: "projects/plot/decisions",
        emitRouteMeta: false,
        method: "post",
        tags: ["Plot Decisions"],
        summary: "Create a story decision (ADR entry, always open; decide via PATCH status)",
        queryParams: ProjectPlotProjectQuerySchema,
        requestBody: CreateStoryDecisionRequestDtoSchema,
        responseBody: StoryDecisionDtoSchema,
    },
    {
        file: "projects/plot/[...segments].ts",
        path: "projects/plot/decisions/{decisionId}",
        emitRouteMeta: false,
        method: "get",
        tags: ["Plot Decisions"],
        summary: "Get a story decision with dangling-reference marks and deadline chapter summary",
        queryParams: ProjectPlotProjectQuerySchema,
        responseBody: StoryDecisionDtoSchema,
    },
    {
        file: "projects/plot/[...segments].ts",
        path: "projects/plot/decisions/{decisionId}",
        emitRouteMeta: false,
        method: "patch",
        tags: ["Plot Decisions"],
        summary: "Update a story decision (status change carries decide/drop/supersede/reopen; decided enforces risk)",
        queryParams: ProjectPlotProjectQuerySchema,
        requestBody: UpdateStoryDecisionRequestDtoSchema,
        responseBody: StoryDecisionDtoSchema,
    },
    {
        file: "projects/plot/[...segments].ts",
        path: "projects/plot/decisions/{decisionId}",
        emitRouteMeta: false,
        method: "delete",
        tags: ["Plot Decisions"],
        summary: "Hard-delete a story decision (UI only; agents use action=drop)",
        queryParams: ProjectPlotProjectQuerySchema,
        responseBody: SuccessResponseSchema,
    },

    // ═══ Config ═══
    {
        file: "config/snapshot.get.ts",
        method: "get",
        tags: ["Config"],
        summary: "Get effective runtime config snapshot",
        queryParams: ConfigWorkspaceQueryDtoSchema,
        responseBody: ConfigSnapshotDtoSchema,
    },
    {
        file: "config/editor-snapshot.get.ts",
        method: "get",
        tags: ["Config"],
        summary: "Get config editor snapshot",
        queryParams: ConfigWorkspaceQueryDtoSchema,
        responseBody: ConfigEditorSnapshotDtoSchema,
    },
    {
        file: "config/bootstrap.get.ts",
        method: "get",
        tags: ["Config"],
        summary: "Get lightweight startup config",
        queryParams: ConfigWorkspaceQueryDtoSchema,
        responseBody: ConfigBootstrapDtoSchema,
    },
    {
        file: "config/exchange-rate.get.ts",
        method: "get",
        tags: ["Config"],
        summary: "Get cached USD/CNY exchange rate",
        responseBody: ExchangeRateDtoSchema,
    },
    {
        file: "config/global.put.ts",
        method: "put",
        tags: ["Config"],
        summary: "Update Workspace Root Global Config",
        queryParams: ConfigWorkspaceQueryDtoSchema,
        requestBody: GlobalConfigDtoSchema,
        responseBody: ConfigEditorSnapshotDtoSchema,
    },
    {
        file: "config/project.put.ts",
        method: "put",
        tags: ["Config"],
        summary: "Update current Project Workspace Config",
        queryParams: ConfigWorkspaceQueryDtoSchema,
        requestBody: ProjectConfigDtoSchema,
        responseBody: ConfigEditorSnapshotDtoSchema,
    },
    {
        file: "config/profile-home/reset.post.ts",
        method: "post",
        tags: ["Config"],
        summary: "Reset one Project profile home",
        queryParams: ConfigWorkspaceQueryDtoSchema,
        requestBody: ConfigProfileHomeResetRequestDtoSchema,
        responseBody: ConfigEditorSnapshotDtoSchema,
    },
    {
        file: "config/models/model-check.post.ts",
        method: "post",
        tags: ["Config"],
        summary: "Check health of a single model",
        requestBody: CheckModelRequestDtoSchema,
        responseBody: CheckModelResponseDtoSchema,
    },
    {
        file: "config/models/provider-check.post.ts",
        method: "post",
        tags: ["Config"],
        summary: "Check connectivity of a model provider",
        requestBody: CheckProviderRequestDtoSchema,
        responseBody: CheckProviderResponseDtoSchema,
    },
    {
        file: "config/models/provider-discover.post.ts",
        method: "post",
        tags: ["Config"],
        summary: "Discover available models from a provider",
        requestBody: DiscoverProviderModelsRequestDtoSchema,
        responseBody: DiscoverProviderModelsResponseDtoSchema,
    },
    {
        file: "config/models/library.get.ts",
        method: "get",
        tags: ["Config"],
        summary: "Read the NeuroBook model library",
        responseBody: ModelLibraryDtoSchema,
    },
    {
        file: "config/models/provider-templates.get.ts",
        method: "get",
        tags: ["Config"],
        summary: "Read the NeuroBook provider template library",
        responseBody: ProviderTemplateLibraryDtoSchema,
    },

    // ═══ Project RAG ═══
    {
        file: "projects/rag/overview.get.ts",
        method: "get",
        tags: ["Project RAG"],
        summary: "Read Project-level subject RAG overview",
        queryParams: ProjectRagProjectQuerySchema,
        responseBody: ProjectRagOverviewDtoSchema,
    },
    {
        file: "projects/rag/subject.get.ts",
        method: "get",
        tags: ["Project RAG"],
        summary: "Read one subject's RAG data",
        queryParams: ProjectRagSubjectQuerySchema,
        responseBody: ProjectRagSubjectDtoSchema,
    },
    {
        file: "projects/rag/search.post.ts",
        method: "post",
        tags: ["Project RAG"],
        summary: "Search one subject through the real RAG chain",
        queryParams: ProjectRagProjectQuerySchema,
        requestBody: ProjectRagSearchRequestDtoSchema,
        responseBody: ProjectRagSearchResultDtoSchema,
    },
    {
        file: "projects/rag/rebuild.post.ts",
        method: "post",
        tags: ["Project RAG"],
        summary: "Rebuild subject RAG index for one subject or the current Project",
        queryParams: ProjectRagProjectQuerySchema,
        requestBody: ProjectRagRebuildRequestDtoSchema,
        responseBody: ProjectRagRebuildResultDtoSchema,
    },
    {
        file: "projects/rag/inspector.get.ts",
        method: "get",
        tags: ["Project RAG"],
        summary: "Read Project RAG inspector metadata and vector previews",
        queryParams: ProjectRagInspectorQuerySchema,
        responseBody: ProjectRagInspectorDtoSchema,
    },
    {
        file: "projects/rag/debug.post.ts",
        method: "post",
        tags: ["Project RAG"],
        summary: "Run Project RAG debug operations",
        queryParams: ProjectRagProjectQuerySchema,
        requestBody: ProjectRagDebugRequestDtoSchema,
        responseBody: ProjectRagDebugResultDtoSchema,
    },
    {
        file: "projects/rag/events.post.ts",
        method: "post",
        tags: ["Project RAG"],
        summary: "Create a subject event",
        queryParams: ProjectRagProjectQuerySchema,
        requestBody: ProjectRagEventWriteRequestDtoSchema,
        responseBody: ProjectRagSubjectDtoSchema,
    },
    {
        file: "projects/rag/events.patch.ts",
        method: "patch",
        tags: ["Project RAG"],
        summary: "Update a subject event",
        queryParams: ProjectRagProjectQuerySchema,
        requestBody: ProjectRagEventWriteRequestDtoSchema,
        responseBody: ProjectRagSubjectDtoSchema,
    },
    {
        file: "projects/rag/events.delete.ts",
        method: "delete",
        tags: ["Project RAG"],
        summary: "Delete a subject event",
        queryParams: ProjectRagProjectQuerySchema,
        requestBody: ProjectRagEventDeleteRequestDtoSchema,
        responseBody: ProjectRagSubjectDtoSchema,
    },
    {
        file: "projects/rag/events/reorder.post.ts",
        method: "post",
        tags: ["Project RAG"],
        summary: "Reorder a subject event",
        queryParams: ProjectRagProjectQuerySchema,
        requestBody: ProjectRagEventReorderRequestDtoSchema,
        responseBody: ProjectRagSubjectDtoSchema,
    },
    {
        file: "projects/rag/memories.post.ts",
        method: "post",
        tags: ["Project RAG"],
        summary: "Create a subject memory",
        queryParams: ProjectRagProjectQuerySchema,
        requestBody: ProjectRagMemoryWriteRequestDtoSchema,
        responseBody: ProjectRagSubjectDtoSchema,
    },
    {
        file: "projects/rag/memories.patch.ts",
        method: "patch",
        tags: ["Project RAG"],
        summary: "Update a subject memory",
        queryParams: ProjectRagProjectQuerySchema,
        requestBody: ProjectRagMemoryWriteRequestDtoSchema,
        responseBody: ProjectRagSubjectDtoSchema,
    },
    {
        file: "projects/rag/memories.delete.ts",
        method: "delete",
        tags: ["Project RAG"],
        summary: "Delete a subject memory",
        queryParams: ProjectRagProjectQuerySchema,
        requestBody: ProjectRagMemoryDeleteRequestDtoSchema,
        responseBody: ProjectRagSubjectDtoSchema,
    },

    // ═══ ComfyUI ═══
    {
        file: "comfyui/check.post.ts",
        method: "post",
        tags: ["ComfyUI"],
        summary: "Check connectivity of the local ComfyUI server",
        requestBody: ComfyUiCheckRequestDtoSchema,
        responseBody: ComfyUiCheckResponseDtoSchema,
    },
    {
        file: "comfyui/workflows/index.get.ts",
        method: "get",
        tags: ["ComfyUI"],
        summary: "List ComfyUI workflows (built-in + imported)",
        responseBody: z_.object({items: z_.array(ComfyUiWorkflowSummaryDtoSchema)}),
    },
    {
        file: "comfyui/workflows/index.post.ts",
        method: "post",
        tags: ["ComfyUI"],
        summary: "Import a ComfyUI API-format workflow",
        requestBody: ComfyUiImportWorkflowRequestDtoSchema,
        responseBody: ComfyUiWorkflowSummaryDtoSchema,
    },
    {
        file: "comfyui/workflows/[id].put.ts",
        method: "put",
        tags: ["ComfyUI"],
        summary: "Update an imported workflow's name or injection mapping",
        requestBody: ComfyUiUpdateWorkflowRequestDtoSchema,
        responseBody: ComfyUiWorkflowSummaryDtoSchema,
    },
    {
        file: "comfyui/workflows/[id].delete.ts",
        method: "delete",
        tags: ["ComfyUI"],
        summary: "Delete an imported workflow",
        responseBody: z_.object({ok: z_.boolean()}),
    },
    {
        file: "projects/comfyui/distill.post.ts",
        method: "post",
        tags: ["ComfyUI"],
        summary: "Distill selected prose into an English image prompt",
        queryParams: ProjectRagProjectQuerySchema,
        requestBody: ComfyUiDistillRequestDtoSchema,
        responseBody: ComfyUiDistillResponseDtoSchema,
    },
    {
        file: "projects/comfyui/jobs.post.ts",
        method: "post",
        tags: ["ComfyUI"],
        summary: "Create an illustration generation job",
        queryParams: ProjectRagProjectQuerySchema,
        requestBody: ComfyUiCreateJobRequestDtoSchema,
        responseBody: ComfyUiJobDtoSchema,
    },
    {
        file: "projects/comfyui/jobs/[jobId]/cancel.post.ts",
        method: "post",
        tags: ["ComfyUI"],
        summary: "Cancel an illustration generation job",
        queryParams: ProjectRagProjectQuerySchema,
        responseBody: ComfyUiJobDtoSchema,
    },
    {
        file: "projects/rp/insert-illustration.post.ts",
        method: "post",
        tags: ["ComfyUI"],
        summary: "Insert an illustration into RP tick prose after an anchor",
        queryParams: ProjectRagProjectQuerySchema,
        requestBody: RpInsertIllustrationRequestDtoSchema,
        responseBody: RpInsertIllustrationResponseDtoSchema,
    },

    // ═══ Workspace Files ═══
    {
        file: "workspace-files/raw.get.ts",
        method: "get",
        tags: ["Workspace Files"],
        summary: "Serve a workspace image file as raw bytes",
        queryParams: TreeQuerySchema.extend({
            path: z_.string().trim().min(1, "path 不能为空").describe("Image file path relative to the workspace root"),
        }),
    },
    {
        file: "workspace-files/tree.get.ts",
        method: "get",
        tags: ["Workspace Files"],
        summary: "Read workspace tree snapshot",
        queryParams: TreeQuerySchema,
        responseBody: WorkspaceTreeSnapshotSchema,
    },
    {
        file: "workspace-files/read.get.ts",
        method: "get",
        tags: ["Workspace Files"],
        summary: "Read a workspace text file",
        queryParams: ReadQuerySchema,
    },
    {
        file: "workspace-files/stat.get.ts",
        method: "get",
        tags: ["Workspace Files"],
        summary: "Get file/directory metadata (stat)",
        queryParams: StatQuerySchema,
    },
    {
        file: "workspace-files/write.put.ts",
        method: "put",
        tags: ["Workspace Files"],
        summary: "Write content to a workspace file",
        requestBody: WriteBodySchema,
    },
    {
        file: "workspace-files/create-file.post.ts",
        method: "post",
        tags: ["Workspace Files"],
        summary: "Create a new workspace file",
        requestBody: CreateFileBodySchema,
    },
    {
        file: "workspace-files/create-directory.post.ts",
        method: "post",
        tags: ["Workspace Files"],
        summary: "Create a new workspace directory",
        requestBody: CreateDirBodySchema,
    },
    {
        file: "workspace-files/rename.patch.ts",
        method: "patch",
        tags: ["Workspace Files"],
        summary: "Rename or move a workspace path",
        requestBody: RenameBodySchema,
    },
    {
        file: "workspace-files/delete.delete.ts",
        method: "delete",
        tags: ["Workspace Files"],
        summary: "Delete a workspace file or directory",
        requestBody: DeleteBodySchema,
        responseBody: SuccessResponseSchema,
    },
    {
        file: "workspace-files/convert-file-to-directory.post.ts",
        method: "post",
        tags: ["Workspace Files"],
        summary: "Convert a workspace markdown file into a directory",
        requestBody: ConvertBodySchema,
    },

    // ═══ AI ═══
    {
        file: "ai/form-annotation.post.ts",
        method: "post",
        tags: ["AI"],
        summary: "AI-powered form annotation (currently returns stub)",
        requestBody: FormAnnotationRequestDtoSchema,
        responseBody: FormAnnotationResponseDtoSchema,
    },
];
