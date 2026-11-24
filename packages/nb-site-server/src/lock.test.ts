/**
 * 按模块取锁（`site.operations` 的副作用与数据一节）。进程内：flock 的锁属于打开的文件，同一进程里另一次打开照样互斥。
 */

import {afterEach, beforeEach, expect, it} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {tryLock, type FileLock} from "@notnotype/nb-flock";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {lockModules} from "./lock";

let dataDir: string;
const held: FileLock[] = [];

beforeEach(async () => {
    dataDir = await createTestTmpRoot("nb-site-lock", "nb-site-server lock.test.ts");
});

afterEach(async () => {
    for (const lock of held.splice(0)) lock.release();
    await rm(dataDir, {recursive: true, force: true});
});

function hold(name: string): void {
    const lock = tryLock(join(dataDir, `${name}.lock`));
    if (lock === null) throw new Error(`${name}.lock is already held`);
    held.push(lock);
}

it("每个模块一把锁，另一个进程只占着其中一个模块时，别的模块照样取得到", () => {
    hold("beta");
    const alphaOnly = lockModules(dataDir, ["alpha"]);
    expect(alphaOnly.ok).toBe(true);
    if (alphaOnly.ok) alphaOnly.release();
});

it("某个模块取不到时报出它，并放掉已经取到的", () => {
    hold("beta");
    expect(lockModules(dataDir, ["alpha", "beta"])).toEqual({ok: false, reason: "busy", module: "beta"});
    hold("alpha");
});

it("release() 之后别人取得到", () => {
    const locks = lockModules(dataDir, ["alpha", "beta"]);
    if (!locks.ok) throw new Error("expected the locks");
    locks.release();
    hold("alpha");
    hold("beta");
});
