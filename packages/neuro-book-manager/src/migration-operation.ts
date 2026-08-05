import {randomUUID} from "node:crypto";
import {join} from "node:path";
import {
    applyApplicationStateMigration,
    assertProductExit,
    launchApplication,
    planApplicationStateMigration,
    terminateFailedLaunch,
    type StartApplicationOptions,
} from "#manager/app-commands";
import {ensureStateFiles} from "#manager/config";
import {
    inspectDockerApplication,
    stopDocker,
    type DockerApplicationInspection,
} from "#manager/docker";
import {assertNativeProductStopped, backupApplicationDatabase} from "#manager/health";
import {mutateInstallation} from "#manager/installation-mutation";
import {
    commitOperation,
    createOperation,
    prepareCandidateContainer,
    recordCandidateContainer,
    recoverFailedOperation,
    setOperationEffect,
    updateOperation,
} from "#manager/operation";
import {installationPaths} from "#manager/paths";
import {assertInstallationHostCompatible} from "#manager/platform";
import type {InstallationManifest, OperationJournal} from "#manager/types";

export type ApplicationServiceState =
    | {kind: "native"}
    | {kind: "container"; inspection: DockerApplicationInspection};

/**
 * 在当前 installation operation 中执行 Product-owned Application State migration。
 *
 * Application runId 必须先持久化再 apply；Manager 不解释 catalog step，具体 backup、
 * checkpoint 与反序 rollback 全由目标 Product runner 持有。
 */
export async function planJournaledApplicationMigrations(
    root: string,
    manifest: InstallationManifest,
    journal: OperationJournal,
    options: {
        /** 候选 Product runner 所在根；只用于 plan。 */
        planRoot?: string;
        /** apply/rollback 必须继续使用的 Product 根。 */
        migrationRoot?: string;
        /** Container 候选 Compose；plan 后不进入 Journal。 */
        composePath?: string;
        /** Fresh Container plan 使用的 staging State Root。 */
        containerStateRoot?: string;
    } = {},
): Promise<{journal: OperationJournal; alreadyCurrent: boolean}> {
    const migrationRoot = options.migrationRoot ?? root;
    let next = migrationRoot === root
        ? journal
        : await updateOperation(journal, journal.phase, {migrationRoot});
    const runId = journal.id;
    const plan = await planApplicationStateMigration(
        root,
        manifest,
        runId,
        options.planRoot ?? root,
        options.composePath,
        options.containerStateRoot,
    );
    if (plan.status === "planned") {
        next = await updateOperation(next, next.phase, {
            applicationStateMigration: {
                runId: plan.runId,
                state: "planned",
            },
        });
    }
    return {journal: next, alreadyCurrent: plan.status === "already_current"};
}

/** 只消费 Journal 中已规划的 runId；不得在副作用阶段重新选择 migration run。 */
export async function applyJournaledApplicationMigrations(
    root: string,
    manifest: InstallationManifest,
    journal: OperationJournal,
    applicationRoot = journal.migrationRoot ?? root,
): Promise<OperationJournal> {
    if (!journal.applicationStateMigration) return journal;
    if (journal.applicationStateMigration.state !== "planned") {
        throw new Error(`Application State migration 状态无法 apply：${journal.applicationStateMigration.state}`);
    }
    const applying = await updateOperation(journal, journal.phase, {
        applicationStateMigration: {
            ...journal.applicationStateMigration,
            state: "applying",
        },
    });
    const runId = journal.applicationStateMigration.runId;
    await applyApplicationStateMigration(root, manifest, runId, applicationRoot);
    return updateOperation(applying, applying.phase, {
        applicationStateMigration: {
            ...applying.applicationStateMigration!,
            state: "applied",
        },
    });
}

/**
 * 在创建 Operation Journal 前证明服务状态。
 *
 * native 端口被占用时必须零写入失败；Container 返回只读 inspection，后续由
 * Journal 记录原状态并决定是否需要停止受管容器。
 */
export async function inspectApplicationService(
    root: string,
    manifest: InstallationManifest,
    stateRoot: string,
): Promise<ApplicationServiceState> {
    if (manifest.profile !== "ghcr" && manifest.profile !== "source-docker") {
        await assertNativeProductStopped(stateRoot);
        return {kind: "native"};
    }
    if (!manifest.containerEngine) throw new Error(`${manifest.profile} Manifest缺少Container Engine。`);
    return {
        kind: "container",
        inspection: await inspectDockerApplication(manifest.containerEngine, root, stateRoot),
    };
}

