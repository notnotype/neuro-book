/**
 * 产品模块接进入口之后写出的日志行：真的 `SITE_MODULES`、入口的日志器（`log.ts`）、库连接与迁移运行器（`db/`），在进程内
 * 照 `commands/serve.ts` 的做法建实例，读日志器最终写出的那一行 JSON。
 *
 * 模块包自己的测试只看得到模块交给日志器的参数；入口写成一行时用固定字段盖掉同名的键（`event` 等），字段名撞上时
 * 只有这里看得出来。
 */

import type {Database} from "bun:sqlite";
import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {runMigrations} from "./db/migrate";
import {openModuleDb} from "./db/open";
import {createLogger} from "./log";
import type {JobDefinition, SiteModule} from "./module";
import {SITE_MODULES} from "./modules";

const DAY_MS = 86_400_000;

let root: string;
let db: Database | undefined;
let closeInstance: (() => Promise<void>) | undefined;

beforeEach(async () => {
    root = await createTestTmpRoot("nb-site-modules", "nb-site-server modules.test.ts");
});

afterEach(async () => {
    // 先让模块收手、再关库，与入口停止时的先后相同。
    await closeInstance?.();
    closeInstance = undefined;
    db?.close();
    db = undefined;
    await rm(root, {recursive: true, force: true});
});

function moduleNamed(name: string): SiteModule {
    const found = SITE_MODULES.find((module) => module.name === name);
    if (found === undefined) throw new Error(`no product module named ${name}`);
    return found;
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    throw new Error("promise did not reject");
}

describe("统计模块的日志", () => {
    it("purge 的聚合出错时，最终日志行里写着两张表各自没进聚合的份数，没被入口的事件名盖掉", async () => {
        const telemetry = moduleNamed("telemetry");
        const opened = openModuleDb(root, telemetry.name);
        db = opened;
        const migrated = await runMigrations(opened, telemetry, {report: () => undefined});
        expect(migrated).toEqual({ok: true, stopped: false});
        const config = telemetry.parseConfig({});
        if (!config.ok) throw new Error(`telemetry config with defaults is invalid: ${JSON.stringify(config.problems)}`);

        const lines: string[] = [];
        const log = createLogger((line) => void lines.push(line)).child({module: telemetry.name});
        let now = Date.parse("2026-11-24T12:00:00Z");
        const jobs = new Map<string, JobDefinition>();
        const instance = await telemetry.create({
            db: opened,
            config: config.config,
            site: {siteUrl: "https://site.test", telemetryUrl: "https://telemetry.test"},
            log,
            clock: {now: () => now},
            jobs: {register: (job) => void jobs.set(job.name, job)},
            clientAddress: () => "192.0.2.1",
        });
        closeInstance = instance.close;
        const ingest = instance.mounts.find((mount) => mount.surface === "ingest");
        if (ingest === undefined) throw new Error("the telemetry module mounted nothing on the ingest surface");

        const event = {manifest: {anonymous: 1, usage: 1}, reportId: "modules-test-event-000000001", appVersion: "7.3.4", form: "desktop", kind: "crash", code: "other"};
        const recorded = await ingest.app.request("/event", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(event)});
        expect(recorded.status).toBe(202);
        // 只让立即事件的聚合出错（约束类错误）；临时触发器只在模块这条连接上。
        opened.exec("CREATE TEMP TRIGGER fail_event BEFORE INSERT ON main.telemetry_event_count BEGIN SELECT RAISE(ABORT, 'injected'); END");

        now += 8 * DAY_MS;
        const purge = jobs.get("purge");
        if (purge === undefined) throw new Error("the telemetry module registered no purge job");
        await rejectionOf(Promise.resolve(purge.run()));

        const written = lines.map((line) => JSON.parse(line) as Record<string, unknown>).filter((line) => line.event === "telemetry.purge_unaggregated");
        expect(written).toEqual([expect.objectContaining({level: "error", event: "telemetry.purge_unaggregated", module: "telemetry", dailyRows: 0, eventRows: 1, dbCode: "SQLITE_CONSTRAINT_TRIGGER"})]);
    });
});
