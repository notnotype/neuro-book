/**
 * `nb-site backup`（`site.operations` 输出 6、10，时序一节的最后一条，失败表的 `backup_failed`），起真子进程、用真的
 * SQLite 文件。夹具模块 `alpha` 的 `prepareBackupCopy` 在副本里删掉 `label` 为 `raw` 的行（`testing/modules.ts`）。
 *
 * 每个用例起一到四个 Bun 进程，超出快速类 200 毫秒的预算，理由同 `serve.test.ts`。要一个备份停在写副本的中途时用夹具的
 * `NB_SITE_ALPHA_WAIT=backup`：它在 `prepareBackupCopy` 里同步阻塞着读标准输入，测试写一行才放行，不靠两个进程的相对速度。
 *
 * 失败的几条都核对“没写完的那一份当场删掉”：备份目录里没有 `.partial`，也搜不到先写进库里的标记串。几条用例要子进程在
 * 特定的 umask 下建文件，就在起子进程的那一刻改测试进程的 umask（子进程继承它），起完立即改回。权限类的用例在 root 下跳过：
 * root 不受权限位限制，造不出那种失败。
 */

import {Database} from "bun:sqlite";
import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {randomBytes} from "node:crypto";
import {chmod, mkdir, readdir, readFile, rm, stat, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {startServing, startSite, stopAllSiteProcesses, type LogLine, type SiteProcess} from "./testing/process";

let root: string;
let dataDir: string;
let backupsDir: string;

beforeEach(async () => {
    root = await createTestTmpRoot("nb-site-backup", "nb-site-server backup.test.ts");
    dataDir = join(root, "data");
    backupsDir = join(dataDir, "backups");
    await mkdir(dataDir);
});

afterEach(async () => {
    await stopAllSiteProcesses();
    await rm(root, {recursive: true, force: true});
});

const BACKUP_NAME = /^\d{8}T\d{9}Z$/u;

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

const IS_ROOT = process.getuid?.() === 0;

/** `umask` 给了时，子进程在这个 umask 下起（继承测试进程的），起完立即改回。 */
async function run(args: readonly string[], extra?: Readonly<Record<string, string>>, umask?: number): Promise<{readonly site: SiteProcess; readonly code: number}> {
    let site: SiteProcess;
    if (umask === undefined) {
        site = await startSite({root, args, env: env(extra)});
    } else {
        // `startSite` 在 spawn 之前会建 `home/`：调用方先跑过一次别的命令，它已经在了，不会按这个 umask 建。
        const previous = process.umask(umask);
        try {
            site = await startSite({root, args, env: env(extra)});
        } finally {
            process.umask(previous);
        }
    }
    return {site, code: await site.waitForExit()};
}

/** 跑一次备份，断言成功，返回 `backup.done` 那一行。 */
async function backupOk(extra?: Readonly<Record<string, string>>): Promise<LogLine> {
    const {site, code} = await run(["backup"], extra);
    expect({code, stderr: site.stderr}).toEqual({code: 0, stderr: []});
    const done = site.logs().find((line) => line.event === "backup.done");
    if (done === undefined) throw new Error(`no backup.done line:\n${site.stdout.join("\n")}`);
    return done;
}

function failureLine(site: SiteProcess): LogLine {
    return JSON.parse(site.stderr.at(-1) ?? "null") as LogLine;
}

function allOutput(site: SiteProcess): string {
    return [...site.stdout, ...site.stderr].join("\n");
}

/** `backups/` 里名字合完整备份格式的目录，按名字排好。 */
async function completeBackups(): Promise<string[]> {
    return (await readdir(backupsDir)).filter((name) => BACKUP_NAME.test(name)).sort();
}

/** `backups/` 里没写完的备份。 */
async function partials(): Promise<string[]> {
    return (await readdir(backupsDir)).filter((name) => name.endsWith(".partial"));
}

async function filesUnder(dir: string): Promise<string[]> {
    const entries = await readdir(dir, {withFileTypes: true});
    const nested = await Promise.all(entries.map((entry) => (entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)])));
    return nested.flat();
}