/** 在Journal保护下完成服务静止、外层SQLite备份与Product migration apply。 */
export async function prepareJournaledApplicationState(
    root: string,
    manifest: InstallationManifest,
    initialJournal: OperationJournal,
    stateRoot: string,
    service: ApplicationServiceState,
): Promise<OperationJournal> {
    let journal = initialJournal;
    const migrationPlanned = journal.applicationStateMigration?.state === "planned";
    if (service.kind === "container") {
        const previousState = !service.inspection.containerId
            ? "missing" as const
            : service.inspection.status === "running" ? "running" as const : "stopped" as const;
        const composeEffect = {
            kind: "compose" as const,
            owner: "compose" as const,
            previousState,
            stopped: false,
            created: false,
            previousImage: service.inspection.configuredImage,
            targetImage: service.inspection.configuredImage,
        };
        journal = await setOperationEffect(journal, {...composeEffect, state: "planned"});
        if (migrationPlanned && previousState === "running") {
            await stopDocker(manifest.containerEngine as NonNullable<InstallationManifest["containerEngine"]>, root, stateRoot);
        }
        journal = await setOperationEffect(journal, {
            ...composeEffect,
            state: "applied",
            stopped: migrationPlanned && previousState === "running",
        });
    }
    if (migrationPlanned) journal = await backupJournaledApplicationDatabase(journal, stateRoot);
    return journal;
}

/** checkpoint并备份App SQLite，且在每个物理动作前后持久化同一个Effect。 */
export async function backupJournaledApplicationDatabase(
    initialJournal: OperationJournal,
    stateRoot: string,
): Promise<OperationJournal> {
    let journal = initialJournal;
    const database = await backupApplicationDatabase(stateRoot, journal.backupRoot, async (intent) => {
        journal = await setOperationEffect(journal, {
            kind: "sqlite-backup",
            state: "planned",
            owner: "app-sqlite",
            configuredUrl: intent.configuredUrl,
            stateRoot: intent.stateRoot,
            hostPath: intent.databasePath,
            backupPath: intent.backupPath,
            checkpoint: {busy: 0, log: -1, checkpointed: -1},
        });
    });
    if (!database) return journal;
    return setOperationEffect(journal, {
        kind: "sqlite-backup",
        state: "applied",
        owner: "app-sqlite",
        configuredUrl: database.configuredUrl,
        stateRoot,
        hostPath: database.databasePath,
        backupPath: database.backupPath,
        checkpoint: database.checkpoint,
    });
}

/**
 * 对组件身份完全相同的安装执行当前 Product migration plan。
 *
 * 调用方必须已持有 InstallationMutation lease；already_current 不创建 Journal，planned 才进入完整
 * 停机、备份、迁移、健康检查与提交事务。
 */
export async function migrateCurrentApplicationState(
    root: string,
    manifest: InstallationManifest,
): Promise<boolean> {
    const paths = installationPaths(root, manifest.roots);
    const id = randomUUID();
    const plan = await planApplicationStateMigration(paths.root, manifest, id);
    if (plan.status === "already_current") return false;
    const service = await inspectApplicationService(paths.root, manifest, paths.state);
    let journal = await createOperation({
        id,
        action: "update",
        root: paths.root,
        containerEngine: manifest.containerEngine,
        backupRoot: join(paths.backups, id),
        previousManifest: manifest,
        nextManifest: manifest,
        applicationStateMigration: {runId: plan.runId, state: "planned"},
    });
    let launch: Awaited<ReturnType<typeof launchApplication>> | null = null;
    try {
        journal = await prepareJournaledApplicationState(paths.root, manifest, journal, paths.state, service);
        journal = await applyJournaledApplicationMigrations(paths.root, manifest, journal);
        journal = await updateOperation(journal, "migrated");
        launch = await launchApplication(paths.root, manifest, {
            onContainerStarting: async () => {
                journal = await prepareCandidateContainer(journal);
            },
            onContainerStarted: async (containerId) => {
                journal = await recordCandidateContainer(journal, containerId, false);
            },
            onContainerStopped: async (containerId) => {
                journal = await recordCandidateContainer(journal, containerId, true);
            },
        });
        await launch.ready;
        const keepRunning = service.kind === "container" && service.inspection.status === "running";
        if (!keepRunning) {
            await launch.shutdown();
            assertProductExit(await launch.completion, "NeuroBook 服务退出");
            launch = null;
        }
        journal = await updateOperation(journal, "healthy");
        await commitOperation(journal);
        return true;
    } catch (error) {
        if (launch) await terminateFailedLaunch(launch, error);
        await recoverFailedOperation(paths.root, error);
        throw error;
    }
}

