import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {createApp, defineEventHandler, toWebHandler} from "h3";
import {afterEach, describe, expect, it, vi} from "vitest";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {StorageStateRegistry} from "nbook/shared/storage/definition";
import {
    deriveStorageClientId,
    StorageAccessContextRegistry,
    type StorageAccessContextClaims,
} from "nbook/server/storage/access-context";

/**
 * 换代前的 V2 槽：访问上下文 registry 存在 `registry` 字段，没有 service 与句柄池。
 */
type PreviousStorageHostV2State = {
    readonly registry: StorageAccessContextRegistry;
    readonly pending: Set<Promise<unknown>>;
    closing: Promise<void> | null;
};

/**
 * 换代前的 V3 槽：`registry` 是状态定义注册表（不提供 `close()`），访问上下文在 `accessContexts`。
 *
 * 两者都不认 project 绑定，因此都不能被新模块原地复用；这里按真实字段构造，才能证明升级不调用
 * 旧槽上不存在的 `close()`。
 */
type PreviousStorageHostV3State = {
    readonly accessContexts: StorageAccessContextRegistry;
    readonly registry: StorageStateRegistry;
    readonly pending: Set<Promise<unknown>>;
    readonly service?: {close: () => Promise<void>};
    readonly pool?: {close: () => Promise<void>};
    closing: Promise<void> | null;
};

type StorageHostGlobals = {
    __nbookStorageHostV2?: PreviousStorageHostV2State;
    __nbookStorageHostV3?: PreviousStorageHostV3State;
    __nbookStorageHostV4?: unknown;
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
        delete hostGlobals.__nbookStorageHostV4;
        vi.unstubAllGlobals();
        vi.resetModules();
    });

    it("旧 V2 槽不原地复用：旧访问随换代关闭，新 owner 重新建立", async () => {
        const registry = new StorageAccessContextRegistry();
        const lease = registry.issue(claims);
        hostGlobals.__nbookStorageHostV2 = {registry, pending: new Set(), closing: null};
        delete hostGlobals.__nbookStorageHostV3;
        delete hostGlobals.__nbookStorageHostV4;

        const host = await import("nbook/server/storage/host");

        // 形状不同的旧槽只被关闭：旧模块的核验、签发与释放都按“服务关闭”失败，
        // 既不半旧半新地继续服务，也不把旧访问带进新 owner。
        expect(() => registry.resolve(lease)).toThrowError(expect.objectContaining({code: "STORAGE_SERVICE_CLOSED"}));
        expect(() => registry.issue(claims)).toThrowError(expect.objectContaining({code: "STORAGE_SERVICE_CLOSED"}));
        expect(hostGlobals.__nbookStorageHostV4).toBeDefined();
        await host.disposeStorageHost();
    });

    it("旧 V3 槽按真实形状交接：只关访问上下文、service 与句柄池", async () => {
        const accessContexts = new StorageAccessContextRegistry();
        const lease = accessContexts.issue(claims);
        const serviceClose = vi.fn(async () => undefined);
        const poolClose = vi.fn(async () => undefined);
        // 真实 V3 槽的 `registry` 是状态定义注册表，它没有 `close()`：升级不能调用不存在的成员。
        hostGlobals.__nbookStorageHostV3 = {
            accessContexts,
            registry: new StorageStateRegistry(),
            pending: new Set(),
            service: {close: serviceClose},
            pool: {close: poolClose},
            closing: null,
        };
        delete hostGlobals.__nbookStorageHostV2;
        delete hostGlobals.__nbookStorageHostV4;

        const host = await import("nbook/server/storage/host");
        expect(hostGlobals.__nbookStorageHostV4).toBeDefined();
        await host.disposeStorageHost();

        expect(serviceClose).toHaveBeenCalledOnce();
        expect(poolClose).toHaveBeenCalledOnce();
        expect(() => accessContexts.resolve(lease)).toThrowError(expect.objectContaining({code: "STORAGE_SERVICE_CLOSED"}));
    });

    it("旧槽关闭失败不被掩盖：新 owner 不接纳任何操作", async () => {
        const failure = new Error("旧访问上下文关闭失败");
        hostGlobals.__nbookStorageHostV3 = {
            accessContexts: {close: async () => { throw failure; }} as unknown as StorageAccessContextRegistry,
            registry: new StorageStateRegistry(),
            pending: new Set(),
            closing: null,
        };
        delete hostGlobals.__nbookStorageHostV2;
        delete hostGlobals.__nbookStorageHostV4;
        vi.stubGlobal("defineEventHandler", defineEventHandler);
        const host = await import("nbook/server/storage/host");
        const route = await import("nbook/server/api/storage/user/context.post");
        const app = createApp();
        app.use("/api/storage/user/context", defineEventHandler((event) => route.default(event)));
        const send = toWebHandler(app);

        // 旧资源没有收口时，新 owner 不能被当成可服务：请求以交接失败结束，而不是静默开工。
        const response = await send(new Request("http://localhost/api/storage/user/context", {method: "POST"}));
        expect(response.status).toBe(500);
        await host.disposeStorageHost();
    });

    it("换代设置旧宿主关闭标记，并把在途身份初始化纳入关闭排空", async () => {
        const gate = Promise.withResolvers<void>();
        const previous = {registry: new StorageAccessContextRegistry(), pending: new Set([gate.promise]), closing: null};
        hostGlobals.__nbookStorageHostV2 = previous;
        delete hostGlobals.__nbookStorageHostV3;
        delete hostGlobals.__nbookStorageHostV4;
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
        delete hostGlobals.__nbookStorageHostV4;
        await import("nbook/server/storage/host");
        const owner = hostGlobals.__nbookStorageHostV4;

        vi.resetModules();
        const reloaded = await import("nbook/server/storage/host");

        expect(owner).toBeDefined();
        expect(hostGlobals.__nbookStorageHostV4).toBe(owner);
        await reloaded.disposeStorageHost();
    });

    it("旧宿主 pending 未收口时，新 owner 的请求不会开始", async () => {
        const gate = Promise.withResolvers<void>();
        const previous = {registry: new StorageAccessContextRegistry(), pending: new Set([gate.promise]), closing: null};
        hostGlobals.__nbookStorageHostV2 = previous;
        delete hostGlobals.__nbookStorageHostV3;
        delete hostGlobals.__nbookStorageHostV4;
        vi.resetModules();
        vi.stubGlobal("defineEventHandler", defineEventHandler);
        // 路由模块在 `defineEventHandler` 就位后才加载：这里的动态导入是模块加载边界，不是运行期选择。
        const host = await import("nbook/server/storage/host");
        const route = await import("nbook/server/api/storage/user/context.post");
        const app = createApp();
        app.use("/api/storage/user/context", defineEventHandler((event) => route.default(event)));
        const send = toWebHandler(app);

        // 缺少客户端凭证的请求仍然先等 ready：新宿主在旧 pending 收口前不进入任何核验，
        // 因此它既不会碰默认 data，也不会用新 owner 的身份元数据覆盖旧宿主。
        const pending = send(new Request("http://localhost/api/storage/user/context", {method: "POST"}));
        let settled = false;
        void pending.then(() => { settled = true; }, () => { settled = true; });
        // 推进一整轮事件循环（而不是等待一个时长）：请求该完成的微任务与 I/O 回调都已跑完。
        await new Promise<void>((resolve) => { setImmediate(resolve); });
        expect(settled).toBe(false);

        gate.resolve();
        const response = await pending;
        expect(response.status).toBe(400);
        await host.disposeStorageHost();
    });
});
