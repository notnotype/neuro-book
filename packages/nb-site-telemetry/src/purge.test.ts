/**
 * 删除到期的原始上报（docs/specs/site/telemetry-ingest.md 输出 3、7；协议输出 2 的 48 小时去重）：真的
 * `createTelemetryModule`（`secure_delete`、`busy_timeout` 都是产品的设置）与真的库文件，时钟由测试拨。
 * 从进程外看的边界（拨 7 天还在、8 天没了）另由合同用例 C15 测。
 */

import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {Database} from "bun:sqlite";
import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";

import {AGGREGATE_SOURCES, aggregateAllNow, createAggregator} from "./aggregate";
import {DAY_MS} from "./days";
import {lastExpiredSql} from "./purge";
import {createTelemetryStore, isDbUnavailable} from "./store";
import {createTestDbRoot, type TestDbRoot} from "./testing/db";
import {createTestModule} from "./testing/module";
import {aggregateTables, dailyRecord, dayAt, eventRecord, rawRows, reportId, TODAY, withUsage} from "./testing/reports";

let root: TestDbRoot;
let reference: TestDbRoot;
beforeEach(async () => {
    root = await createTestDbRoot("telemetry-purge");
    reference = await createTestDbRoot("telemetry-purge-reference");
});
afterEach(async () => {
    await root.cleanup();
    await reference.cleanup();
});

const D = TODAY - 20;

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    throw new Error("promise did not reject");
}

/** SQLite 错误的码名；不是 SQLite 的错误时为 undefined。 */
function dbCodeOfError(error: unknown): unknown {
    return (error as {code?: unknown} | undefined)?.code;
}

/** 数据目录里含 `needle` 的文件名（库文件、WAL、共享内存文件）。 */
function filesContaining(dir: string, needle: string): string[] {
    const bytes = Buffer.from(needle);
    return readdirSync(dir)
        .filter((name) => readFileSync(join(dir, name)).includes(bytes))
        .sort();
}

describe("删除的边界", () => {
    it("保留 7 天：第 D 天记入的，服务端日到 D+7 时还在，到 D+8 时删掉；那一天的聚合不变", async () => {
        const db = root.open();
        const test = createTestModule(db);
        const store = createTelemetryStore(db);
        store.recordDaily(dailyRecord({reportId: reportId("b", 1)}, D), dayAt(D, DAY_MS - 1));
        store.recordEvent(eventRecord({reportId: reportId("b", 2)}, D), dayAt(D, 0));
        await test.run("aggregate");
        const before = aggregateTables(db);

        test.clock.set(dayAt(D + 7, DAY_MS - 1));
        await test.run("purge");
        expect(rawRows(db)).toEqual({daily: 1, event: 1});

        test.clock.set(dayAt(D + 8, 0));
        await test.run("purge");
        expect(rawRows(db)).toEqual({daily: 0, event: 0});
        expect(aggregateTables(db)).toEqual(before);
    });

    it("保留 2 天：某天最后一刻记入的，48 小时之内仍在，重发仍是重发", async () => {
        const db = root.open();
        const test = createTestModule(db, {retentionDays: 2});
        const store = createTelemetryStore(db);
        const recordedAt = dayAt(D, DAY_MS - 1);
        const record = dailyRecord({reportId: reportId("c", 1)}, D);
        store.recordDaily(record, recordedAt);

        const later = recordedAt + 48 * 3_600_000 - 1;
        test.clock.set(later);
        await test.run("purge");
        expect(rawRows(db).daily).toBe(1);
        expect(store.recordDaily(record, later).duplicate).toBe(true);
    });

    it("没跑过聚合时，先把到期的算进聚合再删", async () => {
        const db = root.open();
        const test = createTestModule(db);
        const only = reference.open();
        for (const target of [db, only]) {
            const store = createTelemetryStore(target);
            for (let i = 0; i < 1200; i += 1) store.recordDaily(dailyRecord({reportId: reportId("p", i), appVersion: `0.${String(i % 7)}.0`}, D), dayAt(D));
            store.recordEvent(eventRecord({reportId: reportId("q", 1)}, D), dayAt(D));
        }
        aggregateAllNow(createAggregator(only));

        test.clock.set(dayAt(D + 8));
        await test.run("purge");
        expect(rawRows(db)).toEqual({daily: 0, event: 0});
        expect(aggregateTables(db)).toEqual(aggregateTables(only));
    });

    it("找到期行里最大的编号走日索引，不扫原始表（扫表时 80 万行的冷库上停十几秒，计时不进单元测试，这里看查询计划）", () => {
        const db = root.open();
        for (const source of AGGREGATE_SOURCES) {
            const plan = db.query<{detail: string}, [{$cutoff: number}]>(`EXPLAIN QUERY PLAN ${lastExpiredSql(source)}`).all({$cutoff: D});
            expect(plan.map((step) => step.detail)).toEqual([expect.stringContaining(`USING COVERING INDEX telemetry_${source}_raw_server_day`)]);
        }
    });
});

