/**
 * 哈希限额与失败的下限（`hash-limiter.ts`；`site.accounts` 输出 4、20）。合同测试能看到“并发 1、队长 0 时同时两个登录有一个
 * `overloaded`”（第 4b 片），排队 5 秒、队满、先来先得、关闭这些要控制时间与先后，只能在这里测：排队的时限用手动计时器，下限用
 * 注入的时钟与睡眠函数。
 */

import {describe, expect, it} from "bun:test";

import {ManualTimers, recordingLog} from "./testing/library";
import {HashLimiter, HashOverloadedError, startFailureFloor, type HashPermit} from "./hash-limiter";

function limiter(concurrency: number, queue: number) {
    const timers = new ManualTimers();
    const log = recordingLog();
    return {timers, log, limiter: new HashLimiter({concurrency, queue, timers, log})};
}

type Outcome = {readonly state: "pending"} | {readonly state: "granted"; readonly permit: HashPermit} | {readonly state: "rejected"; readonly error: unknown};

/** 发起一次 `acquire`，返回一个随时能读的结果。 */
function track(promise: Promise<HashPermit>): {get(): Outcome} {
    let outcome: Outcome = {state: "pending"};
    promise.then(
        (permit) => (outcome = {state: "granted", permit}),
        (error: unknown) => (outcome = {state: "rejected", error}),
    );
    return {get: () => outcome};
}

/** 让已 settle 的 Promise 的回调跑完（延迟为 0 的让步，不是等待）。 */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function granted(outcome: Outcome): HashPermit {
    if (outcome.state !== "granted") throw new Error(`expected a granted permit, got ${outcome.state}`);
    return outcome.permit;
}

function rejectedReason(outcome: Outcome): string {
    if (outcome.state !== "rejected" || !(outcome.error instanceof HashOverloadedError)) throw new Error(`expected HashOverloadedError, got ${outcome.state}`);
    return outcome.error.reason;
}

describe("同时在算的个数", () => {
    it("至多 concurrency 个；多出来的排队，有人放手才轮到", async () => {
        const {limiter: hashes} = limiter(2, 8);
        const first = track(hashes.acquire());
        const second = track(hashes.acquire());
        const third = track(hashes.acquire());
        await flush();
        expect([first.get().state, second.get().state, third.get().state]).toEqual(["granted", "granted", "pending"]);
        granted(first.get()).release();
        await flush();
        expect(third.get().state).toBe("granted");
    });

    it("排队的先来先得；放手只生效一次，多放一次不会把名额多给一个人", async () => {
        const {limiter: hashes} = limiter(1, 8);
        const active = track(hashes.acquire());
        const queued = [track(hashes.acquire()), track(hashes.acquire()), track(hashes.acquire())];
        await flush();
        const permit = granted(active.get());
        permit.release();
        permit.release();
        await flush();
        expect(queued.map((entry) => entry.get().state)).toEqual(["granted", "pending", "pending"]);
        granted(queued[0]!.get()).release();
        await flush();
        expect(queued.map((entry) => entry.get().state)).toEqual(["granted", "granted", "pending"]);
    });

    it("run 在 work 失败时也放手", async () => {
        const {limiter: hashes} = limiter(1, 0);
        const failure = new Error("hash failed");
        await expect(hashes.run(() => Promise.reject(failure))).rejects.toBe(failure);
        expect(await hashes.run(() => Promise.resolve("next"))).toBe("next");
    });
});

describe("排队的上限（输出 20）", () => {
    it("排队满了的新请求立即以 queue_full 失败；排着的不受影响", async () => {
        const {limiter: hashes} = limiter(1, 2);
        const active = track(hashes.acquire());
        const queued = [track(hashes.acquire()), track(hashes.acquire())];
        const overflow = track(hashes.acquire());
        await flush();
        expect(rejectedReason(overflow.get())).toBe("queue_full");
        granted(active.get()).release();
        await flush();
        expect(queued.map((entry) => entry.get().state)).toEqual(["granted", "pending"]);
    });

    it("队长 0 时不排队：名额满了就以 queue_full 失败", async () => {
        const {limiter: hashes} = limiter(1, 0);
        const active = track(hashes.acquire());
        const second = track(hashes.acquire());
        await flush();
        expect(active.get().state).toBe("granted");
        expect(rejectedReason(second.get())).toBe("queue_full");
    });

    it("排队到 5 秒以 queue_timeout 失败并出队：4999 毫秒时还在等，空出来的位置能再排一个，放手时不交给超时的那个", async () => {
        const {limiter: hashes, timers} = limiter(1, 1);
        const active = track(hashes.acquire());
        const late = track(hashes.acquire());
        await flush();
        timers.advance(4_999);
        await flush();
        expect(late.get().state).toBe("pending");
        timers.advance(1);
        await flush();
        expect(rejectedReason(late.get())).toBe("queue_timeout");
        const next = track(hashes.acquire());
        await flush();
        expect(next.get().state).toBe("pending");
        granted(active.get()).release();
        await flush();
        expect(next.get().state).toBe("granted");
    });

    it("排到了名额的不再超时", async () => {
        const {limiter: hashes, timers} = limiter(1, 1);
        const active = track(hashes.acquire());
        const queued = track(hashes.acquire());
        await flush();
        granted(active.get()).release();
        await flush();
        timers.advance(10_000);
        await flush();
        expect(queued.get().state).toBe("granted");
    });
});

