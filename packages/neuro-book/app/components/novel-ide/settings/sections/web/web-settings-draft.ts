/**
 * Web 工具区段的草稿模型与序列化规则。
 *
 * 服务是**数据**不是分支：搜索服务由 `SEARCH_PROVIDER_CATALOG` 决定，渲染、排序、
 * 服务独有字段都按它走；加一个服务＝往表里加一项（再补后端契约里的对应字段）。
 * `buildWebPayload()` 是唯一的写回出口，与 `WebConfigDto` 逐字对应。
 */
import type {SecretConfigValueDto, WebConfigDto} from "nbook/shared/dto/config.dto";

export type SearchProviderKey = "tavily" | "brave";

/** 服务独有的字段：labelKey 走 i18n，defaultValue 是该字段的初始草稿值。 */
export type SearchProviderField = {
    key: string;
    labelKey: string;
    placeholder: string;
    defaultValue: string;
};

export type SearchProviderDefinition = {
    key: SearchProviderKey;
    label: string;
    descriptionKey: string;
    iconClass: string;
    extraFields: SearchProviderField[];
};

export const SEARCH_PROVIDER_CATALOG: SearchProviderDefinition[] = [
    {
        key: "tavily",
        label: "Tavily",
        descriptionKey: "settings.panels.web.tavilyProviderDescription",
        iconClass: "i-lucide-sparkles",
        extraFields: [],
    },
    {
        key: "brave",
        label: "Brave Search",
        descriptionKey: "settings.panels.web.braveProviderDescription",
        iconClass: "i-lucide-search",
        extraFields: [
            {key: "country", labelKey: "settings.panels.web.country", placeholder: "US", defaultValue: "US"},
            {key: "searchLang", labelKey: "settings.panels.web.searchLang", placeholder: "en", defaultValue: "en"},
        ],
    },
];

export const SEARCH_PROVIDER_KEYS: SearchProviderKey[] = SEARCH_PROVIDER_CATALOG.map((item) => item.key);

export function findSearchProvider(key: string): SearchProviderDefinition | null {
    return SEARCH_PROVIDER_CATALOG.find((item) => item.key === key) ?? null;
}

export type WebProviderDraft = {
    enabled: boolean;
    /** 新输入的密钥；留空表示不改动已配置的值 */
    apiKey: string;
    apiKeyConfigured: boolean;
    apiKeyMaskedValue: string | null;
    /** 用户显式清除了密钥 */
    apiKeyCleared: boolean;
    timeoutMs: string;
    /** 服务独有字段的草稿；键由 catalog 的 extraFields 定义 */
    extras: Record<string, string>;
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
    /** 搜索 provider 优先级；每个服务各出现一次 */
    order: SearchProviderKey[];
    /** 每个服务一份草稿，键与 catalog 对齐 */
    providers: Record<SearchProviderKey, WebProviderDraft>;
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

export function createProviderDraft(definition: SearchProviderDefinition): WebProviderDraft {
    const extras: Record<string, string> = {};
    for (const field of definition.extraFields) {
        extras[field.key] = field.defaultValue;
    }
    return {
        enabled: false,
        apiKey: "",
        apiKeyConfigured: false,
        apiKeyMaskedValue: null,
        apiKeyCleared: false,
        timeoutMs: String(WEB_DEFAULTS.providerTimeoutMs),
        extras,
    };
}

export function createWebSettingsDraft(): WebSettingsDraft {
    const providers = {} as Record<SearchProviderKey, WebProviderDraft>;
    for (const definition of SEARCH_PROVIDER_CATALOG) {
        providers[definition.key] = createProviderDraft(definition);
    }
    return {
        order: [...SEARCH_PROVIDER_KEYS],
        providers,
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

/** 规范化优先级：滤掉未知项、去重，并保证每个服务都出现一次。 */
export function normalizeProviderOrder(order: unknown): SearchProviderKey[] {
    const values = Array.isArray(order) ? order : [];
    const normalized = values.filter((item): item is SearchProviderKey =>
        typeof item === "string" && SEARCH_PROVIDER_KEYS.includes(item as SearchProviderKey));
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
    const normalized = value.trim();
    // 空串是「未配置」，不是 0——Number("") 是 0，不拦这一条就会把清空的输入框写成 0。
    if (normalized === "") {
        return fallback;
    }
    const parsed = Number(normalized);
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

/**
 * Web 配置写回段。
 *
 * 每个服务的字段仍然显式列出：后端契约是按服务定义的（Brave 有国家与搜索语言），
 * 这里不做通用映射——加服务时该动的就是「catalog + 这一段 + 后端契约」三处。
 */
export function buildWebPayload(draft: WebSettingsDraft): WebConfigDto {
    const tavily = draft.providers.tavily;
    const brave = draft.providers.brave;
    return {
        search: {
            order: normalizeProviderOrder(draft.order),
            providers: {
                tavily: {
                    enabled: tavily.enabled,
                    apiKey: buildProviderSecretPayload(tavily),
                    timeoutMs: parseNullablePositiveInteger(tavily.timeoutMs),
                },
                brave: {
                    enabled: brave.enabled,
                    apiKey: buildProviderSecretPayload(brave),
                    country: normalizeText(brave.extras.country, "US").toUpperCase(),
                    searchLang: normalizeText(brave.extras.searchLang, "en").toLowerCase(),
                    timeoutMs: parseNullablePositiveInteger(brave.timeoutMs),
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
