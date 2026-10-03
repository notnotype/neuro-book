/**
 * platform.files 的机制实现：受根约束的读写、目录项操作、变更订阅、协作锁与关闭门禁。
 *
 * 每个操作依次经过：状态与授予门禁（closed/stopping/grant-revoked/permission-denied/cancelled）、
 * 包含校验（目标型解析真实目标、目录项型只解析真实父目录）、操作、身份复核。校验与操作之间
 * 的替换窗口用“操作前后 lstat 复核 + 原子 rename + 创建前后各证明一次父目录包含性”缩小；
 * 可移植 Node API 不具备 openat/O_NOFOLLOW 的原子能力，恶意外部进程的并发替换不在本能力承诺内。
 *
 * 受管句柄（watch、lock）登记在调用方传入的作用域上，服务另跟踪存活集合用于关闭门禁：
 * 进入停止后拒绝新操作与新句柄，等待在途操作结算，仍有未释放句柄即报告关闭未完成。
 */

import type {Dirent, Stats} from "node:fs";
import {lstat, mkdir, open, readFile, readdir, rename as fsRename, rmdir, stat as fsStat, unlink} from "node:fs/promises";
import type {FileHandle} from "node:fs/promises";
import {randomBytes} from "node:crypto";
import path from "node:path";
import {watch as createWatcher} from "chokidar";
import type {FSWatcher} from "chokidar";
import {lock as acquireFileLock} from "proper-lockfile";

import {LifecycleStateError} from "nbook/runtime/lifecycle/lifecycle";
import type {AcquireResult, ReleaseDependency, Scope} from "nbook/runtime/lifecycle/lifecycle";
import {absoluteFsPath, relativeFilePathInside} from "nbook/server/runtime/paths/file-path";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";

import {PlatformFilesError, isPlatformFilesError} from "./contracts";
import type {
    DirectoryEntry,
    EntryKind,
    FileStat,
    LockHandle,
    LockOptions,
    LockState,
    OperationOptions,
    PlatformFiles,
    PlatformFilesErrorCode,
    RemoveOptions,
    ReplaceOptions,
    RootGrant,
    RootOperation,
    WatchEvent,
    WatchHandle,
    WatchOptions,
    WriteOptions,
} from "./contracts";
import {RootGrantAuthority} from "./grants";
import type {GrantRecord} from "./grants";
import {
    assertParentContained,
    assertRelativeAddress,
    entryKindOf,
    invalidPathError,
    ioFailedError,
    nodeErrorCode,
    notFoundError,
    outsideRootError,
    readEntryIdentity,
    resolveContainedTarget,
    resolveEntryTarget,
    sameEntryIdentity,
} from "./paths";
import type {ContainedTargetInput, EntryIdentity, ResolvedTarget} from "./paths";

/** proper-lockfile 内部收紧过的参数下限：stale >= 2000ms、update >= 1000ms 且 <= stale/2。 */
const LOCK_STALE_FLOOR_MS = 2000;
const LOCK_UPDATE_FLOOR_MS = 1000;
const DEFAULT_LOCK_STALE_MS = 10000;

/** 取消后仍能证明“没有产生副作用”的拒绝；其余按结果未知结算。 */
const DEFINITIVE_REJECTIONS: Readonly<Partial<Record<PlatformFilesErrorCode, true>>> = {
    "outside-root": true,
    "invalid-path": true,
    "permission-denied": true,
    "not-found": true,
    "already-exists": true,
    "grant-revoked": true,
    "lock-held": true,
};

/** chokidar 事件名到合同类别的映射；未列出的类别不投递。 */
const WATCH_EVENT_KINDS: Readonly<Record<string, WatchEvent["kind"]>> = {
    add: "add",
    change: "change",
    unlink: "unlink",
    addDir: "addDir",
    unlinkDir: "unlinkDir",
};

type ServiceState = "available" | "stopping" | "closed";

export interface ResolvedRoot {
    readonly id: string;
    /** 激活时已 realpath 的根身份。 */
    readonly realPath: AbsoluteFsPath;
    readonly maxOperations?: ReadonlyArray<RootOperation>;
}

export interface PlatformFilesServiceOptions {
    readonly roots: ReadonlyArray<ResolvedRoot>;
}

interface RootRuntime {
    readonly id: string;
    readonly realPath: AbsoluteFsPath;
    readonly authority: RootGrantAuthority;
}

/** 已授权的一次操作：根、授予的子目录范围与操作集合。 */
interface Authorized {
    readonly root: RootRuntime;
    readonly directory: string;
    readonly grantId: string;
    readonly operations: ReadonlyArray<RootOperation>;
}

/** 受管句柄的登记记录；只用于关闭门禁与诊断，不含内容。 */
interface HandleRecord {
    readonly kind: "watch" | "lock";
    readonly label: string;
}

