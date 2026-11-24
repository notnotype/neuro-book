/**
 * `nb-site serve`（`site.operations` 输出 1 到 4、8、9，状态表与失败表），起真子进程、连真端口：
 * 夹具模块经 `testing/fixture-main.ts` 进同一个 `runCli`，最后一组用产品入口 `main.ts` 与两个真模块。
 *
 * 每个用例起一到两个 Bun 进程（各约 100 到 300 毫秒），超出快速类 200 毫秒的预算：这里测的就是进程的启动、信号与退出码，
 * 进程内调用测不到。迁移期间的信号那一条另有一条要执行约 1 秒的迁移；就绪检查的两条要等 1 秒的结果复用过期；
 * 停止时限的几条各等 300 毫秒的时限。
 */

import {Database} from "bun:sqlite";
import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {mkdir, readdir, rm} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {MAIN_SCRIPT, startServing, startSite, stopAllSiteProcesses, type LogLine, type SiteProcess} from "./testing/process";

let root: string;
let dataDir: string;
const external: Database[] = [];

beforeEach(async () => {
    root = await createTestTmpRoot("nb-site-serve", "nb-site-server serve.test.ts");
    dataDir = join(root, "data");
    await mkdir(dataDir);
});

afterEach(async () => {
    await stopAllSiteProcesses();
    for (const db of external.splice(0)) db.close();
    await rm(root, {recursive: true, force: true});
});

const SECRET = "SESSION-SECRET-7f3a-0123456789abcdef0123456789";

function env(extra: Readonly<Record<string, string>> = {}): Record<string, string> {
    return {
        NB_SITE_URL: "https://site.example",
        NB_SITE_TELEMETRY_URL: "https://ingest.example",
        NB_SITE_DATA_DIR: dataDir,
        NB_SITE_PORT: "0",
        NB_SITE_FIXTURE: "alpha",
        ...extra,
    };
}

/** 标准错误的最后一行：命令失败时的那一行 JSON。 */
function failureLine(site: SiteProcess): LogLine {
    const last = site.stderr.at(-1);
    if (last === undefined) throw new Error("no stderr output");
    return JSON.parse(last) as LogLine;
}

function events(site: SiteProcess): string[] {
    return site.logs().map((line) => String(line.event));
}

function ledger(module: string): string[] {
    const db = new Database(join(dataDir, `${module}.db`), {readonly: true});
    try {
        return db
            .query<{id: string}, []>("SELECT id FROM site_migrations ORDER BY id")
            .all()
            .map((row) => row.id);
    } finally {
        db.close();
    }
}

async function getJson(url: string, init?: RequestInit): Promise<{status: number; body: unknown; headers: Headers}> {
    const response = await fetch(url, init);
    return {status: response.status, body: await response.json(), headers: response.headers};
}

/** 整段输出（两路），给“不含某个值”的断言用。 */
function allOutput(site: SiteProcess): string {
    return [...site.stdout, ...site.stderr].join("\n");
}

describe("迁移先于服务", () => {
    it("某条迁移失败时以 1 退出、不监听，失败那一行带模块、迁移、原因与数据库的错误码，之前的迁移保留", async () => {
        const site = await startSite({root, args: ["serve"], env: env({NB_SITE_FIXTURE: "alpha-failing"})});
        expect(await site.waitForExit()).toBe(1);
        const failure = failureLine(site);
        expect(failure).toMatchObject({level: "error", event: "command.failed", code: "migration_failed", module: "alpha", migration: "0002_broken", reason: "sql_error"});
        expect(String(failure.dbCode)).toStartWith("SQLITE_");
        expect(site.logs().filter((line) => line.event === "migration.applied")).toMatchObject([{module: "alpha", migration: "0001_items"}]);
        expect(events(site)).not.toContain("site.listening");
        expect(ledger("alpha")).toEqual(["0001_items"]);
        expect(allOutput(site)).not.toContain(dataDir);
    });

    it("迁移期间收到 SIGTERM：做完正在执行的那一条、不执行后面的、不监听，以 0 退出", async () => {
        const site = await startSite({root, args: ["serve"], env: env({NB_SITE_FIXTURE: "alpha-slow"})});
        await site.waitForLog("first migration applied", (line) => line.event === "migration.applied" && line.migration === "0001_items");
        site.signal("SIGTERM");
        expect(await site.waitForExit()).toBe(0);
        expect(events(site)).not.toContain("site.listening");
        expect(ledger("alpha")).not.toContain("0003_after_slow");
    });

    it("同一个数据目录上的第二个服务以 data_dir_busy 退出，不执行迁移", async () => {
        await startServing({root, env: env()});
        const second = await startSite({root, args: ["serve"], env: env()});
        expect(await second.waitForExit()).toBe(1);
        expect(failureLine(second)).toMatchObject({code: "data_dir_busy", module: "alpha"});
        expect(events(second)).toEqual([]);
    });
});

