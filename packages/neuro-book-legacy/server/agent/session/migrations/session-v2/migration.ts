import {randomUUID} from "node:crypto";
import {readFile, readdir, rm} from "node:fs/promises";
import {resolve} from "node:path";
import {
    acquireAgentSessionStoreExclusiveLease,
    AGENT_SESSION_SCHEMA_VERSION,
    AGENT_SESSION_STORE_SENTINEL_VERSION,
    AgentSessionMigrationRequiredError,
    AgentSessionRecoveryRequiredError,
    AgentSessionStoreCorruptError,
    agentSessionStoreSentinelPath,
    readAgentSessionStoreSentinel,
    type AgentSessionStoreSentinel,
} from "nbook/server/agent/session/agent-session-store";
import {ProjectRootDtoSchema} from "nbook/shared/dto/project.dto";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {
    isProjectLifecycleError,
    ProjectLifecycle,
    projectWorkspaceRef,
} from "nbook/server/workspace-files/project-lifecycle";
import {
    decodeSessionSchemaV1,
    type SessionSchemaV2MigrationStats,
} from "nbook/server/agent/session/migrations/session-v2/legacy-decoder";
import type {
    RollbackSessionSchemaV2Options,
    RunSessionSchemaV2Options,
    SessionSchemaV2Manifest,
    SessionSchemaV2Plan,
    SessionSchemaV2Report,
    SessionSchemaV2RollbackReport,
    SessionSchemaV2RunStatus,
    SessionSchemaV2State,
} from "nbook/server/agent/session/migrations/session-v2/types";
import {
    assertFileHash,
    pathExists,
    sessionJsonlFiles,
    sha256,
    workspacePath,
    writeAtomicDurableJson,
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
    SESSION_SCHEMA_V2_STATUS,
    transitionRun,
    transitionSession,
    writeInitialManifest,
    type SessionSchemaV2JournalPaths,
} from "nbook/server/agent/session/migrations/session-v2/journal";

const RUN_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const SOURCE_SCHEMA_VERSION = 1;
const TARGET_SCHEMA_VERSION = 2;
type AssertLeaseHealthy = () => void;

/**
 * 规划或执行 Session schema v1 -> v2 离线迁移。
 *
 * apply 模式先取得 Agent Session Store 唯一独占 lease；dry-run 只读取 Session JSONL，
 * 不持有 lease，也不创建 sentinel、manifest、backup 或 stage。
 */
export async function runSessionSchemaV2Migration(
    options: RunSessionSchemaV2Options,
): Promise<SessionSchemaV2Report> {
    const rootWorkspace = resolve(options.rootWorkspace);
    const runId = validatedRunId(options.runId ?? randomUUID());
    if (options.mode === "dry-run") {
        if (options.resume) throw new Error("Session schema v2 dry-run 不能 resume");
        const current = await readCompleteSessionSchemaV2Migration(rootWorkspace);
        if (current) return reportFromManifest(current.manifest, "dry-run", "already_current");
        const inventory = await planWorkspace(rootWorkspace, options.migrationTimestamp ?? Date.now());
        return reportFromPlans(runId, inventory.plans);
    }
    const releaseLease = await acquireAgentSessionStoreExclusiveLease(rootWorkspace);
    const assertHealthy: AssertLeaseHealthy = () => releaseLease.assertHealthy();
    return runWithAgentSessionStoreLease(releaseLease, async () => {
        if (options.resume) {
            if (options.mode !== "apply") {
                throw new Error("Session schema v2 --resume必须与apply一起使用");
            }
            return await resumeApply(rootWorkspace, options, assertHealthy);
        }
        const current = await readCompleteSessionSchemaV2Migration(rootWorkspace);
        if (current) {
            return reportFromManifest(current.manifest, options.mode, "already_current");
        }
        const inventory = await planWorkspace(rootWorkspace, options.migrationTimestamp ?? Date.now());
        return startApply(rootWorkspace, runId, inventory, options, assertHealthy);
    });
}

/**
 * 回滚一次Session schema v2 hard cut。
 *
 * 中断的apply先在同一独占lease内恢复到确定终态，再按冻结backup反向发布；任何
 * 失败都保持rollback_required，runtime不能在半回滚状态继续append。
 */