describe("聚合出错时", () => {
    it("库写不进（磁盘满）时这一轮不删，任务以失败结束，记一行 warn", async () => {
        const db = root.open();
        const test = createTestModule(db);
        const store = createTelemetryStore(db);
        // 聚合要长出新页才会撞上页数上限：版本与错误项打散，聚合行多过一页能放下的；删除只腾出页，不撞上限。
        for (let i = 0; i < 300; i += 1) {
            store.recordDaily(
                dailyRecord({reportId: reportId("f", i), appVersion: `0.${String(i % 64)}.0`, ...withUsage({errors: [{owner: "nbook.http", code: "other", count: "1"}, {owner: "other", code: "other", count: "50+"}]})}, D),
                dayAt(D),
            );
        }
        const pages = db.query<{page_count: number}, []>("PRAGMA page_count").get()!.page_count;
        db.exec(`PRAGMA max_page_count = ${String(pages)}`);

        test.clock.set(dayAt(D + 8));
        const error = await rejectionOf(test.run("purge"));
        expect(isDbUnavailable(error)).toBe(true);
        expect(rawRows(db).daily).toBe(300);
        expect(test.logs.map((line) => [line.level, line.event])).toEqual([["warn", "telemetry.purge_deferred"]]);
    });

    it("库被别的连接占着写时这一轮不删，任务以失败结束", async () => {
        const db = root.open();
        const test = createTestModule(db);
        createTelemetryStore(db).recordDaily(dailyRecord({}, D), dayAt(D));
        const holder = new Database(join(root.dir, "telemetry.db"));
        try {
            holder.exec("BEGIN IMMEDIATE");
            test.clock.set(dayAt(D + 8));
            const error = await rejectionOf(test.run("purge"));
            expect(isDbUnavailable(error)).toBe(true);
            holder.exec("ROLLBACK");
        } finally {
            holder.close();
        }
        expect(rawRows(db).daily).toBe(1);
    });

    it("出了别的错照样删，记一行只带行数的 error，任务以失败结束", async () => {
        const db = root.open();
        const test = createTestModule(db);
        const store = createTelemetryStore(db);
        for (let i = 0; i < 3; i += 1) store.recordDaily(dailyRecord({reportId: reportId("x", i)}, D), dayAt(D));
        store.recordEvent(eventRecord({reportId: reportId("y", 1)}, D), dayAt(D));
        // 每日上报的聚合写不进去（约束类错误，不是“库一时用不了”）；立即事件照常算。临时触发器只在模块这条连接上。
        db.exec("CREATE TEMP TRIGGER fail_daily BEFORE INSERT ON main.telemetry_daily_count BEGIN SELECT RAISE(ABORT, 'injected'); END");

        test.clock.set(dayAt(D + 8));
        const error = await rejectionOf(test.run("purge"));
        expect(error === undefined || isDbUnavailable(error)).toBe(false);
        expect(rawRows(db)).toEqual({daily: 0, event: 0});
        expect(db.query("SELECT events FROM telemetry_event_count").all()).toEqual([{events: 1}]);
        expect(test.logs).toEqual([{level: "error", event: "telemetry.purge_unaggregated", fields: {dailyRows: 3, eventRows: 0, dbCode: "SQLITE_CONSTRAINT_TRIGGER"}}]);
        // 日志里没有上报编号。
        expect(JSON.stringify(test.logs)).not.toContain(reportId("x", 0));
    });

    it("游标行被删了（库照样可写）：照样删，没进聚合的份数记为未知，任务以失败结束", async () => {
        const db = root.open();
        const test = createTestModule(db);
        const store = createTelemetryStore(db);
        for (let i = 0; i < 2; i += 1) store.recordDaily(dailyRecord({reportId: reportId("m", i)}, D), dayAt(D));
        store.recordEvent(eventRecord({reportId: reportId("n", 1)}, D), dayAt(D));
        db.exec("DELETE FROM telemetry_aggregate_cursor WHERE source = 'daily'");

        test.clock.set(dayAt(D + 8));
        const error = await rejectionOf(test.run("purge"));
        expect(error === undefined || isDbUnavailable(error)).toBe(false);
        expect(rawRows(db)).toEqual({daily: 0, event: 0});
        expect(db.query("SELECT events FROM telemetry_event_count").all()).toEqual([{events: 1}]);
        expect(test.logs).toEqual([{level: "error", event: "telemetry.purge_unaggregated", fields: {dailyRows: null, eventRows: 0, dbCode: null}}]);
    });

    it("截止日之后的行在聚合时出错，不连累到期的行：到期的那份进了聚合再删，截止日之后的那份还在", async () => {
        const db = root.open();
        const test = createTestModule(db);
        const store = createTelemetryStore(db);
        store.recordDaily(dailyRecord({reportId: reportId("e", 1), appVersion: "7.3.4"}, D), dayAt(D));
        store.recordDaily(dailyRecord({reportId: reportId("l", 1), appVersion: "9.1.2"}, D + 8), dayAt(D + 8));
        // 只有截止日之后的那份在聚合时出错；两份不足一批，不设上界时会落进同一批、一起回滚。
        db.exec("CREATE TEMP TRIGGER fail_late BEFORE INSERT ON main.telemetry_daily_count WHEN NEW.dimension = 'app_version' AND NEW.value = '9.1.2' BEGIN SELECT RAISE(ABORT, 'injected'); END");

        test.clock.set(dayAt(D + 8));
        await test.run("purge");
        expect(rawRows(db).daily).toBe(1);
        expect(db.query("SELECT value, reports FROM telemetry_daily_count WHERE dimension = 'app_version'").all()).toEqual([{value: "7.3.4", reports: 1}]);
    });
});

