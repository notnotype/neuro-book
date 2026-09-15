import {describe, expect, it} from "vitest";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {StorageHandlePool} from "nbook/server/storage/handle-pool";
import type {StorageAccessContext, StorageHandle} from "nbook/server/storage/storage-service";

/** 池只调用“打开句柄”和 `handle.release()`，因此替身足以观察打开、共享与释放次数。 */
type FakeHandle = {
    readonly release: () => Promise<void>;
    readonly releaseCount: () => number;
};

const context: StorageAccessContext = {
    scope: "user",
    storageRoot: absoluteFsPath(process.platform === "win32" ? "C:\\nbook\\state\\workspace\\storage" : "/nbook/state/workspace/storage"),
    identityDomain: "11111111-1111-4111-8111-111111111111",
    subject: "user:7",
    clientId: "a".repeat(64),
};

const noopGuard = (): void => undefined;
const address = {contextId: "context-a", owner: "owner-a", context, guard: noopGuard};

function fakeOpener(releaseGate?: Promise<void>): {
    readonly handles: FakeHandle[];
    readonly openCount: () => number;
    readonly openHandle: () => Promise<StorageHandle>;
} {
    const handles: FakeHandle[] = [];
    let opens = 0;
    return {
        handles,
        openCount: () => opens,
        openHandle: async () => {
            opens += 1;
            let releases = 0;
            const handle: FakeHandle = {
                release: async () => {
                    releases += 1;
                    await releaseGate;
                },
                releaseCount: () => releases,
            };
            handles.push(handle);
            return handle as unknown as StorageHandle;
        },
    };
}

