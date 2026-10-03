import {afterEach, describe, expect, it, vi} from "vitest";
import {readStoredExchangeRate, resetCostDisplayForTest, useCostDisplay, writeStoredExchangeRate} from "nbook/app/composables/useCostDisplay";

function createStorage(): Pick<Storage, "getItem" | "setItem"> & {data: Record<string, string>} {
    const data: Record<string, string> = {};
    return {
        data,
        getItem: (key: string) => data[key] ?? null,
        setItem: (key: string, value: string) => {
            data[key] = value;
        },
    };
}

afterEach(() => {
    resetCostDisplayForTest();
});

describe("cost display exchange rate storage", () => {
    it("写入并读取本地汇率", () => {
        const storage = createStorage();

        writeStoredExchangeRate(storage, {
            rate: 7.2,
            fetchedAt: "2026-06-07T00:00:00.000Z",
            stale: false,
        });

        expect(readStoredExchangeRate(storage)).toEqual({
            rate: 7.2,
            fetchedAt: "2026-06-07T00:00:00.000Z",
            stale: false,
        });
    });

    it("损坏或非法本地汇率会被忽略", () => {
        const storage = createStorage();

        storage.setItem("nbook.costDisplay.usdToCnyRate", JSON.stringify({
            rate: -1,
            fetchedAt: "2026-06-07T00:00:00.000Z",
        }));

        expect(readStoredExchangeRate(storage)).toBeNull();
    });
});

describe("useCostDisplay exchange rate auto refresh", () => {
    it("CNY 且没有本地汇率时自动请求一次", async () => {
        const costDisplay = useCostDisplay();
        costDisplay.setCostCurrency("CNY");
        const fetcher = vi.fn(async () => ({
            base: "USD" as const,
            quote: "CNY" as const,
            rate: 7.2,
            source: "frankfurter" as const,
            fetchedAt: "2026-06-07T00:00:00.000Z",
            stale: false,
        }));

        await costDisplay.ensureExchangeRate(fetcher);

        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(costDisplay.usdToCnyRate.value).toBe(7.2);
    });

    it("已有汇率时不自动请求", async () => {
        const costDisplay = useCostDisplay();
        costDisplay.setCostCurrency("CNY");
        costDisplay.setExchangeRate({
            base: "USD",
            quote: "CNY",
            rate: 7.1,
            source: "frankfurter",
            fetchedAt: "2026-06-07T00:00:00.000Z",
            stale: false,
        });
        const fetcher = vi.fn(async () => {
            throw new Error("should not fetch");
        });

        await costDisplay.ensureExchangeRate(fetcher);

        expect(fetcher).toHaveBeenCalledTimes(0);
    });
});