export async function rollbackSessionSchemaV2Migration(
    options: RollbackSessionSchemaV2Options,
): Promise<SessionSchemaV2RollbackReport> {
    const rootWorkspace = resolve(options.rootWorkspace);
    const releaseLease = await acquireAgentSessionStoreExclusiveLease(rootWorkspace);
    const assertHealthy: AssertLeaseHealthy = () => releaseLease.assertHealthy();
    let manifest: SessionSchemaV2Manifest | null = null;
    let paths: ReturnType<typeof migrationPaths> | null = null;
    return runWithAgentSessionStoreLease(releaseLease, async () => {
        let sentinel: AgentSessionStoreSentinel;
        try {
            sentinel = await readAgentSessionStoreSentinel(rootWorkspace);
        } catch (error) {
            if (!(error instanceof AgentSessionMigrationRequiredError) || !options.runId) throw error;
            const runId = validatedRunId(options.runId);
            paths = migrationPaths(rootWorkspace, runId);
            if (!await pathExists(paths.runRoot)) {
                return {version: 1, runId, status: "not_started", restoredSessions: 0};
            }
            await loadUnpublishedInitialRun(paths);
            assertHealthy();
            await rm(paths.runRoot, {recursive: true, force: true});
            assertHealthy();
            return {version: 1, runId, status: "not_started", restoredSessions: 0};
        }
        const runId = validatedRunId(options.runId ?? sentinel.runId);
        if (sentinel.runId !== runId) {
            throw new Error(`当前 Session migration 属于 run ${sentinel.runId}，不能回滚 ${runId}`);
        }
        paths = migrationPaths(rootWorkspace, runId);
        if (!await pathExists(paths.runRoot)) {
            throw new AgentSessionStoreCorruptError("Session migration sentinel指向的run目录缺失");
        }
        manifest = await recoveryManifest(rootWorkspace, paths, sentinel);
        if (manifest.status === "rolled_back") {
            await publishPreviousSchemaSentinel(rootWorkspace, paths, manifest, assertHealthy);
            return rollbackReport(manifest);
        }

        const rollbackInProgress = manifest.status === "rollback_running"
            || manifest.status === "failed" && manifest.resumeStatus === "rollback_running";
        if (!rollbackInProgress && manifest.status !== "report_written") {
            await publishSentinel(rootWorkspace, paths, manifest, "applying", undefined, assertHealthy);
            if (manifest.status === "failed") {
                if (!manifest.resumeStatus) throw new Error("failed Session migration缺少resumeStatus");
                await advanceRun(paths, manifest, manifest.resumeStatus, undefined, assertHealthy);
            }
            await executeManifest(rootWorkspace, paths, manifest, {
                rootWorkspace,
                mode: "apply",
                runId,
            }, assertHealthy);
        }

        await publishSentinel(rootWorkspace, paths, manifest, "rollback_required", undefined, assertHealthy);
        if (manifest.status === "failed") {
            if (manifest.resumeStatus !== "rollback_running") {
                throw new Error(`Session migration run ${runId}失败阶段不是rollback_running`);
            }
            await advanceRun(paths, manifest, "rollback_running", undefined, assertHealthy);
        } else if (manifest.status === "report_written") {
            await advanceRun(paths, manifest, "rollback_running", undefined, assertHealthy);
        }
        if (manifest.status !== "rollback_running") {
            throw new Error(`Session migration run ${runId}状态无法回滚：${manifest.status}`);
        }

        try {
            for (const session of manifest.sessions) {
                if (!session.changed) continue;
                await rollbackSession(rootWorkspace, paths, manifest, session, options.observer, assertHealthy);
            }
            await verifyRollback(rootWorkspace, manifest);
            await advanceRun(paths, manifest, "rolled_back", undefined, assertHealthy);
            assertHealthy();
            await checkpointManifest(paths, manifest);
            assertHealthy();
            await publishPreviousSchemaSentinel(rootWorkspace, paths, manifest, assertHealthy);
            return rollbackReport(manifest);
        } catch (error) {
            const failureRecorded = await recordFailure(paths, manifest, error, assertHealthy).then(
                () => true,
                () => false,
            );
            if (failureRecorded) {
                assertHealthy();
                await checkpointManifest(paths, manifest).then(
                    () => assertHealthy(),
                    () => undefined,
                );
                await publishSentinel(rootWorkspace, paths, manifest, "rollback_required", undefined, assertHealthy)
                    .catch(() => undefined);
            }
            throw error;
        }
    });
}

/** 显式恢复sentinel指向的唯一run，不按目录猜测或新建替代计划。 */
async function resumeApply(
    rootWorkspace: string,
    options: RunSessionSchemaV2Options,
    assertHealthy: AssertLeaseHealthy,
): Promise<SessionSchemaV2Report> {
    let sentinel: AgentSessionStoreSentinel;
    try {
        sentinel = await readAgentSessionStoreSentinel(rootWorkspace);
    } catch (error) {
        if (!(error instanceof AgentSessionMigrationRequiredError) || !options.runId) throw error;
        const runId = validatedRunId(options.runId);
        const paths = migrationPaths(rootWorkspace, runId);
        const manifest = await loadUnpublishedInitialRun(paths);
        await publishSentinel(rootWorkspace, paths, manifest, "pending", options.observer, assertHealthy);
        sentinel = await readAgentSessionStoreSentinel(rootWorkspace);
    }
    if (sentinel.targetSchemaVersion !== TARGET_SCHEMA_VERSION
        || sentinel.sourceSchemaVersion !== SOURCE_SCHEMA_VERSION) {
        throw new Error("当前 Agent Session Store sentinel 不是 schema v1 -> v2 migration");
    }
    if (options.runId && options.runId !== sentinel.runId) {
        throw new Error(`当前 Session migration 属于 run ${sentinel.runId}，不能恢复 ${options.runId}`);
    }
    if (sentinel.state === "complete") {
        const current = await readCompleteSessionSchemaV2Migration(rootWorkspace);
        if (!current) throw new Error("complete sentinel不是当前Session schema");
        return reportFromManifest(current.manifest, "apply", "already_current");
    }
    const paths = migrationPaths(rootWorkspace, validatedRunId(sentinel.runId));
    const manifest = await recoveryManifest(rootWorkspace, paths, sentinel);
    if (manifest.status === "rollback_running" || manifest.status === "rolled_back"
        || manifest.status === "failed" && manifest.resumeStatus === "rollback_running") {
        throw new Error(`Session migration run ${manifest.runId}已经进入rollback，只能继续rollback`);
    }
    await publishSentinel(rootWorkspace, paths, manifest, "applying", options.observer, assertHealthy);
    if (manifest.status === "failed") {
        if (!manifest.resumeStatus) {
            throw new Error("failed Session migration缺少resumeStatus");
        }
        await advanceRun(paths, manifest, manifest.resumeStatus, options.observer, assertHealthy);
    }
    try {
        return await executeManifest(rootWorkspace, paths, manifest, options, assertHealthy);
    } catch (error) {
        await recordFailure(paths, manifest, error, assertHealthy).catch(() => undefined);
        if (manifest.status === "failed") {
            await checkpointManifest(paths, manifest).then(
                () => assertHealthy(),
                () => undefined,
            );
            await publishSentinel(rootWorkspace, paths, manifest, "rollback_required", options.observer, assertHealthy)
                .catch(() => undefined);
        }
        throw error;
    }
}

