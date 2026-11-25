/**
 * `site.operations`（官方站：运行与部署）的黑盒合同：起真实的 `nb-site` 进程，只经 HTTP 与命令行看它。断言只用 Spec 写明的
 * 字段名、码、问题词与 `reason`；Spec 没写的输出（日志的 `message`、没写明取值的字段）不断言。
 *
 * 时间预算：起进程、跑命令放在各组的 `beforeAll` 里（Bun 的 junit 不把钩子的耗时算进用例），用例本身只发请求、读结果。
 * 超出 200 毫秒的用例在它旁边写明原因。
 *
 * 本 Task 测不到、留给后面 Task 的：
 * - 按主机名分派（输入一节）：在 `telemetry-ingest.test.ts` 的 C18，那里有写入口主机上的路由可以区分。
 * - 测试控制入口“跑一次任务看到效果”（输出 11、验收 5 之外）：两个真实模块都还没有定时任务；t06 起补。
 * - 创建管理员（输出 5）在 t07；验收 3 的“账号能登录”在 t07、“原始上报表是空的”在 t06，加进备份那一组；验收 2 见
 *   `adjacent-version.test.ts`。
 * - 第一次启动执行了迁移（输出 2 的 `migration.applied`）：两个模块都还没有迁移，t06、t07 加了迁移后“从空的数据目录启动”
 *   一组自然覆盖到。
 */

import {beforeAll, describe, expect, it} from "bun:test";
import {copyFile, readdir} from "node:fs/promises";
import {join} from "node:path";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {backupsDir, BACKUP_NAME, listBackups, quickCheck} from "./testing/backup";
import {holdWriteLock} from "./testing/fault";
import {
    isListening,
    randomSecret,
    rawHttp,
    requestJson,
    reservePort,
    testControlRequest,
    useSiteSandbox,
    type CommandResult,
    type JsonResponse,
    type LogLine,
    type SiteProcess,
} from "./testing/site";

const sandbox = useSiteSandbox("nb-site-contract-tests operations.test.ts");

/** 钩子的上限：一组里要起几个进程、跑几条命令，慢机器上也够。 */
const SETUP_TIMEOUT_MS = 30_000;

const MODULES = ["identity", "telemetry"];

function events(logs: readonly LogLine[]): unknown[] {
    return logs.map((line) => line.event);
}

function portOf(url: string): number {
    return Number(new URL(url).port);
}

describe("从空的数据目录启动（输出 2、3、4，验收 1，Smoke）", () => {
    let first: SiteProcess;
    let firstReady: unknown;
    let firstLive: JsonResponse;
    let firstExit: number;
    let second: SiteProcess;
    let secondReady: unknown;

    beforeAll(async () => {
        const dataDir = await sandbox.dataDir();
        first = await sandbox.start({dataDir});
        firstReady = await first.ready();
        firstLive = await requestJson(`${first.url}health/live`);
        firstExit = await first.stop();
        second = await sandbox.start({dataDir});
        secondReady = await second.ready();
    }, SETUP_TIMEOUT_MS);

    it("监听日志给出实际地址，就绪检查 200 并逐个写明两个模块已就绪", () => {
        expect(first.logs().find((line) => line.event === "site.listening")?.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/u);
        expect(firstReady).toEqual({status: "ready", modules: {identity: "ready", telemetry: "ready"}});
    });

    it("存活检查 200，响应体是 {status: live}", () => {
        expect({status: firstLive.status, body: firstLive.body}).toEqual({status: 200, body: {status: "live"}});
    });

    it("同一个数据目录再次启动：照常就绪，不重复执行迁移", () => {
        expect(firstExit).toBe(0);
        expect(secondReady).toEqual({status: "ready", modules: {identity: "ready", telemetry: "ready"}});
        expect(events(second.logs())).not.toContain("migration.applied");
    });
});

