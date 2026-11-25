/**
 * 备份时在副本上去掉原始上报（`site.operations` 输出 6；`site.telemetry-ingest` 的副作用一节）：副本照入口的备份命令用
 * `VACUUM INTO` 写出，再交给 `prepareTelemetryBackupCopy`。从进程外看的“副本里没有编号、有聚合”另由合同用例 C16 测。
 */

import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {Database} from "bun:sqlite";
import {join} from "node:path";

import {aggregateAllNow, createAggregator} from "./aggregate";
import {prepareTelemetryBackupCopy} from "./backup";
import {createTelemetryStore} from "./store";
import {createTestDbRoot, type TestDbRoot} from "./testing/db";
import {aggregateTables, dailyRecord, eventRecord, NOW, rawRows, reportId} from "./testing/reports";

let root: TestDbRoot;
let copies: Database[] = [];
beforeEach(async () => {
    root = await createTestDbRoot("telemetry-backup");
    copies = [];
});
afterEach(async () => {
    for (const copy of copies) copy.close();
    await root.cleanup();
});

/** 库里写好上报，其中一部分已经进了聚合；返回原库与它的副本（副本的连接参数照入口打开副本的写法）。 */
function prepared(): {db: Database; copy: Database} {
    const db = root.open();
    const store = createTelemetryStore(db);
    for (let i = 0; i < 30; i += 1) store.recordDaily(dailyRecord({reportId: reportId("k", i), appVersion: `0.${String(i % 4)}.0`}), NOW);
    aggregateAllNow(createAggregator(db));
    for (let i = 30; i < 45; i += 1) store.recordDaily(dailyRecord({reportId: reportId("k", i)}), NOW);
    for (let i = 0; i < 5; i += 1) store.recordEvent(eventRecord({reportId: reportId("v", i)}), NOW);
    const path = join(root.dir, "copy.db");
    db.query("VACUUM INTO $path").run({$path: path});
    const copy = new Database(path, {strict: true});
    copies.push(copy);
    return {db, copy};
}

describe("prepareTelemetryBackupCopy", () => {
    it("副本里两张原始表为空，没算的已经算进聚合，游标留着；返回 undefined、不留事务", () => {
        const {db, copy} = prepared();
        expect(prepareTelemetryBackupCopy(copy)).toBeUndefined();
        expect(copy.inTransaction).toBe(false);
        expect(rawRows(copy)).toEqual({daily: 0, event: 0});

        // 原库照常算完，两边的聚合应当相同；原库的原始上报不受影响。
        aggregateAllNow(createAggregator(db));
        expect(aggregateTables(copy)).toEqual(aggregateTables(db));
        expect(rawRows(db)).toEqual({daily: 45, event: 5});
        const cursor = createAggregator(copy);
        expect({daily: cursor.cursor("daily"), event: cursor.cursor("event")}).toEqual({daily: 45, event: 5});
    });

    it("用副本恢复之后，新行的编号接着往上，照常进聚合", () => {
        const {copy} = prepared();
        prepareTelemetryBackupCopy(copy);
        const before = createAggregator(copy).cursor("daily");

        createTelemetryStore(copy).recordDaily(dailyRecord({reportId: reportId("n", 1), appVersion: "9.0.0"}), NOW);
        const newId = copy.query<{id: number}, []>("SELECT id FROM telemetry_daily_raw").get()!.id;
        expect(newId).toBeGreaterThan(before);
        aggregateAllNow(createAggregator(copy));
        expect(copy.query("SELECT reports FROM telemetry_daily_count WHERE dimension = 'app_version' AND value = '9.0.0'").all()).toEqual([{reports: 1}]);
    });

    it("聚合出错时照样清空原始表，再抛错让这次备份失败", () => {
        const {copy} = prepared();
        copy.exec("CREATE TEMP TRIGGER fail_daily BEFORE INSERT ON main.telemetry_daily_count BEGIN SELECT RAISE(ABORT, 'injected'); END");
        expect(() => prepareTelemetryBackupCopy(copy)).toThrow();
        expect(copy.inTransaction).toBe(false);
        expect(rawRows(copy)).toEqual({daily: 0, event: 0});
    });
});