describe("健康检查", () => {
    it("存活与就绪都 200；模块的 ready() 为假时就绪检查 503 并逐个写明模块", async () => {
        const {site, url} = await startServing({root, env: env({NB_SITE_FIXTURE: "alpha,beta"})});
        expect(await getJson(`${url}health/live`)).toMatchObject({status: 200, body: {status: "live"}});
        expect(await getJson(`${url}health/ready`)).toMatchObject({status: 200, body: {status: "ready", modules: {alpha: "ready", beta: "ready"}}});

        expect((await fetch(`${url}api/alpha/ready/false`, {method: "POST"})).status).toBe(200);
        // 就绪结果复用 1 秒，等它过期。
        const notReady = await waitUntil("readiness turns 503", async () => {
            const result = await getJson(`${url}health/ready`);
            return result.status === 503 ? result : undefined;
        });
        expect(notReady.body).toEqual({status: "not_ready", code: "not_ready", modules: {alpha: "not_ready", beta: "ready"}});
        expect(site.logs().find((line) => line.event === "health.not_ready")).toMatchObject({module: "alpha", reason: "module_not_ready"});
    });

    it("模块在业务连接上开着事务时，就绪检查 200 且不动那个事务", async () => {
        const {url} = await startServing({root, env: env()});
        expect(await getJson(`${url}api/alpha/txn/begin`, {method: "POST"})).toMatchObject({status: 200, body: {inTransaction: true}});
        expect(await getJson(`${url}health/ready`)).toMatchObject({status: 200, body: {status: "ready"}});
        expect(await getJson(`${url}api/alpha/txn/commit`, {method: "POST"})).toMatchObject({status: 200, body: {inTransaction: false}});
        expect(await getJson(`${url}api/alpha/items`)).toMatchObject({body: {count: 1}});
    });

    it("库被别的进程占着写时立即 503，放开后不重启就回到 200", async () => {
        const {site, url} = await startServing({root, env: env()});
        const holder = new Database(join(dataDir, "alpha.db"));
        external.push(holder);
        holder.exec("BEGIN IMMEDIATE");
        const busy = await getJson(`${url}health/ready`);
        expect(busy).toMatchObject({status: 503, body: {code: "not_ready", modules: {alpha: "not_ready"}}});
        // 探测连接不等锁：服务端记下的处理时长远小于业务连接的 250 毫秒等锁上限（看服务端的时长，不受测试进程的负载影响）。
        const requestId = busy.headers.get("X-Request-Id");
        const handled = await site.waitForLog("ready request line", (line) => line.event === "http.request" && line.requestId === requestId);
        expect(handled.durationMs as number).toBeLessThan(100);
        expect(site.logs().find((line) => line.event === "health.not_ready")).toMatchObject({module: "alpha", reason: "db_unavailable", dbCode: "SQLITE_BUSY"});
        holder.exec("ROLLBACK");
        await waitUntil("readiness recovers", async () => (await fetch(`${url}health/ready`)).status === 200);
    });
});

