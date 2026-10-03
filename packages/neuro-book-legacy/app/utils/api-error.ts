const DEFAULT_API_ERROR_MESSAGE = "请求失败";

type I18nRuntime = {
    t: (key: string) => string;
};

/**
 * 读取当前前端 locale 下的默认 API 错误文案；测试或非 Nuxt 上下文回退中文。
 */
function resolveDefaultApiErrorMessage(): string {
    try {
        const nuxtApp = useNuxtApp() as {$i18n?: I18nRuntime};
        return nuxtApp.$i18n?.t("api.requestFailed") ?? DEFAULT_API_ERROR_MESSAGE;
    } catch {
        return DEFAULT_API_ERROR_MESSAGE;
    }
}

export function resolveApiErrorMessage(error: unknown, fallback?: string): string {
    if (typeof error === "object" && error !== null) {
        if ("data" in error && typeof error.data === "object" && error.data !== null) {
            const data = error.data as Record<string, unknown>;

            if (typeof data.message === "string" && data.message) {
                return data.message;
            }
            if (typeof data.statusMessage === "string" && data.statusMessage) {
                return data.statusMessage;
            }
        }

        if ("response" in error && typeof error.response === "object" && error.response !== null) {
            const response = error.response as {_data?: unknown};
            if (typeof response._data === "object" && response._data !== null) {
                const data = response._data as Record<string, unknown>;
                if (typeof data.message === "string" && data.message) {
                    return data.message;
                }
                if (typeof data.statusMessage === "string" && data.statusMessage) {
                    return data.statusMessage;
                }
            }
        }

        if ("statusMessage" in error && typeof error.statusMessage === "string" && error.statusMessage) {
            return error.statusMessage;
        }
        if ("message" in error && typeof error.message === "string" && error.message) {
            return error.message;
        }
    }

    return fallback ?? resolveDefaultApiErrorMessage();
}

/** 提取 `$fetch` / h3 错误中的稳定业务码；外部响应结构在此边界逐层收窄。 */
export function resolveApiErrorCode(error: unknown): string | null {
    if (typeof error !== "object" || error === null) {
        return null;
    }
    const direct = "data" in error ? nestedApiErrorCode(error.data) : null;
    if (direct !== null) {
        return direct;
    }
    if (!("response" in error) || typeof error.response !== "object" || error.response === null || !("_data" in error.response)) {
        return null;
    }
    return nestedApiErrorCode(error.response._data);
}

/** H3 可能把业务 data 再包一层，最多读取两层稳定 code。 */
function nestedApiErrorCode(value: unknown): string | null {
    if (typeof value !== "object" || value === null) {
        return null;
    }
    if ("code" in value && typeof value.code === "string") {
        return value.code;
    }
    return "data" in value && typeof value.data === "object" && value.data !== null && "code" in value.data && typeof value.data.code === "string"
        ? value.data.code
        : null;
}

/**
 * 提取 `$fetch` / h3 错误中的 HTTP 状态码；无法识别时返回 null。
 */
export function resolveApiErrorStatus(error: unknown): number | null {
    if (typeof error !== "object" || error === null) {
        return null;
    }
    if ("status" in error && typeof error.status === "number") {
        return error.status;
    }
    if ("statusCode" in error && typeof error.statusCode === "number") {
        return error.statusCode;
    }
    if ("response" in error && typeof error.response === "object" && error.response !== null && "status" in error.response && typeof error.response.status === "number") {
        return error.response.status;
    }
    return null;
}
