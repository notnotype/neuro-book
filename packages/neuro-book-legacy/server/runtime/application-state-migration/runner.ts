import {randomUUID} from "node:crypto";
import {readFile, rm} from "node:fs/promises";
import {resolve} from "node:path";
import {planAppSqliteMigrations} from "nbook/server/database/app-sqlite-migrations";
import {
    applyAppSqliteMigrationStep,
    hasAppSqliteMigrationArtifacts,
    rollbackAppSqliteMigrationStep,
} from "nbook/server/runtime/application-state-migration/app-sqlite-step";
import {
    applicationStateCatalog,
    historicalStepRunId,
    parseMigrationApplicationStateJournal,
    parseMigrationApplicationStateSentinel,
    type MigrationApplicationStateJournal,
    type MigrationApplicationStateSentinel,
    type MigrationPreviousSentinel,
    type PreviousSentinelBytes,
} from "nbook/server/runtime/application-state-migration/catalog-registry";
import {acquireApplicationStateLease} from "nbook/server/runtime/application-state-migration/lease";
import {resolveApplicationRoot} from "nbook/server/runtime/installation-paths";
import {rollbackAgentAttachmentMigration, runAgentAttachmentMigration} from "nbook/server/agent/session/migrations/attachment-v1/migration";
import type {AttachmentMigrationReport} from "nbook/server/agent/session/migrations/attachment-v1/types";
import {
    rollbackSessionSchemaV2Migration,
    runSessionSchemaV2Migration,
} from "nbook/server/agent/session/migrations/session-v2/migration";
import {
    rollbackSessionV2ReviewRepair,
    runSessionV2ReviewRepair,
} from "nbook/server/agent/session/migrations/session-v2-review-repair/migration";
import {
    AGENT_SESSION_SCHEMA_VERSION,
    AgentSessionMigrationRequiredError,
    readAgentSessionStoreSentinel,
} from "nbook/server/agent/session/agent-session-store";
import {applicationStateSentinelPath, type ApplicationStateStepState} from "nbook/server/runtime/application-state";
import {ATTACHMENT_MIGRATION_LOCK_RELATIVE_PATH} from "nbook/server/agent/session/attachment-migration-gate";
import {
    pathExists,
    sha256,
    writeAtomicDurableBytes,
    writeAtomicDurableJson,
} from "nbook/server/agent/session/migrations/shared/durable-file";
import type {
    ApplicationStateMigrationAction,
    ApplicationStateMigrationReport,
    ApplicationStateMigrationStepId,
    ApplicationStateMigrationStepReport,
    RunApplicationStateMigrationOptions,
} from "nbook/server/runtime/application-state-migration/types";
import {
    APPLICATION_STATE_MIGRATION_CATALOG_VERSION,
    APPLICATION_STATE_MIGRATION_STEP_IDS,
} from "nbook/server/runtime/application-state-migration/catalog";

const RUN_ID_PATTERN = /^[A-Za-z0-9_-]+$/u;
const CURRENT_VERSION = APPLICATION_STATE_MIGRATION_CATALOG_VERSION;

type SentinelSnapshot = {
    sentinel: MigrationApplicationStateSentinel;
    bytes: Buffer;
};

/** 按 Product catalog 规划、应用、恢复或反序回滚 Application State。 */
export async function runApplicationStateMigration(
    options: RunApplicationStateMigrationOptions,
): Promise<ApplicationStateMigrationReport> {
    const rootWorkspace = resolve(options.rootWorkspace);
    if (options.action === "plan") {
        const runId = validatedRunId(options.runId ?? randomUUID());
        return planMigration(rootWorkspace, runId, await readSentinelSnapshot(rootWorkspace));
    }
    const releaseLease = await acquireApplicationStateLease(rootWorkspace);
    try {
        if (options.action === "apply") {
            const runId = validatedRunId(options.runId ?? randomUUID());
            return applyMigration(rootWorkspace, runId, await readSentinelSnapshot(rootWorkspace));
        }
        const snapshot = await readSentinelSnapshot(rootWorkspace);
        const inferredRunId = snapshot?.sentinel.state === "complete" ? undefined : snapshot?.sentinel.runId;
        const runId = validatedRunId(options.runId ?? inferredRunId ?? "");
        return options.action === "resume"
            ? resumeMigration(rootWorkspace, runId, snapshot?.sentinel ?? null)
            : rollbackMigration(rootWorkspace, runId, snapshot?.sentinel ?? null);
    } finally {
        await releaseLease();
    }
}

