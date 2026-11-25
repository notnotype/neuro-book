/**
 * 迁移运行器（`site.operations` 输出 2、4、7），用真实的 SQLite 文件。每个用例一个临时数据目录，用完关库再删目录。
 */

import type {Database} from "bun:sqlite";
import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {migrationChecksum, migrationsApplied, runMigrations, type MigratableModule, type Migration, type MigrationEvent, type MigrationOutcome} from "./migrate";
import {openModuleDb} from "./open";

let dataDir: string;
const opened: Database[] = [];

beforeEach(async () => {
    dataDir = await createTestTmpRoot("nb-site-migrate", "nb-site-server db/migrate.test.ts");
});

afterEach(async () => {
    for (const db of opened.splice(0)) db.close();
    await rm(dataDir, {recursive: true, force: true});
});

function open(name = "sample"): Database {
    const db = openModuleDb(dataDir, name);
    opened.push(db);
    return db;
}

async function run(db: Database, migrations: readonly Migration[], stopRequested?: () => boolean): Promise<{outcome: MigrationOutcome; events: MigrationEvent[]}> {
    const events: MigrationEvent[] = [];
    const module: MigratableModule = {name: "sample", migrations};
    return {outcome: await runMigrations(db, module, {report: (event) => events.push(event), stopRequested}), events};
}

function tables(db: Database): string[] {
    return db
        .query<{name: string}, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all()
        .map((row) => row.name);
}

function ledgerIds(db: Database): string[] {
    return db
        .query<{id: string}, []>("SELECT id FROM site_migrations ORDER BY id")
        .all()
        .map((row) => row.id);
}

const INIT: Migration = {
    id: "0001_init",
    sql: `CREATE TABLE "user" ("id" INTEGER PRIMARY KEY, "name" TEXT NOT NULL);
CREATE INDEX "user_name_idx" ON "user" ("name");
INSERT INTO "user" ("name") VALUES ('first');`,
};
const SESSIONS: Migration = {id: "0002_sessions", sql: `CREATE TABLE "session" ("id" TEXT PRIMARY KEY, "user_id" INTEGER NOT NULL REFERENCES "user" ("id"));`};
const AUDIT: Migration = {id: "0003_audit", sql: `CREATE TABLE "audit" ("id" INTEGER PRIMARY KEY);`};

const DONE = {ok: true, stopped: false} as const;

function rows(db: Database, table: string): number {
    return db.query<{rows: number}, []>(`SELECT count(*) AS rows FROM "${table}"`).get()!.rows;
}

function foreignKeysOn(db: Database): boolean {
    return db.query<{foreign_keys: number}, []>("PRAGMA foreign_keys").get()?.foreign_keys === 1;
}

