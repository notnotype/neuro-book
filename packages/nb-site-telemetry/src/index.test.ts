/**
 * 模块的两个定时任务与 `close()`（docs/specs/site/telemetry-ingest.md 的输入一节与时序；`site.operations` 输出 9）：
 * 真的 `createTelemetryModule` 与真的库，任务由测试直接调登记的 `run()`。按真实间隔的调度由入口的 `jobs.test.ts` 测，
 * 经测试控制入口跑由合同测试测。
 */

import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import type {Database} from "bun:sqlite";

import {aggregateAllNow, createAggregator} from "./aggregate";
import {createTelemetryStore} from "./store";
import {createTestDbRoot, type TestDbRoot} from "./testing/db";
import {createTestModule} from "./testing/module";
import {aggregateTables, dailyRecord, dayAt, eventRecord, rawRows, reportId, TODAY, withUsage} from "./testing/reports";

let root: TestDbRoot;
let reference: TestDbRoot;
beforeEach(async () => {
    root = await createTestDbRoot("telemetry-module-jobs");
    reference = await createTestDbRoot("telemetry-module-jobs-reference");
});
afterEach(async () => {
    await root.cleanup();
    await reference.cleanup();
});

/** 第 `day` 天写 `rows` 份每日上报（版本与使用段打散）与五分之一那么多的立即事件。 */
function fill(db: Database, day: number, rows: number): void {
    const store = createTelemetryStore(db);
    for (let i = 0; i < rows; i += 1) {
        const usage = i % 2 === 0 ? withUsage({errors: [{owner: "nbook.http", code: "other", count: "1"}], crashes: "1"}) : {};
        store.recordDaily(dailyRecord({reportId: reportId("d", i), appVersion: `0.${String(i % 80)}.0`, daysSinceLast: (i % 28) + 1, ...usage}, day), dayAt(day));
        if (i % 5 === 0) store.recordEvent(eventRecord({reportId: reportId("e", i), appVersion: `0.${String(i % 80)}.0`}, day), dayAt(day));
    }
}

describe("两个任务的登记", () => {
    it("aggregate 按配置的间隔、purge 每 10 分钟，都在开始调度后立即先跑一次", () => {
        const {jobs} = createTestModule(root.open());
        const shape = (name: string) => {
            const job = jobs.get(name);
            return job === undefined ? undefined : {intervalMs: job.intervalMs, initialDelayMs: job.initialDelayMs};
        };
        expect({aggregate: shape("aggregate"), purge: shape("purge")}).toEqual({aggregate: {intervalMs: 600_000, initialDelayMs: 0}, purge: {intervalMs: 600_000, initialDelayMs: 0}});
    });
});

describe("aggregate 与 purge 交错", () => {
    it("两个任务同时跑、批与批交替，聚合与只跑聚合的结果相同，到期的原始上报删掉", async () => {
        const db = root.open();
        // 到期的几天：purge 要先把它们算进聚合，与 aggregate 抢同一段行。行数是一批的好几倍，两边各跑好几批。
        fill(db, TODAY - 10, 2600);
        const test = createTestModule(db);

        const only = reference.open();
        fill(only, TODAY - 10, 2600);
        aggregateAllNow(createAggregator(only));

        await Promise.all([test.run("aggregate"), test.run("purge")]);
        expect(aggregateTables(db)).toEqual(aggregateTables(only));
        expect(rawRows(db)).toEqual({daily: 0, event: 0});
    });
});

describe("close()", () => {
    it("置“正在关闭”之后，正在跑的任务在下一批之前收手；之后的 purge 什么都不做", async () => {
        const db = root.open();
        fill(db, TODAY - 10, 3000);
        const test = createTestModule(db);
        const aggregator = createAggregator(db);

        // 第一批在 run() 里同步做完，之后每批之间让出。
        const running = test.run("aggregate");
        await test.module.close();
        await running;
        const cursor = aggregator.cursor("daily");
        expect(cursor).toBeGreaterThan(0);
        expect(cursor).toBeLessThan(3000);

        await test.run("purge");
        expect(rawRows(db).daily).toBe(3000);
    });

    it("purge 在“先聚合”那一步收手：游标没追到到期行，一行没删", async () => {
        const db = root.open();
        fill(db, TODAY - 10, 3000);
        const test = createTestModule(db);
        const aggregator = createAggregator(db);

        // 第一批聚合在 run() 里同步做完，之后让出。
        const running = test.run("purge");
        await test.module.close();
        await running;
        expect(aggregator.cursor("daily")).toBeLessThan(3000);
        expect(rawRows(db)).toEqual({daily: 3000, event: 600});
    });

    it("purge 在删除那一步收手：到期的都算过了，置“正在关闭”之后一行没删", async () => {
        const db = root.open();
        fill(db, TODAY - 10, 3000);
        const test = createTestModule(db);
        await test.run("aggregate");

        const running = test.run("purge");
        await test.module.close();
        await running;
        expect(rawRows(db)).toEqual({daily: 3000, event: 600});
    });

    it("强制停止的先后（置“正在关闭”、不等就关库）：正在跑的 purge 不再碰库，照常 resolve", async () => {
        const db = root.open();
        fill(db, TODAY - 10, 3000);
        const test = createTestModule(db);

        const running = test.run("purge");
        const closed = test.module.close();
        db.close();
        expect(await Promise.allSettled([running, closed])).toEqual([
            {status: "fulfilled", value: undefined},
            {status: "fulfilled", value: undefined},
        ]);
    });
});

describe("aggregate 出错时", () => {
    it("每日上报那一批一直出错时，立即事件照样进聚合，这一轮以失败结束", async () => {
        const db = root.open();
        const test = createTestModule(db);
        const store = createTelemetryStore(db);
        store.recordDaily(dailyRecord({reportId: reportId("x", 1)}), dayAt(TODAY));
        store.recordEvent(eventRecord({reportId: reportId("y", 1)}), dayAt(TODAY));
        // 每日上报的聚合写不进去（约束类错误）；临时触发器只在模块这条连接上。
        db.exec("CREATE TEMP TRIGGER fail_daily BEFORE INSERT ON main.telemetry_daily_count BEGIN SELECT RAISE(ABORT, 'injected'); END");

        const outcome = await Promise.allSettled([test.run("aggregate")]);
        expect(outcome.map((result) => result.status)).toEqual(["rejected"]);
        expect(db.query("SELECT events FROM telemetry_event_count").all()).toEqual([{events: 1}]);
        expect(db.query("SELECT count(*) AS rows FROM telemetry_daily_count").get()).toEqual({rows: 0});
    });
});