describe("tryAcquire", () => {
    it("有空的名额就给，满了回 null、不排队；有人排队时也回 null，空出来的先归排着的人", async () => {
        const {limiter: hashes} = limiter(1, 4);
        const permit = hashes.tryAcquire();
        expect(permit).not.toBeNull();
        expect(hashes.tryAcquire()).toBeNull();
        const queued = track(hashes.acquire());
        permit!.release();
        expect(hashes.tryAcquire()).toBeNull();
        await flush();
        granted(queued.get()).release();
        expect(hashes.tryAcquire()).not.toBeNull();
    });
});

describe("关闭", () => {
    it("之后新的与排着的都以 closed 失败；在算的算完放手后 close 才 resolve", async () => {
        const {limiter: hashes} = limiter(1, 4);
        const active = track(hashes.acquire());
        const queued = track(hashes.acquire());
        await flush();
        let closed = false;
        void hashes.close(2_000).then(() => (closed = true));
        await flush();
        expect(rejectedReason(queued.get())).toBe("closed");
        expect(rejectedReason(await settled(hashes.acquire()))).toBe("closed");
        expect(hashes.tryAcquire()).toBeNull();
        expect(closed).toBe(false);
        granted(active.get()).release();
        await flush();
        expect(closed).toBe(true);
    });

    it("在算的到 waitMs 还没放手：记一行 identity.hash_close_timeout 照样 resolve", async () => {
        const {limiter: hashes, timers, log} = limiter(1, 0);
        track(hashes.acquire());
        await flush();
        let closed = false;
        void hashes.close(2_000).then(() => (closed = true));
        timers.advance(1_999);
        await flush();
        expect(closed).toBe(false);
        timers.advance(1);
        await flush();
        expect(closed).toBe(true);
        expect(log.lines.map((line) => line.event)).toEqual(["identity.hash_close_timeout"]);
    });

    it("没有在算的时立即 resolve", async () => {
        const {limiter: hashes} = limiter(2, 2);
        await hashes.close(2_000);
        expect(rejectedReason(await settled(hashes.acquire()))).toBe("closed");
    });
});

/** 等一次 `acquire` 落定。 */
async function settled(promise: Promise<HashPermit>): Promise<Outcome> {
    try {
        return {state: "granted", permit: await promise};
    } catch (error) {
        return {state: "rejected", error};
    }
}

describe("失败的下限（输出 4）", () => {
    function floorAt(start: number) {
        let now = start;
        const sleeps: number[] = [];
        const floor = startFailureFloor({
            now: () => now,
            sleep: (ms) => {
                sleeps.push(ms);
                now += ms;
                return Promise.resolve();
            },
        });
        return {floor, sleeps, advance: (ms: number) => (now += ms)};
    }

    // 150 毫秒是计划写定的下限（设计审查第 4 条）；这里写字面值，不从实现导入：下限改了，这条要跟着失败、跟着核对测量。
    it("失败时从起点起补齐到 150 毫秒", async () => {
        const {floor, sleeps, advance} = floorAt(1_000);
        advance(30);
        await floor.finish(false);
        expect(sleeps).toEqual([120]);
    });

    it("成功时不补", async () => {
        const {floor, sleeps, advance} = floorAt(1_000);
        advance(30);
        await floor.finish(true);
        expect(sleeps).toEqual([]);
    });

    it("已经超过下限的失败不再等", async () => {
        const {floor, sleeps, advance} = floorAt(1_000);
        advance(150);
        await floor.finish(false);
        advance(100);
        await floor.finish(false);
        expect(sleeps).toEqual([]);
    });

    it("起点是调用 startFailureFloor 的那一刻：之前过去的时间不算", async () => {
        let now = 5_000;
        const sleeps: number[] = [];
        const floor = startFailureFloor({now: () => now, sleep: (ms) => (sleeps.push(ms), Promise.resolve())});
        now += 10;
        await floor.finish(false);
        expect(sleeps).toEqual([140]);
    });
});
