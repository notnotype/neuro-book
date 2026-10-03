/**
 * 逐记录文件的读取、原子替换与原件隔离。
 *
 * 写入顺序固定为“同目录唯一临时文件 → 确认 → 原子替换”，因此读取方只会看到完整旧记录或完整新记录。
 * Windows 上杀毒、索引或外部句柄会让 rename 短暂失败，这里只对可恢复的占用错误做有界重试；
 * 重试用尽后原始记录保持不动，临时文件由本模块清理。
 */

import {createHash, randomUUID} from "node:crypto";
import {constants} from "node:fs";
import {lstat, mkdir, open, readdir, rename, rm, unlink} from "node:fs/promises";
import path from "node:path";
import {isStorageDomainError, StorageIoError} from "nbook/shared/storage/storage-errors";
import {STORAGE_TEMP_FILE_SUFFIX, isStorageTempFileName} from "nbook/server/storage/record-codec";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";

/** 可恢复的替换占用错误；其他失败立即上抛，不做等待。 */
const RETRYABLE_REPLACE_ERRORS: Record<string, true> = {EPERM: true, EACCES: true, EBUSY: true};

/** 替换重试等待序列；总等待约 400ms，之后报告明确失败。 */
export const STORAGE_REPLACE_RETRY_DELAYS_MS: readonly number[] = [15, 40, 100, 250];

/** 外部 rename 依赖的最小适配器；测试用它注入确定性替换故障。 */
export type StorageReplaceAdapter = {
    replace(source: string, target: string): Promise<void>;
};

export type StorageRecordFileOptions = {
    readonly replace?: StorageReplaceAdapter;
    readonly retryDelaysMs?: readonly number[];
    /** 每次副作用前重新确认锁与目标归属，重试等待之后也必须检查。 */
    readonly beforeWrite?: () => void | Promise<void>;
};

/** 记录文件读取结果；`unreadable` 表示路径存在但不是普通文件，`oversized` 表示超出该定义的读取上限。 */
export type StorageRecordReadOutcome =
    | {readonly kind: "text"; readonly raw: string; readonly content: Buffer; readonly bytes: number; readonly fingerprint: string}
    | {readonly kind: "missing"}
    | {readonly kind: "unreadable"; readonly diagnosis: string}
    | {readonly kind: "oversized"; readonly bytes: number; readonly fingerprint: string};

/**
 * 读取记录文件；缺失、不可读形态、超限体积与其他 I/O 失败必须分开。
 *
 * 指纹按文件原始字节计算，因此修复凭据绑定的是磁盘事实，而不是解码后再编码的文本。
 * 超出上限的文件只做流式摘要，不整份读进内存。
 */
export async function readStorageRecordFile(target: AbsoluteFsPath, maxBytes: number): Promise<StorageRecordReadOutcome> {
    let stats;
    try {
        stats = await lstat(target);
    } catch (error) {
        if (nodeErrorCode(error) === "ENOENT") {
            return {kind: "missing"};
        }
        throw new StorageIoError("stat", target, describe(error), {cause: error});
    }
    if (stats.isSymbolicLink()) {
        return {kind: "unreadable", diagnosis: "记录路径是符号链接，拒绝跟随读写"};
    }
    if (!stats.isFile()) {
        return {kind: "unreadable", diagnosis: "记录路径不是普通文件"};
    }
    try {
        const handle = await open(target, constants.O_RDONLY | (process.platform === "win32" ? 0 : constants.O_NOFOLLOW));
        try {
            const opened = await handle.stat();
            const current = await lstat(target);
            if (!opened.isFile() || current.isSymbolicLink() || opened.dev !== current.dev || opened.ino !== current.ino) {
                throw new Error("打开的记录与声明路径身份不一致");
            }
            const oversized = opened.size > maxBytes;
            const chunks: Buffer[] = [];
            const hash = createHash("sha256");
            const chunk = Buffer.alloc(Math.max(1, Math.min(64 * 1024, opened.size)));
            let bytes = 0;
            // 只读打开时的有限长度：原地增长既不能扩大内存，也不能让读取永不结束。
            while (bytes < opened.size) {
                const {bytesRead} = await handle.read(chunk, 0, Math.min(chunk.length, opened.size - bytes), bytes);
                if (bytesRead === 0) throw new Error("读取期间记录被截断");
                const part = chunk.subarray(0, bytesRead);
                hash.update(part);
                if (!oversized) chunks.push(Buffer.from(part));
                bytes += bytesRead;
            }
            const after = await handle.stat();
            if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) throw new Error("读取期间记录被原地改写，请重读");
            const fingerprint = `sha256:${hash.digest("hex")}`;
            if (oversized) return {kind: "oversized", bytes, fingerprint};
            const content = Buffer.concat(chunks, bytes);
            return {kind: "text", raw: content.toString("utf8"), content, bytes, fingerprint};
        } finally {
            await handle.close();
        }
    } catch (error) {
        throw new StorageIoError("read", target, describe(error), {cause: error});
    }
}

