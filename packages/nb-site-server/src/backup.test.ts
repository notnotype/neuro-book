/**
 * `nb-site backup`（`site.operations` 输出 6、10，时序一节的最后一条，失败表的 `backup_failed`），起真子进程、用真的
 * SQLite 文件。夹具模块 `alpha` 的 `prepareBackupCopy` 在副本里删掉 `label` 为 `raw` 的行（`testing/modules.ts`）。
 *
 * 每个用例起一到四个 Bun 进程，超出快速类 200 毫秒的预算，理由同 `serve.test.ts`。要一个备份停在写副本的中途时用夹具的
 * `NB_SITE_ALPHA_WAIT=backup`：它在 `prepareBackupCopy` 里同步阻塞着读标准输入，测试写一行才放行，不靠两个进程的相对速度。
 */

import {Database} from "bun:sqlite";
import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {mkdir, readdir, rm, writeFile} from "node:fs/promises";
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

async function run(args: readonly string[], extra?: Readonly<Record<string, string>>): Promise<{readonly site: SiteProcess; readonly code: number}> {
    const site = await startSite({root, args, env: env(extra)});
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

    it("清掉残留的 .partial，名字不合备份格式的东西不动", async () => {
        expect((await run(["migrate"])).code).toBe(0);
        const leftover = join(backupsDir, "20200101T000000000Z.partial");
        await mkdir(leftover, {recursive: true});
        await writeFile(join(leftover, "alpha.db"), "half written");
        await mkdir(join(backupsDir, "before-upgrade"));
        await mkdir(join(backupsDir, "notes.partial"));
        await mkdir(join(backupsDir, "2020-01-01"));
        await writeFile(join(backupsDir, "README.txt"), "kept by hand");

        const done = await backupOk({NB_SITE_BACKUP_KEEP: "1"});
        expect((await readdir(backupsDir)).sort()).toEqual(["2020-01-01", "README.txt", String(done.name), "backup.lock", "before-upgrade", "notes.partial"].sort());
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
        expect(await completeBackups()).toEqual([]);
        expect(allOutput(site)).not.toContain(dataDir);
        expect(allOutput(site)).not.toContain(root);
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

    it("写到一半收到 SIGTERM：以 interrupted 退出，没写完的 .partial 留着，下一次备份把它清掉", async () => {
        expect((await run(["migrate"])).code).toBe(0);
        const site = await startSite({root, args: ["backup"], env: env({NB_SITE_ALPHA_WAIT: "backup"})});
        await site.waitForLog("backup is copying alpha", (line) => line.event === "fixture.waiting_stdin");
        site.signal("SIGTERM");
        site.writeStdin("go\n");
        expect(await site.waitForExit()).toBe(1);
        expect(failureLine(site)).toMatchObject({code: "interrupted", command: "backup"});
        const partials = (await readdir(backupsDir)).filter((name) => name.endsWith(".partial"));
        expect(partials).toHaveLength(1);
        expect(await completeBackups()).toEqual([]);

        const done = await backupOk();
        expect((await readdir(backupsDir)).sort()).toEqual([String(done.name), "backup.lock"].sort());
    });

    it("配置不合格时以 config_invalid 退出，不建 backups/", async () => {
        const {site, code} = await run(["backup"], {NB_SITE_URL: "http://site.example"});
        expect(code).toBe(1);
        expect(failureLine(site)).toMatchObject({code: "config_invalid", problems: [{name: "NB_SITE_URL", problem: "not_https"}]});
        expect(await readdir(dataDir)).toEqual([]);
    });
});