/**
 * 恢复未完成操作并以maintenance journal执行启动前迁移，随后在锁外前台启动应用。
 * start不得直接改写Attachment session，否则崩溃时没有可恢复的runId与状态。
 */
export async function startInstallationApplication(
    root: string,
    options: StartApplicationOptions = {},
): Promise<void> {
    const launchResult: {launch?: Awaited<ReturnType<typeof launchApplication>>} = {};
    await mutateInstallation(root, async (mutation) => {
        const paths = installationPaths(mutation.root, mutation.manifest.roots);
        const activeManifest = mutation.manifest;
        if (options.healthCheck === false && activeManifest.profile !== "windows-portable") {
            throw new Error("--no-health-check仅支持Windows Portable。");
        }
        assertInstallationHostCompatible(activeManifest);
        const id = randomUUID();
        const plan = await planApplicationStateMigration(paths.root, activeManifest, id);
        if (options.healthCheck === false && plan.status !== "already_current") {
            throw new Error("Windows Portable 存在待执行迁移时不能使用 --no-health-check。");
        }
        const stateRoot = installationPaths(paths.root, activeManifest.roots).state;
        const service = await inspectApplicationService(paths.root, activeManifest, stateRoot);
        let journal = await createOperation({
            id,
            action: "start",
            root: paths.root,
            containerEngine: activeManifest.containerEngine,
            backupRoot: join(paths.backups, id),
            previousManifest: activeManifest,
            nextManifest: activeManifest,
            ...(plan.status === "planned" ? {
                applicationStateMigration: {runId: plan.runId, state: "planned" as const},
            } : {}),
        });
        let launch: Awaited<ReturnType<typeof launchApplication>> | null = null;
        try {
            await ensureStateFiles(stateRoot, 3000, activeManifest.profile !== "windows-portable");
            journal = await prepareJournaledApplicationState(paths.root, activeManifest, journal, stateRoot, service);
            journal = await applyJournaledApplicationMigrations(paths.root, activeManifest, journal);
            journal = await updateOperation(journal, "migrated");
            launch = await launchApplication(paths.root, activeManifest, {
                ...options,
                openBrowser: options.openBrowser ?? true,
                onContainerStarting: async () => {
                    journal = await prepareCandidateContainer(journal);
                },
                onContainerStarted: async (containerId) => {
                    journal = await recordCandidateContainer(journal, containerId, false);
                },
                onContainerStopped: async (containerId) => {
                    journal = await recordCandidateContainer(journal, containerId, true);
                },
            });
            await launch.ready;
            await options.onReady?.({
                port: launch.port,
                ...(launch.startupNonce ? {startupNonce: launch.startupNonce} : {}),
            });
            journal = await updateOperation(journal, "healthy");
            await commitOperation(journal);
            launchResult.launch = launch;
        } catch (error) {
            if (launch) await terminateFailedLaunch(launch, error);
            await recoverFailedOperation(paths.root, error);
            throw error;
        }
    });
    if (!launchResult.launch) throw new Error("Application launch 未建立 completion ownership。");
    const launch = launchResult.launch;
    let rejectShutdown!: (error: unknown) => void;
    const shutdownFailure = new Promise<never>((_resolvePromise, rejectPromise) => {
        rejectShutdown = rejectPromise;
    });
    /** Windows 不会把对子进程的 SIGTERM 转成 JS signal；Manager 必须主动请求 Product 控制面。 */
    const shutdownOnSignal = (): void => {
        void launch.shutdown().catch(rejectShutdown);
    };
    const shutdownOnHost = (): void => {
        void launch.shutdown().catch(rejectShutdown);
    };
    process.on("SIGINT", shutdownOnSignal);
    process.on("SIGTERM", shutdownOnSignal);
    options.shutdownSignal?.addEventListener("abort", shutdownOnHost, {once: true});
    if (options.shutdownSignal?.aborted) shutdownOnHost();
    let result: {code: number | null; signal: string | null};
    try {
        result = await Promise.race([launch.completion, shutdownFailure]);
    } finally {
        process.removeListener("SIGINT", shutdownOnSignal);
        process.removeListener("SIGTERM", shutdownOnSignal);
        options.shutdownSignal?.removeEventListener("abort", shutdownOnHost);
    }
    assertProductExit(result, "NeuroBook 服务退出");
}