describe("配置校验（输出 1、10，验收 4）", () => {
    interface Case {
        readonly result: CommandResult;
        readonly port: number;
        readonly listeningAfter: boolean;
        readonly dataDirEntries: readonly string[];
        readonly dataDir: string;
    }
    const REQUIRED = ["NB_SITE_URL", "NB_SITE_TELEMETRY_URL", "NB_SITE_DATA_DIR", "NB_SITE_SESSION_SECRET"] as const;
    const cases = new Map<string, Case>();
    /** 去掉会话密钥那一次另带的测试控制口令：验收 4 的“其它密钥的值”。 */
    const otherSecret = randomSecret();
    /** 特征明显、但太短的会话密钥：在整段输出里搜它。 */
    const shortSecret = "SHORT-SECRET-q7Zx";

    async function runCase(name: string, env: Readonly<Record<string, string | undefined>>): Promise<void> {
        const dataDir = await sandbox.dataDir();
        const port = await reservePort();
        const result = await sandbox.run("serve", {dataDir, env: {...env, NB_SITE_PORT: String(port)}});
        cases.set(name, {result, port, dataDir, listeningAfter: await isListening(port), dataDirEntries: await readdir(dataDir)});
    }

    beforeAll(async () => {
        await Promise.all([
            ...REQUIRED.map((name) => runCase(name, {[name]: undefined, ...(name === "NB_SITE_SESSION_SECRET" ? {NB_SITE_TEST_CONTROL: otherSecret} : {})})),
            runCase("short-secret", {NB_SITE_SESSION_SECRET: shortSecret}),
        ]);
    }, SETUP_TIMEOUT_MS);

    for (const name of REQUIRED) {
        it(`去掉 ${name}：非零退出，标准错误那一行是 config_invalid 并点名它（missing），没监听、没改数据目录`, () => {
            const {result, listeningAfter, dataDirEntries} = cases.get(name)!;
            expect(result.exitCode).not.toBe(0);
            expect(result.failure?.code).toBe("config_invalid");
            expect(result.failure?.problems).toContainEqual({name, problem: "missing"});
            expect(events(result.logs)).not.toContain("site.listening");
            // 进程已经退出，这一条单独证明不了它运行期间没监听；上一行的“没有 site.listening”是主要证据。
            expect(listeningAfter).toBe(false);
            expect(dataDirEntries).toEqual([]);
        });
    }

    it("去掉会话密钥（验收 4）：输出里没有任何变量的取值与数据目录的路径", () => {
        const {result, dataDir} = cases.get("NB_SITE_SESSION_SECRET")!;
        const output = `${result.stdout}\n${result.stderr}`;
        for (const value of [otherSecret, "site.test", "telemetry.test", dataDir]) expect({value, found: output.includes(value)}).toEqual({value, found: false});
    });

    it("会话密钥太短：问题词 too_short，输出里找不到这个值", () => {
        const {result, dataDirEntries} = cases.get("short-secret")!;
        expect(result.exitCode).not.toBe(0);
        expect(result.failure?.code).toBe("config_invalid");
        expect(result.failure?.problems).toContainEqual({name: "NB_SITE_SESSION_SECRET", problem: "too_short"});
        expect(`${result.stdout}\n${result.stderr}`).not.toContain(shortSecret);
        expect(dataDirEntries).toEqual([]);
    });
});

describe("两个启动命令对同一个数据目录（状态与时序，失败码 data_dir_busy）", () => {
    let holder: SiteProcess;
    let secondServe: CommandResult;
    let migrate: CommandResult;

    beforeAll(async () => {
        const dataDir = await sandbox.dataDir();
        holder = await sandbox.start({dataDir});
        // 被测程序没拿锁时第二个 serve 会一直运行下去，`run` 到上限后 SIGKILL 并抛错，这一组随之失败。
        secondServe = await sandbox.run("serve", {dataDir, timeoutMs: 5_000});
        migrate = await sandbox.run("migrate", {dataDir, timeoutMs: 5_000});
    }, SETUP_TIMEOUT_MS);

    it("后到的 serve 非零退出、码是 data_dir_busy，不执行迁移", () => {
        expect(secondServe.exitCode).not.toBe(0);
        expect(secondServe.failure?.code).toBe("data_dir_busy");
        expect(events(secondServe.logs)).not.toContain("migration.applied");
        expect(events(secondServe.logs)).not.toContain("site.listening");
    });

    it("服务在跑时 migrate 同样以 data_dir_busy 退出，服务照常就绪", async () => {
        expect(migrate.exitCode).not.toBe(0);
        expect(migrate.failure?.code).toBe("data_dir_busy");
        expect(holder.exitCode).toBeNull();
        expect((await requestJson(`${holder.url}health/ready`)).status).toBe(200);
    });
});

