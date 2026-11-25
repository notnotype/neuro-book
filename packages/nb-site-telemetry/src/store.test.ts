/**
 * 存储的行为（docs/specs/site/telemetry-ingest.md 输出 2、3、4、10、11；协议输出 2）：真的 SQLite 文件，按本包的迁移建表。
 * 记录用校验器从请求体做出来，与写入口拿到的同形状。
 */

import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {Database, SQLiteError} from "bun:sqlite";
import {join} from "node:path";

import {DAY_MS, formatIsoWeek, retentionCutoffDay, serverDayAt} from "./days";
import {createTelemetryStore, isDbUnavailable} from "./store";
import {createTestDbRoot, type TestDbRoot} from "./testing/db";
import {validateReport, type DailyRecord, type EventRecord, type HeartbeatRecord} from "./validate";

const NOW = Date.parse("2026-11-24T12:00:00Z");
const TODAY = serverDayAt(NOW);

function dailyRecord(overrides: Record<string, unknown> = {}): DailyRecord {
    const body = {
        manifest: {anonymous: 1},
        reportId: "daily-report-0000000000001",
        appVersion: "0.17.0",
        channel: "stable",
        form: "desktop",
        osVersion: "linux",
        arch: "x64",
        locale: "zh-CN",
        region: "east-asia",
        daysSinceLast: "first",
        installWeek: formatIsoWeek(TODAY),
        usageEnabled: false,
        noticeSeen: "wizard",
        ...overrides,
    };
    const result = validateReport("daily", body, TODAY);
    if (!result.ok) throw new Error(`fixture is invalid at ${result.field}`);
    return result.record;
}

function eventRecord(overrides: Record<string, unknown> = {}): EventRecord {
    const result = validateReport("event", {manifest: {anonymous: 1, usage: 1}, reportId: "event-report-0000000000001", appVersion: "0.17.0", form: "desktop", kind: "crash", ...overrides}, TODAY);
    if (!result.ok) throw new Error(`fixture is invalid at ${result.field}`);
    return result.record;
}

function heartbeatRecord(appVersion = "0.17.0"): HeartbeatRecord {
    const result = validateReport("heartbeat", {manifest: {anonymous: 1}, appVersion, form: "cli"}, TODAY);
    if (!result.ok) throw new Error(`fixture is invalid at ${result.field}`);
    return result.record;
}

const usageOn = {manifest: {anonymous: 1, usage: 1}, usageEnabled: true};

let root: TestDbRoot;
beforeEach(async () => {
    root = await createTestDbRoot("telemetry-store");
});
afterEach(async () => {
    await root.cleanup();
});

