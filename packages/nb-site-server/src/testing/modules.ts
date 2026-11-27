/**
 * 只给 `serve.test.ts`、`commands.test.ts`、`backup.test.ts` 与 `web.test.ts` 用的夹具模块；产品代码不引用本目录（`docs/testing/README.md` 的测试文件组织）。
 * `fixture-main.ts` 按环境变量 `NB_SITE_FIXTURE`（逗号分隔）挑出这里的模块交给同一个 `runCli`：
 *
 * - `alpha`：两个入口都挂（同一个前缀 `/api/alpha`），带定时任务（含给测试控制入口跑的 `count`、`fail`、`hold`，与停止时要 `close()` 叫停的 `backlog`）、命令与
 *   一组可操纵的路由（含回显 `clock.now()` 的 `/now`）；备份时在副本里删掉 `label` 为 `raw` 的行（`prepareBackupCopy`，
 *   代表统计模块清空原始上报表），`NB_SITE_ALPHA_PREPARE` 让这一步写错（见 `prepareAlphaCopy`）；
 * - `alpha-failing`：`alpha`，第二条迁移是坏 SQL；
 * - `beta`：只挂站点入口的第二个模块（测按模块的锁、就绪检查逐个点名）；`create()` 是异步的。
 *
 * 夹具的行为由 `NB_SITE_ALPHA_*`、`NB_SITE_BETA_*` 控制，它们与产品模块的变量一样经 `parseConfig` 读，不经入口。
 *
 * 标准输入是测试往子进程里送信号以外的指令的通道，每行一个词：`release` 放行 `/api/alpha/slow`，`go` 放行 `alpha-wait` 命令
 * 与 `NB_SITE_ALPHA_WAIT` 停住的那一步，`finish` 让 `hold` 任务跑完。
 */

import type {Database} from "bun:sqlite";
import {readSync} from "node:fs";

import {Hono} from "hono";

import {createLogger, writeStdout} from "../log";
import type {Migration, ModuleContext, ModuleInstance, SiteModule} from "../module";

const ITEMS: Migration = {id: "0001_items", sql: `CREATE TABLE "item" ("id" INTEGER PRIMARY KEY, "label" TEXT NOT NULL);`};
const BROKEN: Migration = {id: "0002_broken", sql: `CREATE TABLE "broken" ("id" INTEGER PRIMARY KEY,);`};

interface AlphaConfig {
    /** `create`、`start`：在那一步抛错；`close-hang`：`close()` 永不 settle。 */
    readonly fail: string | undefined;
    /** 定时任务的间隔；没给就不登记。 */
    readonly jobMs: number | undefined;
    /** `NB_SITE_ALPHA_WAIT=create`：`create()` 开头停住（`blockOnStdinLine`）。 */
    readonly waitInCreate: boolean;
    /** `NB_SITE_ALPHA_BACKLOG=1`：登记 `backlog` 任务，见 `createAlpha`。 */
    readonly backlog: boolean;
}

const fixtureLog = createLogger(writeStdout);

/**
 * `NB_SITE_ALPHA_WAIT` 选中的那一步（`parse` 是 `parseConfig`，`create` 是 `create()`，`backup` 是 `prepareBackupCopy`）
 * 先写一行 `fixture.waiting_stdin`，再同步阻塞着读标准输入的一行。同步读期间信号处理函数跑不了，信号排在宏任务里，等入口下一次让出事件循环才处理
 * （探过 Bun 1.4.4：`readSync` 不被信号打断，处理函数在之后第一次 `setImmediate` 时执行）。测试先发信号、再写这一行，
 * 信号就一定在这一步之后、入口的下一个检查点之前被处理，结果不依赖两个进程的相对速度。
 */
function blockOnStdinLine(step: string): void {
    fixtureLog.info("fixture.waiting_stdin", "fixture is blocked reading one line from stdin", {step});
    const buffer = Buffer.alloc(64);
    let read = "";
    while (!read.includes("\n")) {
        const count = readSync(0, buffer);
        if (count === 0) return;
        read += buffer.subarray(0, count).toString("utf8");
    }
}

/**
 * 按行异步读标准输入，等某个词出现。整个进程只读一次标准输入流，几个等待方共用。给了 `signal` 时它 abort 就 reject 为
 * `signal.reason`（`SiteCommand` 约定的收手方式）。
 */
