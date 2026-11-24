/**
 * `nb-site backup`（`site.operations` 输出 6、10，时序一节的最后一条，失败表的 `backup_failed`）：把每个模块的库写成
 * 一份一致的副本，放进 `<数据目录>/backups/<UTC 时间到毫秒>/`，再删掉超过保留份数的旧副本。
 *
 * 不取模块的锁：备份要在服务运行期间可以执行。一致性靠 SQLite 自己：只读连接上的 `VACUUM INTO` 在一个读事务里写出副本，
 * WAL 下读事务不挡服务的写入，也看不到写到一半的事务。两个备份之间用 `backups/backup.lock` 互斥，拿不到就失败、不等。
 *
 * 写到一半的东西不会被当成备份：先写进 `<名字>.partial/`，全部模块都写好、校验过才改名。失败或被停止信号打断时
 * `.partial` 留在原地，由下一次成功的备份清掉（那时它拿着 `backup.lock`，不会删到别人正在写的）。
 *
 * 清理只认名字合 `BACKUP_NAME` 的目录：部署的人手工放进 `backups/` 的东西不动。本次写出的那一份不参与删除：墙钟往回拨过
 * 时，目录里可能已有名字比它更新的一份，按名字排序会把刚写出的这份当成最旧的删掉。
 */

import {Database, SQLiteError} from "bun:sqlite";
import {mkdirSync, readdirSync, renameSync, rmSync, statSync} from "node:fs";
import {join} from "node:path";

import {tryLock, type FileLock} from "@notnotype/nb-flock";

import {configFailure, parseSiteConfig, type Env} from "../config";
import {yieldToEventLoop} from "../db/migrate";
import {moduleDbPath} from "../db/open";
import type {StopState} from "../lifecycle";
import {errorType, type Logger} from "../log";
import type {CommandFailure, SiteModule} from "../module";
import {failed, SUCCEEDED, type CommandResult} from "./prepare";

/** 一次完整备份的目录名：UTC 时间到毫秒，例如 `20261124T031500123Z`。定宽数字，按名字排序就是按时间排序。 */
const BACKUP_NAME = /^\d{8}T\d{9}Z$/u;
/** 没写完的备份。只清自己的命名格式，不碰别的以 `.partial` 结尾的东西。 */
const PARTIAL_NAME = /^\d{8}T\d{9}Z\.partial$/u;

/**
 * 备份的只读连接等锁的上限。WAL 下读事务通常不用等锁，只在别的连接正做检查点收尾、恢复日志这类瞬间要等。这是一个
 * 单独的进程，等的时候停住的只是它自己，所以比服务的业务连接（250 毫秒）宽得多。
 */
const BACKUP_BUSY_TIMEOUT_MS = 5_000;

/**
 * `backup_failed` 的 `reason`，稳定的英文词：
 * - `busy`：另一个备份拿着 `backup.lock`；
 * - `io_failed`：建 `backups/` 或 `.partial` 目录、打开 `backup.lock`、改名失败，带系统给的 `errorCode`；
 * - `db_missing`：某个模块的库文件不存在（没启动过的数据目录没有可备份的东西）；
 * - `db_unreadable`：库文件打不开，带 SQLite 的 `dbCode`，或系统给的 `errorCode`；
 * - `copy_failed`：`VACUUM INTO` 或副本上的 `VACUUM` 失败（库文件损坏、磁盘满），带 `dbCode`；
 * - `prepare_failed`：模块的 `prepareBackupCopy` 抛错，带 `errorType`；
 * - `check_failed`：副本的 `quick_check` 不是 ok；
 * - `prune_failed`：备份已经写好（`name`），删旧备份失败，带 `errorCode`。
 */
type BackupFailureReason = "busy" | "io_failed" | "db_missing" | "db_unreadable" | "copy_failed" | "prepare_failed" | "check_failed" | "prune_failed";

const MESSAGES: Readonly<Record<BackupFailureReason, string>> = {
    busy: "another backup is being written",
    io_failed: "could not create or rename a file in the backup directory",
    db_missing: "a module database does not exist yet; start or migrate the site first",
    db_unreadable: "a module database could not be opened",
    copy_failed: "copying a module database failed",
    prepare_failed: "preparing the copy of a module database failed",
    check_failed: "the copy of a module database failed its integrity check",
    prune_failed: "the backup was written, but removing old backups failed",
};

/** 失败行只带模块名、原因词与错误码；不带路径与说明文字（SQLite 与系统的说明里有文件路径）。 */
function backupFailure(reason: BackupFailureReason, fields: Readonly<Record<string, unknown>> = {}): CommandFailure {
    const module = typeof fields.module === "string" ? ` (module ${fields.module})` : "";
    return {code: "backup_failed", message: `backup failed: ${MESSAGES[reason]}${module}`, fields: {reason, ...fields}};
}

/** 系统错误的码；没有字符串 `code` 的不是文件系统的问题，照常抛出（程序错误）。 */
function systemErrorCode(error: unknown): string {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (typeof code !== "string") throw error;
    return code;
}

/** SQLite 的错误码；不是 `SQLiteError` 的照常抛出。 */
function sqliteCode(error: unknown): string {
    if (!(error instanceof SQLiteError)) throw error;
    return error.code ?? "SQLITE_ERROR";
}