/** plan 只读检查；旧 complete catalog 需要新 run，incomplete 只能恢复或回滚。 */
async function planMigration(
    rootWorkspace: string,
    runId: string,
    current: SentinelSnapshot | null,
): Promise<ApplicationStateMigrationReport> {
    if (current && current.sentinel.state !== "complete") {
        throw new Error(
            `Application State migration ${current.sentinel.runId} 处于 ${current.sentinel.state}；只能 --resume 或 --rollback。`,
        );
    }
    const sqlite = await planAppSqliteMigrations({applicationRoot: resolveApplicationRoot()});
    const applied = new Set(current?.sentinel.steps
        .filter((step) => step.status === "applied")
        .map((step) => step.id) ?? []);
    const currentSteps = new Map(current?.sentinel.steps.map((step) => [step.id, step]) ?? []);
    const isCurrentCatalog = current?.sentinel.catalogVersion === CURRENT_VERSION;
    const steps: ApplicationStateMigrationStepReport[] = [];
    steps.push(stepReport(
        "app-sqlite",
        runId,
        sqlite.pendingMigrationIds.length > 0 ? "planned" : "skipped",
        sqlite.pendingMigrationIds.length,
        0,
    ));

    if (applied.has("agent-attachment-v1")) {
        steps.push(stepReport("agent-attachment-v1", runId, "skipped", 0, 0));
    } else {
        const attachment = await runAgentAttachmentMigration({
            rootWorkspace,
            mode: "dry-run",
            runId: historicalStepRunId(runId, "agent-attachment-v1"),
        });
        const wasSkippedInCurrentCatalog = isCurrentCatalog
            && currentSteps.get("agent-attachment-v1")?.status === "skipped";
        steps.push(stepReport(
            "agent-attachment-v1",
            runId,
            wasSkippedInCurrentCatalog && attachment.migratedSessions === 0 ? "skipped" : "planned",
            attachment.migratedSessions,
            0,
        ));
    }

    // Session 自有 sentinel/manifest 是 schema ready 的权威证明，顶层投影不能替代它。
    const session = await runSessionSchemaV2Migration({
        rootWorkspace,
        mode: "dry-run",
        runId: historicalStepRunId(runId, "agent-session-v2"),
    });
    const sessionReady = session.status === "already_current";
    if (applied.has("agent-session-v2") && !sessionReady) {
        throw new Error("Application State 声明 Session v2 已完成，但 Session Store 未处于 schema v2 complete。" );
    }
    if (sessionReady) {
        steps.push(stepReport("agent-session-v2", runId, "skipped", 0, 0));
    } else {
        steps.push(stepReport("agent-session-v2", runId, "planned", session.migratedSessions, session.reviewSessions));
    }

    if (applied.has("agent-session-v2-review-repair") || !sessionReady) {
        steps.push(stepReport("agent-session-v2-review-repair", runId, "skipped", 0, 0));
    } else {
        const repair = await runSessionV2ReviewRepair({
            rootWorkspace,
            mode: "dry-run",
            runId: historicalStepRunId(runId, "agent-session-v2-review-repair"),
        });
        steps.push(stepReport(
            "agent-session-v2-review-repair",
            runId,
            repair.repairedSessions > 0 ? "planned" : "skipped",
            repair.repairedSessions,
            repair.reviewSessions,
        ));
    }
    const status = isCurrentCatalog && steps.every((step) => step.status === "skipped")
        ? "already_current"
        : "planned";
    return report(runId, CURRENT_VERSION, "plan", status, steps);
}

