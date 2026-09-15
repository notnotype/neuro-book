/**
 * Storage 逻辑标识到文件地址的编码与 containment 检查。
 *
 * 调用方永远不传文件路径：owner/key/resource 是注册或声明过的安全逻辑标识，
 * 主体与客户端身份只以不透明摘要落盘。所有实际读写前还要追加真实路径检查，
 * 拒绝用符号链接/目录联接把分区指到存储根之外。
 */

import {createHash} from "node:crypto";
import {lstat} from "node:fs/promises";
import path from "node:path";
import type {StorageAddress, StorageLocality} from "nbook/shared/storage/contract";
import {isSafeStorageIdentifier} from "nbook/shared/storage/definition";
import {
    StorageAddressInvalidError,
    StorageContextInvalidError,
    StorageIoError,
    StoragePathEscapeError,
} from "nbook/shared/storage/storage-errors";
import {
    absoluteFsPath,
    relativeFilePathInside,
    resolveContainedFilePath,
    type AbsoluteFsPath,
} from "nbook/server/runtime/paths/file-path";

/** data 根下的 Storage 目录名；user 位于 WorkspaceRoot，project 位于各 ProjectRoot。 */
export const STORAGE_DIRECTORY_NAME = "storage" as const;

/** 身份域与分区维护文件所在目录；不参与记录容量统计。 */
export const STORAGE_LOCK_DIRECTORY_NAME = ".locks" as const;

export const STORAGE_IDENTITY_FILE_NAME = "identity.json" as const;
export const STORAGE_PARTITION_META_FILE_NAME = "meta.json" as const;
export const STORAGE_RECORDS_DIRECTORY_NAME = "records" as const;
export const STORAGE_QUARANTINE_DIRECTORY_NAME = "quarantine" as const;

/** user scope 的存储根：WorkspaceRoot/.nbook/storage。 */
export function userStorageRootFromWorkspaceRoot(workspaceRoot: AbsoluteFsPath): AbsoluteFsPath {
    return absoluteFsPath(path.join(workspaceRoot, ".nbook", STORAGE_DIRECTORY_NAME));
}

/** project scope 的存储根：ProjectRoot/.nbook/storage。 */
export function projectStorageRootFromProjectRoot(projectRoot: AbsoluteFsPath): AbsoluteFsPath {
    return absoluteFsPath(path.join(projectRoot, ".nbook", STORAGE_DIRECTORY_NAME));
}

/** 一个实际分区（身份域/主体/locality/客户端/owner）的完整地址输入。 */
export type StoragePartitionIdentity = {
    readonly storageRoot: AbsoluteFsPath;
    readonly identityDomain: string;
    readonly subject: string;
    readonly locality: StorageLocality;
    readonly clientId?: string;
    readonly owner: string;
};

/** 宿主提供的身份输入；句柄建立与分区解析共用同一校验。 */
export type StorageIdentityContext = Omit<StoragePartitionIdentity, "storageRoot" | "locality">;

/** 校验宿主核验后的身份输入；非法身份不给可写句柄，也不作为目录名落盘。 */
export function assertStorageIdentityContext(input: StorageIdentityContext): void {
    if (!isSafeStorageIdentifier(input.identityDomain)) {
        throw new StorageContextInvalidError("identity-domain", `Storage 身份域不是安全逻辑标识：${input.identityDomain}`);
    }
    if (!isSafeStorageIdentifier(input.owner)) {
        throw new StorageContextInvalidError("owner", `Storage owner 不是安全逻辑标识：${input.owner}`);
    }
    assertStorageIdentityValue("subject", input.subject);
    if (input.clientId !== undefined) {
        assertStorageIdentityValue("client", input.clientId);
    }
}