describe("删掉的内容不留在文件里", () => {
    it("删除并截断检查点之后，库文件、WAL 里都找不到被删的上报编号（删除之前找得到）", async () => {
        const db = root.open();
        const test = createTestModule(db);
        const marker = "purge-marker-7f3c9a1e2b";
        const store = createTelemetryStore(db);
        store.recordDaily(dailyRecord({reportId: marker}, D), dayAt(D));
        store.recordEvent(eventRecord({reportId: `${marker}-event`}, D), dayAt(D));
        // 删除之前先让它从 WAL 落进库文件：两处都要找得到，才证明删除之后找不到不是因为它本来就不在那里。
        db.exec("PRAGMA wal_checkpoint(PASSIVE)");
        createTelemetryStore(db).recordDaily(dailyRecord({reportId: reportId("z", 1)}, D), dayAt(D));
        await test.run("aggregate");
        expect(filesContaining(root.dir, marker)).toContain("telemetry.db");

        test.clock.set(dayAt(D + 8));
        await test.run("purge");
        expect(filesContaining(root.dir, marker)).toEqual([]);
    });

    it("前一张表删完、后一张表的删除出错：照样截断检查点，前一张表删掉的编号不留在库文件与 WAL 里，任务以那个错误失败", async () => {
        const db = root.open();
        const test = createTestModule(db);
        const marker = "purge-marker-delete-then-error-4d2e";
        const store = createTelemetryStore(db);
        store.recordDaily(dailyRecord({reportId: marker}, D), dayAt(D));
        store.recordEvent(eventRecord({reportId: reportId("w", 1)}, D), dayAt(D));
        await test.run("aggregate");
        db.exec("PRAGMA wal_checkpoint(PASSIVE)");
        expect(filesContaining(root.dir, marker)).toContain("telemetry.db");
        // 删立即事件时出错（约束类错误，不是“库一时用不了”）；每日上报排在前面，先删完、已提交。
        db.exec("CREATE TEMP TRIGGER fail_event_delete BEFORE DELETE ON main.telemetry_event_raw BEGIN SELECT RAISE(ABORT, 'injected'); END");

        test.clock.set(dayAt(D + 8));
        const error = await rejectionOf(test.run("purge"));
        expect(dbCodeOfError(error)).toBe("SQLITE_CONSTRAINT_TRIGGER");
        expect(rawRows(db)).toEqual({daily: 0, event: 1});
        expect(filesContaining(root.dir, marker)).toEqual([]);
    });

    it("有读者拿着旧快照时截断做不完，记一行 warn，下一轮再做", async () => {
        const db = root.open();
        const test = createTestModule(db);
        createTelemetryStore(db).recordDaily(dailyRecord({}, D), dayAt(D));
        const reader = new Database(join(root.dir, "telemetry.db"), {readonly: true});
        try {
            reader.exec("BEGIN");
            reader.query("SELECT count(*) FROM telemetry_daily_raw").get();
            test.clock.set(dayAt(D + 8));
            await test.run("purge");
            expect(test.logs.map((line) => [line.level, line.event])).toEqual([["warn", "telemetry.checkpoint_busy"]]);
            reader.exec("COMMIT");
        } finally {
            reader.close();
        }
        await test.run("purge");
        expect(test.logs).toHaveLength(1);
    });
});
