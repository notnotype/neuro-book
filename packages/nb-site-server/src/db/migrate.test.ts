/**
 * 迁移运行器（`site.operations` 输出 2、4、7），用真实的 SQLite 文件。每个用例一个临时数据目录，用完关库再删目录。
 */

import type {Database} from "bun:sqlite";
import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {migrationsApplied, runMigrations, type MigratableModule, type Migration, type MigrationEvent} from "./migrate";
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

function run(db: Database, migrations: readonly Migration[]): {outcome: ReturnType<typeof runMigrations>; events: MigrationEvent[]} {
    const events: MigrationEvent[] = [];
    const module: MigratableModule = {name: "sample", migrations};
    return {outcome: runMigrations(db, module, (event) => events.push(event)), events};
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

describe("迁移运行器", () => {
    it("从空库按顺序执行全部迁移，每条报一次 migration.applied；再执行一次什么都不做", () => {
        const db = open();
        const first = run(db, [INIT, SESSIONS]);
        expect(first.outcome).toEqual({ok: true});
        expect(first.events).toEqual([
            {event: "migration.applied", module: "sample", migration: "0001_init"},
            {event: "migration.applied", module: "sample", migration: "0002_sessions"},
        ]);
        expect(tables(db)).toEqual(["session", "site_migrations", "user"]);
        expect(db.query<{journal_mode: string}, []>("PRAGMA journal_mode").get()?.journal_mode).toBe("wal");

        const second = run(db, [INIT, SESSIONS]);
        expect(second.outcome).toEqual({ok: true});
        expect(second.events).toEqual([]);
        expect(db.query<{rows: number}, []>(`SELECT count(*) AS rows FROM "user"`).get()?.rows).toBe(1);
    });

    it("某条迁移失败时它整条回滚，之前提交的保留，之后的不执行（输出 2）", () => {
        const db = open();
        const broken: Migration = {id: "0002_broken", sql: `CREATE TABLE "half" ("id" INTEGER);\nINSERT INTO "missing_table" VALUES (1);`};
        const {outcome, events} = run(db, [INIT, broken, {...AUDIT, id: "0003_after"}]);
        expect(outcome).toMatchObject({ok: false, code: "migration_failed", reason: "sql_error", module: "sample", migration: "0002_broken"});
        expect(events).toEqual([{event: "migration.applied", module: "sample", migration: "0001_init"}]);
        expect(tables(db)).toEqual(["site_migrations", "user"]);
        expect(ledgerIds(db)).toEqual(["0001_init"]);
    });

    it("已执行过的迁移内容被改了，拒绝运行", () => {
        const db = open();
        run(db, [INIT]);
        const {outcome, events} = run(db, [{...INIT, sql: `${INIT.sql}\nINSERT INTO "user" ("name") VALUES ('second');`}, SESSIONS]);
        expect(outcome).toMatchObject({ok: false, reason: "checksum_mismatch", migration: "0001_init"});
        expect(events).toEqual([]);
        expect(tables(db)).not.toContain("session");
    });

    it("较新的版本跑过更后面的迁移、本版本有一条没执行过的，拒绝补在后面", () => {
        const db = open();
        // 另一个版本的清单是 0001、0003；本版本的是 0001、0002、0003。
        run(db, [INIT, AUDIT]);
        const {outcome, events} = run(db, [INIT, SESSIONS, AUDIT]);
        expect(outcome).toMatchObject({ok: false, reason: "out_of_order", migration: "0002_sessions"});
        expect(events).toEqual([]);
        expect(tables(db)).not.toContain("session");
    });

    it("账本里有清单之外、编号不大于清单最大编号的迁移，拒绝运行", () => {
        const db = open();
        run(db, [INIT, {id: "0002_elsewhere", sql: `CREATE TABLE "elsewhere" ("id" INTEGER);`}]);
        const {outcome} = run(db, [INIT, SESSIONS, AUDIT]);
        expect(outcome).toMatchObject({ok: false, reason: "out_of_order", migration: "0002_elsewhere"});
        expect(tables(db)).not.toContain("audit");
    });

    it("库里有下一个版本多出的迁移时照常运行、报 migration.unknown_newer，就绪判断为真（输出 4、7）", () => {
        const db = open();
        expect(migrationsApplied(db, {name: "sample", migrations: [INIT, SESSIONS]})).toBe(false);
        run(db, [INIT, SESSIONS, AUDIT]);
        const {outcome, events} = run(db, [INIT, SESSIONS]);
        expect(outcome).toEqual({ok: true});
        expect(events).toEqual([{event: "migration.unknown_newer", module: "sample", migration: "0003_audit"}]);
        expect(migrationsApplied(db, {name: "sample", migrations: [INIT, SESSIONS]})).toBe(true);
        expect(migrationsApplied(db, {name: "sample", migrations: [INIT, SESSIONS, AUDIT, {id: "0004_later", sql: "SELECT 1;"}]})).toBe(false);
    });

    it("账本里没有本版本的某条迁移时就绪判断为假；没有迁移的模块在空库上也算迁移完", () => {
        const db = open();
        run(db, [INIT]);
        expect(migrationsApplied(db, {name: "sample", migrations: [INIT, SESSIONS]})).toBe(false);
        expect(migrationsApplied(open("empty"), {name: "empty", migrations: []})).toBe(true);
    });

    describe("清单不合格时在执行任何一条之前拒绝，连账本也不建", () => {
        const cases: readonly {readonly name: string; readonly bad: Migration}[] = [
            {name: "id 不是四位编号加小写下划线名", bad: {id: "0002-Sessions", sql: SESSIONS.sql}},
            {name: "编号没有递增", bad: {id: "0001_again", sql: SESSIONS.sql}},
            {name: "含事务语句", bad: {id: "0002_tx", sql: `BEGIN;\n${SESSIONS.sql}\nCOMMIT;`}},
            {name: "含 PRAGMA", bad: {id: "0002_pragma", sql: `PRAGMA foreign_keys = OFF;\n${SESSIONS.sql}`}},
            {name: "附加别的库", bad: {id: "0002_attach", sql: `ATTACH DATABASE 'other.db' AS other;\n${SESSIONS.sql}`}},
            {name: "行首的 END（触发器写法，已知限制）", bad: {id: "0002_trigger", sql: `CREATE TRIGGER t AFTER INSERT ON "user" BEGIN\n  SELECT 1;\nEND;`}},
        ];
        for (const {name, bad} of cases) {
            it(name, () => {
                const db = open();
                const {outcome, events} = run(db, [INIT, bad]);
                expect(outcome).toMatchObject({ok: false, code: "migration_failed", reason: "invalid_list", migration: bad.id});
                expect(events).toEqual([]);
                expect(tables(db)).toEqual([]);
            });
        }

        it("注释里出现这些词不算", () => {
            const db = open();
            const commented: Migration = {id: "0002_commented", sql: `-- 不写 BEGIN、PRAGMA 或 ATTACH\n/* VACUUM */\n${SESSIONS.sql}`};
            expect(run(db, [INIT, commented]).outcome).toEqual({ok: true});
        });
    });

    it("同一份迁移换成 CRLF 换行，校验和不变，不算被改过", () => {
        const db = open();
        run(db, [INIT]);
        const {outcome, events} = run(db, [{...INIT, sql: INIT.sql.replace(/\n/gu, "\r\n")}, SESSIONS]);
        expect(outcome).toEqual({ok: true});
        expect(events).toEqual([{event: "migration.applied", module: "sample", migration: "0002_sessions"}]);
    });
});