export class PlatformFilesService implements PlatformFiles {
    readonly #roots = new Map<string, RootRuntime>();
    readonly #handles = new Set<HandleRecord>();
    #state: ServiceState = "available";
    #inFlight = 0;
    #idle = Promise.withResolvers<void>();
    #releasePromise: Promise<void> | null = null;

    constructor(options: PlatformFilesServiceOptions) {
        for (const root of options.roots) {
            this.#roots.set(root.id, {
                id: root.id,
                realPath: root.realPath,
                authority: new RootGrantAuthority(root.id, root.maxOperations ?? ["read", "write", "delete"]),
            });
        }
    }

    /** 激活时签发根级授予；超出根上界或根未登记即拒绝。 */
    issueGrant(rootId: string, operations: ReadonlyArray<RootOperation>): RootGrant {
        const root = this.#roots.get(rootId);
        if (root === undefined) {
            throw new TypeError(`未登记的根：${rootId}`);
        }
        return root.authority.issue(".", operations);
    }

    /**
     * 服务释放：进入停止中、失效全部授予、拒绝新操作与新句柄、等待在途操作结算；
     * 仍有未释放的受管句柄即抛错（关闭未完成，作用域停在停止中，显式恢复会再次调用本方法）。
     */
    close(): Promise<void> {
        const pending = this.#releasePromise;
        if (pending !== null) {
            return pending;
        }
        const attempt = this.#release();
        this.#releasePromise = attempt;
        const settle = (): void => {
            if (this.#releasePromise === attempt) {
                this.#releasePromise = null;
            }
        };
        void attempt.then(settle, settle);
        return attempt;
    }

    async readFile(grant: RootGrant, relativePath: string, options: OperationOptions = {}): Promise<Uint8Array> {
        return this.#perform(grant, ["read"], options.signal, async (authorized) => {
            const target = await this.#target(authorized, relativePath);
            const before = await this.#requireContent(target);
            const data = await this.#readBytes(target);
            await this.#assertUnchanged(target, before);
            return data;
        });
    }

    async readText(grant: RootGrant, relativePath: string, options: OperationOptions = {}): Promise<string> {
        const bytes = await this.readFile(grant, relativePath, options);
        return new TextDecoder().decode(bytes);
    }

    async writeFile(
        grant: RootGrant,
        relativePath: string,
        data: string | Uint8Array,
        options: WriteOptions = {},
    ): Promise<void> {
        return this.#perform(grant, ["write"], options.signal, async (authorized) => {
            const target = await this.#writableTarget(authorized, relativePath);
            const before = await this.#existingContent(target);
            const handle = await this.#openTarget(target, "w");
            try {
                await handle.writeFile(data);
                if (options.flush === true) {
                    await handle.sync();
                }
            } finally {
                await this.#closeHandle(handle);
            }
            await this.#assertWritten(target, before);
        });
    }

    async replaceFile(
        grant: RootGrant,
        relativePath: string,
        data: string | Uint8Array,
        options: ReplaceOptions = {},
    ): Promise<void> {
        return this.#perform(grant, ["write"], options.signal, async (authorized) => {
            const target = await this.#writableTarget(authorized, relativePath);
            const before = await this.#existingContent(target);
            const temporary = this.#temporaryPath(target.absolute);
            await this.#writeTemporary(temporary, data);
            try {
                // 发布前复核包含性：临时文件已就位，仍不接受把校验过的路径交给会跟随已替换链接的操作。
                await assertParentContained(this.#container(authorized, target));
                await fsRename(temporary, target.absolute);
            } catch (error) {
                await this.#removeQuietly(temporary);
                throw this.#fsFailure("发布整文件替换", error);
            }
            if (options.durable === true) {
                await this.#syncDirectory(absoluteFsPath(path.dirname(target.absolute)));
            }
            const after = await readEntryIdentity(target.absolute);
            if (after === null || after.kind === "directory") {
                throw new PlatformFilesError("identity-changed", `替换后目标不是普通文件：${target.relativePath}`);
            }
        });
    }

    async appendFile(
        grant: RootGrant,
        relativePath: string,
        data: string | Uint8Array,
        options: WriteOptions = {},
    ): Promise<void> {
        return this.#perform(grant, ["write"], options.signal, async (authorized) => {
            const target = await this.#writableTarget(authorized, relativePath);
            const before = await this.#existingContent(target);
            const handle = await this.#openTarget(target, "a");
            try {
                // 追加语义由内核的 append 模式保证：显式编码为字节，避免位点语义分叉。
                await handle.write(typeof data === "string" ? new TextEncoder().encode(data) : data);
                if (options.flush === true) {
                    await handle.sync();
                }
            } finally {
                await this.#closeHandle(handle);
            }
            await this.#assertWritten(target, before);
        });
    }

    async stat(grant: RootGrant, relativePath: string, options: OperationOptions = {}): Promise<FileStat> {
        return this.#perform(grant, ["read"], options.signal, async (authorized) => {
            const target = await this.#target(authorized, relativePath);
            const before = await this.#requireIdentity(target, target.relativePath);
            let stats: Stats;
            try {
                stats = await fsStat(target.absolute);
            } catch (error) {
                throw this.#fsFailure("读取目标状态", error);
            }
            await this.#assertUnchanged(target, before);
            return {kind: entryKindOf(stats), size: Number(stats.size), mtimeMs: Number(stats.mtimeMs)};
        });
    }

    async list(grant: RootGrant, relativePath: string, options: OperationOptions = {}): Promise<ReadonlyArray<DirectoryEntry>> {
        return this.#perform(grant, ["read"], options.signal, async (authorized) => {
            const target = await this.#target(authorized, relativePath);
            const before = await this.#requireIdentity(target, target.relativePath);
            if (before.kind !== "directory") {
                throw invalidPathError(`目标不是目录：${target.relativePath}`);
            }
            let entries: Dirent[];
            try {
                entries = await readdir(target.absolute, {withFileTypes: true});
            } catch (error) {
                throw this.#fsFailure("读取目录", error);
            }
            await this.#assertUnchanged(target, before);
            const prefix = target.relativePath === "." ? "" : `${target.relativePath}/`;
            return entries.map((entry) => ({
                name: entry.name,
                relativePath: `${prefix}${entry.name}`,
                kind: direntKind(entry),
            }));
        });
    }

    async createFile(
        grant: RootGrant,
        relativePath: string,
        data: string | Uint8Array,
        options: WriteOptions = {},
    ): Promise<void> {
        return this.#perform(grant, ["write"], options.signal, async (authorized) => {
            const target = await this.#entryTarget(authorized, relativePath);
            await assertParentContained(this.#container(authorized, target));
            let handle: FileHandle;
            try {
                handle = await open(target.absolute, "wx");
            } catch (error) {
                if (nodeErrorCode(error) === "EEXIST") {
                    throw new PlatformFilesError("already-exists", `目标已存在：${target.relativePath}`, {cause: error});
                }
                throw this.#fsFailure("排他创建文件", error);
            }
            try {
                await handle.writeFile(data);
                if (options.flush === true) await handle.sync();
            } finally {
                await this.#closeHandle(handle);
            }
        });
    }

    async createDirectory(grant: RootGrant, relativePath: string, options: OperationOptions = {}): Promise<void> {
        return this.#perform(grant, ["write"], options.signal, async (authorized) => {
            const target = await this.#entryTarget(authorized, relativePath);
            await assertParentContained(this.#container(authorized, target));
            try {
                await mkdir(target.absolute);
            } catch (error) {
                if (nodeErrorCode(error) === "EEXIST") {
                    throw new PlatformFilesError("already-exists", `目标已存在：${target.relativePath}`, {cause: error});
                }
                throw this.#fsFailure("排他创建目录", error);
            }
        });
    }

    async mkdir(grant: RootGrant, relativePath: string, options: OperationOptions = {}): Promise<void> {
        return this.#perform(grant, ["write"], options.signal, async (authorized) => {
            const target = await this.#writableTarget(authorized, relativePath);
            const before = await readEntryIdentity(target.absolute);
            if (before !== null && before.kind !== "directory") {
                throw new PlatformFilesError("identity-changed", `目标已存在且不是目录：${target.relativePath}`);
            }
            if (before === null) {
                try {
                    await mkdir(target.absolute, {recursive: true});
                } catch (error) {
                    throw this.#fsFailure("创建目录", error);
                }
            }
            const after = await readEntryIdentity(target.absolute);
            if (after === null || after.kind !== "directory") {
                throw new PlatformFilesError("identity-changed", `创建后目标不是目录：${target.relativePath}`);
            }
        });
    }

    async remove(grant: RootGrant, relativePath: string, options: RemoveOptions = {}): Promise<void> {
        return this.#perform(grant, ["delete"], options.signal, async (authorized) => {
            const target = await this.#entryTarget(authorized, relativePath);
            const before = await this.#requireIdentity(target, target.relativePath);
            await this.#assertUnchanged(target, before);
            if (before.kind === "directory") {
                await this.#removeDirectory(target, options.recursive === true);
            } else {
                await this.#unlink(target);
            }
            const after = await readEntryIdentity(target.absolute);
            if (after !== null) {
                throw new PlatformFilesError("identity-changed", `目录项在删除后仍然存在：${target.relativePath}`);
            }
        });
    }

    async rename(
        grant: RootGrant,
        from: string,
        to: string,
        options: OperationOptions = {},
    ): Promise<void> {
        // 移动同时移除源目录项并创建目标，缺写或删除任一授予时整体拒绝，源保持不变。
        return this.#perform(grant, ["write", "delete"], options.signal, async (authorized) => {
            const source = await this.#entryTarget(authorized, from);
            const target = await this.#entryTarget(authorized, to);
            const before = await this.#requireIdentity(source, source.relativePath);
            await this.#assertUnchanged(source, before);
            const parent = await readEntryIdentity(absoluteFsPath(path.dirname(target.absolute)));
            if (parent === null || parent.kind !== "directory") {
                throw notFoundError(`目标父目录：${target.relativePath}`);
            }
            try {
                await fsRename(source.absolute, target.absolute);
            } catch (error) {
                throw this.#fsFailure("移动目录项", error);
            }
            const afterSource = await readEntryIdentity(source.absolute);
            if (afterSource !== null) {
                throw new PlatformFilesError("identity-changed", `源目录项在移动后仍然存在：${source.relativePath}`);
            }
            const afterTarget = await readEntryIdentity(target.absolute);
            if (afterTarget === null || !sameEntryIdentity(before, afterTarget)) {
                throw new PlatformFilesError("identity-changed", `目标目录项与源身份不一致：${target.relativePath}`);
            }
        });
    }

    async watch(grant: RootGrant, relativePath: string, options: WatchOptions): Promise<WatchHandle> {
        return this.#perform(grant, ["read"], options.signal, async (authorized) => {
            const target = await this.#target(authorized, relativePath);
            return this.#acquireHandle<WatchHandle>({
                scope: options.scope,
                dependsOn: options.dependsOn,
                kind: "platform-files-watch",
                label: `watch:${authorized.root.id}/${target.relativePath}`,
                create: () => this.#openWatcher(authorized.root, target, options.onEvent),
                release: (handle) => handle.close(),
            });
        });
    }

    async lock(grant: RootGrant, relativePath: string, options: LockOptions): Promise<LockHandle> {
        // 锁文件是新建的目录项，因此锁需要写授权；锁本身只对协作参与者有意义。
        return this.#perform(grant, ["write"], options.signal, async (authorized) => {
            const target = await this.#target(authorized, relativePath);
            return this.#acquireHandle<LockHandle>({
                scope: options.scope,
                dependsOn: options.dependsOn,
                kind: "platform-files-lock",
                label: `lock:${authorized.root.id}/${target.relativePath}`,
                create: () => this.#openLock(target, options),
                release: (handle) => handle.release(),
            });
        });
    }

    async #release(): Promise<void> {
        if (this.#state === "closed") {
            return;
        }
        this.#state = "stopping";
        for (const root of this.#roots.values()) {
            root.authority.revoke();
        }
        while (this.#inFlight > 0) {
            await this.#idle.promise;
        }
        const outstanding = [...this.#handles];
        if (outstanding.length > 0) {
            const kinds = [...new Set(outstanding.map((record) => record.kind))].join("、");
            throw new PlatformFilesError(
                "stopping",
                `关闭未完成：仍有 ${outstanding.length} 个受管句柄未释放（${kinds}）`,
            );
        }
        this.#state = "closed";
    }

    #authorize(
        grant: RootGrant,
        operations: ReadonlyArray<RootOperation>,
        signal: AbortSignal | undefined,
    ): Authorized {
        const authorized = this.#recognize(grant);
        if (authorized === null) {
            throw new PlatformFilesError("grant-revoked", "授予不是本服务签发的有效能力");
        }
        if (this.#state === "closed") {
            throw new PlatformFilesError("closed", "平台文件服务已关闭");
        }
        if (this.#state === "stopping") {
            throw new PlatformFilesError("stopping", "平台文件服务正在关闭，拒绝新操作与新句柄");
        }
        if (signal?.aborted === true) {
            throw new PlatformFilesError("cancelled", "操作在开始前已被取消");
        }
        for (const operation of operations) {
            if (!authorized.operations.includes(operation)) {
                throw new PlatformFilesError(
                    "permission-denied",
                    `授予 ${authorized.grantId} 未包含 ${operation} 操作`,
                );
            }
        }
        return authorized;
    }

    #recognize(grant: RootGrant): Authorized | null {
        for (const root of this.#roots.values()) {
            const record: GrantRecord | null = root.authority.recognize(grant);
            if (record !== null) {
                return {root, directory: record.directory, grantId: record.grantId, operations: record.operations};
            }
        }
        return null;
    }

    /** 操作外壳：门禁、在途登记、结算与取消语义。 */
    async #perform<T>(
        grant: RootGrant,
        operations: ReadonlyArray<RootOperation>,
        signal: AbortSignal | undefined,
        work: (authorized: Authorized) => Promise<T>,
    ): Promise<T> {
        const authorized = this.#authorize(grant, operations, signal);
        if (this.#inFlight === 0) {
            this.#idle = Promise.withResolvers<void>();
        }
        this.#inFlight += 1;
        try {
            return await work(authorized);
        } catch (error) {
            throw cancellationOutcome(signal, error);
        } finally {
            this.#inFlight -= 1;
            if (this.#inFlight === 0) {
                this.#idle.resolve();
            }
        }
    }

    #container(authorized: Authorized, target: ResolvedTarget): ContainedTargetInput {
        return {
            rootRealPath: authorized.root.realPath,
            directory: authorized.directory,
            relativePath: target.relativePath,
        };
    }

    /** 目标型操作：解析可检测链接后证明目标落在授予目录内。 */
    #target(authorized: Authorized, relativePath: string): Promise<ResolvedTarget> {
        return resolveContainedTarget({
            rootRealPath: authorized.root.realPath,
            directory: authorized.directory,
            relativePath: assertRelativeAddress(relativePath),
        });
    }

    /** 目录项操作：只证明真实父目录落在授予目录内，不跟随目标自身的链接。 */
    #entryTarget(authorized: Authorized, relativePath: string): Promise<ResolvedTarget> {
        return resolveEntryTarget({
            rootRealPath: authorized.root.realPath,
            directory: authorized.directory,
            relativePath: assertRelativeAddress(relativePath),
        });
    }

    /** 写路径：创建父目录前先证明位于根内，创建后再复核一次。 */
    async #writableTarget(authorized: Authorized, relativePath: string): Promise<ResolvedTarget> {
        const target = await this.#target(authorized, relativePath);
        const container = this.#container(authorized, target);
        await assertParentContained(container);
        const parent = absoluteFsPath(path.dirname(target.absolute));
        const identity = await readEntryIdentity(parent);
        if (identity !== null && identity.kind === "directory") {
            return target;
        }
        try {
            await mkdir(parent, {recursive: true});
        } catch (error) {
            throw this.#fsFailure("创建父目录", error);
        }
        await assertParentContained(container);
        return target;
    }

    async #requireIdentity(target: ResolvedTarget, label: string): Promise<EntryIdentity> {
        const identity = await readEntryIdentity(target.absolute);
        if (identity === null) {
            throw notFoundError(label);
        }
        return identity;
    }

    /** 读取类目标：目录与设备节点不作为内容返回，链接按解析后的包含判定处理。 */
    async #requireContent(target: ResolvedTarget): Promise<EntryIdentity> {
        const identity = await this.#requireIdentity(target, target.relativePath);
        if (identity.kind === "directory" || identity.kind === "other") {
            throw invalidPathError(`目标不是普通文件：${target.relativePath}`);
        }
        return identity;
    }

    async #existingContent(target: ResolvedTarget): Promise<EntryIdentity | null> {
        const identity = await readEntryIdentity(target.absolute);
        if (identity !== null && (identity.kind === "directory" || identity.kind === "other")) {
            throw invalidPathError(`目标不是普通文件：${target.relativePath}`);
        }
        return identity;
    }

    async #assertUnchanged(target: ResolvedTarget, expected: EntryIdentity): Promise<void> {
        const actual = await readEntryIdentity(target.absolute);
        if (actual === null || !sameEntryIdentity(expected, actual)) {
            throw new PlatformFilesError("identity-changed", `目标在操作期间被替换或消失：${target.relativePath}`);
        }
    }

    /** 写操作结束后复核身份：源目录项被替换（inode 或类型变化）即失败。 */
    async #assertWritten(target: ResolvedTarget, before: EntryIdentity | null): Promise<void> {
        const after = await readEntryIdentity(target.absolute);
        if (after === null || (before !== null && !sameEntryIdentity(before, after))) {
            throw new PlatformFilesError("identity-changed", `写入期间目标被替换或消失：${target.relativePath}`);
        }
    }

    async #readBytes(target: ResolvedTarget): Promise<Uint8Array> {
        try {
            const data = await readFile(target.absolute);
            return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        } catch (error) {
            throw this.#fsFailure("读取文件", error);
        }
    }

    async #openTarget(target: ResolvedTarget, mode: "w" | "a"): Promise<FileHandle> {
        try {
            return await open(target.absolute, mode);
        } catch (error) {
            throw this.#fsFailure("打开目标文件", error);
        }
    }

    async #closeHandle(handle: FileHandle): Promise<void> {
        try {
            await handle.close();
        } catch (error) {
            throw this.#fsFailure("关闭目标文件", error);
        }
    }

    #temporaryPath(target: AbsoluteFsPath): AbsoluteFsPath {
        const name = `.${path.basename(target)}.${randomBytes(8).toString("hex")}.tmp`;
        return absoluteFsPath(path.join(path.dirname(target), name));
    }

    /** 临时文件与目标同目录：写入 + fsync + rename 发布，任何失败都清理临时文件。 */
    async #writeTemporary(temporary: AbsoluteFsPath, data: string | Uint8Array): Promise<void> {
        let handle: FileHandle;
        try {
            handle = await open(temporary, "wx");
        } catch (error) {
            throw this.#fsFailure("创建替换临时文件", error);
        }
        try {
            await handle.writeFile(data);
            await handle.sync();
        } catch (error) {
            throw this.#fsFailure("写入替换临时文件", error);
        } finally {
            await this.#closeHandle(handle);
        }
    }

    async #removeQuietly(target: AbsoluteFsPath): Promise<void> {
        try {
            await unlink(target);
        } catch {
            // 清理临时文件失败不改变本次替换的失败结论；残留只是同根内的临时名。
        }
    }

    /** 目录项 fsync 是 durable 的可选加强；平台不允许打开目录时只跳过这一层。 */
    async #syncDirectory(directory: AbsoluteFsPath): Promise<void> {
        let handle: FileHandle;
        try {
            handle = await open(directory, "r");
        } catch (error) {
            if (isDirectorySyncUnsupported(error)) {
                return;
            }
            throw this.#fsFailure("同步目标目录项", error);
        }
        try {
            await handle.sync();
        } catch (error) {
            if (!isDirectorySyncUnsupported(error)) {
                throw this.#fsFailure("同步目标目录项", error);
            }
        } finally {
            await this.#closeHandle(handle);
        }
    }

    /** 递归删除不跨链接边界：lstat 判定链接项，遇链接只 unlink 链接自身。 */
    async #removeDirectory(target: ResolvedTarget, recursive: boolean): Promise<void> {
        if (!recursive) {
            try {
                await rmdir(target.absolute);
            } catch (error) {
                throw this.#fsFailure("删除目录", error);
            }
            return;
        }
        await this.#removeTree(target.absolute);
    }

    async #removeTree(directory: AbsoluteFsPath): Promise<void> {
        let entries: Dirent[];
        try {
            entries = await readdir(directory, {withFileTypes: true});
        } catch (error) {
            throw this.#fsFailure("读取待删除目录", error);
        }
        for (const entry of entries) {
            const child = absoluteFsPath(path.join(directory, entry.name));
            let stats: Stats;
            try {
                stats = await lstat(child);
            } catch (error) {
                throw this.#fsFailure("读取待删除目录项", error);
            }
            if (stats.isSymbolicLink() || !stats.isDirectory()) {
                await this.#unlinkPath(child);
                continue;
            }
            await this.#removeTree(child);
        }
        try {
            await rmdir(directory);
        } catch (error) {
            throw this.#fsFailure("删除目录", error);
        }
    }

    async #unlink(target: ResolvedTarget): Promise<void> {
        await this.#unlinkPath(target.absolute);
    }

    async #unlinkPath(target: AbsoluteFsPath): Promise<void> {
        try {
            await unlink(target);
        } catch (error) {
            throw this.#fsFailure("删除目录项", error);
        }
    }

    /** 受管句柄先在调用方作用域登记再获取：失败、取消或迟到的获取都不会泄漏句柄。 */
    async #acquireHandle<T>(input: {
        readonly scope: Scope;
        readonly dependsOn: ReadonlyArray<ReleaseDependency> | undefined;
        readonly kind: string;
        readonly label: string;
        readonly create: () => Promise<T>;
        readonly release: (value: T) => Promise<void>;
    }): Promise<T> {
        let result: AcquireResult<T>;
        try {
            result = await input.scope.acquire<T>({
                kind: input.kind,
                // 失败直接交还调用方处理；必需获取失败会让调用方作用域永远无法进入可用。
                required: false,
                label: input.label,
                acquire: input.create,
                release: input.release,
                dependsOn: input.dependsOn,
            });
        } catch (error) {
            if (error instanceof LifecycleStateError) {
                throw new PlatformFilesError("cancelled", `调用方作用域已停止，无法登记句柄：${input.label}`, {
                    cause: error,
                });
            }
            throw toPlatformFilesError(error);
        }
        switch (result.status) {
            case "acquired":
                return result.handle.value;
            case "late":
                throw new PlatformFilesError("cancelled", `调用方作用域已停止，句柄未发布：${input.label}`);
            case "cancelled":
                throw new PlatformFilesError("cancelled", `句柄获取已取消：${input.label}`, {cause: result.error});
            case "failed":
                throw toPlatformFilesError(result.error);
        }
    }

    /** 变更订阅：chokidar 不跟随链接、不投递初始事件，串行回调，释放后不再开始排队回调。 */
    async #openWatcher(
        root: RootRuntime,
        target: ResolvedTarget,
        onEvent: (event: WatchEvent) => void,
    ): Promise<WatchHandle> {
        const watcher = createWatcher(target.absolute, {followSymlinks: false, ignoreInitial: true, persistent: true});
        const record: HandleRecord = {kind: "watch", label: `${root.id}/${target.relativePath}`};
        const ready = Promise.withResolvers<void>();
        const handle = new WatchHandleImpl({
            watcher,
            record,
            rootId: root.id,
            rootRealPath: root.realPath,
            watched: target.relativePath,
            onEvent,
            release: (released) => this.#releaseHandle(released),
            ready: ready.promise,
        });
        watcher.on("ready", () => ready.resolve());
        // 就绪前失败让启动整体失败；就绪后 resolve 已生效，reject 是空操作，错误不影响既有订阅。
        watcher.on("error", (error: unknown) => ready.reject(error));
        watcher.on("all", (eventName: string, changedPath: string) => handle.deliver(eventName, changedPath));
        this.#handles.add(record);
        try {
            await ready.promise;
        } catch (error) {
            await handle.close().catch(() => undefined);
            throw ioFailedError("启动文件变更订阅", error);
        }
        return handle;
    }

    /** 协作锁：proper-lockfile 不解析真实路径，包含性由本服务自己证明。 */
    async #openLock(target: ResolvedTarget, options: LockOptions): Promise<LockHandle> {
        const lockfilePath = absoluteFsPath(`${target.absolute}.lock`);
        const stale = Math.max(options.staleMs ?? DEFAULT_LOCK_STALE_MS, LOCK_STALE_FLOOR_MS);
        const update = Math.max(Math.min(options.updateMs ?? stale / 2, stale / 2), LOCK_UPDATE_FLOOR_MS);
        const compromise = {compromised: false};
        let releaseLock: () => Promise<void>;
        try {
            releaseLock = await acquireFileLock(target.absolute, {
                lockfilePath,
                realpath: false,
                stale,
                update,
                retries: 0,
                onCompromised: () => {
                    compromise.compromised = true;
                },
            });
        } catch (error) {
            if (nodeErrorCode(error) === "ELOCKED") {
                throw new PlatformFilesError("lock-held", `协作锁已被占用：${target.relativePath}`);
            }
            throw this.#fsFailure("获取协作锁", error);
        }
        const identity = await readEntryIdentity(lockfilePath);
        if (identity === null) {
            await releaseLock().catch(() => undefined);
            throw ioFailedError("登记锁文件身份", new Error("锁目录在获取后不可读"));
        }
        const record: HandleRecord = {kind: "lock", label: `${target.relativePath}`};
        this.#handles.add(record);
        return new LockHandleImpl({
            releaseLock,
            lockfilePath,
            identity,
            stale,
            compromise,
            record,
            release: (released) => this.#releaseHandle(released),
        });
    }

    #releaseHandle(record: HandleRecord): void {
        this.#handles.delete(record);
    }

    #fsFailure(operation: string, error: unknown): PlatformFilesError {
        if (nodeErrorCode(error) === "ENOTDIR") {
            return invalidPathError("路径分量不是目录");
        }
        return ioFailedError(operation, error);
    }
}

