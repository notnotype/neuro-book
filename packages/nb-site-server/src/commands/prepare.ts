/**
 * 启动、只迁移与模块命令共用的前几步：读配置、取锁、打开库并执行迁移，以及它们的失败行（`site.operations` 失败表）。
 */

import {SQLiteError, type Database} from "bun:sqlite";

import {runMigrations, yieldToEventLoop, type MigrationFailure} from "../db/migrate";
import {JournalModeError, openModuleDb} from "../db/open";
import type {StopState} from "../lifecycle";
import type {ModuleLocks} from "../lock";
import type {Logger} from "../log";
import type {CommandFailure, SiteModule} from "../module";

/** 一个命令的结果：`failure` 写到标准错误、以 1 退出；没有 `failure` 时以 0 退出（出过致命错误时仍是 1）。 */
export interface CommandResult {
    readonly failure?: CommandFailure;
}

export const SUCCEEDED: CommandResult = {};

export function failed(failure: CommandFailure): CommandResult {
    return {failure};
}

function busyFailure(module: string): CommandFailure {
    return {code: "data_dir_busy", message: `the data directory is in use by another process (module ${module})`, fields: {module}};
}

/** 数据目录里这个模块的锁文件或库文件用不了；`errorCode` 是系统给的码，拿不到时省略。 */
function unusableFailure(module: string, errorCode?: string): CommandFailure {
    return {code: "data_dir_unusable", message: `a file of module ${module} in the data directory cannot be used`, fields: {module, ...(errorCode === undefined ? {} : {errorCode})}};
}

/** 取锁没成功时的失败行。 */
export function lockFailure(locks: Extract<ModuleLocks, {ok: false}>): CommandFailure {
    return locks.reason === "busy" ? busyFailure(locks.module) : unusableFailure(locks.module, locks.errorCode);
}

export function migrationFailure(outcome: MigrationFailure): CommandFailure {
    const {module, migration, reason, dbCode, dbMessage} = outcome;
    return {
        code: "migration_failed",
        message: `migrating module ${module} failed at ${migration ?? "the migration ledger"}: ${reason}`,
        fields: {module, migration, reason, ...(dbCode === undefined ? {} : {dbCode, dbMessage})},
    };
}

/**
 * 打开模块的库、读它的迁移账本时抛出的异常对应的失败行；不是这两种预料之中的异常时返回 undefined，调用方照常抛出（程序错误）。
 * 持锁迁移与 `shared` 命令只核对迁移记录两条路径共用它：同一个坏库不论走哪条路径都报同一个码（`site.operations` 失败表）。
 *
 * - 文件系统不支持 WAL（`JournalModeError`）、库文件打不开（`SQLITE_CANTOPEN`：是目录、没有权限）是数据目录的问题，报
 *   `data_dir_unusable`。SQLite 只给自己的码、不给系统的 errno，所以这一行不带 `errorCode`。
 * - 其余 SQLite 错误归迁移失败（`sql_error`，不在某一条迁移上，`migration` 为 null）：文件是普通文件、权限也对，只是内容不是
 *   SQLite 库（`SQLITE_NOTADB`），或读的时候出错、撞锁。SQLite 的说明不含路径。
 */
export function moduleDbFailure(module: string, error: unknown): CommandFailure | undefined {
    if (error instanceof JournalModeError) return unusableFailure(module);
    if (!(error instanceof SQLiteError)) return undefined;
    if (error.code === "SQLITE_CANTOPEN") return unusableFailure(module);
    return migrationFailure({ok: false, code: "migration_failed", reason: "sql_error", module, migration: null, dbCode: error.code ?? "SQLITE_ERROR", dbMessage: error.message});
}

export type MigrateAllOutcome ={readonly kind: "done"} | {readonly kind: "stopped"} | {readonly kind: "failed"; readonly failure: CommandFailure};

/**
 * 按模块顺序打开库并执行迁移，打开的连接放进 `opened`（不论成败，由调用方关）。某个模块失败时后面的模块不再执行；
 * 停止请求在进入每个模块之前与两条迁移之间生效。调用方必须已经拿着这些模块的锁。
 */
export async function openAndMigrate(dataDir: string, modules: readonly SiteModule[], log: Logger, stop: StopState, opened: Map<string, Database>): Promise<MigrateAllOutcome> {
    for (const module of modules) {
        // 先让出一次：读配置、取锁、上一个模块收尾都是同步的，期间到的信号要等事件循环转一圈才被处理。
        await yieldToEventLoop();
        if (stop.requested) return {kind: "stopped"};
        let db: Database;
        try {
            db = openModuleDb(dataDir, module.name);
        } catch (error) {
            const failure = moduleDbFailure(module.name, error);
            if (failure === undefined) throw error;
            return {kind: "failed", failure};
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