/** 每个用例一个新的标记串，经夹具命令写进 alpha 的库；备份失败之后在备份目录的所有文件里搜它，证明副本没留下。 */
let marker: string;
beforeEach(() => {
    marker = `marker-${randomBytes(8).toString("hex")}`;
});

async function writeMarker(): Promise<void> {
    expect((await run(["alpha-exclusive", marker])).code).toBe(0);
}

/** 备份目录里有没有哪个文件含着标记串。锁文件不装数据，不看（umask 0400 的用例里它连读都读不了）。 */
async function markerLeftInBackups(): Promise<boolean> {
    for (const file of await filesUnder(backupsDir)) {
        if (file === join(backupsDir, "backup.lock")) continue;
        if ((await readFile(file)).includes(marker)) return true;
    }
    return false;
}

/** 失败的备份没留下东西：没有完整的备份、没有 `.partial`、搜不到标记串；输出里没有路径。 */
async function expectNothingLeft(site: SiteProcess): Promise<void> {
    expect({complete: await completeBackups(), partials: await partials(), marker: await markerLeftInBackups()}).toEqual({complete: [], partials: [], marker: false});
    expect(allOutput(site)).not.toContain(dataDir);
    expect(allOutput(site)).not.toContain(root);
}

async function modeOf(path: string): Promise<number> {
    return (await stat(path)).mode & 0o777;
}

function labels(path: string): string[] {
    const db = new Database(path, {readonly: true});
    try {
        return db
            .query<{label: string}, []>(`SELECT "label" FROM "item" ORDER BY "id"`)
            .all()
            .map((row) => row.label);
    } finally {
        db.close();
    }
}

function quickCheck(path: string): string[] {
    const db = new Database(path, {readonly: true});
    try {
        return db
            .query<{quick_check: string}, []>("PRAGMA quick_check")
            .all()
            .map((row) => row.quick_check);
    } finally {
        db.close();
    }
}

