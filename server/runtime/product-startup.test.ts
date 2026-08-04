import {beforeEach, describe, expect, it, vi} from "vitest";
import {PRODUCT_RUNTIME_EXIT_CODE_AGENT_SESSION_STORE_LEASE_COMPROMISED} from "nbook/shared/product-runtime-contract";

const mocks = vi.hoisted(() => ({
    mkdir: vi.fn(async () => undefined),
    inspectStateRootIntegrity: vi.fn(async () => ({kind: "clean"})),
    stateRootIntegrityFailed: vi.fn(() => false),
    assertProductMigrationsReady: vi.fn(async () => undefined),
    startAgentSessionStoreRuntime: vi.fn(async () => ({rootWorkspace: "C:/state/workspace"})),
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
        applicationRoot: "C:/application",
        stateRoot: "C:/state",
        workspaceRoot: "C:/state/workspace",
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
}));
vi.mock("nbook/server/app-logs/logger", () => ({appLogger: {warn: mocks.warn, fatalSync: mocks.fatalSync}}));
vi.mock("nbook/server/runtime/shutdown/product-shutdown", () => ({
    productShutdownController: {requestProcessExit: mocks.requestProcessExit},
}));

import {prepareProductRuntime} from "nbook/server/runtime/product-startup";

describe("Product startup", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.inspectStateRootIntegrity.mockResolvedValue({kind: "clean"});
        mocks.stateRootIntegrityFailed.mockReturnValue(false);
        mocks.assertProductMigrationsReady.mockResolvedValue(undefined);
        mocks.startAgentSessionStoreRuntime.mockResolvedValue({rootWorkspace: "C:/state/workspace"});
        mocks.observeAgentSessionStoreRuntimeCompromised.mockReturnValue(new Promise(() => undefined));
    });

    it("按 Workspace、migration、Session Store 顺序完成完整 ready 门禁", async () => {
        await prepareProductRuntime();

        expect(mocks.mkdir).toHaveBeenCalledWith("C:/state/workspace", {recursive: true});
        expect(mocks.inspectStateRootIntegrity).toHaveBeenCalledWith({
            installationRoot: "C:/application",
            stateRoot: "C:/state",
        });
        expect(mocks.assertProductMigrationsReady).toHaveBeenCalledOnce();
        expect(mocks.startAgentSessionStoreRuntime).toHaveBeenCalledWith("C:/state/workspace");
        expect(mocks.mkdir.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.assertProductMigrationsReady.mock.invocationCallOrder[0]!,
        );
        expect(mocks.assertProductMigrationsReady.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.startAgentSessionStoreRuntime.mock.invocationCallOrder[0]!,
        );
    });

    it("runtime lease compromised时记录fatal诊断并请求专用退出", async () => {
        let resolveCompromised!: (error: {leasePath: string; kind: "runtime"}) => void;
        mocks.observeAgentSessionStoreRuntimeCompromised.mockReturnValue(new Promise((resolvePromise) => {
            resolveCompromised = resolvePromise;
        }));

        await prepareProductRuntime();
        const error = Object.assign(new Error("heartbeat lost"), {
            leasePath: "C:/state/workspace/.nbook/agent/migrations/runtime.lease",
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

    it("影子 Workspace 只记录证据，不自动修改用户数据", async () => {
        const stateIntegrity = {kind: "shadow-workspace"};
        mocks.inspectStateRootIntegrity.mockResolvedValue(stateIntegrity);
        mocks.stateRootIntegrityFailed.mockReturnValue(true);

        await prepareProductRuntime();

        expect(mocks.warn).toHaveBeenCalledWith(
            "runtime.stateRoot.integrityFailed",
            {stateIntegrity},
            expect.stringContaining("不会自动处理用户数据"),
        );
    });

    it("migration 未 ready 时绝不取得 Session Store lease", async () => {
        mocks.assertProductMigrationsReady.mockRejectedValue(new Error("migration pending"));

        await expect(prepareProductRuntime()).rejects.toThrow("migration pending");

        expect(mocks.startAgentSessionStoreRuntime).not.toHaveBeenCalled();
    });
});
