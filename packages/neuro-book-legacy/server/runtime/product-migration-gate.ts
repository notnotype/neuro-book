import {planAppSqliteMigrations} from "nbook/server/database/app-sqlite-migrations";
import {
    ApplicationStateMigrationRequiredError,
    ApplicationStateSentinelCorruptError,
    assertApplicationStateReady,
} from "nbook/server/runtime/application-state";
import {resolveApplicationRoot, resolveStateWorkspaceRoot} from "nbook/server/runtime/installation-paths";

export type ProductMigrationCheck = {
    ready: boolean;
    pendingMigrationIds: string[];
    applicationStateError: string | null;
};

/**
 * 统一只读检查 App SQLite 与文件状态 catalog。不得创建数据库、备份、sentinel 或迁移记录。
 */
export async function checkProductMigrations(): Promise<ProductMigrationCheck> {
    const sqlite = await planAppSqliteMigrations({applicationRoot: resolveApplicationRoot()});
    let applicationStateError: string | null = null;
    try {
        await assertApplicationStateReady(resolveStateWorkspaceRoot());
    } catch (error) {
        if (!(error instanceof ApplicationStateMigrationRequiredError)
            && !(error instanceof ApplicationStateSentinelCorruptError)) {
            throw error;
        }
        applicationStateError = error.message;
    }
    return {
        ready: sqlite.pendingMigrationIds.length === 0 && applicationStateError === null,
        pendingMigrationIds: sqlite.pendingMigrationIds,
        applicationStateError,
    };
}

/** 启动入口的 fail-closed 门禁；错误只暴露 migration id，不包含数据库内容。 */
export async function assertProductMigrationsReady(): Promise<void> {
    const check = await checkProductMigrations();
    if (check.ready) return;
    const details = [
        ...(check.pendingMigrationIds.length > 0
            ? ["待应用 App SQLite migrations:", ...check.pendingMigrationIds.map((id) => `- ${id}`)]
            : []),
        ...(check.applicationStateError ? [`Application State: ${check.applicationStateError}`] : []),
    ];
    throw new Error([
        "NeuroBook 数据状态需要迁移，服务已在启动前停止。",
        ...details,
        "请通过 NeuroBook Manager 启动/更新，或执行：bun run migrate:application-state -- --apply",
    ].join("\n"));
}
