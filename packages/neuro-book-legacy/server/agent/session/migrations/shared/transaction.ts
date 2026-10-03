import {constants} from "node:fs";
import {copyFile, mkdir, rm} from "node:fs/promises";
import {dirname} from "node:path";
import {
    assertFileHash,
    optionalFileHash,
    renameDurable,
    syncFile,
    workspacePath,
    writeDurableText,
} from "nbook/server/agent/session/migrations/shared/durable-file";
import type {
    SessionFileMigrationPlan,
    SessionFileTransactionAdapter,
    SessionFileTransactionStatuses,
    SessionMigrationFileState,
} from "nbook/server/agent/session/migrations/shared/types";

/** apply 状态机的依赖；transition 必须先持久化 WAL 再更新内存 state。 */
export type ExecuteSessionTransactionOptions<
    TPlan extends SessionFileMigrationPlan,
    TSession extends SessionMigrationFileState<TStatus>,
    TStatus extends string,
> = {
    rootWorkspace: string;
    session: TSession;
    status: SessionFileTransactionStatuses<TStatus>;
    adapter: SessionFileTransactionAdapter<TPlan, TSession, TStatus>;
    transition(status: TStatus): Promise<void>;
    /** 每个持久化边界前后确认迁移仍拥有 Workspace Root lease。 */
    assertHealthy(): void;
};

/** rollback 状态机的依赖；只消费 manifest 冻结的路径与 hash。 */
export type RollbackSessionTransactionOptions<
    TSession extends SessionMigrationFileState<TStatus>,
    TStatus extends string,
> = {
    rootWorkspace: string;
    session: TSession;
    status: SessionFileTransactionStatuses<TStatus>;
    transition(status: TStatus): Promise<void>;
    /** 每个持久化边界前后确认迁移仍拥有 Workspace Root lease。 */
    assertHealthy(): void;
};

/**
 * 执行一个 Session JSONL 的可恢复文件事务。
 *
 * Module 拥有 backup/stage/publish/verify 顺序与 Windows 两步替换恢复；领域
 * Adapter 只负责重建迁移计划、准备 artifact 和验证迁移后的引用。
 */
export async function executeSessionTransaction<
    TPlan extends SessionFileMigrationPlan,
    TSession extends SessionMigrationFileState<TStatus>,
    TStatus extends string,
