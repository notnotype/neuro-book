import {join} from "node:path";
import {tmpdir} from "node:os";
import {EventEmitter} from "node:events";
import {createServer} from "node:http";
import type {H3Event} from "h3";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {PRODUCT_RUNTIME_EXIT_CODE_AGENT_SESSION_STORE_LEASE_COMPROMISED} from "@notnotype/neuro-book-contracts/product-runtime";
import {AgentSessionStoreLeaseCompromisedError} from "nbook/server/agent/session/agent-session-store-lease";
import type * as RuntimeModule from "nbook/server/runtime/product-startup";
import type {ProductRuntime, ProductStartOptions} from "nbook/server/runtime/product-startup";
import type {Scope} from "nbook/runtime/lifecycle/lifecycle";
import type {Application} from "nbook/runtime/application/application";
import type {AgentSessionMigrationRequiredError} from "nbook/server/agent/session/agent-session-store";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";

function productTestApplicationRoot(): string {
    return join(tmpdir(), "neuro-book-product-startup", "application");
}

function productTestStateRoot(): string {
    return join(tmpdir(), "neuro-book-product-startup", "state");
}

function productTestWorkspaceRoot(): string {
    return join(productTestStateRoot(), "workspace");
}
const mocks = vi.hoisted(() => ({
    releaseOrder: [] as string[],
    existsSync: vi.fn(() => true),
    mkdir: vi.fn(async () => undefined),
    inspectStateRootIntegrity: vi.fn(async () => ({kind: "clean"})),
    stateRootIntegrityFailed: vi.fn(() => false),
    assertProductMigrationsReady: vi.fn(async () => undefined),
    startAgentSessionStoreRuntime: vi.fn(async () => ({rootWorkspace: productTestWorkspaceRoot()})),
    stopAgentSessionStoreRuntime: vi.fn(async () => {mocks.releaseOrder.push("session");}),
    observeAgentSessionStoreRuntimeCompromised: vi.fn<() => Promise<{
        leasePath: string;
        kind: "runtime";
    }>>(),
    warn: vi.fn(async () => undefined),
    info: vi.fn<(event: string, data?: unknown) => Promise<void>>(async () => undefined),
    disposeAgentHarness: vi.fn(async () => {mocks.releaseOrder.push("agent");}),
    disposeStorageHost: vi.fn(async () => {mocks.releaseOrder.push("storage");}),
    closeAllWorkspaceTreeIndexes: vi.fn(async () => {mocks.releaseOrder.push("indexes");}),
    checkpointAppSqliteDatabase: vi.fn(async () => {mocks.releaseOrder.push("checkpoint");}),
    disconnectPrismaClient: vi.fn(async () => {mocks.releaseOrder.push("prisma");}),
    fatalSync: vi.fn(),
    writeSync: vi.fn(),
    flush: vi.fn(async () => {mocks.releaseOrder.push("logs");}),
    exit: vi.fn<(code: number) => void>(),
}));
vi.mock("node:fs/promises", () => ({mkdir: mocks.mkdir}));
vi.mock("node:fs", () => ({existsSync: mocks.existsSync, writeSync: mocks.writeSync}));
vi.mock("nbook/server/agent/http", () => ({disposeAgentHarness: mocks.disposeAgentHarness}));
vi.mock("nbook/server/storage/host", () => ({disposeStorageHost: mocks.disposeStorageHost}));
vi.mock("nbook/server/workspace-files/project-workspace-index", () => ({closeAllWorkspaceTreeIndexes: mocks.closeAllWorkspaceTreeIndexes}));
vi.mock("nbook/server/database/config", () => ({resolveDatabaseConfig: () => ({sqliteFilePath: join(productTestStateRoot(), "app.db")})}));
vi.mock("nbook/server/database/app-sqlite-migrations", () => ({checkpointAppSqliteDatabase: mocks.checkpointAppSqliteDatabase}));
vi.mock("nbook/server/database/prisma", () => ({disconnectPrismaClient: mocks.disconnectPrismaClient}));
vi.mock("nbook/server/runtime/paths/runtime-paths", () => ({
    runtimePathsFromEnv: () => ({
        applicationRoot: productTestApplicationRoot(),
        stateRoot: productTestStateRoot(),
        workspaceRoot: productTestWorkspaceRoot(),
    }),
}));
vi.mock("nbook/server/runtime/state-root-integrity", () => ({
    inspectStateRootIntegrity: mocks.inspectStateRootIntegrity,
    stateRootIntegrityFailed: mocks.stateRootIntegrityFailed,
}));
vi.mock("nbook/server/runtime/product-migration-gate", () => ({
    assertProductMigrationsReady: mocks.assertProductMigrationsReady,
}));
vi.mock("nbook/server/agent/session/agent-session-store-runtime", () => ({
    startAgentSessionStoreRuntime: mocks.startAgentSessionStoreRuntime,
    observeAgentSessionStoreRuntimeCompromised: mocks.observeAgentSessionStoreRuntimeCompromised,
    stopAgentSessionStoreRuntime: mocks.stopAgentSessionStoreRuntime,
}));
vi.mock("nbook/server/app-logs/logger", () => ({appLogger: {info: mocks.info, warn: mocks.warn, fatalSync: mocks.fatalSync, flush: mocks.flush}}));