/** 分区目录、记录目录、维护文件与分区锁的绝对地址。 */
export type StoragePartitionPaths = {
    readonly root: AbsoluteFsPath;
    readonly relative: string;
    readonly directory: AbsoluteFsPath;
    readonly recordsDirectory: AbsoluteFsPath;
    readonly quarantineDirectory: AbsoluteFsPath;
    readonly metaPath: AbsoluteFsPath;
    readonly lockPath: AbsoluteFsPath;
};

/** 主体与客户端分区标识只保存不透明摘要，避免把身份或浏览器标识写成目录名。 */
export function storagePartitionDigest(kind: "subject" | "client", value: string): string {
    return createHash("sha256").update(kind).update("\u0000").update(value).digest("hex").slice(0, 32);
}

/** 计算分区相对路径；所有段都是安全逻辑标识或不透明摘要。 */
export function storagePartitionRelativePath(identity: StoragePartitionIdentity): string {
    return storagePartitionSegments(identity).join("/");
}

/** 解析分区地址；`local` 缺少客户端上下文时直接失败，不落到共享分区。 */
export function storagePartitionPaths(identity: StoragePartitionIdentity): StoragePartitionPaths {
    const segments = storagePartitionSegments(identity);
    const relative = segments.join("/");
    const directory = resolveContainedFilePath(identity.storageRoot, segments.join(path.sep));
    return {
        root: identity.storageRoot,
        relative,
        directory,
        recordsDirectory: absoluteFsPath(path.join(directory, STORAGE_RECORDS_DIRECTORY_NAME)),
        quarantineDirectory: absoluteFsPath(path.join(directory, STORAGE_QUARANTINE_DIRECTORY_NAME)),
        metaPath: absoluteFsPath(path.join(directory, STORAGE_PARTITION_META_FILE_NAME)),
        lockPath: absoluteFsPath(path.join(
            identity.storageRoot,
            STORAGE_LOCK_DIRECTORY_NAME,
            ...segments.slice(0, -1),
            `${identity.owner}.lock`,
        )),
    };
}

/** 身份域元数据文件；user scope 初始化时创建，随 data 备份恢复。 */
export function storageIdentityFilePath(storageRoot: AbsoluteFsPath): AbsoluteFsPath {
    return absoluteFsPath(path.join(storageRoot, STORAGE_IDENTITY_FILE_NAME));
}

/** 身份域初始化锁；与分区锁分开，避免并发初始化产生两个身份域。 */
export function storageIdentityLockPath(storageRoot: AbsoluteFsPath): AbsoluteFsPath {
    return absoluteFsPath(path.join(storageRoot, STORAGE_LOCK_DIRECTORY_NAME, "identity-domain.lock"));
}

/** 记录文件名：`<key>.json` 或 `<key>~<resource>.json`。 */
export function storageRecordFileName(key: string, resource?: string): string {
    return resource === undefined ? `${key}.json` : `${key}~${resource}.json`;
}

/** 校验记录地址是否与定义声明的寻址方式一致。 */
export function assertStorageRecordAddress(
    definition: {readonly records: "single" | "identified"; readonly key: string},
    address?: StorageAddress,
): string | undefined {
    const resource = address?.resource;
    if (definition.records === "single") {
        if (resource !== undefined) {
            throw new StorageAddressInvalidError("resource", `Storage 单例状态不接受资源标识：${definition.key}`);
        }
        return undefined;
    }
    if (resource === undefined) {
        throw new StorageAddressInvalidError("resource-required", `Storage 资源状态必须给出稳定资源标识：${definition.key}`);
    }
    if (!isSafeStorageIdentifier(resource)) {
        throw new StorageAddressInvalidError("resource", `Storage 资源标识不是安全逻辑标识：${resource}`);
    }
    return resource;
}

/** 校验分区目录的真实路径仍在存储根内；写入与读取前都要调用。 */
export async function assertStoragePartitionContained(partition: StoragePartitionPaths): Promise<void> {
    await assertStorageTargetContained(partition.root, partition.directory);
}

