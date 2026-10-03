import {describe, expect, it} from "vitest";
import {promptCacheHitRate, promptCacheTotalTokens} from "nbook/app/utils/prompt-cache";

describe("prompt cache 口径", () => {
    it("prompt 总量包含 cacheWrite", () => {
        expect(promptCacheTotalTokens({input: 100, cacheRead: 800, cacheWrite: 100})).toBe(1000);
    });

    it("命中率分母含 cacheWrite —— 漏掉会系统性偏高", () => {
        const usage = {input: 100, cacheRead: 800, cacheWrite: 100};
        expect(promptCacheHitRate(usage)).toBe(80);
        // 旧口径 cacheRead / (input + cacheRead) 会算成 88.9%。
        expect(usage.cacheRead / (usage.input + usage.cacheRead) * 100).toBeCloseTo(88.9, 1);
    });

    it("首轮全量写缓存时命中率为 0，不会因为分母漏项而虚高", () => {
        expect(promptCacheHitRate({input: 0, cacheRead: 0, cacheWrite: 50_000})).toBe(0);
    });

    it("总量为 0 时返回 null，让调用方显示「—」而不是 0%", () => {
        expect(promptCacheHitRate({input: 0, cacheRead: 0, cacheWrite: 0})).toBeNull();
    });
});
