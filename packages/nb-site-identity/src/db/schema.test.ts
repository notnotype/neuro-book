/**
 * 账号库第一条迁移的形状（`migrations/0001_init.sql`）：库的四张表与基准文件的关系、按迁移运行器的规则写得进去、id 不重用、
 * 审计只追加、码表的约束。清单与目录的对应在 `src/migrations.test.ts`。
 */

import {Database, SQLiteError} from "bun:sqlite";
import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";

import {getMigrations} from "better-auth/db/migration";

import {identityMigrations} from "../migrations";
import {createTestDbRoot, type TestDbRoot} from "../testing/db";
import {createTestAuth, recordingLog} from "../testing/library";
import {IdentityConnection} from "./connection";

const PACKAGE_DIR = join(import.meta.dir, "..", "..");
const BASELINE_FILE = join(PACKAGE_DIR, "schema", "better-auth-baseline.sql");
const LIB_TABLES: readonly ["user", "session", "account", "verification"] = ["user", "session", "account", "verification"];
const LIB_ID = '"id" integer not null primary key';
const MIGRATION_ID = '"id" integer primary key autoincrement';

/** 基准文件去掉开头的注释段（到第一个空行为止）之后的正文。 */
function baselineBody(): string {
    const text = readFileSync(BASELINE_FILE, "utf8");
    const split = text.indexOf("\n\n");
    const header = text.slice(0, split);
    expect(header.split("\n").every((line) => line.startsWith("--"))).toBe(true);
    return text.slice(split + 2);
}

/** 库在本包的装配（插件与 id 写法）下对一个空库导出的结构。 */
async function currentLibraryExport(): Promise<string> {
    const db = new Database(":memory:", {strict: true});
    try {
        const conn = new IdentityConnection(db, {log: recordingLog()});
        const auth = createTestAuth(conn.libDatabase());
        return await (await getMigrations(auth.options)).compileMigrations();
    } finally {
        db.close();
    }
}

/** 库的四张表上的全部对象（表、索引、触发器）在 `sqlite_master` 里的名字与原文。 */
function libraryObjects(db: Database): {type: string; name: string; sql: string | null}[] {
    const placeholders = LIB_TABLES.map(() => "?").join(", ");
    return db.query<{type: string; name: string; sql: string | null}, string[]>(`SELECT type, name, sql FROM sqlite_master WHERE tbl_name IN (${placeholders}) ORDER BY type, name`).all(...LIB_TABLES);
}

let root: TestDbRoot;
let db: Database;

beforeEach(async () => {
    root = await createTestDbRoot("identity-schema");
    db = root.open();
});

afterEach(async () => {
    await root.cleanup();
});

describe("库的表与基准文件", () => {
    it("库当前导出的结构等于基准文件；基准写明的版本就是依赖钉的版本", async () => {
        expect(`${await currentLibraryExport()}\n`).toBe(baselineBody());
        const pinned = JSON.parse(readFileSync(join(PACKAGE_DIR, "package.json"), "utf8")).dependencies["better-auth"];
        expect(readFileSync(BASELINE_FILE, "utf8").split("\n", 1)[0]).toContain(`better-auth ${pinned}，`);
    });

    it("迁移里库的四张表与基准只差每张表一处 AUTOINCREMENT 替换", () => {
        const body = baselineBody();
        expect(body.split(LIB_ID).length - 1).toBe(LIB_TABLES.length);
        const expected = new Database(":memory:", {strict: true});
        try {
            expected.exec(body.replaceAll(LIB_ID, MIGRATION_ID));
            expect(libraryObjects(db)).toEqual(libraryObjects(expected));
        } finally {
            expected.close();
        }
    });
});

