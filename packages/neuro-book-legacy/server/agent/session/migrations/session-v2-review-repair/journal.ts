import {SessionMigrationJournal} from "nbook/server/agent/session/migrations/shared/journal";
import type {
    SessionMigrationFileState,
    SessionMigrationJournalPaths,
    SessionMigrationStatusMap,
} from "nbook/server/agent/session/migrations/shared/types";
import type {
    SessionV2ReviewRepairManifest,
    SessionV2ReviewRepairRunStatus,
    SessionV2ReviewRepairState,
    SessionV2ReviewRepairStatus,
} from "nbook/server/agent/session/migrations/session-v2-review-repair/types";

/** repair 使用通用 Session 文件事务的稳定状态映射。 */
export const SESSION_V2_REVIEW_REPAIR_STATUS = {
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
} as const satisfies SessionMigrationStatusMap<SessionV2ReviewRepairStatus, SessionV2ReviewRepairRunStatus>;

type ResumeStatus = Exclude<SessionV2ReviewRepairRunStatus, "failed" | "report_written" | "rolled_back">;

const journal = new SessionMigrationJournal<
    1,
    SessionV2ReviewRepairStatus,
    SessionV2ReviewRepairRunStatus,
    ResumeStatus,
    SessionV2ReviewRepairState
>({
    manifestVersion: 1,
    status: SESSION_V2_REVIEW_REPAIR_STATUS,
    runRoot: (runId) => `.nbook/agent/migrations/session-v2-review-repair/${runId}`,
    sessionFields: [
        "sessionId",
        "sourceMigrationRunId",
        "sourceBackupPath",
        "migrationTimestamp",
        "currentProjectRoot",
        "reviewRequired",
        "oldPrefixHash",
        "newPrefixHash",
        "suffixHash",
    ],
    parseSessionFields: (value, base) => parseSession(value, base),
});

export type SessionV2ReviewRepairJournalPaths = SessionMigrationJournalPaths;

/** 写入不可变 repair 初始计划。 */
export async function writeInitialManifest(paths: SessionV2ReviewRepairJournalPaths, manifest: SessionV2ReviewRepairManifest): Promise<void> {
    await journal.writeInitialManifest(paths, manifest);
}

/** 写入 repair 终态 checkpoint。 */
export async function checkpointManifest(paths: SessionV2ReviewRepairJournalPaths, manifest: SessionV2ReviewRepairManifest): Promise<void> {
    await journal.checkpointManifest(paths, manifest);
}

/** 严格读取并回放 repair WAL。 */
export async function loadManifest(paths: SessionV2ReviewRepairJournalPaths): Promise<SessionV2ReviewRepairManifest | null> {
    return journal.loadManifest(paths);
}

/** 持久化一个 repair Session 阶段。 */
export async function transitionSession(
    paths: SessionV2ReviewRepairJournalPaths,
    manifest: SessionV2ReviewRepairManifest,
    session: SessionV2ReviewRepairState,
    to: SessionV2ReviewRepairStatus,
): Promise<void> {
    await journal.transitionSession(paths, manifest, session, to);
}

/** 持久化 repair run 阶段。 */
export async function transitionRun(
    paths: SessionV2ReviewRepairJournalPaths,
    manifest: SessionV2ReviewRepairManifest,
    to: SessionV2ReviewRepairRunStatus,
    error?: string,
): Promise<void> {
    await journal.transitionRun(paths, manifest, to, error);
}

function parseSession(
    value: {[key: string]: unknown},
    base: SessionMigrationFileState<SessionV2ReviewRepairStatus>,
): SessionV2ReviewRepairState {
    if (!isPositiveInteger(value.sessionId)
        || typeof value.sourceMigrationRunId !== "string" || !/^[A-Za-z0-9_-]+$/u.test(value.sourceMigrationRunId)
        || typeof value.sourceBackupPath !== "string" || !value.sourceBackupPath
        || !isNonNegativeInteger(value.migrationTimestamp)
        || !(value.currentProjectRoot === null || isProjectRoot(value.currentProjectRoot))
        || typeof value.reviewRequired !== "boolean"
        || !isSha256(value.oldPrefixHash)
        || !isSha256(value.newPrefixHash)
        || !isSha256(value.suffixHash)) {
        throw new Error("Session v2 review repair manifest 字段无效");
    }
    return {
        ...base,
        sessionId: value.sessionId,
        sourceMigrationRunId: value.sourceMigrationRunId,
        sourceBackupPath: value.sourceBackupPath,
        migrationTimestamp: value.migrationTimestamp,
        currentProjectRoot: value.currentProjectRoot,
        reviewRequired: value.reviewRequired,
        oldPrefixHash: value.oldPrefixHash,
        newPrefixHash: value.newPrefixHash,
        suffixHash: value.suffixHash,
    };
}

function isPositiveInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isSha256(value: unknown): value is string {
    return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isProjectRoot(value: unknown): value is string {
    return typeof value === "string" && value.length > 0 && !value.includes("/") && !value.includes("\\") && !value.includes("\0");
}