/** 校验已存在目标的真实路径仍在存储根内；用于记录文件与维护文件。 */
export async function assertStorageTargetContained(root: AbsoluteFsPath, target: AbsoluteFsPath): Promise<void> {
    const relative = relativeFilePathInside(root, target);
    if (relative === null) throw new StoragePathEscapeError(target, "逻辑路径不在声明的存储根内");
    try {
        await captureStorageRootIdentity(root);
        let current = root as string;
        for (const segment of relative.split(/[\\/]/u).filter(Boolean)) {
            current = path.join(current, segment);
            const entry = await lstat(current).catch((error: unknown) => {
                if (isMissingPathError(error)) return null;
                throw error;
            });
            if (entry === null) return;
            if (entry.isSymbolicLink()) throw new StoragePathEscapeError(current, "Storage 路径不能经符号链接或目录联接重定向");
        }
    } catch (error) {
        if (error instanceof StoragePathEscapeError || error instanceof StorageIoError) throw error;
        throw containmentFailure(root, relativeFilePathInside(root, target) ?? target, error);
    }
}

/** 句柄绑定打开时的真实目录身份；同路径被重新创建也需要新句柄。 */
export type StorageRootIdentity = {readonly device: bigint; readonly inode: bigint; readonly born: bigint};

export async function captureStorageRootIdentity(root: AbsoluteFsPath): Promise<StorageRootIdentity> {
    try {
        const entry = await lstat(root, {bigint: true});
        if (!entry.isDirectory() || entry.isSymbolicLink()) throw new StoragePathEscapeError(root, "存储根必须是原始真实目录");
        return {device: entry.dev, inode: entry.ino, born: entry.birthtimeNs};
    } catch (error) {
        if (error instanceof StoragePathEscapeError) throw error;
        throw new StorageIoError("stat", root, describe(error), {cause: error});
    }
}

export async function assertStorageRootIdentity(root: AbsoluteFsPath, expected: StorageRootIdentity): Promise<void> {
    const current = await captureStorageRootIdentity(root);
    if (current.device !== expected.device || current.inode !== expected.inode || current.born !== expected.born) {
        throw new StorageIoError("stat", root, "存储根已被替换，旧句柄失效");
    }
}

/** 真实目录身份的稳定摘要；签发声明与打开句柄之间按它比对，相同路径不代表还是同一个目录。 */
export function storageRootIdentityDigest(identity: StorageRootIdentity): string {
    return `${identity.device}:${identity.inode}:${identity.born}`;
}

/** 存储根本身消失属于 I/O 失败；只有真实路径越界才按逃逸报告。 */
function containmentFailure(root: AbsoluteFsPath, label: string, error: unknown): Error {
    if (isMissingPathError(error)) {
        return new StorageIoError("stat", root, describe(error), {cause: error});
    }
    return new StoragePathEscapeError(label, describe(error));
}

function storagePartitionSegments(identity: StoragePartitionIdentity): string[] {
    assertStorageIdentityContext(identity);
    if (identity.locality === "local") {
        if (identity.clientId === undefined) {
            throw new StorageContextInvalidError("client", "Storage local 记录必须绑定客户端上下文，不能用 shared 分区兜底");
        }
        return [
            identity.identityDomain,
            storagePartitionDigest("subject", identity.subject),
            identity.locality,
            storagePartitionDigest("client", identity.clientId),
            identity.owner,
        ];
    }
    return [
        identity.identityDomain,
        storagePartitionDigest("subject", identity.subject),
        identity.locality,
        identity.owner,
    ];
}

/** 主体与客户端标识来自宿主核验结果，只要求非空有界；它们不会被直接用作路径。 */
function assertStorageIdentityValue(kind: "subject" | "client", value: string): void {
    if (value.length === 0 || value.length > 512 || value.includes("\u0000")) {
        throw new StorageContextInvalidError(kind, `Storage ${kind} 标识必须是 1..512 字符且不含空字符`);
    }
}

/** 判断 Node 文件系统错误是否表示路径不存在。 */
function isMissingPathError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