/** apply 在顶层 lease 内重新 plan，并冻结旧 sentinel 原始 bytes。 */
async function applyMigration(
    rootWorkspace: string,
    runId: string,
    current: SentinelSnapshot | null,
): Promise<ApplicationStateMigrationReport> {
    const plan = await planMigration(rootWorkspace, runId, current);
    if (plan.status === "already_current") return {...plan, action: "apply"};
    if (await readJournal(rootWorkspace, runId)) {
        throw new Error(`Application State migration ${runId} 已存在；请使用 --resume 或 --rollback。`);
    }
    const journal: MigrationApplicationStateJournal = {
        version: 1,
        catalogVersion: CURRENT_VERSION,
        runId,
        state: "applying",
        previousSentinel: {kind: "bytes", backup: previousBytes(current)},
        steps: plan.steps.map((step) => ({
            id: step.id,
            runId: step.runId,
            status: step.status === "skipped" ? "skipped" : "pending",
            changedItems: step.changedItems,
            reviewItems: step.reviewItems,
        })),
    };
    await publishJournal(rootWorkspace, journal);
    return executeMigration(rootWorkspace, journal, "apply");
}

/** resume 按 journal 自身 catalogVersion 分派，不能把旧 run 提升为新 catalog。 */
async function resumeMigration(
    rootWorkspace: string,
    runId: string,
    current: MigrationApplicationStateSentinel | null,
): Promise<ApplicationStateMigrationReport> {
    const journal = await readJournal(rootWorkspace, runId);
    if (!journal) throw new Error(`Application State migration ${runId} 不存在。`);
    if (current && current.runId !== runId) {
        throw new Error(`Current Application State 属于 ${current.runId}，不能恢复 ${runId}。`);
    }
    if (journal.state === "complete") {
        return report(runId, journal.catalogVersion, "resume", "complete", journal.steps);
    }
    if (journal.state === "rolled_back") throw new Error(`Application State migration ${runId} 已回滚。`);
    journal.state = "applying";
    await publishJournal(rootWorkspace, journal);
    return executeMigration(rootWorkspace, journal, "resume");
}

/** 逐步执行 journal 所属历史 catalog；checkpoint 晚于子步骤时由 artifact 对账。 */
async function executeMigration(
    rootWorkspace: string,
    journal: MigrationApplicationStateJournal,
    action: "apply" | "resume",
): Promise<ApplicationStateMigrationReport> {
    try {
        for (const step of journal.steps) {
            if (step.status === "applied" || step.status === "skipped") continue;
            if (await hasOwnedStepArtifacts(rootWorkspace, step)) {
                const completed = await completedStepReport(rootWorkspace, step);
                if (completed) {
                    Object.assign(step, completed, {status: "applied" as const});
                    await publishJournal(rootWorkspace, journal);
                    continue;
                }
            }
            const completed = await applyStep(rootWorkspace, step);
            Object.assign(step, completed);
            await publishJournal(rootWorkspace, journal);
        }
        journal.state = "complete";
        await publishJournal(rootWorkspace, journal);
        return report(journal.runId, journal.catalogVersion, action, "complete", journal.steps);
    } catch (error) {
        journal.state = "rollback_required";
        await publishJournal(rootWorkspace, journal).catch(() => undefined);
        throw error;
    }
}

async function applyStep(rootWorkspace: string, step: ApplicationStateStepState): Promise<Partial<ApplicationStateStepState>> {
    if (step.id === "app-sqlite") {
        const result = await applyAppSqliteMigrationStep({
            rootWorkspace,
            runId: step.runId,
            applicationRoot: resolveApplicationRoot(),
        });
        return {status: "applied", changedItems: result.appliedMigrationIds.length, reviewItems: 0};
    }
    if (step.id === "agent-attachment-v1") {
        const result = await applyAttachmentStep(rootWorkspace, step.runId);
        return {status: "applied", changedItems: result.migratedSessions, reviewItems: 0};
    }
    if (step.id === "agent-session-v2") {
        const result = await applySessionStep(rootWorkspace, step.runId);
        return {
            status: result.status === "already_current" && result.runId !== step.runId ? "skipped" : "applied",
            changedItems: result.migratedSessions,
            reviewItems: result.reviewSessions,
        };
    }
    if (step.id === "agent-session-v2-review-repair") {
        const result = await applyRepairStep(rootWorkspace, step.runId);
        return {
            status: result.status === "already_current" ? "skipped" : "applied",
            changedItems: result.repairedSessions,
            reviewItems: result.reviewSessions,
        };
    }
    throw new Error(`Application State step 不受支持：${step.id}`);
}