describe("迁移运行器", () => {
    it("从空库按顺序执行全部迁移，每条报一次 migration.applied；再执行一次什么都不做", async () => {
        const db = open();
        const first = await run(db, [INIT, SESSIONS]);
        expect(first.outcome).toEqual(DONE);
        expect(first.events).toEqual([
            {event: "migration.applied", module: "sample", migration: "0001_init"},
            {event: "migration.applied", module: "sample", migration: "0002_sessions"},
        ]);
        expect(tables(db)).toEqual(["session", "site_migrations", "user"]);
        expect(db.query<{journal_mode: string}, []>("PRAGMA journal_mode").get()?.journal_mode).toBe("wal");
        const appliedAt = db.query<{applied_at: string}, []>("SELECT applied_at FROM site_migrations").all();
        for (const row of appliedAt) expect(row.applied_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);

        const second = await run(db, [INIT, SESSIONS]);
        expect(second.outcome).toEqual(DONE);
        expect(second.events).toEqual([]);
        expect(rows(db, "user")).toBe(1);
    });

    it("某条迁移失败时它整条回滚，之前提交的保留，之后的不执行；结果带 SQLite 的错误码与说明（输出 2）", async () => {
        const db = open();
        const broken: Migration = {id: "0002_broken", sql: `CREATE TABLE "half" ("id" INTEGER);\nINSERT INTO "missing_table" VALUES (1);`};
        const {outcome, events} = await run(db, [INIT, broken, {...AUDIT, id: "0003_after"}]);
        expect(outcome).toMatchObject({ok: false, code: "migration_failed", reason: "sql_error", module: "sample", migration: "0002_broken", dbCode: "SQLITE_ERROR"});
        expect(outcome.ok === false && outcome.dbMessage).toContain("missing_table");
        expect(events).toEqual([{event: "migration.applied", module: "sample", migration: "0001_init"}]);
        expect(tables(db)).toEqual(["site_migrations", "user"]);
        expect(ledgerIds(db)).toEqual(["0001_init"]);
        expect(foreignKeysOn(db)).toBe(true);
    });

    it("已执行过的迁移内容被改了，一条都不执行", async () => {
        const db = open();
        await run(db, [INIT]);
        const {outcome, events} = await run(db, [{...INIT, sql: `${INIT.sql}\nINSERT INTO "user" ("name") VALUES ('second');`}, SESSIONS]);
        expect(outcome).toMatchObject({ok: false, reason: "checksum_mismatch", migration: "0001_init"});
        expect(outcome.ok === false && outcome.dbCode).toBeUndefined();
        expect(events).toEqual([]);
        expect(tables(db)).not.toContain("session");
    });

    it("较新的版本跑过更后面的迁移、本版本有一条没执行过的，拒绝补在后面", async () => {
        const db = open();
        // 另一个版本的清单是 0001、0003；本版本的是 0001、0002、0003。
        await run(db, [INIT, AUDIT]);
        const {outcome, events} = await run(db, [INIT, SESSIONS, AUDIT]);
        expect(outcome).toMatchObject({ok: false, reason: "out_of_order", migration: "0002_sessions"});
        expect(events).toEqual([]);
        expect(tables(db)).not.toContain("session");
    });

    it("账本里有清单之外、编号不大于清单最大编号的迁移，拒绝运行", async () => {
        const db = open();
        await run(db, [INIT, {id: "0002_elsewhere", sql: `CREATE TABLE "elsewhere" ("id" INTEGER);`}]);
        const {outcome} = await run(db, [INIT, SESSIONS, AUDIT]);
        expect(outcome).toMatchObject({ok: false, reason: "out_of_order", migration: "0002_elsewhere"});
        expect(tables(db)).not.toContain("audit");
    });

    it("两个分支合并后把一条已执行过的迁移改了号，拒绝运行，不把同一段 SQL 执行第二遍", async () => {
        const db = open();
        // 分支上的 0002_b 已在这个数据目录上执行过；合并后主线占了 0002，它被改号成 0003_b。
        const branchB: Migration = {id: "0002_b", sql: `CREATE TABLE "b" ("id" INTEGER);`};
        await run(db, [INIT, branchB]);
        const {outcome, events} = await run(db, [INIT, {id: "0002_a", sql: `CREATE TABLE "a" ("id" INTEGER);`}, {...branchB, id: "0003_b"}]);
        expect(outcome).toMatchObject({ok: false, reason: "out_of_order", migration: "0002_b"});
        expect(events).toEqual([]);
        expect(tables(db)).not.toContain("a");
        expect(ledgerIds(db)).toEqual(["0001_init", "0002_b"]);
    });

    it("只把一条已执行过的迁移改了名、SQL 不变，拒绝运行", async () => {
        const db = open();
        await run(db, [INIT, SESSIONS]);
        const {outcome} = await run(db, [INIT, {...SESSIONS, id: "0002_login_sessions"}]);
        expect(outcome).toMatchObject({ok: false, reason: "out_of_order", migration: "0002_sessions"});
        expect(ledgerIds(db)).toEqual(["0001_init", "0002_sessions"]);
    });

    it("库里有下一个版本多出的迁移时照常运行、报 migration.unknown_newer，就绪判断为真（输出 4、7）", async () => {
        const db = open();
        expect(migrationsApplied(db, {name: "sample", migrations: [INIT, SESSIONS]})).toBe(false);
        await run(db, [INIT, SESSIONS, AUDIT]);
        const {outcome, events} = await run(db, [INIT, SESSIONS]);
        expect(outcome).toEqual(DONE);
        expect(events).toEqual([{event: "migration.unknown_newer", module: "sample", migration: "0003_audit"}]);
        expect(migrationsApplied(db, {name: "sample", migrations: [INIT, SESSIONS]})).toBe(true);
        expect(migrationsApplied(db, {name: "sample", migrations: [INIT, SESSIONS, AUDIT, {id: "0004_later", sql: "SELECT 1;"}]})).toBe(false);
    });

    it("较新的版本给账本加了一列，本版本照常读写账本", async () => {
        const db = open();
        db.exec(`CREATE TABLE site_migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL, duration_ms INTEGER NOT NULL DEFAULT 0, runner TEXT)`);
        expect((await run(db, [INIT])).outcome).toEqual(DONE);
        const {outcome, events} = await run(db, [INIT, SESSIONS]);
        expect(outcome).toEqual(DONE);
        expect(events).toEqual([{event: "migration.applied", module: "sample", migration: "0002_sessions"}]);
        expect(ledgerIds(db)).toEqual(["0001_init", "0002_sessions"]);
        expect(migrationsApplied(db, {name: "sample", migrations: [INIT, SESSIONS]})).toBe(true);
    });

    it("账本里没有本版本的某条迁移时就绪判断为假；没有迁移的模块在空库上也算迁移完", async () => {
        const db = open();
        await run(db, [INIT]);
        expect(migrationsApplied(db, {name: "sample", migrations: [INIT, SESSIONS]})).toBe(false);
        expect(migrationsApplied(open("empty"), {name: "empty", migrations: []})).toBe(true);
    });

    it("另一个运行器在两次读账本之间执行了同一条迁移，本运行器在事务里重读账本后跳过它", async () => {
        const db = open();
        const other = open();
        const module: MigratableModule = {name: "sample", migrations: [INIT, SESSIONS]};
        let otherRun: Promise<MigrationOutcome> | undefined;
        const events: MigrationEvent[] = [];
        // 本运行器已读过账本、还没开始第一条时，另一条连接上的运行器先同步执行完第一条（它在第一次让出之前提交）。
        const outcome = await runMigrations(db, module, {
            report: (event) => events.push(event),
            stopRequested: () => {
                otherRun ??= runMigrations(other, module, {report: () => undefined});
                return false;
            },
        });
        expect(await otherRun).toEqual(DONE);
        expect(outcome).toEqual(DONE);
        expect(events.map((event) => event.event === "migration.applied" && event.migration)).not.toContain("0001_init");
        expect(rows(db, "user")).toBe(1);
        expect(ledgerIds(db)).toEqual(["0001_init", "0002_sessions"]);
    });

    it("停止请求在一条迁移执行期间到达：把这一条做完、提交，后面的不执行（输出 9）", async () => {
        const db = open();
        let stop = false;
        let checks = 0;
        // 第一条开始之前排上置位的宏任务，相当于信号在第一条执行期间到达：同步的迁移做完、运行器让出时它才跑。
        const stopRequested = (): boolean => {
            checks += 1;
            if (checks === 1) {
                setImmediate(() => {
                    stop = true;
                });
            }
            return stop;
        };
        const {outcome, events} = await run(db, [INIT, SESSIONS, AUDIT], stopRequested);
        expect(outcome).toEqual({ok: true, stopped: true});
        expect(events).toEqual([{event: "migration.applied", module: "sample", migration: "0001_init"}]);
        expect(ledgerIds(db)).toEqual(["0001_init"]);
        expect(tables(db)).toEqual(["site_migrations", "user"]);
        expect(foreignKeysOn(db)).toBe(true);
    });

    describe("外键", () => {
        const FAMILY: Migration = {
            id: "0001_family",
            sql: `CREATE TABLE "user" ("id" INTEGER PRIMARY KEY, "name" TEXT NOT NULL);
CREATE TABLE "session" ("id" TEXT PRIMARY KEY, "user_id" INTEGER NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE);
INSERT INTO "user" ("id", "name") VALUES (1, 'a');
INSERT INTO "session" ("id", "user_id") VALUES ('s1', 1), ('s2', 1);`,
        };

        it("重建父表（建新表、拷数据、删旧表、改名）不会级联删掉子表的行，做完外键照常打开", async () => {
            const db = open();
            const rebuild: Migration = {
                id: "0002_user_email",
                sql: `CREATE TABLE "user_new" ("id" INTEGER PRIMARY KEY, "name" TEXT NOT NULL, "email" TEXT);
INSERT INTO "user_new" ("id", "name") SELECT "id", "name" FROM "user";
DROP TABLE "user";
ALTER TABLE "user_new" RENAME TO "user";`,
            };
            expect((await run(db, [FAMILY, rebuild])).outcome).toEqual(DONE);
            expect(rows(db, "session")).toBe(2);
            expect(foreignKeysOn(db)).toBe(true);
            // 外键打开着：删掉父表的行照常级联。
            db.exec(`DELETE FROM "user" WHERE "id" = 1`);
            expect(rows(db, "session")).toBe(0);
        });

        it("迁移留下悬空的外键引用时整条回滚并失败", async () => {
            const db = open();
            const dangling: Migration = {id: "0002_dangling", sql: `INSERT INTO "session" ("id", "user_id") VALUES ('s3', 99);`};
            const {outcome} = await run(db, [FAMILY, dangling]);
            expect(outcome).toMatchObject({ok: false, reason: "foreign_key_violation", migration: "0002_dangling"});
            expect(rows(db, "session")).toBe(2);
            expect(ledgerIds(db)).toEqual(["0001_family"]);
            expect(foreignKeysOn(db)).toBe(true);
        });
    });

    describe("事务语句", () => {
        it("迁移自己提交了事务时失败、不记进账本（COMMIT 之前的部分已经提交，接受）", async () => {
            const db = open();
            const committing: Migration = {id: "0002_commit", sql: `CREATE TABLE "a" ("id" INTEGER);\nCOMMIT;\nCREATE TABLE "b" ("id" INTEGER);`};
            const {outcome, events} = await run(db, [INIT, committing]);
            expect(outcome).toMatchObject({ok: false, reason: "transaction_ended", migration: "0002_commit"});
            expect(events).toEqual([{event: "migration.applied", module: "sample", migration: "0001_init"}]);
            expect(ledgerIds(db)).toEqual(["0001_init"]);
            expect(db.inTransaction).toBe(false);
        });

        it("迁移自己回滚了事务时失败、不记进账本", async () => {
            const db = open();
            const {outcome} = await run(db, [INIT, {id: "0002_rollback", sql: `CREATE TABLE "a" ("id" INTEGER);\nROLLBACK;`}]);
            expect(outcome).toMatchObject({ok: false, reason: "transaction_ended", migration: "0002_rollback"});
            expect(tables(db)).not.toContain("a");
            expect(ledgerIds(db)).toEqual(["0001_init"]);
        });

        it("迁移结束事务后又开了一个，照样失败：后开的事务回滚，账本里没有这一条", async () => {
            const db = open();
            const commitThenBegin: Migration = {id: "0002_commit_begin", sql: `CREATE TABLE "a" ("id" INTEGER);\nCOMMIT;\nBEGIN;\nCREATE TABLE "b" ("id" INTEGER);`};
            const commitOutcome = await run(db, [INIT, commitThenBegin]);
            expect(commitOutcome.outcome).toMatchObject({ok: false, reason: "transaction_ended", migration: "0002_commit_begin"});
            // 认得出、撤不回：COMMIT 之前的 a 已经提交，之后的 b 随后开的事务一起回滚。
            expect(tables(db)).toEqual(["a", "site_migrations", "user"]);
            expect(ledgerIds(db)).toEqual(["0001_init"]);
            expect(db.inTransaction).toBe(false);

            const other = open("other");
            const rollbackThenBegin: Migration = {id: "0002_rollback_begin", sql: `CREATE TABLE "a" ("id" INTEGER);\nROLLBACK;\nBEGIN;\nCREATE TABLE "b" ("id" INTEGER);`};
            const rollbackOutcome = await run(other, [INIT, rollbackThenBegin]);
            expect(rollbackOutcome.outcome).toMatchObject({ok: false, reason: "transaction_ended", migration: "0002_rollback_begin"});
            expect(tables(other)).toEqual(["site_migrations", "user"]);
            expect(ledgerIds(other)).toEqual(["0001_init"]);
            expect(other.inTransaction).toBe(false);
        });

        it("迁移释放了运行器的守卫保存点时失败，整条回滚", async () => {
            const db = open();
            const {outcome} = await run(db, [INIT, {id: "0002_release_guard", sql: `CREATE TABLE "a" ("id" INTEGER);\nRELEASE site_migration_guard;\nCREATE TABLE "b" ("id" INTEGER);`}]);
            expect(outcome).toMatchObject({ok: false, reason: "transaction_ended", migration: "0002_release_guard"});
            expect(tables(db)).toEqual(["site_migrations", "user"]);
            expect(ledgerIds(db)).toEqual(["0001_init"]);
        });

        it("迁移开关自己的保存点照常执行", async () => {
            const db = open();
            const own: Migration = {id: "0002_own_savepoint", sql: `SAVEPOINT "step";\nCREATE TABLE "a" ("id" INTEGER);\nRELEASE "step";\nSAVEPOINT "undo";\nCREATE TABLE "b" ("id" INTEGER);\nROLLBACK TO "undo";\nRELEASE "undo";`};
            expect((await run(db, [INIT, own])).outcome).toEqual(DONE);
            expect(tables(db)).toEqual(["a", "site_migrations", "user"]);
            expect(ledgerIds(db)).toEqual(["0001_init", "0002_own_savepoint"]);
        });

        it("带 BEGIN … END 的触发器与多行 CASE … END 照常执行", async () => {
            const db = open();
            const trigger: Migration = {
                id: "0004_audit_trigger",
                sql: `CREATE TRIGGER "user_audit" AFTER INSERT ON "user"
BEGIN
  INSERT INTO "audit" ("id") VALUES (NEW."id");
END;
CREATE VIEW "user_kind" AS SELECT "id", CASE WHEN "name" = 'first' THEN 'seed'
ELSE 'other'
END AS "kind" FROM "user";`,
            };
            const {outcome} = await run(db, [INIT, SESSIONS, AUDIT, trigger]);
            expect(outcome).toEqual(DONE);
            db.exec(`INSERT INTO "user" ("name") VALUES ('second')`);
            expect(rows(db, "audit")).toBe(1);
            expect(db.query<{kind: string}, []>(`SELECT "kind" FROM "user_kind" ORDER BY "id"`).all().map((row) => row.kind)).toEqual(["seed", "other"]);
        });
    });

    describe("清单不合格时在执行任何一条之前拒绝，连账本也不建", () => {
        const cases: readonly {readonly name: string; readonly bad: Migration}[] = [
            {name: "id 不是四位编号加小写下划线名", bad: {id: "0002-Sessions", sql: SESSIONS.sql}},
            {name: "编号没有递增", bad: {id: "0001_again", sql: SESSIONS.sql}},
            {name: "含 PRAGMA", bad: {id: "0002_pragma", sql: `PRAGMA foreign_keys = OFF;\n${SESSIONS.sql}`}},
            {name: "附加别的库", bad: {id: "0002_attach", sql: `ATTACH DATABASE 'other.db' AS other;\n${SESSIONS.sql}`}},
            {name: "分离库", bad: {id: "0002_detach", sql: `${SESSIONS.sql}\nDETACH DATABASE other;`}},
            {name: "VACUUM", bad: {id: "0002_vacuum", sql: `${SESSIONS.sql}\nVACUUM;`}},
        ];
        for (const {name, bad} of cases) {
            it(name, async () => {
                const db = open();
                const {outcome, events} = await run(db, [INIT, bad]);
                expect(outcome).toMatchObject({ok: false, code: "migration_failed", reason: "invalid_list", migration: bad.id});
                expect(events).toEqual([]);
                expect(tables(db)).toEqual([]);
            });
        }

        it("注释里出现这些词不算", async () => {
            const db = open();
            const commented: Migration = {id: "0002_commented", sql: `-- 不写 PRAGMA 或 ATTACH\n/* VACUUM */\n${SESSIONS.sql}`};
            expect((await run(db, [INIT, commented])).outcome).toEqual(DONE);
        });
    });

    it("同一份迁移换成 CRLF 换行、带上开头的 BOM，校验和不变，不算被改过", async () => {
        const db = open();
        await run(db, [INIT]);
        expect(migrationChecksum(`﻿${INIT.sql.replace(/\n/gu, "\r\n")}`)).toBe(migrationChecksum(INIT.sql));
        const {outcome, events} = await run(db, [{...INIT, sql: `﻿${INIT.sql.replace(/\n/gu, "\r\n")}`}, SESSIONS]);
        expect(outcome).toEqual(DONE);
        expect(events).toEqual([{event: "migration.applied", module: "sample", migration: "0002_sessions"}]);
    });

    it("字面量里带 CRLF 的迁移，落进库里的是 LF：校验和相同就是执行的文字相同", async () => {
        const db = open();
        const seed: Migration = {id: "0002_seed", sql: `INSERT INTO "user" ("name") VALUES ('top\r\nbottom');\r\n`};
        expect((await run(db, [INIT, seed])).outcome).toEqual(DONE);
        expect(db.query<{name: string}, []>(`SELECT "name" FROM "user" WHERE "id" = 2`).get()?.name).toBe("top\nbottom");
    });
});
