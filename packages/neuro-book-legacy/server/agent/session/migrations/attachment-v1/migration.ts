import {constants} from "node:fs";
import {
    access,
    mkdir,
    open,
    readFile,
    rm,
} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {randomUUID} from "node:crypto";
import {AttachmentStore} from "nbook/server/agent/attachments/attachment-store";
import {LocalAttachmentBlobAdapter} from "nbook/server/agent/attachments/local-attachment-blob-adapter";
import {AttachmentError} from "nbook/server/agent/attachments/types";
import {imageMimeType} from "nbook/server/agent/attachments/agent-attachment-codec";
import {ATTACHMENT_MIGRATION_LOCK_RELATIVE_PATH, AttachmentMigrationGate} from "nbook/server/agent/session/attachment-migration-gate";
import {decodeLegacySession} from "nbook/server/agent/session/migrations/attachment-v1/legacy-decoder";
import {
    checkpointManifest,
    loadManifest,
    transitionRun,
    transitionSession,
    writeInitialManifest,
    ATTACHMENT_MIGRATION_STATUS,
} from "nbook/server/agent/session/migrations/attachment-v1/journal";
import type {
    AttachmentMigrationManifest,
    AttachmentMigrationReport,
    AttachmentMigrationRunStatus,
    AttachmentSessionPlan,
    AttachmentSessionMigrationState,
    AttachmentSessionMigrationStatus,
    RunAttachmentMigrationOptions,
    RunAttachmentRollbackOptions,
    AttachmentMigrationRollbackReport,
} from "nbook/server/agent/session/migrations/attachment-v1/types";
import {
    assertFileHash,
    pathExists,
    portableRelative,
    sessionJsonlFiles,
    workspacePath,
    writeDurableJson,
} from "nbook/server/agent/session/migrations/shared/durable-file";
import {
    executeSessionTransaction,
    rollbackSessionTransaction,
} from "nbook/server/agent/session/migrations/shared/transaction";
import {runWithAgentSessionStoreLease} from "nbook/server/agent/session/agent-session-store-lease";

const RUN_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
type AssertLeaseHealthy = () => void;

type MigrationLock = {
    version: 1;
    runId: string;
    pid: number;
    startedAt: string;
    manifestPath: string;
};

/**
 * 执行 Attachment v1 Workspace Root 迁移。
 *
 * dry-run 完整解析并转换所有 session，但不创建任何迁移或 blob 文件；apply
 * 在同一 preflight 通过后才取得独占 sentinel。恢复逻辑由同一入口的 resume 处理。
 */
export async function runAgentAttachmentMigration(options: RunAttachmentMigrationOptions): Promise<AttachmentMigrationReport> {
    const rootWorkspace = resolve(options.rootWorkspace);
    if (options.mode === "dry-run") {
        if (options.resume) {
            throw new Error("dry-run 不能使用 resume");
        }
        const runId = validatedRunId(options.runId ?? randomUUID());
        await assertLockAbsent(rootWorkspace);
        const plans = await planWorkspace(rootWorkspace);
        await verifyPreflightStorage(rootWorkspace, plans);
        return reportFromPlans(runId, "dry-run", "planned", plans);
    }
    const releaseRuntimeLease = await new AttachmentMigrationGate(rootWorkspace).acquireRuntimeLease();
    const assertHealthy: AssertLeaseHealthy = () => releaseRuntimeLease.assertHealthy();
    return runWithAgentSessionStoreLease(releaseRuntimeLease, async () => {
        return options.resume
            ? await resumeApply(rootWorkspace, options, assertHealthy)
            : await startApply(rootWorkspace, validatedRunId(options.runId ?? randomUUID()), options, assertHealthy);
    });
}

/**
 * 回滚一次Attachment hard cut。
 *
 * Manager会在恢复旧Product前调用该入口。它先把中断的apply恢复到确定终态，再依据
 * migration manifest中的source/target hash幂等恢复每个已改变session。
 */
