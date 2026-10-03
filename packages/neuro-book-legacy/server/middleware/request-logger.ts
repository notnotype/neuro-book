import {appLogger} from "nbook/server/app-logs/logger";

const SENSITIVE_QUERY_PATTERN = /(authorization|cookie|api[-_]?key|apikey|password|token|secret|credential|recovery[-_]?code|backup[-_]?key|backup[-_]?keyring)/iu;
const STATIC_ASSET_PATTERN = /\.(?:css|js|mjs|map|png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf)$/iu;

type QuerySummary = {
    params: Array<{
        key: string;
        valueCount: number;
        redacted: boolean;
    }>;
    truncated: boolean;
};

/**
 * 记录请求摘要。只写 URL 路径、安全 query 摘要、状态码和耗时。
 */
export default defineEventHandler((event) => {
    const startedAt = performance.now();
    const url = getRequestURL(event);

    event.node.res.once("finish", () => {
        const statusCode = event.node.res.statusCode;
        if (shouldSkipRequestLog(url.pathname, statusCode)) {
            return;
        }

        const data = {
            method: event.method,
            path: url.pathname,
            query: summarizeQuery(url.searchParams),
            statusCode,
            durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
        };
        if (statusCode >= 500) {
            void appLogger.error("http.request", data);
            return;
        }
        if (statusCode >= 400) {
            void appLogger.warn("http.request", data);
            return;
        }
        void appLogger.info("http.request", data);
    });
});

function shouldSkipRequestLog(pathname: string, statusCode: number): boolean {
    if (statusCode >= 400) {
        return false;
    }
    return pathname.startsWith("/_nuxt/")
        || pathname.startsWith("/__nuxt")
        || STATIC_ASSET_PATTERN.test(pathname);
}

export function summarizeQuery(searchParams: URLSearchParams): QuerySummary | null {
    const params: QuerySummary["params"] = [];
    let truncated = false;
    let count = 0;
    for (const key of new Set(searchParams.keys())) {
        if (count >= 20) {
            truncated = true;
            break;
        }
        count += 1;
        const values = searchParams.getAll(key);
        params.push({
            key: truncateQueryKey(key),
            valueCount: values.length,
            redacted: SENSITIVE_QUERY_PATTERN.test(key),
        });
    }
    return params.length > 0 ? {params, truncated} : null;
}

function truncateQueryKey(value: string): string {
    if (value.length <= 80) {
        return value;
    }
    return `${value.slice(0, 80)}... [truncated]`;
}
