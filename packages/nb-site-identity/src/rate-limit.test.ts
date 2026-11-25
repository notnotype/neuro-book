/**
 * 限流（`rate-limit.ts`；`site.accounts` 输出 19）：对齐的窗口、IPv6 按前 64 位计与前 48 位的合计、多键一起判、失败计数、键满了以后
 * 的溢出额度。合同测试能从转发头造任意来源地址，但造不出 10 万个键，也不便逐个核对每个计数器的边界，这几条在这里测；时间用注入的时钟。
 *
 * Spec 写明的数（30、10、20、5、16 倍、10 倍、10 万）在用例里写字面值，不从实现导入：实现里的常量改了，用例要跟着失败。
 */

import {describe, expect, it} from "bun:test";

import {recordingLog} from "./testing/library";
import {createIdentityRateLimits, FailureCounter, RateLimitCounter, SourceRateLimitCounter, takeAll, type RateLimitDecision} from "./rate-limit";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const FIVE_MINUTES = 5 * MINUTE;

/** 任取一个整点：它同时是 5 分钟与 1 小时窗口的开头。 */
const WINDOW_START = Date.parse("2026-11-25T12:00:00Z");

function clockAt(start = WINDOW_START) {
    let now = start;
    return {
        now: () => now,
        set: (ms: number) => {
            now = ms;
        },
        advance: (ms: number) => {
            now += ms;
        },
    };
}

function counter(limit: number, options: {readonly maxKeys?: number; readonly windowMs?: number} = {}) {
    const clock = clockAt();
    const log = recordingLog();
    return {clock, log, counter: new RateLimitCounter({name: "test", limit, windowMs: options.windowMs ?? FIVE_MINUTES, now: clock.now, log, ...(options.maxKeys === undefined ? {} : {maxKeys: options.maxKeys})})};
}

function sourceCounter(limit: number, options: {readonly maxKeys?: number} = {}) {
    const clock = clockAt();
    const log = recordingLog();
    return {clock, log, counter: new SourceRateLimitCounter({name: "test", limit, windowMs: FIVE_MINUTES, now: clock.now, log, ...options})};
}

function takeMany(take: (key: string) => RateLimitDecision, key: string, count: number): boolean[] {
    return Array.from({length: count}, () => take(key).ok);
}

const OK: RateLimitDecision = {ok: true};

describe("一个键的额度与窗口", () => {
    it("每个窗口到额度为止；被拒的不计数；别的键不受影响", () => {
        const {counter: limit} = counter(3);
        expect(takeMany((key) => limit.take(key), "a", 5)).toEqual([true, true, true, false, false]);
        expect(limit.take("b")).toEqual(OK);
    });

    it("check 只判不计，commit 才计", () => {
        const {counter: limit} = counter(1);
        expect(limit.check("a").ok).toBe(true);
        expect(limit.check("a").ok).toBe(true);
        const check = limit.check("a");
        if (check.ok) check.commit();
        expect(limit.check("a").ok).toBe(false);
    });

    it("Retry-After 是到这个窗口结束的秒数向上取整，至少 1", () => {
        const {counter: limit, clock} = counter(1);
        limit.take("a");
        expect(limit.take("a")).toEqual({ok: false, retryAfterSeconds: 300});
        clock.set(WINDOW_START + FIVE_MINUTES - 1500);
        expect(limit.take("a")).toEqual({ok: false, retryAfterSeconds: 2});
        clock.set(WINDOW_START + FIVE_MINUTES - 1);
        expect(limit.take("a")).toEqual({ok: false, retryAfterSeconds: 1});
    });

    it("窗口是对齐的：最后一毫秒仍在旧窗口，下一个窗口一开始额度复原", () => {
        const {counter: limit, clock} = counter(2);
        clock.set(WINDOW_START + FIVE_MINUTES - 10);
        expect(takeMany((key) => limit.take(key), "a", 3)).toEqual([true, true, false]);
        clock.set(WINDOW_START + FIVE_MINUTES);
        expect(takeMany((key) => limit.take(key), "a", 3)).toEqual([true, true, false]);
    });

    it("没有新请求时，sweep 在换了窗口之后清掉上一个窗口的键；同一窗口里 sweep 不改计数", () => {
        const {counter: limit, clock} = counter(1);
        limit.take("a");
        limit.take("b");
        limit.sweep();
        expect(limit.keys()).toBe(2);
        expect(limit.take("a").ok).toBe(false);
        clock.set(WINDOW_START + FIVE_MINUTES);
        limit.sweep();
        expect(limit.keys()).toBe(0);
    });
});