describe("按主机分派与请求日志", () => {
    it("主机名与写入口相同的请求到写入口，比较不分大小写、不看端口、忽略末尾的点；其余到站点", async () => {
        const {url} = await startServing({root, env: env()});
        const where = async (host: string | undefined): Promise<unknown> => (await getJson(`${url}api/alpha/where`, host === undefined ? undefined : {headers: {Host: host}})).body;
        for (const host of ["ingest.example", "INGEST.Example", "ingest.example:443", "ingest.example."]) {
            expect({host, body: await where(host)}).toEqual({host, body: {surface: "ingest"}});
        }
        for (const host of ["site.example", "ingest.example.evil", undefined]) {
            expect({host, body: await where(host)}).toEqual({host, body: {surface: "site"}});
        }
        expect((await fetch(`${url}health/live`, {headers: {Host: "ingest.example"}})).status).toBe(200);
    });

    it("每个请求一行日志，编号由服务生成、与响应头相同，不含查询串与请求方给的编号", async () => {
        const {site, url} = await startServing({root, env: env()});
        const response = await fetch(`${url}api/alpha/where?token=query-secret`, {headers: {"X-Request-Id": "incoming-request-id"}});
        const requestId = response.headers.get("X-Request-Id");
        expect(requestId).not.toBe("incoming-request-id");
        expect(requestId).toMatch(/^[0-9a-f-]{36}$/u);
        expect((await fetch(`${url}nothing-here`)).status).toBe(404);

        const lines = await waitUntil("two request lines", () => {
            const found = site.logs().filter((line) => line.event === "http.request");
            return found.length >= 2 ? found : undefined;
        });
        expect(lines[0]).toMatchObject({level: "info", requestId, module: "alpha", method: "GET", path: "/api/alpha/where", status: 200});
        expect(typeof lines[0]!.time).toBe("string");
        expect(typeof lines[0]!.durationMs).toBe("number");
        expect(lines[1]).toMatchObject({module: "site", path: "/nothing-here", status: 404});
        expect(allOutput(site)).not.toContain("incoming-request-id");
        expect(allOutput(site)).not.toContain("query-secret");
    });

    it("处理函数抛错时回 500，日志只有错误类型", async () => {
        const {site, url} = await startServing({root, env: env()});
        expect(await getJson(`${url}api/alpha/boom`)).toMatchObject({status: 500, body: {code: "internal"}});
        await site.waitForLog("unhandled error line", (line) => line.event === "http.unhandled_error");
        expect(site.logs().find((line) => line.event === "http.unhandled_error")).toMatchObject({module: "alpha", errorType: "RangeError"});
        expect(allOutput(site)).not.toContain("secret-detail-boom");
    });

    it("请求方地址：对端可信时从右往左跳过可信的代理，格式不对或没有转发头时取不到；对端不可信时不看转发头", async () => {
        const trusted = await startServing({root, env: env({NB_SITE_TRUSTED_PROXIES: "127.0.0.1,10.0.0.0/8"})});
        const client = async (base: string, forwarded: string | undefined): Promise<unknown> =>
            ((await getJson(`${base}api/alpha/client`, forwarded === undefined ? undefined : {headers: {"X-Forwarded-For": forwarded}})).body as {address: unknown}).address;
        expect(await client(trusted.url, "203.0.113.5")).toBe("203.0.113.5");
        expect(await client(trusted.url, "198.51.100.7, 10.1.2.3")).toBe("198.51.100.7");
        expect(await client(trusted.url, "192.0.2.1, 198.51.100.7, 10.1.2.3")).toBe("198.51.100.7");
        expect(await client(trusted.url, "10.9.9.9, 10.1.2.3")).toBe("10.9.9.9");
        expect(await client(trusted.url, "garbage, 10.1.2.3")).toBeNull();
        expect(await client(trusted.url, undefined)).toBeNull();
        expect(allOutput(trusted.site)).not.toContain("203.0.113.5");
        trusted.site.signal("SIGTERM");
        expect(await trusted.site.waitForExit()).toBe(0);

        const untrusted = await startServing({root, env: env()});
        expect(await client(untrusted.url, "203.0.113.5")).toBe("127.0.0.1");
    });
});