describe("备份写出的副本", () => {
    it("服务运行期间可以备份：backups/ 不存在时先建，副本能只读打开、quick_check 为 ok、内容是已提交的数据", async () => {
        expect((await run(["alpha-exclusive", "kept"])).code).toBe(0);
        expect((await run(["alpha-exclusive", "raw"])).code).toBe(0);
        const {url} = await startServing({root, env: env()});
        expect((await run(["alpha-shared", "while-serving"])).code).toBe(0);
        // 服务在业务连接上开着一个没提交的写事务：备份不等它，也看不到它写的。
        expect((await fetch(`${url}api/alpha/txn/begin`, {method: "POST"})).status).toBe(200);
        expect(await readdir(dataDir)).not.toContain("backups");

        const done = await backupOk();
        expect(done).toMatchObject({level: "info", modules: ["alpha", "beta"]});
        expect(String(done.name)).toMatch(BACKUP_NAME);
        expect(await completeBackups()).toEqual([String(done.name)]);
        const copyDir = join(backupsDir, String(done.name));
        expect((await readdir(copyDir)).sort()).toEqual(["alpha.db", "beta.db"]);
        for (const file of ["alpha.db", "beta.db"]) expect(quickCheck(join(copyDir, file))).toEqual(["ok"]);

        // prepareBackupCopy 在副本上删掉了 raw，原库里它还在。
        expect(labels(join(copyDir, "alpha.db"))).toEqual(["kept", "while-serving"]);
        expect((await fetch(`${url}api/alpha/txn/commit`, {method: "POST"})).status).toBe(200);
        expect(labels(join(dataDir, "alpha.db"))).toEqual(["kept", "raw", "while-serving", "in-transaction"]);
    });

    it("保留份数：NB_SITE_BACKUP_KEEP=2 时连跑三次只剩最新的两份", async () => {
        expect((await run(["migrate"])).code).toBe(0);
        const names: string[] = [];
        for (let index = 0; index < 3; index += 1) names.push(String((await backupOk({NB_SITE_BACKUP_KEEP: "2"})).name));
        expect(new Set(names).size).toBe(3);
        expect(await completeBackups()).toEqual(names.slice(1).sort());
    });

    it("强行结束留下的 .partial 在下一次备份开始时清掉，这一次失败了也清；名字不合备份格式的东西不动", async () => {
        const leftover = join(backupsDir, "20200101T000000000Z.partial");
        await mkdir(leftover, {recursive: true});
        await writeFile(join(leftover, "alpha.db"), "half written");
        await mkdir(join(backupsDir, "before-upgrade"));
        await mkdir(join(backupsDir, "notes.partial"));
        await mkdir(join(backupsDir, "2020-01-01"));
        await writeFile(join(backupsDir, "README.txt"), "kept by hand");
        const byHand = ["2020-01-01", "README.txt", "before-upgrade", "notes.partial"];

        // 还没迁移过：这一次以 db_missing 失败，但开始时已经清掉了残留的那一份。
        const failedRun = await run(["backup"]);
        expect(failedRun.code).toBe(1);
        expect(failureLine(failedRun.site)).toMatchObject({code: "backup_failed", reason: "db_missing"});
        expect((await readdir(backupsDir)).sort()).toEqual([...byHand, "backup.lock"].sort());

        expect((await run(["migrate"])).code).toBe(0);
        const done = await backupOk({NB_SITE_BACKUP_KEEP: "1"});
        expect((await readdir(backupsDir)).sort()).toEqual([...byHand, String(done.name), "backup.lock"].sort());
    });

    it("新建的备份目录与每一份备份只让运行备份的用户进；已有的备份目录不改权限", async () => {
        expect((await run(["migrate"])).code).toBe(0);
        // 缺省的 umask 0022 下，不显式给权限建出来的目录是 0755。
        const first = await run(["backup"], {}, 0o022);
        expect(first.code).toBe(0);
        const firstName = String(first.site.logs().find((line) => line.event === "backup.done")?.name);
        expect({backups: await modeOf(backupsDir), backup: await modeOf(join(backupsDir, firstName))}).toEqual({backups: 0o700, backup: 0o700});

        await chmod(backupsDir, 0o755);
        const second = await run(["backup"], {}, 0o022);
        expect(second.code).toBe(0);
        const secondName = String(second.site.logs().find((line) => line.event === "backup.done")?.name);
        expect({backups: await modeOf(backupsDir), backup: await modeOf(join(backupsDir, secondName))}).toEqual({backups: 0o755, backup: 0o700});
    });

    it("墙钟回拨过（目录里已有名字更新的一份）时，本次写出的那一份不被删", async () => {
        expect((await run(["migrate"])).code).toBe(0);
        await mkdir(join(backupsDir, "29991231T235959999Z"), {recursive: true});
        const done = await backupOk({NB_SITE_BACKUP_KEEP: "1"});
        expect(await completeBackups()).toEqual([String(done.name)]);
        expect(quickCheck(join(backupsDir, String(done.name), "alpha.db"))).toEqual(["ok"]);
    });
});

