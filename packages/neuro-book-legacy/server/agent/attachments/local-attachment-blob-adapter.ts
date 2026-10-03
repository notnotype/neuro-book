import {randomUUID} from "node:crypto";
import {link, lstat, mkdir, open, readFile, rm} from "node:fs/promises";
import {basename, dirname, join} from "node:path";
import {AttachmentError, isAttachmentError, type AttachmentBlobAdapter} from "nbook/server/agent/attachments/types";
import {absoluteFsPath, relativeFilePathInside, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";

const SAFE_KEY_SEGMENT = /^[a-zA-Z0-9._-]+$/;

/** 将 Attachment blob 保存到 Workspace Root 下的本地文件 Adapter。 */
export class LocalAttachmentBlobAdapter implements AttachmentBlobAdapter {
    private readonly writeLocks = new Map<string, Promise<void>>();
    private readonly root: AbsoluteFsPath;

    constructor(root: string) {
        this.root = absoluteFsPath(root);
    }

    /**
     * 原子、幂等发布 opaque key 对应的 bytes。
     *
     * 同 key 并发在进程内串行；跨进程发布冲突必须验证目标内容后才能视为成功。
     */
    async put(key: string, bytes: Uint8Array): Promise<void> {
        const path = this.path(key);
        await this.withKeyLock(key, async () => {
            try {
                await mkdir(this.root, {recursive: true});
                await this.assertStorePath(path);
                const existing = await this.read(path);
                if (existing) {
                    this.assertSameBytes(existing, bytes);
                    return;
                }

                const directory = dirname(path);
                await mkdir(directory, {recursive: true});
                await this.assertStorePath(path);
                const tempPath = join(directory, `.${basename(path)}.${String(process.pid)}.${randomUUID()}.tmp`);
                try {
                    const handle = await open(tempPath, "wx");
                    try {
                        await handle.writeFile(bytes);
                        await handle.sync();
                    } finally {
                        await handle.close();
                    }

                    // hard-link 是跨 Windows/POSIX 的原子 no-replace 发布；禁止降级为会覆盖目标的 rename。
                    await this.assertStorePath(path);
                    await link(tempPath, path).catch(async (error: NodeJS.ErrnoException) => {
                        await this.assertStorePath(path);
                        const published = await this.read(path);
                        if (!published) {
                            throw error;
                        }
                        this.assertSameBytes(published, bytes);
                    });

                    await this.assertStorePath(path);
                    const published = await this.read(path);
                    if (!published) {
                        throw new AttachmentError("storage_failed", "Attachment blob 发布后不可读取。");
                    }
                    this.assertSameBytes(published, bytes);
                } finally {
                    await rm(tempPath, {force: true}).catch(() => undefined);
                }
            } catch (error) {
                if (isAttachmentError(error)) {
                    throw error;
                }
                throw new AttachmentError("storage_failed", "Attachment blob 保存失败。", {cause: error});
            }
        });
    }

    /** 读取 opaque key；不存在时返回 null。 */
    async get(key: string): Promise<Uint8Array | null> {
        const path = this.path(key);
        try {
            if (!await this.assertStorePath(path)) {
                return null;
            }
            return await this.read(path);
        } catch (error) {
            if (isAttachmentError(error)) {
                throw error;
            }
            throw new AttachmentError("storage_failed", "Attachment blob 读取失败。", {cause: error});
        }
    }

    /** 将安全的 opaque key 限制在 Adapter root 内。 */
    private path(key: string): AbsoluteFsPath {
        const segments = key.split("/");
        if (segments.length === 0 || segments.some((segment) => !SAFE_KEY_SEGMENT.test(segment) || segment === "." || segment === "..")) {
            throw new AttachmentError("invalid_reference", "Attachment blob key 非法。");
        }
        return absoluteFsPath(join(this.root, ...segments));
    }

    /**
     * 验证Adapter root及目标已有路径段都不是symlink/junction。
     *
     * root不存在时返回false，供get表达not found；put会先创建root。该检查以Adapter
     * root为信任锚，不追溯用户明确提供的Workspace Root父级链接。
     */
    private async assertStorePath(target: AbsoluteFsPath): Promise<boolean> {
        const relativePath = relativeFilePathInside(this.root, target);
        if (!relativePath || relativePath === ".") {
            throw new AttachmentError("invalid_reference", "Attachment blob key 越过存储根。");
        }
        const rootStat = await lstat(this.root).catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") {
                return null;
            }
            throw error;
        });
        if (!rootStat) {
            return false;
        }
        if (rootStat.isSymbolicLink()) {
            throw new AttachmentError("corrupt", "Attachment Store根不能是symlink或junction。");
        }
        let current = this.root;
        for (const segment of relativePath.split("/")) {
            current = absoluteFsPath(join(current, segment));
            const currentStat = await lstat(current).catch((error: NodeJS.ErrnoException) => {
                if (error.code === "ENOENT") {
                    return null;
                }
                throw error;
            });
            if (!currentStat) {
                return true;
            }
            if (currentStat.isSymbolicLink()) {
                throw new AttachmentError("corrupt", "Attachment Store内部不能包含symlink或junction。");
            }
        }
        return true;
    }

    /** 读取本地文件；不存在返回 null，其他错误交给公共边界分类。 */
    private async read(path: string): Promise<Uint8Array | null> {
        return readFile(path).catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") {
                return null;
            }
            throw error;
        });
    }

    /** 已存在目标只有内容完全相同才满足幂等 put。 */
    private assertSameBytes(left: Uint8Array, right: Uint8Array): void {
        if (!sameBytes(left, right)) {
            throw new AttachmentError("corrupt", "Attachment blob 已存在但内容不一致。");
        }
    }

    /** 同 key 写入串行化，最后一个等待者完成后释放 Map 引用。 */
    private async withKeyLock(key: string, action: () => Promise<void>): Promise<void> {
        const previous = this.writeLocks.get(key) ?? Promise.resolve();
        let release: () => void = () => {};
        const current = new Promise<void>((resolve) => {
            release = resolve;
        });
        const tail = previous.then(() => current);
        this.writeLocks.set(key, tail);
        try {
            await previous;
            await action();
        } finally {
            release();
            if (this.writeLocks.get(key) === tail) {
                this.writeLocks.delete(key);
            }
        }
    }
}

/** 比较两个 byte sequence，避免为冲突检查构造额外编码副本。 */
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
