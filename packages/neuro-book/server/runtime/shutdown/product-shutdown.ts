import {existsSync} from "node:fs";
import {appLogger} from "nbook/server/app-logs/logger";
import {disposeAgentHarness} from "nbook/server/agent/http";
import {disposeStorageHost} from "nbook/server/storage/host";
import {stopAgentSessionStoreRuntime} from "nbook/server/agent/session/agent-session-store-runtime";
import {resolveDatabaseConfig} from "nbook/server/database/config";
import {disconnectPrismaClient} from "nbook/server/database/prisma";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {closeAllProjects} from "nbook/server/workspace-files/project-session";
import {closeAllWorkspaceTreeIndexes} from "nbook/server/workspace-files/project-workspace-index";
import {checkpointAppSqliteDatabase} from "nbook/server/database/app-sqlite-migrations";
import {ProductShutdownController} from "nbook/server/runtime/shutdown/product-shutdown-controller";

export {ProductShutdownController} from "nbook/server/runtime/shutdown/product-shutdown-controller";
export type {
    ProductShutdownControllerOptions,
    ProductShutdownStep,
} from "nbook/server/runtime/shutdown/product-shutdown-controller";

/** App SQLite 不存在时关闭不应创建一个空数据库。 */
async function checkpointAppSqlite(): Promise<void> {
    const databasePath = resolveDatabaseConfig({ensureDirectory: false}).sqliteFilePath;
    if (!existsSync(databasePath)) return;
    await checkpointAppSqliteDatabase(databasePath);
}

export const productShutdownController = new ProductShutdownController(
    [
        {name: "agent-harness", close: disposeAgentHarness},
        {name: "project-sessions", close: closeAllProjects},
        {name: "workspace-file-indexes", close: closeAllWorkspaceTreeIndexes},
        // user Storage 上下文在领域写入与日志关闭前收口；Project Storage 将在其 occupancy 释放前接入。
        {name: "storage-host", close: disposeStorageHost},
        {
            name: "agent-session-store",
            close: async () => stopAgentSessionStoreRuntime(runtimePathsFromEnv().workspaceRoot),
        },
        {name: "app-sqlite-checkpoint", close: checkpointAppSqlite},
        {name: "app-prisma", close: disconnectPrismaClient},
        {name: "app-logger", close: async () => appLogger.flush()},
    ],
    {
        reportFailure: (error) => appLogger.fatalSync(
            "product.shutdown.failed",
            undefined,
            error,
            "Product 关闭不完整",
        ),
    },
);
