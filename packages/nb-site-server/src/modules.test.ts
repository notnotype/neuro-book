/**
 * 产品模块接进入口之后写出的日志行：真的 `SITE_MODULES`、入口的日志器（`log.ts`）、库连接与迁移运行器（`db/`），在进程内
 * 照 `commands/serve.ts` 的做法建实例，读日志器最终写出的那一行 JSON。
 *
 * 模块包自己的测试只看得到模块交给日志器的参数；入口写成一行时用固定字段盖掉同名的键（`event` 等），字段名撞上时
 * 只有这里看得出来。账号模块交给入口的几个 mount 也在这里看：前缀由适配器写，模块包的测试看不到。
 */

import type {Database} from "bun:sqlite";
import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";
import {Hono} from "hono";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {IDENTITY_API_PREFIX, IDENTITY_AUTH_PREFIX, IDENTITY_PATHS, OAUTH_ENDPOINT_PATHS, OIDC_DISCOVERY_PATHS} from "@notnotype/nb-site-identity-contract";

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

describe("账号模块的挂载", () => {
    it("站点入口上三个互不重叠的前缀：自家接口、库的对外端点、发现文档；各自的地址经同样的挂法可达", async () => {
        const identity = moduleNamed("identity");
        const opened = openModuleDb(root, identity.name);
        db = opened;
        expect(await runMigrations(opened, identity, {report: () => undefined})).toEqual({ok: true, stopped: false});
        const config = identity.parseConfig({NB_SITE_SESSION_SECRET: "s".repeat(32), NB_SITE_IDENTITY_TERMS_VERSION: "2026-11-20"});
        if (!config.ok) throw new Error(`identity config is invalid: ${JSON.stringify(config.problems)}`);
        const instance = await identity.create({
            db: opened,
            config: config.config,
            site: {siteUrl: "https://site.test", telemetryUrl: "https://telemetry.test"},
            log: createLogger(() => undefined).child({module: identity.name}),
            clock: {now: () => Date.now()},
            jobs: {register: () => undefined},
            clientAddress: () => "192.0.2.1",
        });
        closeInstance = instance.close;
        expect(instance.mounts.map((mount) => ({surface: mount.surface, prefix: mount.prefix}))).toEqual([
            {surface: "site", prefix: IDENTITY_API_PREFIX},
            {surface: "site", prefix: IDENTITY_AUTH_PREFIX},
            {surface: "site", prefix: "/.well-known"},
        ]);
        // 入口按 `app.route(prefix, app)` 挂（`site.ts`）；库按完整路径认端点，所以请求用站点的完整地址。
        const app = new Hono();
        for (const mount of instance.mounts) app.route(mount.prefix, mount.app);
        const statuses = [];
        for (const path of [`${IDENTITY_API_PREFIX}${IDENTITY_PATHS.meta}`, OAUTH_ENDPOINT_PATHS.jwks, ...OIDC_DISCOVERY_PATHS]) {
            statuses.push({path, status: (await app.request(`https://site.test${path}`)).status});
        }
        expect(statuses.filter((entry) => entry.status !== 200)).toEqual([]);
    });
});
