import {describe, expect, it} from "vitest";
import {isStorageClientCredential} from "nbook/shared/storage/host";
import {clearStorageClientIdentity, loadOrCreateStorageClientIdentity} from "nbook/app/utils/storage/client-identity";

/**
 * 最小 IndexedDB 替身：只实现提供者使用的 open/transaction/object store 表面，
 * 用来确定性地覆盖失败分类。真实同源事务语义由 Chromium 隔离宿主验证，不用两个 Map 冒充。
 */
type FakeSeed = {
    stored?: unknown;
    openFailure?: "throw" | "error" | "blocked";
    transactionFailure?: "throw" | "abort" | "error";
    /** 真实 IndexedDB 可能在 onblocked 之后才交付连接；这个迟到连接必须被关闭。 */
    lateConnectionAfterBlocked?: boolean;
};

type FakeHandler = (() => void) | null;

type FakeRequest = {
    result: unknown;
    error: unknown;
    onsuccess: FakeHandler;
    onerror: FakeHandler;
    onupgradeneeded: FakeHandler;
    onblocked: FakeHandler;
};

type FakeTransaction = {
    error: unknown;
    oncomplete: FakeHandler;
    onerror: FakeHandler;
    onabort: FakeHandler;
    objectStore: (name: string) => {
        get: (key: string) => FakeRequest;
        put: (value: unknown, key: string) => FakeRequest;
        delete: (key: string) => FakeRequest;
    };
};

/** 连接是否仍打开由测试观察：提供者必须在一次操作结束后关闭它交付的连接。 */
type FakeConnection = {
    closed: boolean;
    onversionchange: (() => void) | null;
    readonly objectStoreNames: {contains: (name: string) => boolean};
    readonly createObjectStore: (name: string) => void;
    readonly close: () => void;
    readonly transaction: () => FakeTransaction;
};

type FakeState = {
    stored: unknown;
    readonly connections: FakeConnection[];
    /** onblocked 之后交付迟到连接的完成信号：测试等它而不是等固定时长。 */
    readonly lateDelivery: Promise<void>;
};

function createFakeTarget(seed: FakeSeed): {readonly indexedDB: IDBFactory; readonly state: FakeState} {
    const lateDelivery = Promise.withResolvers<void>();
    const state: FakeState = {stored: seed.stored, connections: [], lateDelivery: lateDelivery.promise};

    const createConnection = (): FakeConnection => {
        const connection: FakeConnection = {
            closed: false,
            onversionchange: null,
            objectStoreNames: {contains: () => true},
            createObjectStore: () => undefined,
            close: () => {
                connection.closed = true;
            },
            transaction: () => {
                // 真实 IndexedDB 在连接被关闭或数据库被删除后让事务抛 InvalidStateError。
                if (connection.closed) throw new Error("fake connection closed");
                if (seed.transactionFailure === "throw") throw new Error("fake transaction denied");
                return createTransaction();
            },
        };
        state.connections.push(connection);
        return connection;
    };

    const createRequest = (): FakeRequest => ({
        result: undefined,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        onblocked: null,
    });

    const fail = (transaction: FakeTransaction) => {
        const failure = seed.transactionFailure;
        if (failure === "abort" || failure === "error") {
            transaction.error = new Error(`fake transaction ${failure}`);
            if (failure === "abort") transaction.onabort?.();
            else {transaction.onerror?.(); transaction.onabort?.();}
            return true;
        }
        return false;
    };

    const settle = (transaction: FakeTransaction, request: FakeRequest, apply: () => void) => {
        queueMicrotask(() => {
            if (fail(transaction)) return;
            apply();
            request.onsuccess?.();
            transaction.oncomplete?.();
        });
    };

    const createTransaction = (): FakeTransaction => {
        const transaction: FakeTransaction = {
            error: null,
            oncomplete: null,
            onerror: null,
            onabort: null,
            objectStore: () => ({
                get: () => {
                    const request = createRequest();
                    settle(transaction, request, () => {
                        request.result = state.stored;
                    });
                    return request;
                },
                put: (value: unknown) => {
                    const request = createRequest();
                    settle(transaction, request, () => {
                        state.stored = value;
                    });
                    return request;
                },
                delete: () => {
                    const request = createRequest();
                    settle(transaction, request, () => {
                        state.stored = undefined;
                    });
                    return request;
                },
            }),
        };
        return transaction;
    };

    const factory = {
        open: () => {
            if (seed.openFailure === "throw") throw new Error("fake open denied");
            const request = createRequest();
            queueMicrotask(() => {
                if (seed.openFailure === "error") {
                    request.error = new Error("fake open failed");
                    request.onerror?.();
                    return;
                }
                if (seed.openFailure === "blocked") {
                    request.onblocked?.();
                    queueMicrotask(() => {
                        if (!seed.lateConnectionAfterBlocked) return;
                        request.result = createConnection();
                        request.onsuccess?.();
                        lateDelivery.resolve();
                    });
                    return;
                }
                request.result = createConnection();
                request.onsuccess?.();
            });
            return request;
        },
    };

    return {indexedDB: factory as unknown as IDBFactory, state};
}