describe("StorageHandlePool", () => {
    it("同上下文同 owner 的并发取得收敛为一次打开，最后一名使用者结束才释放", async () => {
        const opener = fakeOpener();
        const pool = new StorageHandlePool({openHandle: opener.openHandle});

        const [first, second] = await Promise.all([pool.acquire(address), pool.acquire(address)]);
        expect(opener.openCount()).toBe(1);
        expect(first.handle).toBe(second.handle);

        first.release();
        expect(opener.handles[0]?.releaseCount()).toBe(0);
        second.release();
        expect(opener.handles[0]?.releaseCount()).toBe(1);
        // 重复释放不产生第二次释放，也不会把使用者计数减成负数。
        first.release();
        expect(opener.handles[0]?.releaseCount()).toBe(1);
    });

    it("不同访问或不同 owner 各自打开，不复用别人的句柄", async () => {
        const opener = fakeOpener();
        const pool = new StorageHandlePool({openHandle: opener.openHandle});

        const first = await pool.acquire(address);
        const second = await pool.acquire({...address, contextId: "context-b"});
        const third = await pool.acquire({...address, owner: "owner-b"});
        expect(opener.openCount()).toBe(3);
        expect(new Set([first.handle, second.handle, third.handle]).size).toBe(3);
    });

    it("释放后重新取得会打开新句柄，不把已释放的句柄交出去", async () => {
        const opener = fakeOpener();
        const pool = new StorageHandlePool({openHandle: opener.openHandle});

        const first = await pool.acquire(address);
        first.release();
        const second = await pool.acquire(address);
        expect(opener.openCount()).toBe(2);
        expect(second.handle).not.toBe(first.handle);
    });

    it("释放还在进行时，新取得先等它排空再打开", async () => {
        const releaseGate = Promise.withResolvers<void>();
        const opener = fakeOpener(releaseGate.promise);
        const pool = new StorageHandlePool({openHandle: opener.openHandle});

        const first = await pool.acquire(address);
        first.release();
        const pending = pool.acquire(address);
        let settled = false;
        void pending.then(() => { settled = true; });
        await Promise.all([Promise.resolve(), Promise.resolve()]);
        // 释放闸门未打开前，取得不可能成功：这里断言的是顺序而不是等待时间。
        expect(settled).toBe(false);
        expect(opener.openCount()).toBe(1);

        releaseGate.resolve();
        const second = await pending;
        expect(opener.openCount()).toBe(2);
        expect(second.handle).not.toBe(first.handle);
    });

    it("达到单访问上限时拒绝新句柄，已有访问不受影响", async () => {
        const opener = fakeOpener();
        const pool = new StorageHandlePool({openHandle: opener.openHandle, limits: {maxHandlesPerContext: 1}});
        const held = await pool.acquire(address);

        await expect(pool.acquire({...address, owner: "owner-b"}))
            .rejects.toMatchObject({code: "STORAGE_CONTEXT_LIMIT"});
        const other = await pool.acquire({...address, contextId: "context-b"});
        expect(other.handle).toBeDefined();

        await held.release();
        const retried = await pool.acquire({...address, owner: "owner-b"});
        expect(retried.handle).toBeDefined();
        await other.release();
        await retried.release();
    });

    it("达到宿主总上限时拒绝新句柄，容量拒绝不阻挡释放后的重新取得", async () => {
        const opener = fakeOpener();
        const pool = new StorageHandlePool({openHandle: opener.openHandle, limits: {maxHandles: 2}});
        const first = await pool.acquire(address);
        const second = await pool.acquire({...address, contextId: "context-b"});

        await expect(pool.acquire({...address, contextId: "context-c"}))
            .rejects.toMatchObject({code: "STORAGE_CONTEXT_LIMIT"});
        expect(opener.openCount()).toBe(2);

        await first.release();
        const retried = await pool.acquire({...address, contextId: "context-c"});
        expect(retried.handle).toBeDefined();
        await second.release();
        await retried.release();
    });

    it("在途释放仍占用容量，换 owner 不能绕过上限", async () => {
        const gate = Promise.withResolvers<void>();
        const opener = fakeOpener(gate.promise);
        const pool = new StorageHandlePool({openHandle: opener.openHandle, limits: {maxHandles: 1}});
        try {
            const first = await pool.acquire(address);
            const releasing = first.release();
            await expect(pool.acquire({...address, owner: "owner-b"}))
                .rejects.toMatchObject({code: "STORAGE_CONTEXT_LIMIT"});
            expect(opener.openCount()).toBe(1);
            gate.resolve();
            await releasing;
            const next = await pool.acquire({...address, owner: "owner-b"});
            await next.release();
        } finally {
            gate.resolve();
            await pool.close();
        }
    });

    it("在途打开也占用容量，容量检查不能只数已经打开的句柄", async () => {
        const openGate = Promise.withResolvers<void>();
        const handles: FakeHandle[] = [];
        const pool = new StorageHandlePool({
            openHandle: async () => {
                await openGate.promise;
                const handle: FakeHandle = {release: async () => undefined, releaseCount: () => 0};
                handles.push(handle);
                return handle as unknown as StorageHandle;
            },
            limits: {maxHandles: 1},
        });
        const pending = pool.acquire(address);
        await Promise.resolve();

        await expect(pool.acquire({...address, contextId: "context-b"}))
            .rejects.toMatchObject({code: "STORAGE_CONTEXT_LIMIT"});
        openGate.resolve();
        await pending;
        expect(handles).toHaveLength(1);
    });

    it("关闭等待已开始的释放：最后一名使用者释放后立刻关闭不会漏掉在途释放", async () => {
        const releaseGate = Promise.withResolvers<void>();
        let releases = 0;
        const pool = new StorageHandlePool({
            openHandle: async () => ({
                release: async () => {
                    releases += 1;
                    await releaseGate.promise;
                },
            }) as unknown as StorageHandle,
        });
        const lease = await pool.acquire(address);
        void lease.release();

        const closing = pool.close();
        let closed = false;
        void closing.then(() => { closed = true; });
        await Promise.all([Promise.resolve(), Promise.resolve()]);
        expect(releases).toBe(1);
        // 释放还没有结束：关闭必须等这次排空，不能因为句柄已不在条目上就提前返回。
        expect(closed).toBe(false);

        releaseGate.resolve();
        await closing;
        expect(releases).toBe(1);
    });

    it("关闭拒绝新取得、排空在途打开并释放已打开句柄", async () => {
        const openGate = Promise.withResolvers<void>();
        const releaseGate = Promise.withResolvers<void>();
        const handles: FakeHandle[] = [];
        const pool = new StorageHandlePool({
            openHandle: async () => {
                await openGate.promise;
                let releases = 0;
                const handle: FakeHandle = {
                    release: async () => {
                        releases += 1;
                        await releaseGate.promise;
                    },
                    releaseCount: () => releases,
                };
                handles.push(handle);
                return handle as unknown as StorageHandle;
            },
        });
        const pending = pool.acquire(address);

        const closing = pool.close();
        let closed = false;
        void closing.then(() => { closed = true; });
        await Promise.all([Promise.resolve(), Promise.resolve()]);
        expect(closed).toBe(false);

        openGate.resolve();
        // 打开竞态中产生的句柄不给使用者，并且立刻释放。
        await expect(pending).rejects.toMatchObject({code: "STORAGE_SERVICE_CLOSED"});
        expect(handles).toHaveLength(1);
        expect(handles[0]?.releaseCount()).toBe(1);
        // 这次释放同样属于关闭排空：竞态中打开的句柄不会被忘在池外。
        expect(closed).toBe(false);

        releaseGate.resolve();
        await closing;
        expect(handles[0]?.releaseCount()).toBe(1);

        await expect(pool.acquire(address)).rejects.toMatchObject({code: "STORAGE_SERVICE_CLOSED"});
        await pool.close();
    });
});
