import {join} from "node:path";
import {tmpdir} from "node:os";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {PRODUCT_RUNTIME_EXIT_CODE_AGENT_SESSION_STORE_LEASE_COMPROMISED} from "@notnotype/neuro-book-contracts/product-runtime";
import {AgentSessionStoreLeaseCompromisedError} from "nbook/server/agent/session/agent-session-store-lease";
import type {exitOnProductStartupFailure, productRuntimeReady, stopProductRuntime, productProjectOwner, withProductWorkspaceFiles, ProductRuntimeNotReadyError} from "nbook/server/runtime/product-startup";
import type {Scope} from "nbook/runtime/lifecycle/lifecycle";
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
    mkdir: vi.fn(async () => undefined),
    inspectStateRootIntegrity: vi.fn(async () => ({kind: "clean"})),
    stateRootIntegrityFailed: vi.fn(() => false),
    assertProductMigrationsReady: vi.fn(async () => undefined),
    startAgentSessionStoreRuntime: vi.fn(async () => ({rootWorkspace: productTestWorkspaceRoot()})),
    stopAgentSessionStoreRuntime: vi.fn(async () => undefined),
    observeAgentSessionStoreRuntimeCompromised: vi.fn<() => Promise<{
        leasePath: string;
        kind: "runtime";
    }>>(),
    warn: vi.fn(async () => undefined),
    fatalSync: vi.fn(),
    requestProcessExit: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({mkdir: mocks.mkdir}));
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
vi.mock("nbook/server/app-logs/logger", () => ({appLogger: {warn: mocks.warn, fatalSync: mocks.fatalSync}}));
vi.mock("nbook/server/runtime/shutdown/product-shutdown", () => ({
    productShutdownController: {requestProcessExit: mocks.requestProcessExit},
}));

let runtime: {
    productRuntimeReady: typeof productRuntimeReady;
    stopProductRuntime: typeof stopProductRuntime;
    productProjectOwner: typeof productProjectOwner;
    withProductWorkspaceFiles: typeof withProductWorkspaceFiles;
    exitOnProductStartupFailure: typeof exitOnProductStartupFailure;
    ProductRuntimeNotReadyError: typeof ProductRuntimeNotReadyError;
};
const productGlobals = globalThis as typeof globalThis & {__nbookProductApplicationV1?: unknown};

