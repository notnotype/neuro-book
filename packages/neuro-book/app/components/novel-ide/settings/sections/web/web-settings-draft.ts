/**
 * Web 工具区段的草稿模型与序列化规则。
 *
 * 视图与宿主共用这一层：视图只改草稿，宿主用 `buildWebPayload()` 得到写回体。
 * 规则沿用旧面板：空串表示未配置 / 继承默认值，provider 密钥留空表示保留原值
 * （只有显式清除才写到空串），数字字段非法时回落到各自的默认值。
 */
import type {SecretConfigValueDto, WebConfigDto} from "nbook/shared/dto/config.dto";

export type SearchProviderKey = "tavily" | "brave";

export const SEARCH_PROVIDER_KEYS: SearchProviderKey[] = ["tavily", "brave"];

export type WebProviderDraft = {
    enabled: boolean;
    /** 新输入的密钥；留空表示不改动已配置的值 */
    apiKey: string;
    apiKeyConfigured: boolean;
    apiKeyMaskedValue: string | null;
    /** 用户显式清除了密钥 */
    apiKeyCleared: boolean;
    timeoutMs: string;
};

export type WebBraveDraft = WebProviderDraft & {
    country: string;
    searchLang: string;
};

export type WebLocalFetchDraft = {
    enabled: boolean;
    timeoutMs: string;
    maxRedirects: string;
    maxBytes: string;
    maxCharacters: string;
    minCharactersForLocal: string;
};

export type WebTavilyFallbackDraft = {
    enabled: boolean;
    timeoutMs: string;
};

export type WebSettingsDraft = {
    /** 搜索 provider 优先级；两项各出现一次 */
    order: SearchProviderKey[];
    tavily: WebProviderDraft;
    brave: WebBraveDraft;
    localFetch: WebLocalFetchDraft;
    tavilyFallback: WebTavilyFallbackDraft;
};

export const WEB_DEFAULTS = {
    providerTimeoutMs: 15000,
    localFetchTimeoutMs: 15000,
    maxRedirects: 5,
    maxBytes: 2_000_000,
    maxCharacters: 20000,
    minCharactersForLocal: 300,
    tavilyFallbackTimeoutMs: 20000,
} as const;

function createProviderDraft(): WebProviderDraft {
    return {
        enabled: false,
        apiKey: "",
        apiKeyConfigured: false,
        apiKeyMaskedValue: null,
        apiKeyCleared: false,
        timeoutMs: String(WEB_DEFAULTS.providerTimeoutMs),
    };
}

export function createWebSettingsDraft(): WebSettingsDraft {
    return {
        order: [...SEARCH_PROVIDER_KEYS],
        tavily: createProviderDraft(),
        brave: {...createProviderDraft(), country: "US", searchLang: "en"},
        localFetch: {
            enabled: true,
            timeoutMs: String(WEB_DEFAULTS.localFetchTimeoutMs),
            maxRedirects: String(WEB_DEFAULTS.maxRedirects),
            maxBytes: String(WEB_DEFAULTS.maxBytes),
            maxCharacters: String(WEB_DEFAULTS.maxCharacters),
            minCharactersForLocal: String(WEB_DEFAULTS.minCharactersForLocal),
        },
        tavilyFallback: {enabled: false, timeoutMs: String(WEB_DEFAULTS.tavilyFallbackTimeoutMs)},
    };
}

/** 规范化优先级：滤掉未知项、去重，并保证两个 provider 都出现一次。 */
export function normalizeProviderOrder(order: unknown): SearchProviderKey[] {
    const values = Array.isArray(order) ? order : [];
    const normalized = values.filter((item): item is SearchProviderKey => item === "tavily" || item === "brave");
    for (const key of SEARCH_PROVIDER_KEYS) {
        if (!normalized.includes(key)) {
            normalized.push(key);
        }
    }
    return [...new Set(normalized)];
}