export async function rollbackAgentAttachmentMigration(
    options: RunAttachmentRollbackOptions,
): Promise<AttachmentMigrationRollbackReport> {
    const rootWorkspace = resolve(options.rootWorkspace);
    const runId = validatedRunId(options.runId);
    const paths = migrationPaths(rootWorkspace, runId);
    const releaseRuntimeLease = await new AttachmentMigrationGate(rootWorkspace).acquireRuntimeLease();
    const assertHealthy: AssertLeaseHealthy = () => releaseRuntimeLease.assertHealthy();
    return runWithAgentSessionStoreLease(releaseRuntimeLease, async () => {
        if (!await pathExists(paths.runRoot)) {
            await clearUnstartedRunLock(rootWorkspace, paths, runId, assertHealthy);
            return {version: 1, runId, status: "not_started", restoredSessions: 0};
        }

        let manifest = await loadManifest(paths);
        if (!manifest) {
            await clearUnstartedRunLock(rootWorkspace, paths, runId, assertHealthy);
            assertHealthy();
            await rm(paths.runRoot, {recursive: true, force: true});
            assertHealthy();
            return {version: 1, runId, status: "not_started", restoredSessions: 0};
        }
        const rollbackInProgress = manifest.status === "rollback_running"
            || manifest.status === "rolled_back"
            || manifest.status === "failed" && manifest.resumeStatus === "rollback_running";
        if (!rollbackInProgress && manifest.status !== "report_written") {
            await resumeApply(rootWorkspace, {
                rootWorkspace,
                mode: "apply",
                runId,
                resume: true,
            }, assertHealthy);
            manifest = await requiredManifest(paths);
        }

        await ensureRollbackLock(rootWorkspace, paths, runId, assertHealthy);
        manifest = await requiredManifest(paths);
        if (manifest.status === "rolled_back") {
            assertHealthy();
            await rm(paths.lockPath, {force: true});
            assertHealthy();
            return rollbackReport(manifest);
        }
        if (manifest.status === "failed") {
            if (manifest.resumeStatus !== "rollback_running") {
                throw new Error(`Attachment migration run ${runId}失败阶段不是rollback_running`);
            }
            await advanceRun(paths, manifest, "rollback_running", undefined, assertHealthy);
        } else if (manifest.status === "report_written") {
            await advanceRun(paths, manifest, "rollback_running", undefined, assertHealthy);
        }
        if (manifest.status !== "rollback_running") {
            throw new Error(`Attachment migration run ${runId}状态无法回滚：${manifest.status}`);
        }
        try {
            for (const session of manifest.sessions) {
                if (!session.changed) continue;
                await rollbackSession(rootWorkspace, paths, manifest, session, options.observer, assertHealthy);
            }
            for (const session of manifest.sessions) {
                if (!session.changed) continue;
                await assertFileHash(
                    workspacePath(rootWorkspace, session.sourcePath),
                    session.sourceHash,
                    `${session.sourcePath}: rollback后的source hash无效`,
                );
            }
            await advanceRun(paths, manifest, "rolled_back", undefined, assertHealthy);
            assertHealthy();
            await checkpointManifest(paths, manifest);
            assertHealthy();
            await rm(paths.lockPath, {force: true});
            assertHealthy();
            return rollbackReport(manifest);
        } catch (error) {
            await recordFailure(paths, manifest, error, assertHealthy).catch(() => undefined);
            throw error;
        }
    });
}

/** 新 apply 先做零写入 preflight，再独占 lock，并在 lock 内重扫消除竞态。 */
async function startApply(
    rootWorkspace: string,
    runId: string,
    options: RunAttachmentMigrationOptions,
    assertHealthy: AssertLeaseHealthy,
): Promise<AttachmentMigrationReport> {
    const preflight = await planWorkspace(rootWorkspace);
    await verifyPreflightStorage(rootWorkspace, preflight);
    const paths = migrationPaths(rootWorkspace, runId);
    if (await pathExists(paths.runRoot)) {
        throw new Error(`migration run ${runId} 已存在；未完成任务请使用 --resume`);
    }
    assertHealthy();
    await acquireLock(paths.lockPath, {
        version: 1,
        runId,
        pid: process.pid,
        startedAt: new Date().toISOString(),
        manifestPath: portableRelative(rootWorkspace, paths.manifestPath),
    });
    assertHealthy();

    let manifest: AttachmentMigrationManifest | undefined;
    try {
        const lockedPlans = await planWorkspace(rootWorkspace);
        await verifyPreflightStorage(rootWorkspace, lockedPlans);
        manifest = createManifest(runId, lockedPlans, paths.runRootRelative);
        assertHealthy();
        await writeInitialManifest(paths, manifest);
        assertHealthy();
        return await executeManifest(rootWorkspace, paths, manifest, options, assertHealthy);
    } catch (error) {
        if (manifest) {
            await recordFailure(paths, manifest, error, assertHealthy).catch(() => undefined);
        }
        throw error;
    }
}