/** Application rollback 逆序收敛 owned artifact，再恢复进入 run 前的 sentinel。 */
async function rollbackMigration(
    rootWorkspace: string,
    runId: string,
    current: MigrationApplicationStateSentinel | null,
): Promise<ApplicationStateMigrationReport> {
    const journal = await readJournal(rootWorkspace, runId) ?? await adoptLegacyAttachmentRun(rootWorkspace, runId);
    if (!journal) return report(runId, CURRENT_VERSION, "rollback", "not_started", []);
    if (current && current.runId !== runId && current.state !== "complete") {
        throw new Error(`Current Application State 属于 ${current.runId}，不能回滚 ${runId}。`);
    }
    if (journal.state === "rolled_back") {
        return report(runId, journal.catalogVersion, "rollback", "rolled_back", journal.steps);
    }
    try {
        for (const step of [...journal.steps].reverse()) {
            if (step.status === "pending" && await hasOwnedStepArtifacts(rootWorkspace, step)) {
                step.status = "applied";
                await publishJournal(rootWorkspace, journal);
            }
            if (step.status !== "applied") continue;
            await rollbackStep(rootWorkspace, step);
            step.status = "rolled_back";
            await writeJournal(rootWorkspace, journal);
        }
        journal.state = "rolled_back";
        await writeJournal(rootWorkspace, journal);
        await restorePreviousSentinel(rootWorkspace, journal.previousSentinel);
        return report(runId, journal.catalogVersion, "rollback", "rolled_back", journal.steps);
    } catch (error) {
        journal.state = "rollback_required";
        await publishJournal(rootWorkspace, journal).catch(() => undefined);
        throw error;
    }
}

async function rollbackStep(rootWorkspace: string, step: ApplicationStateStepState): Promise<void> {
    if (step.id === "agent-session-v2-review-repair") {
        const result = await rollbackSessionV2ReviewRepair(rootWorkspace, step.runId);
        if (result.status === "not_started") throw new Error(`Review repair ${step.runId} 缺少可回滚状态。`);
        return;
    }
    if (step.id === "agent-session-v2") {
        const result = await rollbackSessionSchemaV2Migration({rootWorkspace, runId: step.runId});
        if (result.status === "not_started") throw new Error(`Session migration ${step.runId} 缺少可回滚状态。`);
        return;
    }
    if (step.id === "agent-attachment-v1") {
        const result = await rollbackAgentAttachmentMigration({rootWorkspace, runId: step.runId});
        if (result.status === "not_started") throw new Error(`Attachment migration ${step.runId} 缺少可回滚状态。`);
        return;
    }
    if (step.id === "app-sqlite") {
        const status = await rollbackAppSqliteMigrationStep(rootWorkspace, step.runId);
        if (status !== "rolled_back") throw new Error(`App SQLite migration ${step.runId} 缺少可回滚状态。`);
        return;
    }
    throw new Error(`Application State step 不受支持：${step.id}`);
}