/** 上移/下移一项；越界时原样返回。 */
export function moveProvider(order: SearchProviderKey[], key: SearchProviderKey, direction: -1 | 1): SearchProviderKey[] {
    const next = normalizeProviderOrder(order);
    const index = next.indexOf(key);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= next.length) {
        return next;
    }
    next.splice(index, 1);
    next.splice(nextIndex, 0, key);
    return next;
}

export function canMoveProvider(order: SearchProviderKey[], key: SearchProviderKey, direction: -1 | 1): boolean {
    const normalized = normalizeProviderOrder(order);
    const index = normalized.indexOf(key);
    const nextIndex = index + direction;
    return index >= 0 && nextIndex >= 0 && nextIndex < normalized.length;
}

export function stringifyNumber(value: unknown, fallback: number): string {
    return typeof value === "number" && Number.isFinite(value) ? String(value) : String(fallback);
}

/** 空串与非数字按「未配置」处理。 */
export function stringifyNullableNumber(value: unknown, fallback: number): string {
    return typeof value === "number" && Number.isFinite(value) ? String(value) : String(fallback);
}

export function normalizeText(value: unknown, fallback: string): string {
    const text = typeof value === "string" ? value.trim() : "";
    return text === "" ? fallback : text;
}

export function parsePositiveInteger(value: string, fallback: number): number {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

export function parseNonNegativeInteger(value: string, fallback: number): number {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : fallback;
}

export function parseNullablePositiveInteger(value: string): number | null {
    const normalized = value.trim();
    if (normalized === "") {
        return null;
    }
    return parsePositiveInteger(normalized, 0) || null;
}

/** provider 的 secret 写回负载：留空保留旧值，显式清除写空串。 */
export function buildProviderSecretPayload(provider: WebProviderDraft): SecretConfigValueDto {
    const payload: SecretConfigValueDto = {
        configured: provider.apiKeyConfigured,
        maskedValue: provider.apiKeyMaskedValue,
    };
    if (provider.apiKeyCleared) {
        payload.value = "";
    } else if (provider.apiKey.trim() !== "") {
        payload.value = provider.apiKey.trim();
    }
    return payload;
}

/** Web 配置写回段。 */
export function buildWebPayload(draft: WebSettingsDraft): WebConfigDto {
    return {
        search: {
            order: normalizeProviderOrder(draft.order),
            providers: {
                tavily: {
                    enabled: draft.tavily.enabled,
                    apiKey: buildProviderSecretPayload(draft.tavily),
                    timeoutMs: parseNullablePositiveInteger(draft.tavily.timeoutMs),
                },
                brave: {
                    enabled: draft.brave.enabled,
                    apiKey: buildProviderSecretPayload(draft.brave),
                    country: normalizeText(draft.brave.country, "US").toUpperCase(),
                    searchLang: normalizeText(draft.brave.searchLang, "en").toLowerCase(),
                    timeoutMs: parseNullablePositiveInteger(draft.brave.timeoutMs),
                },
            },
        },
        fetch: {
            local: {
                enabled: draft.localFetch.enabled,
                timeoutMs: parsePositiveInteger(draft.localFetch.timeoutMs, WEB_DEFAULTS.localFetchTimeoutMs),
                maxRedirects: parseNonNegativeInteger(draft.localFetch.maxRedirects, WEB_DEFAULTS.maxRedirects),
                maxBytes: parsePositiveInteger(draft.localFetch.maxBytes, WEB_DEFAULTS.maxBytes),
                maxCharacters: parsePositiveInteger(draft.localFetch.maxCharacters, WEB_DEFAULTS.maxCharacters),
                minCharactersForLocal: parseNonNegativeInteger(draft.localFetch.minCharactersForLocal, WEB_DEFAULTS.minCharactersForLocal),
            },
            tavilyFallback: {
                enabled: draft.tavilyFallback.enabled,
                timeoutMs: parseNullablePositiveInteger(draft.tavilyFallback.timeoutMs),
            },
        },
    };
}