>(options: ExecuteSessionTransactionOptions<TPlan, TSession, TStatus>): Promise<void> {
    const {rootWorkspace, session, status, adapter, transition, assertHealthy} = options;
    while (session.status !== status.verified) {
        assertHealthy();
        if (!session.changed && session.status === status.pending) {
            const plan = await adapter.loadPlan(session.sourcePath);
            adapter.assertPlan(session, plan);
            await adapter.verifyTarget(session, plan);
            assertHealthy();
            await transition(status.verified);
            assertHealthy();
            continue;
        }
        if (session.status === status.pending) {
            const sourcePath = workspacePath(rootWorkspace, session.sourcePath);
            const backupPath = workspacePath(rootWorkspace, session.backupPath);
            await assertFileHash(sourcePath, session.sourceHash, "迁移前 source 已变化");
            const backupHash = await optionalFileHash(backupPath);
            if (backupHash === null) {
                assertHealthy();
                await mkdir(dirname(backupPath), {recursive: true});
                await copyFile(sourcePath, backupPath, constants.COPYFILE_EXCL);
                await syncFile(backupPath);
                assertHealthy();
            } else if (backupHash !== session.sourceHash) {
                throw new Error(`${session.sourcePath}: 已存在 backup 与 source 不一致`);
            }
            await assertFileHash(backupPath, session.sourceHash, "backup hash 与 source 不一致");
            assertHealthy();
            await transition(status.backedUp);
            assertHealthy();
            continue;
        }
        if (session.status === status.backedUp) {
            const plan = await adapter.loadPlan(session.backupPath);
            adapter.assertPlan(session, plan);
            assertHealthy();
            await adapter.prepareArtifacts(session, plan);
            assertHealthy();
            await transition(status.prepared);
            assertHealthy();
            continue;
        }
        if (session.status === status.prepared) {
            const plan = await adapter.loadPlan(session.backupPath);
            adapter.assertPlan(session, plan);
            const stagePath = workspacePath(rootWorkspace, session.stagePath);
            const stageHash = await optionalFileHash(stagePath);
            if (stageHash === null) {
                assertHealthy();
                await writeDurableText(stagePath, adapter.targetText(session, plan), true);
                assertHealthy();
            } else if (stageHash !== session.targetHash) {
                throw new Error(`${session.sourcePath}: 已存在 stage 与目标计划不一致`);
            }
            const staged = await adapter.loadPlan(session.stagePath);
            if (staged.changed || staged.targetHash !== session.targetHash) {
                throw new Error(`${session.sourcePath}: stage 仍包含旧内容或 hash 不一致`);
            }
            await adapter.verifyTarget(session, staged);
            assertHealthy();
            await transition(status.staged);
            assertHealthy();
            continue;
        }
        if (session.status === status.staged) {
            await assertFileHash(
                workspacePath(rootWorkspace, session.stagePath),
                session.targetHash,
                "stage hash 无效",
            );
            assertHealthy();
            await transition(status.publishing);
            assertHealthy();
            continue;
        }
        if (session.status === status.publishing) {
            assertHealthy();
            const recovered = await recoverPublishing(rootWorkspace, session);
            assertHealthy();
            await transition(recovered === "published" ? status.published : status.prepared);
            assertHealthy();
            continue;
        }
        if (session.status === status.published) {
            const sourcePath = workspacePath(rootWorkspace, session.sourcePath);
            await assertFileHash(sourcePath, session.targetHash, "published JSONL hash 无效");
            const plan = await adapter.loadPlan(session.sourcePath);
            if (plan.changed) {
                throw new Error(`${session.sourcePath}: published JSONL 仍包含旧内容`);
            }
            await adapter.verifyTarget(session, plan);
            assertHealthy();
            await rm(workspacePath(rootWorkspace, session.rollbackPath), {force: true});
            await rm(workspacePath(rootWorkspace, session.stagePath), {force: true});
            assertHealthy();
            await transition(status.verified);
            assertHealthy();
            continue;
        }
        throw new Error(`${session.sourcePath}: session状态无法继续迁移：${session.status}`);
    }
}

/** 按现有 WAL 状态恢复一个 Session；磁盘 hash 使所有发布窗口可重入。 */
export async function rollbackSessionTransaction<
    TSession extends SessionMigrationFileState<TStatus>,
    TStatus extends string,
>(options: RollbackSessionTransactionOptions<TSession, TStatus>): Promise<void> {
    const {rootWorkspace, session, status, transition, assertHealthy} = options;
    while (session.status !== status.rolledBack) {
        assertHealthy();
        if (session.status === status.verified) {
            assertHealthy();
            await transition(status.rollbackPending);
            assertHealthy();
            continue;
        }
        if (session.status === status.rollbackPending) {
            const backupPath = workspacePath(rootWorkspace, session.backupPath);
            const stagePath = workspacePath(rootWorkspace, session.stagePath);
            await assertFileHash(backupPath, session.sourceHash, `${session.sourcePath}: rollback backup hash无效`);
            const stageHash = await optionalFileHash(stagePath);
            if (stageHash === null) {
                assertHealthy();
                await mkdir(dirname(stagePath), {recursive: true});
                await copyFile(backupPath, stagePath, constants.COPYFILE_EXCL);
                await syncFile(stagePath);
                assertHealthy();
            } else if (stageHash !== session.sourceHash) {
                throw new Error(`${session.sourcePath}: rollback stage内容无法识别`);
            }
            assertHealthy();
            await transition(status.rollbackPublishing);
            assertHealthy();
            continue;
        }
        if (session.status === status.rollbackPublishing) {
            assertHealthy();
            await recoverRollbackPublishing(rootWorkspace, session);
            assertHealthy();
            await transition(status.rolledBack);
            assertHealthy();
            continue;
        }
        throw new Error(`${session.sourcePath}: session状态无法回滚：${session.status}`);
    }
}