describe("每日上报与立即事件的去重（协议输出 2）", () => {
    it("第一次记入当天，重发回第一次的服务端日与 duplicate", () => {
        const store = createTelemetryStore(root.open());
        expect(store.recordDaily(dailyRecord(), NOW)).toEqual({serverDay: TODAY, duplicate: false});
        expect(store.recordDaily(dailyRecord(), NOW + 3 * DAY_MS)).toEqual({serverDay: TODAY, duplicate: true});
    });

    it("关库重开之后重发仍按重发", () => {
        createTelemetryStore(root.open()).recordDaily(dailyRecord(), NOW);
        const db = root.open();
        expect(createTelemetryStore(db).recordDaily(dailyRecord(), NOW + DAY_MS)).toEqual({serverDay: TODAY, duplicate: true});
        expect(db.query("SELECT count(*) AS rows FROM telemetry_daily_raw").get()).toEqual({rows: 1});
    });

    it("重发的内容不同也按重发，库里留的是第一次的", () => {
        const db = root.open();
        const store = createTelemetryStore(db);
        store.recordDaily(dailyRecord({channel: "stable"}), NOW);
        expect(store.recordDaily(dailyRecord({channel: "preview", ...usageOn, usage: {errors: [], crashes: "1", upgrade: "none"}}), NOW + DAY_MS)).toEqual({serverDay: TODAY, duplicate: true});
        expect(db.query("SELECT server_day, channel, usage_crashes FROM telemetry_daily_raw").all()).toEqual([{server_day: TODAY, channel: "stable", usage_crashes: null}]);
    });

    it("保留 2 天时，某个服务端日最后一刻记入的一份在 48 小时内重发仍是重发：保留期删除之后原始行还在", () => {
        const db = root.open();
        const store = createTelemetryStore(db);
        const lastMoment = (TODAY + 1) * DAY_MS - 1;
        store.recordDaily(dailyRecord(), lastMoment);
        // 保留期的删除（第 4 片）按 retentionCutoffDay 整天删；这里在重发前照同一个界限删一次。
        const resendAt = lastMoment + 48 * 60 * 60 * 1000 - 1;
        db.query("DELETE FROM telemetry_daily_raw WHERE server_day < $cutoff").run({$cutoff: retentionCutoffDay(serverDayAt(resendAt), 2)});
        expect(store.recordDaily(dailyRecord(), resendAt)).toEqual({serverDay: TODAY, duplicate: true});
    });

    it("每日上报与立即事件的编号各自去重", () => {
        const db = root.open();
        const store = createTelemetryStore(db);
        const sameId = "shared-report-id-000000001";
        expect(store.recordDaily(dailyRecord({reportId: sameId}), NOW).duplicate).toBe(false);
        expect(store.recordEvent(eventRecord({reportId: sameId}), NOW + DAY_MS)).toEqual({serverDay: TODAY + 1, duplicate: false});
        expect(store.recordEvent(eventRecord({reportId: sameId, kind: "upgrade_failed"}), NOW + 2 * DAY_MS)).toEqual({serverDay: TODAY + 1, duplicate: true});
        expect(db.query("SELECT kind, code FROM telemetry_event_raw").all()).toEqual([{kind: "crash", code: null}]);
    });

    it("编号有空号：被挡下的重发也消耗编号，下一份的 id 不是上一份加一", () => {
        const db = root.open();
        const store = createTelemetryStore(db);
        store.recordDaily(dailyRecord({reportId: "gap-report-00000000000001"}), NOW);
        store.recordDaily(dailyRecord({reportId: "gap-report-00000000000001"}), NOW);
        store.recordDaily(dailyRecord({reportId: "gap-report-00000000000002"}), NOW);
        const ids = db.query<{id: number}, []>("SELECT id FROM telemetry_daily_raw ORDER BY id").all().map((row) => row.id);
        expect(ids.length).toBe(2);
        expect(ids[1]! > ids[0]!).toBe(true);
    });
});