/**
 * 校验非complete sentinel的run ownership。
 *
 * applying期间manifest checkpoint可先于sentinel推进；这种情况下允许checkpoint cursor
 * 单调前进，但完整WAL仍必须由Journal严格回放。
 */
async function recoveryManifest(
    rootWorkspace: string,
    paths: ReturnType<typeof migrationPaths>,
    sentinel: AgentSessionStoreSentinel,
): Promise<SessionSchemaV2Manifest> {
    if (sentinel.manifestPath !== paths.manifestRelativePath) {
        throw new AgentSessionStoreCorruptError("Session migration sentinel manifestPath与runId不一致");
    }
    const bytes = await readFile(paths.manifestPath);
    let checkpoint: unknown;
    try {
        checkpoint = JSON.parse(bytes.toString("utf8")) as unknown;
    } catch (error) {
        throw new AgentSessionStoreCorruptError("Session migration manifest不是合法JSON", {cause: error});
    }
    if (!checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint)
        || !("runId" in checkpoint) || checkpoint.runId !== sentinel.runId
        || !("appliedSeq" in checkpoint) || typeof checkpoint.appliedSeq !== "number"
        || !Number.isSafeInteger(checkpoint.appliedSeq) || checkpoint.appliedSeq < 0) {
        throw new AgentSessionStoreCorruptError("Session migration manifest checkpoint字段无效");
    }
    const checkpointCursor = checkpoint.appliedSeq;
    const checkpointHash = sha256(bytes);
    if (checkpointHash === sentinel.manifestHash) {
        if (checkpointCursor !== sentinel.checkpointCursor) {
            throw new AgentSessionStoreCorruptError("Session migration sentinel checkpointCursor不一致");
        }
    } else if (checkpointCursor <= sentinel.checkpointCursor) {
        throw new AgentSessionStoreCorruptError("Session migration manifest未单调推进却与sentinel hash不一致");
    }
    const manifest = await loadManifest(paths);
    if (!manifest || manifest.runId !== sentinel.runId || manifest.appliedSeq < checkpointCursor) {
        throw new AgentSessionStoreCorruptError("Session migration manifest/WAL无法恢复sentinel run");
    }
    return manifest;
}

/**
 * 恢复初始 manifest 已落盘、sentinel 尚未发布的唯一无数据写入窗口。
 *
 * 只有 appliedSeq=0、全部 Session 尚未开始且没有 backup/stage/rollback artifact 时
 * 才能重建 pending sentinel 或把该 run 视为 not_started；其余情况一律 fail closed。
 */
async function loadUnpublishedInitialRun(
    paths: ReturnType<typeof migrationPaths>,
): Promise<SessionSchemaV2Manifest> {
    const manifest = await loadManifest(paths);
    if (!manifest
        || manifest.status !== "running"
        || manifest.appliedSeq !== 0
        || manifest.sessions.some((session) => session.status !== "pending" && session.status !== "verified")) {
        throw new AgentSessionStoreCorruptError("Session migration sentinel缺失且run不是未发布初始状态");
    }
    for (const session of manifest.sessions) {
        for (const relativePath of [session.backupPath, session.stagePath, session.rollbackPath]) {
            if (await pathExists(workspacePath(paths.rootWorkspace, relativePath))) {
                throw new AgentSessionStoreCorruptError("Session migration sentinel缺失但run已产生事务artifact");
            }
        }
    }
    return manifest;
}

/** 在独占 lease 内验证 complete sentinel 与最终 manifest 的 hash/checkpoint 绑定。 */
/**
 * 读取并验证当前 complete Session v2 migration。
 *
 * 这是 migration-only 的历史证明接口。apply/repair 调用方必须持有 Agent Session
 * Store 独占 lease；纯只读 plan 可在无锁快照上调用，Nitro runtime 不得导入。
 */
export async function readCompleteSessionSchemaV2Migration(rootWorkspace: string): Promise<{
    sentinel: AgentSessionStoreSentinel;
    manifest: SessionSchemaV2Manifest;
} | null> {
    let sentinel: AgentSessionStoreSentinel;
    try {
        sentinel = await readAgentSessionStoreSentinel(rootWorkspace);
    } catch (error) {
        if (error instanceof AgentSessionMigrationRequiredError) {
            return null;
        }
        throw error;
    }
    if (sentinel.state !== "complete") {
        throw new AgentSessionRecoveryRequiredError(sentinel);
    }
    if (sentinel.targetSchemaVersion !== AGENT_SESSION_SCHEMA_VERSION) {
        return null;
    }
    const expectedPath = `.nbook/agent/migrations/session-v2/${sentinel.runId}/manifest.json`;
    if (sentinel.manifestPath !== expectedPath) {
        throw new AgentSessionStoreCorruptError("Session v2 complete sentinel manifestPath与runId不一致。");
    }
    const bytes = await readFile(resolve(rootWorkspace, ...sentinel.manifestPath.split("/")));
    if (sha256(bytes) !== sentinel.manifestHash) {
        throw new AgentSessionStoreCorruptError("Session v2 complete sentinel manifestHash不一致。");
    }
    const paths = migrationPaths(rootWorkspace, sentinel.runId);
    const manifest = await loadManifest(paths);
    if (!manifest
        || manifest.runId !== sentinel.runId
        || manifest.appliedSeq !== sentinel.checkpointCursor
        || manifest.status !== "report_written") {
        throw new AgentSessionStoreCorruptError("Session v2 complete manifest与sentinel checkpoint不一致。");
    }
    return {sentinel, manifest};
}

