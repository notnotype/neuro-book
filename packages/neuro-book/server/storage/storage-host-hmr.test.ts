import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {afterEach, describe, expect, it, vi} from "vitest";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {
    deriveStorageClientId,
    StorageAccessContextRegistry,
    type StorageAccessContextClaims,
} from "nbook/server/storage/access-context";

/** t23 的 V2 槽形状：只有访问上下文 registry，没有 service 与句柄池。 */
type PreviousStorageHostState = {
    readonly registry: StorageAccessContextRegistry;
    readonly pending: Set<Promise<unknown>>;
    closing: Promise<void> | null;
};

type StorageHostGlobals = {
    __nbookStorageHostV2?: PreviousStorageHostState;
    __nbookStorageHostV3?: unknown;
};

const hostGlobals = globalThis as unknown as StorageHostGlobals;

const claims: StorageAccessContextClaims = {
    scope: "user",
    storageRoot: absoluteFsPath(testHostPath("nbook-storage-host-hmr")),
    identityDomain: "3f0c9a1e-6d2b-4b0e-9f4a-2c1d8e7b5a90",
    rootIdentity: "1:2:3",
    subject: "user:7",
    sessionGeneration: "local",
    clientId: deriveStorageClientId("a".repeat(64)),
};

describe("Storage 宿主 HMR 换代", () => {
    afterEach(() => {
        delete hostGlobals.__nbookStorageHostV2;
        delete hostGlobals.__nbookStorageHostV3;
        vi.resetModules();
    });

    it("旧 V2 槽不原地复用：旧访问随换代关闭，新 owner 重新建立", async () => {
        const registry = new StorageAccessContextRegistry();
        const lease = registry.issue(claims);
        hostGlobals.__nbookStorageHostV2 = {registry, pending: new Set(), closing: null};
        delete hostGlobals.__nbookStorageHostV3;

        const host = await import("nbook/server/storage/host");

        // 形状不同的旧槽只被关闭：旧模块的核验、签发与释放都按“服务关闭”失败，
        // 既不半旧半新地继续服务，也不把旧访问带进新 owner。
        expect(() => registry.resolve(lease)).toThrowError(expect.objectContaining({code: "STORAGE_SERVICE_CLOSED"}));
        expect(() => registry.issue(claims)).toThrowError(expect.objectContaining({code: "STORAGE_SERVICE_CLOSED"}));
        expect(hostGlobals.__nbookStorageHostV3).toBeDefined();
        await host.disposeStorageHost();
    });

    it("换代设置旧宿主关闭标记，并把在途身份初始化纳入关闭排空", async () => {
        const gate = Promise.withResolvers<void>();
        const previous = {registry: new StorageAccessContextRegistry(), pending: new Set([gate.promise]), closing: null};
        hostGlobals.__nbookStorageHostV2 = previous;
        delete hostGlobals.__nbookStorageHostV3;
        vi.resetModules();
        const host = await import("nbook/server/storage/host");
        let closed = false;
        const closing = host.disposeStorageHost().then(() => { closed = true; });
        try {
            expect(previous.closing).not.toBeNull();
            await Promise.resolve();
            expect(closed).toBe(false);
        } finally {
            gate.resolve();
            await closing;
        }
        expect(closed).toBe(true);
    });

    it("同一槽版本的重载复用同一个 owner，不重复建立宿主", async () => {
        delete hostGlobals.__nbookStorageHostV2;
        delete hostGlobals.__nbookStorageHostV3;
        await import("nbook/server/storage/host");
        const owner = hostGlobals.__nbookStorageHostV3;

        vi.resetModules();
        const reloaded = await import("nbook/server/storage/host");

        expect(owner).toBeDefined();
        expect(hostGlobals.__nbookStorageHostV3).toBe(owner);
        await reloaded.disposeStorageHost();
    });
});