describe("loadOrCreateStorageClientIdentity", () => {
    it("首次初始化生成并提交新凭证，重复读取复用同一份", async () => {
        const target = createFakeTarget({});
        const created = await loadOrCreateStorageClientIdentity(target);
        expect(created.status).toBe("ready");
        if (created.status !== "ready") return;
        expect(isStorageClientCredential(created.credential)).toBe(true);
        expect(target.state.stored).toBe(created.credential);

        await expect(loadOrCreateStorageClientIdentity(target)).resolves.toEqual(created);
    });

    it("已有本合同凭证时直接复用，不重新生成", async () => {
        const credential = "0123456789abcdef".repeat(4);
        const target = createFakeTarget({stored: credential});
        await expect(loadOrCreateStorageClientIdentity(target)).resolves.toEqual({status: "ready", credential});
        expect(target.state.stored).toBe(credential);
    });

    it("已有记录不是本合同凭证时返回不可恢复且不覆盖未知内容", async () => {
        const target = createFakeTarget({stored: "legacy-secret"});
        await expect(loadOrCreateStorageClientIdentity(target)).resolves.toMatchObject({
            status: "unrecoverable",
            reason: "invalid-record",
        });
        expect(target.state.stored).toBe("legacy-secret");
    });

    it("宿主没有 IndexedDB 或随机源时返回不可恢复", async () => {
        const denied = {get indexedDB(): IDBFactory {throw new Error("denied");}};
        await expect(loadOrCreateStorageClientIdentity(denied)).resolves.toMatchObject({status: "unrecoverable", reason: "unavailable"});
        await expect(clearStorageClientIdentity(denied)).resolves.toMatchObject({status: "unrecoverable", reason: "unavailable"});
        await expect(loadOrCreateStorageClientIdentity({indexedDB: null})).resolves.toMatchObject({
            status: "unrecoverable",
            reason: "unavailable",
        });
        await expect(loadOrCreateStorageClientIdentity({...createFakeTarget({}), crypto: null})).resolves.toMatchObject({
            status: "unrecoverable",
            reason: "unavailable",
        });
    });

    it("打开数据库被阻塞、失败或拒绝时分别返回不可恢复原因", async () => {
        await expect(loadOrCreateStorageClientIdentity(createFakeTarget({openFailure: "blocked"}))).resolves.toMatchObject({
            status: "unrecoverable",
            reason: "blocked",
        });
        await expect(loadOrCreateStorageClientIdentity(createFakeTarget({openFailure: "error"}))).resolves.toMatchObject({
            status: "unrecoverable",
            reason: "read-failed",
        });
        await expect(loadOrCreateStorageClientIdentity(createFakeTarget({openFailure: "throw"}))).resolves.toMatchObject({
            status: "unrecoverable",
            reason: "unavailable",
        });
    });

    it("事务中止、事务失败或无法开始事务时分别返回不可恢复原因", async () => {
        await expect(loadOrCreateStorageClientIdentity(createFakeTarget({transactionFailure: "abort"}))).resolves.toMatchObject({
            status: "unrecoverable",
            reason: "aborted",
        });
        await expect(loadOrCreateStorageClientIdentity(createFakeTarget({transactionFailure: "error"}))).resolves.toMatchObject({
            status: "unrecoverable",
            reason: "write-failed",
        });
        await expect(loadOrCreateStorageClientIdentity(createFakeTarget({transactionFailure: "throw"}))).resolves.toMatchObject({
            status: "unrecoverable",
            reason: "read-failed",
        });
    });

    it("打开失败不进入缓存，恢复后可以重新初始化", async () => {
        const seed: FakeSeed = {openFailure: "error"};
        const target = createFakeTarget(seed);
        await expect(loadOrCreateStorageClientIdentity(target)).resolves.toMatchObject({status: "unrecoverable"});
        seed.openFailure = undefined;
        const retried = await loadOrCreateStorageClientIdentity(target);
        expect(retried.status).toBe("ready");
    });

    it("每次调用打开独立连接并在结束后关闭，连接失效后下一次调用重新打开", async () => {
        const target = createFakeTarget({});
        await expect(loadOrCreateStorageClientIdentity(target)).resolves.toMatchObject({status: "ready"});
        // 连接在操作结束后已经关闭；下一次调用必须重新打开，而不是复用那个句柄。
        await expect(loadOrCreateStorageClientIdentity(target)).resolves.toMatchObject({status: "ready"});
        await expect(clearStorageClientIdentity(target)).resolves.toEqual({status: "cleared"});

        expect(target.state.connections.map((connection) => connection.closed)).toEqual([true, true, true]);
    });

    it("操作失败时同样不留下打开连接", async () => {
        const target = createFakeTarget({transactionFailure: "abort"});
        await expect(loadOrCreateStorageClientIdentity(target)).resolves.toMatchObject({
            status: "unrecoverable",
            reason: "aborted",
        });
        expect(target.state.connections.map((connection) => connection.closed)).toEqual([true]);
    });

    it("被阻塞返回不可恢复后，迟到的成功连接会被关闭", async () => {
        const target = createFakeTarget({openFailure: "blocked", lateConnectionAfterBlocked: true});
        await expect(loadOrCreateStorageClientIdentity(target)).resolves.toMatchObject({
            status: "unrecoverable",
            reason: "blocked",
        });
        await target.state.lateDelivery;
        expect(target.state.connections.map((connection) => connection.closed)).toEqual([true]);
    });
});

describe("clearStorageClientIdentity", () => {
    it("清除后重新初始化得到新身份，旧凭证不再出现", async () => {
        const credential = "abcdef0123456789".repeat(4);
        const target = createFakeTarget({stored: credential});
        await expect(clearStorageClientIdentity(target)).resolves.toEqual({status: "cleared"});
        expect(target.state.stored).toBeUndefined();

        const recreated = await loadOrCreateStorageClientIdentity(target);
        expect(recreated.status).toBe("ready");
        if (recreated.status !== "ready") return;
        expect(recreated.credential).not.toBe(credential);
    });

    it("存储不可用时返回不可恢复，不伪装成已清除", async () => {
        await expect(clearStorageClientIdentity({indexedDB: null})).resolves.toMatchObject({
            status: "unrecoverable",
            reason: "unavailable",
        });
    });
});