/** 在独占 lease 内构造全库确定性迁移计划。 */
async function planWorkspace(rootWorkspace: string, migrationTimestamp: number): Promise<{
    plans: SessionSchemaV2Plan[];
    profileBySessionId: Readonly<Record<string, string>>;
}> {
    if (!Number.isSafeInteger(migrationTimestamp) || migrationTimestamp < 0) {
        throw new Error("migrationTimestamp 必须是非负安全整数");
    }
    const files = await sessionJsonlFiles(rootWorkspace);
    const sourceTexts = await Promise.all(files.map((file) => readFile(file.absolutePath, "utf8")));
    const knownProjectRoots = await listKnownProjectRoots(rootWorkspace);
    const profileBySessionId = sessionProfiles(files.map((file, index) => ({
        sourcePath: file.sourcePath,
        text: sourceTexts[index] as string,
    })));
    const plans = files.map((file, index) => {
        const sourceText = sourceTexts[index] as string;
        const decoded = decodeSessionSchemaV1({
            sourcePath: file.sourcePath,
            text: sourceText,
            migrationTimestamp,
            knownProjectRoots,
            profileBySessionId,
        });
        return {
            ...decoded,
            migrationTimestamp,
            profileKey: profileBySessionId[String(decoded.sessionId)] as string,
            sourceText,
            sourceHash: sha256(sourceText),
            targetHash: sha256(decoded.targetText),
            changed: sourceText !== decoded.targetText,
        };
    });
    return {plans, profileBySessionId};
}

/**
 * 读取当前合法 Project root inventory。
 *
 * 这里复用 Project Lifecycle 的只读 validate 边界，因此 root identity、reparse、
 * case collision 与 manifest 解析和 Product 保持同一语义；本流程不 ensure、不启动
 * watcher，也不初始化任何 Project Module。
 */
async function listKnownProjectRoots(rootWorkspace: string): Promise<string[]> {
    const entries = await readdir(rootWorkspace, {withFileTypes: true}).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
    });
    const directoryNames = entries
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .map((entry) => entry.name)
        .filter((name) => ProjectRootDtoSchema.safeParse(name).success)
        .sort((left, right) => left.localeCompare(right));
    const lifecycle = new ProjectLifecycle(absoluteFsPath(rootWorkspace));
    try {
        const valid: string[] = [];
        for (const projectRoot of directoryNames) {
            try {
                const result = await lifecycle.validate(projectWorkspaceRef(projectRoot));
                if (result.status === "valid") valid.push(result.projectRoot);
            } catch (error) {
                if (isProjectLifecycleError(error) && (
                    error.code === "INVALID_PROJECT_ROOT"
                    || error.code === "PROJECT_NOT_FOUND"
                    || error.code === "PROJECT_ROOT_LINK_UNSUPPORTED"
                    || error.code === "PROJECT_ROOT_CASE_COLLISION"
                    || error.code === "PROJECT_ROOT_REPLACED"
                    || error.code === "PROJECT_MANIFEST_IO"
                )) {
                    continue;
                }
                throw error;
            }
        }
        return valid.sort((left, right) => left.localeCompare(right));
    } finally {
        await lifecycle.close();
    }
}

/** 两阶段 inventory 为 invoke_agent 提供 sessionId -> profileKey。 */
function sessionProfiles(sessions: Array<{sourcePath: string; text: string}>): Readonly<Record<string, string>> {
    const profiles: {[sessionId: string]: string} = {};
    for (const session of sessions) {
        const header = session.text.split(/\r?\n/u).find((line) => {
            if (!line) return false;
            try {
                const value = JSON.parse(line) as {kind?: string};
                return value.kind === "header";
            } catch {
                return false;
            }
        });
        if (!header) {
            throw new Error(`${session.sourcePath}: 缺少 header record`);
        }
        // JSON.parse 是离线 inventory 的外部边界；这里只读取 decoder 随后会严格验证的两个字段。
        const value = JSON.parse(header) as {metadata?: {sessionId?: unknown; profileKey?: unknown}};
        const sessionId = value.metadata?.sessionId;
        const profileKey = value.metadata?.profileKey;
        if (typeof sessionId !== "number" || !Number.isSafeInteger(sessionId) || sessionId <= 0
            || typeof profileKey !== "string" || !profileKey) {
            throw new Error(`${session.sourcePath}: header sessionId/profileKey 无效`);
        }
        if (profiles[String(sessionId)] !== undefined) {
            throw new Error(`Agent Session Store包含重复sessionId：${String(sessionId)}`);
        }
        profiles[String(sessionId)] = profileKey;
    }
    return profiles;
}

/** 从纯内存计划生成 dry-run 报告。 */
function reportFromPlans(runId: string, plans: SessionSchemaV2Plan[]): SessionSchemaV2Report {
    return {
        version: 1,
        runId,
        mode: "dry-run",
        status: "planned",
        scannedSessions: plans.length,
        migratedSessions: plans.filter((plan) => plan.changed).length,
        skippedSessions: plans.filter((plan) => !plan.changed).length,
        reviewSessions: plans.filter((plan) => plan.reviewReasons.length > 0).length,
        stats: sumStats(plans.map((plan) => plan.stats)),
        sessions: plans.map((plan) => ({
            sessionId: plan.sessionId,
            sourcePath: plan.sourcePath,
            classification: plan.classification,
            ...(plan.currentProjectRoot ? {currentProjectRoot: plan.currentProjectRoot} : {}),
            reviewReasons: plan.reviewReasons,
            sourceHash: plan.sourceHash,
            targetHash: plan.targetHash,
            status: plan.changed ? "pending" : "verified",
        })),
    };
}

