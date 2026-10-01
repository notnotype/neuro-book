import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createApplication} from "nbook/runtime/application/application";
import type {Application} from "nbook/runtime/application/application";
import {createAppStatePlugin, appStateKey} from "./plugin";

const mocks = vi.hoisted(() => ({
    exists: vi.fn(() => true),
    mkdir: vi.fn(async () => undefined),
    checkpoint: vi.fn<() => Promise<void>>(),
    disconnect: vi.fn<() => Promise<void>>(),
}));
vi.mock("node:fs", () => ({existsSync: mocks.exists}));
vi.mock("node:fs/promises", () => ({mkdir: mocks.mkdir}));
vi.mock("nbook/server/database/config", () => ({resolveDatabaseConfig: () => ({sqliteFilePath: "absent.db"})}));
vi.mock("nbook/server/database/app-sqlite-migrations", () => ({checkpointAppSqliteDatabase: mocks.checkpoint}));
vi.mock("nbook/server/database/prisma", () => ({disconnectPrismaClient: mocks.disconnect}));
vi.mock("nbook/server/runtime/product-migration-gate", () => ({assertProductMigrationsReady: async () => undefined}));
vi.mock("nbook/server/runtime/paths/runtime-paths", () => ({runtimePathsFromEnv: () => ({applicationRoot: "app", workspaceRoot: "workspace", stateRoot: "state"})}));
vi.mock("nbook/server/runtime/state-root-integrity", () => ({inspectStateRootIntegrity: async () => ({kind: "clean"}), stateRootIntegrityFailed: () => false}));
vi.mock("nbook/server/app-logs/logger", () => ({appLogger: {warn: vi.fn()}}));

let application: Application;
beforeEach(async () => {
    vi.resetAllMocks();
    mocks.exists.mockReturnValue(true);
    mocks.checkpoint.mockResolvedValue(undefined);
    mocks.disconnect.mockResolvedValue(undefined);
    application = createApplication({identity: {location: "server", instanceId: "app-state-test"}, stopSignal: new AbortController().signal, emergency: () => undefined}, {
        keys: [appStateKey], plugins: [createAppStatePlugin(() => undefined)], requiredPlugins: ["nbook.app-state"], gates: [],
    });
    expect(await application.startup).toMatchObject({status: "available"});
});
afterEach(async () => {
    mocks.checkpoint.mockResolvedValue(undefined);
    mocks.disconnect.mockResolvedValue(undefined);
    if (application.root.phase === "stopping") await application.recover();
    else await application.stop();
});

describe("App State 生命周期", () => {
    it("数据库不存在时跳过 checkpoint 但仍断开 Prisma，不创建空数据库", async () => {
        mocks.exists.mockReturnValue(false);
        await expect(application.stop()).resolves.toEqual({status: "closed"});
        expect(mocks.checkpoint).not.toHaveBeenCalled();
        expect(mocks.disconnect).toHaveBeenCalledOnce();
    });

    it("checkpoint 失败仍断开 Prisma，恢复只重试未完成的 checkpoint", async () => {
        mocks.checkpoint.mockRejectedValueOnce(new Error("checkpoint busy"));
        expect(await application.stop()).toMatchObject({status: "incomplete"});
        expect(mocks.disconnect).toHaveBeenCalledOnce();
        expect(application.plugins.diagnostics().filter((diagnostic) => diagnostic.reason === "closed")).toEqual([]);
        await expect(application.recover()).resolves.toEqual({status: "closed"});
        expect(mocks.checkpoint).toHaveBeenCalledTimes(2);
        expect(mocks.disconnect).toHaveBeenCalledOnce();
    });
});