function backupName(at: Date): string {
    // `toISOString()` 形如 2026-11-24T03:15:00.123Z，去掉分隔符得到定宽的名字。
    return at.toISOString().replace(/[-:.]/gu, "");
}

/** 把一个模块的库写成 `targetDir` 里的副本并校验；成功返回 undefined。 */
function copyModule(dataDir: string, targetDir: string, module: SiteModule): CommandFailure | undefined {
    const source = moduleDbPath(dataDir, module.name);
    try {
        statSync(source);
    } catch (error) {
        const errorCode = systemErrorCode(error);
        return errorCode === "ENOENT" ? backupFailure("db_missing", {module: module.name}) : backupFailure("db_unreadable", {module: module.name, errorCode});
    }

    let db: Database;
    try {
        db = new Database(source, {readonly: true, strict: true});
    } catch (error) {
        return backupFailure("db_unreadable", {module: module.name, dbCode: sqliteCode(error)});
    }
    const copyPath = moduleDbPath(targetDir, module.name);
    try {
        db.exec(`PRAGMA busy_timeout = ${BACKUP_BUSY_TIMEOUT_MS}`);
        // 路径走绑定参数，不拼进 SQL：数据目录的路径里可能有引号。
        db.run("VACUUM INTO ?", [copyPath]);
    } catch (error) {
        return backupFailure("copy_failed", {module: module.name, dbCode: sqliteCode(error)});
    } finally {
        db.close();
    }

    if (module.prepareBackupCopy !== undefined) {
        const copy = new Database(copyPath, {readwrite: true, create: false, strict: true});
        try {
            try {
                module.prepareBackupCopy(copy);
            } catch (error) {
                return backupFailure("prepare_failed", {module: module.name, errorType: errorType(error)});
            }
            try {
                copy.exec("VACUUM");
            } catch (error) {
                return backupFailure("copy_failed", {module: module.name, dbCode: sqliteCode(error)});
            }
        } finally {
            copy.close();
        }
    }

    const check = new Database(copyPath, {readonly: true, strict: true});
    try {
        const rows = check.query<{quick_check: string}, []>("PRAGMA quick_check").all();
        if (rows.length !== 1 || rows[0]!.quick_check !== "ok") return backupFailure("check_failed", {module: module.name});
    } catch (error) {
        return backupFailure("check_failed", {module: module.name, dbCode: sqliteCode(error)});
    } finally {
        check.close();
    }
    return undefined;
}

/** 删掉超过 `keep` 份的旧备份（`current` 不参与，算作保留的一份）与所有没写完的备份。 */
function prune(backupsDir: string, current: string, keep: number): void {
    const directories = readdirSync(backupsDir, {withFileTypes: true})
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    const others = directories.filter((name) => BACKUP_NAME.test(name) && name !== current).sort();
    const expired = others.slice(0, Math.max(0, others.length - (keep - 1)));
    for (const name of [...expired, ...directories.filter((name) => PARTIAL_NAME.test(name))]) {
        rmSync(join(backupsDir, name), {recursive: true, force: true});
    }
}

export async function backup(env: Env, modules: readonly SiteModule[], log: Logger, stop: StopState): Promise<CommandResult> {
    // 与 serve 同一套配置校验（`site.operations` 输出 1）；失败时还没碰过数据目录。
    const parsed = parseSiteConfig(env, modules);
    if (!parsed.ok) return failed(configFailure(parsed.problems));
    const {dataDir, backupKeep} = parsed.config.base;
    const backupsDir = join(dataDir, "backups");

    let lock: FileLock | null;
    try {
        mkdirSync(backupsDir, {recursive: true});
        lock = tryLock(join(backupsDir, "backup.lock"));
    } catch (error) {
        return failed(backupFailure("io_failed", {errorCode: systemErrorCode(error)}));
    }
    if (lock === null) return failed(backupFailure("busy"));

    try {
        const name = backupName(new Date());
        const partial = join(backupsDir, `${name}.partial`);
        try {
            // 不带 recursive：同名目录已存在时失败，不往别人的目录里写。
            mkdirSync(partial);
        } catch (error) {
            return failed(backupFailure("io_failed", {errorCode: systemErrorCode(error)}));
        }

        for (const module of modules) {
            // `VACUUM INTO` 是同步的，期间到的停止信号排在宏任务里：在两个模块之间让出一次再查。
            await yieldToEventLoop();
            if (stop.requested) return failed({code: "interrupted", message: "backup was interrupted by a stop signal", fields: {command: "backup"}});
            const failure = copyModule(dataDir, partial, module);
            if (failure !== undefined) return failed(failure);
        }

        try {
            renameSync(partial, join(backupsDir, name));
        } catch (error) {
            return failed(backupFailure("io_failed", {errorCode: systemErrorCode(error)}));
        }
        try {
            prune(backupsDir, name, backupKeep);
        } catch (error) {
            return failed(backupFailure("prune_failed", {name, errorCode: systemErrorCode(error)}));
        }
        log.info("backup.done", "backup written", {name, modules: modules.map((module) => module.name)});
        return SUCCEEDED;
    } finally {
        lock.release();
    }
}