function direntKind(entry: Dirent): EntryKind {
    if (entry.isSymbolicLink()) {
        return "link";
    }
    if (entry.isDirectory()) {
        return "directory";
    }
    if (entry.isFile()) {
        return "file";
    }
    return "other";
}

function toPlatformFilesError(error: unknown): PlatformFilesError {
    return isPlatformFilesError(error) ? error : ioFailedError("受管句柄操作", error);
}

/** 进行中的取消：操作结算后按实际结果返回；完成仍是成功，失败不伪报成功。 */
function cancellationOutcome(signal: AbortSignal | undefined, error: unknown): unknown {
    if (signal?.aborted !== true) {
        return error;
    }
    if (isPlatformFilesError(error) && DEFINITIVE_REJECTIONS[error.code] === true) {
        return new PlatformFilesError("cancelled", "操作在取消后以明确失败结算，未产生副作用", {cause: error});
    }
    return new PlatformFilesError("outcome-unknown", "操作在取消后失败，结果未知", {cause: error});
}

function isDirectorySyncUnsupported(error: unknown): boolean {
    const code = nodeErrorCode(error);
    return code === "EISDIR" || code === "EPERM" || code === "EACCES" || code === "EINVAL" || code === "EBADF" || code === "ENOTSUP";
}

interface WatchHandleInput {
    readonly watcher: FSWatcher;
    readonly record: HandleRecord;
    readonly rootId: string;
    readonly rootRealPath: AbsoluteFsPath;
    readonly watched: string;
    readonly onEvent: (event: WatchEvent) => void;
    readonly release: (record: HandleRecord) => void;
    readonly ready: Promise<void>;
}