describe("备份失败", () => {
    it("库文件不存在时以 backup_failed 退出，点名模块，不留完整的备份，输出里没有路径", async () => {
        const {site, code} = await run(["backup"]);
        expect(code).toBe(1);
        expect(failureLine(site)).toMatchObject({level: "error", event: "command.failed", code: "backup_failed", reason: "db_missing", module: "alpha"});
        await expectNothingLeft(site);
    });

    it("两个备份同时执行时后到的以 backup_failed 退出；先到的照常写完", async () => {
        expect((await run(["migrate"])).code).toBe(0);
        const first = await startSite({root, args: ["backup"], env: env({NB_SITE_ALPHA_WAIT: "backup"})});
        await first.waitForLog("first backup is copying", (line) => line.event === "fixture.waiting_stdin");

        const second = await run(["backup"]);
        expect(second.code).toBe(1);
        expect(failureLine(second.site)).toMatchObject({code: "backup_failed", reason: "busy"});
        expect(allOutput(second.site)).not.toContain(dataDir);

        first.writeStdin("go\n");
        expect(await first.waitForExit()).toBe(0);
        const done = first.logs().find((line) => line.event === "backup.done");
        expect(await completeBackups()).toEqual([String(done?.name)]);
    });

    // 第一种顺序里 alpha 是第一个模块，信号在两个模块之间被看见；第二种里它是最后一个，信号要在改名之前的那一次检查里看见。
    it.each([
        ["第一个", "alpha,beta"],
        ["最后一个", "beta,alpha"],
    ])("写%s模块的副本时收到 SIGTERM：以 interrupted 退出，没写完的那一份当场删掉", async (_position, fixture) => {
        expect((await run(["migrate"])).code).toBe(0);
        await writeMarker();
        const site = await startSite({root, args: ["backup"], env: env({NB_SITE_FIXTURE: fixture, NB_SITE_ALPHA_WAIT: "backup"})});
        await site.waitForLog("backup is copying alpha", (line) => line.event === "fixture.waiting_stdin");
        site.signal("SIGTERM");
        site.writeStdin("go\n");
        expect(await site.waitForExit()).toBe(1);
        expect(failureLine(site)).toMatchObject({code: "interrupted", command: "backup"});
        expect(site.logs().map((line) => line.event)).not.toContain("backup.done");
        await expectNothingLeft(site);

        const done = await backupOk();
        expect((await readdir(backupsDir)).sort()).toEqual([String(done.name), "backup.lock"].sort());
    });

    it.each([
        ["抛错", "throw", {errorType: "RangeError"}],
        ["写成 async（返回了 Promise）", "async", {}],
        ["开了事务没提交", "open-txn", {}],
    ])("模块的 prepareBackupCopy %s时以 prepare_failed 退出，点名模块，没写完的那一份当场删掉", async (_case, mode, extra) => {
        expect((await run(["migrate"])).code).toBe(0);
        await writeMarker();
        const {site, code} = await run(["backup"], {NB_SITE_ALPHA_PREPARE: mode});
        expect(code).toBe(1);
        expect(failureLine(site)).toMatchObject({code: "backup_failed", reason: "prepare_failed", module: "alpha", ...extra});
        expect(allOutput(site)).not.toContain("secret-detail-prepare");
        await expectNothingLeft(site);
        // 锁已放掉，下一次照常写。
        await backupOk();
    });

    it("库文件不是 SQLite 库时以 copy_failed 退出，带 SQLite 的错误码", async () => {
        await writeFile(join(dataDir, "alpha.db"), "this file is not a SQLite database ".repeat(200));
        const {site, code} = await run(["backup"]);
        expect(code).toBe(1);
        expect(failureLine(site)).toMatchObject({code: "backup_failed", reason: "copy_failed", module: "alpha", dbCode: "SQLITE_NOTADB"});
        await expectNothingLeft(site);
    });

    it("副本写得出来、校验不过时以 check_failed 退出，点名模块，输出里没有 SQLite 的说明", async () => {
        expect((await run(["migrate"])).code).toBe(0);
        await writeMarker();
        // 造一个 VACUUM INTO 照样复制、quick_check 不过的库：普通表的 INTEGER 列里放一行文字，再把库文件里这张表的定义
        // 原地改成 STRICT（同样长度的两段文字）。bun:sqlite 开着 SQLite 的 defensive 模式，`writable_schema` 改不了表定义，
        // 只好改文件的字节；这时没有别的连接开着这个库，WAL 已在关连接时并回主文件。
        const loose = `CREATE TABLE "fixture" ("value" INTEGER /*pad*/)`;
        const strict = `CREATE TABLE "fixture" ("value" INTEGER) STRICT `;
        expect(strict.length).toBe(loose.length);
        const betaPath = join(dataDir, "beta.db");
        const db = new Database(betaPath);
        try {
            db.exec(loose);
            db.query(`INSERT INTO "fixture" ("value") VALUES ('not a number')`).run();
        } finally {
            db.close();
        }
        const bytes = await readFile(betaPath);
        const at = bytes.indexOf(loose);
        expect(at).toBeGreaterThan(0);
        bytes.write(strict, at, "utf8");
        await writeFile(betaPath, bytes);

        const {site, code} = await run(["backup"]);
        expect(code).toBe(1);
        expect(failureLine(site)).toMatchObject({code: "backup_failed", reason: "check_failed", module: "beta"});
        expect(allOutput(site)).not.toContain("non-INTEGER");
        expect(allOutput(site)).not.toContain("fixture.value");
        await expectNothingLeft(site);
    });

    // umask 0400 让刚写出的副本只有写权限：`VACUUM INTO` 建文件时那次打开不受影响，之后再打开它就失败。源库换成 DELETE
    // 日志：WAL 下只读连接要建 -shm，也会撞上这个 umask。
    it.skipIf(IS_ROOT).each([
        ["有 prepareBackupCopy 的模块，准备前打不开副本", "alpha", "copy_failed"],
        ["没有它的模块，校验时打不开副本", "beta", "check_failed"],
    ])("刚写出的副本打不开（%s）时报 %s，不报 internal（以 root 运行时跳过）", async (_case, module, reason) => {
        expect((await run(["migrate"])).code).toBe(0);
        const db = new Database(join(dataDir, `${module}.db`));
        try {
            db.exec("PRAGMA journal_mode = DELETE");
        } finally {
            db.close();
        }
        const {site, code} = await run(["backup"], {NB_SITE_FIXTURE: module}, 0o400);
        expect(code).toBe(1);
        expect(failureLine(site)).toMatchObject({code: "backup_failed", reason, module, dbCode: expect.stringMatching(/^SQLITE_/u)});
        await expectNothingLeft(site);
    });

    it("备份目录的位置上是个普通文件时以 io_failed 退出，带系统的错误码，那个文件不动", async () => {
        await writeFile(backupsDir, "a file where backups/ should be");
        const {site, code} = await run(["backup"]);
        expect(code).toBe(1);
        expect(failureLine(site)).toMatchObject({code: "backup_failed", reason: "io_failed", errorCode: "EEXIST"});
        expect(await readFile(backupsDir, "utf8")).toBe("a file where backups/ should be");
        expect(allOutput(site)).not.toContain(dataDir);
    });

    it.skipIf(IS_ROOT)("删旧备份失败时以 prune_failed 退出、带这一份的名字，这一份已经写好（以 root 运行时跳过）", async () => {
        expect((await run(["migrate"])).code).toBe(0);
        const old = join(backupsDir, "20200101T000000000Z");
        await mkdir(old, {recursive: true});
        await writeFile(join(old, "alpha.db"), "old copy");
        await chmod(old, 0o500);
        try {
            const {site, code} = await run(["backup"], {NB_SITE_BACKUP_KEEP: "1"});
            expect(code).toBe(1);
            const failure = failureLine(site);
            expect(failure).toMatchObject({code: "backup_failed", reason: "prune_failed", errorCode: "EACCES"});
            expect(String(failure.name)).toMatch(BACKUP_NAME);
            expect(await completeBackups()).toEqual(["20200101T000000000Z", String(failure.name)]);
            expect(quickCheck(join(backupsDir, String(failure.name), "alpha.db"))).toEqual(["ok"]);
            expect(await partials()).toEqual([]);
            expect(allOutput(site)).not.toContain(dataDir);
        } finally {
            await chmod(old, 0o700);
        }
    });

    it("配置不合格时以 config_invalid 退出，不建 backups/", async () => {
        const {site, code} = await run(["backup"], {NB_SITE_URL: "http://site.example"});
        expect(code).toBe(1);
        expect(failureLine(site)).toMatchObject({code: "config_invalid", problems: [{name: "NB_SITE_URL", problem: "not_https"}]});
        expect(await readdir(dataDir)).toEqual([]);
    });
});