/** Windows 两步替换的反向恢复；source/target hash 是唯一可接受的磁盘身份。 */
async function recoverRollbackPublishing<TStatus extends string>(
    rootWorkspace: string,
    session: SessionMigrationFileState<TStatus>,
): Promise<void> {
    const original = workspacePath(rootWorkspace, session.sourcePath);
    const stage = workspacePath(rootWorkspace, session.stagePath);
    const rollback = workspacePath(rootWorkspace, session.rollbackPath);
    const originalHash = await optionalFileHash(original);
    const stageHash = await optionalFileHash(stage);
    const rollbackHash = await optionalFileHash(rollback);

    if (originalHash === session.sourceHash) {
        await rm(stage, {force: true});
        await rm(rollback, {force: true});
        return;
    }
    if (originalHash === session.targetHash) {
        if (stageHash !== session.sourceHash) {
            throw new Error(`${session.sourcePath}: rollback stage缺失或hash无效`);
        }
        if (rollbackHash !== null && rollbackHash !== session.targetHash) {
            throw new Error(`${session.sourcePath}: rollback临时文件内容无法识别`);
        }
        if (rollbackHash === session.targetHash) {
            await rm(rollback, {force: true});
        }
        await mkdir(dirname(rollback), {recursive: true});
        await renameDurable(original, rollback);
        await renameDurable(stage, original);
        await assertFileHash(original, session.sourceHash, `${session.sourcePath}: restored source hash无效`);
        await rm(rollback, {force: true});
        return;
    }
    if (originalHash === null && rollbackHash === session.targetHash && stageHash === session.sourceHash) {
        await renameDurable(stage, original);
        await assertFileHash(original, session.sourceHash, `${session.sourcePath}: crash recovery source hash无效`);
        await rm(rollback, {force: true});
        return;
    }
    throw new Error(`${session.sourcePath}: rollback publishing磁盘状态无法安全恢复`);
}

/** Windows 两步发布窗口恢复；已发布、继续发布、恢复 source 都由 hash 判定。 */
async function recoverPublishing<TStatus extends string>(
    rootWorkspace: string,
    session: SessionMigrationFileState<TStatus>,
): Promise<"published" | "rebuild_stage"> {
    const original = workspacePath(rootWorkspace, session.sourcePath);
    const stage = workspacePath(rootWorkspace, session.stagePath);
    const rollback = workspacePath(rootWorkspace, session.rollbackPath);
    const originalHash = await optionalFileHash(original);
    const stageHash = await optionalFileHash(stage);
    const rollbackHash = await optionalFileHash(rollback);

    if (originalHash === session.targetHash) {
        await rm(stage, {force: true});
        return "published";
    }
    if (originalHash === session.sourceHash) {
        if (stageHash !== session.targetHash) {
            return "rebuild_stage";
        }
        if (rollbackHash && rollbackHash !== session.sourceHash) {
            throw new Error(`${session.sourcePath}: rollback 内容无法识别`);
        }
        if (rollbackHash === session.sourceHash) {
            await rm(rollback, {force: true});
        }
        await mkdir(dirname(rollback), {recursive: true});
        await renameDurable(original, rollback);
        await renameDurable(stage, original);
        await assertFileHash(original, session.targetHash, "发布后的 original hash 无效");
        return "published";
    }
    if (originalHash === null && rollbackHash === session.sourceHash && stageHash === session.targetHash) {
        await renameDurable(stage, original);
        await assertFileHash(original, session.targetHash, "恢复发布后的 original hash 无效");
        return "published";
    }
    if (originalHash === null && rollbackHash === session.sourceHash && stageHash === null) {
        await mkdir(dirname(original), {recursive: true});
        await renameDurable(rollback, original);
        return "rebuild_stage";
    }
    throw new Error(`${session.sourcePath}: publishing 磁盘状态无法安全恢复`);
}
