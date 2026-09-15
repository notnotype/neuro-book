/**
 * 值操作的共享句柄生命周期。
 *
 * 同一次访问与同一 owner 的并发请求收敛到同一个句柄，最后一名使用者结束时释放：
 * 句柄不跨访问复用，也不为同一对访问/owner 打开多份。释放与关闭都拒绝新取得并排空在途打开与已开始的释放，
 * 因此关闭竞态中打开的句柄不会留在池外。池只依赖“打开句柄”这一个能力，
 * 宿主传入服务入口、测试注入隔离实现，授权失效停写由传入核心的 guard 保证。
 */

import {StorageContextLimitError, StorageServiceClosedError} from "nbook/shared/storage/storage-errors";
import type {StorageMutationGuard} from "nbook/server/storage/partition-store";
import type {
    StorageAccessContext,
    StorageHandle,
    StorageHandleInput,
} from "nbook/server/storage/storage-service";

/** 宿主同时打开的 owner 句柄上限；达到上限拒绝新句柄，不挤掉正在使用的访问。 */
export const STORAGE_HANDLE_LIMIT = 64;
/** 单个访问同时打开的 owner 句柄上限。 */
export const STORAGE_HANDLE_CONTEXT_LIMIT = 8;

export type StorageHandlePoolLimits = {
    readonly maxHandles?: number;
    readonly maxHandlesPerContext?: number;
};

export type StorageHandlePoolOptions = {
    readonly openHandle: (input: StorageHandleInput) => Promise<StorageHandle>;
    readonly limits?: StorageHandlePoolLimits;
};

export type StorageHandleAcquireInput = {
    readonly contextId: string;
    readonly owner: string;
    readonly context: StorageAccessContext;
    readonly expectedRootIdentity?: string;
    /** 受信边界提供的授权检查；同一对访问/owner 的所有使用者共用第一个打开者的检查。 */
    readonly guard: StorageMutationGuard;
};

export type StorageHandleLease = {
    readonly handle: StorageHandle;
    /** 结束本次使用；返回池对这次释放的等待，最后一名使用者结束时释放共享句柄。 */
    release(): Promise<void>;
};

type PoolEntry = {
    readonly contextId: string;
    handle: StorageHandle | null;
    /** 在途代次：打开句柄并判定它的归属，池与 `close()` 都等它结束。 */
    opening: Promise<StorageHandle> | null;
    released: Promise<void> | null;
    users: number;
};

export class StorageHandlePool {
    private readonly openHandle: (input: StorageHandleInput) => Promise<StorageHandle>;
    private readonly maxHandles: number;
    private readonly maxHandlesPerContext: number;
    private readonly entries = new Map<string, PoolEntry>();
    private readonly opening = new Set<Promise<StorageHandle>>();
    private readonly releases = new Set<Promise<void>>();
    private closing: Promise<void> | null = null;

    constructor(options: StorageHandlePoolOptions) {
        this.openHandle = options.openHandle;
        this.maxHandles = options.limits?.maxHandles ?? STORAGE_HANDLE_LIMIT;
        this.maxHandlesPerContext = options.limits?.maxHandlesPerContext ?? STORAGE_HANDLE_CONTEXT_LIMIT;
        if (!Number.isSafeInteger(this.maxHandles) || this.maxHandles < 1) {
            throw new Error(`Storage 句柄容量必须是正安全整数：${String(this.maxHandles)}`);
        }
        if (!Number.isSafeInteger(this.maxHandlesPerContext) || this.maxHandlesPerContext < 1) {
            throw new Error(`Storage 单访问句柄容量必须是正安全整数：${String(this.maxHandlesPerContext)}`);
        }
    }

    /**
     * 取得共享句柄。
     *
     * 已打开或正在打开的同一对访问/owner 收敛到同一个句柄，等待打开的调用方看到与打开者相同的错误；
     * 上一个句柄还在释放时先等它排空，不会把已释放的句柄交给新请求。
     */
    async acquire(input: StorageHandleAcquireInput): Promise<StorageHandleLease> {
        const key = poolKey(input.contextId, input.owner);
        for (;;) {
            this.assertOpen();
            const existing = this.entries.get(key);
            if (existing !== undefined) {
                if (existing.released !== null) {
                    await existing.released;
                    continue;
                }
                if (existing.handle !== null) {
                    existing.users += 1;
                    return this.leaseFor(key, existing, existing.handle);
                }
                if (existing.opening !== null) {
                    await existing.opening;
                    continue;
                }
                // 既没有句柄也没有在途打开的条目不属于任何使用者，清掉后按新取得处理。
                this.dropIfIdle(key, existing);
            }
            this.assertCapacity(input.contextId);
            const entry: PoolEntry = {contextId: input.contextId, handle: null, opening: null, released: null, users: 0};
            this.entries.set(key, entry);
            entry.users += 1;
            // 打开与“打开后的归属判定”属于同一个在途代次：关闭必须等到句柄已有明确归属才能收口，
            // 因此容量拒绝发生在建立条目之前，拒绝不会留下任何池内状态。
            const opening = this.open(key, entry, input);
            entry.opening = opening;
            this.opening.add(opening);
            const settled = (): void => { this.opening.delete(opening); };
            void opening.then(settled, settled);
            const handle = await opening;
            return this.leaseFor(key, entry, handle);
        }
    }

