import {describe, expect, it, vi} from "vitest";
import {ExchangeRateService} from "nbook/server/utils/exchange-rate-service";

function frankfurterRate(rate: number): unknown {
    return {
        amount: 1,
        base: "USD",
        quote: "CNY",
        rate,
    };
}

describe("ExchangeRateService", () => {
    it("首次请求调用 Frankfurter，TTL 内命中缓存", async () => {
        let now = 1_000;
        const fetchJson = vi.fn(async () => frankfurterRate(7.2));
        const service = new ExchangeRateService({ttlMs: 10_000, now: () => now, fetchJson});

        await expect(service.rate({base: "USD", quote: "CNY"})).resolves.toMatchObject({rate: 7.2, stale: false});
        now += 1_000;
        await expect(service.rate({base: "USD", quote: "CNY"})).resolves.toMatchObject({rate: 7.2, stale: false});

        expect(fetchJson).toHaveBeenCalledTimes(1);
    });

    it("缓存过期后重新请求", async () => {
        let now = 1_000;
        const fetchJson = vi.fn()
            .mockResolvedValueOnce(frankfurterRate(7.1))
            .mockResolvedValueOnce(frankfurterRate(7.3));
        const service = new ExchangeRateService({ttlMs: 10_000, now: () => now, fetchJson});

        await expect(service.rate({base: "USD", quote: "CNY"})).resolves.toMatchObject({rate: 7.1});
        now += 11_000;
        await expect(service.rate({base: "USD", quote: "CNY"})).resolves.toMatchObject({rate: 7.3});

        expect(fetchJson).toHaveBeenCalledTimes(2);
    });

    it("并发请求复用同一个 pending promise", async () => {
        const fetchJson = vi.fn(async () => {
            await Promise.resolve();
            return frankfurterRate(7.2);
        });
        const service = new ExchangeRateService({ttlMs: 10_000, fetchJson});

        const [left, right] = await Promise.all([
            service.rate({base: "USD", quote: "CNY"}),
            service.rate({base: "USD", quote: "CNY"}),
        ]);

        expect(left.rate).toBe(7.2);
        expect(right.rate).toBe(7.2);
        expect(fetchJson).toHaveBeenCalledTimes(1);
    });

    it("刷新失败但有旧缓存时返回 stale", async () => {
        let now = 1_000;
        const fetchJson = vi.fn()
            .mockResolvedValueOnce(frankfurterRate(7.2))
            .mockRejectedValueOnce(new Error("network down"));
        const service = new ExchangeRateService({ttlMs: 10_000, now: () => now, fetchJson});

        await service.rate({base: "USD", quote: "CNY"});
        now += 11_000;

        await expect(service.rate({base: "USD", quote: "CNY"})).resolves.toMatchObject({
            rate: 7.2,
            stale: true,
        });
    });

    it("无缓存且请求失败时抛出可读错误", async () => {
        const service = new ExchangeRateService({
            fetchJson: vi.fn(async () => {
                throw new Error("network down");
            }),
        });

        await expect(service.rate({base: "USD", quote: "CNY"})).rejects.toThrow("刷新 USD/CNY 汇率失败");
    });
});
