/**
 * `nb-site migrate` 与模块的子命令（`site.operations` 的时序一节；`SiteCommand` 的两种占用方式），起真子进程。
 * 夹具模块 `alpha` 提供 `alpha-exclusive` 与 `alpha-shared` 两个命令（`testing/modules.ts`）。
 *
 * 每个用例起一到两个 Bun 进程，超出快速类 200 毫秒的预算，理由同 `serve.test.ts`。
 */

import {Database} from "bun:sqlite";
import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {randomBytes} from "node:crypto";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {tryLock, type FileLock} from "@notnotype/nb-flock";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {MAIN_SCRIPT, startServing, startSite, stopAllSiteProcesses, type LogLine, type SiteProcess} from "./testing/process";

let root: string;
let dataDir: string;
const held: FileLock[] = [];

beforeEach(async () => {
    root = await createTestTmpRoot("nb-site-commands", "nb-site-server commands.test.ts");
    dataDir = join(root, "data");
    await mkdir(dataDir);
});

afterEach(async () => {
    await stopAllSiteProcesses();
    for (const lock of held.splice(0)) lock.release();
    await rm(root, {recursive: true, force: true});
});

function env(extra: Readonly<Record<string, string>> = {}): Record<string, string> {
    return {
        NB_SITE_URL: "https://site.example",
        NB_SITE_TELEMETRY_URL: "https://ingest.example",
        NB_SITE_DATA_DIR: dataDir,
        NB_SITE_PORT: "0",
        NB_SITE_FIXTURE: "alpha,beta",
        ...extra,
    };
}

async function run(args: readonly string[], extra?: Readonly<Record<string, string>>): Promise<{readonly site: SiteProcess; readonly code: number}> {
    const site = await startSite({root, args, env: env(extra)});
    return {site, code: await site.waitForExit()};
}

function failureLine(site: SiteProcess): LogLine {
    return JSON.parse(site.stderr.at(-1) ?? "null") as LogLine;
}

function applied(site: SiteProcess): LogLine[] {
    return site.logs().filter((line) => line.event === "migration.applied");
}

function labels(): string[] {
    const db = new Database(join(dataDir, "alpha.db"), {readonly: true});
    try {
        return db
            .query<{label: string}, []>(`SELECT "label" FROM "item" ORDER BY "id"`)
            .all()
            .map((row) => row.label);
    } finally {
        db.close();
    }
}

describe("migrate", () => {
    it("对每个模块执行还没执行的迁移后以 0 退出，再执行一次什么都不做", async () => {
        const first = await run(["migrate"]);
        expect(first.code).toBe(0);
        expect(applied(first.site)).toMatchObject([
            {module: "alpha", migration: "0001_items"},
            {module: "beta", migration: "0001_beta"},
        ]);
        const second = await run(["migrate"]);
        expect(second.code).toBe(0);
        expect(applied(second.site)).toEqual([]);
    });

    it("服务在跑时以 data_dir_busy 退出", async () => {
        await startServing({root, env: env()});
        const {site, code} = await run(["migrate"]);
        expect(code).toBe(1);
        expect(failureLine(site)).toMatchObject({code: "data_dir_busy", module: "alpha"});
    });

    it("进程里没有模块用到写入口时不要求写入口地址", async () => {
        // beta 只声明站点入口（拆成两个进程后只装账号模块的那个进程就是这样）。
        const {code} = await run(["migrate"], {NB_SITE_FIXTURE: "beta", NB_SITE_TELEMETRY_URL: ""});
        expect(code).toBe(0);
    });

    it("迁移开始之前收到的 SIGTERM：一条迁移也不执行，以 0 退出、标准错误为空", async () => {
        const site = await startSite({root, args: ["migrate"], env: env({NB_SITE_ALPHA_WAIT: "parse"})});
        await site.waitForLog("blocked in parseConfig", (line) => line.event === "fixture.waiting_stdin");
        site.signal("SIGTERM");
        site.writeStdin("go\n");
        expect(await site.waitForExit()).toBe(0);
        expect(site.logs().map((line) => line.event)).toContain("process.signal");
        expect(applied(site)).toEqual([]);
        expect(site.stderr).toEqual([]);
    });

    it("配置不合格时以 config_invalid 退出", async () => {
        const {site, code} = await run(["migrate"], {NB_SITE_DATA_DIR: "relative"});
        expect(code).toBe(1);
        expect(failureLine(site)).toMatchObject({code: "config_invalid", problems: [{name: "NB_SITE_DATA_DIR", problem: "not_absolute"}]});
    });
});

