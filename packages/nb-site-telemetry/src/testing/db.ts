/**
 * 包内测试用的库：真的 SQLite 文件，按本包的迁移清单建表，连接参数照入口的 `openModuleDb`（`nb-site-server/src/db/open.ts`）。
 *
 * 不经入口的迁移运行器：本包不能依赖 `nb-site-server`（入口依赖本包，反过来就成了环；依赖白名单在
 * `nb-site-server/src/architecture.test.ts`）。这里只按运行器的做法给每条迁移一个 `BEGIN IMMEDIATE` 事务。
 * 同一份迁移经真实运行器执行，由起真实进程的合同测试（`nb-site-contract-tests`）覆盖。不含断言。
 */

import {Database} from "bun:sqlite";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {telemetryMigrations} from "../migrations";

/** 打开（不存在就新建并迁移）`<dir>/telemetry.db`。已经迁移过的库直接打开，用来测“重开之后”。 */
export function openTelemetryTestDb(dir: string): Database {
    const db = new Database(join(dir, "telemetry.db"), {create: true, strict: true});
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 250");
    const migrated = db.query<{found: number}, []>("SELECT count(*) AS found FROM sqlite_master WHERE name = 'telemetry_daily_raw'").get()?.found === 1;
    if (!migrated) {
        for (const migration of telemetryMigrations) db.transaction(() => db.exec(migration.sql)).immediate();
    }
    return db;
}

/** 一个测试用的临时目录；`cleanup` 关掉登记过的连接再删目录，在 `afterEach` 里调用。 */
export interface TestDbRoot {
    readonly dir: string;
    open(): Database;
    cleanup(): Promise<void>;
}

export async function createTestDbRoot(name: string): Promise<TestDbRoot> {
    const dir = await createTestTmpRoot(name, `nb-site-telemetry ${name}`);
    const opened: Database[] = [];
    return {
        dir,
        open: () => {
            const db = openTelemetryTestDb(dir);
            opened.push(db);
            return db;
        },
        cleanup: async () => {
            for (const db of opened) db.close();
            await rm(dir, {recursive: true, force: true});
        },
    };
}
