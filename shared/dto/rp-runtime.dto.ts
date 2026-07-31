import {z} from "zod";
import type {JsonValue} from "nbook/shared/dto/ai-form-annotation.dto";

export const RpRunIntensitySchema = z.enum(["light", "standard", "deep"]);
export type RpRunIntensityDto = z.infer<typeof RpRunIntensitySchema>;

export const RpEventActionRequestDtoSchema = z.discriminatedUnion("op", [
    z.object({op: z.literal("save"), eventId: z.string().min(1)}),
    z.object({op: z.literal("discard"), eventId: z.string().min(1)}),
    z.object({op: z.literal("select"), eventId: z.string().min(1)}),
    z.object({op: z.literal("random_select"), eventIds: z.array(z.string().min(1)).min(1).max(4)}),
]);
export type RpEventActionRequestDto = z.infer<typeof RpEventActionRequestDtoSchema>;

export const RpIntensityRequestDtoSchema = z.object({intensity: RpRunIntensitySchema});
export type RpIntensityRequestDto = z.infer<typeof RpIntensityRequestDtoSchema>;

export const RpIntakePhaseDtoSchema = z.enum([
    "empty",
    "source_selected",
    "premise_ready",
    "avatar_ready",
    "play_style_ready",
    "systems_ready",
    "boundaries_ready",
    "opening_ready",
    "reviewing",
    "confirmed",
    "bootstrapping",
    "active",
]);
export type RpIntakePhaseDto = z.infer<typeof RpIntakePhaseDtoSchema>;

export type RpBootstrapStageDto = "config" | "world" | "map" | "characters" | "opening_event" | "narrative";
export type RpBootstrapProgressDto = RpBootstrapStageDto | "ready_to_activate" | "complete";

/** 左侧状态页所需的开团状态；不包含企划字段正文。 */
export type RpIntakeOverviewDto = {
    phase: RpIntakePhaseDto;
    version: number;
    /** 与 version 相同时表示玩家已在状态页确认当前企划。 */
    confirmedVersion: number | null;
    bootstrap: {
        status: "idle" | "running" | "failed" | "complete";
        /** idle 时为 null；其余状态表示当前或最后停留的服务端阶段。 */
        stage: RpBootstrapProgressDto | null;
        completedStages: RpBootstrapStageDto[];
        /** 仅初始化失败时存在，用于向玩家显示实际阶段与原因。 */
        error?: {stage: string; message: string; at: string};
    };
};

/** 状态页确认必须绑定玩家当前看到的企划版本，并显式提交确认意图。 */
export const RpIntakeConfirmRequestDtoSchema = z.object({
    version: z.number().int().nonnegative(),
    confirmed: z.literal(true),
}).strict();
export type RpIntakeConfirmRequestDto = z.infer<typeof RpIntakeConfirmRequestDtoSchema>;

export type RpPipelineStageDto =
    | "action_understanding" | "world_snapshot" | "condition_check" | "screenwriter_plan" | "actor_proposals"
    | "conflict_resolution" | "adjudication" | "narrative" | "world_commit" | "ui_update";

export type RpPlayerEventDto = {
    id: string;
    batchId: string | null;
    origin: "candidate" | "opening" | "hard_schedule" | "player";
    trigger: "new_location" | "new_activity" | "calm_streak" | "plan_due" | "player_request" | "opening_stable";
    tone: "calm" | "exciting" | "dangerous" | "unusual";
    title: string;
    playerSummary: string;
    status: string;
    availability: "available" | "needs_revalidation" | "unavailable";
    availabilityReason: string | null;
    locationId: string | null;
    hard: boolean;
    hardKind: "schedule" | "weather" | "appointment" | "plan" | null;
    dueAt: string | null;
    createdAt: string;
    updatedAt: string;
    lastChange: string;
};

export type RpPlayerMapNodeDto = {
    id: string;
    parentId: string | null;
    level: "world" | "region" | "town" | "district" | "building" | "sub_location";
    label: string;
    summary: string;
    approximateDirection: string | null;
    status: "rumored" | "discovered" | "familiar" | "unavailable" | "destroyed";
};

export type RpPlayerMapRouteDto = {
    id: string;
    fromId: string;
    toId: string;
    label: string;
    direction: string | null;
    distance: string | null;
    secret: boolean;
    discoveredAtTick: number | null;
    status: "active" | "unavailable" | "destroyed";
};

export type RpPlayerNpcDto = {
    id: string;
    name: string;
    tier: "named" | "resident" | "major" | "major_inactive";
    narrativeRole: string;
    playerSummary: string;
    lastSeenTick: number;
    currentLocationId: string | null;
};

