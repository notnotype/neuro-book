import {randomUUID} from "node:crypto";
import {readFile, rm} from "node:fs/promises";
import {resolve} from "node:path";
import {acquireAgentSessionStoreExclusiveLease} from "nbook/server/agent/session/agent-session-store";
import {decodeSessionSchemaV1} from "nbook/server/agent/session/migrations/session-v2/legacy-decoder";
import {readCompleteSessionSchemaV2Migration} from "nbook/server/agent/session/migrations/session-v2/migration";
import type {SessionSchemaV2Manifest, SessionSchemaV2State} from "nbook/server/agent/session/migrations/session-v2/types";
import {
    assertFileHash,
    pathExists,
    sha256,
    workspacePath,
    writeDurableJson,
} from "nbook/server/agent/session/migrations/shared/durable-file";
import {
    executeSessionTransaction,
    rollbackSessionTransaction,
} from "nbook/server/agent/session/migrations/shared/transaction";
import {runWithAgentSessionStoreLease} from "nbook/server/agent/session/agent-session-store-lease";
import {
    checkpointManifest,
    loadManifest,
    SESSION_V2_REVIEW_REPAIR_STATUS,
    transitionRun,
    transitionSession,
    writeInitialManifest,
    type SessionV2ReviewRepairJournalPaths,
} from "nbook/server/agent/session/migrations/session-v2-review-repair/journal";
import type {
    RunSessionV2ReviewRepairOptions,
    SessionV2ReviewRepairManifest,
    SessionV2ReviewRepairPlan,
    SessionV2ReviewRepairReport,
    SessionV2ReviewRepairRollbackReport,
    SessionV2ReviewRepairRunStatus,
    SessionV2ReviewRepairState,
} from "nbook/server/agent/session/migrations/session-v2-review-repair/types";

const RUN_ID_PATTERN = /^[A-Za-z0-9_-]+$/u;
type AssertLeaseHealthy = () => void;

/**
 * 规划或执行 Session v2 历史 review/timestamp 修复。
 *
 * dry-run 只读取旧 manifest、v1 backup 与当前 JSONL；apply 在 Session Store
 * 独占 lease 内重新规划并执行逐文件事务。
 */
export async function runSessionV2ReviewRepair(
    options: RunSessionV2ReviewRepairOptions,
): Promise<SessionV2ReviewRepairReport> {
    const rootWorkspace = resolve(options.rootWorkspace);
    const runId = validatedRunId(options.runId ?? randomUUID());
    if (options.mode === "dry-run") {
        if (options.resume) throw new Error("Session v2 review repair dry-run 不能 resume");
        const plans = await planWorkspace(rootWorkspace);
        return reportFromPlans(runId, "dry-run", plans);
    }
    const releaseLease = await acquireAgentSessionStoreExclusiveLease(rootWorkspace);
    const assertHealthy: AssertLeaseHealthy = () => releaseLease.assertHealthy();
    return runWithAgentSessionStoreLease(releaseLease, async () => {
        return options.resume
            ? await resumeApply(rootWorkspace, runId, assertHealthy)
            : await startApply(rootWorkspace, runId, assertHealthy);
    });
}