describe("按迁移运行器的规则", () => {
    it("在守卫保存点里执行完、没有结束运行器的事务、外键检查通过（createTestDbRoot 按这些规则执行了清单）", () => {
        expect(identityMigrations.map((migration) => migration.id)).toEqual(["0001_init"]);
        expect(db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'identity_%' ORDER BY name").all()).toEqual(
            ["identity_audit", "identity_consent", "identity_invite_code", "identity_profile", "identity_registration_code"].map((name) => ({name})),
        );
    });
});

const NOW = "2026-11-20T00:00:00.000Z";

let emailCounter = 0;

function insertUser(id?: number): number {
    const columns = id === undefined ? "" : "id, ";
    const values = id === undefined ? "" : `${id}, `;
    const email = `u${++emailCounter}@example.test`;
    return Number(db.run(`INSERT INTO "user" (${columns}name, email, "emailVerified", "createdAt", "updatedAt") VALUES (${values}'n', ?, 0, ?, ?)`, [email, NOW, NOW]).lastInsertRowid);
}

describe("id 不重用", () => {
    /** 每张库的表插入一行最小的合法数据，返回新行的 id。 */
    const inserters: Record<(typeof LIB_TABLES)[number], () => number> = {
        user: () => insertUser(),
        session: () => Number(db.run(`INSERT INTO session ("expiresAt", token, "createdAt", "updatedAt", "userId") VALUES (?, ?, ?, ?, ?)`, [NOW, crypto.randomUUID(), NOW, NOW, userId]).lastInsertRowid),
        account: () => Number(db.run(`INSERT INTO account ("accountId", "providerId", "userId", "createdAt", "updatedAt") VALUES ('a', 'credential', ?, ?, ?)`, [userId, NOW, NOW]).lastInsertRowid),
        verification: () => Number(db.run(`INSERT INTO verification (identifier, value, "expiresAt", "createdAt", "updatedAt") VALUES ('i', 'v', ?, ?, ?)`, [NOW, NOW, NOW]).lastInsertRowid),
    };
    let userId: number;

    it.each([...LIB_TABLES])("%s：删掉最大 id 的行之后，新插入的 id 更大", (table) => {
        userId = insertUser();
        const first = inserters[table]();
        const max = inserters[table]();
        expect(max).toBeGreaterThan(first);
        db.run(`DELETE FROM "${table}" WHERE id = ?`, [max]);
        expect(inserters[table]()).toBeGreaterThan(max);
    });

    it("显式写入一个大的账号 id 之后，新账号接着往上", () => {
        insertUser();
        insertUser(1000);
        expect(insertUser()).toBe(1001);
    });
});

/** 执行 `sql`，返回 SQLite 的错误码（例如 `SQLITE_CONSTRAINT_CHECK`）；成功时返回 null。 */
function errorCode(sql: string, params: (string | number | null)[] = []): string | null {
    try {
        db.run(sql, params);
        return null;
    } catch (error) {
        if (error instanceof SQLiteError) return error.code ?? "SQLITE_ERROR";
        throw error;
    }
}

