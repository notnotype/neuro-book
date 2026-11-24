/**
 * 迁移运行器：对一个模块的库执行它还没执行过的迁移（`site.operations` 输出 2、4、7、9）。
 *
 * 每个库一张账本 `site_migrations(id, checksum, applied_at)`，上一个版本的程序要读写它（输出 7）。兼容的约定：这三列的
 * 名字与含义不变，以后只许加可为空或带缺省值的列；运行器读写一律写明列名，所以较新的版本加了列，本版本照常读写。
 * `applied_at` 是到毫秒的 ISO 8601 UTC。表名带 `site_` 前缀，避开 Better Auth 的表名。
 *
 * 规则（逐条对应 `db/migrate.test.ts`）：
 * - 执行任何一条之前先校验整张清单：id 的格式、编号严格递增、没有按文字就能认出的禁用语句（见 `FORBIDDEN_STATEMENT`）。
 * - 再拿账本整体核对一遍，对不上就一条都不执行：已执行的校验和不同（发布过的迁移不能改）；没执行过的这条前面已有编号
 *   更大的（较新的版本跑过更后面的迁移，不能乱序补）；账本里有、清单里没有、编号却不大于清单最大编号的（合并后改了号、
 *   或只改了名，数据目录被一个迁移历史不同的程序迁移过）。
 * - 账本里有、清单里没有、编号比清单最大的还大的，是更新的版本留下的，照常运行，报一个 `migration.unknown_newer`。
 * - 每条迁移在自己的 `BEGIN IMMEDIATE` 事务里先重读账本、再执行并写账本：两个运行器先后拿到写锁时，后到的看见这条已有
 *   记录就跳过，不会执行第二遍。失败的这条回滚，之前提交的保留。
 * - 迁移不许结束运行器给它开的事务：执行之后查 `db.inTransaction`，不在事务里就失败。这时迁移里 `COMMIT` 之前的部分
 *   已经提交了、改不回来；接受这一点，因为每条迁移都会在测试里从空库执行一遍，发布前就会暴露。
 * - 外键在事务外关掉、全部做完再打开：外键打开时 `DROP TABLE` 会先隐式删光它的行，重建父表（SQLite 改列的标准做法）
 *   会静默级联删掉子表。代价是迁移自己不受外键约束，所以每条提交前跑 `PRAGMA foreign_key_check`，留下悬空引用就回滚。
 * - 每提交一条后让出一次宏任务再查调用方的停止标志：`bun:sqlite` 是同步的，不让出时信号处理函数要等全部迁移做完才跑。
 */

import {SQLiteError, type Database} from "bun:sqlite";
import {createHash} from "node:crypto";

export interface Migration {
    /** `NNNN_<小写下划线名>`：四位、模块内递增的编号加名字。写进账本，发布后不能改。 */
    readonly id: string;
    readonly sql: string;
}

/** 运行器只需要模块的这两样。 */
export interface MigratableModule {
    readonly name: string;
    readonly migrations: readonly Migration[];
}

/** 运行器在发生时立即报出的事件；调用方把它们写成日志行。`applied` 在那条迁移提交之后、下一条开始之前报。 */
export type MigrationEvent =
    | {readonly event: "migration.applied"; readonly module: string; readonly migration: string}
    | {readonly event: "migration.unknown_newer"; readonly module: string; readonly migration: string};

export interface RunMigrationsOptions {
    readonly report: (event: MigrationEvent) => void;
    /** 每条迁移开始之前查一次；为真时不再执行后面的，结果是 `stopped`。缺省从不停止。 */
    readonly stopRequested?: () => boolean;
}

/**
 * - `invalid_list`：清单本身不合格，是程序错误；没有执行任何一条，也没有建账本。
 * - `checksum_mismatch`：已执行过的迁移被改过。
 * - `out_of_order`：账本与清单的先后对不上（见模块头的规则）。
 * - `transaction_ended`：迁移自己结束了事务（写了 `COMMIT`、`END` 或 `ROLLBACK`）；它在那之前的部分已经提交。
 * - `foreign_key_violation`：迁移留下了悬空的外键引用，已回滚。
 * - `sql_error`：SQLite 报错（SQL 写错、磁盘满、库被别的进程锁着），已回滚；`dbCode` 与 `dbMessage` 是 SQLite 给的。
 */
export type MigrationFailureReason = "invalid_list" | "checksum_mismatch" | "out_of_order" | "transaction_ended" | "foreign_key_violation" | "sql_error";

