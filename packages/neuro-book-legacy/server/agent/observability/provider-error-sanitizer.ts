import {redactSensitiveText} from "nbook/runtime/diagnostics/diagnostics";

const MAX_PROVIDER_ERROR_LENGTH = 4_000;
const TRUNCATION_MARKER = "\n…[Provider 错误已截断]";

/**
 * 清理即将展示、记录或持久化的 Provider 错误文本。
 */
export function sanitizeProviderErrorMessage(message: string): string {
    const sanitized = redactSensitiveText(message);
    if (sanitized.length <= MAX_PROVIDER_ERROR_LENGTH) {
        return sanitized;
    }
    return `${sanitized.slice(0, MAX_PROVIDER_ERROR_LENGTH)}${TRUNCATION_MARKER}`;
}

/**
 * 将未知异常转换为安全的 Provider 错误文本。
 */
export function providerErrorText(error: unknown): string {
    return sanitizeProviderErrorMessage(error instanceof Error ? error.message : String(error));
}