describe("模块的命令", () => {
    it("exclusive：服务没在跑时先执行本模块的迁移再运行", async () => {
        const {site, code} = await run(["alpha-exclusive", "first"]);
        expect(code).toBe(0);
        expect(applied(site)).toMatchObject([{module: "alpha", migration: "0001_items"}]);
        expect(site.logs().find((line) => line.event === "fixture.command_ran")).toMatchObject({module: "alpha", command: "alpha-exclusive"});
        expect(labels()).toEqual(["first"]);
    });

    it("exclusive：服务在跑时以 data_dir_busy 退出", async () => {
        await startServing({root, env: env()});
        const {site, code} = await run(["alpha-exclusive", "blocked"]);
        expect(code).toBe(1);
        expect(failureLine(site)).toMatchObject({code: "data_dir_busy", module: "alpha"});
        expect(labels()).toEqual([]);
    });

    it("shared：服务在跑时直接运行，服务读得到它写的", async () => {
        const {url} = await startServing({root, env: env()});
        const {site, code} = await run(["alpha-shared", "while-serving"]);
        expect(code).toBe(0);
        expect(applied(site)).toEqual([]);
        expect(await (await fetch(`${url}api/alpha/items`)).json()).toEqual({count: 1});
    });

    it("shared：服务没在跑时先执行迁移再运行", async () => {
        const {site, code} = await run(["alpha-shared"]);
        expect(code).toBe(0);
        expect(applied(site)).toMatchObject([{module: "alpha", migration: "0001_items"}]);
        expect(labels()).toEqual(["shared"]);
    });

    it("shared：锁被别人占着而迁移记录不完整时以 not_ready 退出", async () => {
        const lock = tryLock(join(dataDir, "alpha.lock"));
        if (lock === null) throw new Error("alpha.lock is already held");
        held.push(lock);
        const {site, code} = await run(["alpha-shared"]);
        expect(code).toBe(1);
        expect(failureLine(site)).toMatchObject({code: "not_ready", module: "alpha"});
    });

    it("命令 resolve 出失败时把它写到标准错误、以 1 退出", async () => {
        const {site, code} = await run(["alpha-shared", "fail"]);
        expect(code).toBe(1);
        expect(failureLine(site)).toMatchObject({level: "error", event: "command.failed", code: "fixture_refused", command: "alpha-shared"});
    });

    it("命令抛出异常时：日志一行只有错误类型的 process.fatal，标准错误一行 internal，以 1 退出", async () => {
        const {site, code} = await run(["alpha-shared", "throw"]);
        expect(code).toBe(1);
        expect(site.logs().find((line) => line.event === "process.fatal")).toMatchObject({level: "error", errorType: "TypeError"});
        expect(failureLine(site)).toMatchObject({code: "internal"});
        expect([...site.stdout, ...site.stderr].join("\n")).not.toContain("secret-detail-command");
    });

    it("shared：服务没在跑时只在迁移期间占着库，停在等输入的地方时另一个进程能启动服务", async () => {
        const waiting = await startSite({root, args: ["alpha-wait"], env: env()});
        await waiting.waitForLog("command waiting", (line) => line.event === "fixture.command_waiting");
        expect(applied(waiting)).toMatchObject([{module: "alpha", migration: "0001_items"}]);
        const {url} = await startServing({root, env: env()});
        waiting.writeStdin("go\n");
        expect(await waiting.waitForExit()).toBe(0);
        expect(await (await fetch(`${url}api/alpha/items`)).json()).toEqual({count: 1});
    });
});

