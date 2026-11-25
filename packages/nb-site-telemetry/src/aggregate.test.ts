/**
 * 聚合（docs/specs/site/telemetry-ingest.md 输出 5、6、11；协议输出 2 的“聚合里只算一份”）：真的 SQLite 文件，上报经真的
 * 存储写进原始表，再由聚合器算。聚合的存放形状不是公开合同、第一版也没有读聚合的接口，所以这几条只能在包内看库
 * （w00037 t06 计划 3.8 的“只能在包内测的”）。
 */

import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import type {Database} from "bun:sqlite";

import {aggregateAllNow, createAggregator} from "./aggregate";
import {APP_VERSIONS_PER_PERIOD, createTelemetryStore, OVERFLOW_APP_VERSION} from "./store";
import {createTestDbRoot, type TestDbRoot} from "./testing/db";
import {aggregateTables, dailyRecord, dayAt, eventRecord, NOW, reportId, TODAY, withUsage} from "./testing/reports";

let root: TestDbRoot;
let other: TestDbRoot;
beforeEach(async () => {
    root = await createTestDbRoot("telemetry-aggregate");
    other = await createTestDbRoot("telemetry-aggregate-reference");
});
afterEach(async () => {
    await root.cleanup();
    await other.cleanup();
});

function dailyCounts(db: Database, day = TODAY): {dimension: string; value: string; reports: number}[] {
    return db.query<{dimension: string; value: string; reports: number}, [{$day: number}]>("SELECT dimension, value, reports FROM telemetry_daily_count WHERE server_day = $day ORDER BY dimension, value").all({$day: day});
}

function countOf(db: Database, dimension: string, value: string, day = TODAY): number {
    return dailyCounts(db, day).find((row) => row.dimension === dimension && row.value === value)?.reports ?? 0;
}

