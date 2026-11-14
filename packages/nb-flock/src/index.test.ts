/**
 * 不判旧的进程级锁：独占时同一进程的第二个句柄拿不到，release 之后能再拿、重复 release 无事；别的进程拿着时拿不到，
 * 那个进程被强杀后立即能拿到（锁由系统放掉，不等过期）。共享锁之间共存，与独占互斥。真实临时目录，跨进程用真实子进程
 * （`src/testing/lock-child.ts`）。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {tryLock} from "./index";

const CHILD = join(import.meta.dir, "testing", "lock-child.ts");

let tmp = "";

beforeAll(async () => {
    tmp = await createTestTmpRoot("nb-flock", "flock");
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 起子进程拿锁。`first` 在读到它的第一行（`held` 或 `busy`）时完成；调用方拿到 `child` 就进 try，失败时也结束它。 */
function holdInChild(path: string, mode: "exclusive" | "shared" = "exclusive") {
    const child = Bun.spawn(["bun", CHILD, path, ...(mode === "shared" ? ["shared"] : [])], {stdin: "pipe", stdout: "pipe", stderr: "inherit"});
    const first = (async () => {
        const reader = child.stdout.pipeThrough(new TextDecoderStream()).getReader();
        let text = "";
        while (!text.includes("\n")) {
            const {value, done} = await reader.read();
            if (done) break;
            text += value;
        }
        reader.releaseLock();
        return text.trim();
    })();
    return {child, first};
}

describe("tryLock", () => {
    it("同一进程的第二个句柄拿不到；release 之后能再拿，重复 release 无事", () => {
        const path = join(tmp, "same-process.lock");
        const first = tryLock(path);
        expect(first).not.toBeNull();
        expect(tryLock(path)).toBeNull();
        first?.release();
        first?.release();
        const again = tryLock(path);
        expect(again).not.toBeNull();
        again?.release();
    });

    it("别的进程拿着时拿不到；它被强杀后立即能拿到", async () => {
        const path = join(tmp, "cross-process.lock");
        const {child, first} = holdInChild(path);
        try {
            expect(await first).toBe("held");
            expect(tryLock(path)).toBeNull();
            child.kill(9);
            await child.exited;
            const mine = tryLock(path);
            expect(mine).not.toBeNull();
            mine?.release();
        } finally {
            child.kill(9);
            await child.exited;
        }
    });

    it("本进程拿着时，别的进程拿不到", async () => {
        const path = join(tmp, "held-here.lock");
        const mine = tryLock(path);
        expect(mine).not.toBeNull();
        const {child, first} = holdInChild(path);
        try {
            expect(await first).toBe("busy");
            expect(await child.exited).toBe(1);
        } finally {
            child.kill(9);
            await child.exited;
            mine?.release();
        }
    });

    it("共享锁：两个进程都拿得到；有共享持有者时独占拿不到，持有者都退出后能拿到", async () => {
        const path = join(tmp, "shared.lock");
        const first = holdInChild(path, "shared");
        const second = holdInChild(path, "shared");
        try {
            expect(await first.first).toBe("held");
            expect(await second.first).toBe("held");
            const mine = tryLock(path, {shared: true});
            expect(mine).not.toBeNull();
            mine?.release();
            expect(tryLock(path)).toBeNull();
            first.child.kill(9);
            await first.child.exited;
            expect(tryLock(path)).toBeNull();
            second.child.kill(9);
            await second.child.exited;
            const exclusive = tryLock(path);
            expect(exclusive).not.toBeNull();
            exclusive?.release();
        } finally {
            for (const {child} of [first, second]) {
                child.kill(9);
                await child.exited;
            }
        }
    });

    it("有独占持有者时共享拿不到（本进程与别的进程都是）；独占放掉后共享能拿到", async () => {
        const path = join(tmp, "exclusive-blocks-shared.lock");
        const exclusive = tryLock(path);
        expect(exclusive).not.toBeNull();
        expect(tryLock(path, {shared: true})).toBeNull();
        const {child, first} = holdInChild(path, "shared");
        try {
            expect(await first).toBe("busy");
            expect(await child.exited).toBe(1);
        } finally {
            child.kill(9);
            await child.exited;
        }
        exclusive?.release();
        const shared = tryLock(path, {shared: true});
        expect(shared).not.toBeNull();
        shared?.release();
    });

    it("打不开锁文件时抛错，不当作被占用", () => {
        expect(() => tryLock(join(tmp, "missing-dir", "x.lock"))).toThrow();
    });
});