describe("模块的生命周期", () => {
    it("start() 与定时任务在监听之后才开始，停止时定时任务先停、再 close()、最后 site.stopped", async () => {
        const {site} = await startServing({root, env: env({NB_SITE_ALPHA_JOB_MS: "20"})});
        await site.waitForLog("job ran", (line) => line.event === "fixture.job_ran");
        site.signal("SIGTERM");
        expect(await site.waitForExit()).toBe(0);
        const order = events(site);
        const listening = order.indexOf("site.listening");
        expect(listening).toBeLessThan(order.indexOf("fixture.started"));
        expect(order.indexOf("fixture.started")).toBeLessThan(order.indexOf("fixture.job_ran"));
        expect(order.lastIndexOf("fixture.job_ran")).toBeLessThan(order.indexOf("fixture.closed"));
        expect(order.at(-1)).toBe("site.stopped");
        expect(order.indexOf("fixture.closed")).toBeLessThan(order.indexOf("site.stopped"));
    });

    it("端口被占时得 listen_failed，已建成的实例照样 close()，锁随之放掉", async () => {
        const occupied = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: () => new Response("occupied")});
        try {
            const site = await startSite({root, args: ["serve"], env: env({NB_SITE_PORT: String(occupied.port)})});
            expect(await site.waitForExit()).toBe(1);
            expect(failureLine(site)).toMatchObject({code: "listen_failed", errorCode: "EADDRINUSE"});
            const order = events(site);
            expect(order).not.toContain("site.listening");
            expect(order).toContain("fixture.closed");
            expect(allOutput(site)).not.toContain(String(occupied.port));
        } finally {
            await occupied.stop(true);
        }
        await startServing({root, env: env()});
    });

    it("模块的 create() 抛错时得 start_failed 并点名模块，不监听", async () => {
        const site = await startSite({root, args: ["serve"], env: env({NB_SITE_ALPHA_FAIL: "create"})});
        expect(await site.waitForExit()).toBe(1);
        expect(failureLine(site)).toMatchObject({code: "start_failed", module: "alpha", errorType: "TypeError"});
        expect(events(site)).not.toContain("site.listening");
    });

    it("模块的 start() 抛错时得 start_failed，已建成的实例照样 close()", async () => {
        const site = await startSite({root, args: ["serve"], env: env({NB_SITE_ALPHA_FAIL: "start"})});
        expect(await site.waitForExit()).toBe(1);
        expect(failureLine(site)).toMatchObject({code: "start_failed", module: "alpha", errorType: "TypeError"});
        expect(events(site)).toContain("fixture.closed");
    });

    it("模块把子应用挂到没声明的入口上时得 start_failed", async () => {
        const site = await startSite({root, args: ["serve"], env: env({NB_SITE_FIXTURE: "beta", NB_SITE_BETA_MOUNT_INGEST: "1"})});
        expect(await site.waitForExit()).toBe(1);
        expect(failureLine(site)).toMatchObject({code: "start_failed", module: "beta"});
    });

    it("请求之外的未捕获异常：写一行只有错误类型的 process.fatal，照停止的步骤收口，以 1 退出", async () => {
        const {site, url} = await startServing({root, env: env()});
        expect((await fetch(`${url}api/alpha/crash`)).status).toBe(202);
        expect(await site.waitForExit()).toBe(1);
        expect(site.logs().find((line) => line.event === "process.fatal")).toMatchObject({level: "error", errorType: "SyntaxError"});
        expect(events(site)).toContain("fixture.closed");
        expect(events(site).at(-1)).toBe("site.stopped");
        expect(allOutput(site)).not.toContain("secret-detail-crash");
    });
});

