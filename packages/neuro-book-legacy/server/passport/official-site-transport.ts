import {createError} from "h3";
import {appLogger} from "nbook/server/app-logs/logger";
import {OFFICIAL_PASSPORT_SITE_URL} from "nbook/shared/passport/passport-constants";

export const OFFICIAL_SITE_TIMEOUT_MS = 10_000;

export type OfficialSiteOperation =
    | "passport.device.create"
    | "passport.token.exchange"
    | "passport.token.refresh"
    | "passport.authorization.revoke"
    | "backup.list"
    | "backup.upload"
    | "backup.metadata"
    | "backup.download"
    | "backup.delete";

type OfficialSiteFetchOptions = NonNullable<Parameters<typeof $fetch>[1]>;
type RawFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type FetchFailureShape = {
    response?: {status?: number};
    status?: number;
    statusCode?: number;
    name?: string;
    code?: string;
    cause?: unknown; // 外部 fetch/Undici 错误链没有统一类型。
};

/**
 * 调用官方站 JSON API。普通控制面请求总时限为 10 秒；大文件上传可显式传 null。
 */
export async function officialSiteFetch<T>(
    operation: OfficialSiteOperation,
    endpoint: string,
    options: OfficialSiteFetchOptions = {},
    timeoutMs: number | null = OFFICIAL_SITE_TIMEOUT_MS,
): Promise<T> {
    const startedAt = performance.now();
    const url = officialSiteUrl(endpoint);
    try {
        return await $fetch<T>(url, {
            ...options,
            ...(timeoutMs === null ? {} : {timeout: timeoutMs}),
        });
    } catch (error) {
        throw mapOfficialSiteError(error, operation, endpoint, startedAt);
    }
}

/**
 * 调用需要流式消费 body 的官方站端点。超时只覆盖取得响应头之前，不中断后续下载流。
 */
export async function officialSiteResponse(
    operation: OfficialSiteOperation,
    endpoint: string,
    init: RequestInit = {},
    fetchImplementation: RawFetch = fetch,
    timeoutMs = OFFICIAL_SITE_TIMEOUT_MS,
): Promise<Response> {
    const startedAt = performance.now();
    const url = officialSiteUrl(endpoint);
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(new DOMException("official site request timeout", "TimeoutError")), timeoutMs);
    const signal = init.signal
        ? AbortSignal.any([init.signal, timeoutController.signal])
        : timeoutController.signal;
    try {
        const response = await fetchImplementation(url, {...init, signal});
        if (response.status >= 500) {
            throw upstreamStatusError(response.status);
        }
        return response;
    } catch (error) {
        throw mapOfficialSiteError(error, operation, endpoint, startedAt);
    } finally {
        clearTimeout(timeout);
    }
}

/** 把 endpoint 约束在固定官网 origin 下，拒绝绝对 URL 和非 API 路径。 */
function officialSiteUrl(endpoint: string): string {
    if (!endpoint.startsWith("/api/") || endpoint.startsWith("//") || endpoint.includes("?") || endpoint.includes("#")) {
        throw new Error(`官方站 endpoint 非法：${endpoint}`);
    }
    return `${OFFICIAL_PASSPORT_SITE_URL}${endpoint}`;
}

/** 只改写无响应或 5xx；OAuth/配额等有响应 4xx 保留原始业务语义。 */
function mapOfficialSiteError(
    error: unknown,
    operation: OfficialSiteOperation,
    endpoint: string,
    startedAt: number,
): unknown {
    const statusCode = responseStatus(error);
    if (statusCode !== null && statusCode < 500) {
        return error;
    }
    const causeCode = safeCauseCode(error);
    const failure = statusCode !== null ? "upstream_5xx" : isTimeoutError(error) ? "timeout" : "network";
    void appLogger.warn("passport.officialSite.requestFailed", {
        operation,
        endpoint,
        failure,
        causeCode,
        upstreamStatus: statusCode,
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
    }, "NeuroBook 官方站请求失败");

    if (statusCode !== null) {
        return createError({
            statusCode: 502,
            message: "NeuroBook 官方站暂时不可用，请稍后重试",
            data: {error: "passport_site_unavailable"},
        });
    }
    return createError({
        statusCode: 502,
        message: "无法连接 NeuroBook 官方站，请检查 DNS 或代理设置",
        data: {error: "passport_site_unreachable"},
    });
}

function responseStatus(error: unknown): number | null {
    const failure = asFetchFailure(error);
    const status = failure.response?.status ?? failure.statusCode ?? failure.status;
    return typeof status === "number" && Number.isInteger(status) ? status : null;
}

function safeCauseCode(error: unknown): string | null {
    let current: unknown = error; // 仅遍历外部错误 cause 链，不序列化完整异常。
    for (let depth = 0; depth < 5; depth += 1) {
        const failure = asFetchFailure(current);
        if (typeof failure.code === "string" && /^[A-Z0-9_]{2,100}$/u.test(failure.code)) {
            return failure.code;
        }
        current = failure.cause;
        if (current === undefined || current === null) {
            break;
        }
    }
    return null;
}

function isTimeoutError(error: unknown): boolean {
    let current: unknown = error; // Undici/ofetch 可能把 TimeoutError 包在多层 cause 中。
    for (let depth = 0; depth < 5; depth += 1) {
        const failure = asFetchFailure(current);
        if (failure.name === "TimeoutError" || failure.name === "AbortError"
            || failure.code === "ABORT_ERR" || failure.code === "UND_ERR_CONNECT_TIMEOUT") {
            return true;
        }
        current = failure.cause;
        if (current === undefined || current === null) {
            break;
        }
    }
    return false;
}

function asFetchFailure(error: unknown): FetchFailureShape {
    return typeof error === "object" && error !== null ? error as FetchFailureShape : {};
}

function upstreamStatusError(status: number): Error & {statusCode: number} {
    return Object.assign(new Error(`official site responded HTTP ${status}`), {statusCode: status});
}