describe("审计只追加", () => {
    it("插入可以，改、删与同 id 的替换都被触发器拒绝；params 只收 JSON 对象", () => {
        const insert = (params: string) => errorCode(`INSERT INTO identity_audit (created_at, actor_id, action, target_type, target_id, params) VALUES (?, NULL, 'admin.cli_upsert', 'user', 1, ?)`, [NOW, params]);
        expect(insert('{"role":"admin"}')).toBeNull();
        expect(errorCode("UPDATE identity_audit SET action = 'user.ban'")).toBe("SQLITE_CONSTRAINT_TRIGGER");
        expect(errorCode("DELETE FROM identity_audit")).toBe("SQLITE_CONSTRAINT_TRIGGER");
        // REPLACE 删冲突旧行不经删除触发器（业务连接没开 recursive_triggers），由插入前的触发器拒绝。
        expect(db.query("PRAGMA recursive_triggers").get()).toEqual({recursive_triggers: 0});
        for (const verb of ["REPLACE", "INSERT OR REPLACE"]) {
            const replaced = errorCode(`${verb} INTO identity_audit (id, created_at, actor_id, action, target_type, target_id) VALUES (1, ?, NULL, 'user.ban', 'user', 1)`, [NOW]);
            expect({verb, code: replaced}).toEqual({verb, code: "SQLITE_CONSTRAINT_TRIGGER"});
        }
        expect(db.query("SELECT id, action FROM identity_audit").all()).toEqual([{id: 1, action: "admin.cli_upsert"}]);
        // 显式给一个没用过的 id 照常插入。
        expect(errorCode(`INSERT INTO identity_audit (id, created_at, actor_id, action, target_type, target_id) VALUES (5, ?, NULL, 'user.ban', 'user', 1)`, [NOW])).toBeNull();
        expect(db.query("SELECT id, action FROM identity_audit ORDER BY id").all()).toEqual([
            {id: 1, action: "admin.cli_upsert"},
            {id: 5, action: "user.ban"},
        ]);
        for (const params of ["[]", '"text"', "1", "not json"]) expect({params, code: insert(params)}).toEqual({params, code: "SQLITE_CONSTRAINT_CHECK"});
    });
});

describe("码表的约束", () => {
    const code = (table: string, columns: Record<string, string | number | null>) => {
        const names = Object.keys(columns);
        return errorCode(`INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`, Object.values(columns));
    };

    it.each(["identity_registration_code", "identity_invite_code"])("%s：码唯一，次数的范围，创建者或主人要存在，类型严格", (table) => {
        const person = table === "identity_registration_code" ? "created_by" : "owner_id";
        const owner = insertUser();
        expect(code(table, {code: "A1", created_at: NOW, [person]: owner, max_uses: 3, used_count: 3, note: "旧站的备注"})).toBeNull();
        // 创建者、主人可以为空（命令行发的码、导入的旧码）。
        expect(code(table, {code: "A2", created_at: NOW, [person]: null, max_uses: null})).toBeNull();
        expect(code(table, {code: "A1", created_at: NOW})).toBe("SQLITE_CONSTRAINT_UNIQUE");
        expect(code(table, {code: "A3", created_at: NOW, max_uses: 0})).toBe("SQLITE_CONSTRAINT_CHECK");
        expect(code(table, {code: "A4", created_at: NOW, used_count: -1})).toBe("SQLITE_CONSTRAINT_CHECK");
        expect(code(table, {code: "A5", created_at: NOW, [person]: owner + 100})).toBe("SQLITE_CONSTRAINT_FOREIGNKEY");
        expect(code(table, {code: "A6", created_at: NOW, max_uses: "many"})).toBe("SQLITE_CONSTRAINT_DATATYPE");
        expect(code(table, {code: null, created_at: NOW})).toBe("SQLITE_CONSTRAINT_NOTNULL");
        expect(db.query(`SELECT used_count FROM ${table} WHERE code = 'A2'`).get()).toEqual({used_count: 0});
    });

    it("引用账号的外键不写 ON DELETE：有资料行的账号删不掉", () => {
        const user = insertUser();
        db.run("INSERT INTO identity_profile (user_id) VALUES (?)", [user]);
        expect(errorCode(`DELETE FROM "user" WHERE id = ?`, [user])).toBe("SQLITE_CONSTRAINT_FOREIGNKEY");
    });

    it("同意记录的条款版本只收日期的形状，境外存放只收 0 与 1", () => {
        const user = insertUser();
        const consent = (version: string, overseas: number) => errorCode("INSERT INTO identity_consent (user_id, terms_version, overseas_storage, created_at) VALUES (?, ?, ?, ?)", [user, version, overseas, NOW]);
        expect(consent("2026-11-20", 1)).toBeNull();
        expect(consent("2026-11-2", 1)).toBe("SQLITE_CONSTRAINT_CHECK");
        expect(consent("2026-11-20", 2)).toBe("SQLITE_CONSTRAINT_CHECK");
    });
});