/** 逐字节回滚一个 review repair run。 */
export async function rollbackSessionV2ReviewRepair(
    rootWorkspaceInput: string,
    runIdInput: string,
): Promise<SessionV2ReviewRepairRollbackReport> {
    const rootWorkspace = resolve(rootWorkspaceInput);
    const runId = validatedRunId(runIdInput);
    const releaseLease = await acquireAgentSessionStoreExclusiveLease(rootWorkspace);
    const assertHealthy: AssertLeaseHealthy = () => releaseLease.assertHealthy();
    const paths = migrationPaths(rootWorkspace, runId);
    return runWithAgentSessionStoreLease(releaseLease, async () => {
        if (!await pathExists(paths.runRoot)) {
            return {version: 1, runId, status: "not_started", restoredSessions: 0};
        }
        let manifest = await requiredManifest(paths);
        const rollbackInProgress = manifest.status === "rollback_running"
            || manifest.status === "rolled_back"
            || manifest.status === "failed" && manifest.resumeStatus === "rollback_running";
        if (!rollbackInProgress && manifest.status !== "report_written") {
            if (manifest.status === "failed") {
                if (!manifest.resumeStatus) throw new Error("repair failed manifest 缺少 resumeStatus");
                await advanceRun(paths, manifest, manifest.resumeStatus, assertHealthy);
            }
            const source = await requiredSourceMigration(rootWorkspace);
            await executeManifest(rootWorkspace, paths, manifest, source.manifest, assertHealthy);
            manifest = await requiredManifest(paths);
        }
        if (manifest.status === "rolled_back") return rollbackReport(manifest);
        if (manifest.status === "failed") {
            if (manifest.resumeStatus !== "rollback_running") {
                throw new Error(`Session v2 review repair ${runId} 失败阶段不是 rollback_running`);
            }
            await advanceRun(paths, manifest, "rollback_running", assertHealthy);
        } else if (manifest.status === "report_written") {
            await advanceRun(paths, manifest, "rollback_running", assertHealthy);
        }
        if (manifest.status !== "rollback_running") {
            throw new Error(`Session v2 review repair ${runId} 无法回滚：${manifest.status}`);
        }
        try {
            for (const session of manifest.sessions) {
                if (!session.changed) continue;
                await rollbackSessionTransaction({
                    rootWorkspace,
                    session,
                    status: SESSION_V2_REVIEW_REPAIR_STATUS.session,
                    transition: (status) => transitionSession(paths, manifest, session, status),
                    assertHealthy,
                });
            }
            for (const session of manifest.sessions) {
                await assertFileHash(
                    workspacePath(rootWorkspace, session.sourcePath),
                    session.sourceHash,
                    `${session.sourcePath}: review repair rollback hash 无效`,
                );
            }
            await advanceRun(paths, manifest, "rolled_back", assertHealthy);
            assertHealthy();
            await checkpointManifest(paths, manifest);
            assertHealthy();
            return rollbackReport(manifest);
        } catch (error) {
            await recordFailure(paths, manifest, error, assertHealthy).catch(() => undefined);
            throw error;
        }
    });
}

async function startApply(
    rootWorkspace: string,
    runId: string,
    assertHealthy: AssertLeaseHealthy,
): Promise<SessionV2ReviewRepairReport> {
    const paths = migrationPaths(rootWorkspace, runId);
    if (await pathExists(paths.runRoot)) {
        throw new Error(`Session v2 review repair ${runId} 已存在；请使用 --resume`);
    }
    const source = await requiredSourceMigration(rootWorkspace);
    const plans = await planWorkspace(rootWorkspace, source.manifest);
    if (plans.length === 0) return reportFromPlans(runId, "apply", plans, "already_current");
    const manifest = createManifest(runId, source.manifest.runId, plans, paths.runRootRelative);
    assertHealthy();
    await writeInitialManifest(paths, manifest);
    assertHealthy();
    try {
        return await executeManifest(rootWorkspace, paths, manifest, source.manifest, assertHealthy);
    } catch (error) {
        await recordFailure(paths, manifest, error, assertHealthy).catch(() => undefined);
        throw error;
    }
}

async function resumeApply(
    rootWorkspace: string,
    runId: string,
    assertHealthy: AssertLeaseHealthy,
): Promise<SessionV2ReviewRepairReport> {
    const paths = migrationPaths(rootWorkspace, runId);
    const manifest = await requiredManifest(paths);
    if (manifest.status === "report_written") return reportFromManifest(manifest, "complete");
    if (manifest.status === "rollback_running" || manifest.status === "rolled_back"
        || manifest.status === "failed" && manifest.resumeStatus === "rollback_running") {
        throw new Error(`Session v2 review repair ${runId} 已进入 rollback`);
    }
    if (manifest.status === "failed") {
        if (!manifest.resumeStatus) throw new Error("repair failed manifest 缺少 resumeStatus");
        assertHealthy();
        await advanceRun(paths, manifest, manifest.resumeStatus, assertHealthy);
        assertHealthy();
    }
    const source = await requiredSourceMigration(rootWorkspace);
    if (manifest.sessions.some((session) => session.sourceMigrationRunId !== source.manifest.runId)) {
        throw new Error("Session v2 review repair 的 source migration 已变化");
    }
    try {
        return await executeManifest(rootWorkspace, paths, manifest, source.manifest, assertHealthy);
    } catch (error) {
        await recordFailure(paths, manifest, error, assertHealthy).catch(() => undefined);
        throw error;
    }
}

