/**
 * Provider 连接身份。
 *
 * Provider Config ID 是稳定的本地连接身份；端点和代理属于同一连接
 * 的不可隐式迁移属性。Provider Model API 只是候选补全偏好，不属于连接身份。
 * API key 不进入 fingerprint，避免把凭据写入缓存键或日志。
 */
export type ProviderConnectionIdentityInput = {
    id: string;
    baseURL: string;
    proxy: string;
};

export type ProviderConnectionIdentity = {
    id: string;
    baseURL: string;
    proxy: string;
};

/** 规范化连接身份字段，供保存校验和发现缓存共同使用。 */
export function normalizeProviderConnectionIdentity(input: ProviderConnectionIdentityInput): ProviderConnectionIdentity {
    return {
        id: input.id.trim(),
        baseURL: normalizeEndpoint(input.baseURL),
        proxy: normalizeEndpoint(input.proxy),
    };
}

/**
 * 返回稳定 fingerprint。
 * 该值只包含连接公开配置，不包含 API key、request options 或模型能力。
 */
export function providerConnectionFingerprint(input: ProviderConnectionIdentityInput): string {
    return JSON.stringify(normalizeProviderConnectionIdentity(input));
}

/** 比较两个连接是否仍是同一个 Provider Config 身份。 */
export function sameProviderConnection(
    left: ProviderConnectionIdentityInput,
    right: ProviderConnectionIdentityInput,
): boolean {
    return providerConnectionFingerprint(left) === providerConnectionFingerprint(right);
}

function normalizeEndpoint(value: string): string {
    const normalized = value.trim();
    if (!normalized) {
        return "";
    }
    try {
        const url = new URL(normalized);
        url.username = "";
        url.password = "";
        url.hash = "";
        if (url.pathname.length > 1) {
            url.pathname = url.pathname.replace(/\/+$/u, "");
        }
        return url.toString();
    } catch {
        // URL 格式校验由 Provider DTO/运行时负责；身份模块仍保持确定性。
        return normalized;
    }
}
