/**
 * 启动、只迁移与模块命令共用的前几步：读配置、取锁、打开库并执行迁移，以及它们的失败行（`site.operations` 失败表）。
 */

import {SQLiteError, type Database} from "bun:sqlite";

import {runMigrations, type MigrationFailure} from "../db/migrate";
import {openModuleDb} from "../db/open";
import type {Logger} from "../log";
import type {CommandFailure, SiteModule} from "../module";
import type {StopState} from "../lifecycle";

/** 一个命令的结果：`failure` 写到标准错误、以 1 退出；没有 `failure` 时以 0 退出（出过致命错误时仍是 1）。 */
export interface CommandResult {
    readonly failure?: CommandFailure;
}

export const SUCCEEDED: CommandResult = {};

export function failed(failure: CommandFailure): CommandResult {
    return {failure};
}

export function busyFailure(module: string): CommandFailure {
    return {code: "data_dir_busy", message: `the data directory is in use by another process (module ${module})`, fields: {module}};
}

export function migrationFailure(outcome: MigrationFailure): CommandFailure {
    const {module, migration, reason, dbCode, dbMessage} = outcome;
    return {
        code: "migration_failed",
        message: `migrating module ${module} failed at ${migration ?? "the migration ledger"}: ${reason}`,
        fields: {module, migration, reason, ...(dbCode === undefined ? {} : {dbCode, dbMessage})},
    };
}

export type MigrateAllOutcome = {readonly kind: "done"} | {readonly kind: "stopped"} | {readonly kind: "failed"; readonly failure: CommandFailure};

/**
 * 按模块顺序打开库并执行迁移，打开的连接放进 `opened`（不论成败，由调用方关）。某个模块失败时后面的模块不再执行；
 * 停止请求在两条迁移之间生效。调用方必须已经拿着这些模块的锁。
 */
export async function openAndMigrate(dataDir: string, modules: readonly SiteModule[], log: Logger, stop: StopState, opened: Map<string, Database>): Promise<MigrateAllOutcome> {
    for (const module of modules) {
        if (stop.requested) return {kind: "stopped"};
        let db: Database;
        try {
            db = openModuleDb(dataDir, module.name);
        } catch (error) {
            // 文件不是 SQLite 库、打不开：归为这个模块的迁移失败，说明里不带路径（SQLite 的说明不含路径）。
            if (!(error instanceof SQLiteError)) throw error;
            return {kind: "failed", failure: migrationFailure({ok: false, code: "migration_failed", reason: "sql_error", module: module.name, migration: null, dbCode: error.code ?? "SQLITE_ERROR", dbMessage: error.message})};
        }
        opened.set(module.name, db);
        const outcome = await runMigrations(db, module, {
            report: (event) => {
                const fields = {module: event.module, migration: event.migration};
                if (event.event === "migration.applied") log.info(event.event, "migration applied", fields);
                else log.warn(event.event, "database has a newer migration this version does not know", fields);
            },
            stopRequested: () => stop.requested,
        });
        if (!outcome.ok) return {kind: "failed", failure: migrationFailure(outcome)};
        if (outcome.stopped) return {kind: "stopped"};
    }
    return {kind: "done"};
}

export function closeAll(dbs: Map<string, Database>): void {
    for (const db of [...dbs.values()].reverse()) db.close();
    dbs.clear();
}