class WatchHandleImpl implements WatchHandle {
    readonly ready: Promise<void>;
    readonly #watcher: FSWatcher;
    readonly #record: HandleRecord;
    readonly #rootId: string;
    readonly #rootRealPath: AbsoluteFsPath;
    readonly #watched: string;
    readonly #onEvent: (event: WatchEvent) => void;
    readonly #release: (record: HandleRecord) => void;
    #delivery: Promise<void> = Promise.resolve();
    #closing = false;
    #closed = false;
    #closePromise: Promise<void> | null = null;
    #failure: PlatformFilesError | null = null;

    constructor(input: WatchHandleInput) {
        this.#watcher = input.watcher;
        this.#record = input.record;
        this.#rootId = input.rootId;
        this.#rootRealPath = input.rootRealPath;
        this.#watched = input.watched;
        this.#onEvent = input.onEvent;
        this.#release = input.release;
        this.ready = input.ready;
    }

    /** 事件先归一化与过滤，再进入串行投递链；释放后不再开始新回调。 */
    deliver(eventName: string, changedPath: string): void {
        const kind = WATCH_EVENT_KINDS[eventName];
        if (kind === undefined) {
            return;
        }
        const relative = relativeFilePathInside(this.#rootRealPath, absoluteFsPath(changedPath));
        if (relative === null || !isInsideWatched(this.#watched, relative)) {
            return;
        }
        if (this.#closing || this.#closed) {
            return;
        }
        this.#delivery = this.#delivery.then(async () => {
            if (this.#closing || this.#closed) {
                return;
            }
            try {
                await this.#onEvent({rootId: this.#rootId, path: relative, kind});
            } catch {
                // 消费者回调异常不改变机制状态，也不中断后续投递。
            }
        });
    }