    /** 拒绝新取得，并排空在途打开、关闭竞态中打开的句柄与已开始的释放；正在使用的租约由核心排空已接纳操作。 */
    close(): Promise<void> {
        if (this.closing !== null) return this.closing;
        this.closing = (async () => {
            // 关闭竞态中的打开会在收尾时登记释放，所以这里反复收敛到没有在途打开与释放为止。
            while (this.opening.size > 0 || this.releases.size > 0) {
                await Promise.allSettled([...this.opening, ...this.releases]);
            }
            for (const [key, entry] of this.entries) {
                const handle = entry.handle;
                if (handle !== null) this.retire(key, entry, handle);
            }
            while (this.releases.size > 0) {
                await Promise.allSettled([...this.releases]);
            }
            this.entries.clear();
        })();
        return this.closing;
    }

    /**
     * 打开一个句柄并判定它的归属。
     *
     * 成功时把句柄写进条目并返回；打开失败、关闭竞态或服务关闭时抛错，且三种失败都不会把句柄留在池外：
     * 关闭竞态中打开的句柄在抛错前已登记释放，由 `close()` 与本轮调用方共同等待。
     */
    private async open(key: string, entry: PoolEntry, input: StorageHandleAcquireInput): Promise<StorageHandle> {
        let handle: StorageHandle;
        try {
            handle = await this.openHandle({
                owner: input.owner, context: {...input.context}, guard: input.guard,
                expectedRootIdentity: input.expectedRootIdentity,
            });
        } catch (error) {
            entry.opening = null;
            entry.users -= 1;
            this.dropIfIdle(key, entry);
            throw error;
        }
        if (this.closing !== null) {
            entry.opening = null;
            entry.users -= 1;
            this.retire(key, entry, handle);
            throw new StorageServiceClosedError();
        }
        entry.opening = null;
        entry.handle = handle;
        return handle;
    }

    /** 正在使用与正在打开的句柄都计入上限；达到上限时拒绝新句柄，已有访问不受影响。 */
    private assertCapacity(contextId: string): void {
        let total = 0;
        let perContext = 0;
        for (const entry of this.entries.values()) {
            if (entry.handle === null && entry.opening === null && entry.released === null) {
                continue;
            }
            total += 1;
            if (entry.contextId === contextId) perContext += 1;
        }
        if (perContext >= this.maxHandlesPerContext || total >= this.maxHandles) {
            throw new StorageContextLimitError();
        }
    }

    private leaseFor(key: string, entry: PoolEntry, handle: StorageHandle): StorageHandleLease {
        let active = true;
        return {
            handle,
            release: () => {
                if (!active) return Promise.resolve();
                active = false;
                entry.users -= 1;
                // 句柄已被关闭收口或还有别的使用者时不重复释放。
                if (entry.users > 0 || entry.handle !== handle) return Promise.resolve();
                return this.retire(key, entry, handle);
            },
        };
    }

    /** 开始释放句柄并把这次释放登记到池里；调用方与 `close()` 等待的是同一次释放。 */
    private retire(key: string, entry: PoolEntry, handle: StorageHandle): Promise<void> {
        entry.handle = null;
        const released = (async () => { await handle.release(); })();
        entry.released = released;
        this.releases.add(released);
        const finished = (): void => {
            this.releases.delete(released);
            if (entry.released === released) {
                entry.released = null;
            }
            this.dropIfIdle(key, entry);
        };
        void released.then(finished, finished);
        return released;
    }

    /** 条目只在没有使用者、句柄与在途打开/释放时移除，避免把正在释放的句柄交给新请求。 */
    private dropIfIdle(key: string, entry: PoolEntry): void {
        if (entry.users > 0 || entry.handle !== null || entry.opening !== null || entry.released !== null) {
            return;
        }
        if (this.entries.get(key) === entry) {
            this.entries.delete(key);
        }
    }

    private assertOpen(): void {
        if (this.closing !== null) {
            throw new StorageServiceClosedError();
        }
    }
}

/** 同一 owner 的不同访问不共享句柄；访问标识是定位键，不构成任何授权。 */
function poolKey(contextId: string, owner: string): string {
    return `${contextId}\u0000${owner}`;
}
