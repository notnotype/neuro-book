/**
 * 诊断脱敏与序列化的单一来源：文本脱敏、结构化负载收敛、错误序列化与长度/深度上限。
 *
 * 应用日志（server/app-logs）、Provider 错误清洗与诊断记录都从这里取，避免多套正则逐渐分叉。
 * 本文件平台中立：不读环境、不写输出、不引用任何运行位置专有 API。
 *
 * 边界：按已知敏感字段名与已知凭据字面模式工作，不承诺识别任意 secret；脱敏或序列化环节自身
 * 异常时以固定描述 `[unserializable]` 替代，绝不输出原始负载。
 */

const REDACTED = "[REDACTED]";

const SENSITIVE_LABEL = "api[-_ ]?key|apikey|authorization|cookie|set-cookie|password|token|secret|credential|device[-_ ]?code|grant|access[-_ ]?token|refresh[-_ ]?token|recovery[-_ ]?code|backup[-_ ]?key|backup[-_ ]?keyring";
const SENSITIVE_VALUE_LABEL = "api[-_ ]?key|apikey|password|token|secret|credential|device[-_ ]?code|grant|access[-_ ]?token|refresh[-_ ]?token|recovery[-_ ]?code|backup[-_ ]?key|backup[-_ ]?keyring";
const SENSITIVE_KEY_PATTERN = /(authorization|cookie|set-cookie|api[-_]?key|apikey|password|token|secret|credential|device[-_]?code|grant|recovery[-_]?code|backup[-_]?key|backup[-_]?keyring)/iu;

/** 单个字符串字段的默认长度上限；诊断消息预算缺省也取它。 */
export const MAX_STRING_LENGTH = 4000;

const MAX_ERROR_STACK_LENGTH = 12000;
const MAX_ARRAY_ITEMS = 50;
const MAX_OBJECT_KEYS = 80;
const MAX_DEPTH = 6;

/** 脱敏或序列化环节异常时的固定替代描述；调用方据此确认“已收敛且未输出原文”。 */
export const UNREADABLE_PLACEHOLDER = "[unserializable]";

/**
 * 清理自由文本中的常见凭据片段。
 *
 * 该函数只处理文本，不负责业务级截断。Provider 错误、应用日志与诊断消息共用它，
 * 敏感 label 后无法可靠判断值边界时宁可多清理当前片段，也不保留凭据。
 */
export function redactSensitiveText(input: string): string {
    return input
        .replace(new RegExp(`(["'](?:${SENSITIVE_LABEL})["']\\s*:\\s*["'])[^"']*(["'])`, "giu"), `$1${REDACTED}$2`)
        .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/=:-]+/giu, `$1 ${REDACTED}`)
        .replace(/(\bauthorization\s*[:=]\s*)(?!(?:Bearer|Basic)\b)[^\s,;}]+/giu, `$1${REDACTED}`)
        .replace(new RegExp(`\\b(cookie|set-cookie)\\s*[:=]\\s*[^\\r\\n]+`, "giu"), `$1=${REDACTED}`)
        .replace(new RegExp(`(\\b(?:${SENSITIVE_VALUE_LABEL})\\s*[:=]\\s*)(?:"[^"]*"|'[^']*'|[^\\s,;}]+)`, "giu"), `$1${REDACTED}`)
        .replace(/\bNBK1-[A-Za-z0-9_-]{43}-[0-9a-f]{8}\b/gu, REDACTED)
        .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, REDACTED);
}

/**
 * 文本脱敏 + 截断；脱敏环节异常时用固定描述替代。截断发生在脱敏之后，
 * 被截掉的内容不会以任何形式回传。
 */
export function redactText(input: string, maxLength: number): string {
    try {
        return truncateString(redactSensitiveText(input), maxLength);
    } catch {
        return UNREADABLE_PLACEHOLDER;
    }
}

/** 把未知值转成适合写入日志/诊断的安全结构，并移除常见密钥字段。 */
export function sanitizeDiagnosticValue(input: unknown): unknown {
    try {
        return sanitizeValue(input, 0, new WeakSet<object>());
    } catch {
        return UNREADABLE_PLACEHOLDER;
    }
}

/** 把未知错误序列化为安全对象；无法安全读取时用固定描述替代。 */
export function serializeDiagnosticError(error: unknown): unknown {
    try {
        if (error instanceof Error) {
            const output: Record<string, unknown> = {
                name: error.name,
                message: truncateString(redactSensitiveText(error.message), MAX_STRING_LENGTH),
            };
            if (error.stack) {
                output.stack = truncateString(redactSensitiveText(error.stack), MAX_ERROR_STACK_LENGTH);
            }
            if ("cause" in error && error.cause !== undefined) {
                output.cause = sanitizeValue(error.cause, 0, new WeakSet<object>());
            }
            return output;
        }
        return sanitizeValue(error, 0, new WeakSet<object>());
    } catch {
        return UNREADABLE_PLACEHOLDER;
    }
}

/**
 * 把异常收敛为一行脱敏描述，用于降级原因与关闭失败原因；只保留名称与消息，不携带原始负载。
 */
export function describeDiagnosticError(error: unknown): string {
    try {
        if (error instanceof Error) {
            return truncateString(redactSensitiveText(`${error.name}: ${error.message}`), MAX_STRING_LENGTH);
        }
        if (typeof error === "string") {
            return truncateString(redactSensitiveText(error), MAX_STRING_LENGTH);
        }
        // 常见形态是带 code 的宿主错误（例如 ELOCKED）；其余一律退到固定描述。
        if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
            return truncateString(redactSensitiveText(error.code), MAX_STRING_LENGTH);
        }
        return UNREADABLE_PLACEHOLDER;
    } catch {
        return UNREADABLE_PLACEHOLDER;
    }
}

function sanitizeValue(input: unknown, depth: number, seen: WeakSet<object>): unknown {
    if (input === null || input === undefined) {
        return input;
    }
    if (typeof input === "string") {
        return truncateString(redactSensitiveText(input), MAX_STRING_LENGTH);
    }
    if (typeof input === "number" || typeof input === "boolean") {
        return input;
    }
    if (typeof input === "bigint") {
        return input.toString();
    }
    if (typeof input === "symbol" || typeof input === "function") {
        return `[${typeof input}]`;
    }
    if (input instanceof Date) {
        return input.toISOString();
    }
    if (input instanceof Error) {
        return serializeDiagnosticError(input);
    }
    if (depth >= MAX_DEPTH) {
        return "[MaxDepth]";
    }
    if (Array.isArray(input)) {
        return input.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, depth + 1, seen));
    }
    if (typeof input === "object") {
        if (seen.has(input)) {
            return "[Circular]";
        }
        seen.add(input);
        const output: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(input).slice(0, MAX_OBJECT_KEYS)) {
            output[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : sanitizeValue(value, depth + 1, seen);
        }
        seen.delete(input);
        return output;
    }
    return String(input);
}

function truncateString(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
        return value;
    }
    return `${value.slice(0, maxLength)}... [truncated ${value.length - maxLength} chars]`;
}