describe("每日上报的列", () => {
    const stored = (db: Database) =>
        db.query("SELECT manifest_anonymous_declared, manifest_anonymous, manifest_usage_declared, manifest_usage, days_since_last, usage_enabled, usage_errors, usage_crashes, usage_upgrade FROM telemetry_daily_raw").get();

    it("带了使用段：生效版本与三列使用段都在，错误存成三元组的 JSON", () => {
        const db = root.open();
        createTelemetryStore(db).recordDaily(dailyRecord({...usageOn, usage: {errors: [{owner: "nbook.files", code: "other", count: "2-4"}], crashes: "0", upgrade: "none"}}), NOW);
        expect(stored(db)).toEqual({
            manifest_anonymous_declared: 1,
            manifest_anonymous: 1,
            manifest_usage_declared: 1,
            manifest_usage: 1,
            days_since_last: 0,
            usage_enabled: 1,
            usage_errors: '[["nbook.files","other","2-4"]]',
            usage_crashes: "0",
            usage_upgrade: "none",
        });
    });

    it("带了使用段而 errors 为空：存空数组", () => {
        const db = root.open();
        createTelemetryStore(db).recordDaily(dailyRecord({...usageOn, usage: {errors: [], crashes: "0", upgrade: "none"}}), NOW);
        expect(stored(db)).toMatchObject({manifest_usage: 1, usage_errors: "[]"});
    });

    it("同意了却没带使用段、或使用档版本太新被丢：声明的版本照记，生效版本与使用段都为空", () => {
        const db = root.open();
        const store = createTelemetryStore(db);
        store.recordDaily(dailyRecord({...usageOn, reportId: "no-usage-segment-000000001"}), NOW);
        store.recordDaily(dailyRecord({...usageOn, manifest: {anonymous: 3, usage: 9}, reportId: "newer-usage-0000000000001", usage: {anything: true}}), NOW);
        const rows = db.query("SELECT manifest_anonymous_declared, manifest_anonymous, manifest_usage_declared, manifest_usage, usage_errors FROM telemetry_daily_raw ORDER BY id").all();
        expect(rows).toEqual([
            {manifest_anonymous_declared: 1, manifest_anonymous: 1, manifest_usage_declared: 1, manifest_usage: null, usage_errors: null},
            {manifest_anonymous_declared: 3, manifest_anonymous: 1, manifest_usage_declared: 9, manifest_usage: null, usage_errors: null},
        ]);
    });

    it("表的约束：生效的使用档版本与三列使用段同在同不在", () => {
        const db = root.open();
        const insert = (usage: number | null, errors: string | null) => () =>
            db
                .query(
                    `INSERT INTO telemetry_daily_raw (report_id, server_day, manifest_anonymous_declared, manifest_anonymous, manifest_usage, app_version, channel, form,
                     os_version, arch, locale, region, days_since_last, install_week, usage_enabled, notice_seen, usage_errors, usage_crashes, usage_upgrade)
                     VALUES ($id, 0, 1, 1, $usage, 'x', 'x', 'x', 'x', 'x', 'x', 'x', 0, 'older', 1, 'x', $errors, '0', 'none')`,
                )
                .run({$id: `${usage}-${errors}`, $usage: usage, $errors: errors});
        for (const [usage, errors] of [[null, "[]"], [1, null]] as const) {
            let caught: unknown;
            try {
                insert(usage, errors)();
            } catch (error) {
                caught = error;
            }
            expect(caught).toBeInstanceOf(SQLiteError);
            expect((caught as SQLiteError).code).toBe("SQLITE_CONSTRAINT_CHECK");
            expect(isDbUnavailable(caught)).toBe(false);
        }
        expect(insert(1, "[]")).not.toThrow();
    });
});

describe("心跳（输出 4、11）", () => {
    const beats = (db: Database) => db.query("SELECT segment, manifest_anonymous, app_version, form, beats FROM telemetry_heartbeat ORDER BY app_version").all();

    it("同一段里三次心跳：只有一行，计数 3；下一段另起一行", () => {
        const db = root.open();
        const store = createTelemetryStore(db);
        for (let i = 0; i < 3; i += 1) store.recordHeartbeat(heartbeatRecord(), NOW + i * 60_000);
        expect(beats(db)).toEqual([{segment: expect.any(Number), manifest_anonymous: 1, app_version: "0.17.0", form: "cli", beats: 3}]);
        store.recordHeartbeat(heartbeatRecord(), NOW + 15 * 60_000);
        expect(db.query("SELECT count(*) AS rows FROM telemetry_heartbeat").get()).toEqual({rows: 2});
    });

    it("一段里第 65 个不同的应用版本记成 other，已经在的版本照记自己", () => {
        const db = root.open();
        const store = createTelemetryStore(db);
        // 上限 64 照 `site.telemetry-ingest` 写字面值，不从实现导入：实现的常量改了，这条要失败。
        for (let i = 0; i < 64; i += 1) store.recordHeartbeat(heartbeatRecord(`1.0.${i}`), NOW);
        const beatsOf = (version: string) => db.query<{beats: number}, [string]>("SELECT beats FROM telemetry_heartbeat WHERE app_version = ?").get(version)?.beats ?? 0;
        expect(beatsOf("other")).toBe(0);
        store.recordHeartbeat(heartbeatRecord("2.0.0"), NOW);
        expect(beatsOf("other")).toBe(1);
        store.recordHeartbeat(heartbeatRecord("2.0.1"), NOW);
        store.recordHeartbeat(heartbeatRecord("1.0.7"), NOW);
        const rows = db.query<{app_version: string; beats: number}, []>("SELECT app_version, beats FROM telemetry_heartbeat").all();
        expect(rows.length).toBe(65);
        expect(beatsOf("other")).toBe(2);
        expect(rows.find((row) => row.app_version === "1.0.7")?.beats).toBe(2);
        expect(rows.some((row) => row.app_version.startsWith("2.0."))).toBe(false);
        // 下一段重新数。
        store.recordHeartbeat(heartbeatRecord("2.0.0"), NOW + 15 * 60_000);
        expect(db.query("SELECT count(*) AS rows FROM telemetry_heartbeat WHERE app_version = '2.0.0'").get()).toEqual({rows: 1});
    });
});