export type RpPlayerCharacterCategoryDto = "player" | "major" | "resident" | "named" | "major_inactive" | "other";

/** 玩家安全的统一角色投影；不包含别名、persona、未知信息或 World Engine god-view attrs。 */
export type RpPlayerCharacterDto = {
    id: string;
    name: string;
    category: RpPlayerCharacterCategoryDto;
    narrativeRole: string;
    playerSummary: string;
    lastSeenTick: number | null;
    currentLocationId: string | null;
};

export type RpPlayerRelationDto = {
    id: string;
    sourceId: string;
    targetId: string;
    dimensions: Partial<Record<"familiarity" | "trust" | "affection" | "attraction" | "respect" | "dependence" | "fear" | "hostility", number>>;
    tags: string[];
};

export type RpRuntimeOverviewDto = {
    intake: RpIntakeOverviewDto;
    intensity: RpRunIntensityDto;
    focusObjects: Array<{
        id: string;
        kind: "location" | "npc" | "event" | "faction" | "plan" | "resource";
        level: "current" | "active_background" | "low_frequency" | "dormant";
        pinned: boolean;
        reason: string;
        updatedTick: number;
    }>;
    currentTurn: null | {
        id: string;
        sequence: number;
        status: string;
        inputSummary: string;
        note: string | null;
        updatedAt: string;
    };
    pipeline: null | {
        stage: RpPipelineStageDto;
        stageIndex: number;
        stageCount: number;
        completedAt: string | null;
        stageHistory: Array<{stage: RpPipelineStageDto; publicSummary: string; at: string}>;
        failures: Array<{
            id: string;
            stage: RpPipelineStageDto;
            kind: string;
            agent: string;
            message: string;
            blocking: boolean;
            resolved: boolean;
            recoveryOptions: string[];
            createdAt: string;
        }>;
    };
    counts: {
        committedTurns: number;
        incompleteTurns: number;
        failedTurns: number;
        updates: number;
    };
    events: {
        calmTickStreak: number;
        candidateGenerationDue: boolean;
        items: RpPlayerEventDto[];
    };
    map: {nodes: RpPlayerMapNodeDto[]; routes: RpPlayerMapRouteDto[]};
    roster: {
        activeMajorLimit: number;
        npcs: RpPlayerNpcDto[];
        suggestions: Array<{id: string; npcId: string; targetTier: "resident" | "major"; reason: string; evidence: string[]}>;
    };
    characters: RpPlayerCharacterDto[];
    relations: RpPlayerRelationDto[];
    resources: Array<{
        accountId: string;
        subjectId: string;
        resourceId: string;
        label: string;
        value: number;
        unit: string;
        band: string | null;
    }>;
    /** null 表示尚未运行或还没有持久化的一致性审计。 */
    consistency: RpConsistencyReportDto | null;
};

export type RpUpdateListItemDto = {
    turnId: string;
    sequence: number;
    at: string;
    inputSummary: string;
    summary: string;
    prosePath: string | null;
};

export type RpUpdatePageDto = {
    items: RpUpdateListItemDto[];
    total: number;
    offset: number;
    limit: number;
};

export type RpUpdateDetailDto = {
    turn: {
        id: string;
        sequence: number;
        status: string;
        inputSummary: string;
        prosePath: string | null;
        committedAt: string | null;
    };
    stageHistory: Array<{stage: RpPipelineStageDto; publicSummary: string; at: string}>;
    settlement: JsonValue | null;
    time: null | {startTime: string; endTime: string; longJump: boolean; summary: string; committedAt: string};
    resourceTransactions: Array<{accountId: string; kind: "direct" | "periodic"; delta: number; balance: number; reason: string; atTime: string}>;
    relationChanges: Array<{
        sourceId: string;
        targetId: string;
        deltas: Partial<Record<"familiarity" | "trust" | "affection" | "attraction" | "respect" | "dependence" | "fear" | "hostility", number>>;
        addedTags: string[];
        removedTags: string[];
        reason: string;
    }>;
    longJump: null | {startTime: string; endTime: string; deterministicSummary: string; characterSummary: string; worldSummary: string; createdAt: string};
};

export type RpTimelineNodeDto = {
    id: string;
    parentId: string | null;
    childrenIds: string[];
    label: string;
    summary: string;
    kind: "root" | "turn" | "checkpoint" | "safety";
    storage: "full" | "delta";
    depth: number;
    locked: boolean;
    archived: boolean;
    turnId: string | null;
    tick: number | null;
    createdAt: string;
    worldSliceCount: number;
    worldSubjectCount: number;
    logicalFileCount: number;
    logicalBytes: number;
};

