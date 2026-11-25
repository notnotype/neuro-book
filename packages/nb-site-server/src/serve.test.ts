/**
 * `nb-site serve`（`site.operations` 输出 1 到 4、8、9、11，状态表与失败表），起真子进程、连真端口：
 * 夹具模块经 `testing/fixture-main.ts` 进同一个 `runCli`，最后一组用产品入口 `main.ts` 与两个真模块。
 *
 * 每个用例起一到两个 Bun 进程（各约 100 到 300 毫秒），超出快速类 200 毫秒的预算：这里测的就是进程的启动、信号与退出码，
 * 进程内调用测不到。就绪检查的一条要等 1 秒的结果复用过期；停止时限的几条各等 300 毫秒的时限，模块收尾超时的一条等 2 秒。
 *
 * 要信号在某一步之后、入口的下一个检查点之前到达时，用夹具的 `NB_SITE_ALPHA_WAIT`：子进程在那一步同步阻塞着读标准输入，
 * 测试先发信号、再写一行放行（见 `testing/modules.ts` 的 `blockOnStdinLine`），不靠两个进程的相对速度。
 */

import {Database} from "bun:sqlite";
import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {randomBytes} from "node:crypto";
import {mkdir, readdir, rm} from "node:fs/promises";
import {connect} from "node:net";
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

    // “把正在执行的那一条做完”由 db/migrate.test.ts 的包内用例证明；这里证明信号让后面的迁移不执行、不监听、以 0 退出。
    it("迁移开始之前收到的 SIGTERM：一条迁移也不执行、不监听，以 0 退出", async () => {
        const site = await startSite({root, args: ["serve"], env: env({NB_SITE_ALPHA_WAIT: "parse"})});
        await site.waitForLog("blocked in parseConfig", (line) => line.event === "fixture.waiting_stdin");
        site.signal("SIGTERM");
        site.writeStdin("go\n");
        expect(await site.waitForExit()).toBe(0);
        expect(events(site)).toContain("process.signal");
        expect(events(site)).not.toContain("migration.applied");
        expect(events(site)).not.toContain("site.listening");
        expect(await readdir(dataDir)).not.toContain("alpha.db");
        expect(site.stderr).toEqual([]);
    });

    it("建实例期间收到 SIGTERM：迁移做完、不监听，已建成的实例照样 close()，以 0 退出", async () => {
        const site = await startSite({root, args: ["serve"], env: env({NB_SITE_ALPHA_WAIT: "create"})});
        await site.waitForLog("blocked in create()", (line) => line.event === "fixture.waiting_stdin");
        site.signal("SIGTERM");
        site.writeStdin("go\n");
        expect(await site.waitForExit()).toBe(0);
        expect(ledger("alpha")).toEqual(["0001_items"]);
        expect(events(site)).not.toContain("site.listening");
        expect(events(site)).toContain("fixture.closed");
        expect(events(site).at(-1)).toBe("site.stopped");
    });

    it("同一个数据目录上的第二个服务以 data_dir_busy 退出，不执行迁移", async () => {
        await startServing({root, env: env()});
        const second = await startSite({root, args: ["serve"], env: env()});
        expect(await second.waitForExit()).toBe(1);
        expect(failureLine(second)).toMatchObject({code: "data_dir_busy", module: "alpha"});
        expect(events(second)).toEqual([]);
    });

    it("模块的锁文件用不了（是个目录）时以 data_dir_unusable 退出，带模块与系统的错误码，不带路径", async () => {
        await mkdir(join(dataDir, "alpha.lock"));
        const site = await startSite({root, args: ["serve"], env: env()});
        expect(await site.waitForExit()).toBe(1);
        expect(failureLine(site)).toMatchObject({code: "data_dir_unusable", module: "alpha", errorCode: "EISDIR"});
        expect(events(site)).not.toContain("migration.applied");
        expect(allOutput(site)).not.toContain(dataDir);
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
        // 回应先于子进程那一行日志到达管道，等日志行出现再比。
        const notReadyLine = await waitUntil("not_ready log line", () => site.logs().find((line) => line.event === "health.not_ready"));
        expect(notReadyLine).toMatchObject({module: "alpha", reason: "module_not_ready"});
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
        // 探测连接不等锁：服务端记下的处理时长小于业务连接的等锁上限（看服务端的时长，不受测试进程的负载影响）。
        // 200 由 `db/open.ts` 的 `busy_timeout = 250` 推出：留出服务端进程被调度器抢占的余量，又能认出“等满 250 毫秒”。
        // 改 250 时一起改这里。
        const requestId = busy.headers.get("X-Request-Id");
        const handled = await site.waitForLog("ready request line", (line) => line.event === "http.request" && line.requestId === requestId);
        expect(handled.durationMs as number).toBeLessThan(200);
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

    it("请求里读不出主机名时回 400 bad_request，照常写一行请求日志，不记 error 级日志", async () => {
        const {site, url} = await startServing({root, env: env()});
        const {hostname, port} = new URL(url);
        // fetch 总会补上 Host，只能用原始套接字发。
        const raw = (request: string): Promise<string> =>
            new Promise((resolve, reject) => {
                let received = "";
                const socket = connect(Number(port), hostname, () => socket.write(request));
                socket.on("data", (chunk) => (received += chunk.toString("utf8")));
                socket.on("end", () => resolve(received));
                socket.on("error", reject);
            });
        const requests = [
            "GET /api/alpha/where HTTP/1.0\r\n\r\n",
            "GET /api/alpha/where HTTP/1.1\r\nHost: ingest.example:abc\r\nConnection: close\r\n\r\n",
            "GET /api/alpha/where HTTP/1.1\r\nHost: x@ingest.example\r\nConnection: close\r\n\r\n",
        ];
        for (const request of requests) {
            const response = await raw(request);
            expect({request, status: response.split("\r\n")[0]}).toEqual({request, status: "HTTP/1.1 400 Bad Request"});
            expect(JSON.parse(response.slice(response.indexOf("\r\n\r\n") + 4))).toEqual({code: "bad_request"});
        }
        const lines = await waitUntil("three request lines", () => {
            const found = site.logs().filter((line) => line.event === "http.request");
            return found.length >= requests.length ? found : undefined;
        });
        expect(lines.map((line) => line.status)).toEqual([400, 400, 400]);
        expect(site.logs().filter((line) => line.level === "error")).toEqual([]);
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
        // 第一个不可信的地址左边是请求方自己写的，不解析：写什么都不能让自己取不到地址。
        expect(await client(trusted.url, "garbage, 203.0.113.9")).toBe("203.0.113.9");
        expect(await client(trusted.url, "garbage, 203.0.113.9, 10.1.2.3")).toBe("203.0.113.9");
        // 带端口的写法不认。
        expect(await client(trusted.url, "203.0.113.9:4444")).toBeNull();
        expect(await client(trusted.url, "198.51.100.7, 10.1.2.3:8080")).toBeNull();
        expect(await client(trusted.url, undefined)).toBeNull();
        // 同一个地址的几种写法得到同一个值：IPv4 映射的 IPv6 地址（点分与十六进制两种写法）当作 IPv4，其余 IPv6 用小写的
        // 压缩写法（`site.operations` 的“来源地址”一段）。
        for (const hop of ["::ffff:192.0.2.1", "::ffff:c000:201", "::FFFF:192.0.2.1", "192.0.2.1"]) expect({hop, address: await client(trusted.url, hop)}).toEqual({hop, address: "192.0.2.1"});
        for (const hop of ["2001:DB8::1", "2001:db8:0:0:0:0:0:1", "2001:0db8::0001"]) expect({hop, address: await client(trusted.url, hop)}).toEqual({hop, address: "2001:db8::1"});
        // 可信代理的比较用规范化之后的写法：映射写法的可信代理照样被跳过，不可信的映射写法也不会被当成可信。
        expect(await client(trusted.url, "198.51.100.7, ::ffff:10.1.2.3")).toBe("198.51.100.7");
        expect(await client(trusted.url, "198.51.100.7, ::ffff:203.0.113.9")).toBe("203.0.113.9");
        for (const hop of ["fe80::1%eth0", "::ffff:999.0.0.1", "2001:db8::1::2"]) expect({hop, address: await client(trusted.url, hop)}).toEqual({hop, address: null});
        expect(allOutput(trusted.site)).not.toContain("203.0.113.5");
        trusted.site.signal("SIGTERM");
        expect(await trusted.site.waitForExit()).toBe(0);

        const untrusted = await startServing({root, env: env()});
        expect(await client(untrusted.url, "203.0.113.5")).toBe("127.0.0.1");
    });
});