describe("聚合的数", () => {
    it("每个维度、活跃数、安装周交叉、使用档与立即事件各自的份数", () => {
        const db = root.open();
        const store = createTelemetryStore(db);
        store.recordDaily(dailyRecord({reportId: reportId("a", 1)}), NOW);
        store.recordDaily(
            dailyRecord({
                reportId: reportId("a", 2),
                appVersion: "0.18.0",
                channel: "canary",
                form: "cli",
                osVersion: "windows-11",
                arch: "arm64",
                locale: "en-US",
                region: "europe",
                daysSinceLast: 12,
                noticeSeen: "settings",
                ...withUsage({
                    errors: [
                        {owner: "nbook.http", code: "other", count: "2-4"},
                        {owner: "other", code: "other", count: "1"},
                    ],
                    crashes: "1",
                    upgrade: "failed",
                }),
            }),
            NOW,
        );
        store.recordDaily(dailyRecord({reportId: reportId("a", 3), daysSinceLast: "more", installWeek: "older"}), NOW);
        store.recordEvent(eventRecord({reportId: reportId("e", 1)}), NOW);
        store.recordEvent(eventRecord({reportId: reportId("e", 2), kind: "upgrade_failed", code: "other", form: "cli"}), NOW);

        aggregateAllNow(createAggregator(db));

        expect(dailyCounts(db)).toEqual([
            {dimension: "app_version", value: "0.17.0", reports: 2},
            {dimension: "app_version", value: "0.18.0", reports: 1},
            {dimension: "arch", value: "arm64", reports: 1},
            {dimension: "arch", value: "x64", reports: 2},
            {dimension: "channel", value: "canary", reports: 1},
            {dimension: "channel", value: "stable", reports: 2},
            {dimension: "form", value: "cli", reports: 1},
            {dimension: "form", value: "desktop", reports: 2},
            {dimension: "locale", value: "en-US", reports: 1},
            {dimension: "locale", value: "zh-CN", reports: 2},
            {dimension: "notice_seen", value: "settings", reports: 1},
            {dimension: "notice_seen", value: "wizard", reports: 2},
            {dimension: "os_version", value: "linux", reports: 2},
            {dimension: "os_version", value: "windows-11", reports: 1},
            {dimension: "region", value: "east-asia", reports: 2},
            {dimension: "region", value: "europe", reports: 1},
            {dimension: "total", value: "", reports: 3},
            {dimension: "usage_enabled", value: "false", reports: 2},
            {dimension: "usage_enabled", value: "true", reports: 1},
        ]);
        // first 记 0、more 记 29；交叉表里 7 天以上合成 8。
        expect(db.query("SELECT days_since_last, reports FROM telemetry_daily_activity ORDER BY 1").all()).toEqual([
            {days_since_last: 0, reports: 1},
            {days_since_last: 12, reports: 1},
            {days_since_last: 29, reports: 1},
        ]);
        expect(db.query("SELECT install_week, days_since_last, reports FROM telemetry_daily_cohort ORDER BY 1, 2").all()).toEqual([
            {install_week: dailyRecord().installWeek, days_since_last: 0, reports: 1},
            {install_week: dailyRecord().installWeek, days_since_last: 8, reports: 1},
            {install_week: "older", days_since_last: 8, reports: 1},
        ]);
        // 使用档只算带使用段的那一份。
        expect(db.query("SELECT manifest_usage, app_version, dimension, value, reports FROM telemetry_usage_count ORDER BY 3, 4").all()).toEqual([
            {manifest_usage: 1, app_version: "0.18.0", dimension: "crashes", value: "1", reports: 1},
            {manifest_usage: 1, app_version: "0.18.0", dimension: "reports", value: "", reports: 1},
            {manifest_usage: 1, app_version: "0.18.0", dimension: "upgrade", value: "failed", reports: 1},
        ]);
        expect(db.query("SELECT app_version, owner, code, count_bucket, reports FROM telemetry_usage_error ORDER BY 2").all()).toEqual([
            {app_version: "0.18.0", owner: "nbook.http", code: "other", count_bucket: "2-4", reports: 1},
            {app_version: "0.18.0", owner: "other", code: "other", count_bucket: "1", reports: 1},
        ]);
        // 省略的 code 记空串。
        expect(db.query("SELECT app_version, form, kind, code, events FROM telemetry_event_count ORDER BY 3").all()).toEqual([
            {app_version: "0.17.0", form: "desktop", kind: "crash", code: "", events: 1},
            {app_version: "0.17.0", form: "cli", kind: "upgrade_failed", code: "other", events: 1},
        ]);
    });

    it("同一份重发几次，聚合里只算一份", () => {
        const db = root.open();
        const store = createTelemetryStore(db);
        for (let i = 0; i < 3; i += 1) store.recordDaily(dailyRecord(), NOW);
        for (let i = 0; i < 3; i += 1) store.recordEvent(eventRecord(), NOW);
        aggregateAllNow(createAggregator(db));
        expect(countOf(db, "total", "")).toBe(1);
        expect(db.query("SELECT events FROM telemetry_event_count").all()).toEqual([{events: 1}]);
    });

    it("再跑没有新行时什么都不变；新行来了只算新的", () => {
        const db = root.open();
        const store = createTelemetryStore(db);
        store.recordDaily(dailyRecord({reportId: reportId("a", 1)}), NOW);
        const aggregator = createAggregator(db);
        aggregateAllNow(aggregator);
        const once = aggregateTables(db);
        expect({daily: aggregator.aggregateBatch("daily"), event: aggregator.aggregateBatch("event")}).toEqual({daily: 0, event: 0});
        expect(aggregateTables(db)).toEqual(once);

        store.recordDaily(dailyRecord({reportId: reportId("a", 2)}), NOW);
        aggregateAllNow(aggregator);
        expect(countOf(db, "total", "")).toBe(2);
    });

    it("同一天里每个维度的份数合计都等于总份数", () => {
        const db = root.open();
        const store = createTelemetryStore(db);
        const pick = <T>(values: readonly T[], i: number, salt: number): T => values[(i * salt + salt) % values.length]!;
        for (let i = 0; i < 300; i += 1) {
            const usage = i % 3 === 0 ? withUsage({crashes: pick(["0", "1", "50+"], i, 5), upgrade: pick(["none", "failed"], i, 7)}) : {};
            store.recordDaily(
                dailyRecord({
                    reportId: reportId("m", i),
                    appVersion: `0.${String(i % 9)}.0`,
                    channel: pick(["canary", "preview", "stable"], i, 2),
                    form: pick(["desktop", "cli"], i, 3),
                    osVersion: pick(["linux", "macos-15", "windows-10"], i, 5),
                    arch: pick(["x64", "arm64"], i, 7),
                    locale: pick(["zh-CN", "en-US", "other"], i, 11),
                    region: pick(["europe", "oceania", "other"], i, 13),
                    daysSinceLast: pick(["first", 1, 7, 8, 28, "more"], i, 17),
                    noticeSeen: pick(["wizard", "workbench"], i, 19),
                    ...usage,
                }),
                NOW,
            );
        }
        aggregateAllNow(createAggregator(db, 37));
        const sums = new Map<string, number>();
        for (const row of dailyCounts(db)) sums.set(row.dimension, (sums.get(row.dimension) ?? 0) + row.reports);
        expect(Object.fromEntries(sums)).toEqual(Object.fromEntries(["app_version", "arch", "channel", "form", "locale", "notice_seen", "os_version", "region", "total", "usage_enabled"].map((d) => [d, 300])));
        const sum = (sql: string): number => db.query<{reports: number}, []>(sql).get()?.reports ?? 0;
        expect(sum("SELECT sum(reports) AS reports FROM telemetry_daily_activity")).toBe(300);
        expect(sum("SELECT sum(reports) AS reports FROM telemetry_daily_cohort")).toBe(300);
        expect(sum("SELECT sum(reports) AS reports FROM telemetry_usage_count WHERE dimension = 'crashes'")).toBe(100);
        expect(sum("SELECT sum(reports) AS reports FROM telemetry_usage_count WHERE dimension = 'reports'")).toBe(100);
    });

    it("清单版本不同的上报分开存，不合成一个数", () => {
        const db = root.open();
        const store = createTelemetryStore(db);
        store.recordDaily(dailyRecord({reportId: reportId("v", 1)}), NOW);
        // 第 2 版还不存在，直接造“生效版本是 2”的记录：要看的只是聚合按版本分开。
        store.recordDaily({...dailyRecord({reportId: reportId("v", 2)}), anonymous: {declared: 2, effective: 2}}, NOW);
        aggregateAllNow(createAggregator(db));
        expect(db.query("SELECT manifest_anonymous, reports FROM telemetry_daily_count WHERE dimension = 'total' ORDER BY 1").all()).toEqual([
            {manifest_anonymous: 1, reports: 1},
            {manifest_anonymous: 2, reports: 1},
        ]);
    });
});