export interface MigrationFailure {
    readonly ok: false;
    readonly code: "migration_failed";
    readonly reason: MigrationFailureReason;
    readonly module: string;
    /** 出问题的迁移 id；建账本、读账本这类不属于某一条的失败为 null。 */
    readonly migration: string | null;
    /** SQLite 的错误码，例如 `SQLITE_BUSY`；只有 `sql_error` 带。 */
    readonly dbCode?: string;
    /** SQLite 的错误说明。迁移的 SQL 在仓库里，说明里只有标识符与 SQL 片段，不含库里的取值与文件路径，可以照原样输出。 */
    readonly dbMessage?: string;
}

/** `stopped` 为真：停止标志在某两条之间置位，后面的没有执行；已执行的都已提交。 */
export type MigrationOutcome = {readonly ok: true; readonly stopped: boolean} | MigrationFailure;

const LEDGER_DDL = "CREATE TABLE IF NOT EXISTS site_migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)";

const MIGRATION_ID = /^(\d{4})_[a-z0-9]+(?:_[a-z0-9]+)*$/u;

/**
 * 语句开头（文件开头、分号或行首之后）是这些关键字的，运行器管不住：`PRAGMA` 在事务里要么报错要么不生效，`VACUUM` 不能在
 * 事务里执行，附加与分离别的库违反“每个模块只打开自己的库”（ADR 0061 决策 1）。按文字扫描，宁可误报。
 * 事务语句不在这里：它们由执行之后的 `db.inTransaction` 检查准确地认出来，按文字扫会误拒触发器与多行 `CASE … END`。
 */
const FORBIDDEN_STATEMENT = /(?:^|;)\s*(PRAGMA|ATTACH|DETACH|VACUUM)\b/imu;