/** 显式 resume 只接受当前 sentinel 指向的 run，不覆盖未知迁移。 */
async function resumeApply(
    rootWorkspace: string,
    options: RunAttachmentMigrationOptions,
    assertHealthy: AssertLeaseHealthy,
): Promise<AttachmentMigrationReport> {
    const lockPath = resolve(rootWorkspace, ATTACHMENT_MIGRATION_LOCK_RELATIVE_PATH);
    const lock = await readLock(lockPath);
    if (options.runId && options.runId !== lock.runId) {
        throw new Error(`当前 migration lock 属于 run ${lock.runId}，不能恢复 ${options.runId}`);
    }
    const runId = validatedRunId(lock.runId);
    const paths = migrationPaths(rootWorkspace, runId);
    if (lock.manifestPath !== portableRelative(rootWorkspace, paths.manifestPath)) {
        throw new Error("migration lock 的 manifestPath 与 runId 不一致");
    }
    let manifest = await loadManifest(paths);
    if (!manifest) {
        if (await pathExists(paths.journalPath)) {
            throw new Error("migration manifest 缺失但 journal 已存在；不能自动重建计划");
        }
        const plans = await planWorkspace(rootWorkspace);
        await verifyPreflightStorage(rootWorkspace, plans);
        manifest = createManifest(runId, plans, paths.runRootRelative);
        assertHealthy();
        await writeInitialManifest(paths, manifest);
        assertHealthy();
    }
    if (manifest.runId !== runId) {
        throw new Error("migration lock 与 manifest runId 不一致");
    }
    if (manifest.status === "failed") {
        if (!manifest.resumeStatus) {
            throw new Error("failed migration 缺少可恢复阶段");
        }
        await advanceRun(paths, manifest, manifest.resumeStatus, options.observer, assertHealthy);
    }
    try {
        return await executeManifest(rootWorkspace, paths, manifest, options, assertHealthy);
    } catch (error) {
        await recordFailure(paths, manifest, error, assertHealthy).catch(() => undefined);
        throw error;
    }
}

async function executeManifest(
    rootWorkspace: string,
    paths: ReturnType<typeof migrationPaths>,
    manifest: AttachmentMigrationManifest,
    options: RunAttachmentMigrationOptions,
    assertHealthy: AssertLeaseHealthy,
): Promise<AttachmentMigrationReport> {
    const store = new AttachmentStore(new LocalAttachmentBlobAdapter(resolve(rootWorkspace, ".nbook", "agent", "attachments")));
    if (manifest.status === "running") {
        for (const session of manifest.sessions) {
            await executeSession(rootWorkspace, paths, manifest, session, store, options.observer, assertHealthy);
        }
        await fullScan(rootWorkspace, manifest, store);
        await advanceRun(paths, manifest, "full_scan_verified", options.observer, assertHealthy);
    }
    if (manifest.status === "full_scan_verified") {
        await advanceRun(paths, manifest, "complete", options.observer, assertHealthy);
    }
    const report = reportFromManifest(manifest);
    if (manifest.status === "complete") {
        assertHealthy();
        await writeDurableJson(paths.reportPath, report);
        assertHealthy();
        await advanceRun(paths, manifest, "report_written", options.observer, assertHealthy);
    }
    if (manifest.status !== "report_written") {
        throw new Error(`migration run 状态无法完成：${manifest.status}`);
    }
    // report 可由 manifest 确定性派生；恢复 report_written 时重写可修复缺失/半写报告。
    assertHealthy();
    await writeDurableJson(paths.reportPath, report);
    assertHealthy();
    await checkpointManifest(paths, manifest);
    assertHealthy();
    await rm(paths.lockPath, {force: true});
    assertHealthy();
    return report;
}

