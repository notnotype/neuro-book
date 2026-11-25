/**
 * 打开模块的库（`open.ts`），用真实的 SQLite 文件。
 */

import {Database, SQLiteError} from "bun:sqlite";
import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {moduleDbPath, openModuleDb} from "./open";

let dataDir: string;
const opened: Database[] = [];

beforeEach(async () => {
    dataDir = await createTestTmpRoot("nb-site-open", "nb-site-server db/open.test.ts");
});

afterEach(async () => {
    for (const db of opened.splice(0)) db.close();
    await rm(dataDir, {recursive: true, force: true});
});

describe("openModuleDb", () => {
    // 超出 200 毫秒的预算：要等满 250 毫秒的等锁上限才看得出等过。
    it("打开时库正被别的连接独占（像另一个进程在恢复 WAL、或最后一个连接在收拾 WAL）：等满等锁上限再失败，不是立即失败", () => {
        // 先建好库（WAL 模式是库文件的属性）。
        openModuleDb(dataDir, "sample").close();
        // 独占模式的连接读过一次就一直持着库文件的排他锁，别的连接连第一句读都要等它。
        const holder = new Database(moduleDbPath(dataDir, "sample"), {readwrite: true, create: false});
        opened.push(holder);
        holder.exec("PRAGMA locking_mode = EXCLUSIVE");
        holder.query("SELECT count(*) FROM sqlite_master").get();

        const started = performance.now();
        let failure: unknown;
        try {
            opened.push(openModuleDb(dataDir, "sample"));
        } catch (error) {
            failure = error;
        }
        const waitedMs = performance.now() - started;
        expect(failure instanceof SQLiteError && failure.code?.startsWith("SQLITE_BUSY")).toBe(true);
        // 只核下限：机器忙时只会更久。没设等锁时这里是 0 毫秒左右。
        expect(waitedMs).toBeGreaterThanOrEqual(200);
    });
});