const stdinLines = (() => {
    const waiting: {readonly word: string; readonly resolve: () => void}[] = [];
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
                    for (let index = waiting.length - 1; index >= 0; index -= 1) {
                        if (waiting[index]!.word === line) waiting.splice(index, 1)[0]!.resolve();
                    }
                }
            }
        })();
    };
    return {
        wait(word: string, signal?: AbortSignal): Promise<void> {
            if (!started) start();
            return new Promise((resolve, reject) => {
                waiting.push({word, resolve});
                signal?.addEventListener("abort", () => reject(signal.reason), {once: true});
            });
        },
    };
})();

function createAlpha(context: ModuleContext<AlphaConfig>): ModuleInstance {
    const {db, config, log} = context;
    if (config.fail === "create") throw new TypeError("fixture create failure");
    let ready = true;

    if (config.jobMs !== undefined) {
        context.jobs.register({name: "tick", intervalMs: config.jobMs, run: () => log.info("fixture.job_ran", "fixture job ran", {job: "tick"})});
    }
    // 给测试控制入口跑的任务：间隔一小时，用例里不会按间隔跑到。`count` 的效果经 `/job-count` 读；`fail` 抛错；
    // `hold` 开始与结束各写一行日志，中间等标准输入的一行 `finish`。
    const HOUR_MS = 3_600_000;
    let jobCount = 0;
    context.jobs.register({name: "count", intervalMs: HOUR_MS, run: () => void (jobCount += 1)});
    context.jobs.register({
        name: "fail",
        intervalMs: HOUR_MS,
        run: () => {
            throw new RangeError("fixture job failure with secret-detail-job");
        },
    });
    context.jobs.register({
        name: "hold",
        intervalMs: HOUR_MS,
        run: async () => {
            log.info("fixture.hold_started", "fixture hold job started");
            await stdinLines.wait("finish");
            log.info("fixture.hold_finished", "fixture hold job finished");
        },
    });

    // 积压多到停止时做不完的任务，照统计模块的聚合与删除的写法：一批一批做、批间让出，`close()` 置“正在关闭”之后在
    // 下一批之前收手，`close()` 等它 settle。没有 `close()` 叫停时它一直跑。
    let closing = false;
    let backlogRun: Promise<void> | undefined;
    if (config.backlog) {
        context.jobs.register({
            name: "backlog",
            intervalMs: HOUR_MS,
            initialDelayMs: 0,
            run: () => {
                backlogRun = (async () => {
                    log.info("fixture.backlog_started", "fixture backlog job started");
                    let batches = 0;
                    while (!closing) {
                        batches += 1;
                        await new Promise((resolve) => setImmediate(resolve));
                    }
                    log.info("fixture.backlog_stopped", "fixture backlog job stopped before its next batch", {batches});
                })();
                return backlogRun;
            },
        });
    }

    const site = new Hono();
    site.get("/where", (c) => c.json({surface: "site"}));
    site.get("/now", (c) => c.json({now: context.clock.now()}));
    site.get("/job-count", (c) => c.json({count: jobCount}));
    site.get("/client", (c) => c.json({address: context.clientAddress(c)}));
    site.get("/slow", async (c) => {
        log.info("fixture.slow_started", "slow request started");
        await stdinLines.wait("release");
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
        close: async () => {
            log.info("fixture.closed", "fixture closed");
            if (config.fail === "close-hang") return new Promise<void>(() => {});
            closing = true;
            await backlogRun;
        },
    };
}

/**
 * `alpha` 的 `prepareBackupCopy`。备份命令不读模块的配置（见 `SiteModule.prepareBackupCopy`），夹具只好直接读环境变量：
 * `NB_SITE_ALPHA_WAIT=backup` 先停住；`NB_SITE_ALPHA_PREPARE` 是 `throw`（抛错）、`async`（写成了 async，返回 Promise）、
 * `open-txn`（开了事务不提交）时各模拟一种写错的模块，没设时正常删掉 `raw`。
 */
function prepareAlphaCopy(copy: Database): undefined {
    if (process.env.NB_SITE_ALPHA_WAIT === "backup") blockOnStdinLine("backup");
    const removeRaw = (): void => void copy.query(`DELETE FROM "item" WHERE "label" = 'raw'`).run();
    switch (process.env.NB_SITE_ALPHA_PREPARE) {
        case "throw":
            throw new RangeError("fixture prepare failure with secret-detail-prepare");
        case "async":
            // 类型检查本来会拦下 async 的实现（返回类型是 undefined），这里用类型断言绕过，测入口在运行时的那道检查。
            // 删除在第一个 await 之前、同步做完了，Promise 也已 resolve：入口照样拒绝，它看不出 Promise 里还剩什么没做。
            return (async () => removeRaw())() as unknown as undefined;
        case "open-txn":
            copy.exec("BEGIN");
            removeRaw();
            return undefined;
        default:
            removeRaw();
            return undefined;
    }
}

function alpha(migrations: readonly Migration[]): SiteModule<AlphaConfig> {
    return {
        name: "alpha",
        surfaces: ["site", "ingest"],
        migrations,
        parseConfig: (env) => {
            if (env.NB_SITE_ALPHA_WAIT === "parse") blockOnStdinLine("parse");
            const jobMs = env.NB_SITE_ALPHA_JOB_MS;
            return {
                ok: true,
                config: {fail: env.NB_SITE_ALPHA_FAIL, jobMs: jobMs === undefined ? undefined : Number(jobMs), waitInCreate: env.NB_SITE_ALPHA_WAIT === "create", backlog: env.NB_SITE_ALPHA_BACKLOG === "1"},
            };
        },
        create: (context) => {
            if (context.config.waitInCreate) blockOnStdinLine("create");
            return createAlpha(context);
        },
        prepareBackupCopy: prepareAlphaCopy,
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
                    if (args.label === "throw") throw new TypeError("fixture command threw with secret-detail-command");
                    db.query(`INSERT INTO "item" ("label") VALUES (?)`).run(args.label ?? "shared");
                    log.info("fixture.command_ran", "fixture command ran", {command: "alpha-shared"});
                    return undefined;
                },
            },
            {
                // 像创建管理员那样停在等输入的地方：标准输入来一行 `go` 才写入。`stubborn` 时不理会停止信号。
                name: "alpha-wait",
                description: "fixture command that waits for a line on stdin, like a password prompt",
                access: "shared",
                arguments: [{name: "mode", required: false}],
                run: async ({db, log, args, signal}) => {
                    log.info("fixture.command_waiting", "fixture command is waiting for stdin", {command: "alpha-wait"});
                    await stdinLines.wait("go", args.mode === "stubborn" ? undefined : signal);
                    db.query(`INSERT INTO "item" ("label") VALUES ('waited')`).run();
                    log.info("fixture.command_ran", "fixture command ran", {command: "alpha-wait"});
                    return undefined;
                },
            },
        ],
    };
}

