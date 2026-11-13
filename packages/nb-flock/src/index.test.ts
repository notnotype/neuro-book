/**
 * 不判旧的进程级独占锁：同一进程的第二个句柄拿不到，release 之后能再拿、重复 release 无事；别的进程拿着时拿不到，
 * 那个进程被强杀后立即能拿到（锁由系统放掉，不等过期）。真实临时目录，跨进程用真实子进程（`src/testing/lock-child.ts`）。
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
function holdInChild(path: string) {
    const child = Bun.spawn(["bun", CHILD, path], {stdin: "pipe", stdout: "pipe", stderr: "inherit"});
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

    it("打不开锁文件时抛错，不当作被占用", () => {
        expect(() => tryLock(join(tmp, "missing-dir", "x.lock"))).toThrow();
    });
});