/** Manager 旧 Attachment-only operation 在首次 rollback 时收口为 current journal。 */
async function adoptLegacyAttachmentRun(
    rootWorkspace: string,
    runId: string,
): Promise<MigrationApplicationStateJournal | null> {
    const attachmentRunId = historicalStepRunId(runId, "agent-attachment-v1");
    const runRoot = resolve(rootWorkspace, `.nbook/agent/migrations/attachment-v1/${attachmentRunId}`);
    const lockPath = resolve(rootWorkspace, ATTACHMENT_MIGRATION_LOCK_RELATIVE_PATH);
    if (!await pathExists(runRoot) && !await pathExists(lockPath)) return null;
    const snapshot = await readSentinelSnapshot(rootWorkspace);
    if (snapshot) throw new Error("不能在已有 Application State sentinel 时接管旧 Attachment operation。" );
    const journal: MigrationApplicationStateJournal = {
        version: 1,
        catalogVersion: CURRENT_VERSION,
        runId,
        state: "rollback_required",
        previousSentinel: {kind: "bytes", backup: {exists: false}},
        steps: APPLICATION_STATE_MIGRATION_STEP_IDS.map((id) => ({
            id,
            runId: historicalStepRunId(runId, id),
            status: id === "agent-attachment-v1" ? "applied" : "pending",
            changedItems: 0,
            reviewItems: 0,
        })),
    };
    await publishJournal(rootWorkspace, journal);
    return journal;
}

/** Attachment step 通过 report/lock 判断新 apply 或 resume。 */
async function applyAttachmentStep(rootWorkspace: string, runId: string): Promise<AttachmentMigrationReport> {
    const reportPath = resolve(rootWorkspace, `.nbook/agent/migrations/attachment-v1/${runId}/report.json`);
    if (await pathExists(reportPath)) {
        const value = JSON.parse(await readFile(reportPath, "utf8")) as AttachmentMigrationReport;
        if (value.runId !== runId || value.mode !== "apply" || value.status !== "complete") {
            throw new Error(`Attachment migration report 与 ${runId} 不一致。`);
        }
        return value;
    }
    const lockPath = resolve(rootWorkspace, ATTACHMENT_MIGRATION_LOCK_RELATIVE_PATH);
    if (await pathExists(lockPath)) {
        const lock = JSON.parse(await readFile(lockPath, "utf8")) as {runId?: string};
        if (lock.runId !== runId) throw new Error(`Attachment migration lock 属于 ${lock.runId ?? "unknown"}。`);
        return runAgentAttachmentMigration({rootWorkspace, mode: "apply", runId, resume: true});
    }
    const runRoot = resolve(rootWorkspace, `.nbook/agent/migrations/attachment-v1/${runId}`);
    if (await pathExists(runRoot)) throw new Error(`Attachment migration ${runId} 缺少 lock/report。`);
    return runAgentAttachmentMigration({rootWorkspace, mode: "apply", runId});
}

/** Session step 以 schema sentinel 判定恢复路径。 */
async function applySessionStep(rootWorkspace: string, runId: string) {
    try {
        const sentinel = await readAgentSessionStoreSentinel(rootWorkspace);
        if (sentinel.state === "complete") {
            if (sentinel.targetSchemaVersion === AGENT_SESSION_SCHEMA_VERSION
                || sentinel.sourceSchemaVersion === AGENT_SESSION_SCHEMA_VERSION && sentinel.targetSchemaVersion === 1) {
                return runSessionSchemaV2Migration({rootWorkspace, mode: "apply", runId});
            }
            throw new Error(`Session schema ${sentinel.sourceSchemaVersion}->${sentinel.targetSchemaVersion} 无法升级。`);
        }
        if (sentinel.runId !== runId) throw new Error(`Session migration sentinel 属于 ${sentinel.runId}。`);
        return runSessionSchemaV2Migration({rootWorkspace, mode: "apply", runId, resume: true});
    } catch (error) {
        if (!(error instanceof AgentSessionMigrationRequiredError)) throw error;
        const runRoot = resolve(rootWorkspace, `.nbook/agent/migrations/session-v2/${runId}`);
        return runSessionSchemaV2Migration({
            rootWorkspace,
            mode: "apply",
            runId,
            ...(await pathExists(runRoot) ? {resume: true} : {}),
        });
    }
}

