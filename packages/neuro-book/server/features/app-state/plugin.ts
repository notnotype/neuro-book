import {existsSync} from "node:fs";
import {mkdir} from "node:fs/promises";
import {provide} from "nbook/runtime/plugins/plugins";
import type {PluginDefinition} from "nbook/runtime/plugins/plugins";
import {defineServiceKey} from "nbook/runtime/services/services";
import {appLogger} from "nbook/server/app-logs/logger";
import {resolveDatabaseConfig} from "nbook/server/database/config";
import {checkpointAppSqliteDatabase} from "nbook/server/database/app-sqlite-migrations";
import {disconnectPrismaClient} from "nbook/server/database/prisma";
import {assertProductMigrationsReady} from "nbook/server/runtime/product-migration-gate";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {inspectStateRootIntegrity, stateRootIntegrityFailed} from "nbook/server/runtime/state-root-integrity";

export const appStateKey = defineServiceKey<{readonly ready: true}>("nbook.app-state/ready");

export function createAppStatePlugin(recordStartupError: (error: unknown) => void): PluginDefinition {
    return {
        id: "nbook.app-state",
        entries: [{
            id: "server",
            location: "server",
            provides: [appStateKey],
            activate: async (context) => {
                const paths = runtimePathsFromEnv();
                let checkpointed = false;
                let disconnected = false;
                const closeState = async (): Promise<void> => {
                    const failures: unknown[] = [];
                    if (!checkpointed) {
                        try {
                            const databasePath = resolveDatabaseConfig({ensureDirectory: false}).sqliteFilePath;
                            if (existsSync(databasePath)) await checkpointAppSqliteDatabase(databasePath);
                            checkpointed = true;
                        } catch (error) {
                            failures.push(error);
                        }
                    }
                    // checkpoint 失败也必须尝试断开；成功项在显式恢复时不重复释放。
                    if (!disconnected) {
                        try {
                            await disconnectPrismaClient();
                            disconnected = true;
                        } catch (error) {
                            failures.push(error);
                        }
                    }
                    if (failures.length === 1) throw failures[0];
                    if (failures.length > 1) throw new AggregateError(failures, "App State 关闭不完整");
                };
                let transferred = false;
                // Prisma 的旧入口在门禁前即可创建实例；激活失败也必须清理，成功后只由服务负责。
                context.scope.register({kind: "app-state-startup", label: "prerequisites", value: null, release: async () => {
                    if (!transferred) await closeState();
                }});
                try {
                    await mkdir(paths.workspaceRoot, {recursive: true});
                    const stateIntegrity = await inspectStateRootIntegrity({
                        installationRoot: paths.applicationRoot,
                        stateRoot: paths.stateRoot,
                    });
                    if (stateRootIntegrityFailed(stateIntegrity)) {
                        void appLogger.warn(
                            "runtime.stateRoot.integrityFailed",
                            {stateIntegrity},
                            stateIntegrity.kind === "shadow-workspace"
                                ? "检测到Installation Root与State Root存在Workspace Root数据分叉；应用不会自动处理用户数据"
                                : "无法验证Installation Root与State Root的Workspace Root关系；应用不会自动处理用户数据",
                        );
                    }
                    await assertProductMigrationsReady();
                } catch (error) {
                    recordStartupError(error);
                    throw error;
                }
                transferred = true;
                return {services: [provide(appStateKey, {ready: true}, closeState)]};
            },
        }],
    };
}
