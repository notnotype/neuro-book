/**
 * 跨进程的锁与加锁替换（docs/specs/settings/configuration.md 输出 14、docs/specs/workspace/files.md 的“读取与保存”）：锁被别人
 * 接管后，旧持有者能发现、不会删掉新持有者的锁；两个进程同时替换同一文件不丢更新。真实临时目录、真实 proper-lockfile，
 * 跨进程的两条用真实子进程（`src/testing/lock-child.ts`）。进程内的“接管”按 proper-lockfile 判残留后的做法制造：删掉锁目录再由另一方取锁。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {lstat, readFile, rm} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {holdLock, lockHeld} from "./index";

const CHILD = join(import.meta.dir, "testing", "lock-child.ts");

let tmp = "";

beforeAll(async () => {
    tmp = await createTestTmpRoot("nb-file-lock", "file-lock");
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const exists = (path: string): Promise<boolean> => lstat(path).then(() => true, () => false);

/** 起一个子进程，按行收它的标准输出；`send` 往它的标准输入写一行。 */
function child(...args: string[]) {
    const process = Bun.spawn(["bun", CHILD, ...args], {stdin: "pipe", stdout: "pipe", stderr: "inherit"});
    const lines: string[] = [];
    void (async () => {
        let pending = "";
        for await (const chunk of process.stdout.pipeThrough(new TextDecoderStream())) {
            pending += chunk;
            const parts = pending.split("\n");
            pending = parts.pop() ?? "";
            lines.push(...parts);
        }
    })();
    return {
        process,
        lines,
        line: (description: string, match: (line: string) => boolean, timeoutMs = 10_000) => waitUntil(description, () => lines.find(match), {timeoutMs}),
        send: (text: string) => {
            process.stdin.write(`${text}\n`);
            process.stdin.flush();
        },
    };
}

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

    it("占着的锁：另一方等不到为 locked；lockHeld 看得到它，放下之后看不到", async () => {
        const path = join(tmp, "busy.lock");
        const first = await holdLock(path, () => undefined);
        if (!first.ok) throw new Error(first.detail);
        try {
            expect(await holdLock(path, () => undefined)).toMatchObject({ok: false, reason: "locked"});
            expect(await lockHeld(path)).toBe(true);
        } finally {
            await first.lock.release();
        }
        expect(await lockHeld(path)).toBe(false);
    }, 15_000);

    it("持锁的进程被暂停到锁过期：另一个进程接管；它恢复后只经 report 报 lock.compromised、报告失去锁，释放不删接管者的锁，进程正常退出", async () => {
        const path = join(tmp, "stopped.lock");
        // proper-lockfile 的残留下限是 2 秒；双方用同一个值，免得这条用例等满缺省的 10 秒。
        const STALE = 2_000;
        const holder = child("hold", path, String(STALE));
        await holder.line("子进程取得锁", (line) => line === "held");
        holder.process.kill("SIGSTOP");
        let taken: Awaited<ReturnType<typeof holdLock>>;
        // 暂停的进程不再刷新锁目录，过了残留时间才取得到；每次 holdLock 自己退避约 3 秒，等不到就再取。
        for (;;) {
            taken = await holdLock(path, () => undefined, {stale: STALE});
            if (taken.ok || taken.reason !== "locked") break;
        }
        if (!taken.ok) throw new Error(taken.detail);
        holder.process.kill("SIGCONT");
        await holder.line("恢复后发现锁失效", (line) => line === "report:lock.compromised");
        holder.send("check");
        expect(await holder.line("核对结果", (line) => line.startsWith("still:"))).not.toBe("still:null");
        holder.send("release");
        await holder.line("释放完", (line) => line === "released");
        expect(await holder.process.exited).toBe(0);
        expect(await exists(path)).toBe(true);
        expect(await taken.lock.stillHeld()).toBeNull();
        await taken.lock.release();
        expect(await exists(path)).toBe(false);
    }, 60_000);
});

describe("replaceLocked", () => {
    it("两个进程同时各做 20 次加锁替换：计数是 40，没有丢掉的更新", async () => {
        const file = join(tmp, "counter.txt");
        const lockPath = join(tmp, "counter.lock");
        const workers = [child("replace", file, lockPath, "20"), child("replace", file, lockPath, "20")];
        expect(await Promise.all(workers.map((worker) => worker.process.exited))).toEqual([0, 0]);
        expect(await readFile(file, "utf8")).toBe("40");
    }, 60_000);
});
