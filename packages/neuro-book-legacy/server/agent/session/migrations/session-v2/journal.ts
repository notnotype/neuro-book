import {SessionMigrationJournal} from "nbook/server/agent/session/migrations/shared/journal";
import type {
    SessionMigrationFileState,
    SessionMigrationJournalPaths,
    SessionMigrationStatusMap,
} from "nbook/server/agent/session/migrations/shared/types";
import type {
    LegacySessionClassification,
    SessionMigrationRecordedReviewReason,
} from "nbook/server/agent/session/migrations/session-v2/legacy-decoder";
import type {
    SessionSchemaV2Manifest,
    SessionSchemaV2RunStatus,
    SessionSchemaV2State,
    SessionSchemaV2Status,
} from "nbook/server/agent/session/migrations/session-v2/types";

const CLASSIFICATIONS = new Set<LegacySessionClassification>([
    "managed",
    "stale_managed",
    "user_assets",
    "external",
    "workspace_root",
]);
const REVIEW_REASONS = new Set<SessionMigrationRecordedReviewReason>([
    "external_project",
    "ambiguous_path",
    "current_project_unresolved",
]);

/** Session v2 使用语义化 prepared/staged 名称的通用事务阶段映射。 */
export const SESSION_SCHEMA_V2_STATUS = {
    session: {
        pending: "pending",
        backedUp: "backed_up",
        prepared: "prepared",
        staged: "staged",
        publishing: "publishing",
        published: "published",
        verified: "verified",
        rollbackPending: "rollback_pending",
        rollbackPublishing: "rollback_publishing",
        rolledBack: "rolled_back",
    },
    run: {
        running: "running",
        failed: "failed",
        fullScanVerified: "full_scan_verified",
        complete: "complete",
        reportWritten: "report_written",
        rollbackRunning: "rollback_running",
        rolledBack: "rolled_back",
    },
} as const satisfies SessionMigrationStatusMap<SessionSchemaV2Status, SessionSchemaV2RunStatus>;

type SessionSchemaV2ResumeStatus = Exclude<
    SessionSchemaV2RunStatus,
    "failed" | "report_written" | "rolled_back"
>;

const journal = new SessionMigrationJournal<
    1,
    SessionSchemaV2Status,
    SessionSchemaV2RunStatus,
    SessionSchemaV2ResumeStatus,
    SessionSchemaV2State
>({
    manifestVersion: 1,
    status: SESSION_SCHEMA_V2_STATUS,
    runRoot: (runId) => `.nbook/agent/migrations/session-v2/${runId}`,
    sessionFields: [
        "sessionId",
        "profileKey",
        "classification",
        "currentProjectRoot",
        "reviewReasons",
        "ambiguousLocations",
        "migrationTimestamp",
        "rewrittenPaths",
        "resetProfileReminders",
        "cancelledToolCalls",
        "clearedPendingResolutions",
        "clearedFollowUpQueue",
    ],
    optionalSessionFields: ["decoderFormat"],
    parseSessionFields: (value, base) => parseSessionFields(value, base),
});

/** Session v2 WAL/checkpoint 路径。 */
export type SessionSchemaV2JournalPaths = SessionMigrationJournalPaths;

/** 写入不可变初始计划。 */
export async function writeInitialManifest(
    paths: SessionSchemaV2JournalPaths,
    manifest: SessionSchemaV2Manifest,
): Promise<void> {
    await journal.writeInitialManifest(paths, manifest);
}

/** 写入最终 report_written/rolled_back checkpoint。 */
export async function checkpointManifest(
    paths: SessionSchemaV2JournalPaths,
    manifest: SessionSchemaV2Manifest,
): Promise<void> {
    await journal.checkpointManifest(paths, manifest);
}

/** 严格读取并回放 Session v2 WAL。 */
export async function loadManifest(
    paths: SessionSchemaV2JournalPaths,
): Promise<SessionSchemaV2Manifest | null> {
    return journal.loadManifest(paths);
}

/** 持久化一个 Session 文件事务阶段。 */
export async function transitionSession(
    paths: SessionSchemaV2JournalPaths,
    manifest: SessionSchemaV2Manifest,
    session: SessionSchemaV2State,
    to: SessionSchemaV2Status,
): Promise<void> {
    await journal.transitionSession(paths, manifest, session, to);
}

