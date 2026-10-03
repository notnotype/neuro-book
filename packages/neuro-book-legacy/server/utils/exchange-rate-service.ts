export type SupportedExchangePair = {
    base: "USD";
    quote: "CNY";
};

export type ExchangeRateResult = SupportedExchangePair & {
    rate: number;
    source: "frankfurter";
    fetchedAt: string;
    stale: boolean;
};

type ExchangeRateCacheEntry = ExchangeRateResult & {
    fetchedAtMs: number;
};

type FrankfurterRateResponse = {
    amount?: number;
    base?: string;
    quote?: string;
    rate?: number;
};

type ExchangeRateFetch = (url: string) => Promise<unknown>;

export type ExchangeRateServiceOptions = {
    ttlMs?: number;
    fetchJson?: ExchangeRateFetch;
    now?: () => number;
};

const DEFAULT_EXCHANGE_RATE_TTL_MS = 24 * 60 * 60 * 1000;
const FRANKFURTER_USD_CNY_URL = "https://api.frankfurter.dev/v2/rate/USD/CNY";

/**
 * Frankfurter 汇率服务；只支持当前 UI 需要的 USD -> CNY。
 */
export class ExchangeRateService {
    private readonly ttlMs: number;
    private readonly fetchJson: ExchangeRateFetch;
    private readonly now: () => number;
    private cache: ExchangeRateCacheEntry | null = null;
    private pending: Promise<ExchangeRateResult> | null = null;

    constructor(options: ExchangeRateServiceOptions = {}) {
        this.ttlMs = options.ttlMs ?? DEFAULT_EXCHANGE_RATE_TTL_MS;
        this.fetchJson = options.fetchJson ?? defaultFetchJson;
        this.now = options.now ?? Date.now;
    }

    /**
     * 读取 USD/CNY 汇率；缓存未过期时不会访问外部 API。
     */
    async rate(pair: SupportedExchangePair): Promise<ExchangeRateResult> {
        this.assertSupported(pair);

        const cached = this.cache;
        if (cached && this.now() - cached.fetchedAtMs < this.ttlMs) {
            return this.publicResult(cached, false);
        }

        if (this.pending) {
            return this.pending;
        }

        this.pending = this.fetchFreshRate(cached);
        try {
            return await this.pending;
        } finally {
            this.pending = null;
        }
    }

    /**
     * 清空测试或手动刷新后的内存缓存。
     */
    clear(): void {
        this.cache = null;
        this.pending = null;
    }

    private async fetchFreshRate(previous: ExchangeRateCacheEntry | null): Promise<ExchangeRateResult> {
        try {
            const response = await this.fetchJson(FRANKFURTER_USD_CNY_URL);
            const rate = parseFrankfurterRate(response);
            const nowMs = this.now();
            const next: ExchangeRateCacheEntry = {
                base: "USD",
                quote: "CNY",
                rate,
                source: "frankfurter",
                fetchedAt: new Date(nowMs).toISOString(),
                fetchedAtMs: nowMs,
                stale: false,
            };
            this.cache = next;
            return this.publicResult(next, false);
        } catch (error) {
            if (previous) {
                return this.publicResult(previous, true);
            }
            throw new Error(`刷新 USD/CNY 汇率失败：${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private publicResult(entry: ExchangeRateCacheEntry, stale: boolean): ExchangeRateResult {
        return {
            base: entry.base,
            quote: entry.quote,
            rate: entry.rate,
            source: entry.source,
            fetchedAt: entry.fetchedAt,
            stale,
        };
    }

    private assertSupported(pair: SupportedExchangePair): void {
        if (pair.base !== "USD" || pair.quote !== "CNY") {
            throw new Error("当前只支持 USD -> CNY 汇率");
        }
    }
}

export const exchangeRateService = new ExchangeRateService();

/**
 * 使用原生 fetch 读取 JSON，避免为汇率功能新增依赖。
 */
async function defaultFetchJson(url: string): Promise<unknown> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Frankfurter HTTP ${response.status}`);
    }
    return response.json();
}

/**
 * 解析 Frankfurter v2 rate 响应。
 */
function parseFrankfurterRate(value: unknown): number {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Frankfurter 响应不是对象");
    }
    const response = value as FrankfurterRateResponse;
    const rate = response.rate;
    if (response.base !== "USD" || response.quote !== "CNY" || typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
        throw new Error("Frankfurter 响应缺少有效 USD/CNY 汇率");
    }
    return rate;
}
