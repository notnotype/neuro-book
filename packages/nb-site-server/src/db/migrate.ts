/**
 * 迁移运行器：对一个模块的库执行它还没执行过的迁移（`site.operations` 输出 2、4、7）。
 *
 * 每个库一张账本 `site_migrations(id, checksum, applied_at)`。上一个版本的程序要读它来判断就绪（输出 7），所以它的形状
 * 以后不能改；表名带 `site_` 前缀，避开 Better Auth 的表名。
 *
 * 规则（逐条对应 `db/migrate.test.ts`）：
 * - 执行任何一条之前先校验整张清单：id 的格式、编号严格递增、没有运行器管不住的语句（见 `FORBIDDEN_STATEMENT`）。
 * - 已执行且校验和相同的跳过；校验和不同的失败：发布过的迁移不能改。
 * - 没执行过的，若账本里已有编号不小于它的别的迁移，失败：较新的版本跑过更后面的迁移，这条不能补在它们后面。
 *   账本里有、清单里没有、编号却不大于清单最大编号的条目同样失败：数据目录被一个迁移历史不同的程序迁移过。
 * - 账本里有、清单里没有、编号比清单最大的还大的，是更新的版本留下的，照常运行，报一个 `migration.unknown_newer`。
 * - 每条迁移在自己的 `BEGIN IMMEDIATE` 事务里执行并写账本；失败的这条回滚，之前提交的保留。
 *
 * 已知限制：校验拒收事务语句，带 `BEGIN … END` 的触发器因此写不进迁移；第一次需要触发器时再放开（例如按文件声明），
 * 同时补测试。同理，SQLite 改列要在事务外关外键（`PRAGMA foreign_keys = OFF`），本运行器也不支持。
 */

import type {Database} from "bun:sqlite";
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

/** 运行器在发生时立即报出的事件；调用方把它们写成日志行。`applied` 在那条迁移提交之后报。 */
export type MigrationEvent =
    | {readonly event: "migration.applied"; readonly module: string; readonly migration: string}
    | {readonly event: "migration.unknown_newer"; readonly module: string; readonly migration: string};

/**
 * - `invalid_list`：清单本身不合格，是程序错误；没有执行任何一条，也没有建账本。
 * - `checksum_mismatch`：已执行过的迁移被改过。
 * - `out_of_order`：账本与清单的先后对不上（见模块头的规则）。
 * - `sql_error`：这条迁移的 SQL 执行失败，已回滚。
 */
export type MigrationFailureReason = "invalid_list" | "checksum_mismatch" | "out_of_order" | "sql_error";

export type MigrationOutcome =
    | {readonly ok: true}
    | {
          readonly ok: false;
          readonly code: "migration_failed";
          readonly reason: MigrationFailureReason;
          readonly module: string;
          /** 出问题的迁移 id；清单整体不合格时可能为 null。 */
          readonly migration: string | null;
          /** 底层错误，只给诊断用：SQLite 的错误说明里可能带 SQL 片段，不原样写进对外的输出。 */
          readonly cause?: unknown;
      };

const LEDGER_DDL = "CREATE TABLE IF NOT EXISTS site_migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)";

const MIGRATION_ID = /^(\d{4})_[a-z0-9]+(?:_[a-z0-9]+)*$/u;

/**
 * 语句开头（文件开头、分号或行首之后）是这些关键字的，运行器给每条迁移包的事务管不住：事务语句会提前提交或报错，
 * `PRAGMA` 在事务里要么报错要么不生效，`VACUUM` 不能在事务里执行，附加与分离别的库违反“每个模块只打开自己的库”（ADR 0061 决策 1）。
 * 按文字扫描，宁可误报：行首是 `END` 的触发器写法也会被拦下，见模块头的已知限制。
 */
const FORBIDDEN_STATEMENT = /(?:^|;)\s*(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE|PRAGMA|ATTACH|DETACH|VACUUM)\b/imu;

function stripSqlComments(sql: string): string {
    return sql.replace(/\/\*[\s\S]*?\*\//gu, " ").replace(/--.*$/gmu, "");
}

/** 校验和按 LF 换行算：Windows 检出可能把 `.sql` 换成 CRLF（`.gitattributes` 没给它定换行），同一份迁移不能因此算成“被改过”。 */
export function migrationChecksum(sql: string): string {
    return createHash("sha256").update(sql.replace(/\r\n/gu, "\n")).digest("hex");
}

function sequenceOf(id: string): number | null {
    const match = MIGRATION_ID.exec(id);
    return match === null ? null : Number(match[1]);
}

/** 清单里第一处不合格的迁移 id；全部合格时为 undefined。 */
function invalidListEntry(migrations: readonly Migration[]): {migration: string} | undefined {
    let previous = 0;
    for (const migration of migrations) {
        const sequence = sequenceOf(migration.id);
        if (sequence === null || sequence <= previous || FORBIDDEN_STATEMENT.test(stripSqlComments(migration.sql))) return {migration: migration.id};
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

/**
 * 对一个模块的库执行还没执行过的迁移，按清单顺序逐条进行；每条提交后立即 `report` 一个 `migration.applied`。
 * 预料之中的失败以返回值报告，不抛错；SQLite 本身的意外（磁盘满、库损坏）在执行某条迁移时发生的，归为那条的 `sql_error`。
 * 读账本出错（库打不开、不是 SQLite 文件）照常抛出，由调用方当作 `migration_failed` 处理。
 */
export function runMigrations(db: Database, module: MigratableModule, report: (event: MigrationEvent) => void): MigrationOutcome {
    const fail = (reason: MigrationFailureReason, migration: string | null, cause?: unknown): MigrationOutcome => ({ok: false, code: "migration_failed", reason, module: module.name, migration, cause});

    const invalid = invalidListEntry(module.migrations);
    if (invalid !== undefined) return fail("invalid_list", invalid.migration);

    db.exec(LEDGER_DDL);
    const ledger = readLedger(db);
    const listed = new Set(module.migrations.map((migration) => migration.id));
    const listMax = module.migrations.reduce((max, migration) => Math.max(max, sequenceOf(migration.id)!), 0);
    // 账本里不认识的条目：编号写坏了的也算不认识，当作“不大于清单最大编号”处理（失败），不猜它来自哪个版本。
    const unknown = [...ledger.keys()].filter((id) => !listed.has(id)).map((id) => ({id, sequence: sequenceOf(id)}));
    const unknownOlder = unknown.find((entry) => entry.sequence === null || entry.sequence <= listMax);
    if (unknownOlder !== undefined) return fail("out_of_order", unknownOlder.id);
    const ledgerMax = [...ledger.keys()].reduce((max, id) => Math.max(max, sequenceOf(id) ?? 0), 0);

    for (const migration of module.migrations) {
        const checksum = migrationChecksum(migration.sql);
        const applied = ledger.get(migration.id);
        if (applied !== undefined) {
            if (applied !== checksum) return fail("checksum_mismatch", migration.id);
            continue;
        }
        if (ledgerMax > sequenceOf(migration.id)!) return fail("out_of_order", migration.id);
        try {
            db.transaction(() => {
                db.exec(migration.sql);
                db.run("INSERT INTO site_migrations (id, checksum, applied_at) VALUES (?, ?, ?)", [migration.id, checksum, new Date().toISOString()]);
            }).immediate();
        } catch (error) {
            return fail("sql_error", migration.id, error);
        }
        report({event: "migration.applied", module: module.name, migration: migration.id});
    }

    for (const entry of unknown) report({event: "migration.unknown_newer", module: module.name, migration: entry.id});
    return {ok: true};
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