describe("一批的范围与事务", () => {
    it("编号有大段空号时一批仍取满 n 行，上界是选出的最后一行", () => {
        const db = root.open();
        const store = createTelemetryStore(db);
        store.recordDaily(dailyRecord({reportId: reportId("g", 0)}), NOW);
        // 重发也消耗编号，留下 50 个空号。
        for (let i = 0; i < 50; i += 1) store.recordDaily(dailyRecord({reportId: reportId("g", 0)}), NOW);
        for (let i = 1; i < 10; i += 1) store.recordDaily(dailyRecord({reportId: reportId("g", i)}), NOW);
        const ids = db.query<{rows: number; last: number}, []>("SELECT count(*) AS rows, max(id) AS last FROM telemetry_daily_raw").get();
        expect(ids).toEqual({rows: 10, last: 60});

        const aggregator = createAggregator(db, 10);
        expect(aggregator.aggregateBatch("daily")).toBe(10);
        expect({total: countOf(db, "total", ""), cursor: aggregator.cursor("daily")}).toEqual({total: 10, cursor: 60});
    });

    it("一批中途出错时整批回滚、游标不动，重跑时同样的行只算一份", () => {
        const db = root.open();
        const store = createTelemetryStore(db);
        for (let i = 0; i < 5; i += 1) store.recordDaily(dailyRecord({reportId: reportId("t", i)}), NOW);
        const aggregator = createAggregator(db);
        // 在推游标那一步出错：聚合表都写过了，只有游标没推。临时触发器只在这条连接上。
        db.exec("CREATE TEMP TRIGGER fail_cursor BEFORE UPDATE ON main.telemetry_aggregate_cursor BEGIN SELECT RAISE(ABORT, 'injected'); END");
        expect(() => aggregator.aggregateBatch("daily")).toThrow();
        expect({total: countOf(db, "total", ""), cursor: aggregator.cursor("daily"), inTransaction: db.inTransaction}).toEqual({total: 0, cursor: 0, inTransaction: false});

        db.exec("DROP TRIGGER fail_cursor");
        aggregateAllNow(aggregator);
        expect(countOf(db, "total", "")).toBe(5);
    });
});