describe("模块命令被停止信号打断", () => {
    it("运行中收到 SIGINT：命令看 signal 收手，以 interrupted 退出、不写入，锁随之放掉", async () => {
        const waiting = await startSite({root, args: ["alpha-wait"], env: env()});
        await waiting.waitForLog("command waiting", (line) => line.event === "fixture.command_waiting");
        waiting.signal("SIGINT");
        expect(await waiting.waitForExit()).toBe(1);
        expect(failureLine(waiting)).toMatchObject({code: "interrupted", module: "alpha", command: "alpha-wait"});
        expect(labels()).toEqual([]);
        expect((await run(["alpha-exclusive", "after"])).code).toBe(0);
    });

    it("不理会 signal 的命令：第二次信号时入口不再等它，以 interrupted 退出", async () => {
        const waiting = await startSite({root, args: ["alpha-wait", "stubborn"], env: env()});
        await waiting.waitForLog("command waiting", (line) => line.event === "fixture.command_waiting");
        waiting.signal("SIGINT");
        await waiting.waitForLog("first signal", (line) => line.event === "process.signal");
        waiting.signal("SIGINT");
        expect(await waiting.waitForExit()).toBe(1);
        expect(failureLine(waiting)).toMatchObject({code: "interrupted", command: "alpha-wait"});
        expect(labels()).toEqual([]);
    });

    it("运行之前收到信号：不运行命令，以 interrupted 退出", async () => {
        const site = await startSite({root, args: ["alpha-shared", "never"], env: env({NB_SITE_ALPHA_WAIT: "parse"})});
        await site.waitForLog("blocked in parseConfig", (line) => line.event === "fixture.waiting_stdin");
        site.signal("SIGTERM");
        site.writeStdin("go\n");
        expect(await site.waitForExit()).toBe(1);
        expect(failureLine(site)).toMatchObject({code: "interrupted", command: "alpha-shared"});
        expect(site.logs().map((line) => line.event)).not.toContain("fixture.command_ran");
    });
});

describe("产品入口的 create-admin：账号库不是 SQLite 库", () => {
    // 两条路径打开库的方式不同：没人拿锁时先迁移，别人拿着锁时只核对迁移记录（`SiteCommand` 的 shared）。部署的人看到的码不该取决于
    // 这时服务在不在跑。
    it("别人拿着账号模块的锁时与没人拿锁时报同一个码：migration_failed、sql_error，migration 为 null，不带路径", async () => {
        await writeFile(join(dataDir, "identity.db"), randomBytes(4096));
        const mainEnv = env({NB_SITE_SESSION_SECRET: "SESSION-SECRET-7f3a-0123456789abcdef0123456789", NB_SITE_IDENTITY_TERMS_VERSION: "2026-11-20"});
        const unlocked = await startSite({root, script: MAIN_SCRIPT, args: ["create-admin", "root"], env: mainEnv});
        expect(await unlocked.waitForExit()).toBe(1);

        const lock = tryLock(join(dataDir, "identity.lock"));
        if (lock === null) throw new Error("identity.lock is already held");
        held.push(lock);
        const locked = await startSite({root, script: MAIN_SCRIPT, args: ["create-admin", "root"], env: mainEnv});
        expect(await locked.waitForExit()).toBe(1);

        for (const [path, site] of [["unlocked", unlocked], ["locked", locked]] as const) {
            expect({path, failure: failureLine(site)}).toMatchObject({
                path,
                failure: {code: "migration_failed", module: "identity", migration: null, reason: "sql_error", dbCode: "SQLITE_NOTADB"},
            });
            expect({path, leaked: [...site.stdout, ...site.stderr].join("\n").includes(dataDir)}).toEqual({path, leaked: false});
        }
    });
});