describe("就绪检查与存活检查（输出 3、4，时序“恢复后回 200，不需要重启”）", () => {
    let site: SiteProcess;
    let dataDir: string;

    beforeAll(async () => {
        dataDir = await sandbox.dataDir();
        site = await sandbox.start({dataDir});
        await site.ready();
    }, SETUP_TIMEOUT_MS);

    // 超出 200 毫秒的预算：Spec 允许同一秒内的多次检查得到同一个结果，持锁之后要等上一次的“就绪”过期才看得到 503，
    // 放锁之后同样要等“没就绪”过期，最多各约 1 秒。
    it("库被进程外占着写锁时回 503 并点名该模块、不含路径；存活检查仍是 200；放锁后回 200，进程没重启", async () => {
        const release = holdWriteLock(dataDir, "identity");
        let notReady: JsonResponse;
        try {
            notReady = await waitUntil("ready answers 503 while identity is locked", async () => {
                const response = await requestJson(`${site.url}health/ready`);
                return response.status === 503 ? response : undefined;
            });
            const live = await requestJson(`${site.url}health/live`);
            expect({status: live.status, body: live.body}).toEqual({status: 200, body: {status: "live"}});
        } finally {
            release();
        }
        // 被进程外的写者占着是 `not_ready`；`transaction_stuck` 只给本进程自己的事务（`site.operations` 输出 4）。
        expect(notReady.body).toEqual({status: "not_ready", code: "not_ready", modules: {identity: "not_ready", telemetry: "ready"}});
        expect(JSON.stringify(notReady.body)).not.toContain(dataDir);

        expect(await site.ready()).toEqual({status: "ready", modules: {identity: "ready", telemetry: "ready"}});
        expect(site.exitCode).toBeNull();
        expect(events(site.logs()).filter((event) => event === "site.listening")).toHaveLength(1);
    }, 10_000);
});

describe("日志与请求编号（输出 8）", () => {
    let site: SiteProcess;

    beforeAll(async () => {
        site = await sandbox.start({dataDir: await sandbox.dataDir()});
    }, SETUP_TIMEOUT_MS);

    it("每个请求一行 http.request：字段齐全、path 不带查询串；请求编号由服务生成，不取请求方给的值，响应头与日志是同一个", async () => {
        const queryValue = "QUERY-TOKEN-r8Kd2";
        const inbound = "inbound-request-id-Zq91";
        const response = await fetch(`${site.url}health/live?token=${queryValue}`, {headers: {"X-Request-Id": inbound}});
        expect(response.status).toBe(200);
        const requestId = response.headers.get("X-Request-Id");
        expect(requestId).toEqual(expect.any(String));
        expect(requestId).not.toBe(inbound);

        const line = await waitUntil("http.request line", () => site.logs().find((candidate) => candidate.event === "http.request" && candidate.requestId === requestId));
        expect(line).toMatchObject({level: "info", event: "http.request", requestId, method: "GET", path: "/health/live", status: 200});
        expect(line.time).toEqual(expect.any(String));
        expect(line.module).toEqual(expect.any(String));
        expect(line.durationMs).toEqual(expect.any(Number));
        expect(site.stdout()).not.toContain(queryValue);
        expect(site.stdout()).not.toContain(inbound);
    });

    it("标准输出的每一行都是带 time、level、event 的 JSON 对象", () => {
        const lines = site.stdout().split("\n").filter((text) => text !== "");
        expect(lines.length).toBeGreaterThan(0);
        expect(site.logs()).toHaveLength(lines.length);
        for (const line of site.logs()) {
            expect({line, fields: [typeof line.time, typeof line.level, typeof line.event]}).toEqual({line, fields: ["string", "string", "string"]});
        }
    });

    it("读不出主机名的请求回 400 bad_request，健康检查也不例外；日志里这一行的 path 为 null", async () => {
        for (const path of ["/health/live", "/health/ready"]) {
            const raw = await rawHttp(site.url, `GET ${path} HTTP/1.0\r\n\r\n`);
            const [head = "", body = ""] = raw.split("\r\n\r\n");
            expect({path, statusLine: head.split("\r\n")[0]}).toEqual({path, statusLine: expect.stringMatching(/^HTTP\/1\.[01] 400 /u)});
            expect(JSON.parse(body)).toEqual({code: "bad_request"});
            const requestId = /^x-request-id: *(.+)$/imu.exec(head)?.[1]?.trim();
            expect(requestId).toEqual(expect.any(String));
            const line = await waitUntil("http.request line of the bad request", () => site.logs().find((candidate) => candidate.event === "http.request" && candidate.requestId === requestId));
            expect(line).toMatchObject({status: 400, path: null});
        }
    });
});

