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
 * - 创建管理员（输出 5）的“被封的被解封”：要先经管理接口封禁，在 `admin.test.ts` 的账号处置一组。验收 3 的
 *   “原始上报表是空的”在 `telemetry-ingest.test.ts` 的 C16；验收 2 见 `adjacent-version.test.ts`。
 *
 * 权限类的用例在 root 下跳过：root 不受权限位限制，造不出那种失败。
 */

import {beforeAll, describe, expect, it} from "bun:test";
import {chmod, copyFile, mkdir, readdir, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import {IDENTITY_PATHS} from "@notnotype/nb-site-identity-contract";

import {backupsDir, BACKUP_NAME, listBackups, quickCheck} from "./testing/backup";
import {holdWriteLock} from "./testing/fault";
import {cookieJar, createAdmin, IDENTITY_SITE_ENV, identityRequest, login} from "./testing/identity";
import {
    isListening,
    randomSecret,
    rawHttp,
    requestJson,
    REQUEST_TIMEOUT_MS,
    reservePort,
    SANDBOX_TELEMETRY_URL,
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

const IS_ROOT = process.getuid?.() === 0;

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

    it("第一次启动对每个模块执行迁移：每执行一条一行 migration.applied，带模块名与迁移名", () => {
        const applied = first.logs().filter((line) => line.event === "migration.applied");
        // 迁移的名字与条数属于实现，这里只要求每个模块至少一条、每条带名字、同一条不记两次；下一条用例的“不重复执行”靠它才不空过。
        for (const module of MODULES) {
            const names = applied.filter((line) => line.module === module).map((line) => line.migration);
            expect({module, applied: names.length > 0, named: names.every((name) => typeof name === "string" && name !== "")}).toEqual({module, applied: true, named: true});
        }
        expect(applied.every((line) => MODULES.includes(line.module as string))).toBe(true);
        const pairs = applied.map((line) => `${String(line.module)}/${String(line.migration)}`);
        expect(new Set(pairs).size).toBe(pairs.length);
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
    const REQUIRED = ["NB_SITE_URL", "NB_SITE_TELEMETRY_URL", "NB_SITE_DATA_DIR", "NB_SITE_SESSION_SECRET", "NB_SITE_IDENTITY_TERMS_VERSION"] as const;
    const cases = new Map<string, Case>();
    /** 去掉会话密钥那一次另带的测试控制口令：验收 4 的“其它密钥的值”。 */
    const otherSecret = randomSecret();
    /** 特征明显、但太短的会话密钥：在整段输出里搜它。 */
    const shortSecret = "SHORT-SECRET-q7Zx";
    /** 库自己从环境读的会话密钥表（`BETTER_AUTH_SECRETS`）里的值：在整段输出里搜它。 */
    const librarySecret = randomSecret();

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
            runCase("library-env", {BETTER_AUTH_SECRETS: `1:${librarySecret}`, BETTER_AUTH_TELEMETRY: "true"}),
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

    it("进程环境里有以 BETTER_AUTH_ 开头的变量：config_invalid，问题词 not_allowed 记在各自的变量名上，输出里没有取值，没改数据目录", () => {
        const {result, dataDirEntries} = cases.get("library-env")!;
        expect(result.exitCode).not.toBe(0);
        expect(result.failure?.code).toBe("config_invalid");
        expect(result.failure?.problems).toContainEqual({name: "BETTER_AUTH_SECRETS", problem: "not_allowed"});
        expect(result.failure?.problems).toContainEqual({name: "BETTER_AUTH_TELEMETRY", problem: "not_allowed"});
        expect(`${result.stdout}\n${result.stderr}`).not.toContain(librarySecret);
        expect(events(result.logs)).not.toContain("site.listening");
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
        expect(line.module).toBe("site");
        expect(line.durationMs).toEqual(expect.any(Number));
        expect(site.stdout()).not.toContain(queryValue);
        expect(site.stdout()).not.toContain(inbound);
    });

    it("就绪检查与测试控制入口的请求不归哪个模块：日志里 module 是 site", async () => {
        const ready = await requestJson(`${site.url}health/ready`);
        const control = await testControlRequest(site.url, "clock", {advanceMs: 1_000}, site.testControlToken);
        for (const [what, response] of [["ready", ready], ["test-control", control]] as const) {
            expect({what, status: response.status}).toEqual({what, status: 200});
            const requestId = response.headers.get("X-Request-Id");
            const line = await waitUntil(`http.request line of ${what}`, () => site.logs().find((candidate) => candidate.event === "http.request" && candidate.requestId === requestId));
            expect({what, module: line.module}).toEqual({what, module: "site"});
        }
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
    /** 备份之前建的账号；在副本起的服务上用它登录。 */
    const KEEPER_PASSWORD = "keeper-PW-w6Gd13";
    let keeperId: number;
    let unreadableDir: string;
    /** 库文件没有读权限时的备份；以 root 运行时不跑。 */
    let unreadable: CommandResult | undefined;

    beforeAll(async () => {
        servingDir = await sandbox.dataDir();
        serving = await sandbox.start({dataDir: servingDir});
        await serving.ready();
        keeperId = await createAdmin(sandbox, servingDir, ["keeper"], KEEPER_PASSWORD);
        backup = await sandbox.run("backup", {dataDir: servingDir});

        // 副本拷进一个新的数据目录，单独起一个服务。没有备份时不起：空目录起的服务同样会就绪，用例会空过。
        const name = listBackups(servingDir)[0];
        if (name !== undefined) {
            const restoredDir = await sandbox.dataDir();
            for (const module of MODULES) await copyFile(join(backupsDir(servingDir), name, `${module}.db`), join(restoredDir, `${module}.db`));
            restored = await sandbox.start({dataDir: restoredDir, env: IDENTITY_SITE_ENV});
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

        unreadableDir = await sandbox.dataDir();
        if (!IS_ROOT) {
            const prepared = await sandbox.run("migrate", {dataDir: unreadableDir});
            if (prepared.exitCode !== 0) throw new Error(`migrate failed: ${prepared.stderr}`);
            await chmod(join(unreadableDir, "identity.db"), 0o000);
            unreadable = await sandbox.run("backup", {dataDir: unreadableDir});
        }
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

    it("备份之前建的账号在副本起的服务上能登录（验收 3）", async () => {
        expect(restored).toBeDefined();
        const response = await login(restored!.url, "keeper", KEEPER_PASSWORD, {from: "203.0.113.7"});
        expect({status: response.status, body: response.body}).toEqual({status: 200, body: {user: expect.objectContaining({id: keeperId, username: "keeper", role: "admin"})}});
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

    it.skipIf(IS_ROOT)("库文件没有读权限时以 backup_failed 退出，reason 是 db_unreadable、带模块名，不留下备份（以 root 运行时跳过）", () => {
        expect(unreadable?.exitCode).not.toBe(0);
        expect(unreadable?.failure).toMatchObject({code: "backup_failed", reason: "db_unreadable", module: "identity"});
        expect(`${unreadable?.stdout}\n${unreadable?.stderr}`).not.toContain(unreadableDir);
        expect(listBackups(unreadableDir)).toEqual([]);
    });
});

describe("库文件用不了（失败码 data_dir_unusable）", () => {
    interface Case {
        readonly dataDir: string;
        readonly migrate: CommandResult;
        readonly serve: CommandResult;
    }
    const cases = new Map<string, Case>();

    async function runBoth(name: string, dataDir: string): Promise<void> {
        // 被测程序把它当成能用的库而照常启动时，`run` 到上限后 SIGKILL 并抛错，这一组随之失败。
        const migrate = await sandbox.run("migrate", {dataDir, timeoutMs: 5_000});
        const serve = await sandbox.run("serve", {dataDir, timeoutMs: 5_000});
        cases.set(name, {dataDir, migrate, serve});
    }

    beforeAll(async () => {
        const directory = await sandbox.dataDir();
        await mkdir(join(directory, "identity.db"));
        await runBoth("directory", directory);
        if (!IS_ROOT) {
            // 先迁移出两个能用的库，再拿掉账号库的权限：部署的人改错了属主或权限的样子。
            const noAccess = await sandbox.dataDir();
            const prepared = await sandbox.run("migrate", {dataDir: noAccess});
            if (prepared.exitCode !== 0) throw new Error(`migrate failed: ${prepared.stderr}`);
            await chmod(join(noAccess, "identity.db"), 0o000);
            await runBoth("no-access", noAccess);
        }
    }, SETUP_TIMEOUT_MS);

    function expectUnusable(name: string): void {
        const {dataDir, migrate, serve} = cases.get(name)!;
        for (const [command, result] of [["migrate", migrate], ["serve", serve]] as const) {
            expect({command, exitCode: result.exitCode === 0 ? 0 : "non-zero"}).toEqual({command, exitCode: "non-zero"});
            expect({command, failure: result.failure}).toMatchObject({command, failure: {code: "data_dir_unusable", module: "identity"}});
            expect({command, applied: result.logs.some((line) => line.event === "migration.applied" && line.module === "identity")}).toEqual({command, applied: false});
            expect({command, listening: events(result.logs).includes("site.listening")}).toEqual({command, listening: false});
            expect({command, leaked: `${result.stdout}\n${result.stderr}`.includes(dataDir)}).toEqual({command, leaked: false});
        }
    }

    it("账号库的库文件是个目录：migrate 与 serve 都以 data_dir_unusable 退出，带模块名，不执行它的迁移、不监听、输出里没有路径", () => {
        expectUnusable("directory");
    });

    it.skipIf(IS_ROOT)("账号库的库文件没有权限：同样以 data_dir_unusable 退出（以 root 运行时跳过）", () => {
        expectUnusable("no-access");
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

describe("网页（输出 12，验收 6）", () => {
    /** 测试自己造的一份产物：合同测试不依赖前端包，只看被测程序怎样发这个目录里的东西。 */
    const INDEX_HTML = '<!doctype html><html><head><script type="module" src="/assets/app-abc123.js"></script></head><body></body></html>\n';
    const APP_JS = "document.title = 'contract';\n";
    const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";
    let withWeb: SiteProcess;
    let withoutWeb: SiteProcess;

    beforeAll(async () => {
        const webDir = join(sandbox.root, "web");
        await mkdir(join(webDir, "assets"), {recursive: true});
        await writeFile(join(webDir, "index.html"), INDEX_HTML);
        await writeFile(join(webDir, "assets", "app-abc123.js"), APP_JS);
        // 产物目录的上一层放一个 package.json：`/..%2fpackage.json` 要是越出了目录，读到的就是它。
        await writeFile(join(sandbox.root, "package.json"), '{"name":"outside-the-web-dir"}\n');
        // 都不设测试控制口令：验收 6 要的是“没设口令时”的 /test-control/clock。
        [withWeb, withoutWeb] = await Promise.all([
            sandbox.start({dataDir: await sandbox.dataDir(), env: {NB_SITE_WEB_DIR: webDir, NB_SITE_TEST_CONTROL: undefined}}),
            sandbox.start({dataDir: await sandbox.dataDir(), env: {NB_SITE_TEST_CONTROL: undefined}}),
        ]);
    }, SETUP_TIMEOUT_MS);

    async function page(site: SiteProcess, path: string, headers?: Record<string, string>): Promise<{status: number; headers: Headers; body: string}> {
        const response = await fetch(`${site.url}${path.slice(1)}`, {redirect: "manual", headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)});
        return {status: response.status, headers: response.headers, body: await response.text()};
    }

    it("/ 与 /account 回 index.html 的内容与安全头", async () => {
        for (const path of ["/", "/account"]) {
            const got = await page(withWeb, path);
            expect({
                path,
                status: got.status,
                body: got.body,
                csp: got.headers.get("Content-Security-Policy"),
                nosniff: got.headers.get("X-Content-Type-Options"),
                referrer: got.headers.get("Referrer-Policy"),
                cache: got.headers.get("Cache-Control"),
            }).toEqual({path, status: 200, body: INDEX_HTML, csp: CSP, nosniff: "nosniff", referrer: "same-origin", cache: "no-cache"});
        }
    });

    it("/assets/ 下的文件带长缓存头", async () => {
        const got = await page(withWeb, "/assets/app-abc123.js");
        expect({status: got.status, body: got.body, cache: got.headers.get("Cache-Control")}).toEqual({status: 200, body: APP_JS, cache: "public, max-age=31536000, immutable"});
    });

    it("/api/identity/v1/nope、/api/identity/nope、/.well-known/nope、没设口令时的 /test-control/clock 与 /x.js 回 404", async () => {
        // /api/identity/v1/nope 由身份库自己的兜底路由回 404，网页回退即使不排除 /api/ 也到不了它；
        // /api/identity/nope 不在身份库的任何挂载点下，只有排除了 /api/ 才回 404。
        for (const path of ["/api/identity/v1/nope", "/api/identity/nope", "/.well-known/nope", "/test-control/clock", "/x.js"]) {
            expect({path, status: (await page(withWeb, path)).status}).toEqual({path, status: 404});
        }
    });

    it("/..%2fpackage.json 这类路径回 404，读不到产物目录外的文件", async () => {
        for (const path of ["/..%2fpackage.json", "/assets/..%2f..%2fpackage.json", "/%2e%2e%2fpackage.json"]) {
            const got = await page(withWeb, path);
            expect({path, status: got.status, leaked: got.body.includes("outside-the-web-dir")}).toEqual({path, status: 404, leaked: false});
        }
    });

    it("遥测写入口的主机名上 / 回 404", async () => {
        expect((await page(withWeb, "/", {Host: new URL(SANDBOX_TELEMETRY_URL).host})).status).toBe(404);
    });

    it("不设前端产物目录时 / 回 404", async () => {
        expect((await page(withoutWeb, "/")).status).toBe(404);
    });
});

describe("创建管理员（输出 5，失败码 invalid_argument、email_taken、interrupted）", () => {
    // 每个密码都带一段特征明显的文字，在全部输出里搜它们：密码不写进日志（输出 5）。
    const PASSWORDS = {
        first: "first-PW-q7Zx81",
        reset: "reset-PW-b3Kw90",
        running: "running-PW-m2Jd47",
        runningReset: "running-reset-PW-h5Qa20",
        carol: "carol-PW-t5Ns63",
        interrupted: "sigterm-PW-v8Lc12",
        interruptedReset: "sigterm-reset-PW-j7Wn36",
        interruptedLocked: "sigterm-locked-PW-r4Hm05",
    };
    const runs: CommandResult[] = [];
    const results = new Map<string, CommandResult>();
    let alongsideService: {created: CommandResult; reset: CommandResult; readyAfter: number; stopCode: number};
    /** 那个服务停下以后的整段输出：登录时收到的密码同样不能写进去。 */
    let serviceOutput = "";
    /** 服务在运行时建、重置、被打断的重置前后，经 HTTP 看到的结果（只记响应，断言在用例里）。 */
    let signIns: {
        readonly firstLogin: JsonResponse;
        readonly oldCookieBeforeReset: JsonResponse;
        readonly oldCookieAfterReset: JsonResponse;
        readonly oldPasswordAfterReset: JsonResponse;
        readonly newPasswordAfterReset: JsonResponse;
        readonly interruptedReset: CommandResult;
        readonly keptPasswordAfterInterrupt: JsonResponse;
        readonly interruptedPasswordAfterInterrupt: JsonResponse;
        readonly gatedBeforeConsent: JsonResponse;
        readonly consent: JsonResponse;
        readonly gatedAfterConsent: JsonResponse;
    };
    let interrupted: {readonly signal: NodeJS.Signals; readonly result: CommandResult; readonly retry: CommandResult}[];
    let interruptedLocked: {readonly result: CommandResult; readonly retry: CommandResult};

    async function createAdmin(name: string, dataDir: string, args: readonly string[], stdin: string): Promise<CommandResult> {
        const result = await sandbox.run("create-admin", {dataDir, args, stdin});
        runs.push(result);
        results.set(name, result);
        return result;
    }

    /** 停在等密码的地方时发 `signal`；之后用同一个用户名再建一次，看前一次有没有留下账号。 */
    async function interruptAtPassword(dataDir: string, username: string, signal: NodeJS.Signals) {
        const child = sandbox.spawnWithOpenStdin("create-admin", {dataDir, args: [username]});
        // 被测程序等密码时在标准错误写一行提示；Spec 没规定提示，这里只等“写了一行”，用它确认已经停在读标准输入的地方（迁移做完、
        // 参数校验过了）。没有提示的实现会在这里超时。
        await child.waitForStderr("the password prompt", (line) => line !== "");
        // 写了密码、没关标准输入：命令还在等读到结尾。
        await child.write(`${PASSWORDS.interrupted}\n`);
        child.kill(signal);
        const result = await child.result();
        runs.push(result);
        const retry = await createAdmin(`retry-${signal}`, dataDir, [username], `${PASSWORDS.interrupted}\n`);
        return {signal, result, retry};
    }

    /**
     * 账号库被别的进程占着写锁时给了密码（关掉标准输入），随即发 `SIGTERM`，发完才放锁；之后同名再建一次，看前一次有没有留下账号。
     * 信号落在读密码、算哈希还是等写锁的哪一步不由这里控制：Spec 对这几步的要求相同，都不改账号、以 `interrupted` 结束。
     * 落在等写锁时，等锁若是同步的（信号处理函数跑不了），锁一放开事务就提交（omp 实现审查第 2 条）。
     */
    async function interruptWhileLocked(dataDir: string, username: string) {
        const release = holdWriteLock(dataDir, "identity");
        let result: CommandResult;
        try {
            const child = sandbox.spawnWithOpenStdin("create-admin", {dataDir, args: [username]});
            await child.waitForStderr("the password prompt", (line) => line !== "");
            await child.write(`${PASSWORDS.interruptedLocked}\n`);
            await child.closeStdin();
            child.kill("SIGTERM");
            release();
            result = await child.result();
        } finally {
            release();
        }
        runs.push(result);
        const retry = await createAdmin("retry-locked", dataDir, [username], `${PASSWORDS.interruptedLocked}\n`);
        return {result, retry};
    }

    beforeAll(async () => {
        // 服务没在运行：空的数据目录，命令自己先执行迁移。
        const dataDir = await sandbox.dataDir();
        await createAdmin("created", dataDir, ["Root"], `${PASSWORDS.first}\n`);
        await createAdmin("reset", dataDir, ["ROOT", "root@example.com"], `${PASSWORDS.reset}\n`);
        await createAdmin("carol", dataDir, ["carol", "Carol@Example.com"], `${PASSWORDS.carol}\n`);
        // 迁移做完以后几个命令可以同时跑：它们对库是排队写。
        await Promise.all([
            createAdmin("username-empty", dataDir, [""], `${PASSWORDS.first}\n`),
            createAdmin("username-short", dataDir, ["ab"], `${PASSWORDS.first}\n`),
            // 开尔文符号 U+212A 转小写后是 k：先判原始输入（`site.accounts` 字段规则）。
            createAdmin("username-kelvin", dataDir, ["Kelvin"], `${PASSWORDS.first}\n`),
            createAdmin("email-invalid", dataDir, ["dave", "not-an-email"], `${PASSWORDS.first}\n`),
            createAdmin("email-placeholder", dataDir, ["dave", "dave@site.invalid"], `${PASSWORDS.first}\n`),
            createAdmin("email-taken", dataDir, ["dave", "CAROL@example.com"], `${PASSWORDS.first}\n`),
            createAdmin("password-empty", dataDir, ["dave"], ""),
            createAdmin("password-short", dataDir, ["dave"], "short\n"),
            createAdmin("password-long", dataDir, ["dave"], `${"a".repeat(129)}\n`),
            // 管道里只去掉末尾一个换行，中间的换行与终端里一样不收；对已存在的账号也不重置成网页上输不进去的密码。
            createAdmin("password-two-lines", dataDir, ["root"], "line1-PW-k4Rv58\nline2-PW-k4Rv58\n"),
        ]);
        // 已存在的账号给了别人占着的邮箱：邮箱被忽略，不报 email_taken。
        await createAdmin("reset-taken-email", dataDir, ["root", "carol@example.com"], `${PASSWORDS.reset}\n`);
        interrupted = [await interruptAtPassword(dataDir, "sigterm_user", "SIGTERM"), await interruptAtPassword(dataDir, "sigint_user", "SIGINT")];
        interruptedLocked = await interruptWhileLocked(dataDir, "locked_user");

        // 服务在运行：命令与服务同时开着同一个库。每个请求一个来源地址，限流互不影响。
        const running = await sandbox.dataDir();
        const site = await sandbox.start({dataDir: running, env: IDENTITY_SITE_ENV});
        await site.ready();
        let address = 0;
        const from = () => `203.0.113.${String(++address)}`;
        const whoami = (cookie: string) => identityRequest(site.url, IDENTITY_PATHS.whoami, {from: from(), headers: {Cookie: cookie}});
        const created = await createAdmin("running-created", running, ["admin"], `${PASSWORDS.running}\n`);
        const firstJar = cookieJar();
        const firstLogin = await login(site.url, "admin", PASSWORDS.running, {from: from(), jar: firstJar});
        const oldCookie = firstJar.header() ?? "";
        const oldCookieBeforeReset = await whoami(oldCookie);
        const reset = await createAdmin("running-reset", running, ["admin"], `${PASSWORDS.runningReset}\n`);
        const oldCookieAfterReset = await whoami(oldCookie);
        const oldPasswordAfterReset = await login(site.url, "admin", PASSWORDS.running, {from: from()});
        const jar = cookieJar();
        const newPasswordAfterReset = await login(site.url, "admin", PASSWORDS.runningReset, {from: from(), jar});

        // 重置停在等密码的地方被 SIGTERM 打断：密码还是上一次重置的那个。
        const child = sandbox.spawnWithOpenStdin("create-admin", {dataDir: running, args: ["admin"]});
        await child.waitForStderr("the password prompt", (line) => line !== "");
        await child.write(`${PASSWORDS.interruptedReset}\n`);
        child.kill("SIGTERM");
        const interruptedReset = await child.result();
        runs.push(interruptedReset);
        const keptPasswordAfterInterrupt = await login(site.url, "admin", PASSWORDS.runningReset, {from: from()});
        const interruptedPasswordAfterInterrupt = await login(site.url, "admin", PASSWORDS.interruptedReset, {from: from()});

        // 新建的管理员没有同意记录：会话先被同意门槛挡住，补交之后放行（旧密码故意给错，放行后得 invalid_credentials，不改密码）。
        const gated = () => identityRequest(site.url, IDENTITY_PATHS.mePassword, {method: "POST", from: from(), jar, body: {currentPassword: "wrong-PW-000000", newPassword: "unused-PW-c6Ty41"}});
        const gatedBeforeConsent = await gated();
        const consent = await identityRequest(site.url, IDENTITY_PATHS.meConsent, {method: "POST", from: from(), jar, body: {termsVersion: "2026-11-20", overseasStorage: true}});
        const gatedAfterConsent = await gated();
        signIns = {
            firstLogin,
            oldCookieBeforeReset,
            oldCookieAfterReset,
            oldPasswordAfterReset,
            newPasswordAfterReset,
            interruptedReset,
            keptPasswordAfterInterrupt,
            interruptedPasswordAfterInterrupt,
            gatedBeforeConsent,
            consent,
            gatedAfterConsent,
        };

        const readyAfter = (await requestJson(`${site.url}health/ready`)).status;
        alongsideService = {created, reset, readyAfter, stopCode: await site.stop()};
        serviceOutput = `${site.stdout()}\n${site.stderr()}`;
    }, SETUP_TIMEOUT_MS);

    function upserted(result: CommandResult): LogLine[] {
        return result.logs.filter((line) => line.event === "identity.admin_upserted");
    }

    it("用户名不存在时新建：0 退出，标准输出一行 identity.admin_upserted，带账号 id 与 created: true", () => {
        const result = results.get("created")!;
        expect(result.exitCode).toBe(0);
        expect(upserted(result)).toHaveLength(1);
        expect(upserted(result)[0]).toMatchObject({userId: expect.any(Number), created: true});
    });

    it("已存在时（用户名不分大小写）重置：同一个账号 id，created: false", () => {
        const created = upserted(results.get("created")!)[0]!;
        for (const name of ["reset", "reset-taken-email"]) {
            const result = results.get(name)!;
            expect({name, exitCode: result.exitCode, lines: upserted(result)}).toEqual({name, exitCode: 0, lines: [expect.objectContaining({userId: created.userId, created: false})]});
        }
    });

    it("服务在运行时照样能建、能重置，服务照常就绪、以 0 停止", () => {
        const {created, reset, readyAfter, stopCode} = alongsideService;
        expect(created.exitCode).toBe(0);
        expect(upserted(created)).toEqual([expect.objectContaining({userId: expect.any(Number), created: true})]);
        expect(reset.exitCode).toBe(0);
        expect(upserted(reset)).toEqual([expect.objectContaining({userId: upserted(created)[0]!.userId, created: false})]);
        expect(readyAfter).toBe(200);
        expect(stopCode).toBe(0);
    });

    const invalid: readonly [string, "username" | "email" | "password", "missing" | "invalid"][] = [
        ["username-empty", "username", "missing"],
        ["username-short", "username", "invalid"],
        ["username-kelvin", "username", "invalid"],
        ["email-invalid", "email", "invalid"],
        ["email-placeholder", "email", "invalid"],
        ["password-empty", "password", "missing"],
        ["password-short", "password", "invalid"],
        ["password-long", "password", "invalid"],
        ["password-two-lines", "password", "invalid"],
    ];
    for (const [name, field, problem] of invalid) {
        it(`不合规则（${name}）：非零退出，标准错误那一行是 invalid_argument，name 是 ${field}、problem 是 ${problem}`, () => {
            const result = results.get(name)!;
            expect(result.exitCode).not.toBe(0);
            expect(result.failure).toMatchObject({code: "invalid_argument", name: field, problem});
            expect(upserted(result)).toEqual([]);
        });
    }

    it("新建时邮箱已被别的账号用（不分大小写）：email_taken，没有建", () => {
        const result = results.get("email-taken")!;
        expect(result.exitCode).not.toBe(0);
        expect(result.failure?.code).toBe("email_taken");
        expect(upserted(result)).toEqual([]);
    });

    it("停在等密码的地方收到 SIGTERM 或 SIGINT：非零退出、码是 interrupted，没有建账号（之后同名再建是新建）", () => {
        expect(interrupted).toHaveLength(2);
        for (const {signal, result, retry} of interrupted) {
            expect({signal, exitCode: result.exitCode === 0 ? 0 : "non-zero", code: result.failure?.code, lines: upserted(result)}).toEqual({signal, exitCode: "non-zero", code: "interrupted", lines: []});
            expect({signal, retry: upserted(retry)}).toEqual({signal, retry: [expect.objectContaining({created: true})]});
        }
    });

    it("账号库被别的进程占着写锁时给了密码、随即收到 SIGTERM：非零退出、码是 interrupted，放锁后没有建账号（之后同名再建是新建）", () => {
        const {result, retry} = interruptedLocked;
        expect({exitCode: result.exitCode === 0 ? 0 : "non-zero", code: result.failure?.code, lines: upserted(result)}).toEqual({exitCode: "non-zero", code: "interrupted", lines: []});
        expect(upserted(retry)).toEqual([expect.objectContaining({created: true})]);
    });

    it("新建的管理员能用它的密码登录，角色是 admin", () => {
        const userId = upserted(alongsideService.created)[0]!.userId;
        expect({status: signIns.firstLogin.status, body: signIns.firstLogin.body}).toEqual({status: 200, body: {user: expect.objectContaining({id: userId, username: "admin", role: "admin"})}});
        expect(signIns.oldCookieBeforeReset.body).toEqual({state: "authenticated", user: {id: userId, username: "admin", role: "admin"}});
    });

    it("重置之后：重置前的 Cookie 失效，旧密码得 invalid_credentials，新密码能登录、角色是 admin", () => {
        expect(signIns.oldCookieAfterReset.body).toEqual({state: "anonymous"});
        expect({status: signIns.oldPasswordAfterReset.status, body: signIns.oldPasswordAfterReset.body}).toEqual({status: 401, body: {error: {code: "invalid_credentials"}}});
        expect({status: signIns.newPasswordAfterReset.status, body: signIns.newPasswordAfterReset.body}).toEqual({status: 200, body: {user: expect.objectContaining({username: "admin", role: "admin"})}});
    });

    it("重置停在等密码的地方被 SIGTERM 打断：interrupted，密码没换，上一个密码照常登录", () => {
        expect({exitCode: signIns.interruptedReset.exitCode === 0 ? 0 : "non-zero", code: signIns.interruptedReset.failure?.code, lines: upserted(signIns.interruptedReset)}).toEqual({exitCode: "non-zero", code: "interrupted", lines: []});
        expect(signIns.keptPasswordAfterInterrupt.status).toBe(200);
        expect({status: signIns.interruptedPasswordAfterInterrupt.status, body: signIns.interruptedPasswordAfterInterrupt.body}).toEqual({status: 401, body: {error: {code: "invalid_credentials"}}});
    });

    it("新建的管理员登录后先被同意门槛挡住（consent_required），补交同意后放行", () => {
        expect({status: signIns.gatedBeforeConsent.status, body: signIns.gatedBeforeConsent.body}).toEqual({status: 403, body: {error: {code: "consent_required"}}});
        expect(signIns.consent.status).toBe(200);
        expect(signIns.consent.body).toMatchObject({username: "admin", consentRequired: false});
        expect({status: signIns.gatedAfterConsent.status, body: signIns.gatedAfterConsent.body}).toEqual({status: 401, body: {error: {code: "invalid_credentials"}}});
    });

    it("密码不出现在任何一次的标准输出与标准错误里，也不在收到登录请求的服务的输出里", () => {
        const output = [...runs.map((result) => `${result.stdout}\n${result.stderr}`), serviceOutput].join("\n");
        for (const password of Object.values(PASSWORDS)) expect({password, found: output.includes(password)}).toEqual({password, found: false});
    });
});
