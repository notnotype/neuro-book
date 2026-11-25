/**
 * 包内测试用的库：真的 SQLite 文件，连接参数照入口的 `openModuleDb`（`nb-site-server/src/db/open.ts`），迁移照入口的迁移运行器
 * （`nb-site-server/src/db/migrate.ts`）的规则执行。
 *
 * 不经入口的运行器：本包不能依赖 `nb-site-server`（入口依赖本包，反过来就成了环；依赖白名单在
 * `nb-site-server/src/architecture.test.ts`）。这里照抄运行器在执行时的几条规则：外键在事务外关掉、`BEGIN IMMEDIATE` 里套守卫
 * 保存点、释放得了守卫保存点、提交前 `PRAGMA foreign_key_check`。运行器改了这几条时这里要跟着改。运行器按文字拒收的几种语句
 * 不在这里照抄（抄过来的关键字会被入口的 ATTACH 守卫当成源码里附加别的库）：同一份迁移经真实运行器执行，由起真实进程的合同测试
 * （`nb-site-contract-tests`，每个用例从空的数据目录启动）覆盖，清单不合格时那里每个用例都会以 `migration_failed` 失败。不含断言。
 */

import {Database} from "bun:sqlite";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {identityMigrations, type IdentityMigration} from "../migrations";

/** 与 `openModuleDb` 相同的连接参数，不迁移。 */
export function openIdentityDbFile(path: string): Database {
    const db = new Database(path, {create: true, strict: true});
    db.exec("PRAGMA busy_timeout = 250");
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
    db.exec("PRAGMA foreign_keys = ON");
    return db;
}

/** 按运行器的规则执行一条迁移；违反规则时抛错（消息写明哪一条），SQL 出错时抛 SQLite 的原错误。 */
export function applyMigrationLikeRunner(db: Database, migration: IdentityMigration): void {
    db.exec("PRAGMA foreign_keys = OFF");
    try {
        db.exec("BEGIN IMMEDIATE");
        try {
            db.exec("SAVEPOINT site_migration_guard");
            db.exec(migration.sql);
            db.exec("RELEASE site_migration_guard");
            if (!db.inTransaction) throw new Error(`${migration.id}: migration ended the runner's transaction`);
            if (db.query("PRAGMA foreign_key_check").get() !== null) throw new Error(`${migration.id}: migration left dangling foreign keys`);
            db.exec("COMMIT");
        } catch (error) {
            if (db.inTransaction) db.exec("ROLLBACK");
            throw error;
        }
    } finally {
        db.exec("PRAGMA foreign_keys = ON");
    }
}

/** 一个测试用的临时目录；`cleanup` 关掉登记过的连接再删目录，在 `afterEach` 里调用。 */
export interface TestDbRoot {
    readonly dir: string;
    /** 打开 `<dir>/identity.db`，第一次打开时按清单迁移。 */
    open(): Database;
    /** 同一个库文件上的另一条连接（模拟进程外的写者，例如 `create-admin`），不迁移。 */
    openOther(): Database;
    cleanup(): Promise<void>;
}

export async function createTestDbRoot(name: string): Promise<TestDbRoot> {
    const dir = await createTestTmpRoot(name, `nb-site-identity ${name}`);
    const path = join(dir, "identity.db");
    const opened: Database[] = [];
    let migrated = false;
    return {
        dir,
        open: () => {
            const db = openIdentityDbFile(path);
            opened.push(db);
            if (!migrated) {
                for (const migration of identityMigrations) applyMigrationLikeRunner(db, migration);
                migrated = true;
            }
            return db;
        },
        openOther: () => {
            const db = openIdentityDbFile(path);
            opened.push(db);
            return db;
        },
        cleanup: async () => {
            for (const db of opened) db.close();
            await rm(dir, {recursive: true, force: true});
        },
    };
}