async function executeManifest(
    rootWorkspace: string,
    paths: ReturnType<typeof migrationPaths>,
    manifest: SessionV2ReviewRepairManifest,
    sourceManifest: SessionSchemaV2Manifest,
    assertHealthy: AssertLeaseHealthy,
): Promise<SessionV2ReviewRepairReport> {
    if (manifest.status === "running") {
        for (const session of manifest.sessions) {
            await executeSession(rootWorkspace, paths, manifest, sourceManifest, session, assertHealthy);
        }
        for (const session of manifest.sessions) {
            await assertFileHash(
                workspacePath(rootWorkspace, session.sourcePath),
                session.targetHash,
                `${session.sourcePath}: review repair full scan hash 无效`,
            );
        }
        await advanceRun(paths, manifest, "full_scan_verified", assertHealthy);
    }
    if (manifest.status === "full_scan_verified") await advanceRun(paths, manifest, "complete", assertHealthy);
    const report = reportFromManifest(manifest, "complete");
    if (manifest.status === "complete") {
        assertHealthy();
        await writeDurableJson(paths.reportPath, report);
        assertHealthy();
        await advanceRun(paths, manifest, "report_written", assertHealthy);
    }
    if (manifest.status !== "report_written") {
        throw new Error(`Session v2 review repair 无法完成：${manifest.status}`);
    }
    assertHealthy();
    await writeDurableJson(paths.reportPath, report);
    assertHealthy();
    await checkpointManifest(paths, manifest);
    assertHealthy();
    return report;
}

async function executeSession(
    rootWorkspace: string,
    paths: SessionV2ReviewRepairJournalPaths,
    manifest: SessionV2ReviewRepairManifest,
    sourceManifest: SessionSchemaV2Manifest,
    session: SessionV2ReviewRepairState,
    assertHealthy: AssertLeaseHealthy,
): Promise<void> {
    await executeSessionTransaction({
        rootWorkspace,
        session,
        status: SESSION_V2_REVIEW_REPAIR_STATUS.session,
        adapter: {
            loadPlan: (path) => planFromPath(rootWorkspace, path, sourceManifest, session),
            assertPlan: (state, plan) => assertPlan(state, plan),
            prepareArtifacts: async () => undefined,
            verifyTarget: (state, plan) => verifyTarget(state, plan),
            targetText: (_state, plan) => plan.targetText,
        },
        transition: (status) => transitionSession(paths, manifest, session, status),
        assertHealthy,
    });
}

async function planWorkspace(
    rootWorkspace: string,
    sourceManifestInput?: SessionSchemaV2Manifest,
): Promise<SessionV2ReviewRepairPlanWithIdentity[]> {
    const sourceManifest = sourceManifestInput ?? (await requiredSourceMigration(rootWorkspace)).manifest;
    const candidates = sourceManifest.sessions.filter((session) => (
        session.decoderFormat === 1
        && session.changed
        && session.reviewReasons.length > 0
    ));
    const plans: SessionV2ReviewRepairPlanWithIdentity[] = [];
    for (const session of candidates) {
        const currentText = await readFile(workspacePath(rootWorkspace, session.sourcePath), "utf8");
        plans.push(await buildPlan(rootWorkspace, sourceManifest, session, currentText));
    }
    return plans;
}

async function buildPlan(
    rootWorkspace: string,
    sourceManifest: SessionSchemaV2Manifest,
    session: SessionSchemaV2State,
    currentText: string,
): Promise<SessionV2ReviewRepairPlanWithIdentity> {
    const sourceText = await readFile(workspacePath(rootWorkspace, session.backupPath), "utf8");
    if (sha256(sourceText) !== session.sourceHash) {
        throw new Error(`${session.sourcePath}: Session v1 backup checksum 冲突`);
    }
    const knownProjectRoots = sourceManifest.sessions.flatMap((item) => (
        item.classification === "managed" && item.currentProjectRoot ? [item.currentProjectRoot] : []
    ));
    const profileBySessionId = Object.fromEntries(sourceManifest.sessions.map((item) => [String(item.sessionId), item.profileKey]));
    const base = {
        sourcePath: session.sourcePath,
        text: sourceText,
        migrationTimestamp: session.migrationTimestamp,
        knownProjectRoots,
        profileBySessionId,
    };
    const oldPlan = decodeSessionSchemaV1({...base, decoderFormat: 1});
    if (sha256(oldPlan.targetText) !== session.targetHash || !currentText.startsWith(oldPlan.targetText)) {
        throw new Error(`${session.sourcePath}: 当前 JSONL 不再以前次 Session v2 target bytes 为前缀`);
    }
    const nextPlan = decodeSessionSchemaV1({...base, decoderFormat: 2});
    const suffix = currentText.slice(oldPlan.targetText.length);
    const targetText = `${nextPlan.targetText}${suffix}`;
    return {
        sessionId: session.sessionId,
        sourceMigrationRunId: sourceManifest.runId,
        sourceBackupPath: session.backupPath,
        migrationTimestamp: session.migrationTimestamp,
        sourceText: currentText,
        targetText,
        sourceHash: sha256(currentText),
        targetHash: sha256(targetText),
        changed: currentText !== targetText,
        oldPrefixHash: sha256(oldPlan.targetText),
        newPrefixHash: sha256(nextPlan.targetText),
        suffixHash: sha256(suffix),
        currentProjectRoot: nextPlan.currentProjectRoot ?? null,
        reviewRequired: nextPlan.reviewReasons.length > 0,
    };
}