function createManifest(
    runId: string,
    plans: AttachmentSessionPlan[],
    runRootRelative: string,
): AttachmentMigrationManifest {
    const now = new Date().toISOString();
    return {
        version: 2,
        journalVersion: 1,
        runId,
        status: "running",
        appliedSeq: 0,
        startedAt: now,
        updatedAt: now,
        sessions: plans.map((plan) => ({
            sessionId: plan.sessionId,
            sourcePath: plan.sourcePath,
            backupPath: `${runRootRelative}/backups/${plan.sourcePath}.backup`,
            stagePath: `${runRootRelative}/stages/${plan.sourcePath}.stage`,
            rollbackPath: `${runRootRelative}/rollbacks/${plan.sourcePath}.rollback`,
            sourceHash: plan.sourceHash,
            targetHash: plan.targetHash,
            images: plan.images,
            bytes: plan.bytes,
            attachmentIds: plan.attachments.map((attachment) => attachment.ref.id),
            changed: plan.changed,
            status: plan.changed ? "pending" : "verified",
        })),
    };
}

function migrationPaths(rootWorkspace: string, runId: string) {
    const runRootRelative = `.nbook/agent/migrations/attachment-v1/${runId}`;
    const runRoot = resolve(rootWorkspace, ...runRootRelative.split("/"));
    return {
        rootWorkspace,
        runRoot,
        runRootRelative,
        lockPath: resolve(rootWorkspace, ATTACHMENT_MIGRATION_LOCK_RELATIVE_PATH),
        manifestPath: resolve(runRoot, "manifest.json"),
        journalPath: resolve(runRoot, "journal.jsonl"),
        reportPath: resolve(runRoot, "report.json"),
    };
}

async function acquireLock(path: string, lock: MigrationLock): Promise<void> {
    await mkdir(dirname(path), {recursive: true});
    const handle = await open(path, "wx").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "EEXIST") {
            throw new Error("Attachment migration lock 已存在；请检查状态并使用 --resume");
        }
        throw error;
    });
    try {
        await handle.writeFile(`${JSON.stringify(lock)}\n`, "utf8");
        await handle.sync();
    } finally {
        await handle.close();
    }
}

async function readLock(path: string): Promise<MigrationLock> {
    const value = JSON.parse(await readFile(path, "utf8")) as Partial<MigrationLock>;
    if (value.version !== 1
        || typeof value.runId !== "string"
        || typeof value.pid !== "number"
        || typeof value.startedAt !== "string"
        || typeof value.manifestPath !== "string") {
        throw new Error("Attachment migration lock 内容无效；不能自动覆盖");
    }
    return value as MigrationLock;
}

async function executeSession(
    rootWorkspace: string,
    paths: ReturnType<typeof migrationPaths>,
    manifest: AttachmentMigrationManifest,
    session: AttachmentSessionMigrationState,
    store: AttachmentStore,
    observer: RunAttachmentMigrationOptions["observer"],
    assertHealthy: AssertLeaseHealthy,
): Promise<void> {
    await executeSessionTransaction({
        rootWorkspace,
        session,
        status: ATTACHMENT_MIGRATION_STATUS.session,
        adapter: {
            loadPlan: (path) => planFromPath(rootWorkspace, path),
            assertPlan: (state, plan) => assertPlanHashes(state, plan),
            prepareArtifacts: async (state, plan) => {
                for (const attachment of plan.attachments) {
                    assertHealthy();
                    const saved = await store.save({bytes: attachment.bytes, mimeType: attachment.ref.mimeType});
                    assertHealthy();
                    if (saved.id !== attachment.ref.id || saved.bytes !== attachment.ref.bytes) {
                        throw new Error(`${state.sourcePath}: AttachmentStore 返回了不一致的引用`);
                    }
                    const loaded = await store.load(saved);
                    if (imageMimeType(loaded) !== saved.mimeType) {
                        throw new Error(`${state.sourcePath}: Attachment hydration readiness 校验失败`);
                    }
                }
                await verifyPlanRefs(plan, store, new Set(plan.attachments.map((item) => item.ref.id)));
            },
            verifyTarget: (_state, plan) => verifyPlanRefs(plan, store, new Set()),
            targetText: (_state, plan) => plan.targetText,
        },
        transition: (status) => advanceSession(paths, manifest, session, status, observer, assertHealthy),
        assertHealthy,
    });
}

