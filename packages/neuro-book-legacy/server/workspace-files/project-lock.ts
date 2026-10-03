import {randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {lock as acquireFileLock, type LockOptions} from "proper-lockfile";
import {
    absoluteFsPath,
    assertRealPathContained,
    type AbsoluteFsPath,
} from "nbook/server/runtime/paths/file-path";
import {
    canonicalProjectLocator,
    projectWorkspaceHash,
    type ProjectWorkspaceRef,
} from "nbook/server/workspace-files/project-identity";
import {
    isProjectDomainError,
    ProjectDomainError,
} from "nbook/server/workspace-files/project-domain-error";

/** 所有 NeuroBook/CLI 进程必须共享的 proper-lockfile stale 参数。 */
export const PROJECT_LOCK_STALE_MS = 30_000;

/** 所有 NeuroBook/CLI 进程必须共享的 proper-lockfile heartbeat 参数。 */
export const PROJECT_LOCK_UPDATE_MS = 10_000;

const MUTATION_RETRIES: NonNullable<LockOptions["retries"]> = {
    retries: 50,
    factor: 1.2,
    minTimeout: 50,
    maxTimeout: 500,
    randomize: true,
};

/** Workspace Root 短时 mutation lock 的 generation-scoped handle。 */
export type WorkspaceMutationHandle = {
    readonly compromised: Promise<ProjectLockCompromisedError>;
    assertHealthy(): void;
    release(): Promise<void>;
};

/** Project open/grace/close 全生命周期持有的 Occupancy handle。 */
export type ProjectOccupancyHandle = {
    readonly compromised: Promise<ProjectLockCompromisedError>;
    assertHealthy(): void;
    release(): Promise<void>;
};

/** Project Lock Adapter 只接受 NeuroBook 冻结的 proper-lockfile 参数。 */
export type ProjectLockAcquireOptions = {
    readonly lockfilePath: string;
    readonly realpath: false;
    readonly stale: number;
    readonly update: number;
    readonly retries: NonNullable<LockOptions["retries"]>;
    readonly onCompromised: (error: Error) => void;
};

/** Project Lock Module 对外部 proper-lockfile 依赖的最小 Adapter。 */
export type ProjectLockAdapter = {
    acquire(file: string, options: ProjectLockAcquireOptions): Promise<() => Promise<void>>;
};

/** Project Lock Module 可注入的外部依赖。 */
export type ProjectLockOptions = {
    readonly adapter?: ProjectLockAdapter;
};

const properLockfileAdapter: ProjectLockAdapter = {
    acquire: acquireFileLock,
};

/** Project 已被另一个 NeuroBook/CLI generation 占用。 */
export class ProjectInUseError extends ProjectDomainError {
    readonly code = "PROJECT_IN_USE";
    readonly statusCode = 409;
    readonly projectRoot: string;
    override readonly cause: unknown;

    /** 把 proper-lockfile ELOCKED 收口为稳定领域错误。 */
    constructor(projectRoot: string, cause: unknown) {
        super("lock-in-use", `Project 正在使用中：${projectRoot}`, {cause});
        this.name = "ProjectInUseError";
        this.projectRoot = projectRoot;
        this.cause = cause;
    }
}

/** HMR 后仍精确识别 Project Occupancy 竞争错误。 */
export function isProjectInUseError(error: unknown): error is ProjectInUseError {
    return isProjectDomainError(error, "lock-in-use");
}

/** proper-lockfile heartbeat 或锁目录完整性已经失效。 */
export class ProjectLockCompromisedError extends ProjectDomainError {
    readonly code = "PROJECT_LOCK_COMPROMISED";
    override readonly cause: unknown;

    /** 保留 proper-lockfile 原始错误，供 ProjectSession 诊断并立即关门。 */
    constructor(message: string, cause: unknown) {
        super("lock-compromised", message, {cause});
        this.name = "ProjectLockCompromisedError";
        this.cause = cause;
    }
}

/** HMR 后仍精确识别已失效的 Project 协作锁。 */
export function isProjectLockCompromisedError(error: unknown): error is ProjectLockCompromisedError {
    return isProjectDomainError(error, "lock-compromised");
}

/** Project 协作锁的稳定种类。 */
export type ProjectLockKind = "workspace-mutation" | "project-occupancy";

/** 构造或重新包装typed release failure所需的最小锁上下文。 */
export type ProjectLockContext =
    | {readonly kind: "workspace-mutation"}
    | {readonly kind: "project-occupancy"; readonly projectRoot: string};

/** proper-lockfile 已无法确认释放完成，旧 release closure 不得再次调用。 */
export class ProjectLockReleaseFailedError extends ProjectDomainError {
    readonly code = "PROJECT_LOCK_RELEASE_FAILED";
    readonly statusCode = 500;
    readonly staleMs = PROJECT_LOCK_STALE_MS;
    readonly kind: ProjectLockKind;
    /** 仅 Occupancy release failure 非空，表示对应的单段 Project root。 */
    readonly projectRoot?: string;
    override readonly cause: unknown;

    /** 把外部 release failure 收口为 terminal typed error。 */
    constructor(
        context: ProjectLockContext,
        cause: unknown,
        projectErrorKind: "lock-release" | "lifecycle-lock-release" = "lock-release",
    ) {
        const subject = context.kind === "project-occupancy"
            ? `Project Occupancy lock（${context.projectRoot}）`
            : "Workspace Root mutation lock";
        super(projectErrorKind, `${subject} 释放失败；必须等待 stale 协议恢复`, {cause});
        this.name = "ProjectLockReleaseFailedError";
        this.kind = context.kind;
        this.projectRoot = context.kind === "project-occupancy" ? context.projectRoot : undefined;
        this.cause = cause;
    }
}

/** Lifecycle release 子类同样属于 Lock release；exact kind 由派生 predicate 继续区分。 */
export function isProjectLockReleaseFailedError(error: unknown): error is ProjectLockReleaseFailedError {
    return isProjectDomainError(error, "lock-release")
        || isProjectDomainError(error, "lifecycle-lock-release");
}

/**
 * Project 协作锁深 Module。
 *
 * mutation lock 只覆盖 create/ensure/delete/import 等短事务；Occupancy lock 从 open 开始持有，
 * 直到全部 Project Module 关闭。调用方需要两把锁时必须固定先 mutation、后 Occupancy。
 */
export class ProjectLockModule {
    private readonly workspaceRoot: AbsoluteFsPath;
    private readonly adapter: ProjectLockAdapter;
    private canonicalWorkspaceRootPromise: Promise<AbsoluteFsPath> | null = null;

    /** 建立一个绑定到单个 Workspace Root 的锁 Module。 */
    constructor(workspaceRoot: AbsoluteFsPath, options: ProjectLockOptions = {}) {
        this.workspaceRoot = workspaceRoot;
        this.adapter = options.adapter ?? properLockfileAdapter;
    }

    /** 获取 Workspace Root 短时 mutation lock；竞争时做有界等待。 */
    async acquireMutation(): Promise<WorkspaceMutationHandle> {
        const lockDirectory = await this.ensureLockDirectory(".nbook/locks");
        const lockPath = path.join(lockDirectory, "workspace-mutation.lock");
        const metadataToken = randomUUID();
        const metadataPath = path.join(lockDirectory, `workspace-mutation.${metadataToken}.metadata.json`);
        const signal = compromiseSignal("Workspace Root mutation lock 已失效");
        const releaseLock = await this.adapter.acquire(this.workspaceRoot, {
            lockfilePath: lockPath,
            realpath: false,
            stale: PROJECT_LOCK_STALE_MS,
            update: PROJECT_LOCK_UPDATE_MS,
            retries: MUTATION_RETRIES,
            onCompromised: signal.notify,
        });
        const release = releaseHandle(
            releaseLock,
            signal,
            {kind: "workspace-mutation"},
            () => removeLockMetadata(metadataPath),
        );
        try {
            await writeLockMetadata(metadataPath, {
                version: 1,
                token: metadataToken,
                pid: process.pid,
                acquiredAt: new Date().toISOString(),
                kind: "workspace-mutation",
            });
        } catch (error) {
            await releaseAfterMetadataFailure(release.release, {kind: "workspace-mutation"}, error);
        }
        return {
            compromised: signal.promise,
            assertHealthy: release.assertHealthy,
            release: release.release,
        };
    }

    /** 获取 per-Project 长期 Occupancy lock；竞争固定 fail-fast，不做 retry。 */
    async acquireOccupancy(ref: ProjectWorkspaceRef): Promise<ProjectOccupancyHandle> {
        const canonicalWorkspaceRoot = await this.canonicalWorkspaceRoot();
        const locator = canonicalProjectLocator(canonicalWorkspaceRoot, ref);
        const lockDirectory = await this.ensureLockDirectory(".nbook/locks/projects");
        const opaqueName = projectWorkspaceHash(canonicalWorkspaceRoot, ref);
        const lockPath = path.join(lockDirectory, `${opaqueName}.lock`);
        const metadataToken = randomUUID();
        const metadataPath = path.join(lockDirectory, `${opaqueName}.${metadataToken}.metadata.json`);
        const signal = compromiseSignal(`Project Occupancy lock 已失效：${ref.projectRoot}`);
        const context: ProjectLockContext = {kind: "project-occupancy", projectRoot: ref.projectRoot};
        let releaseLock: () => Promise<void>;
        try {
            releaseLock = await this.adapter.acquire(locator, {
                lockfilePath: lockPath,
                realpath: false,
                stale: PROJECT_LOCK_STALE_MS,
                update: PROJECT_LOCK_UPDATE_MS,
                retries: 0,
                onCompromised: signal.notify,
            });
        } catch (error) {
            if (errorCode(error) === "ELOCKED") {
                throw new ProjectInUseError(ref.projectRoot, error);
            }
            throw error;
        }
        const release = releaseHandle(
            releaseLock,
            signal,
            context,
            () => removeLockMetadata(metadataPath),
        );
        try {
            await writeLockMetadata(metadataPath, {
                version: 1,
                token: metadataToken,
                pid: process.pid,
                acquiredAt: new Date().toISOString(),
                kind: "project-occupancy",
                projectRoot: ref.projectRoot,
            });
        } catch (error) {
            await releaseAfterMetadataFailure(release.release, context, error);
        }
        return {
            compromised: signal.promise,
            assertHealthy: release.assertHealthy,
            release: release.release,
        };
    }

    /** 创建并验证 lock artifact 目录仍位于当前 Workspace Root 内。 */
    private async ensureLockDirectory(relativePath: string): Promise<AbsoluteFsPath> {
        const lockDirectory = absoluteFsPath(path.join(this.workspaceRoot, relativePath));
        await assertRealPathContained(this.workspaceRoot, lockDirectory);
        await fs.mkdir(lockDirectory, {recursive: true});
        await assertRealPathContained(this.workspaceRoot, lockDirectory);
        return lockDirectory;
    }

    /** 惰性解析 canonical Workspace Root，确保 hash 不依赖输入路径拼写。 */
    private canonicalWorkspaceRoot(): Promise<AbsoluteFsPath> {
        if (!this.canonicalWorkspaceRootPromise) {
            this.canonicalWorkspaceRootPromise = fs.realpath(this.workspaceRoot).then(absoluteFsPath);
        }
        return this.canonicalWorkspaceRootPromise;
    }
}

type CompromiseSignal = {
    readonly promise: Promise<ProjectLockCompromisedError>;
    readonly notify: (error: Error) => void;
    readonly assertHealthy: () => void;
};

/** 建立只 resolve 一次、绝不产生未处理 rejection 的 compromised 信号。 */
function compromiseSignal(message: string): CompromiseSignal {
    let resolvePromise: (error: ProjectLockCompromisedError) => void = () => undefined;
    let failure: ProjectLockCompromisedError | null = null;
    const promise = new Promise<ProjectLockCompromisedError>((resolve) => {
        resolvePromise = resolve;
    });
    return {
        promise,
        notify: (error) => {
            if (failure) {
                return;
            }
            failure = new ProjectLockCompromisedError(message, error);
            resolvePromise(failure);
        },
        assertHealthy: () => {
            if (failure) {
                throw failure;
            }
        },
    };
}

type LockReleaseHandle = {
    readonly assertHealthy: () => void;
    readonly release: () => Promise<void>;
};

/** 把 proper-lockfile release 包装为单次尝试、成功幂等、失败缓存的 handle。 */
function releaseHandle(
    releaseLock: () => Promise<void>,
    signal: CompromiseSignal,
    context: ProjectLockContext,
    afterRelease: () => Promise<void>,
): LockReleaseHandle {
    let releasePromise: Promise<void> | null = null;
    let releaseFailure: ProjectLockReleaseFailedError | null = null;
    return {
        assertHealthy: () => {
            if (releaseFailure) {
                throw releaseFailure;
            }
            signal.assertHealthy();
        },
        release: () => {
            if (releasePromise) {
                return releasePromise;
            }
            releasePromise = (async () => {
                try {
                    await releaseLock();
                } catch (cause) {
                    releaseFailure = new ProjectLockReleaseFailedError(context, cause);
                    throw releaseFailure;
                }
                await afterRelease();
            })();
            return releasePromise;
        },
    };
}

/** metadata写入失败时优先保留锁释放不确定性，同时保留两个原始cause。 */
async function releaseAfterMetadataFailure(
    release: () => Promise<void>,
    context: ProjectLockContext,
    metadataError: unknown,
): Promise<never> {
    try {
        await release();
    } catch (releaseError) {
        const releaseCause = isProjectLockReleaseFailedError(releaseError)
            ? releaseError.cause
            : releaseError;
        throw new ProjectLockReleaseFailedError(
            context,
            new AggregateError(
                [metadataError, releaseCause],
                "写入锁metadata失败且锁释放不完整",
            ),
        );
    }
    throw metadataError;
}

type LockMetadata = {
    readonly version: 1;
    readonly token: string;
    readonly pid: number;
    readonly acquiredAt: string;
    readonly kind: "workspace-mutation" | "project-occupancy";
    /** 仅 Project Occupancy metadata 非空。 */
    readonly projectRoot?: string;
};

/** 原子发布不参与ownership判断的诊断sidecar；proper-lockfile锁目录保持为空。 */
async function writeLockMetadata(metadataPath: string, metadata: LockMetadata): Promise<void> {
    const temporaryPath = `${metadataPath}.tmp`;
    try {
        const handle = await fs.open(temporaryPath, "wx");
        try {
            await handle.writeFile(`${JSON.stringify(metadata)}\n`, "utf8");
            await handle.sync();
        } finally {
            await handle.close();
        }
        await fs.rename(temporaryPath, metadataPath);
    } finally {
        await fs.rm(temporaryPath, {force: true});
    }
}

/** sidecar文件名已包含owner token，因此只删除当前handle自己的精确路径。 */
async function removeLockMetadata(metadataPath: string): Promise<void> {
    try {
        await fs.rm(metadataPath, {force: true});
    } catch {
        // metadata仅用于诊断；锁已成功释放时，sidecar清理失败不能改写ownership结果。
    }
}

/** 读取 Node/proper-lockfile 错误 code。 */
function errorCode(error: unknown): string | null {
    return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
        ? error.code
        : null;
}