describe("停止（输出 9）", () => {
    let site: SiteProcess;

    beforeAll(async () => {
        site = await sandbox.start({dataDir: await sandbox.dataDir()});
        await site.ready();
    }, SETUP_TIMEOUT_MS);

    it("SIGTERM 后以 0 退出，端口随后连不上", async () => {
        expect(await site.stop()).toBe(0);
        expect(await isListening(portOf(site.url))).toBe(false);
    });
});

describe("备份（输出 6、10，验收 3 的前半，失败码 backup_failed）", () => {
    let serving: SiteProcess;
    let servingDir: string;
    let backup: CommandResult;
    /** 用备份的副本起的服务；没有写出备份时为 undefined。 */
    let restored: SiteProcess | undefined;
    let keepDir: string;
    let keepRuns: CommandResult[];
    let missingDir: string;
    let missing: CommandResult;

    beforeAll(async () => {
        servingDir = await sandbox.dataDir();
        serving = await sandbox.start({dataDir: servingDir});
        await serving.ready();
        backup = await sandbox.run("backup", {dataDir: servingDir});

        // 副本拷进一个新的数据目录，单独起一个服务。没有备份时不起：空目录起的服务同样会就绪，用例会空过。
        const name = listBackups(servingDir)[0];
        if (name !== undefined) {
            const restoredDir = await sandbox.dataDir();
            for (const module of MODULES) await copyFile(join(backupsDir(servingDir), name, `${module}.db`), join(restoredDir, `${module}.db`));
            restored = await sandbox.start({dataDir: restoredDir});
            await restored.ready();
        }

        // 保留份数：服务不必在跑，先迁移出两个库，再连着备份三次。
        keepDir = await sandbox.dataDir();
        const migrated = await sandbox.run("migrate", {dataDir: keepDir});
        if (migrated.exitCode !== 0) throw new Error(`migrate failed: ${migrated.stderr}`);
        keepRuns = [];
        for (let index = 0; index < 3; index += 1) keepRuns.push(await sandbox.run("backup", {dataDir: keepDir, env: {NB_SITE_BACKUP_KEEP: "2"}}));

        missingDir = await sandbox.dataDir();
        missing = await sandbox.run("backup", {dataDir: missingDir});
    }, SETUP_TIMEOUT_MS);

    it("服务运行时备份以 0 退出，日志有一行 backup.done，backups/ 下多了一份以它命名的目录", () => {
        expect(backup.exitCode).toBe(0);
        const done = backup.logs.find((line) => line.event === "backup.done");
        expect(done?.name).toEqual(expect.stringMatching(BACKUP_NAME));
        expect([...(done?.modules as string[])].sort()).toEqual(MODULES);
        expect(listBackups(servingDir)).toEqual([done?.name as string]);
        expect(serving.exitCode).toBeNull();
    });

    it("每个库的副本都能只读打开，quick_check 为 ok", () => {
        const [name] = listBackups(servingDir);
        expect(name).toBeDefined();
        for (const module of MODULES) expect({module, check: quickCheck(join(backupsDir(servingDir), name!, `${module}.db`))}).toEqual({module, check: ["ok"]});
    });

    it("用副本单独起的服务就绪（验收 3 的前半）", async () => {
        expect(restored).toBeDefined();
        expect((await requestJson(`${restored!.url}health/ready`)).body).toEqual({status: "ready", modules: {identity: "ready", telemetry: "ready"}});
    });

    it("保留份数为 2 时连跑三次，只剩最新的两份", () => {
        for (const run of keepRuns) expect(run.exitCode).toBe(0);
        const names = keepRuns.map((run) => run.logs.find((line) => line.event === "backup.done")?.name);
        expect(listBackups(keepDir)).toEqual([names[1] as string, names[2] as string]);
    });

    it("库文件还不存在时以 backup_failed 退出，reason 是 db_missing、带模块名，输出里没有数据目录的路径", () => {
        expect(missing.exitCode).not.toBe(0);
        expect(missing.failure).toMatchObject({code: "backup_failed", reason: "db_missing"});
        expect(MODULES).toContain(missing.failure?.module as string);
        expect(`${missing.stdout}\n${missing.stderr}`).not.toContain(missingDir);
        expect(listBackups(missingDir)).toEqual([]);
    });
});