/** 持久化一个 migration run 阶段。 */
export async function transitionRun(
    paths: SessionSchemaV2JournalPaths,
    manifest: SessionSchemaV2Manifest,
    to: SessionSchemaV2RunStatus,
    error?: string,
): Promise<void> {
    await journal.transitionRun(paths, manifest, to, error);
}

/** 严格解析 Session schema v2 的字段级迁移统计与 review ledger。 */
function parseSessionFields(
    value: {[key: string]: unknown},
    base: SessionMigrationFileState<SessionSchemaV2Status>,
): SessionSchemaV2State {
    if (!isPositiveInteger(value.sessionId)
        || typeof value.profileKey !== "string" || value.profileKey.length === 0
        || !isClassification(value.classification)
        || !(value.currentProjectRoot === null || isProjectRoot(value.currentProjectRoot))
        || !isReviewReasons(value.reviewReasons)
        || (value.decoderFormat !== undefined && value.decoderFormat !== 1 && value.decoderFormat !== 2)
        || !isStringArray(value.ambiguousLocations)
        || !isNonNegativeInteger(value.migrationTimestamp)
        || !isNonNegativeInteger(value.rewrittenPaths)
        || !isNonNegativeInteger(value.resetProfileReminders)
        || !isNonNegativeInteger(value.cancelledToolCalls)
        || !isNonNegativeInteger(value.clearedPendingResolutions)
        || typeof value.clearedFollowUpQueue !== "boolean") {
        throw new Error("migration session 字段无效");
    }
    const managed = value.classification === "managed" || value.classification === "stale_managed";
    if (managed !== (value.currentProjectRoot !== null)) {
        throw new Error("migration session currentProjectRoot 与 classification 不一致");
    }
    return {
        ...base,
        sessionId: value.sessionId,
        profileKey: value.profileKey,
        classification: value.classification,
        currentProjectRoot: value.currentProjectRoot,
        reviewReasons: value.reviewReasons,
        decoderFormat: value.decoderFormat === 2 ? 2 : 1,
        ambiguousLocations: value.ambiguousLocations,
        migrationTimestamp: value.migrationTimestamp,
        rewrittenPaths: value.rewrittenPaths,
        resetProfileReminders: value.resetProfileReminders,
        cancelledToolCalls: value.cancelledToolCalls,
        clearedPendingResolutions: value.clearedPendingResolutions,
        clearedFollowUpQueue: value.clearedFollowUpQueue,
    };
}

/** 判断正安全整数。 */
function isPositiveInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** 判断非负安全整数。 */
function isNonNegativeInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** 判断冻结的旧 Session 分类。 */
function isClassification(value: unknown): value is LegacySessionClassification {
    return typeof value === "string" && CLASSIFICATIONS.has(value as LegacySessionClassification);
}

/** 判断 portable 单段 Project root。 */
function isProjectRoot(value: unknown): value is string {
    return typeof value === "string"
        && value.length > 0
        && value !== "."
        && value !== ".."
        && !value.includes("/")
        && !value.includes("\\")
        && !value.includes("\0");
}

/** review reason 必须唯一并保持 decoder 的稳定顺序。 */
function isReviewReasons(value: unknown): value is SessionMigrationRecordedReviewReason[] {
    if (!Array.isArray(value)
        || !value.every((item) => typeof item === "string" && REVIEW_REASONS.has(item as SessionMigrationRecordedReviewReason))) {
        return false;
    }
    const historical = ["external_project", "ambiguous_path"].filter((reason) => value.includes(reason));
    const current = value.includes("current_project_unresolved") ? ["current_project_unresolved"] : [];
    return JSON.stringify(value) === JSON.stringify(historical)
        || JSON.stringify(value) === JSON.stringify(current);
}

/** ambiguous location 必须是去重、排序后的非空字符串数组。 */
function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value)
        && value.every((item) => typeof item === "string" && item.length > 0)
        && JSON.stringify(value) === JSON.stringify([...new Set(value)].sort());
}
