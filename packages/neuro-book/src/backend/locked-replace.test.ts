/**
 * 跨进程的锁（`holdLock`，加锁替换与 Files 的操作锁共用）：锁被别人接管后，旧持有者能发现、且不会删掉新持有者的锁。
 * 真实临时目录与 proper-lockfile；“接管”按 proper-lockfile 判残留后的做法制造：删掉锁目录再由另一方取锁。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {lstat, rm} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {holdLock} from "./locked-replace";

let tmp = "";

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-backend", "locked-replace");
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const exists = (path: string): Promise<boolean> => lstat(path).then(() => true, () => false);

describe("holdLock", () => {
    it("锁被别人接管：旧持有者的 stillHeld 报告失去锁，释放时不删掉新持有者的锁", async () => {
        const path = join(tmp, "operations.lock");
        const first = await holdLock(path, () => undefined);
        if (!first.ok) throw new Error(first.detail);
        expect(await first.lock.stillHeld()).toBeNull();

        await rm(path, {recursive: true});
        const second = await holdLock(path, () => undefined);
        if (!second.ok) throw new Error(second.detail);
        // 先释放、再问：释放自己就要核对锁是不是还归自己。
        await first.lock.release();
        expect(await exists(path)).toBe(true);
        expect(await first.lock.stillHeld()).toEqual(expect.any(String));
        expect(await second.lock.stillHeld()).toBeNull();

        await second.lock.release();
        await second.lock.release();
        expect(await exists(path)).toBe(false);
    });

    it("占着的锁：另一方等不到为 locked", async () => {
        const path = join(tmp, "busy.lock");
        const first = await holdLock(path, () => undefined);
        if (!first.ok) throw new Error(first.detail);
        try {
            expect(await holdLock(path, () => undefined)).toMatchObject({ok: false, reason: "locked"});
        } finally {
            await first.lock.release();
        }
    }, 15_000);
});