describe("测试控制入口（输出 11，验收 5）", () => {
    let withoutToken: SiteProcess;
    let withToken: SiteProcess;
    let notLoopback: CommandResult;
    let notLoopbackPort: number;
    let notLoopbackListening: boolean;

    beforeAll(async () => {
        [withoutToken, withToken] = await Promise.all([
            sandbox.start({dataDir: await sandbox.dataDir(), env: {NB_SITE_TEST_CONTROL: undefined}}),
            sandbox.start({dataDir: await sandbox.dataDir()}),
        ]);
        notLoopbackPort = await reservePort();
        notLoopback = await sandbox.run("serve", {dataDir: await sandbox.dataDir(), env: {NB_SITE_TEST_CONTROL: randomSecret(), NB_SITE_HOST: "0.0.0.0", NB_SITE_PORT: String(notLoopbackPort)}});
        notLoopbackListening = await isListening(notLoopbackPort);
    }, SETUP_TIMEOUT_MS);

    /** 同一个进程上一个不存在的地址的回应：两个地址“不存在”时要与它一样。 */
    async function missingAddress(site: SiteProcess): Promise<{status: number; body: unknown}> {
        const {status, body} = await requestJson(`${site.url}no-such-address`, {method: "POST"});
        return {status, body};
    }

    it("没设口令时两个地址与别的不存在的地址一样回 404，带了口令也一样", async () => {
        const missingResponse = await missingAddress(withoutToken);
        expect(missingResponse.status).toBe(404);
        for (const token of [null, randomSecret()]) {
            for (const [path, body] of [["clock", {advanceMs: 1_000}], ["jobs/run", {module: "identity", job: "any"}]] as const) {
                const {status, body: responseBody} = await testControlRequest(withoutToken.url, path, body, token);
                expect({path, token, result: {status, body: responseBody}}).toEqual({path, token, result: missingResponse});
            }
        }
    });

    it("设了口令：启动日志有一行 warn 的 site.test_control_enabled；不带或带错口令时回 404，与别的不存在的地址相同", async () => {
        expect(withToken.logs().find((line) => line.event === "site.test_control_enabled")).toMatchObject({level: "warn"});
        const missingResponse = await missingAddress(withToken);
        expect(missingResponse.status).toBe(404);
        for (const token of [null, randomSecret(), `${withToken.testControlToken!}x`]) {
            for (const [path, body] of [["clock", {advanceMs: 1_000}], ["jobs/run", {module: "identity", job: "any"}]] as const) {
                const {status, body: responseBody} = await testControlRequest(withToken.url, path, body, token);
                expect({path, token, result: {status, body: responseBody}}).toEqual({path, token, result: missingResponse});
            }
        }
    });

    it("带对口令拨时间：now 往前走了这么多，两次累加", async () => {
        const hour = 3_600_000;
        const minute = 60_000;
        const before = Date.now();
        const first = await withToken.advanceClock(hour);
        const between = Date.now();
        expect(first).toBeGreaterThanOrEqual(before + hour);
        expect(first).toBeLessThanOrEqual(between + hour);
        const second = await withToken.advanceClock(minute);
        const after = Date.now();
        expect(second).toBeGreaterThanOrEqual(between + hour + minute);
        expect(second).toBeLessThanOrEqual(after + hour + minute);
    });

    it("没有这个模块或任务时回 404 not_found", async () => {
        for (const [module, job] of [["no-such-module", "any"], ["identity", "no-such-job"], ["telemetry", "no-such-job"]] as const) {
            const {status, body} = await withToken.runJob(module, job);
            expect({module, job, status, body}).toEqual({module, job, status: 404, body: {code: "not_found"}});
        }
    });

    it("设了口令而监听 0.0.0.0：以 config_invalid 退出，问题词 not_loopback 记在监听地址上，端口连不上", () => {
        expect(notLoopback.exitCode).not.toBe(0);
        expect(notLoopback.failure?.code).toBe("config_invalid");
        expect(notLoopback.failure?.problems).toContainEqual({name: "NB_SITE_HOST", problem: "not_loopback"});
        expect(events(notLoopback.logs)).not.toContain("site.listening");
        expect(notLoopbackListening).toBe(false);
    });
});