/**
 * `NB_SITE_BETA_MOUNT_INGEST=1`：把子应用挂到没声明的写入口上，入口应当按 `start_failed` 拒绝。
 * `NB_SITE_BETA_FAIL=create`：异步的 `create()` reject。
 */
const beta: SiteModule<{readonly mountIngest: boolean; readonly failCreate: boolean}> = {
    name: "beta",
    surfaces: ["site"],
    migrations: [{id: "0001_beta", sql: `CREATE TABLE "beta" ("id" INTEGER PRIMARY KEY);`}],
    parseConfig: (env) => ({ok: true, config: {mountIngest: env.NB_SITE_BETA_MOUNT_INGEST === "1", failCreate: env.NB_SITE_BETA_FAIL === "create"}}),
    create: async ({config}) => {
        // 真的让出一次再决定，证明入口等的是 settle 之后的结果。
        await new Promise((resolve) => setImmediate(resolve));
        if (config.failCreate) throw new RangeError("fixture async create failure");
        const app = new Hono();
        app.get("/where", (c) => c.json({surface: "site", module: "beta"}));
        return {mounts: [{surface: config.mountIngest ? "ingest" : "site", prefix: "/api/beta", app}]};
    },
};

const FIXTURES: Readonly<Record<string, () => SiteModule>> = {
    alpha: () => alpha([ITEMS]),
    "alpha-failing": () => alpha([ITEMS, BROKEN]),
    beta: () => beta,
};

export function fixtureModules(spec: string | undefined): SiteModule[] {
    return (spec ?? "").split(",").map((name) => {
        const factory = FIXTURES[name.trim()];
        if (factory === undefined) throw new Error(`unknown fixture module: ${JSON.stringify(name)}`);
        return factory();
    });
}
