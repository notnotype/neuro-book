import type {
    SessionMigrationFileState,
    SessionMigrationManifest,
} from "nbook/server/agent/session/migrations/shared/types";

/** Session v2 review repair 单文件事务阶段。 */
export type SessionV2ReviewRepairStatus =
    | "pending"
    | "backed_up"
    | "prepared"
    | "staged"
    | "publishing"
    | "published"
    | "verified"
    | "rollback_pending"
    | "rollback_publishing"
    | "rolled_back";

/** Session v2 review repair run 阶段。 */
export type SessionV2ReviewRepairRunStatus =
    | "running"
    | "failed"
    | "full_scan_verified"
    | "complete"
    | "report_written"
    | "rollback_running"
    | "rolled_back";

/** repair decoder 交给文件事务层的完整计划。 */
export type SessionV2ReviewRepairPlan = {
    sourceText: string;
    targetText: string;
    sourceHash: string;
    targetHash: string;
    changed: boolean;
    oldPrefixHash: string;
    newPrefixHash: string;
    suffixHash: string;
    currentProjectRoot: string | null;
    reviewRequired: boolean;
};

/** repair manifest 中一个 Session 的冻结计划。 */
export type SessionV2ReviewRepairState = SessionMigrationFileState<SessionV2ReviewRepairStatus> & {
    sessionId: number;
    sourceMigrationRunId: string;
    sourceBackupPath: string;
    migrationTimestamp: number;
    currentProjectRoot: string | null;
    reviewRequired: boolean;
    oldPrefixHash: string;
    newPrefixHash: string;
    suffixHash: string;
};

/** Session v2 review repair 的 WAL/checkpoint manifest。 */
export type SessionV2ReviewRepairManifest = SessionMigrationManifest<
    1,
    SessionV2ReviewRepairState,
    SessionV2ReviewRepairStatus,
    SessionV2ReviewRepairRunStatus,
    Exclude<SessionV2ReviewRepairRunStatus, "failed" | "report_written" | "rolled_back">
>;

/** CLI 与 Application State runner 消费的 repair 报告。 */
export type SessionV2ReviewRepairReport = {
    version: 1;
    runId: string;
    mode: "dry-run" | "apply";
    status: "planned" | "complete" | "already_current";
    scannedSessions: number;
    repairedSessions: number;
    reviewSessions: number;
};

/** repair apply/dry-run 入口参数。 */
export type RunSessionV2ReviewRepairOptions = {
    rootWorkspace: string;
    mode: "dry-run" | "apply";
    runId?: string;
    resume?: boolean;
};

/** repair rollback 的稳定报告。 */
export type SessionV2ReviewRepairRollbackReport = {
    version: 1;
    runId: string;
    status: "not_started" | "rolled_back";
    restoredSessions: number;
};