describe("模块的生命周期", () => {
    it("start() 与定时任务在监听之后才开始，停止时不再开始新的任务运行、再 close()、最后 site.stopped", async () => {
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

    it("异步的 create() reject 时得 start_failed 并点名模块，已建成的别的模块照样 close()", async () => {
        const site = await startSite({root, args: ["serve"], env: env({NB_SITE_FIXTURE: "alpha,beta", NB_SITE_BETA_FAIL: "create"})});
        expect(await site.waitForExit()).toBe(1);
        expect(failureLine(site)).toMatchObject({code: "start_failed", module: "beta", errorType: "RangeError"});
        expect(events(site)).not.toContain("site.listening");
        expect(events(site)).toContain("fixture.closed");
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
        expect(failureLine(site)).toMatchObject({code: "internal"});
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

    it("模块的 close() 另有 2 秒、不占停止时限；超过时记一行 warn，随后照样关库退出", async () => {
        const {site} = await startServing({root, env: env({NB_SITE_ALPHA_FAIL: "close-hang", NB_SITE_SHUTDOWN_TIMEOUT_MS: "300"})});
        const signalled = performance.now();
        site.signal("SIGTERM");
        expect(await site.waitForExit()).toBe(0);
        // 排空立即完成，停止时限 300 毫秒早已用不上；等满的是模块自己的 2 秒（下界留 100 毫秒给计时器的粒度）。
        expect(performance.now() - signalled).toBeGreaterThanOrEqual(1_900);
        expect(site.logs().find((line) => line.event === "module.close_timeout")).toMatchObject({level: "warn", module: "alpha", forced: false});
        expect(events(site).at(-1)).toBe("site.stopped");
    });

    it("等模块收尾期间再来一次信号：不再等 close()，照样关库退出", async () => {
        const {site} = await startServing({root, env: env({NB_SITE_ALPHA_FAIL: "close-hang"})});
        site.signal("SIGTERM");
        await site.waitForLog("close() called", (line) => line.event === "fixture.closed");
        site.signal("SIGTERM");
        expect(await site.waitForExit()).toBe(0);
        expect(site.logs().find((line) => line.event === "module.close_timeout")).toMatchObject({module: "alpha", forced: true});
        expect(events(site).at(-1)).toBe("site.stopped");
    });

    it("积压很多的任务正在跑时停止：先 close()，任务在下一批之前收手，不记 job.stop_timeout", async () => {
        const {site} = await startServing({root, env: env({NB_SITE_ALPHA_BACKLOG: "1"})});
        await site.waitForLog("backlog job started", (line) => line.event === "fixture.backlog_started");
        site.signal("SIGTERM");
        expect(await site.waitForExit()).toBe(0);
        const order = events(site);
        // 先等任务再 close() 时，这个任务要等到 close() 才停，等任务的 2 秒先用完、记一行 job.stop_timeout。
        expect(order).not.toContain("job.stop_timeout");
        expect(order.indexOf("fixture.closed")).toBeLessThan(order.indexOf("fixture.backlog_stopped"));
        expect(order.indexOf("fixture.backlog_stopped")).toBeLessThan(order.indexOf("site.stopped"));
    });
});

describe("测试控制入口（输出 11）", () => {
    // 每个用例一个新口令；用例结束后在整段输出里搜它。
    let token: string;
    beforeEach(() => {
        token = randomBytes(24).toString("hex");
    });

    /** `authorization` 为 null 时不带这个请求头。 */
    async function control(url: string, path: string, body: unknown, authorization: string | null = `Bearer ${token}`): Promise<{status: number; body: unknown}> {
        const {status, body: responseBody} = await getJson(`${url}test-control/${path}`, {
            method: "POST",
            headers: {"Content-Type": "application/json", ...(authorization === null ? {} : {Authorization: authorization})},
            body: typeof body === "string" ? body : JSON.stringify(body),
        });
        return {status, body: responseBody};
    }

    async function moduleNow(url: string): Promise<number> {
        return ((await getJson(`${url}api/alpha/now`)).body as {now: number}).now;
    }

    it("没设口令时两个地址与别的不存在的地址一样回 404，带了 Authorization 也一样", async () => {
        const {site, url} = await startServing({root, env: env()});
        const missing = await getJson(`${url}nothing-here`);
        expect(missing).toMatchObject({status: 404, body: {code: "not_found"}});
        expect(await control(url, "clock", {advanceMs: 1000})).toEqual({status: 404, body: missing.body});
        expect(await control(url, "jobs/run", {module: "alpha", job: "count"})).toEqual({status: 404, body: missing.body});
        expect((await getJson(`${url}api/alpha/job-count`)).body).toEqual({count: 0});
        expect(events(site)).not.toContain("site.test_control_enabled");
    });

    it("设了口令：启动日志有一行 warn；不带或带错口令时回 404，与别的不存在的地址相同；整段输出里没有口令", async () => {
        const {site, url} = await startServing({root, env: env({NB_SITE_TEST_CONTROL: token})});
        expect(site.logs().find((line) => line.event === "site.test_control_enabled")).toMatchObject({level: "warn"});
        const missing = (await getJson(`${url}nothing-here`)).body;
        const wrong = [null, `Bearer ${token.slice(0, -1)}x`, `Bearer ${token}x`, token, `bearer ${token}`, "Bearer "];
        for (const authorization of wrong) {
            expect({authorization, result: await control(url, "clock", {advanceMs: 1000}, authorization)}).toEqual({authorization, result: {status: 404, body: missing}});
            expect({authorization, result: await control(url, "jobs/run", {module: "alpha", job: "count"}, authorization)}).toEqual({authorization, result: {status: 404, body: missing}});
        }
        expect((await getJson(`${url}api/alpha/job-count`)).body).toEqual({count: 0});
        // 带对口令时同一个请求生效，证明上面的 404 是口令不对，不是请求写错了。
        expect(await control(url, "jobs/run", {module: "alpha", job: "count"})).toEqual({status: 200, body: {status: "done"}});
        site.signal("SIGTERM");
        expect(await site.waitForExit()).toBe(0);
        expect(allOutput(site)).not.toContain(token);
    });

    it("拨时间：模块取到的时间往前走，几次拨动累加，回的 now 是拨过之后的时间", async () => {
        const {url} = await startServing({root, env: env({NB_SITE_TEST_CONTROL: token})});
        const before = await moduleNow(url);
        const first = await control(url, "clock", {advanceMs: 60_000});
        expect(first.status).toBe(200);
        const firstNow = (first.body as {now: number}).now;
        expect(firstNow).toBeGreaterThanOrEqual(before + 60_000);
        expect(await moduleNow(url)).toBeGreaterThanOrEqual(firstNow);

        const second = await control(url, "clock", {advanceMs: 1_000});
        expect(second.status).toBe(200);
        expect((second.body as {now: number}).now).toBeGreaterThanOrEqual(firstNow + 1_000);
    });

    it("请求体不合格时回 400 bad_request，时间不动", async () => {
        const {url} = await startServing({root, env: env({NB_SITE_TEST_CONTROL: token})});
        const clockBodies: unknown[] = [{advanceMs: 0}, {advanceMs: -5}, {advanceMs: 1.5}, {advanceMs: "10"}, {}, {advanceMs: 1, extra: true}, [1], "not json", {advanceMs: Number.MAX_SAFE_INTEGER + 1}];
        for (const body of clockBodies) expect({body, result: await control(url, "clock", body)}).toEqual({body, result: {status: 400, body: {code: "bad_request"}}});
        const jobBodies: unknown[] = [{}, {module: "alpha"}, {module: 1, job: "count"}, {module: "alpha", job: "count", extra: 1}, "not json"];
        for (const body of jobBodies) expect({body, result: await control(url, "jobs/run", body)}).toEqual({body, result: {status: 400, body: {code: "bad_request"}}});
        expect((await getJson(`${url}api/alpha/job-count`)).body).toEqual({count: 0});
        // 时间没被拨过：模块的时间与墙钟相差远小于上面任何一次合格的拨动。
        expect(Math.abs((await moduleNow(url)) - Date.now())).toBeLessThan(5_000);
    });

    it("跑任务：跑完才回 200，看得到任务的效果；没有这个模块或任务回 404 not_found", async () => {
        const {url} = await startServing({root, env: env({NB_SITE_TEST_CONTROL: token})});
        expect(await control(url, "jobs/run", {module: "alpha", job: "count"})).toEqual({status: 200, body: {status: "done"}});
        expect((await getJson(`${url}api/alpha/job-count`)).body).toEqual({count: 1});
        expect(await control(url, "jobs/run", {module: "nope", job: "count"})).toEqual({status: 404, body: {code: "not_found"}});
        expect(await control(url, "jobs/run", {module: "alpha", job: "nope"})).toEqual({status: 404, body: {code: "not_found"}});
    });

    it("任务出错回 500 job_failed，响应体不带错误内容，日志有一行 job.failed", async () => {
        const {site, url} = await startServing({root, env: env({NB_SITE_TEST_CONTROL: token})});
        expect(await control(url, "jobs/run", {module: "alpha", job: "fail"})).toEqual({status: 500, body: {code: "job_failed", module: "alpha", job: "fail"}});
        expect(site.logs().find((line) => line.event === "job.failed")).toMatchObject({level: "error", module: "alpha", job: "fail", errorType: "RangeError"});
        expect(allOutput(site)).not.toContain("secret-detail-job");
    });

    it("任务正在跑时，再要一次会等那一次结束才开始", async () => {
        const {site, url} = await startServing({root, env: env({NB_SITE_TEST_CONTROL: token})});
        const holdEvents = (): string[] => events(site).filter((event) => event.startsWith("fixture.hold_"));
        const first = control(url, "jobs/run", {module: "alpha", job: "hold"});
        await site.waitForLog("first hold started", (line) => line.event === "fixture.hold_started");
        const second = control(url, "jobs/run", {module: "alpha", job: "hold"});
        // 入口受理第二次请求时写一行 test_control.job_run，之后同步地交给调度；等到这一行，第二次要是没排队，
        // 它的 hold_started 已经写出来了。
        await waitUntil("second run requested", () => site.logs().filter((line) => line.event === "test_control.job_run").length >= 2);
        site.writeStdin("finish\n");
        expect(await first).toEqual({status: 200, body: {status: "done"}});
        await waitUntil("second hold started", () => holdEvents().length >= 3);
        site.writeStdin("finish\n");
        expect(await second).toEqual({status: 200, body: {status: "done"}});
        // 回应先于子进程那一行日志到达管道，等日志行出现再比。
        await waitUntil("second hold finished", () => holdEvents().length >= 4);
        expect(holdEvents()).toEqual(["fixture.hold_started", "fixture.hold_finished", "fixture.hold_started", "fixture.hold_finished"]);
    });

    it("收到停止信号之后，排着队与新要的“立即跑一次”都回 503 not_ready，已经开始的那一次照常跑完", async () => {
        const {site, url} = await startServing({root, env: env({NB_SITE_TEST_CONTROL: token})});
        const holdEvents = (): string[] => events(site).filter((event) => event.startsWith("fixture.hold_"));
        const first = control(url, "jobs/run", {module: "alpha", job: "hold"});
        await site.waitForLog("first hold started", (line) => line.event === "fixture.hold_started");
        const queued = control(url, "jobs/run", {module: "alpha", job: "hold"});
        // 第二次的 test_control.job_run 写出来时它已经排在第一次后面（见上一条用例）。
        await waitUntil("second run requested", () => site.logs().filter((line) => line.event === "test_control.job_run").length >= 2);
        site.signal("SIGTERM");
        await site.waitForLog("signal", (line) => line.event === "process.signal");
        site.writeStdin("finish\n");
        expect(await first).toEqual({status: 200, body: {status: "done"}});
        expect(await queued).toEqual({status: 503, body: {code: "not_ready"}});
        expect(await site.waitForExit()).toBe(0);
        expect(holdEvents()).toEqual(["fixture.hold_started", "fixture.hold_finished"]);
    });

    it("设了口令而监听地址不是本机回环时以 config_invalid 退出、不监听，标准错误里没有口令", async () => {
        for (const host of ["0.0.0.0", "::"]) {
            const site = await startSite({root, args: ["serve"], env: env({NB_SITE_TEST_CONTROL: token, NB_SITE_HOST: host})});
            expect(await site.waitForExit()).toBe(1);
            expect({host, failure: failureLine(site)}).toMatchObject({host, failure: {code: "config_invalid", problems: [{name: "NB_SITE_HOST", problem: "not_loopback"}]}});
            expect(events(site)).not.toContain("site.listening");
            expect(allOutput(site)).not.toContain(token);
        }
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
