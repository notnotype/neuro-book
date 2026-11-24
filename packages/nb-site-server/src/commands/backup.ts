/**
 * `nb-site backup`（`site.operations` 输出 6、10，时序一节的最后一条，失败表的 `backup_failed`）：把每个模块的库写成
 * 一份一致的副本，放进 `<数据目录>/backups/<UTC 时间到毫秒>/`，再删掉超过保留份数的旧副本。
 *
 * 不取模块的锁：备份要在服务运行期间可以执行。一致性靠 SQLite 自己：只读连接上的 `VACUUM INTO` 在一个读事务里写出副本，
 * WAL 下读事务不挡服务的写入，也看不到写到一半的事务。两个备份之间用 `backups/backup.lock` 互斥，拿不到就失败、不等。
 *
 * 写到一半的东西不会被当成备份：先写进 `<名字>.partial/`，全部模块都写好、校验过才改名。没走到改名的每条路径（失败、
 * 被停止信号打断、程序错误抛出）当场删掉这一份 `.partial`；进程被强行结束时来不及删，留下的由下一次备份在取到
 * `backup.lock` 之后、开始写之前清掉（拿着锁才清，不会删到别人正在写的）。
 *
 * 清理只认名字合 `BACKUP_NAME` 的目录：部署的人手工放进 `backups/` 的东西不动。本次写出的那一份不参与删除：墙钟往回拨过
 * 时，目录里可能已有名字比它更新的一份，按名字排序会把刚写出的这份当成最旧的删掉。
 */

import {Database, SQLiteError} from "bun:sqlite";
import {chmodSync, mkdirSync, readdirSync, renameSync, rmSync, statSync} from "node:fs";
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
 * 备份目录与每一份备份新建时的权限：只有运行备份的用户能进（`site.operations` 输出 6）。`VACUUM INTO` 按进程的 umask 建
 * 副本文件，不继承原库的权限，所以靠外面这层目录挡住别的用户；`.partial` 一建就是这个权限，改名不改它，复制期间也读不到。
 * 已有的备份目录不改，部署的人自己放宽过的照旧。
 */
const PRIVATE_DIR_MODE = 0o700;

/**
 * 新建一个只有本用户能进的目录。建好之后再 `chmod` 一次：`mkdir` 的 `mode` 还要被 umask 减掉，umask 拿掉了属主的位时
 * （例如 0400）建出来的目录本用户都列不了，删不掉没写完的备份。`recursive` 时只有真新建了才改，已有的目录不动。
 */
function makePrivateDir(path: string, options: {readonly recursive: boolean}): void {
    const created = mkdirSync(path, {recursive: options.recursive, mode: PRIVATE_DIR_MODE});
    if (!options.recursive || created !== undefined) chmodSync(path, PRIVATE_DIR_MODE);
}

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
 * - `copy_failed`：`VACUUM INTO`、打开刚写出的副本、副本上的 `VACUUM` 失败（库文件损坏、磁盘满），带 `dbCode`；
 * - `prepare_failed`：模块的 `prepareBackupCopy` 抛错（带 `errorType`）、返回了 `undefined` 以外的值或留下了未提交的事务；
 * - `check_failed`：副本的 `quick_check` 不是 ok，或校验时打不开副本（带 `dbCode`）；
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

const INTERRUPTED: CommandFailure = {code: "interrupted", message: "backup was interrupted by a stop signal", fields: {command: "backup"}};

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

/** 打开刚写出的副本；打不开时返回按 `reason` 报的失败。 */
function openCopy(copyPath: string, module: string, mode: "readwrite" | "readonly", reason: "copy_failed" | "check_failed"): Database | CommandFailure {
    try {
        return new Database(copyPath, mode === "readwrite" ? {readwrite: true, create: false, strict: true} : {readonly: true, strict: true});
    } catch (error) {
        return backupFailure(reason, {module, dbCode: sqliteCode(error)});
    }
}

