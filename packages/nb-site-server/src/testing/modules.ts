/**
 * 只给 `serve.test.ts` 与 `commands.test.ts` 用的夹具模块；产品代码不引用本目录（`docs/testing/README.md` 的测试文件组织）。
 * `fixture-main.ts` 按环境变量 `NB_SITE_FIXTURE`（逗号分隔）挑出这里的模块交给同一个 `runCli`：
 *
 * - `alpha`：两个入口都挂（同一个前缀 `/api/alpha`），带定时任务、命令与一组可操纵的路由；
 * - `alpha-failing`：`alpha`，第二条迁移是坏 SQL；
 * - `alpha-slow`：`alpha`，第二条迁移要跑一阵（测迁移期间的信号）；
 * - `beta`：只挂站点入口的第二个模块（测按模块的锁、就绪检查逐个点名）。
 *
 * 夹具的行为由 `NB_SITE_ALPHA_*`、`NB_SITE_BETA_*` 控制，它们与产品模块的变量一样经 `parseConfig` 读，不经入口。
 */

import {Hono} from "hono";

import type {Migration, ModuleContext, ModuleInstance, SiteModule} from "../module";

const ITEMS: Migration = {id: "0001_items", sql: `CREATE TABLE "item" ("id" INTEGER PRIMARY KEY, "label" TEXT NOT NULL);`};
const BROKEN: Migration = {id: "0002_broken", sql: `CREATE TABLE "broken" ("id" INTEGER PRIMARY KEY,);`};
/** 递归 CTE 算上几百万行：同步执行期间信号进不来，测的是“做完正在执行的那一条”。 */
const SLOW: Migration = {
    id: "0002_slow",
    sql: `CREATE TABLE "slow" AS WITH RECURSIVE "n"("x") AS (SELECT 1 UNION ALL SELECT "x" + 1 FROM "n" WHERE "x" < 4000000) SELECT count(*) AS "total" FROM "n";`,
};
const AFTER_SLOW: Migration = {id: "0003_after_slow", sql: `CREATE TABLE "after_slow" ("id" INTEGER PRIMARY KEY);`};

interface AlphaConfig {
    /** `create`、`start`：在那一步抛错；`close-hang`：`close()` 永不 settle。 */
    readonly fail: string | undefined;
    /** 定时任务的间隔；没给就不登记。 */
    readonly jobMs: number | undefined;
}

/** `/api/alpha/slow` 等标准输入来一行 `release` 才回应：服务停止之后新请求进不来，放行只能走进程外的通道。 */
function stdinReleases(): {wait(): Promise<void>} {
    const waiting: (() => void)[] = [];
    let started = false;
    const start = (): void => {
        started = true;
        void (async () => {
            const decoder = new TextDecoder();
            let buffered = "";
            for await (const chunk of Bun.stdin.stream()) {
                buffered += decoder.decode(chunk, {stream: true});
                let newline: number;
                while ((newline = buffered.indexOf("\n")) >= 0) {
                    const line = buffered.slice(0, newline).trim();
                    buffered = buffered.slice(newline + 1);
                    if (line === "release") for (const resolve of waiting.splice(0)) resolve();
                }
            }
        })();
    };
    return {
        wait: () => {
            if (!started) start();
            return new Promise((resolve) => waiting.push(resolve));
        },
    };
}

