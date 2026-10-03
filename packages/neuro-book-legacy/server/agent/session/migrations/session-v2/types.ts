import type {
    LegacySessionClassification,
    SessionMigrationRecordedReviewReason,
    SessionMigrationReviewReason,
    SessionSchemaV2MigrationStats,
} from "nbook/server/agent/session/migrations/session-v2/legacy-decoder";
import type {
    SessionMigrationFileState,
    SessionMigrationManifest,
} from "nbook/server/agent/session/migrations/shared/types";

/** Session schema v2 单文件事务的持久化阶段。 */
export type SessionSchemaV2Status =
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

/** Session schema v2 migration run 的 WAL 阶段。 */
export type SessionSchemaV2RunStatus =
    | "running"
    | "failed"
    | "full_scan_verified"
    | "complete"
    | "report_written"
    | "rollback_running"
    | "rolled_back";

/** decoder 计划补齐 checksum 后的 runner 内存计划。 */
export type SessionSchemaV2Plan = {
    sourcePath: string;
    sourceText: string;
    targetText: string;
    sourceHash: string;
    targetHash: string;
    changed: boolean;
    migrationTimestamp: number;
    sessionId: number;
    profileKey: string;
    classification: LegacySessionClassification;
    currentProjectRoot?: string;
    decoderFormat: 1 | 2;
    reviewReasons: SessionMigrationRecordedReviewReason[];
    ambiguousLocations: string[];
    stats: SessionSchemaV2MigrationStats;
};

/** manifest 中一个 Session 的 immutable 计划与可恢复状态。 */
export type SessionSchemaV2State = SessionMigrationFileState<SessionSchemaV2Status> & {
    sessionId: number;
    profileKey: string;
    classification: LegacySessionClassification;
    /** manifest 固定字段；Workspace Root/user-assets/external Session 为 null。 */
    currentProjectRoot: string | null;
    reviewReasons: SessionMigrationRecordedReviewReason[];
    /** 1表示历史 path-review decoder；2表示仅按Project归属写review。 */
    decoderFormat: 1 | 2;
    ambiguousLocations: string[];
    migrationTimestamp: number;
    rewrittenPaths: number;
    resetProfileReminders: number;
    cancelledToolCalls: number;
    clearedPendingResolutions: number;
    clearedFollowUpQueue: boolean;
};

/** Session schema v2 migration 的 manifest/checkpoint。 */
export type SessionSchemaV2Manifest = SessionMigrationManifest<
    1,
    SessionSchemaV2State,
    SessionSchemaV2Status,
    SessionSchemaV2RunStatus,
    Exclude<SessionSchemaV2RunStatus, "failed" | "report_written" | "rolled_back">
>;

/** CLI 和 Manager 可消费的 machine-readable 报告。 */
export type SessionSchemaV2Report = {
    version: 1;
    runId: string;
    mode: "dry-run" | "apply";
    status: "planned" | "complete" | "already_current";
    scannedSessions: number;
    migratedSessions: number;
    skippedSessions: number;
    reviewSessions: number;
    stats: SessionSchemaV2MigrationStats;
    sessions: Array<{
        sessionId: number;
        sourcePath: string;
        classification: LegacySessionClassification;
        currentProjectRoot?: string;
        reviewReasons: SessionMigrationRecordedReviewReason[];
        sourceHash: string;
        targetHash: string;
        status: SessionSchemaV2Status;
        /** apply 建立 backup 后存在。 */
        backupPath?: string;
    }>;
};

/** Session schema v2 offline migration 入口参数。 */
export type RunSessionSchemaV2Options = {
    rootWorkspace: string;
    mode: "dry-run" | "apply";
    runId?: string;
    resume?: boolean;
    /** 测试与恢复可冻结时间；普通新 run 默认使用 Date.now()。 */
    migrationTimestamp?: number;
    observer?: (event:
        | {kind: "session"; sourcePath: string; status: SessionSchemaV2Status}
        | {kind: "run"; status: SessionSchemaV2RunStatus}
        | {kind: "sentinel"; state: "pending" | "applying" | "complete" | "rollback_required"}
    ) => void | Promise<void>;
};

/** 成功 rollback 的稳定报告。 */
export type SessionSchemaV2RollbackReport = {
    version: 1;
    runId: string;
    status: "not_started" | "rolled_back";
    restoredSessions: number;
};

/** Session schema v2 rollback 入口参数。 */
export type RollbackSessionSchemaV2Options = {
    rootWorkspace: string;
    runId?: string;
    observer?: (event: {
        sourcePath: string;
        status: "rollback_pending" | "rollback_publishing" | "rolled_back";
    }) => void | Promise<void>;
};