describe("库一时用不了（输出 10）", () => {
    const thrownBy = (write: () => unknown): unknown => {
        try {
            write();
        } catch (error) {
            return error;
        }
        throw new Error("write did not throw");
    };

    it("别的连接占着写：报忙，算用不了；放开之后照常写", () => {
        const db = root.open();
        db.exec("PRAGMA busy_timeout = 0");
        const store = createTelemetryStore(db);
        const other = root.open();
        other.exec("BEGIN IMMEDIATE");
        const error = thrownBy(() => store.recordDaily(dailyRecord(), NOW));
        expect(isDbUnavailable(error)).toBe(true);
        expect((error as SQLiteError).code).toBe("SQLITE_BUSY");
        other.exec("ROLLBACK");
        expect(store.recordDaily(dailyRecord(), NOW).duplicate).toBe(false);
    });

    it("库不可写：算用不了", () => {
        root.open();
        const readonly = new Database(join(root.dir, "telemetry.db"), {readonly: true, strict: true});
        try {
            const error = thrownBy(() => createTelemetryStore(readonly).recordHeartbeat(heartbeatRecord(), NOW));
            expect(isDbUnavailable(error)).toBe(true);
            expect((error as SQLiteError).code).toStartWith("SQLITE_READONLY");
        } finally {
            readonly.close();
        }
    });

    it("磁盘满：算用不了", () => {
        const db = root.open();
        const pages = db.query<{page_count: number}, []>("PRAGMA page_count").get()!.page_count;
        db.exec(`PRAGMA max_page_count = ${pages}`);
        const store = createTelemetryStore(db);
        const error = thrownBy(() => {
            for (let i = 0; i < 10_000; i += 1) store.recordDaily(dailyRecord({reportId: `fill-${String(i).padStart(20, "0")}`}), NOW);
        });
        expect(isDbUnavailable(error)).toBe(true);
        expect((error as SQLiteError).code).toBe("SQLITE_FULL");
    });

    it("别的错误不算：不是 SQLite 的错误、约束类错误、同一条连接上的 LOCKED", () => {
        expect(isDbUnavailable(new Error("database is locked"))).toBe(false);
        const db = root.open();
        const error = thrownBy(() => db.query("INSERT INTO telemetry_aggregate_cursor (source, last_id) VALUES ('daily', 1)").run());
        expect((error as SQLiteError).code).toBe("SQLITE_CONSTRAINT_PRIMARYKEY");
        expect(isDbUnavailable(error)).toBe(false);

        // 同一条连接上一条语句还读着一张表时对它改结构：SQLite 回 LOCKED，是程序错误。
        db.exec("CREATE TABLE scratch (x INTEGER) STRICT; INSERT INTO scratch VALUES (1), (2)");
        const reading = db.query("SELECT x FROM scratch").iterate();
        reading.next();
        const locked = thrownBy(() => db.exec("DROP TABLE scratch"));
        reading.return?.();
        expect((locked as SQLiteError).code).toBe("SQLITE_LOCKED");
        expect(isDbUnavailable(locked)).toBe(false);
    });
});