    close(): Promise<void> {
        const pending = this.#closePromise;
        if (pending !== null) {
            return pending;
        }
        if (this.#failure !== null) {
            return Promise.reject(this.#failure);
        }
        this.#closePromise = this.#doClose();
        return this.#closePromise;
    }

    async #doClose(): Promise<void> {
        this.#closing = true;
        try {
            await this.#delivery;
            await this.#watcher.close();
        } catch (error) {
            this.#failure = ioFailedError("释放文件变更订阅", error);
            throw this.#failure;
        }
        this.#closed = true;
        this.#release(this.#record);
    }
}

interface LockHandleInput {
    readonly releaseLock: () => Promise<void>;
    readonly lockfilePath: AbsoluteFsPath;
    readonly identity: EntryIdentity;
    readonly stale: number;
    readonly compromise: {compromised: boolean};
    readonly record: HandleRecord;
    readonly release: (record: HandleRecord) => void;
}

class LockHandleImpl implements LockHandle {
    readonly #releaseLock: () => Promise<void>;
    readonly #lockfilePath: AbsoluteFsPath;
    readonly #identity: EntryIdentity;
    readonly #stale: number;
    readonly #compromise: {compromised: boolean};
    readonly #record: HandleRecord;
    readonly #release: (record: HandleRecord) => void;
    #state: LockState = "held";
    #closed = false;
    #closePromise: Promise<void> | null = null;
    #failure: PlatformFilesError | null = null;