async function planFromPath(
    rootWorkspace: string,
    path: string,
    sourceManifest: SessionSchemaV2Manifest,
    session: SessionV2ReviewRepairState,
): Promise<SessionV2ReviewRepairPlan> {
    const text = await readFile(workspacePath(rootWorkspace, path), "utf8");
    const hash = sha256(text);
    if (hash === session.targetHash) {
        return {
            sourceText: text,
            targetText: text,
            sourceHash: hash,
            targetHash: hash,
            changed: false,
            oldPrefixHash: session.oldPrefixHash,
            newPrefixHash: session.newPrefixHash,
            suffixHash: session.suffixHash,
            currentProjectRoot: session.currentProjectRoot,
            reviewRequired: session.reviewRequired,
        };
    }
    if (hash !== session.sourceHash) throw new Error(`${session.sourcePath}: repair source/target hash 均不匹配`);
    const sourceState = sourceManifest.sessions.find((item) => item.sourcePath === session.sourcePath);
    if (!sourceState || sourceState.backupPath !== session.sourceBackupPath) {
        throw new Error(`${session.sourcePath}: 原 Session v2 manifest ownership 不匹配`);
    }
    return buildPlan(rootWorkspace, sourceManifest, sourceState, text);
}

function assertPlan(session: SessionV2ReviewRepairState, plan: SessionV2ReviewRepairPlan): void {
    const expected = [
        session.sourceHash,
        session.targetHash,
        session.oldPrefixHash,
        session.newPrefixHash,
        session.suffixHash,
        session.currentProjectRoot,
        session.reviewRequired,
    ];
    const actual = [
        plan.changed ? plan.sourceHash : session.sourceHash,
        plan.targetHash,
        plan.oldPrefixHash,
        plan.newPrefixHash,
        plan.suffixHash,
        plan.currentProjectRoot,
        plan.reviewRequired,
    ];
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`${session.sourcePath}: repair plan 与 manifest 冻结计划不一致`);
    }
}

async function verifyTarget(session: SessionV2ReviewRepairState, plan: SessionV2ReviewRepairPlan): Promise<void> {
    if (plan.changed || plan.targetHash !== session.targetHash) {
        throw new Error(`${session.sourcePath}: repair target hash 无效`);
    }
    const headerLine = plan.targetText.split(/\r?\n/u).find(Boolean);
    const header = headerLine ? JSON.parse(headerLine) as {kind?: unknown; metadata?: {[key: string]: unknown}} : null;
    const metadata = header?.kind === "header" ? header.metadata : undefined;
    const expectedReview = session.reviewRequired
        ? {status: "required", reason: "current_project_unresolved"}
        : undefined;
    if (!metadata || metadata.schemaVersion !== 2
        || (session.currentProjectRoot === null
            ? metadata.currentProjectRoot !== undefined
            : metadata.currentProjectRoot !== session.currentProjectRoot)
        || JSON.stringify(metadata.migrationReview) !== JSON.stringify(expectedReview)) {
        throw new Error(`${session.sourcePath}: repair target header 合同无效`);
    }
}

type SessionV2ReviewRepairPlanWithIdentity = SessionV2ReviewRepairPlan & {
    sessionId: number;
    sourceMigrationRunId: string;
    sourceBackupPath: string;
    migrationTimestamp: number;
};

function createManifest(
    runId: string,
    sourceMigrationRunId: string,
    plans: SessionV2ReviewRepairPlanWithIdentity[],
    runRootRelative: string,
): SessionV2ReviewRepairManifest {
    const now = new Date().toISOString();
    return {
        version: 1,
        journalVersion: 1,
        runId,
        status: "running",
        appliedSeq: 0,
        startedAt: now,
        updatedAt: now,
        sessions: plans.map((plan) => ({
            sessionId: plan.sessionId,
            sourceMigrationRunId,
            sourceBackupPath: plan.sourceBackupPath,
            migrationTimestamp: plan.migrationTimestamp,
            currentProjectRoot: plan.currentProjectRoot,
            reviewRequired: plan.reviewRequired,
            oldPrefixHash: plan.oldPrefixHash,
            newPrefixHash: plan.newPrefixHash,
            suffixHash: plan.suffixHash,
            sourcePath: sourcePathForSession(plan, sourceMigrationRunId),
            backupPath: `${runRootRelative}/backups/${sourcePathForSession(plan, sourceMigrationRunId)}.backup`,
            stagePath: `${runRootRelative}/stages/${sourcePathForSession(plan, sourceMigrationRunId)}.stage`,
            rollbackPath: `${runRootRelative}/rollbacks/${sourcePathForSession(plan, sourceMigrationRunId)}.rollback`,
            sourceHash: plan.sourceHash,
            targetHash: plan.targetHash,
            changed: plan.changed,
            status: plan.changed ? "pending" : "verified",
        })),
    };
}

