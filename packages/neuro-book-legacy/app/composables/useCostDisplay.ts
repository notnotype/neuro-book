import {computed, ref} from "vue";
import type {CostDisplayCurrency, CostDisplayOptions} from "nbook/app/utils/cost-format";
import type {ExchangeRateDto} from "nbook/shared/dto/config.dto";

const COST_EXCHANGE_RATE_STORAGE_KEY = "nbook.costDisplay.usdToCnyRate";

export type StoredCostExchangeRate = {
    rate: number;
    fetchedAt: string;
    stale: boolean;
};

const costCurrency = ref<CostDisplayCurrency>("USD");
const usdToCnyRate = ref<number | null>(null);
const exchangeRateFetchedAt = ref<string | null>(null);
const exchangeRateStale = ref(false);
let restoredFromStorage = false;
let pendingAutoRefresh: Promise<void> | null = null;

type ExchangeRateFetcher = () => Promise<ExchangeRateDto>;

/**
 * 共享费用显示偏好；汇率只在设置页显式刷新后进入当前前端会话。
 */
export function useCostDisplay() {
    restoreExchangeRate();

    const costDisplayOptions = computed<CostDisplayOptions>(() => ({
        currency: costCurrency.value,
        usdToCnyRate: usdToCnyRate.value,
    }));

    /**
     * 同步已保存的 UI 显示币种。
     */
    function setCostCurrency(currency: CostDisplayCurrency): void {
        costCurrency.value = currency;
    }

    /**
     * 保存后端汇率响应，供 Agent 显示复用。
     */
    function setExchangeRate(rate: ExchangeRateDto): void {
        usdToCnyRate.value = rate.rate;
        exchangeRateFetchedAt.value = rate.fetchedAt;
        exchangeRateStale.value = rate.stale;
        persistExchangeRate({
            rate: rate.rate,
            fetchedAt: rate.fetchedAt,
            stale: rate.stale,
        });
    }

    /**
     * CNY 显示且本地没有汇率时，自动向后端缓存 API 请求一次。
     */
    async function ensureExchangeRate(fetcher: ExchangeRateFetcher): Promise<void> {
        if (costCurrency.value !== "CNY" || usdToCnyRate.value || pendingAutoRefresh) {
            return pendingAutoRefresh ?? Promise.resolve();
        }
        pendingAutoRefresh = fetcher()
            .then((rate) => {
                setExchangeRate(rate);
            })
            .catch(() => {
                // 自动刷新失败不打扰用户；设置页手动刷新仍会显示 notification。
            })
            .finally(() => {
                pendingAutoRefresh = null;
            });
        return pendingAutoRefresh;
    }

    return {
        costCurrency,
        usdToCnyRate,
        exchangeRateFetchedAt,
        exchangeRateStale,
        costDisplayOptions,
        setCostCurrency,
        setExchangeRate,
        ensureExchangeRate,
    };
}

/**
 * 从浏览器本地存储恢复上一次手动刷新得到的汇率，不触发网络请求。
 */
function restoreExchangeRate(): void {
    if (restoredFromStorage || !import.meta.client) {
        return;
    }
    restoredFromStorage = true;
    const restored = readStoredExchangeRate(window.localStorage);
    if (restored) {
        usdToCnyRate.value = restored.rate;
        exchangeRateFetchedAt.value = restored.fetchedAt;
        exchangeRateStale.value = restored.stale;
    }
}

/**
 * 持久化手动刷新的汇率，避免浏览器刷新后丢失。
 */
function persistExchangeRate(rate: StoredCostExchangeRate): void {
    if (!import.meta.client) {
        return;
    }
    writeStoredExchangeRate(window.localStorage, rate);
}

/**
 * 从指定 storage 读取已保存汇率。
 */
export function readStoredExchangeRate(storage: Pick<Storage, "getItem">): StoredCostExchangeRate | null {
    try {
        const raw = storage.getItem(COST_EXCHANGE_RATE_STORAGE_KEY);
        if (!raw) {
            return null;
        }
        const parsed = JSON.parse(raw) as Partial<StoredCostExchangeRate>;
        if (typeof parsed.rate !== "number" || !Number.isFinite(parsed.rate) || parsed.rate <= 0 || typeof parsed.fetchedAt !== "string") {
            return null;
        }
        return {
            rate: parsed.rate,
            fetchedAt: parsed.fetchedAt,
            stale: parsed.stale ?? true,
        };
    } catch {
        return null;
    }
}

/**
 * 写入已保存汇率。
 */
export function writeStoredExchangeRate(storage: Pick<Storage, "setItem">, rate: StoredCostExchangeRate): void {
    try {
        storage.setItem(COST_EXCHANGE_RATE_STORAGE_KEY, JSON.stringify(rate));
    } catch {
        // 存储不可用时只影响刷新后恢复，不影响当前会话展示。
    }
}

/**
 * 重置内存状态；仅用于窄测试。
 */
export function resetCostDisplayForTest(): void {
    costCurrency.value = "USD";
    usdToCnyRate.value = null;
    exchangeRateFetchedAt.value = null;
    exchangeRateStale.value = false;
    restoredFromStorage = false;
    pendingAutoRefresh = null;
}