function stripSqlComments(sql: string): string {
    return sql.replace(/\/\*[\s\S]*?\*\//gu, " ").replace(/--.*$/gmu, "");
}

/**
 * 校验和按去掉开头 BOM、换成 LF 换行之后的文字算：Windows 检出可能把 `.sql` 换成 CRLF（`.gitattributes` 没给它定换行），
 * Windows 的编辑器可能存进 BOM，同一份迁移不能因此算成“被改过”。
 */
export function migrationChecksum(sql: string): string {
    return createHash("sha256")
        .update(sql.replace(/^﻿/u, "").replace(/\r\n/gu, "\n"))
        .digest("hex");
}

function sequenceOf(id: string): number | null {
    const match = MIGRATION_ID.exec(id);
    return match === null ? null : Number(match[1]);
}

/** 清单里第一处不合格的迁移 id；全部合格时为 undefined。 */
function invalidListEntry(migrations: readonly Migration[]): string | undefined {
    let previous = 0;
    for (const migration of migrations) {
        const sequence = sequenceOf(migration.id);
        if (sequence === null || sequence <= previous || FORBIDDEN_STATEMENT.test(stripSqlComments(migration.sql))) return migration.id;
        previous = sequence;
    }
    return undefined;
}

interface LedgerRow {
    readonly id: string;
    readonly checksum: string;
}

function readLedger(db: Database): Map<string, string> {
    return new Map(db.query<LedgerRow, []>("SELECT id, checksum FROM site_migrations").all().map((row) => [row.id, row.checksum]));
}

/** 编号写坏了的条目算作 0：它不会让“编号更大的已执行”成立，在不认识的条目里按“不大于清单最大编号”失败。 */
function maxSequence(ids: Iterable<string>): number {
    let max = 0;
    for (const id of ids) max = Math.max(max, sequenceOf(id) ?? 0);
    return max;
}

type Decision = {readonly kind: "skip"} | {readonly kind: "apply"} | {readonly kind: "fail"; readonly reason: "checksum_mismatch" | "out_of_order"};

/** 按账本决定清单里的一条怎么办；事务外的整体核对与事务里的重读用同一个判断。 */
function decide(ledger: ReadonlyMap<string, string>, migration: Migration, checksum: string): Decision {
    const applied = ledger.get(migration.id);
    if (applied !== undefined) return applied === checksum ? {kind: "skip"} : {kind: "fail", reason: "checksum_mismatch"};
    return maxSequence(ledger.keys()) > sequenceOf(migration.id)! ? {kind: "fail", reason: "out_of_order"} : {kind: "apply"};
}

/** 在事务里认出来、要回滚这条迁移的失败。只在 `applyOne` 里抛出、在同一处接住。 */
class MigrationRejected extends Error {
    constructor(readonly reason: "checksum_mismatch" | "out_of_order" | "transaction_ended" | "foreign_key_violation") {
        super(reason);
    }
}

/** 返回 true 表示执行并提交了，false 表示事务里重读账本发现已有同样的记录、跳过。 */
function applyOne(db: Database, migration: Migration, checksum: string): boolean {
    db.exec("BEGIN IMMEDIATE");
    try {
        const decision = decide(readLedger(db), migration, checksum);
        if (decision.kind === "fail") throw new MigrationRejected(decision.reason);
        if (decision.kind === "skip") {
            db.exec("ROLLBACK");
            return false;
        }
        db.exec(migration.sql);
        if (!db.inTransaction) throw new MigrationRejected("transaction_ended");
        if (db.query("PRAGMA foreign_key_check").get() !== null) throw new MigrationRejected("foreign_key_violation");
        db.run("INSERT INTO site_migrations (id, checksum, applied_at) VALUES (?, ?, ?)", [migration.id, checksum, new Date().toISOString()]);
        db.exec("COMMIT");
        return true;
    } catch (error) {
        // 迁移自己结束了事务时这里已经没有事务可回滚。
        if (db.inTransaction) db.exec("ROLLBACK");
        throw error;
    }
}

/** 让出一次宏任务：微任务不够，信号处理函数排在宏任务里。 */
function yieldToEventLoop(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

/**
 * 对一个模块的库按清单顺序执行还没执行过的迁移；每条提交后立即 `report` 一个 `migration.applied`。
 * 预料之中的失败（清单不合格、账本对不上、SQL 出错、SQLite 报错）以返回值报告，不抛错；别的异常是程序错误，照常抛出。
 * 返回之前把外键设回打开，不论成败。调用方在它完成之前不能在这条连接上做别的事。
 */
export async function runMigrations(db: Database, module: MigratableModule, options: RunMigrationsOptions): Promise<MigrationOutcome> {
    const fail = (reason: MigrationFailureReason, migration: string | null, error?: unknown): MigrationFailure => ({
        ok: false,
        code: "migration_failed",
        reason,
        module: module.name,
        migration,
        ...(error instanceof SQLiteError ? {dbCode: error.code ?? "SQLITE_ERROR", dbMessage: error.message} : {}),
    });

    const invalid = invalidListEntry(module.migrations);
    if (invalid !== undefined) return fail("invalid_list", invalid);

    let ledger: Map<string, string>;
    try {
        db.exec(LEDGER_DDL);
        ledger = readLedger(db);
    } catch (error) {
        if (error instanceof SQLiteError) return fail("sql_error", null, error);
        throw error;
    }

    const listed = new Set(module.migrations.map((migration) => migration.id));
    const listMax = maxSequence(listed);
    const unknown = [...ledger.keys()].filter((id) => !listed.has(id));
    const unknownOlder = unknown.find((id) => (sequenceOf(id) ?? 0) <= listMax);
    if (unknownOlder !== undefined) return fail("out_of_order", unknownOlder);

    const pending: {readonly migration: Migration; readonly checksum: string}[] = [];
    for (const migration of module.migrations) {
        const checksum = migrationChecksum(migration.sql);
        const decision = decide(ledger, migration, checksum);
        if (decision.kind === "fail") return fail(decision.reason, migration.id);
        if (decision.kind === "apply") pending.push({migration, checksum});
    }

    if (pending.length > 0) {
        // 必须在事务外设：事务里改 `foreign_keys` 不生效。
        db.exec("PRAGMA foreign_keys = OFF");
        try {
            for (const {migration, checksum} of pending) {
                if (options.stopRequested?.() === true) return {ok: true, stopped: true};
                let applied: boolean;
                try {
                    applied = applyOne(db, migration, checksum);
                } catch (error) {
                    if (error instanceof MigrationRejected) return fail(error.reason, migration.id);
                    if (error instanceof SQLiteError) return fail("sql_error", migration.id, error);
                    throw error;
                }
                if (applied) options.report({event: "migration.applied", module: module.name, migration: migration.id});
                await yieldToEventLoop();
            }
        } finally {
            db.exec("PRAGMA foreign_keys = ON");
        }
    }

    for (const id of unknown) options.report({event: "migration.unknown_newer", module: module.name, migration: id});
    return {ok: true, stopped: false};
}

/**
 * 就绪检查用的判断：本模块清单里的每一条都在账本里（账本里多出来的不影响，输出 4）。还没建过账本的库算没迁移完。
 * 只读不写；调用方负责把它放进能证明拿得到写锁的事务里。
 */
export function migrationsApplied(db: Database, module: MigratableModule): boolean {
    const hasLedger = db.query<{found: number}, []>("SELECT count(*) AS found FROM sqlite_master WHERE type = 'table' AND name = 'site_migrations'").get()?.found === 1;
    if (!hasLedger) return module.migrations.length === 0;
    const ledger = readLedger(db);
    return module.migrations.every((migration) => ledger.has(migration.id));
}
