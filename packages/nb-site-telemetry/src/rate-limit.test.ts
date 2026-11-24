/**
 * 限流的行为（docs/specs/site/telemetry-ingest.md 输出 8、9）：对齐的 10 分钟窗口、IPv6 按前 64 位计与前 48 位的合计、
 * 来源数的上限、Retry-After。合同测试只能从 127.0.0.1 发请求，这几条只能在这里测；时间用注入的时钟。
 */

import {describe, expect, it} from "bun:test";

import {createRateLimiter, PREFIX48_LIMIT_FACTOR, RATE_LIMIT_WINDOW_MS, type RateLimitDecision} from "./rate-limit";

/** 一个窗口的开头，任取一个对齐的时间。 */
const WINDOW_START = Math.floor(Date.parse("2026-11-24T12:00:00Z") / RATE_LIMIT_WINDOW_MS) * RATE_LIMIT_WINDOW_MS;

function limiterAt(limit: number, options: {readonly maxSources?: number} = {}) {
    let now = WINDOW_START;
    const limiter = createRateLimiter({limit, now: () => now, ...options});
    return {
        limiter,
        setNow: (ms: number) => {
            now = ms;
        },
    };
}

/** 从同一个来源连发 `count` 个，各自过没过。 */
function takeMany(take: (source: string) => RateLimitDecision, source: string, count: number): boolean[] {
    return Array.from({length: count}, () => take(source).ok);
}

const OK: RateLimitDecision = {ok: true};

describe("一个来源的额度", () => {
    it("每个窗口到额度为止；第 limit+1 个被拒，被拒的不计数", () => {
        const {limiter} = limiterAt(3);
        expect(takeMany(limiter.take, "198.51.100.7", 5)).toEqual([true, true, true, false, false]);
        // 别的来源不受影响。
        expect(limiter.take("198.51.100.8")).toEqual(OK);
    });

    it("Retry-After 是到这个窗口结束的秒数向上取整，至少 1", () => {
        const {limiter, setNow} = limiterAt(1);
        limiter.take("198.51.100.7");
        expect(limiter.take("198.51.100.7")).toEqual({ok: false, retryAfterSeconds: RATE_LIMIT_WINDOW_MS / 1000});
        setNow(WINDOW_START + 1);
        expect(limiter.take("198.51.100.7")).toEqual({ok: false, retryAfterSeconds: RATE_LIMIT_WINDOW_MS / 1000});
        setNow(WINDOW_START + RATE_LIMIT_WINDOW_MS - 1500);
        expect(limiter.take("198.51.100.7")).toEqual({ok: false, retryAfterSeconds: 2});
        setNow(WINDOW_START + RATE_LIMIT_WINDOW_MS - 1);
        expect(limiter.take("198.51.100.7")).toEqual({ok: false, retryAfterSeconds: 1});
    });

    it("窗口是对齐的：窗口最后一毫秒仍在旧窗口，下一个窗口一开始额度复原", () => {
        const {limiter, setNow} = limiterAt(2);
        setNow(WINDOW_START + RATE_LIMIT_WINDOW_MS - 10);
        expect(takeMany(limiter.take, "198.51.100.7", 3)).toEqual([true, true, false]);
        setNow(WINDOW_START + RATE_LIMIT_WINDOW_MS - 1);
        expect(limiter.take("198.51.100.7").ok).toBe(false);
        setNow(WINDOW_START + RATE_LIMIT_WINDOW_MS);
        expect(takeMany(limiter.take, "198.51.100.7", 3)).toEqual([true, true, false]);
    });

    it("不是 IP 字面量的来源抛 TypeError，不当作一个来源", () => {
        const {limiter} = limiterAt(1);
        for (const source of ["", "localhost", "198.51.100.256", "2001:db8::1::2", "::ffff:198.51.100.7.1"]) expect(() => limiter.take(source)).toThrow(TypeError);
        expect(limiter.sources()).toBe(0);
    });
});

describe("IPv6 按前缀计（输出 9）", () => {
    it("同一个 /64 里的地址合用一份额度，前缀按地址值取，不按字符串截", () => {
        const {limiter} = limiterAt(2);
        // 两个地址的压缩写法里 `::` 的位置不同，前 64 位相同：2001:db8:0:0。
        expect(limiter.take("2001:db8::1")).toEqual(OK);
        expect(limiter.take("2001:db8::1:0:0:2")).toEqual(OK);
        expect(limiter.take("2001:db8:0:0:ffff::3").ok).toBe(false);
        // 第 4 组不同就是另一个 /64。
        expect(limiter.take("2001:db8:0:1::1")).toEqual(OK);
        expect(limiter.sources()).toBe(2);
    });

    it(`同一个 /48 下的 /64 合计到单个来源额度的 ${PREFIX48_LIMIT_FACTOR} 倍为止；别的 /48 不受影响，被挡下的 /64 不占来源数`, () => {
        const limit = 2;
        const {limiter} = limiterAt(limit);
        const results: boolean[] = [];
        for (let subnet = 0; subnet < PREFIX48_LIMIT_FACTOR; subnet += 1) results.push(...takeMany(limiter.take, `2001:db8:7:${subnet.toString(16)}::1`, limit));
        expect(results.every(Boolean)).toBe(true);
        const sourcesBefore = limiter.sources();
        // 第 17 个 /64：它自己一次都没用过，但 /48 的合计满了。
        expect(limiter.take("2001:db8:7:ff::1").ok).toBe(false);
        expect(limiter.sources()).toBe(sourcesBefore);
        expect(limiter.take("2001:db8:8::1")).toEqual(OK);
    });
});

describe("来源数的上限", () => {
    it("满了之后新来源被拒，已有的来源照常用完自己的额度；下一个窗口新来源又能进", () => {
        const {limiter, setNow} = limiterAt(3, {maxSources: 2});
        expect(limiter.take("198.51.100.1")).toEqual(OK);
        expect(limiter.take("2001:db8::1")).toEqual(OK);
        const rejected = limiter.take("198.51.100.3");
        expect(rejected).toEqual({ok: false, retryAfterSeconds: RATE_LIMIT_WINDOW_MS / 1000});
        expect(takeMany(limiter.take, "198.51.100.1", 3)).toEqual([true, true, false]);
        setNow(WINDOW_START + RATE_LIMIT_WINDOW_MS);
        expect(limiter.take("198.51.100.3")).toEqual(OK);
    });
});

describe("清理（输出 8：来源地址只在内存里留到窗口结束）", () => {
    it("没有新请求时，sweep 在换了窗口之后清掉上一个窗口的来源；同一窗口里 sweep 不改计数", () => {
        const {limiter, setNow} = limiterAt(1);
        limiter.take("198.51.100.1");
        limiter.take("2001:db8::1");
        limiter.sweep();
        expect(limiter.sources()).toBe(2);
        expect(limiter.take("198.51.100.1").ok).toBe(false);
        setNow(WINDOW_START + RATE_LIMIT_WINDOW_MS);
        limiter.sweep();
        expect(limiter.sources()).toBe(0);
    });
});