describe("键满了以后（设计审查第 6 条）", () => {
    it("新键共用一份溢出额度，为上限的 10 倍；已有的键照常用自己的额度", () => {
        const {counter: limit} = counter(2, {maxKeys: 2});
        limit.take("a");
        limit.take("b");
        // 20 个新键、每个一次，都进溢出额度；第 21 次被拒，不论是哪个新键。
        const overflow = Array.from({length: 21}, (_, index) => limit.take(`new-${String(index)}`).ok);
        expect(overflow.slice(0, 20).every(Boolean)).toBe(true);
        expect(overflow[20]).toBe(false);
        expect(limit.take("new-0")).toEqual({ok: false, retryAfterSeconds: 300});
        expect(limit.keys()).toBe(2);
        expect(takeMany((key) => limit.take(key), "a", 2)).toEqual([true, false]);
    });

    it("已经过去的窗口的键不占名额：下一个窗口新键又有自己的条目，溢出额度也复原", () => {
        const {counter: limit, clock} = counter(1, {maxKeys: 1});
        limit.take("a");
        expect(takeMany((key) => limit.take(key), "new", 11)).toEqual([...new Array<boolean>(10).fill(true), false]);
        clock.set(WINDOW_START + FIVE_MINUTES);
        expect(limit.take("new")).toEqual(OK);
        expect(limit.keys()).toBe(1);
        expect(limit.take("new").ok).toBe(false);
    });

    it("满着的时候记 identity.rate_limit_full，同一个计数器一分钟至多一行", () => {
        const {counter: limit, clock, log} = counter(5, {maxKeys: 1, windowMs: HOUR});
        limit.take("a");
        limit.take("x");
        limit.take("y");
        clock.advance(MINUTE - 1);
        limit.take("z");
        expect(log.lines).toEqual([{level: "warn", event: "identity.rate_limit_full", fields: {counter: "test", maxKeys: 1}}]);
        clock.advance(1);
        limit.take("z");
        expect(log.lines.length).toBe(2);
    });

    it("缺省的上限是 10 万个键：第 100000 个新键有自己的条目，第 100001 个进溢出额度", () => {
        const {counter: limit} = counter(1);
        const first = Array.from({length: 100_000}, (_, index) => limit.take(`k${String(index)}`).ok);
        expect(first.every(Boolean)).toBe(true);
        expect(limit.keys()).toBe(100_000);
        expect(limit.take("k100000")).toEqual(OK);
        expect(limit.keys()).toBe(100_000);
        expect(limit.take("k0").ok).toBe(false);
    });
});