/** 按现有WAL状态恢复一个session；磁盘hash使checkpoint写入前后的崩溃都可重入。 */
async function rollbackSession(
    rootWorkspace: string,
    paths: ReturnType<typeof migrationPaths>,
    manifest: AttachmentMigrationManifest,
    session: AttachmentSessionMigrationState,
    observer: RunAttachmentRollbackOptions["observer"],
    assertHealthy: AssertLeaseHealthy,
): Promise<void> {
    await rollbackSessionTransaction({
        rootWorkspace,
        session,
        status: ATTACHMENT_MIGRATION_STATUS.session,
        transition: async (status) => {
            await transitionSession(paths, manifest, session, status);
            if (status === "rollback_pending" || status === "rollback_publishing" || status === "rolled_back") {
                await observer?.({sourcePath: session.sourcePath, status});
            }
        },
        assertHealthy,
    });
}

/** rollback复用同一个全局sentinel；同run残留lock表示上次回滚需继续。 */
async function ensureRollbackLock(
    rootWorkspace: string,
    paths: ReturnType<typeof migrationPaths>,
    runId: string,
    assertHealthy: AssertLeaseHealthy,
): Promise<void> {
    const manifestPath = portableRelative(rootWorkspace, paths.manifestPath);
    if (await pathExists(paths.lockPath)) {
        const lock = await readLock(paths.lockPath);
        if (lock.runId !== runId || lock.manifestPath !== manifestPath) {
            throw new Error(`Attachment migration lock属于其他run：${lock.runId}`);
        }
        return;
    }
    assertHealthy();
    await acquireLock(paths.lockPath, {
        version: 1,
        runId,
        pid: process.pid,
        startedAt: new Date().toISOString(),
        manifestPath,
    });
    assertHealthy();
}

/** initial manifest落盘前没有任何session变化，同run lock可安全视为未开始并清理。 */
async function clearUnstartedRunLock(
    rootWorkspace: string,
    paths: ReturnType<typeof migrationPaths>,
    runId: string,
    assertHealthy: AssertLeaseHealthy,
): Promise<void> {
    if (!await pathExists(paths.lockPath)) return;
    const lock = await readLock(paths.lockPath);
    const manifestPath = portableRelative(rootWorkspace, paths.manifestPath);
    if (lock.runId !== runId || lock.manifestPath !== manifestPath) {
        throw new Error(`Attachment migration lock属于其他run：${lock.runId}`);
    }
    assertHealthy();
    await rm(paths.lockPath, {force: true});
    assertHealthy();
}

/** 读取必须存在的migration manifest。 */
async function requiredManifest(
    paths: ReturnType<typeof migrationPaths>,
): Promise<AttachmentMigrationManifest> {
    const manifest = await loadManifest(paths);
    if (!manifest) {
        throw new Error("Attachment migration manifest缺失");
    }
    return manifest;
}

/** 从终态manifest生成Manager可稳定解析的有界回滚报告。 */
function rollbackReport(manifest: AttachmentMigrationManifest): AttachmentMigrationRollbackReport {
    return {
        version: 1,
        runId: manifest.runId,
        status: "rolled_back",
        restoredSessions: manifest.sessions.filter((session) => session.changed).length,
    };
}

/** 持久化 session delta 后通知测试/CLI observer。 */
async function advanceSession(
    paths: ReturnType<typeof migrationPaths>,
    manifest: AttachmentMigrationManifest,
    session: AttachmentSessionMigrationState,
    status: AttachmentSessionMigrationStatus,
    observer: RunAttachmentMigrationOptions["observer"],
    assertHealthy: AssertLeaseHealthy,
): Promise<void> {
    assertHealthy();
    await transitionSession(paths, manifest, session, status);
    assertHealthy();
    await observer?.({kind: "session", sourcePath: session.sourcePath, status});
}