let runtime: typeof RuntimeModule;
let product: ProductRuntime | undefined;
let MigrationRequiredError: typeof AgentSessionMigrationRequiredError;

function ready(options: ProductStartOptions = {}): Promise<void> {
    product ??= runtime.startProductRuntime({...options, exit: mocks.exit});
    return product.ready;
}

function stop(): Promise<void> {
    if (!product) throw new Error("测试尚未建立 Product application");
    return product.stop();
}

function application(): Application {
    if (!product) throw new Error("测试尚未建立 Product application");
    return product.application;
}

const dependencies = {
    "nbook.http": [],
    "nbook.app-state": [],
    "nbook.storage": ["nbook.app-state/ready"],
    "nbook.session-store": ["nbook.app-state/ready"],
    "nbook.project": ["nbook.session-store/runtime", "nbook.storage/ready"],
    "nbook.agent": ["nbook.session-store/runtime", "nbook.project/owner"],
    "nbook.files": ["nbook.project/owner"],
};

describe("Product startup", () => {
    beforeEach(async () => {
        product = undefined;
        vi.resetModules();
        MigrationRequiredError = (await import("nbook/server/agent/session/agent-session-store")).AgentSessionMigrationRequiredError;
        // 每个用例需要全新进程实例，重新加载模块级 singleton。
        runtime = await import("nbook/server/runtime/product-startup");
        vi.clearAllMocks();
        mocks.inspectStateRootIntegrity.mockResolvedValue({kind: "clean"});
        mocks.releaseOrder.length = 0;
        mocks.existsSync.mockReturnValue(true);
        mocks.info.mockResolvedValue(undefined);
        mocks.disposeAgentHarness.mockImplementation(async () => {mocks.releaseOrder.push("agent");});
        mocks.disposeStorageHost.mockImplementation(async () => {mocks.releaseOrder.push("storage");});
        mocks.closeAllWorkspaceTreeIndexes.mockImplementation(async () => {mocks.releaseOrder.push("indexes");});
        mocks.stopAgentSessionStoreRuntime.mockImplementation(async () => {mocks.releaseOrder.push("session");});
        mocks.checkpointAppSqliteDatabase.mockImplementation(async () => {mocks.releaseOrder.push("checkpoint");});
        mocks.disconnectPrismaClient.mockImplementation(async () => {mocks.releaseOrder.push("prisma");});
        mocks.stateRootIntegrityFailed.mockReturnValue(false);
        mocks.assertProductMigrationsReady.mockResolvedValue(undefined);
        mocks.startAgentSessionStoreRuntime.mockResolvedValue({rootWorkspace: productTestWorkspaceRoot()});
        mocks.observeAgentSessionStoreRuntimeCompromised.mockReturnValue(new Promise(() => undefined));
    });
    afterEach(async () => {
        mocks.disposeAgentHarness.mockResolvedValue(undefined);
        mocks.closeAllWorkspaceTreeIndexes.mockResolvedValue(undefined);
        mocks.disposeStorageHost.mockResolvedValue(undefined);
        mocks.stopAgentSessionStoreRuntime.mockResolvedValue(undefined);
        if (product && application().root.phase !== "closed") {
            if (application().root.phase === "stopping") await application().recover();
            else await application().stop();
        }
    });
    it("Project 插件可用前与关闭后均以 ProductRuntimeNotReadyError 拒绝创建 owner", async () => {
        const create = vi.fn((root: Scope) => ({root}));
        expect(() => runtime.productProjectOwner(create)).toThrow(runtime.ProductRuntimeNotReadyError);
        const migration = Promise.withResolvers<void>();
        mocks.assertProductMigrationsReady.mockReturnValue(migration.promise);
        const startup = ready();
        await vi.waitFor(() => expect(mocks.assertProductMigrationsReady).toHaveBeenCalledOnce());
        expect(() => runtime.productProjectOwner(create)).toThrow(runtime.ProductRuntimeNotReadyError);
        migration.resolve();
        await startup;
        const owner = runtime.productProjectOwner(create);
        expect(runtime.productProjectOwner(create)).toBe(owner);
        expect(owner.root).not.toBe(application().root);
        await stop();
        expect(() => runtime.productProjectOwner(create)).toThrow(runtime.ProductRuntimeNotReadyError);
        expect(create).toHaveBeenCalledOnce();
    });
    it("migration 未完成时不获取 lease，也不发布 HTTP ready", async () => {
        const migration = Promise.withResolvers<void>();
        mocks.assertProductMigrationsReady.mockReturnValue(migration.promise);
        const startup = ready();
        await vi.waitFor(() => expect(mocks.assertProductMigrationsReady).toHaveBeenCalledOnce());
        expect(mocks.startAgentSessionStoreRuntime).not.toHaveBeenCalled();
        migration.resolve();
        await startup;
        expect(mocks.startAgentSessionStoreRuntime).toHaveBeenCalledOnce();
    });

    it("按 Workspace、migration、Session Store 顺序完成完整 ready 门禁", async () => {
        await ready();

        expect(mocks.mkdir).toHaveBeenCalledWith(productTestWorkspaceRoot(), {recursive: true});
        expect(mocks.inspectStateRootIntegrity).toHaveBeenCalledWith({
            installationRoot: productTestApplicationRoot(),
            stateRoot: productTestStateRoot(),
        });
        expect(mocks.assertProductMigrationsReady).toHaveBeenCalledOnce();
        expect(mocks.startAgentSessionStoreRuntime).toHaveBeenCalledWith(productTestWorkspaceRoot());
        expect(mocks.mkdir.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.assertProductMigrationsReady.mock.invocationCallOrder[0]!,
        );
        expect(mocks.assertProductMigrationsReady.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.startAgentSessionStoreRuntime.mock.invocationCallOrder[0]!,
        );
    });

    it("CLI 启动函数在端口已占用时不监听，七个必需插件可用，stop 后实例关闭", async () => {
        const occupied = createServer();
        const listening = Promise.withResolvers<void>();
        occupied.once("error", listening.reject);
        occupied.listen(0, "127.0.0.1", listening.resolve);
        await listening.promise;
        const address = occupied.address();
        if (!address || typeof address === "string") throw new Error("测试未取得占用端口");
        vi.stubEnv("NITRO_PORT", String(address.port));
        try {
            await ready({mode: "cli", http: {listener: (_request, response) => response.end(), baseURL: "/"}});
            const catalog = application().plugins.catalog();
            expect(catalog.plugins.map((plugin) => plugin.id)).toEqual(Object.keys(dependencies).sort());
            for (const plugin of catalog.plugins) {
                expect(plugin.summary).toBe("available");
                expect(plugin.entries).toHaveLength(1);
                const entry = plugin.entries[0]!;
                expect(entry).toMatchObject({entry: "server", location: "server", state: {status: "available"}});
                expect(entry.dependencies).toEqual(dependencies[plugin.id as keyof typeof dependencies].map((key) => ({key, required: true})));
                expect(entry.provides).toHaveLength(1);
                expect(entry.provides[0]).toMatch(new RegExp(`^${plugin.id}/[^/]+$`));
            }
            await stop();
            expect(application().root.phase).toBe("closed");
            expect(mocks.releaseOrder.at(-1)).toBe("logs");
        } finally {
            vi.unstubAllEnvs();
            await new Promise<void>((resolve, reject) => occupied.close((error) => error ? reject(error) : resolve()));
        }
    });

    it("激活发布由依赖图保证每个提供方先于依赖者", async () => {
        await ready();
        const catalog = application().plugins.catalog();
        const published = application().plugins.diagnostics().filter((diagnostic) => diagnostic.reason === "published");
        expect(published).toHaveLength(7);
        for (const plugin of catalog.plugins) {
            for (const entry of plugin.entries) {
                for (const dependency of entry.dependencies) {
                    const provider = catalog.plugins.find((candidate) => candidate.entries.some((item) => item.provides.includes(dependency.key)))!;
                    expect(published.find((diagnostic) => diagnostic.plugin === provider.id)!.sequence)
                        .toBeLessThan(published.find((diagnostic) => diagnostic.plugin === plugin.id)!.sequence);
                }
            }
        }
    });

    it("停止按依赖逆序关闭 Agent、Project、索引与进程资源并为每个代次记录一次关闭", async () => {
        await ready();
        runtime.productProjectOwner((root) => {
            root.register({kind: "project-test", label: "owner", value: null, release: () => {mocks.releaseOrder.push("project");}});
            return {root};
        });
        await stop();
        const before = (first: string, second: string): void => {
            expect(mocks.releaseOrder.indexOf(first)).toBeGreaterThanOrEqual(0);
            expect(mocks.releaseOrder.indexOf(first)).toBeLessThan(mocks.releaseOrder.indexOf(second));
        };
        before("agent", "project");
        before("project", "indexes");
        before("indexes", "session");
        before("indexes", "storage");
        before("session", "checkpoint");
        before("storage", "checkpoint");
        before("checkpoint", "prisma");
        const diagnostics = application().plugins.diagnostics();
        const published = diagnostics.filter((diagnostic) => diagnostic.reason === "published");
        for (const generation of published) {
            const records = diagnostics.filter((diagnostic) => diagnostic.plugin === generation.plugin && diagnostic.entry === generation.entry && diagnostic.generation === generation.generation);
            expect(records.filter((diagnostic) => diagnostic.reason === "close-started")).toHaveLength(1);
            expect(records.filter((diagnostic) => diagnostic.reason === "closed")).toHaveLength(1);
        }
        const closed = diagnostics.filter((diagnostic) => diagnostic.reason === "closed");
        for (const plugin of application().plugins.catalog().plugins) {
            for (const dependency of plugin.entries[0]!.dependencies) {
                const provider = application().plugins.catalog().plugins.find((candidate) => candidate.entries[0]!.provides.includes(dependency.key))!;
                expect(closed.find((diagnostic) => diagnostic.plugin === plugin.id)!.sequence)
                    .toBeLessThan(closed.find((diagnostic) => diagnostic.plugin === provider.id)!.sequence);
            }
        }
    });

    it("插件释放抛错仍关闭独立插件并保留依赖，停止结果为 incomplete", async () => {
        await ready();
        mocks.stopAgentSessionStoreRuntime.mockRejectedValueOnce(new Error("session release failed"));
        await expect(stop()).rejects.toThrow("关闭不完整");
        expect(application().status().stop).toMatchObject({status: "incomplete"});
        expect((await product!.stopped).failures).toEqual([expect.objectContaining({message: "Product shutdown step 失败：product-runtime"})]);
        expect((await product!.stopped).exitCode).toBe(1);
        expect(mocks.releaseOrder.at(-1)).toBe("logs");
        expect(application().plugins.entryState({plugin: "nbook.agent", entry: "server"})?.status).toBe("closed");
        expect(application().plugins.entryState({plugin: "nbook.project", entry: "server"})?.status).toBe("closed");
        expect(application().plugins.entryState({plugin: "nbook.storage", entry: "server"})?.status).toBe("closed");
        expect(mocks.disposeStorageHost).toHaveBeenCalledOnce();
        expect(mocks.disconnectPrismaClient).not.toHaveBeenCalled();
        await expect(application().recover()).resolves.toEqual({status: "closed"});
        expect(mocks.disconnectPrismaClient).toHaveBeenCalledOnce();
    });

    it("并发启动共享同一门禁，停止后 lease 只释放一次", async () => {
        const first = ready();
        expect(ready()).toBe(first);
        await first;
        await stop();
        await stop();

        expect(mocks.startAgentSessionStoreRuntime).toHaveBeenCalledTimes(1);
        expect(mocks.stopAgentSessionStoreRuntime).toHaveBeenCalledTimes(1);
    });

    it("Project child释放失败时保留Session lease，显式恢复完成后才释放", async () => {
        await ready();
        let projectScope!: Scope;
        let ownerScope!: Scope;
        let failRelease = true;
        const releaseProject = vi.fn(() => {
            if (failRelease) throw new Error("project close failed");
        });
        runtime.productProjectOwner((root) => {
            const owner = root.createChild("project-owner-test");
            ownerScope = owner;
            projectScope = owner.createChild("project-generation-test");
            projectScope.register({
                kind: "project-generation",
                label: "test",
                value: null,
                release: releaseProject,
            });
            projectScope.open();
            owner.open();
            return {root: owner};
        });
        await expect(stop()).rejects.toThrow("关闭不完整");
        expect(mocks.stopAgentSessionStoreRuntime).not.toHaveBeenCalled();
        expect(projectScope.phase).toBe("stopping");
        expect(ownerScope.phase).toBe("stopping");
        expect(releaseProject).toHaveBeenCalledOnce();

        failRelease = false;
        const stopped = application().status().stop;
        if (stopped?.status !== "incomplete") throw new Error("关闭失败未产生 incomplete 报告");
        const recovery = await application().recover();
        expect(recovery).toEqual({status: "closed"});
        expect(mocks.disconnectPrismaClient).toHaveBeenCalledOnce();
        expect(mocks.stopAgentSessionStoreRuntime).toHaveBeenCalledOnce();
        expect(ownerScope.phase).toBe("closed");
        expect(projectScope.phase).toBe("closed");
        expect(releaseProject).toHaveBeenCalledTimes(2);
        expect(releaseProject.mock.invocationCallOrder[1]).toBeLessThan(
            mocks.stopAgentSessionStoreRuntime.mock.invocationCallOrder[0]!,
        );
        expect(releaseProject).toHaveBeenCalledTimes(2);
        expect(mocks.stopAgentSessionStoreRuntime).toHaveBeenCalledOnce();
    });


    it("Files 请求释放不关闭共享服务，应用停止后拒绝新请求", async () => {
        const binding = {target: {kind: "user-assets" as const, root: absoluteFsPath(join(productTestWorkspaceRoot(), ".nbook"))}, handles: undefined};
        await ready();
        await expect(runtime.withProductWorkspaceFiles(binding, async () => "first")).resolves.toBe("first");
        await expect(runtime.withProductWorkspaceFiles(binding, async () => "second")).resolves.toBe("second");
        await stop();
        await expect(runtime.withProductWorkspaceFiles(binding, async () => "late")).rejects.toThrow();
    });

    it("Files 在途操作未结束时不释放 Session lease", async () => {
        const binding = {target: {kind: "user-assets" as const, root: absoluteFsPath(join(productTestWorkspaceRoot(), ".nbook"))}, handles: undefined};
        const started = Promise.withResolvers<void>();
        const finish = Promise.withResolvers<void>();
        const aborted = Promise.withResolvers<void>();
        await ready();
        const request = runtime.withProductWorkspaceFiles(binding, async (_files, signal) => {
            signal.addEventListener("abort", () => aborted.resolve(), {once: true});
            started.resolve();
            await finish.promise;
        });
        const interrupted = expect(request).rejects.toThrow();
        await started.promise;
        const stopping = stop();
        await aborted.promise;
        expect(mocks.stopAgentSessionStoreRuntime).not.toHaveBeenCalled();
        finish.resolve();
        await interrupted;
        await stopping;
        expect(mocks.stopAgentSessionStoreRuntime).toHaveBeenCalledOnce();
    });

    it("关闭后不重新取得 lease", async () => {
        await ready();
        await stop();

        expect(() => runtime.startProductRuntime()).toThrow("已停止");
        expect(mocks.startAgentSessionStoreRuntime).toHaveBeenCalledTimes(1);
    });

    it("runtime lease compromised时记录fatal诊断并请求专用退出", async () => {
        let resolveCompromised!: (error: {leasePath: string; kind: "runtime"}) => void;
        mocks.observeAgentSessionStoreRuntimeCompromised.mockReturnValue(new Promise((resolvePromise) => {
            resolveCompromised = resolvePromise;
        }));

        await ready();
        const error = Object.assign(new Error("heartbeat lost"), {
            leasePath: join(productTestWorkspaceRoot(), ".nbook", "agent", "migrations", "runtime.lease"),
            kind: "runtime" as const,
        });
        resolveCompromised(error);
        expect((await product!.stopped).exitCode).toBe(PRODUCT_RUNTIME_EXIT_CODE_AGENT_SESSION_STORE_LEASE_COMPROMISED);

        expect(mocks.fatalSync).toHaveBeenCalledWith(
            "runtime.agentSessionStore.leaseCompromised",
            expect.objectContaining({
                leasePath: error.leasePath,
                kind: "runtime",
                staleMs: 30_000,
                heartbeatMs: 15_000,
            }),
            error,
            expect.stringContaining("有序关闭"),
        );
    });

    it("ready校验期间runtime lease compromised也走专用退出且不发布ready", async () => {
        const cause = new Error("heartbeat lost before ready");
        const error = new AgentSessionStoreLeaseCompromisedError(
            join(productTestWorkspaceRoot(), ".nbook", "agent", "migrations", "runtime.lease"),
            "runtime",
            cause,
        );
        mocks.startAgentSessionStoreRuntime.mockRejectedValue(error);

        await expect(ready()).rejects.toBe(error);
        expect((await product!.stopped).exitCode).toBe(PRODUCT_RUNTIME_EXIT_CODE_AGENT_SESSION_STORE_LEASE_COMPROMISED);
        expect(mocks.fatalSync).toHaveBeenCalledWith(
            "runtime.agentSessionStore.leaseCompromised",
            expect.objectContaining({leasePath: error.leasePath, kind: "runtime"}),
            error,
            expect.stringContaining("有序关闭"),
        );
    });

    it("runtime lease observer同步抛错时也请求专用退出且不产生未处理rejection", async () => {
        const observerFailure = new Error("runtime registry changed during startup");
        mocks.observeAgentSessionStoreRuntimeCompromised.mockImplementation(() => {
            throw observerFailure;
        });

        await expect(ready()).rejects.toThrow();
        expect((await product!.stopped).exitCode).toBe(PRODUCT_RUNTIME_EXIT_CODE_AGENT_SESSION_STORE_LEASE_COMPROMISED);
        expect(mocks.fatalSync).toHaveBeenCalledWith(
            "runtime.agentSessionStore.leaseObserverFailed",
            undefined,
            observerFailure,
            expect.stringContaining("有序关闭"),
        );
    });

    it("影子 Workspace 只记录证据，不自动修改用户数据", async () => {
        const stateIntegrity = {kind: "shadow-workspace"};
        mocks.inspectStateRootIntegrity.mockResolvedValue(stateIntegrity);
        mocks.stateRootIntegrityFailed.mockReturnValue(true);

        await ready();

        expect(mocks.warn).toHaveBeenCalledWith(
            "runtime.stateRoot.integrityFailed",
            {stateIntegrity},
            expect.stringContaining("不会自动处理用户数据"),
        );
    });

    it("migration 未 ready 时绝不取得 Session Store lease", async () => {
        const failure = new Error("migration pending\n请先执行 bun run migrate:application-state -- --apply");
        mocks.assertProductMigrationsReady.mockRejectedValue(failure);

        await expect(ready()).rejects.toBe(failure);
        expect(mocks.startAgentSessionStoreRuntime).not.toHaveBeenCalled();
        expect(application().plugins.diagnostics().filter((diagnostic) => diagnostic.plugin === "nbook.session-store" && diagnostic.reason === "published")).toEqual([]);
        expect(mocks.disconnectPrismaClient).toHaveBeenCalledOnce();
    });

    it("Session Store 迁移失败保留原原因、cause 和迁移命令提示", async () => {
        const failure = new MigrationRequiredError(2, null);
        mocks.startAgentSessionStoreRuntime.mockRejectedValue(failure);
        await expect(ready()).rejects.toMatchObject({
            cause: failure,
            message: `${failure.message}\n非 Manager 启动请先执行：bun run migrate:application-state -- --apply`,
        });
    });

    it("应用停止时 Agent 排空仍可取得已有 owner，Project 关闭后不再返回", async () => {
        await ready();
        const create = vi.fn((root: Scope) => ({root}));
        const owner = runtime.productProjectOwner(create);
        mocks.disposeAgentHarness.mockImplementation(async () => {
            expect(application().root.phase).toBe("stopping");
            expect(runtime.productProjectOwner(create)).toBe(owner);
            expect(owner.root.phase).toBe("available");
        });
        await stop();
        expect(create).toHaveBeenCalledOnce();
        expect(() => runtime.productProjectOwner(create)).toThrow(runtime.ProductRuntimeNotReadyError);
    });

    it("应用停止时 Agent 排空不能创建新的 Project owner", async () => {
        await ready();
        const create = vi.fn((root: Scope) => ({root}));
        mocks.disposeAgentHarness.mockImplementation(async () => {
            expect(() => runtime.productProjectOwner(create)).toThrow(runtime.ProductRuntimeNotReadyError);
        });
        await stop();
        expect(create).not.toHaveBeenCalled();
    });

    it("插件日志观察者同步抛错不影响启动与关闭", async () => {
        mocks.info.mockImplementation(() => {throw new Error("log unavailable");});
        await ready();
        await expect(stop()).resolves.toBeUndefined();
        expect(mocks.stopAgentSessionStoreRuntime).toHaveBeenCalledOnce();
    });

    it("信号、停止路由和租约失效先后到达只停止一次，75 后再请求 1 仍以 75 退出", async () => {
        const processSource = new EventEmitter();
        const compromised = Promise.withResolvers<{leasePath: string; kind: "runtime"}>();
        mocks.observeAgentSessionStoreRuntimeCompromised.mockReturnValue(compromised.promise);
        await ready({mode: "production", process: processSource});
        const response = new EventEmitter();
        await product!.http.admit({node: {res: response}} as H3Event);
        processSource.emit("SIGTERM", "SIGTERM");
        product!.requestStop("control:http");
        compromised.resolve(Object.assign(new Error("lease lost"), {leasePath: "runtime.lease", kind: "runtime" as const}));
        await vi.waitFor(() => expect(mocks.fatalSync).toHaveBeenCalledWith("runtime.agentSessionStore.leaseCompromised", expect.any(Object), expect.any(Error), expect.any(String)));
        product!.requestStop("startup:failed", 1);
        mocks.disposeAgentHarness.mockRejectedValueOnce(new Error("agent close failed"));
        expect(mocks.releaseOrder).toEqual([]);
        response.emit("finish");
        expect((await product!.stopped).exitCode).toBe(75);
        expect(product!.host.stopSource).toBe("signal:SIGTERM");
        expect(mocks.disposeAgentHarness).toHaveBeenCalledOnce();
        expect(mocks.exit).toHaveBeenCalledExactlyOnceWith(75);
        expect(processSource.listenerCount("SIGTERM")).toBe(0);
        await application().recover();
    });

    it("普通在途请求超出 20 秒后仍关闭其余插件，最后刷写日志并以 1 退出", async () => {
        let deadline: (() => void) | undefined;
        let duration: number | undefined;
        await ready({clock: {schedule(task, milliseconds) {deadline = task; duration = milliseconds; return () => undefined;}}});
        const response = new EventEmitter();
        await product!.http.admit({node: {res: response}} as H3Event);
        product!.requestStop("control:http");
        expect(duration).toBe(20_000);
        expect(mocks.releaseOrder).toEqual([]);
        deadline!();
        const result = await product!.stopped;
        expect(result.exitCode).toBe(1);
        expect(result.failures).toEqual([expect.objectContaining({message: "Product shutdown step 失败：http-drain"})]);
        expect(application().root.phase).toBe("closed");
        expect(mocks.releaseOrder.at(-1)).toBe("logs");
        response.emit("close");
    });

    it("插件释放仍在途时不刷写日志，释放完成后才结算停止", async () => {
        const release = Promise.withResolvers<void>();
        await ready();
        mocks.disposeAgentHarness.mockReturnValue(release.promise);
        const stopping = stop();
        await vi.waitFor(() => expect(mocks.disposeAgentHarness).toHaveBeenCalledOnce());
        expect(mocks.flush).not.toHaveBeenCalled();
        expect(mocks.exit).not.toHaveBeenCalled();
        release.resolve();
        await stopping;
        expect(mocks.flush).toHaveBeenCalledOnce();
        expect(mocks.exit).toHaveBeenCalledExactlyOnceWith(0);
    });

    it("正常停止以 0 结算，日志在所有插件关闭后刷写且重复 stop 共享结算", async () => {
        await ready();
        const left = stop();
        expect(stop()).toBe(left);
        await left;
        expect(mocks.exit).toHaveBeenCalledExactlyOnceWith(0);
        expect(mocks.releaseOrder.at(-1)).toBe("logs");
        expect(mocks.releaseOrder.slice(0, -1).sort()).toEqual(["agent", "checkpoint", "indexes", "prisma", "session", "storage"]);
    });

    it("最后日志刷写失败明确保留步骤原因并以 1 退出，不重新关闭插件", async () => {
        const failure = new Error("log flush failed");
        await ready();
        mocks.flush.mockRejectedValueOnce(failure);
        const stopping = stop();
        await expect(stopping).rejects.toMatchObject({errors: [expect.objectContaining({cause: failure})]});
        expect((await product!.stopped).exitCode).toBe(1);
        expect(mocks.exit).toHaveBeenCalledExactlyOnceWith(1);
        expect(mocks.disposeAgentHarness).toHaveBeenCalledOnce();
        expect(mocks.fatalSync).toHaveBeenCalledWith("product.shutdown.failed", undefined, failure, expect.any(String));
    });

    it("启动失败先同步写原因与迁移提示，再关闭已取得资源并以 1 退出，不产生未捕获异常", async () => {
        const failure = new Error("migration pending\n请先执行 bun run migrate:application-state -- --apply");
        mocks.assertProductMigrationsReady.mockRejectedValue(failure);
        const unhandled = vi.fn();
        process.on("unhandledRejection", unhandled);
        try {
            await expect(ready()).rejects.toBe(failure);
            expect((await product!.stopped).exitCode).toBe(1);
            expect(mocks.fatalSync).toHaveBeenCalledWith("runtime.startup.failed", undefined, failure, expect.any(String));
            expect(mocks.writeSync.mock.calls[0]?.[1]).toContain("runtime.startup.failed");
            expect(mocks.writeSync.mock.calls[0]?.[1]).toContain("bun run migrate:application-state -- --apply");
            expect(mocks.writeSync.mock.invocationCallOrder[0]).toBeLessThan(mocks.disconnectPrismaClient.mock.invocationCallOrder[0]!);
            expect(mocks.fatalSync.mock.invocationCallOrder[0]).toBeLessThan(mocks.disconnectPrismaClient.mock.invocationCallOrder[0]!);
            expect(mocks.releaseOrder).toEqual(["checkpoint", "prisma", "logs"]);
            expect(mocks.exit).toHaveBeenCalledWith(1);
            expect(unhandled).not.toHaveBeenCalled();
        } finally {
            process.off("unhandledRejection", unhandled);
        }
    });
});