describe("停止", () => {
    /**
     * 起一个慢请求，等它进到处理函数里，返回它的结果（成功或连接被断开）。包在对象里返回：async 函数直接返回 Promise
     * 会等它 settle，而它要等测试放行。
     */
    async function slowRequest(site: SiteProcess, url: string): Promise<{readonly result: Promise<{status: number} | {error: unknown}>}> {
        const result = fetch(`${url}api/alpha/slow`).then(
            (response) => ({status: response.status}),
            (error: unknown) => ({error}),
        );
        await site.waitForLog("slow request started", (line) => line.event === "fixture.slow_started");
        return {result};
    }

    it("SIGTERM 之后不接新请求，在途请求照常完成，以 0 退出", async () => {
        const {site, url} = await startServing({root, env: env()});
        const {result: pending} = await slowRequest(site, url);
        site.signal("SIGTERM");
        await site.waitForLog("signal", (line) => line.event === "process.signal");
        await waitUntil("new connections refused", async () =>
            fetch(`${url}health/live`).then(
                () => false,
                () => true,
            ),
        );
        site.writeStdin("release\n");
        expect(await pending).toEqual({status: 200});
        expect(await site.waitForExit()).toBe(0);
        expect(events(site)).not.toContain("site.drain_cut");
        expect(events(site).at(-1)).toBe("site.stopped");
    });

    it("在途请求超过停止时限时断开它，进程照样退出", async () => {
        const {site, url} = await startServing({root, env: env({NB_SITE_SHUTDOWN_TIMEOUT_MS: "300"})});
        const {result: pending} = await slowRequest(site, url);
        const signalled = performance.now();
        site.signal("SIGTERM");
        expect(await site.waitForExit()).toBe(0);
        expect(performance.now() - signalled).toBeGreaterThanOrEqual(250);
        expect(await pending).toHaveProperty("error");
        expect(site.logs().find((line) => line.event === "site.drain_cut")).toMatchObject({level: "warn", forced: false});
    });

    it("停止期间再来一次信号：立即断开在途请求并退出", async () => {
        const {site, url} = await startServing({root, env: env()});
        const {result: pending} = await slowRequest(site, url);
        site.signal("SIGTERM");
        await site.waitForLog("first signal", (line) => line.event === "process.signal");
        site.signal("SIGTERM");
        // 停止时限是缺省的 10 秒，3 秒内退出说明没在等它。
        expect(await site.waitForExit(3_000)).toBe(0);
        expect(await pending).toHaveProperty("error");
        expect(site.logs().find((line) => line.event === "site.drain_cut")).toMatchObject({forced: true});
    });

    it("模块的 close() 超过停止时限时记一行 warn，随后照样关库退出", async () => {
        const {site} = await startServing({root, env: env({NB_SITE_ALPHA_FAIL: "close-hang", NB_SITE_SHUTDOWN_TIMEOUT_MS: "300"})});
        site.signal("SIGTERM");
        expect(await site.waitForExit()).toBe(0);
        expect(site.logs().find((line) => line.event === "module.close_timeout")).toMatchObject({level: "warn", module: "alpha"});
        expect(events(site).at(-1)).toBe("site.stopped");
    });
});

describe("产品入口 main.ts", () => {
    it("装着两个真模块启动，就绪检查逐个写明，SIGTERM 后以 0 退出", async () => {
        const {site, url} = await startServing({root, script: MAIN_SCRIPT, env: {...env(), NB_SITE_SESSION_SECRET: SECRET}});
        expect(await getJson(`${url}health/ready`)).toMatchObject({status: 200, body: {status: "ready", modules: {identity: "ready", telemetry: "ready"}}});
        site.signal("SIGTERM");
        expect(await site.waitForExit()).toBe(0);
        expect(events(site).at(-1)).toBe("site.stopped");
        expect(allOutput(site)).not.toContain(SECRET);
    });

    it("去掉会话密钥启动：以 1 退出、不监听、不改数据目录，标准错误里没有任何取值", async () => {
        const site = await startSite({root, script: MAIN_SCRIPT, args: ["serve"], env: env({NB_SITE_TRUSTED_PROXIES: "10.0.0.0/8"})});
        expect(await site.waitForExit()).toBe(1);
        const failure = failureLine(site);
        expect(failure).toMatchObject({code: "config_invalid", problems: [{name: "NB_SITE_SESSION_SECRET", problem: "missing"}]});
        expect(events(site)).toEqual([]);
        expect(await readdir(dataDir)).toEqual([]);
        for (const value of ["site.example", "ingest.example", dataDir, "10.0.0.0"]) expect(allOutput(site)).not.toContain(value);
    });
});