/** 原子替换记录文件；失败不触碰有效原件，并清理本次临时文件。 */
export async function writeStorageRecordFile(
    input: {
        readonly target: AbsoluteFsPath;
        readonly content: string;
    } & StorageRecordFileOptions,
): Promise<void> {
    const tempPath = `${input.target}.${randomUUID()}${STORAGE_TEMP_FILE_SUFFIX}`;
    try {
        await input.beforeWrite?.();
        await mkdir(path.dirname(input.target), {recursive: true});
        await input.beforeWrite?.();
        const handle = await open(tempPath, "wx");
        try {
            await input.beforeWrite?.();
            await handle.writeFile(input.content, "utf8");
            await handle.sync();
        } finally {
            await handle.close();
        }
    } catch (error) {
        await rm(tempPath, {force: true}).catch(() => undefined);
        if (isStorageDomainError(error)) {
            throw error;
        }
        throw new StorageIoError("write", input.target, describe(error), {cause: error});
    }
    const replace = input.replace?.replace ?? rename;
    const delays = input.retryDelaysMs ?? STORAGE_REPLACE_RETRY_DELAYS_MS;
    try {
        for (let attempt = 0; ; attempt += 1) {
            try {
                await input.beforeWrite?.();
                await replace(tempPath, input.target);
                return;
            } catch (error) {
                const code = nodeErrorCode(error);
                if (attempt >= delays.length || code === null || RETRYABLE_REPLACE_ERRORS[code] !== true) {
                    throw error;
                }
                await new Promise<void>((resolve) => setTimeout(resolve, delays[attempt]));
            }
        }
    } catch (error) {
        await rm(tempPath, {force: true}).catch(() => undefined);
        if (isStorageDomainError(error)) throw error;
        throw new StorageIoError("replace", input.target, describe(error), {cause: error});
    }
}

/** 删除记录文件；缺失视为已达成。 */
export async function removeStorageRecordFile(target: AbsoluteFsPath): Promise<void> {
    try {
        await unlink(target);
    } catch (error) {
        if (nodeErrorCode(error) === "ENOENT") {
            return;
        }
        throw new StorageIoError("remove", target, describe(error), {cause: error});
    }
}

/**
 * 在独立有界诊断区保留原始字节；无法保留时拒绝修复，原记录继续受到保护。
 */
export async function quarantineStorageRecord(
    input: {
        readonly target: AbsoluteFsPath;
        readonly quarantineDirectory: AbsoluteFsPath;
        readonly fingerprint: string;
        readonly maxCopyBytes: number;
    } & StorageRecordFileOptions,
): Promise<{readonly path: AbsoluteFsPath}> {
    const suffix = input.fingerprint.startsWith("sha256:") ? input.fingerprint.slice("sha256:".length) : input.fingerprint;
    const recordName = path.basename(input.target);
    const quarantinePath = absoluteFsPath(path.join(input.quarantineDirectory, `${recordName}.${suffix}.corrupt`));
    const source = await readStorageRecordFile(input.target, input.maxCopyBytes);
    if (source.kind !== "text" || source.fingerprint !== input.fingerprint) {
        throw new StorageIoError("read", input.target, "原件不是内容匹配的有界普通文件");
    }
    try {
        await input.beforeWrite?.();
        await mkdir(input.quarantineDirectory, {recursive: true});
        await sweepStorageTempFiles(input.quarantineDirectory, input.beforeWrite);
        const previous = await readdir(input.quarantineDirectory, {withFileTypes: true});
        if (previous.some((entry) => entry.name === path.basename(quarantinePath))) {
            const backup = await readStorageRecordFile(quarantinePath, input.maxCopyBytes);
            if (backup.kind !== "text" || backup.fingerprint !== input.fingerprint) {
                throw new Error("已有诊断原件无法核验");
            }
            return {path: quarantinePath};
        }
        let totalBytes = 0;
        for (const entry of previous) {
            if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("诊断目录包含非普通文件");
            totalBytes += (await lstat(path.join(input.quarantineDirectory, entry.name))).size;
        }
        if (previous.length >= 1024 || totalBytes + source.bytes > 16 * 1024 * 1024) {
            throw new Error("诊断原件保留容量已满");
        }
    } catch (error) {
        if (isStorageDomainError(error)) throw error;
        throw new StorageIoError("write", input.target, describe(error), {cause: error});
    }
    const tempPath = `${quarantinePath}.${randomUUID()}${STORAGE_TEMP_FILE_SUFFIX}`;
    try {
        await input.beforeWrite?.();
        const handle = await open(tempPath, "wx");
        try {
            await input.beforeWrite?.();
            await handle.writeFile(source.content);
            await handle.sync();
        } finally { await handle.close(); }
        await input.beforeWrite?.();
        await rename(tempPath, quarantinePath);
    } catch (error) {
        await rm(tempPath, {force: true}).catch(() => undefined);
        if (isStorageDomainError(error)) throw error;
        throw new StorageIoError("read", input.target, describe(error), {cause: error});
    }
    return {path: quarantinePath};
}

/** 清理崩溃残留的临时文件；调用方必须已持有分区锁，避免删除并发写入者的临时件。 */
export async function sweepStorageTempFiles(recordsDirectory: AbsoluteFsPath, beforeWrite?: () => void | Promise<void>): Promise<number> {
    const entries = await readdir(recordsDirectory, {withFileTypes: true}).catch((error: unknown) => {
        if (nodeErrorCode(error) === "ENOENT") {
            return [];
        }
        throw new StorageIoError("read", recordsDirectory, describe(error), {cause: error});
    });
    let removed = 0;
    for (const entry of entries) {
        if (!entry.isFile() || !isStorageTempFileName(entry.name)) {
            continue;
        }
        await beforeWrite?.();
        await removeStorageRecordFile(absoluteFsPath(path.join(recordsDirectory, entry.name)));
        removed += 1;
    }
    return removed;
}

/** 读取 Node 文件系统错误的稳定 code；未知形态返回 null。 */
export function nodeErrorCode(error: unknown): string | null {
    return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
        ? error.code
        : null;
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