async function applyRepairStep(rootWorkspace: string, runId: string) {
    const reportPath = resolve(rootWorkspace, `.nbook/agent/migrations/session-v2-review-repair/${runId}/report.json`);
    if (await pathExists(reportPath)) {
        return runSessionV2ReviewRepair({rootWorkspace, mode: "apply", runId, resume: true});
    }
    const runRoot = resolve(rootWorkspace, `.nbook/agent/migrations/session-v2-review-repair/${runId}`);
    return runSessionV2ReviewRepair({
        rootWorkspace,
        mode: "apply",
        runId,
        ...(await pathExists(runRoot) ? {resume: true} : {}),
    });
}

/** 判断 pending step 是否已经取得 durable ownership。 */
async function hasOwnedStepArtifacts(rootWorkspace: string, step: ApplicationStateStepState): Promise<boolean> {
    if (step.id === "app-sqlite") return hasAppSqliteMigrationArtifacts(rootWorkspace, step.runId);
    if (step.id === "agent-attachment-v1") {
        const runRoot = resolve(rootWorkspace, `.nbook/agent/migrations/attachment-v1/${step.runId}`);
        if (await pathExists(runRoot)) return true;
        const lockPath = resolve(rootWorkspace, ATTACHMENT_MIGRATION_LOCK_RELATIVE_PATH);
        if (!await pathExists(lockPath)) return false;
        const lock = JSON.parse(await readFile(lockPath, "utf8")) as {runId?: unknown};
        if (lock.runId !== step.runId) throw new Error(`Attachment lock 属于 ${String(lock.runId ?? "unknown")}。`);
        return true;
    }
    if (step.id === "agent-session-v2") {
        const runRoot = resolve(rootWorkspace, `.nbook/agent/migrations/session-v2/${step.runId}`);
        try {
            const sentinel = await readAgentSessionStoreSentinel(rootWorkspace);
            if (sentinel.runId === step.runId) return true;
            if (await pathExists(runRoot)) throw new Error(`Session run ${step.runId} 与 current ${sentinel.runId} 冲突。`);
            return false;
        } catch (error) {
            if (!(error instanceof AgentSessionMigrationRequiredError)) throw error;
            return pathExists(runRoot);
        }
    }
    if (step.id === "agent-session-v2-review-repair") {
        return pathExists(resolve(rootWorkspace, `.nbook/agent/migrations/session-v2-review-repair/${step.runId}`));
    }
    throw new Error(`Application State step 不受支持：${step.id}`);
}

/** 已有 artifact 时尝试完成原 step，避免重复执行创建入口。 */
async function completedStepReport(
    rootWorkspace: string,
    step: ApplicationStateStepState,
): Promise<Partial<ApplicationStateStepState> | null> {
    if (step.id === "agent-attachment-v1") {
        const result = await applyAttachmentStep(rootWorkspace, step.runId);
        return {changedItems: result.migratedSessions, reviewItems: 0};
    }
    if (step.id === "agent-session-v2") {
        const result = await applySessionStep(rootWorkspace, step.runId);
        return {changedItems: result.migratedSessions, reviewItems: result.reviewSessions};
    }
    if (step.id === "agent-session-v2-review-repair") {
        const result = await applyRepairStep(rootWorkspace, step.runId);
        return {changedItems: result.repairedSessions, reviewItems: result.reviewSessions};
    }
    return null;
}

function report(
    runId: string,
    catalogVersion: number,
    action: ApplicationStateMigrationAction,
    status: ApplicationStateMigrationReport["status"],
    steps: ReadonlyArray<ApplicationStateStepState | ApplicationStateMigrationStepReport>,
): ApplicationStateMigrationReport {
    return {
        version: 1,
        catalogVersion,
        runId,
        action,
        status,
        steps: steps.map((step) => ({
            id: currentStepId(step.id),
            runId: step.runId,
            status: step.status === "pending" ? "planned" : step.status,
            changedItems: step.changedItems,
            reviewItems: step.reviewItems,
        })),
    };
}