/** 持久化 run delta 后通知 observer；报告与 sentinel 的时序由这些阶段锁定。 */
async function advanceRun(
    paths: ReturnType<typeof migrationPaths>,
    manifest: AttachmentMigrationManifest,
    status: AttachmentMigrationRunStatus,
    observer: RunAttachmentMigrationOptions["observer"],
    assertHealthy: AssertLeaseHealthy,
): Promise<void> {
    assertHealthy();
    await transitionRun(paths, manifest, status);
    assertHealthy();
    await observer?.({kind: "run", status});
}

/** 失败只追加一条有界 run delta，保留出错前阶段供显式 resume。 */
async function recordFailure(
    paths: ReturnType<typeof migrationPaths>,
    manifest: AttachmentMigrationManifest,
    error: unknown,
    assertHealthy: AssertLeaseHealthy,
): Promise<void> {
    if (manifest.status === "failed" || manifest.status === "report_written") {
        return;
    }
    assertHealthy();
    await transitionRun(paths, manifest, "failed", errorMessage(error));
    assertHealthy();
}

async function fullScan(rootWorkspace: string, manifest: AttachmentMigrationManifest, store: AttachmentStore): Promise<void> {
    const plans = await planWorkspace(rootWorkspace);
    const actualPaths = plans.map((plan) => plan.sourcePath).sort();
    const expectedPaths = manifest.sessions.map((session) => session.sourcePath).sort();
    if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
        throw new Error("migration lock 内 session 文件集合发生变化");
    }
    for (const plan of plans) {
        if (plan.changed) {
            throw new Error(`${plan.sourcePath}: 全库复扫仍发现旧图片`);
        }
        await verifyPlanRefs(plan, store, new Set());
        const state = manifest.sessions.find((session) => session.sourcePath === plan.sourcePath);
        if (!state || state.status !== "verified" || plan.sourceHash !== state.targetHash) {
            throw new Error(`${plan.sourcePath}: manifest 与最终 JSONL 不一致`);
        }
    }
}

async function verifyPlanRefs(plan: AttachmentSessionPlan, store: AttachmentStore, newlyWritten: Set<string>): Promise<void> {
    for (const ref of plan.referencedAttachments) {
        if (newlyWritten.has(ref.id)) {
            continue;
        }
        const bytes = await store.load(ref);
        if (ref.mimeType.startsWith("image/") && imageMimeType(bytes) !== ref.mimeType) {
            throw new Error(`${plan.sourcePath}: Attachment 图片 MIME 校验失败`);
        }
    }
}

function assertPlanHashes(session: AttachmentSessionMigrationState, plan: AttachmentSessionPlan): void {
    if (plan.sourceHash !== session.sourceHash || plan.targetHash !== session.targetHash) {
        throw new Error(`${session.sourcePath}: backup/source 与 manifest 计划不一致`);
    }
}

async function planFromPath(rootWorkspace: string, relativePath: string): Promise<AttachmentSessionPlan> {
    const text = await readFile(workspacePath(rootWorkspace, relativePath), "utf8");
    return decodeLegacySession({sourcePath: relativePath, text});
}

/** 递归枚举当前 repository session 根下的 JSONL，旧分目录同样纳入硬切复扫。 */
async function planWorkspace(rootWorkspace: string): Promise<AttachmentSessionPlan[]> {
    const files = await sessionJsonlFiles(rootWorkspace);
    const plans: AttachmentSessionPlan[] = [];
    for (const file of files) {
        const text = await readFile(file.absolutePath, "utf8");
        const sourcePath = file.sourcePath;
        const plan = decodeLegacySession({sourcePath, text});
        // Workspace preflight 只保留 hashes/ref/bytes；避免数百个 session 的完整 JSONL 字符串同时存活。
        plans.push({...plan, sourceText: "", targetText: ""});
    }
    return plans.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
}

