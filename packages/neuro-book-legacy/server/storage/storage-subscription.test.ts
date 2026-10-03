import {afterEach, describe, expect, it, vi} from "vitest";
import type {StorageReadResult} from "nbook/shared/storage/contract";
import {StorageSubscriptionHub} from "nbook/server/storage/storage-subscription";

const hubs: StorageSubscriptionHub[] = [];
afterEach(async () => { await Promise.all(hubs.splice(0).map((hub) => hub.closeAll())); });

function hub(): StorageSubscriptionHub {
    const result = new StorageSubscriptionHub({pollIntervalMs: 20});
    hubs.push(result);
    return result;
}

function snapshot(revision: string): StorageReadResult<string> {
    return {kind: "value", value: revision, schemaVersion: 1, credential: {revision, partitionGeneration: 1}};
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return {promise, resolve};
}

describe("Storage 订阅观察和收口", () => {
    it("持续观察另一服务的变化，无需调用 refresh 或 notify", async () => {
        const observer = hub();
        let current = snapshot("a");
        const onUpdate = vi.fn();
        await observer.open({identity: "record", owner: "test.owner", read: async () => current}, {onUpdate});
        current = snapshot("b");
        await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledWith(current));
    });

    it("refresh 与通知共用读取队列，迟到读取不能倒退快照", async () => {
        const observer = hub();
        const delayed = deferred<StorageReadResult<string>>();
        let reads = 0;
        const onUpdate = vi.fn();
        const subscription = await observer.open({identity: "record", owner: "test.owner", read: async () => {
            reads += 1;
            return reads === 1 ? snapshot("a") : reads === 2 ? delayed.promise : snapshot("c");
        }}, {onUpdate});
        const first = subscription.refresh();
        await vi.waitFor(() => expect(reads).toBe(2));
        const second = subscription.refresh();
        observer.notify("record");
        await new Promise<void>((done) => setImmediate(done));
        expect(reads).toBe(2);
        delayed.resolve(snapshot("b"));
        await Promise.all([first, second]);
        expect(onUpdate.mock.calls.map(([value]) => value.value)).toEqual(["b", "c"]);
    });

    it("首次读取失败不遗留观察者", async () => {
        const observer = hub();
        const read = vi.fn().mockRejectedValue(new Error("read failed"));
        await expect(observer.open({identity: "record", owner: "test.owner", read}, {})).rejects.toThrow("read failed");
        observer.notify("record");
        await observer.closeAll();
        expect(read).toHaveBeenCalledTimes(1);
    });

    it("关闭排空初始读取，重复关闭等待同一收口", async () => {
        const observer = hub();
        const delayed = deferred<StorageReadResult<string>>();
        const opening = observer.open({identity: "record", owner: "test.owner", read: () => delayed.promise}, {});
        let finished = false;
        const closing = observer.closeAll();
        const again = observer.closeAll().then(() => { finished = true; });
        await new Promise<void>((done) => setImmediate(done));
        expect(finished).toBe(false);
        delayed.resolve(snapshot("a"));
        const subscription = await opening;
        await Promise.all([closing, again]);
        await expect(subscription.refresh()).rejects.toMatchObject({code: "STORAGE_HANDLE_CLOSED", reason: "service-closed"});
    });

    it("订阅关闭等待在途读取，关闭后不投递且不再读取", async () => {
        const observer = hub();
        const delayed = deferred<StorageReadResult<string>>();
        const read = vi.fn().mockResolvedValueOnce(snapshot("a")).mockImplementation(() => delayed.promise);
        const onUpdate = vi.fn();
        const subscription = await observer.open({identity: "record", owner: "test.owner", read}, {onUpdate});
        const refresh = subscription.refresh();
        await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
        let closed = false;
        const closing = subscription.close().then(() => { closed = true; });
        await new Promise<void>((done) => setImmediate(done));
        expect(closed).toBe(false);
        delayed.resolve(snapshot("b"));
        await Promise.all([refresh, closing]);
        expect(onUpdate).not.toHaveBeenCalled();
        await expect(subscription.refresh()).rejects.toMatchObject({code: "STORAGE_HANDLE_CLOSED"});
        expect(read).toHaveBeenCalledTimes(2);
    });

    it("onError 自身抛异常也不形成未处理 rejection", async () => {
        const observer = hub();
        let current = snapshot("a");
        const onError = vi.fn(() => { throw new Error("error listener failed"); });
        const subscription = await observer.open({identity: "record", owner: "test.owner", read: async () => current}, {
            onUpdate: () => { throw new Error("listener failed"); }, onError,
        });
        current = snapshot("b");
        await expect(subscription.refresh()).resolves.toEqual(current);
        expect(onError).toHaveBeenCalledTimes(1);
    });
});