describe("Product startup", () => {
    beforeEach(async () => {
        delete productGlobals.__nbookProductApplicationV1;
        vi.resetModules();
        // 每个用例需要全新进程实例，重新加载模块级 singleton。
        runtime = await import("nbook/server/runtime/product-startup");
        vi.clearAllMocks();
        mocks.inspectStateRootIntegrity.mockResolvedValue({kind: "clean"});
        mocks.stateRootIntegrityFailed.mockReturnValue(false);
        mocks.assertProductMigrationsReady.mockResolvedValue(undefined);
        mocks.startAgentSessionStoreRuntime.mockResolvedValue({rootWorkspace: productTestWorkspaceRoot()});
        mocks.observeAgentSessionStoreRuntimeCompromised.mockReturnValue(new Promise(() => undefined));
    });
    it("Product Runtime 未ready时以typed error拒绝创建Project owner", () => {
        expect(() => runtime.productProjectOwner(() => ({root: {} as Scope}))).toThrow(runtime.ProductRuntimeNotReadyError);
    });
    it("migration 未完成时不获取 lease，也不发布 HTTP ready", async () => {
        const migration = Promise.withResolvers<void>();
        mocks.assertProductMigrationsReady.mockReturnValue(migration.promise);
        const ready = runtime.productRuntimeReady();
        await vi.waitFor(() => expect(mocks.assertProductMigrationsReady).toHaveBeenCalledOnce());
        expect(mocks.startAgentSessionStoreRuntime).not.toHaveBeenCalled();
        migration.resolve();
        await ready;
        expect(mocks.startAgentSessionStoreRuntime).toHaveBeenCalledOnce();
    });

    it("按 Workspace、migration、Session Store 顺序完成完整 ready 门禁", async () => {
        await runtime.productRuntimeReady();

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
    it("并发启动共享同一门禁，停止后 lease 只释放一次", async () => {
        const first = runtime.productRuntimeReady();
        expect(runtime.productRuntimeReady()).toBe(first);
        await first;
        await runtime.stopProductRuntime();
        await runtime.stopProductRuntime();

        expect(mocks.startAgentSessionStoreRuntime).toHaveBeenCalledTimes(1);
        expect(mocks.stopAgentSessionStoreRuntime).toHaveBeenCalledTimes(1);
    });

    it("Project child释放失败时根停止不释放Session lease，显式recover完成后才释放", async () => {
        await runtime.productRuntimeReady();
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
        await expect(runtime.stopProductRuntime()).rejects.toThrow("关闭不完整");
        expect(mocks.stopAgentSessionStoreRuntime).not.toHaveBeenCalled();
        expect(projectScope.phase).toBe("stopping");
        expect(ownerScope.phase).toBe("stopping");
        expect(releaseProject).toHaveBeenCalledOnce();

        failRelease = false;
        const state = productGlobals.__nbookProductApplicationV1 as {application: {recover(): Promise<{status: string}>}};
        await expect(state.application.recover()).resolves.toMatchObject({status: "closed"});
        expect(mocks.stopAgentSessionStoreRuntime).toHaveBeenCalledOnce();
        expect(ownerScope.phase).toBe("closed");
        expect(projectScope.phase).toBe("closed");
        expect(releaseProject).toHaveBeenCalledTimes(2);
        expect(releaseProject.mock.invocationCallOrder[1]).toBeLessThan(
            mocks.stopAgentSessionStoreRuntime.mock.invocationCallOrder[0]!,
        );
    });

    it("同一 realm 模块重载复用仍活门禁（不模拟 Nitro Dev 跨 worker）", async () => {
        const ready = runtime.productRuntimeReady();
        await ready;
        vi.resetModules();
        const hotReloaded = await import("nbook/server/runtime/product-startup");

        expect(hotReloaded.productRuntimeReady()).toBe(ready);
        expect(mocks.startAgentSessionStoreRuntime).toHaveBeenCalledTimes(1);
        await expect(hotReloaded.withProductWorkspaceFiles({target: {kind: "user-assets", root: absoluteFsPath(join(productTestWorkspaceRoot(), ".nbook"))}, handles: undefined}, async () => "reloaded")).resolves.toBe("reloaded");
        await hotReloaded.stopProductRuntime();
        expect(mocks.stopAgentSessionStoreRuntime).toHaveBeenCalledTimes(1);
    });

    it("Files 请求释放不关闭共享服务，应用停止后拒绝新请求", async () => {
        const binding = {target: {kind: "user-assets" as const, root: absoluteFsPath(join(productTestWorkspaceRoot(), ".nbook"))}, handles: undefined};
        await expect(runtime.withProductWorkspaceFiles(binding, async () => "first")).resolves.toBe("first");
        await expect(runtime.withProductWorkspaceFiles(binding, async () => "second")).resolves.toBe("second");
        await runtime.stopProductRuntime();
        await expect(runtime.withProductWorkspaceFiles(binding, async () => "late")).rejects.toThrow();
    });

    it("Files 在途操作未结束时不释放 Session lease", async () => {
        const binding = {target: {kind: "user-assets" as const, root: absoluteFsPath(join(productTestWorkspaceRoot(), ".nbook"))}, handles: undefined};
        const started = Promise.withResolvers<void>();
        const finish = Promise.withResolvers<void>();
        const aborted = Promise.withResolvers<void>();
        const request = runtime.withProductWorkspaceFiles(binding, async (_files, signal) => {
            signal.addEventListener("abort", () => aborted.resolve(), {once: true});
            started.resolve();
            await finish.promise;
        });
        const interrupted = expect(request).rejects.toThrow();
        await started.promise;
        const stopping = runtime.stopProductRuntime();
        await aborted.promise;
        expect(mocks.stopAgentSessionStoreRuntime).not.toHaveBeenCalled();
        finish.resolve();
        await interrupted;
        await stopping;
        expect(mocks.stopAgentSessionStoreRuntime).toHaveBeenCalledOnce();
    });

    it("关闭后不重新取得 lease", async () => {
        await runtime.productRuntimeReady();
        await runtime.stopProductRuntime();

        await expect(runtime.productRuntimeReady()).rejects.toThrow("已停止");
        expect(mocks.startAgentSessionStoreRuntime).toHaveBeenCalledTimes(1);
    });

    it("runtime lease compromised时记录fatal诊断并请求专用退出", async () => {
        let resolveCompromised!: (error: {leasePath: string; kind: "runtime"}) => void;
        mocks.observeAgentSessionStoreRuntimeCompromised.mockReturnValue(new Promise((resolvePromise) => {
            resolveCompromised = resolvePromise;
        }));

        await runtime.productRuntimeReady();
        const error = Object.assign(new Error("heartbeat lost"), {
            leasePath: join(productTestWorkspaceRoot(), ".nbook", "agent", "migrations", "runtime.lease"),
            kind: "runtime" as const,
        });
        resolveCompromised(error);
        await vi.waitFor(() => expect(mocks.requestProcessExit).toHaveBeenCalledWith(
            PRODUCT_RUNTIME_EXIT_CODE_AGENT_SESSION_STORE_LEASE_COMPROMISED,
        ));

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

        await expect(runtime.productRuntimeReady()).rejects.toBe(error);
        expect(mocks.requestProcessExit).toHaveBeenCalledWith(
            PRODUCT_RUNTIME_EXIT_CODE_AGENT_SESSION_STORE_LEASE_COMPROMISED,
        );
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

        await runtime.productRuntimeReady();
        await vi.waitFor(() => expect(mocks.requestProcessExit).toHaveBeenCalledWith(
            PRODUCT_RUNTIME_EXIT_CODE_AGENT_SESSION_STORE_LEASE_COMPROMISED,
        ));
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

        await runtime.productRuntimeReady();

        expect(mocks.warn).toHaveBeenCalledWith(
            "runtime.stateRoot.integrityFailed",
            {stateIntegrity},
            expect.stringContaining("不会自动处理用户数据"),
        );
    });

    it("migration 未 ready 时绝不取得 Session Store lease", async () => {
        mocks.assertProductMigrationsReady.mockRejectedValue(new Error("migration pending"));

        await expect(runtime.productRuntimeReady()).rejects.toThrow("migration pending");

        expect(mocks.startAgentSessionStoreRuntime).not.toHaveBeenCalled();
    });

    it("启动门禁失败时记录fatal诊断并请求有序退出，而不是依赖未捕获异常", async () => {
        const failure = new Error("migration pending");
        mocks.assertProductMigrationsReady.mockRejectedValue(failure);

        await runtime.productRuntimeReady().catch(runtime.exitOnProductStartupFailure);

        expect(mocks.fatalSync).toHaveBeenCalledWith(
            "runtime.startup.failed",
            undefined,
            failure,
            expect.stringContaining("有序关闭"),
        );
        expect(mocks.requestProcessExit).toHaveBeenCalledWith(1);
    });
});