export type RpTimelineTreeDto = {
    schemaVersion: 1;
    rootId: string;
    activeNodeId: string;
    nodes: RpTimelineNodeDto[];
    archivedNodeCount: number;
    maxChildren: 4;
    fullSnapshotInterval: number;
    updatedAt: string;
};

export type RpTimelinePreviewDto = {
    node: RpTimelineNodeDto;
    activeNodeId: string;
    pathNodeIds: string[];
    summary: {
        events: number;
        activeEvents: number;
        npcs: number;
        resources: number;
        beliefs: number;
        mapNodes: number;
        relations: number;
        diceRolls: number;
        turns: number;
        latestWorldInstant: string | null;
    };
    impact: {
        changedFiles: number;
        categories: Array<{
            key: "turns" | "events" | "map" | "npcs" | "resources" | "relations" | "beliefs" | "dice" | "worldSlices";
            label: string;
            activeValue: number;
            targetValue: number;
        }>;
    };
    integrity: "verified";
};

export const RpTimelineActionRequestDtoSchema = z.discriminatedUnion("op", [
    z.object({op: z.literal("initialize"), label: z.string().trim().min(1).max(120).optional()}),
    z.object({
        op: z.literal("checkpoint"),
        label: z.string().trim().min(1).max(120),
        summary: z.string().trim().max(500).default(""),
        replaceNodeId: z.string().min(1).nullable().default(null),
    }),
    z.object({op: z.literal("lock"), nodeId: z.string().min(1), locked: z.boolean()}),
    z.object({op: z.literal("archive_branch"), nodeId: z.string().min(1)}),
]);
export type RpTimelineActionRequestDto = z.infer<typeof RpTimelineActionRequestDtoSchema>;

export const RpTimelineRestoreRequestDtoSchema = z.object({
    nodeId: z.string().min(1),
    confirmed: z.literal(true),
    createSafety: z.boolean(),
    safetyLabel: z.string().trim().min(1).max(120).default("恢复前安全切片"),
    replaceNodeId: z.string().min(1).nullable().default(null),
});
export type RpTimelineRestoreRequestDto = z.infer<typeof RpTimelineRestoreRequestDtoSchema>;

export type RpTimelineRestoreResultDto = {
    tree: RpTimelineTreeDto;
    restoredNodeId: string;
    safetyNodeId: string | null;
    preservedOocFacts: number;
    restoredAt: string;
};

export const RpConsistencyLevelSchema = z.enum(["light", "standard", "deep"]);
export type RpConsistencyLevelDto = z.infer<typeof RpConsistencyLevelSchema>;

export const RpConsistencyRequestDtoSchema = z.object({
    level: RpConsistencyLevelSchema,
    repairSafe: z.boolean().default(true),
});
export type RpConsistencyRequestDto = z.infer<typeof RpConsistencyRequestDtoSchema>;

export type RpConsistencyIssueDto = {
    code: string;
    severity: "info" | "warning" | "error";
    scope: string;
    message: string;
    repair: "none" | "automatic" | "player_confirmation";
    /** 仅 player_confirmation 问题使用；列出不会被系统代选的处理方向。 */
    resolutionOptions?: string[];
};

export const RpConsistencyIssueDtoSchema: z.ZodType<RpConsistencyIssueDto> = z.object({
    code: z.string(), severity: z.enum(["info", "warning", "error"]), scope: z.string(), message: z.string(),
    repair: z.enum(["none", "automatic", "player_confirmation"]),
    resolutionOptions: z.array(z.string()).optional(),
});

export type RpConsistencyReportDto = {
    schemaVersion: 1;
    level: RpConsistencyLevelDto;
    status: "healthy" | "warning" | "blocked";
    issues: RpConsistencyIssueDto[];
    repaired: Array<{code: string; scope: string; message: string}>;
    checkedAt: string;
    durationMs: number;
};

export const RpConsistencyReportDtoSchema: z.ZodType<RpConsistencyReportDto> = z.object({
    schemaVersion: z.literal(1), level: RpConsistencyLevelSchema, status: z.enum(["healthy", "warning", "blocked"]),
    issues: z.array(RpConsistencyIssueDtoSchema),
    repaired: z.array(z.object({code: z.string(), scope: z.string(), message: z.string()})),
    checkedAt: z.string(), durationMs: z.number().int().nonnegative(),
});

export type RpTimelineProblemReportDto = {
    schemaVersion: 1;
    id: string;
    targetNodeId: string;
    targetLabel: string;
    failure: string;
    attemptedNodeIds: string[];
    lastVerifiedNodeId: string | null;
    lastVerifiedLabel: string | null;
    options: Array<"retry" | "restore_last_verified" | "keep_current" | "inspect_report">;
    reportPath: string;
    createdAt: string;
};