    constructor(input: LockHandleInput) {
        this.#releaseLock = input.releaseLock;
        this.#lockfilePath = input.lockfilePath;
        this.#identity = input.identity;
        this.#stale = input.stale;
        this.#compromise = input.compromise;
        this.#record = input.record;
        this.#release = input.release;
    }

    async check(): Promise<LockState> {
        if (this.#state === "compromised") {
            return "compromised";
        }
        if (this.#closed) {
            throw new PlatformFilesError("closed", "锁句柄已释放");
        }
        const current = await readEntryIdentity(this.#lockfilePath);
        if (current === null
            || current.kind !== "directory"
            || !sameEntryIdentity(this.#identity, current)
            || Date.now() - current.mtimeMs > this.#stale) {
            this.#state = "compromised";
            return "compromised";
        }
        return "held";
    }

    release(): Promise<void> {
        const pending = this.#closePromise;
        if (pending !== null) {
            return pending;
        }
        if (this.#failure !== null) {
            return Promise.reject(this.#failure);
        }
        this.#closePromise = this.#doRelease();
        return this.#closePromise;
    }

    async #doRelease(): Promise<void> {
        // proper-lockfile 按路径在进程内共用一张锁表：锁目录被外部删除后另一参与者重新获取，会覆盖表项，
        // 此时调用它的释放会删除接管者的锁目录。因此只在锁目录仍是自己的（或已不存在）时交给它释放；
        // 已被他人占用即只结束本句柄——本参与者遗留的刷新计时器会在下一拍发现 mtime 不属于自己而自停。
        // 判定只看身份不看时效：仅因时效过期而跳过释放会让刷新计时器一直续期，锁被已释放的句柄永久占住。
        const current = await readEntryIdentity(this.#lockfilePath);
        const takenOver = current !== null && !sameEntryIdentity(this.#identity, current);
        if (takenOver) {
            this.#state = "compromised";
        }
        try {
            if (!takenOver) {
                await this.#releaseLock();
            }
        } catch (error) {
            const code = nodeErrorCode(error);
            if (code !== "ERELEASED" && code !== "ENOTACQUIRED") {
                this.#failure = ioFailedError("释放协作锁", error);
                throw this.#failure;
            }
            // 锁已被接管或已释放：不删除他人的锁目录，也不假装仍持有。
        }
        this.#closed = true;
        this.#release(this.#record);
    }
}

/** 事件路径必须落在被订阅目标之内；订阅根自身时不再收窄。 */
function isInsideWatched(watched: string, relative: string): boolean {
    if (watched === ".") {
        return true;
    }
    return relative === watched || relative.startsWith(`${watched}/`);
}