describe("按来源地址计", () => {
    it("IPv4 一个地址一个键", () => {
        const {counter: limit} = sourceCounter(1);
        expect(limit.take("198.51.100.7")).toEqual(OK);
        expect(limit.take("198.51.100.7").ok).toBe(false);
        expect(limit.take("198.51.100.8")).toEqual(OK);
    });

    it("同一个 /64 里的地址合用一份额度，前缀按地址值取，不按字符串截", () => {
        const {counter: limit} = sourceCounter(2);
        expect(limit.take("2001:db8::1")).toEqual(OK);
        expect(limit.take("2001:db8::1:0:0:2")).toEqual(OK);
        expect(limit.take("2001:db8:0:0:ffff::3").ok).toBe(false);
        expect(limit.take("2001:db8:0:1::1")).toEqual(OK);
        expect(limit.keys()).toBe(2);
    });

    it("同一个 /48 下的 /64 合计到单个来源额度的 16 倍为止；被挡下的 /64 不建条目；别的 /48 不受影响", () => {
        const {counter: limit} = sourceCounter(2);
        const results: boolean[] = [];
        for (let subnet = 0; subnet < 16; subnet += 1) results.push(...takeMany((address) => limit.take(address), `2001:db8:7:${subnet.toString(16)}::1`, 2));
        expect(results.every(Boolean)).toBe(true);
        const before = limit.keys();
        expect(limit.take("2001:db8:7:ff::1")).toEqual({ok: false, retryAfterSeconds: 300});
        expect(limit.keys()).toBe(before);
        expect(limit.take("2001:db8:8::1")).toEqual(OK);
    });

    it("被 /64 自己的额度挡下的不计入 /48 的合计", () => {
        const {counter: limit} = sourceCounter(1);
        limit.take("2001:db8:7::1");
        // 同一个 /64 再试 100 次都被拒；若被拒的也计入 /48，下面 15 个别的 /64 就进不来。
        for (let attempt = 0; attempt < 100; attempt += 1) limit.take("2001:db8:7::1");
        const others = Array.from({length: 15}, (_, subnet) => limit.take(`2001:db8:7:${(subnet + 1).toString(16)}::1`).ok);
        expect(others.every(Boolean)).toBe(true);
    });

    it("不是 IP 字面量的来源抛 TypeError，不当作一个来源", () => {
        const {counter: limit} = sourceCounter(1);
        for (const address of ["", "localhost", "198.51.100.256", "2001:db8::1::2", "::ffff:198.51.100.7.1"]) expect(() => limit.take(address)).toThrow(TypeError);
        expect(limit.keys()).toBe(0);
    });
});

describe("多个键一起判（omp 设计审查第 3、19 条）", () => {
    it("每个键都判；没超限的计入、超限的不计入；任一个超限就整体拒绝", () => {
        const {counter: wide} = counter(5);
        const {counter: narrow} = counter(1);
        expect(takeAll([wide.check("k"), narrow.check("k")])).toEqual(OK);
        // narrow 已满：整体拒绝，但 wide 照样计入。
        expect(takeAll([wide.check("k"), narrow.check("k")]).ok).toBe(false);
        expect(takeMany((key) => wide.take(key), "k", 4)).toEqual([true, true, true, false]);
    });

    it("Retry-After 取超限的键里最晚恢复的那个", () => {
        const clock = clockAt(WINDOW_START + FIVE_MINUTES - 10_000);
        const log = recordingLog();
        const short = new RateLimitCounter({name: "short", limit: 1, windowMs: FIVE_MINUTES, now: clock.now, log});
        const long = new RateLimitCounter({name: "long", limit: 1, windowMs: HOUR, now: clock.now, log});
        short.take("k");
        long.take("k");
        expect(takeAll([short.check("k"), long.check("k")])).toEqual({ok: false, retryAfterSeconds: 3_310});
        expect(takeAll([short.check("k")])).toEqual({ok: false, retryAfterSeconds: 10});
    });
});

describe("失败计数", () => {
    function failures(options: {readonly maxKeys?: number} = {}) {
        const clock = clockAt();
        const log = recordingLog();
        return {clock, log, failures: new FailureCounter({name: "test", threshold: 3, windowMs: HOUR, now: clock.now, log, ...options})};
    }

    it("只加不判；到阈值以后要先等；下一个窗口清零", () => {
        const {failures: counts, clock} = failures();
        counts.add("u");
        counts.add("u");
        expect(counts.overThreshold("u")).toBe(false);
        counts.add("u");
        expect(counts.overThreshold("u")).toBe(true);
        expect(counts.overThreshold("v")).toBe(false);
        clock.set(WINDOW_START + HOUR);
        expect(counts.overThreshold("u")).toBe(false);
    });

    it("键满了以后，新出现的用户名一律当作已过阈值、记 identity.rate_limit_full；已有的照常", () => {
        const {failures: counts, log} = failures({maxKeys: 1});
        counts.add("u");
        counts.add("v");
        expect(counts.overThreshold("u")).toBe(false);
        expect(counts.overThreshold("v")).toBe(true);
        expect(counts.overThreshold("never-failed")).toBe(true);
        expect(counts.keys()).toBe(1);
        expect(log.lines.map((line) => line.event)).toEqual(["identity.rate_limit_full"]);
    });
});