/** dry-run 不尝试写探针；检查父目录权限和已存在 blob/引用的一致性。 */
async function verifyPreflightStorage(rootWorkspace: string, plans: AttachmentSessionPlan[]): Promise<void> {
    // 全新 Workspace Root 没有 Agent 目录，也没有任何历史 session 需要迁移。
    // dry-run 必须保持零写入，不能为了权限探针创建一个原本不存在的领域目录。
    if (plans.length === 0) return;
    const agentRoot = resolve(rootWorkspace, ".nbook", "agent");
    await access(agentRoot, constants.W_OK);
    const adapter = new LocalAttachmentBlobAdapter(resolve(agentRoot, "attachments"));
    const store = new AttachmentStore(adapter);
    const decoded = new Map(plans.flatMap((plan) => plan.attachments.map((attachment) => [attachment.ref.id, attachment])));

    for (const attachment of decoded.values()) {
        const existing = await adapter.get(attachmentKey(attachment.ref.id));
        if (existing && !sameBytes(existing, attachment.bytes)) {
            throw new AttachmentError("corrupt", "目标 Attachment 已存在但内容与迁移源不一致。");
        }
    }
    for (const plan of plans) {
        for (const ref of plan.referencedAttachments) {
            if (!decoded.has(ref.id)) {
                await store.load(ref);
            }
        }
    }
}

function reportFromPlans(
    runId: string,
    mode: "dry-run" | "apply",
    status: "planned" | "complete",
    plans: AttachmentSessionPlan[],
): AttachmentMigrationReport {
    const unique = new Set(plans.flatMap((plan) => plan.attachments.map((attachment) => attachment.ref.id)));
    return {
        version: 1,
        runId,
        mode,
        status,
        scannedSessions: plans.length,
        migratedSessions: plans.filter((plan) => plan.changed).length,
        skippedSessions: plans.filter((plan) => !plan.changed).length,
        images: plans.reduce((sum, plan) => sum + plan.images, 0),
        uniqueAttachments: unique.size,
        bytes: plans.reduce((sum, plan) => sum + plan.bytes, 0),
        sessions: plans.map((plan) => ({
            sessionId: plan.sessionId,
            sourcePath: plan.sourcePath,
            sourceHash: plan.sourceHash,
            targetHash: plan.targetHash,
            images: plan.images,
            bytes: plan.bytes,
            status: plan.changed ? "pending" : "verified",
        })),
    };
}

function reportFromManifest(manifest: AttachmentMigrationManifest): AttachmentMigrationReport {
    const unique = new Set(manifest.sessions.flatMap((session) => session.attachmentIds));
    return {
        version: 1,
        runId: manifest.runId,
        mode: "apply",
        status: "complete",
        scannedSessions: manifest.sessions.length,
        migratedSessions: manifest.sessions.filter((session) => session.changed).length,
        skippedSessions: manifest.sessions.filter((session) => !session.changed).length,
        images: manifest.sessions.reduce((sum, session) => sum + session.images, 0),
        uniqueAttachments: unique.size,
        bytes: manifest.sessions.reduce((sum, session) => sum + session.bytes, 0),
        sessions: manifest.sessions.map((session) => ({
            sessionId: session.sessionId,
            sourcePath: session.sourcePath,
            sourceHash: session.sourceHash,
            targetHash: session.targetHash,
            images: session.images,
            bytes: session.bytes,
            status: session.status,
            backupPath: session.backupPath,
        })),
    };
}

function attachmentKey(id: string): string {
    const hash = id.slice("sha256:".length);
    return `sha256/${hash.slice(0, 2)}/${hash.slice(2)}`;
}

function validatedRunId(value: string): string {
    if (!RUN_ID_PATTERN.test(value) || value === "." || value === "..") {
        throw new Error("migration runId 只能包含字母、数字、下划线和连字符");
    }
    return value;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function assertLockAbsent(rootWorkspace: string): Promise<void> {
    const lockPath = resolve(rootWorkspace, ATTACHMENT_MIGRATION_LOCK_RELATIVE_PATH);
    if (await pathExists(lockPath)) {
        throw new Error("Attachment migration lock 已存在；dry-run/新 apply 不能读取迁移中的 session");
    }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
    if (left.byteLength !== right.byteLength) {
        return false;
    }
    for (let index = 0; index < left.byteLength; index += 1) {
        if (left[index] !== right[index]) {
            return false;
        }
    }
    return true;
}
