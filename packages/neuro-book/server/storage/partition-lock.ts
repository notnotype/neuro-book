/**
 * Storage 实际分区的跨进程协作锁。
 *
 * 每个“身份域/主体/locality/客户端/owner”分区一把独立锁，不占用 Project 的 Workspace mutation
 * 或 Occupancy 锁。心跳与过期参数直接复用 Project 协作锁合同，使所有 NeuroBook 进程对 stale
 * 判定一致；竞争做有界等待，锁被判失效后立即停止写入。
 */

import {mkdir} from "node:fs/promises";
import path from "node:path";
import {lock as acquireFileLock, type LockOptions} from "proper-lockfile";
import {
    isStorageDomainError,
    StorageIoError,
    StorageLockUnavailableError,
} from "nbook/shared/storage/storage-errors";
import {assertStorageTargetContained, assertStorageRootIdentity, type StorageRootIdentity} from "nbook/server/storage/storage-address";
import {nodeErrorCode} from "nbook/server/storage/record-file";
import {PROJECT_LOCK_STALE_MS, PROJECT_LOCK_UPDATE_MS} from "nbook/server/workspace-files/project-lock";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";

/** 所有 NeuroBook 进程共享的锁过期参数。 */
export const STORAGE_LOCK_STALE_MS = PROJECT_LOCK_STALE_MS;

/** 所有 NeuroBook 进程共享的锁心跳参数。 */
export const STORAGE_LOCK_UPDATE_MS = PROJECT_LOCK_UPDATE_MS;

/** 分区 mutation 的有界竞争等待；等待期限外报告可重试的占用错误。 */
export const STORAGE_LOCK_RETRIES: NonNullable<LockOptions["retries"]> = {
    retries: 30,
    factor: 1.5,
    minTimeout: 15,
    maxTimeout: 200,
    randomize: true,
};

/** 分区锁只接受 NeuroBook 冻结的 proper-lockfile 参数。 */
export type StorageLockAcquireOptions = {
    readonly lockfilePath: string;
    readonly realpath: false;
    readonly stale: number;
    readonly update: number;
    readonly retries: NonNullable<LockOptions["retries"]>;
    readonly onCompromised: (error: Error) => void;
};

/** 分区锁对外部 proper-lockfile 依赖的最小 Adapter。 */
export type StorageLockAdapter = {
    acquire(file: string, options: StorageLockAcquireOptions): Promise<() => Promise<void>>;
};

/** 分区锁 handle；释放成功幂等，失败缓存同一个错误且不再触碰旧 closure。 */
export type StorageLockHandle = {
    /** 锁心跳失效或被接管时抛出，供调用方在写入前后 fail closed。 */
    assertHealthy(): void;
    release(): Promise<void>;
};

const properLockfileAdapter: StorageLockAdapter = {
    acquire: acquireFileLock,
};

export type StoragePartitionLockOptions = {
    readonly adapter?: StorageLockAdapter;
    readonly rootIdentity?: StorageRootIdentity;
};

/** 一个存储根下的分区锁 Module；锁文件位于该根的 `.locks` 下。 */
export class StoragePartitionLock {
    private readonly root: AbsoluteFsPath;
    private readonly adapter: StorageLockAdapter;
    private readonly rootIdentity: StorageRootIdentity | undefined;

    constructor(root: AbsoluteFsPath, options: StoragePartitionLockOptions = {}) {
        this.root = root;
        this.adapter = options.adapter ?? properLockfileAdapter;
        this.rootIdentity = options.rootIdentity;
    }

    /** 取得分区锁；竞争超时、被接管或释放未确认都以稳定错误收口。 */
    async acquire(lockPath: AbsoluteFsPath): Promise<StorageLockHandle> {
        if (this.rootIdentity !== undefined) await assertStorageRootIdentity(this.root, this.rootIdentity);
        await assertStorageTargetContained(this.root, lockPath);
        try {
            await mkdir(path.dirname(lockPath), {recursive: true});
        } catch (error) {
            throw new StorageIoError("mkdir", lockPath, describe(error), {cause: error});
        }
        let compromised: StorageLockUnavailableError | null = null;
        let releaseLock: () => Promise<void>;
        try {
            if (this.rootIdentity !== undefined) await assertStorageRootIdentity(this.root, this.rootIdentity);
            await assertStorageTargetContained(this.root, lockPath);
            releaseLock = await this.adapter.acquire(lockPath, {
                lockfilePath: lockPath,
                realpath: false,
                stale: STORAGE_LOCK_STALE_MS,
                update: STORAGE_LOCK_UPDATE_MS,
                retries: STORAGE_LOCK_RETRIES,
                onCompromised: (error) => {
                    compromised ??= new StorageLockUnavailableError("compromised", false, {cause: error});
                },
            });
        } catch (error) {
            if (nodeErrorCode(error) === "ELOCKED") {
                throw new StorageLockUnavailableError("contended", false, {cause: error});
            }
            if (isStorageDomainError(error)) {
                throw error;
            }
            throw new StorageIoError("mkdir", lockPath, describe(error), {cause: error});
        }
        let releasePromise: Promise<void> | null = null;
        return {
            assertHealthy: () => {
                if (compromised !== null) {
                    throw compromised;
                }
            },
            // proper-lockfile 释放后会把 handle 标为已释放，重复调用旧 closure 只会得到 ERELEASED，
            // 因此这里缓存首次结果：成功幂等，失败重复返回同一个错误。
            release: () => {
                releasePromise ??= releaseLock().catch((error: unknown) => {
                    throw new StorageLockUnavailableError("release", false, {cause: error});
                });
                return releasePromise;
            },
        };
    }
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
