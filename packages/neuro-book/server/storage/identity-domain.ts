/**
 * data 身份域元数据。
 *
 * 身份域与 data 一起备份恢复：独立初始化的 data 得到不同身份域，因此同名主体、同名 Project
 * 不会自动认领对方的记录。创建受锁保护，且只在宿主显式初始化时发生——读取缺失记录不会写任何文件。
 */

import {randomUUID} from "node:crypto";
import {mkdir, realpath} from "node:fs/promises";
import {isSafeStorageIdentifier} from "nbook/shared/storage/definition";
import {
    StorageIdentityInvalidError,
    StorageIoError,
    StorageLockUnavailableError,
} from "nbook/shared/storage/storage-errors";
import {readStorageRecordFile, writeStorageRecordFile} from "nbook/server/storage/record-file";
import {storageIdentityFilePath, storageIdentityLockPath, captureStorageRootIdentity, assertStorageRootIdentity, assertStorageTargetContained} from "nbook/server/storage/storage-address";
import {StoragePartitionLock, type StorageLockAdapter} from "nbook/server/storage/partition-lock";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";

/** 身份域元数据的封装标识。 */
export const STORAGE_IDENTITY_SCHEMA = "nbook.storage-identity/v1" as const;

export type StorageIdentityDomain = {
    readonly identityDomain: string;
    /** true 表示本次调用创建了身份域；重启后或并发调用返回 false。 */
    readonly created: boolean;
};

export type EnsureStorageIdentityOptions = {
    /** 锁适配器；测试用它注入确定性竞争故障。 */
    readonly lockAdapter?: StorageLockAdapter;
};

/** 读取或创建存储根的身份域；并发初始化受锁保护并返回同一身份域。 */
export async function ensureStorageIdentityDomain(
    storageRoot: AbsoluteFsPath,
    options: EnsureStorageIdentityOptions = {},
): Promise<StorageIdentityDomain> {
    try {
        await mkdir(storageRoot, {recursive: true});
    } catch (error) {
        throw new StorageIoError("mkdir", storageRoot, describe(error), {cause: error});
    }
    const root = absoluteFsPath(await realpath(storageRoot));
    const rootIdentity = await captureStorageRootIdentity(root);
    const identityPath = storageIdentityFilePath(root);
    await assertStorageTargetContained(root, identityPath);
    const existing = await readIdentityDomain(identityPath);
    if (existing !== null) {
        return {identityDomain: existing, created: false};
    }
    const handle = await new StoragePartitionLock(root, {adapter: options.lockAdapter, rootIdentity})
        .acquire(storageIdentityLockPath(root));
    let result: StorageIdentityDomain;
    let committed = false;
    try {
        handle.assertHealthy();
        await assertStorageRootIdentity(root, rootIdentity);
        await assertStorageTargetContained(root, identityPath);
        const underLock = await readIdentityDomain(identityPath);
        if (underLock !== null) {
            result = {identityDomain: underLock, created: false};
        } else {
            const identityDomain = randomUUID();
            await writeStorageRecordFile({
                target: identityPath,
                content: `${JSON.stringify({schema: STORAGE_IDENTITY_SCHEMA, identityDomain})}\n`,
                beforeWrite: async () => {
                    await assertStorageRootIdentity(root, rootIdentity);
                    await assertStorageTargetContained(root, identityPath);
                    handle.assertHealthy();
                },
            });
            committed = true;
            handle.assertHealthy();
            result = {identityDomain, created: true};
        }
    } catch (error) {
        // 动作失败优先报告；释放未确认只影响锁卫生，由 stale 协议在过期后接管。
        await handle.release().catch(() => undefined);
        if (error instanceof StorageLockUnavailableError) throw new StorageLockUnavailableError(error.reason, committed, {cause: error});
        throw error;
    }
    const releaseFailure = await handle.release().then(() => null, (error: unknown) => error);
    if (releaseFailure !== null) {
        throw new StorageLockUnavailableError("release", committed, {cause: releaseFailure});
    }
    return result;
}

/** 读取身份域元数据；缺失返回 null，损坏或版本不支持必须与缺失区分。 */
async function readIdentityDomain(identityPath: AbsoluteFsPath): Promise<string | null> {
    const outcome = await readStorageRecordFile(identityPath, 64 * 1024);
    if (outcome.kind === "missing") {
        return null;
    }
    if (outcome.kind === "unreadable") {
        throw new StorageIdentityInvalidError(outcome.diagnosis);
    }
    if (outcome.kind === "oversized") {
        throw new StorageIdentityInvalidError("身份域元数据超过读取上限");
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(outcome.raw);
    } catch (error) {
        throw new StorageIdentityInvalidError(`身份域元数据不是合法 JSON：${describe(error)}`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new StorageIdentityInvalidError("身份域元数据必须是 JSON 对象");
    }
    const meta = parsed as Record<string, unknown>;
    if (meta.schema !== STORAGE_IDENTITY_SCHEMA) {
        throw new StorageIdentityInvalidError(`身份域元数据封装不受支持：${String(meta.schema)}`);
    }
    const identityDomain = meta.identityDomain;
    if (typeof identityDomain !== "string" || !isSafeStorageIdentifier(identityDomain)) {
        throw new StorageIdentityInvalidError(`身份域标识不是安全逻辑标识：${String(identityDomain)}`);
    }
    return identityDomain;
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
