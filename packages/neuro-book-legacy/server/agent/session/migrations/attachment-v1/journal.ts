import {SessionMigrationJournal} from "nbook/server/agent/session/migrations/shared/journal";
import type {
    SessionMigrationFileState,
    SessionMigrationJournalPaths,
    SessionMigrationStatusMap,
} from "nbook/server/agent/session/migrations/shared/types";
import type {
    AttachmentMigrationManifest,
    AttachmentMigrationRunStatus,
    AttachmentSessionMigrationState,
    AttachmentSessionMigrationStatus,
} from "nbook/server/agent/session/migrations/attachment-v1/types";

const ATTACHMENT_ID_PATTERN = /^sha256:[a-f0-9]{64}$/;

/** Attachment v1 保持既有持久化状态字符串的通用事务阶段映射。 */
export const ATTACHMENT_MIGRATION_STATUS = {
    session: {
        pending: "pending",
        backedUp: "backed_up",
        prepared: "attachments_written",
        staged: "temp_verified",
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
} as const satisfies SessionMigrationStatusMap<AttachmentSessionMigrationStatus, AttachmentMigrationRunStatus>;

type AttachmentResumeStatus = Exclude<
    AttachmentMigrationRunStatus,
    "failed" | "report_written" | "rolled_back"
>;

const journal = new SessionMigrationJournal<
    2,
    AttachmentSessionMigrationStatus,
    AttachmentMigrationRunStatus,
    AttachmentResumeStatus,
    AttachmentSessionMigrationState
>({
    manifestVersion: 2,
    status: ATTACHMENT_MIGRATION_STATUS,
    runRoot: (runId) => `.nbook/agent/migrations/attachment-v1/${runId}`,
    sessionFields: ["sessionId", "images", "bytes", "attachmentIds"],
    parseSessionFields: (value, base) => parseAttachmentSession(value, base),
});

/** WAL 与 checkpoint 使用的 Attachment v1 迁移文件路径。 */
export type AttachmentMigrationJournalPaths = SessionMigrationJournalPaths;

/** 原子写入 Attachment v1 初始计划 manifest。 */
export async function writeInitialManifest(
    paths: AttachmentMigrationJournalPaths,
    manifest: AttachmentMigrationManifest,
): Promise<void> {
    await journal.writeInitialManifest(paths, manifest);
}

/** 写入 Attachment v1 终态 compact checkpoint。 */
export async function checkpointManifest(
    paths: AttachmentMigrationJournalPaths,
    manifest: AttachmentMigrationManifest,
): Promise<void> {
    await journal.checkpointManifest(paths, manifest);
}

/** 读取并回放 Attachment v1 manifest 与 WAL。 */
export async function loadManifest(
    paths: AttachmentMigrationJournalPaths,
): Promise<AttachmentMigrationManifest | null> {
    return journal.loadManifest(paths);
}

/** 持久化一个 Attachment session 状态变化。 */
export async function transitionSession(
    paths: AttachmentMigrationJournalPaths,
    manifest: AttachmentMigrationManifest,
    session: AttachmentSessionMigrationState,
    to: AttachmentSessionMigrationStatus,
): Promise<void> {
    await journal.transitionSession(paths, manifest, session, to);
}

/** 持久化一个 Attachment migration run 状态变化。 */
export async function transitionRun(
    paths: AttachmentMigrationJournalPaths,
    manifest: AttachmentMigrationManifest,
    to: AttachmentMigrationRunStatus,
    error?: string,
): Promise<void> {
    await journal.transitionRun(paths, manifest, to, error);
}

/** 严格解析 Attachment 专用统计字段，不参与通用文件事务。 */
function parseAttachmentSession(
    value: {[key: string]: unknown},
    base: SessionMigrationFileState<AttachmentSessionMigrationStatus>,
): AttachmentSessionMigrationState {
    const validSessionId = value.sessionId === null
        || (Number.isSafeInteger(value.sessionId) && (value.sessionId as number) > 0);
    if (!validSessionId
        || !Number.isSafeInteger(value.images) || (value.images as number) < 0
        || !Number.isSafeInteger(value.bytes) || (value.bytes as number) < 0
        || !Array.isArray(value.attachmentIds)
        || !value.attachmentIds.every((id) => typeof id === "string" && ATTACHMENT_ID_PATTERN.test(id))) {
        throw new Error("migration session 字段无效");
    }
    return {
        ...base,
        sessionId: value.sessionId as number | null,
        images: value.images as number,
        bytes: value.bytes as number,
        attachmentIds: value.attachmentIds as string[],
    };
}