/** 新 apply 在唯一 store lease 内冻结计划，然后才发布恢复 sentinel。 */
async function startApply(
    rootWorkspace: string,
    runId: string,
    inventory: Awaited<ReturnType<typeof planWorkspace>>,
    options: RunSessionSchemaV2Options,
    assertHealthy: AssertLeaseHealthy,
): Promise<SessionSchemaV2Report> {
    const paths = migrationPaths(rootWorkspace, runId);
    if (await pathExists(paths.runRoot)) {
        throw new Error(`Session schema migration run ${runId} 已存在；未完成任务请使用 --resume`);
    }
    const manifest = createManifest(runId, inventory.plans, paths.runRootRelative);
    assertHealthy();
    await writeInitialManifest(paths, manifest);
    assertHealthy();
    await publishSentinel(rootWorkspace, paths, manifest, "pending", options.observer, assertHealthy);
    try {
        await publishSentinel(rootWorkspace, paths, manifest, "applying", options.observer, assertHealthy);
        return await executeManifest(rootWorkspace, paths, manifest, options, assertHealthy);
    } catch (error) {
        await recordFailure(paths, manifest, error, assertHealthy).catch(() => undefined);
        if (manifest.status === "failed") {
            await checkpointManifest(paths, manifest).then(
                () => assertHealthy(),
                () => undefined,
            );
            await publishSentinel(rootWorkspace, paths, manifest, "rollback_required", options.observer, assertHealthy)
                .catch(() => undefined);
        }
        throw error;
    }
}

/** 从冻结计划构造 WAL 的 immutable manifest。 */
function createManifest(
    runId: string,
    plans: SessionSchemaV2Plan[],
    runRootRelative: string,
): SessionSchemaV2Manifest {
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
            profileKey: plan.profileKey,
            classification: plan.classification,
            currentProjectRoot: plan.currentProjectRoot ?? null,
            reviewReasons: [...plan.reviewReasons],
            decoderFormat: plan.decoderFormat,
            ambiguousLocations: [...plan.ambiguousLocations],
            migrationTimestamp: plan.migrationTimestamp,
            rewrittenPaths: plan.stats.rewrittenPaths,
            resetProfileReminders: plan.stats.resetProfileReminders,
            cancelledToolCalls: plan.stats.cancelledToolCalls,
            clearedPendingResolutions: plan.stats.clearedPendingResolutions,
            clearedFollowUpQueue: plan.stats.clearedFollowUpQueue,
            sourcePath: plan.sourcePath,
            backupPath: `${runRootRelative}/backups/${plan.sourcePath}.backup`,
            stagePath: `${runRootRelative}/stages/${plan.sourcePath}.stage`,
            rollbackPath: `${runRootRelative}/rollbacks/${plan.sourcePath}.rollback`,
            sourceHash: plan.sourceHash,
            targetHash: plan.targetHash,
            changed: plan.changed,
            status: plan.changed ? "pending" : "verified",
        })),
    };
}

/** 推进全部文件、全库复扫、报告与最终 sentinel；complete 永远最后发布。 */
async function executeManifest(
    rootWorkspace: string,
    paths: ReturnType<typeof migrationPaths>,
    manifest: SessionSchemaV2Manifest,
    options: RunSessionSchemaV2Options,
    assertHealthy: AssertLeaseHealthy,
): Promise<SessionSchemaV2Report> {
    if (manifest.status === "running") {
        for (const session of manifest.sessions) {
            await executeSession(rootWorkspace, paths, manifest, session, options.observer, assertHealthy);
        }
        await fullScan(rootWorkspace, manifest);
        await advanceRun(paths, manifest, "full_scan_verified", options.observer, assertHealthy);
    }
    if (manifest.status === "full_scan_verified") {
        await advanceRun(paths, manifest, "complete", options.observer, assertHealthy);
    }
    const report = reportFromManifest(manifest, "apply", "complete");
    if (manifest.status === "complete") {
        assertHealthy();
        await writeDurableJson(paths.reportPath, report);
        assertHealthy();
        await advanceRun(paths, manifest, "report_written", options.observer, assertHealthy);
    }
    if (manifest.status !== "report_written") {
        throw new Error(`Session schema migration run 状态无法完成：${manifest.status}`);
    }
    assertHealthy();
    await writeDurableJson(paths.reportPath, report);
    assertHealthy();
    await checkpointManifest(paths, manifest);
    assertHealthy();
    await publishSentinel(rootWorkspace, paths, manifest, "complete", options.observer, assertHealthy);
    return report;
}

/** 一个 Session 文件在通用事务 Module 上的 schema-v2 Adapter。 */
async function executeSession(
    rootWorkspace: string,
    paths: ReturnType<typeof migrationPaths>,
    manifest: SessionSchemaV2Manifest,
    session: SessionSchemaV2State,
    observer: RunSessionSchemaV2Options["observer"],
    assertHealthy: AssertLeaseHealthy,
): Promise<void> {
    await executeSessionTransaction({
        rootWorkspace,
        session,
        status: SESSION_SCHEMA_V2_STATUS.session,
        adapter: {
            loadPlan: (path) => planFromPath(rootWorkspace, path, manifest, session),
            assertPlan: (state, plan) => assertPlan(state, plan),
            prepareArtifacts: async () => undefined,
            verifyTarget: (state, plan) => verifyTargetPlan(state, plan),
            targetText: (_state, plan) => plan.targetText,
        },
        transition: async (status) => {
            await transitionSession(paths, manifest, session, status);
            await observer?.({kind: "session", sourcePath: session.sourcePath, status});
        },
        assertHealthy,
    });
}