function sourcePathForSession(plan: SessionV2ReviewRepairPlanWithIdentity, sourceRunId: string): string {
    const marker = `.nbook/agent/migrations/session-v2/${sourceRunId}/backups/`;
    if (!plan.sourceBackupPath.startsWith(marker) || !plan.sourceBackupPath.endsWith(".backup")) {
        throw new Error("Session v2 backup path 与 source run 不一致");
    }
    return plan.sourceBackupPath.slice(marker.length, -".backup".length);
}

async function requiredSourceMigration(rootWorkspace: string) {
    const source = await readCompleteSessionSchemaV2Migration(rootWorkspace);
    if (!source) throw new Error("Session v2 review repair 要求 complete Session schema v2 migration");
    return source;
}

function reportFromPlans(
    runId: string,
    mode: "dry-run" | "apply",
    plans: SessionV2ReviewRepairPlanWithIdentity[],
    forcedStatus?: "already_current",
): SessionV2ReviewRepairReport {
    return {
        version: 1,
        runId,
        mode,
        status: forcedStatus ?? "planned",
        scannedSessions: plans.length,
        repairedSessions: plans.filter((plan) => plan.changed).length,
        reviewSessions: plans.filter((plan) => plan.reviewRequired).length,
    };
}

function reportFromManifest(
    manifest: SessionV2ReviewRepairManifest,
    status: "complete",
): SessionV2ReviewRepairReport {
    return {
        version: 1,
        runId: manifest.runId,
        mode: "apply",
        status,
        scannedSessions: manifest.sessions.length,
        repairedSessions: manifest.sessions.filter((session) => session.changed).length,
        reviewSessions: manifest.sessions.filter((session) => session.reviewRequired).length,
    };
}

function rollbackReport(manifest: SessionV2ReviewRepairManifest): SessionV2ReviewRepairRollbackReport {
    return {
        version: 1,
        runId: manifest.runId,
        status: "rolled_back",
        restoredSessions: manifest.sessions.filter((session) => session.changed).length,
    };
}

async function recordFailure(
    paths: SessionV2ReviewRepairJournalPaths,
    manifest: SessionV2ReviewRepairManifest,
    error: unknown,
    assertHealthy: AssertLeaseHealthy,
): Promise<void> {
    if (manifest.status === "failed" || manifest.status === "report_written" || manifest.status === "rolled_back") return;
    assertHealthy();
    await transitionRun(paths, manifest, "failed", error instanceof Error ? error.message : String(error));
    assertHealthy();
    await checkpointManifest(paths, manifest);
    assertHealthy();
}

/** 在迁移 lease 仍有效时推进 run 状态，并在持久化后再次确认所有权。 */
async function advanceRun(
    paths: SessionV2ReviewRepairJournalPaths,
    manifest: SessionV2ReviewRepairManifest,
    status: SessionV2ReviewRepairRunStatus,
    assertHealthy: AssertLeaseHealthy,
): Promise<void> {
    assertHealthy();
    await transitionRun(paths, manifest, status);
    assertHealthy();
}

async function requiredManifest(paths: SessionV2ReviewRepairJournalPaths): Promise<SessionV2ReviewRepairManifest> {
    const manifest = await loadManifest(paths);
    if (!manifest) throw new Error(`Session v2 review repair manifest 缺失：${paths.manifestPath}`);
    return manifest;
}

function migrationPaths(rootWorkspace: string, runId: string): SessionV2ReviewRepairJournalPaths & {reportPath: string} {
    const runRootRelative = `.nbook/agent/migrations/session-v2-review-repair/${runId}`;
    const runRoot = workspacePath(rootWorkspace, runRootRelative);
    return {
        rootWorkspace,
        runRootRelative,
        runRoot,
        manifestPath: resolve(runRoot, "manifest.json"),
        journalPath: resolve(runRoot, "journal.jsonl"),
        reportPath: resolve(runRoot, "report.json"),
    };
}

function validatedRunId(value: string): string {
    if (!RUN_ID_PATTERN.test(value)) throw new Error(`Session v2 review repair runId 非法：${value}`);
    return value;
}
