/**
 * 就绪检查（`site.operations` 输出 4）的包内用例：真的 SQLite 文件、真的业务连接与探测连接，时钟注入（单调时钟的读数由
 * 用例推进），所以“连续 30 秒”不用真等。起进程的就绪用例在 `serve.test.ts`。
 */

import type {Database} from "bun:sqlite";
import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {runMigrations, type MigratableModule} from "./db/migrate";
import {openModuleDb, openProbeDb} from "./db/open";
import {createReadiness, READINESS_CACHE_MS, type ReadinessReport} from "./health";
import {createLogger, type LogFields} from "./log";

const SAMPLE: MigratableModule = {name: "sample", migrations: [{id: "0001_items", sql: `CREATE TABLE "item" ("id" INTEGER PRIMARY KEY);`}]};

let dataDir: string;
const opened: Database[] = [];

beforeEach(async () => {
    dataDir = await createTestTmpRoot("nb-site-health", "nb-site-server health.test.ts");
});

afterEach(async () => {
    for (const db of opened.splice(0)) {
        if (db.inTransaction) db.exec("ROLLBACK");
        db.close();
    }
    await rm(dataDir, {recursive: true, force: true});
});

async function setup(): Promise<{readonly business: Database; readonly check: () => ReadinessReport; readonly advance: (ms: number) => void; readonly lines: LogFields[]}> {
    const business = openModuleDb(dataDir, SAMPLE.name);
    opened.push(business);
    expect(await runMigrations(business, SAMPLE, {report: () => undefined})).toEqual({ok: true, stopped: false});
    const probe = openProbeDb(dataDir, SAMPLE.name);
    opened.push(probe);
    const lines: LogFields[] = [];
    let now = 0;
    const check = createReadiness([{module: SAMPLE, probe, business, instance: {mounts: []}}], {
        log: createLogger((line) => lines.push(JSON.parse(line) as LogFields)),
        now: () => now,
    });
    return {business, check, advance: (ms) => (now += ms), lines};
}

describe("本进程的事务占着写锁", () => {
    it("算就绪；同一个模块连续 30 秒每次都是这样时回 transaction_stuck 并记一行 warn，事务结束后回到就绪", async () => {
        const {business, check, advance, lines} = await setup();
        business.exec("BEGIN IMMEDIATE");
        business.exec(`INSERT INTO "item" DEFAULT VALUES`);
        expect(check()).toEqual({ready: true, modules: {sample: "ready"}});
        // 每 5 秒检查一次，到第 29 秒仍是就绪。
        for (let elapsed = 0; elapsed < 25_000; elapsed += 5_000) {
            advance(5_000);
            expect(check()).toEqual({ready: true, modules: {sample: "ready"}});
        }
        advance(4_000);
        expect(check()).toEqual({ready: true, modules: {sample: "ready"}});
        // 从第一次看到它算起满 30 秒（隔开 1 秒，避开结果复用）。
        advance(READINESS_CACHE_MS);
        expect(check()).toEqual({ready: false, modules: {sample: "transaction_stuck"}});
        expect(lines.find((line) => line.event === "health.not_ready")).toMatchObject({level: "warn", module: "sample", reason: "transaction_stuck"});
        // 检查没有动那个事务。
        expect(business.inTransaction).toBe(true);

        business.exec("COMMIT");
        advance(READINESS_CACHE_MS);
        expect(check()).toEqual({ready: true, modules: {sample: "ready"}});
    });

    it("中间有一次没在事务里，计时从头算", async () => {
        const {business, check, advance} = await setup();
        business.exec("BEGIN IMMEDIATE");
        expect(check().ready).toBe(true);
        advance(20_000);
        business.exec("COMMIT");
        expect(check().ready).toBe(true);
        business.exec("BEGIN IMMEDIATE");
        advance(20_000);
        expect(check().ready).toBe(true);
        advance(20_000);
        expect(check().ready).toBe(true);
    });

    it("业务连接在只读事务里（没拿写锁）时探测照常成功，不计时", async () => {
        const {business, check, advance} = await setup();
        business.exec("BEGIN");
        business.query(`SELECT count(*) FROM "item"`).get();
        expect(check().ready).toBe(true);
        advance(60_000);
        expect(check()).toEqual({ready: true, modules: {sample: "ready"}});
    });
});

it("写锁在进程外、业务连接不在事务里：立即 not_ready，报 SQLITE_BUSY", async () => {
    const {check, lines} = await setup();
    const holder = openModuleDb(dataDir, SAMPLE.name);
    opened.push(holder);
    holder.exec("BEGIN IMMEDIATE");
    expect(check()).toEqual({ready: false, modules: {sample: "not_ready"}});
    expect(lines.find((line) => line.event === "health.not_ready")).toMatchObject({reason: "db_unavailable", dbCode: "SQLITE_BUSY"});
});