/** 按manifest冻结的backup恢复一个已改变Session。 */
async function rollbackSession(
    rootWorkspace: string,
    paths: ReturnType<typeof migrationPaths>,
    manifest: SessionSchemaV2Manifest,
    session: SessionSchemaV2State,
    observer: RollbackSessionSchemaV2Options["observer"],
    assertHealthy: AssertLeaseHealthy,
): Promise<void> {
    await rollbackSessionTransaction({
        rootWorkspace,
        session,
        status: SESSION_SCHEMA_V2_STATUS.session,
        transition: async (status) => {
            await transitionSession(paths, manifest, session, status);
            if (status === "rollback_pending" || status === "rollback_publishing" || status === "rolled_back") {
                await observer?.({sourcePath: session.sourcePath, status});
            }
        },
        assertHealthy,
    });
}

/** source/backup按旧 decoder重建；已迁移stage/source只接受冻结target hash。 */
async function planFromPath(
    rootWorkspace: string,
    path: string,
    manifest: SessionSchemaV2Manifest,
    session: SessionSchemaV2State,
): Promise<SessionSchemaV2Plan> {
    const text = await readFile(workspacePath(rootWorkspace, path), "utf8");
    const hash = sha256(text);
    if (hash === session.targetHash) {
        return planFromTarget(session, text);
    }
    if (hash !== session.sourceHash) {
        throw new Error(`${session.sourcePath}: 文件hash不属于冻结的source/target计划`);
    }
    const knownProjectRoots = manifest.sessions.flatMap((item) => (
        item.classification === "managed" && item.currentProjectRoot ? [item.currentProjectRoot] : []
    ));
    const profileBySessionId = Object.fromEntries(manifest.sessions.map((item) => [
        String(item.sessionId),
        item.profileKey,
    ]));
    const decoded = decodeSessionSchemaV1({
        sourcePath: session.sourcePath,
        text,
        migrationTimestamp: session.migrationTimestamp,
        knownProjectRoots,
        profileBySessionId,
        decoderFormat: session.decoderFormat,
    });
    return {
        ...decoded,
        migrationTimestamp: session.migrationTimestamp,
        profileKey: session.profileKey,
        sourceText: text,
        sourceHash: hash,
        targetHash: sha256(decoded.targetText),
        changed: text !== decoded.targetText,
    };
}

/** 把冻结target bytes投影为通用事务要求的幂等计划。 */
function planFromTarget(session: SessionSchemaV2State, text: string): SessionSchemaV2Plan {
    return {
        sourcePath: session.sourcePath,
        sourceText: text,
        targetText: text,
        sourceHash: session.targetHash,
        targetHash: session.targetHash,
        changed: false,
        migrationTimestamp: session.migrationTimestamp,
        sessionId: session.sessionId,
        profileKey: session.profileKey,
        classification: session.classification,
        ...(session.currentProjectRoot ? {currentProjectRoot: session.currentProjectRoot} : {}),
        decoderFormat: session.decoderFormat,
        reviewReasons: [...session.reviewReasons],
        ambiguousLocations: [...session.ambiguousLocations],
        stats: stateStats(session),
    };
}

/** 旧source必须能重新生成完全相同的冻结计划，target则由hash提供内容身份。 */
function assertPlan(session: SessionSchemaV2State, plan: SessionSchemaV2Plan): void {
    if (!plan.changed) {
        if (plan.sourceHash !== session.targetHash || plan.targetHash !== session.targetHash) {
            throw new Error(`${session.sourcePath}: migrated target 与 manifest hash不一致`);
        }
        return;
    }
    const actual = {
        sessionId: plan.sessionId,
        profileKey: plan.profileKey,
        classification: plan.classification,
        currentProjectRoot: plan.currentProjectRoot ?? null,
        decoderFormat: plan.decoderFormat,
        reviewReasons: plan.reviewReasons,
        ambiguousLocations: plan.ambiguousLocations,
        migrationTimestamp: plan.migrationTimestamp,
        stats: plan.stats,
        sourceHash: plan.sourceHash,
        targetHash: plan.targetHash,
    };
    const expected = {
        sessionId: session.sessionId,
        profileKey: session.profileKey,
        classification: session.classification,
        currentProjectRoot: session.currentProjectRoot,
        decoderFormat: session.decoderFormat,
        reviewReasons: session.reviewReasons,
        ambiguousLocations: session.ambiguousLocations,
        migrationTimestamp: session.migrationTimestamp,
        stats: stateStats(session),
        sourceHash: session.sourceHash,
        targetHash: session.targetHash,
    };
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`${session.sourcePath}: source decoder 与 manifest 冻结计划不一致`);
    }
}