describe("账号模块的五个计数器（输出 19 的数）", () => {
    function limits() {
        const clock = clockAt();
        return {clock, limits: createIdentityRateLimits({now: clock.now, log: recordingLog()})};
    }

    it("登录·来源加用户名每 5 分钟 10 次；用户名不分大小写；同一个 /64 里换地址也算同一个", () => {
        const {limits: l, clock} = limits();
        const results = Array.from({length: 11}, (_, index) => l.login(`2001:db8::${(index + 1).toString(16)}`, index % 2 === 0 ? "Alice" : "alice").ok);
        expect(results).toEqual([...new Array<boolean>(10).fill(true), false]);
        expect(l.login("2001:db8::1", "bob")).toEqual(OK);
        clock.set(WINDOW_START + FIVE_MINUTES);
        expect(l.login("2001:db8::1", "alice")).toEqual(OK);
    });

    it("登录·来源每 5 分钟 30 次，不论用户名；别的来源不受影响", () => {
        const {limits: l} = limits();
        const results = Array.from({length: 31}, (_, index) => l.login("198.51.100.7", `user${String(index)}`).ok);
        expect(results).toEqual([...new Array<boolean>(30).fill(true), false]);
        expect(l.login("198.51.100.8", "user0")).toEqual(OK);
    });

    it("被来源加用户名挡下的那次照样计入来源：同一个来源换着用户名，各 10 次之后来源也会满", () => {
        const {limits: l} = limits();
        // 每个用户名试 15 次：前 10 次过，后 5 次被来源加用户名挡下，但都计入来源。两个用户名一共 30 次，来源满了。
        const first = Array.from({length: 15}, () => l.login("198.51.100.7", "alice").ok);
        const second = Array.from({length: 15}, () => l.login("198.51.100.7", "bob").ok);
        expect(first.filter(Boolean).length + second.filter(Boolean).length).toBe(20);
        expect(l.login("198.51.100.7", "carol")).toEqual({ok: false, retryAfterSeconds: 300});
    });

    it("登录·失败每小时 20 次以后先等；成功不清零", () => {
        const {limits: l, clock} = limits();
        for (let attempt = 0; attempt < 19; attempt += 1) l.recordLoginFailure("Alice");
        expect(l.loginNeedsDelay("alice")).toBe(false);
        l.recordLoginFailure("alice");
        expect(l.loginNeedsDelay("ALICE")).toBe(true);
        expect(l.loginNeedsDelay("bob")).toBe(false);
        clock.set(WINDOW_START + HOUR);
        expect(l.loginNeedsDelay("alice")).toBe(false);
    });

    it("注册按来源每小时 5 次；改密码按账号每小时 5 次", () => {
        const {limits: l, clock} = limits();
        expect(Array.from({length: 6}, () => l.register("198.51.100.7").ok)).toEqual([true, true, true, true, true, false]);
        expect(l.register("198.51.100.8")).toEqual(OK);
        expect(Array.from({length: 6}, () => l.changePassword(7).ok)).toEqual([true, true, true, true, true, false]);
        expect(l.changePassword("8")).toEqual(OK);
        clock.set(WINDOW_START + HOUR - 1);
        expect(l.register("198.51.100.7")).toEqual({ok: false, retryAfterSeconds: 1});
        clock.set(WINDOW_START + HOUR);
        expect(l.register("198.51.100.7")).toEqual(OK);
        expect(l.changePassword(7)).toEqual(OK);
    });

    it("注册的 IPv6 /48 合计是 5 的 16 倍", () => {
        const {limits: l} = limits();
        const results: boolean[] = [];
        for (let subnet = 0; subnet < 17; subnet += 1) results.push(...Array.from({length: 5}, () => l.register(`2001:db8:9:${subnet.toString(16)}::1`).ok));
        expect(results.filter(Boolean).length).toBe(80);
        expect(results.slice(80).some(Boolean)).toBe(false);
    });
});
