export type CostDisplayCurrency = "USD" | "CNY";

export type CostDisplayOptions = {
    currency: CostDisplayCurrency;
    usdToCnyRate?: number | null;
};

/**
 * 格式化可展示费用；0 或缺失表示当前没有可展示价格。
 */
export function formatCost(valueUsd: number | null | undefined, options: CostDisplayOptions): string {
    const converted = convertCost(valueUsd, options);
    if (!converted) {
        return "";
    }
    return `${converted.symbol}${new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 4,
        maximumFractionDigits: converted.value < 0.0001 ? 8 : 4,
    }).format(converted.value)}`;
}

/**
 * 格式化 tooltip 里的费用拆分。
 */
export function formatCostExact(valueUsd: number | null | undefined, options: CostDisplayOptions): string {
    return formatCost(valueUsd, options) || `${options.currency === "CNY" && validRate(options.usdToCnyRate) ? "¥" : "$"}0.0000`;
}

/**
 * 当前是否实际使用了 CNY 汇率。
 */
export function usingCnyRate(options: CostDisplayOptions): boolean {
    return options.currency === "CNY" && validRate(options.usdToCnyRate);
}

function convertCost(valueUsd: number | null | undefined, options: CostDisplayOptions): {value: number; symbol: "$" | "¥"} | null {
    if (typeof valueUsd !== "number" || !Number.isFinite(valueUsd) || valueUsd <= 0) {
        return null;
    }
    if (usingCnyRate(options)) {
        return {
            value: valueUsd * options.usdToCnyRate!,
            symbol: "¥",
        };
    }
    return {
        value: valueUsd,
        symbol: "$",
    };
}

function validRate(rate: number | null | undefined): rate is number {
    return typeof rate === "number" && Number.isFinite(rate) && rate > 0;
}