/** v2 target除hash外还验证唯一header的schema、session与review身份。 */
async function verifyTargetPlan(session: SessionSchemaV2State, plan: SessionSchemaV2Plan): Promise<void> {
    if (plan.changed || plan.targetHash !== session.targetHash) {
        throw new Error(`${session.sourcePath}: target仍是旧schema或hash无效`);
    }
    const headers = plan.targetText.split(/\r?\n/u).filter(Boolean).flatMap((line) => {
        const value = JSON.parse(line) as {kind?: unknown; metadata?: unknown};
        return value.kind === "header" ? [value.metadata] : [];
    });
    if (headers.length !== 1 || !headers[0] || typeof headers[0] !== "object" || Array.isArray(headers[0])) {
        throw new Error(`${session.sourcePath}: schema v2 target缺少唯一header`);
    }
    const metadata = headers[0] as {[key: string]: unknown};
    const expectedReview = session.reviewReasons.length === 0
        ? undefined
        : session.decoderFormat === 1
            ? {status: "required", reasons: session.reviewReasons}
            : {status: "required", reason: "current_project_unresolved"};
    if (metadata.schemaVersion !== TARGET_SCHEMA_VERSION
        || metadata.sessionId !== session.sessionId
        || metadata.profileKey !== session.profileKey
        || metadata.workspaceRoot !== undefined
        || metadata.workspaceKey !== undefined
        || metadata.projectPath !== undefined
        || (session.currentProjectRoot === null
            ? metadata.currentProjectRoot !== undefined
            : metadata.currentProjectRoot !== session.currentProjectRoot)
        || JSON.stringify(metadata.migrationReview) !== JSON.stringify(expectedReview)) {
        throw new Error(`${session.sourcePath}: schema v2 header与manifest计划不一致`);
    }
}

/** 全库复扫同时锁定文件集合、最终hash和每个Session的verified状态。 */
async function fullScan(rootWorkspace: string, manifest: SessionSchemaV2Manifest): Promise<void> {
    const files = await sessionJsonlFiles(rootWorkspace);
    const actualPaths = files.map((file) => file.sourcePath);
    const expectedPaths = manifest.sessions.map((session) => session.sourcePath).sort((left, right) => (
        left.localeCompare(right)
    ));
    if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
        throw new Error("Session schema migration lease内文件集合发生变化");
    }
    for (const session of manifest.sessions) {
        if (session.status !== "verified") {
            throw new Error(`${session.sourcePath}: full scan前尚未verified`);
        }
        await assertFileHash(
            workspacePath(rootWorkspace, session.sourcePath),
            session.targetHash,
            `${session.sourcePath}: full scan target hash无效`,
        );
        const target = await planFromPath(rootWorkspace, session.sourcePath, manifest, session);
        await verifyTargetPlan(session, target);
    }
}

/** rollback后文件集合不变且每个JSONL逐字节回到source hash。 */
async function verifyRollback(rootWorkspace: string, manifest: SessionSchemaV2Manifest): Promise<void> {
    const files = await sessionJsonlFiles(rootWorkspace);
    const actualPaths = files.map((file) => file.sourcePath);
    const expectedPaths = manifest.sessions.map((session) => session.sourcePath).sort((left, right) => (
        left.localeCompare(right)
    ));
    if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
        throw new Error("Session schema rollback期间文件集合发生变化");
    }
    for (const session of manifest.sessions) {
        await assertFileHash(
            workspacePath(rootWorkspace, session.sourcePath),
            session.sourceHash,
            `${session.sourcePath}: rollback source hash无效`,
        );
        if (session.changed && session.status !== "rolled_back") {
            throw new Error(`${session.sourcePath}: rollback状态未完成`);
        }
    }
}

/** 持久化run状态后通知测试或CLI observer。 */
async function advanceRun(
    paths: ReturnType<typeof migrationPaths>,
    manifest: SessionSchemaV2Manifest,
    status: SessionSchemaV2RunStatus,
    observer: RunSessionSchemaV2Options["observer"],
    assertHealthy: AssertLeaseHealthy,
): Promise<void> {
    assertHealthy();
    await transitionRun(paths, manifest, status);
    assertHealthy();
    await observer?.({kind: "run", status});
}

/** 捕获可恢复阶段；failed checkpoint供rollback_required sentinel绑定精确cursor。 */
async function recordFailure(
    paths: ReturnType<typeof migrationPaths>,
    manifest: SessionSchemaV2Manifest,
    error: unknown,
    assertHealthy: AssertLeaseHealthy,
): Promise<void> {
    if (manifest.status === "failed" || manifest.status === "report_written" || manifest.status === "rolled_back") {
        return;
    }
    assertHealthy();
    await transitionRun(paths, manifest, "failed", errorMessage(error));
    assertHealthy();
}

/** 从manifest冻结字段恢复decoder统计。 */
function stateStats(session: SessionSchemaV2State): SessionSchemaV2MigrationStats {
    return {
        rewrittenPaths: session.rewrittenPaths,
        resetProfileReminders: session.resetProfileReminders,
        cancelledToolCalls: session.cancelledToolCalls,
        clearedPendingResolutions: session.clearedPendingResolutions,
        clearedFollowUpQueue: session.clearedFollowUpQueue,
    };
}

/** 从终态manifest确定性派生CLI/Manager报告。 */
function reportFromManifest(
    manifest: SessionSchemaV2Manifest,
    mode: "dry-run" | "apply",
    status: "complete" | "already_current",
): SessionSchemaV2Report {
    return {
        version: 1,
        runId: manifest.runId,
        mode,
        status,
        scannedSessions: manifest.sessions.length,
        migratedSessions: manifest.sessions.filter((session) => session.changed).length,
        skippedSessions: manifest.sessions.filter((session) => !session.changed).length,
        reviewSessions: manifest.sessions.filter((session) => session.reviewReasons.length > 0).length,
        stats: sumStats(manifest.sessions.map((session) => stateStats(session))),
        sessions: manifest.sessions.map((session) => ({
            sessionId: session.sessionId,
            sourcePath: session.sourcePath,
            classification: session.classification,
            ...(session.currentProjectRoot ? {currentProjectRoot: session.currentProjectRoot} : {}),
            reviewReasons: [...session.reviewReasons],
            sourceHash: session.sourceHash,
            targetHash: session.targetHash,
            status: session.status,
            ...(session.changed ? {backupPath: session.backupPath} : {}),
        })),
    };
}