/** 在副本上跑模块的 `prepareBackupCopy` 并 `VACUUM`；成功返回 undefined。 */
function prepareCopy(copyPath: string, module: SiteModule, prepare: (copy: Database) => undefined): CommandFailure | undefined {
    const copy = openCopy(copyPath, module.name, "readwrite", "copy_failed");
    if (!(copy instanceof Database)) return copy;
    try {
        let returned: unknown;
        try {
            returned = prepare(copy);
        } catch (error) {
            return backupFailure("prepare_failed", {module: module.name, errorType: errorType(error)});
        }
        // 返回了值（多半是写成 async 的 Promise，删除还没做）或留下没提交的事务：副本里可能还有该删的内容，这一份不算。
        // 关连接时 SQLite 回滚那个事务。
        if (returned !== undefined || copy.inTransaction) return backupFailure("prepare_failed", {module: module.name});
        try {
            copy.exec("VACUUM");
        } catch (error) {
            return backupFailure("copy_failed", {module: module.name, dbCode: sqliteCode(error)});
        }
        return undefined;
    } finally {
        copy.close();
    }
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
        const failure = prepareCopy(copyPath, module, module.prepareBackupCopy.bind(module));
        if (failure !== undefined) return failure;
    }

    const check = openCopy(copyPath, module.name, "readonly", "check_failed");
    if (!(check instanceof Database)) return check;
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

/**
 * 删掉一份没写完的备份。删不掉时只记一行 warn（不带路径）：这一次的结果照旧按原来的原因报，留下的由下一次备份开始时再清。
 */
function removePartial(path: string, log: Logger): void {
    try {
        rmSync(path, {recursive: true, force: true});
    } catch (error) {
        log.warn("backup.partial_remove_failed", "could not remove an unfinished backup; the next backup removes it", {errorCode: systemErrorCode(error)});
    }
}

/** 清掉以前留下的 `.partial`（进程被强行结束时来不及删的）。只在拿着 `backup.lock` 时调用。 */
function removeLeftoverPartials(backupsDir: string, log: Logger): void {
    let names: string[];
    try {
        names = readdirSync(backupsDir, {withFileTypes: true})
            .filter((entry) => entry.isDirectory() && PARTIAL_NAME.test(entry.name))
            .map((entry) => entry.name);
    } catch (error) {
        log.warn("backup.partial_remove_failed", "could not list unfinished backups; the next backup tries again", {errorCode: systemErrorCode(error)});
        return;
    }
    for (const name of names) removePartial(join(backupsDir, name), log);
}

/** 删掉超过 `keep` 份的旧备份；`current` 不参与，算作保留的一份。 */
function prune(backupsDir: string, current: string, keep: number): void {
    const others = readdirSync(backupsDir, {withFileTypes: true})
        .filter((entry) => entry.isDirectory() && BACKUP_NAME.test(entry.name) && entry.name !== current)
        .map((entry) => entry.name)
        .sort();
    for (const name of others.slice(0, Math.max(0, others.length - (keep - 1)))) {
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
        // 数据目录已经存在（配置校验查过），新建的只会是 `backups/` 这一层。
        makePrivateDir(backupsDir, {recursive: true});
        lock = tryLock(join(backupsDir, "backup.lock"));
    } catch (error) {
        return failed(backupFailure("io_failed", {errorCode: systemErrorCode(error)}));
    }
    if (lock === null) return failed(backupFailure("busy"));

    try {
        removeLeftoverPartials(backupsDir, log);
        const name = backupName(new Date());
        const partial = join(backupsDir, `${name}.partial`);
        try {
            // 不带 recursive：同名目录已存在时失败，不往别人的目录里写（这时也没有要删的东西）。
            makePrivateDir(partial, {recursive: false});
        } catch (error) {
            return failed(backupFailure("io_failed", {errorCode: systemErrorCode(error)}));
        }

        let renamed = false;
        try {
            for (const module of modules) {
                // `VACUUM INTO` 与 `prepareBackupCopy` 是同步的，期间到的停止信号排在宏任务里：每个模块之前让出一次再查。
                await yieldToEventLoop();
                if (stop.requested) return failed(INTERRUPTED);
                const failure = copyModule(dataDir, partial, module);
                if (failure !== undefined) return failed(failure);
            }
            // 改名之前的最后一个检查点：最后一个模块写副本期间到的信号要在这里看见，否则写到一半收到的停止照样发布成备份。
            // 改名之后到的信号不管：那一份已经写好，清理旧备份只是收尾。
            await yieldToEventLoop();
            if (stop.requested) return failed(INTERRUPTED);
            try {
                renameSync(partial, join(backupsDir, name));
            } catch (error) {
                return failed(backupFailure("io_failed", {errorCode: systemErrorCode(error)}));
            }
            renamed = true;
        } finally {
            if (!renamed) removePartial(partial, log);
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