function createAlpha(context: ModuleContext<AlphaConfig>): ModuleInstance {
    const {db, config, log} = context;
    if (config.fail === "create") throw new TypeError("fixture create failure");
    let ready = true;
    const releases = stdinReleases();

    if (config.jobMs !== undefined) {
        context.jobs.register({name: "tick", intervalMs: config.jobMs, run: () => log.info("fixture.job_ran", "fixture job ran", {job: "tick"})});
    }

    const site = new Hono();
    site.get("/where", (c) => c.json({surface: "site"}));
    site.get("/client", (c) => c.json({address: context.clientAddress(c)}));
    site.get("/slow", async (c) => {
        log.info("fixture.slow_started", "slow request started");
        await releases.wait();
        return c.json({released: true});
    });
    site.post("/ready/:state", (c) => {
        ready = c.req.param("state") === "true";
        return c.json({ready});
    });
    // 在业务连接上开一个跨请求的事务：就绪检查不能动它（修订表第 1 条）。
    site.post("/txn/begin", (c) => {
        db.exec("BEGIN IMMEDIATE");
        db.query(`INSERT INTO "item" ("label") VALUES ('in-transaction')`).run();
        return c.json({inTransaction: db.inTransaction});
    });
    site.post("/txn/commit", (c) => {
        db.exec("COMMIT");
        return c.json({inTransaction: db.inTransaction});
    });
    site.get("/items", (c) => c.json({count: db.query<{n: number}, []>(`SELECT count(*) AS "n" FROM "item"`).get()!.n}));
    site.get("/boom", () => {
        throw new RangeError("fixture handler failure with secret-detail-boom");
    });
    site.get("/crash", (c) => {
        setTimeout(() => {
            throw new SyntaxError("fixture crash with secret-detail-crash");
        }, 0);
        return c.json({scheduled: true}, 202);
    });

    const ingest = new Hono();
    ingest.get("/where", (c) => c.json({surface: "ingest"}));

    return {
        mounts: [
            {surface: "site", prefix: "/api/alpha", app: site},
            {surface: "ingest", prefix: "/api/alpha", app: ingest},
        ],
        ready: () => ready,
        start: () => {
            if (config.fail === "start") throw new TypeError("fixture start failure");
            log.info("fixture.started", "fixture started");
        },
        close: () => {
            log.info("fixture.closed", "fixture closed");
            return config.fail === "close-hang" ? new Promise<void>(() => {}) : Promise.resolve();
        },
    };
}

function alpha(migrations: readonly Migration[]): SiteModule<AlphaConfig> {
    return {
        name: "alpha",
        surfaces: ["site", "ingest"],
        migrations,
        parseConfig: (env) => {
            const jobMs = env.NB_SITE_ALPHA_JOB_MS;
            return {ok: true, config: {fail: env.NB_SITE_ALPHA_FAIL, jobMs: jobMs === undefined ? undefined : Number(jobMs)}};
        },
        create: createAlpha,
        commands: [
            {
                name: "alpha-exclusive",
                description: "fixture command that needs the alpha database to itself",
                access: "exclusive",
                arguments: [{name: "label", required: true}],
                run: async ({db, log, args}) => {
                    db.query(`INSERT INTO "item" ("label") VALUES (?)`).run(args.label ?? "");
                    log.info("fixture.command_ran", "fixture command ran", {command: "alpha-exclusive"});
                    return undefined;
                },
            },
            {
                name: "alpha-shared",
                description: "fixture command that may run while the server is up",
                access: "shared",
                arguments: [{name: "label", required: false}],
                run: async ({db, log, args}) => {
                    if (args.label === "fail") return {code: "fixture_refused", message: "fixture command refused", fields: {command: "alpha-shared"}};
                    db.query(`INSERT INTO "item" ("label") VALUES (?)`).run(args.label ?? "shared");
                    log.info("fixture.command_ran", "fixture command ran", {command: "alpha-shared"});
                    return undefined;
                },
            },
        ],
    };
}

/** `NB_SITE_BETA_MOUNT_INGEST=1`：把子应用挂到没声明的写入口上，入口应当按 `start_failed` 拒绝。 */
const beta: SiteModule<{readonly mountIngest: boolean}> = {
    name: "beta",
    surfaces: ["site"],
    migrations: [{id: "0001_beta", sql: `CREATE TABLE "beta" ("id" INTEGER PRIMARY KEY);`}],
    parseConfig: (env) => ({ok: true, config: {mountIngest: env.NB_SITE_BETA_MOUNT_INGEST === "1"}}),
    create: ({config}) => {
        const app = new Hono();
        app.get("/where", (c) => c.json({surface: "site", module: "beta"}));
        return {mounts: [{surface: config.mountIngest ? "ingest" : "site", prefix: "/api/beta", app}]};
    },
};

const FIXTURES: Readonly<Record<string, () => SiteModule>> = {
    alpha: () => alpha([ITEMS]),
    "alpha-failing": () => alpha([ITEMS, BROKEN]),
    "alpha-slow": () => alpha([ITEMS, SLOW, AFTER_SLOW]),
    beta: () => beta,
};

export function fixtureModules(spec: string | undefined): SiteModule[] {
    return (spec ?? "").split(",").map((name) => {
        const factory = FIXTURES[name.trim()];
        if (factory === undefined) throw new Error(`unknown fixture module: ${JSON.stringify(name)}`);
        return factory();
    });
}