function stepReport(
    id: ApplicationStateMigrationStepId,
    applicationRunId: string,
    status: ApplicationStateMigrationStepReport["status"],
    changedItems: number,
    reviewItems: number,
): ApplicationStateMigrationStepReport {
    return {id, runId: historicalStepRunId(applicationRunId, id), status, changedItems, reviewItems};
}

async function publishJournal(rootWorkspace: string, journal: MigrationApplicationStateJournal): Promise<void> {
    await writeJournal(rootWorkspace, journal);
    const sentinel: MigrationApplicationStateSentinel = {
        version: 1,
        catalogVersion: journal.catalogVersion,
        runId: journal.runId,
        state: journal.state,
        steps: journal.steps,
    };
    await writeAtomicDurableJson(applicationStateSentinelPath(rootWorkspace), sentinel);
}

async function writeJournal(rootWorkspace: string, journal: MigrationApplicationStateJournal): Promise<void> {
    const previousSentinel = journal.previousSentinel.kind === "bytes"
        ? journal.previousSentinel.backup
        : journal.previousSentinel.sentinel;
    await writeAtomicDurableJson(applicationJournalPath(rootWorkspace, journal.runId), {
        version: journal.version,
        catalogVersion: journal.catalogVersion,
        runId: journal.runId,
        state: journal.state,
        previousSentinel,
        steps: journal.steps,
    });
}

async function restorePreviousSentinel(rootWorkspace: string, previous: MigrationPreviousSentinel): Promise<void> {
    const path = applicationStateSentinelPath(rootWorkspace);
    if (previous.kind === "historical") {
        if (previous.sentinel) await writeAtomicDurableJson(path, previous.sentinel);
        else await rm(path, {force: true});
        return;
    }
    if (!previous.backup.exists) {
        await rm(path, {force: true});
        return;
    }
    const bytes = Buffer.from(previous.backup.bytesBase64 as string, "base64");
    if (sha256(bytes) !== previous.backup.sha256) throw new Error("previous sentinel checksum 冲突");
    await writeAtomicDurableBytes(path, bytes);
}

async function readSentinelSnapshot(rootWorkspace: string): Promise<SentinelSnapshot | null> {
    const path = applicationStateSentinelPath(rootWorkspace);
    let bytes: Buffer;
    try {
        bytes = await readFile(path);
    } catch (error) {
        if (isNodeError(error, "ENOENT")) return null;
        throw error;
    }
    try {
        return {
            sentinel: parseMigrationApplicationStateSentinel(JSON.parse(bytes.toString("utf8")) as unknown),
            bytes,
        };
    } catch (error) {
        throw new Error(`Application State sentinel 无效：${path}`, {cause: error});
    }
}

async function readJournal(rootWorkspace: string, runId: string): Promise<MigrationApplicationStateJournal | null> {
    const path = applicationJournalPath(rootWorkspace, runId);
    if (!await pathExists(path)) return null;
    try {
        return parseMigrationApplicationStateJournal(JSON.parse(await readFile(path, "utf8")) as unknown, runId);
    } catch (error) {
        throw new Error(`Application State migration journal 无效：${path}`, {cause: error});
    }
}

function previousBytes(current: SentinelSnapshot | null): PreviousSentinelBytes {
    if (!current) return {exists: false};
    return {
        exists: true,
        bytesBase64: current.bytes.toString("base64"),
        sha256: sha256(current.bytes),
    };
}

function applicationJournalPath(rootWorkspace: string, runId: string): string {
    return resolve(rootWorkspace, `.nbook/agent/migrations/application-state/${runId}/journal.json`);
}

function currentStepId(value: string): ApplicationStateMigrationStepId {
    if (!APPLICATION_STATE_MIGRATION_STEP_IDS.includes(value as ApplicationStateMigrationStepId)) {
        throw new Error(`Application State step 不属于 current catalog：${value}`);
    }
    return value as ApplicationStateMigrationStepId;
}

function validatedRunId(value: string): string {
    if (!RUN_ID_PATTERN.test(value)) throw new Error(`Application State migration runId 非法：${value || "<missing>"}`);
    return value;
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error && error.code === code;
}