/** 从rollback终态manifest生成稳定报告。 */
function rollbackReport(manifest: SessionSchemaV2Manifest): SessionSchemaV2RollbackReport {
    return {
        version: 1,
        runId: manifest.runId,
        status: "rolled_back",
        restoredSessions: manifest.sessions.filter((session) => session.changed).length,
    };
}

/** Session v2 run拥有的固定、portable路径集合。 */
function migrationPaths(rootWorkspace: string, runId: string): SessionSchemaV2JournalPaths & {
    reportPath: string;
    manifestRelativePath: string;
} {
    const runRootRelative = `.nbook/agent/migrations/session-v2/${runId}`;
    const runRoot = resolve(rootWorkspace, ...runRootRelative.split("/"));
    return {
        rootWorkspace,
        runRoot,
        runRootRelative,
        manifestPath: resolve(runRoot, "manifest.json"),
        manifestRelativePath: `${runRootRelative}/manifest.json`,
        journalPath: resolve(runRoot, "journal.jsonl"),
        reportPath: resolve(runRoot, "report.json"),
    };
}

/** 原子发布schema sentinel；hash/cursor始终来自同一份磁盘checkpoint。 */
async function publishSentinel(
    rootWorkspace: string,
    paths: ReturnType<typeof migrationPaths>,
    manifest: SessionSchemaV2Manifest,
    state: AgentSessionStoreSentinel["state"],
    observer: RunSessionSchemaV2Options["observer"],
    assertHealthy: AssertLeaseHealthy,
): Promise<void> {
    await publishStoreSentinel(
        rootWorkspace,
        paths,
        manifest,
        state,
        SOURCE_SCHEMA_VERSION,
        TARGET_SCHEMA_VERSION,
        assertHealthy,
    );
    await observer?.({kind: "sentinel", state});
}

/** 成功rollback后把store标记为上一schema的可运行complete状态。 */
async function publishPreviousSchemaSentinel(
    rootWorkspace: string,
    paths: ReturnType<typeof migrationPaths>,
    manifest: SessionSchemaV2Manifest,
    assertHealthy: AssertLeaseHealthy,
): Promise<void> {
    await publishStoreSentinel(
        rootWorkspace,
        paths,
        manifest,
        "complete",
        TARGET_SCHEMA_VERSION,
        SOURCE_SCHEMA_VERSION,
        assertHealthy,
    );
}

/** 原子写入一个与磁盘manifest checkpoint精确绑定的store sentinel。 */
async function publishStoreSentinel(
    rootWorkspace: string,
    paths: ReturnType<typeof migrationPaths>,
    manifest: SessionSchemaV2Manifest,
    state: AgentSessionStoreSentinel["state"],
    sourceSchemaVersion: number,
    targetSchemaVersion: number,
    assertHealthy: AssertLeaseHealthy,
): Promise<void> {
    const bytes = await readFile(paths.manifestPath);
    let checkpoint: unknown;
    try {
        checkpoint = JSON.parse(bytes.toString("utf8")) as unknown;
    } catch (error) {
        throw new AgentSessionStoreCorruptError("Session v2 manifest checkpoint不是合法JSON", {cause: error});
    }
    if (!checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint)
        || !("runId" in checkpoint) || checkpoint.runId !== manifest.runId
        || !("appliedSeq" in checkpoint) || !Number.isSafeInteger(checkpoint.appliedSeq)) {
        throw new AgentSessionStoreCorruptError("Session v2 manifest checkpoint无法绑定sentinel");
    }
    const sentinel: AgentSessionStoreSentinel = {
        sentinelVersion: AGENT_SESSION_STORE_SENTINEL_VERSION,
        state,
        sourceSchemaVersion,
        targetSchemaVersion,
        runId: manifest.runId,
        manifestPath: paths.manifestRelativePath,
        manifestHash: sha256(bytes),
        checkpointCursor: checkpoint.appliedSeq as number,
    };
    assertHealthy();
    await writeAtomicDurableJson(agentSessionStoreSentinelPath(rootWorkspace), sentinel);
    assertHealthy();
}

/** 把任意异常收口为有界journal文本输入。 */
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** 汇总 decoder 的字段级迁移统计。 */
function sumStats(stats: SessionSchemaV2MigrationStats[]): SessionSchemaV2MigrationStats {
    return stats.reduce<SessionSchemaV2MigrationStats>((total, current) => ({
        rewrittenPaths: total.rewrittenPaths + current.rewrittenPaths,
        resetProfileReminders: total.resetProfileReminders + current.resetProfileReminders,
        cancelledToolCalls: total.cancelledToolCalls + current.cancelledToolCalls,
        clearedPendingResolutions: total.clearedPendingResolutions + current.clearedPendingResolutions,
        clearedFollowUpQueue: total.clearedFollowUpQueue || current.clearedFollowUpQueue,
    }), {
        rewrittenPaths: 0,
        resetProfileReminders: 0,
        cancelledToolCalls: 0,
        clearedPendingResolutions: 0,
        clearedFollowUpQueue: false,
    });
}

/** 收窄公开 runId，避免构造 migration run 越界路径。 */
function validatedRunId(value: string): string {
    if (!RUN_ID_PATTERN.test(value) || value === "." || value === "..") {
        throw new Error("migration runId 只能包含字母、数字、下划线和连字符");
    }
    return value;
}
