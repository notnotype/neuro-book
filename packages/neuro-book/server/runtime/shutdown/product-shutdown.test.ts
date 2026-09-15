import {beforeEach, describe, expect, it, vi} from "vitest";

const mocks = vi.hoisted(() => {
    const order: string[] = [];
    return {
        order,
        databasePath: "",
        disposeAgentHarness: vi.fn(async () => { order.push("agent"); }),
        closeAllProjects: vi.fn(async () => { order.push("projects"); }),
        closeAllWorkspaceTreeIndexes: vi.fn(async () => { order.push("indexes"); }),
        disposeStorageHost: vi.fn(async () => { order.push("storage"); }),
        stopAgentSessionStoreRuntime: vi.fn(async () => { order.push("sessions"); }),
        disconnectPrismaClient: vi.fn(async () => { order.push("prisma"); }),
        checkpointAppSqliteDatabase: vi.fn(async () => { order.push("checkpoint"); }),
        flush: vi.fn(async () => { order.push("logger"); }),
    };
});

vi.mock("nbook/server/app-logs/logger", () => ({
    appLogger: {flush: mocks.flush, fatalSync: vi.fn()},
}));
vi.mock("nbook/server/agent/http", () => ({disposeAgentHarness: mocks.disposeAgentHarness}));
vi.mock("nbook/server/storage/host", () => ({disposeStorageHost: mocks.disposeStorageHost}));
vi.mock("nbook/server/agent/session/agent-session-store-runtime", () => ({
    stopAgentSessionStoreRuntime: mocks.stopAgentSessionStoreRuntime,
}));
vi.mock("nbook/server/database/config", () => ({
    resolveDatabaseConfig: () => ({sqliteFilePath: mocks.databasePath}),
}));
vi.mock("nbook/server/database/prisma", () => ({disconnectPrismaClient: mocks.disconnectPrismaClient}));
vi.mock("nbook/server/runtime/paths/runtime-paths", () => ({
    runtimePathsFromEnv: () => ({workspaceRoot: "C:/state/workspace"}),
}));
vi.mock("nbook/server/workspace-files/project-session", () => ({closeAllProjects: mocks.closeAllProjects}));
vi.mock("nbook/server/workspace-files/project-workspace-index", () => ({
    closeAllWorkspaceTreeIndexes: mocks.closeAllWorkspaceTreeIndexes,
}));
vi.mock("nbook/server/database/app-sqlite-migrations", () => ({
    checkpointAppSqliteDatabase: mocks.checkpointAppSqliteDatabase,
}));

import {productShutdownController} from "nbook/server/runtime/shutdown/product-shutdown";

describe("Product shutdown wiring", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.order.length = 0;
        mocks.databasePath = process.execPath;
    });

    it("按 Agent 到日志的所有权顺序关闭全部进程级资源", async () => {
        await productShutdownController.shutdown();

        expect(mocks.stopAgentSessionStoreRuntime).toHaveBeenCalledWith("C:/state/workspace");
        expect(mocks.checkpointAppSqliteDatabase).toHaveBeenCalledWith(process.execPath);
        expect(mocks.order).toEqual([
            "agent",
            "projects",
            "indexes",
            "storage",
            "sessions",
            "checkpoint",
            "prisma",
            "logger",
        ]);
    });
});