describe("每个服务端日至多 64 个应用版本", () => {
    /** 第 `day` 天按编号顺序写入这些版本：每日上报都带使用段，立即事件同样一份一个版本。 */
    function writeVersions(db: Database, day: number, versions: readonly string[], prefix: string): void {
        const store = createTelemetryStore(db);
        versions.forEach((appVersion, i) => {
            store.recordDaily(dailyRecord({reportId: reportId(`${prefix}d`, i), appVersion, ...withUsage({errors: [{owner: "other", code: "other", count: "1"}]})}, day), dayAt(day));
            store.recordEvent(eventRecord({reportId: reportId(`${prefix}e`, i), appVersion}, day), dayAt(day));
        });
    }

    const extra = 6;
    const fresh = Array.from({length: APP_VERSIONS_PER_PERIOD + extra}, (_, i) => `1.${String(i)}.0`);
    // 前 64 个先到；之后再来的旧版本照算，新版本记 other。
    const versions = [...fresh, "1.3.0", `1.${String(APP_VERSIONS_PER_PERIOD + 1)}.0`];

    it("先到的 64 个照记，之后新出现的记 other；旧版本再来照记；每日上报、使用档与立即事件一致", () => {
        const db = root.open();
        writeVersions(db, TODAY, versions, "a");
        aggregateAllNow(createAggregator(db));

        const real = dailyCounts(db).filter((row) => row.dimension === "app_version" && row.value !== OVERFLOW_APP_VERSION);
        expect(real.map((row) => row.value).sort()).toEqual(fresh.slice(0, APP_VERSIONS_PER_PERIOD).sort());
        expect(countOf(db, "app_version", "1.3.0")).toBe(2);
        expect(countOf(db, "app_version", OVERFLOW_APP_VERSION)).toBe(extra + 1);

        const usageOther = db.query<{reports: number}, []>(`SELECT reports FROM telemetry_usage_count WHERE dimension = 'reports' AND app_version = '${OVERFLOW_APP_VERSION}'`).get();
        const errorOther = db.query<{reports: number}, []>(`SELECT reports FROM telemetry_usage_error WHERE app_version = '${OVERFLOW_APP_VERSION}'`).get();
        const eventVersions = db.query<{versions: number; other: number}, []>(
            `SELECT count(DISTINCT app_version) - 1 AS versions, sum(CASE app_version WHEN '${OVERFLOW_APP_VERSION}' THEN events END) AS other FROM telemetry_event_count`,
        ).get();
        expect({usageOther, errorOther, eventVersions}).toEqual({usageOther: {reports: extra + 1}, errorOther: {reports: extra + 1}, eventVersions: {versions: APP_VERSIONS_PER_PERIOD, other: extra + 1}});
    });

    it("每一天各数各的", () => {
        const db = root.open();
        writeVersions(db, TODAY, versions, "a");
        writeVersions(db, TODAY + 1, ["9.9.9"], "b");
        aggregateAllNow(createAggregator(db));
        expect(countOf(db, "app_version", "9.9.9", TODAY + 1)).toBe(1);
    });

    it("分几批、分几次跑，结果与一次算完相同", () => {
        const once = root.open();
        writeVersions(once, TODAY, versions, "a");
        aggregateAllNow(createAggregator(once));

        const split = other.open();
        writeVersions(split, TODAY, versions.slice(0, 40), "a");
        aggregateAllNow(createAggregator(split, 7));
        // 后到的行接着写进同一天，从已有的聚合里数出名额。
        const store = createTelemetryStore(split);
        versions.slice(40).forEach((appVersion, j) => {
            const i = 40 + j;
            store.recordDaily(dailyRecord({reportId: reportId("ad", i), appVersion, ...withUsage({errors: [{owner: "other", code: "other", count: "1"}]})}), dayAt(TODAY));
            store.recordEvent(eventRecord({reportId: reportId("ae", i), appVersion}), dayAt(TODAY));
        });
        aggregateAllNow(createAggregator(split, 5));

        expect(aggregateTables(split)).toEqual(aggregateTables(once));
    });
});
