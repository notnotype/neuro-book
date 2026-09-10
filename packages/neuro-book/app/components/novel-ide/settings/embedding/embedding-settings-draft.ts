/**
 * Embedding 区段的草稿模型与序列化规则。
 *
 * 视图与宿主共用这一层：视图只改草稿，宿主用 `build*Payload()` 得到写回体。
 * 空串统一表示「未配置/继承上层」——文本写成 null，数字按未配置处理，
 * 密钥留空表示保留原值，只有显式清除才写入空串。
 */
import type {EmbeddingProjectConfigDto, EmbeddingServiceConfigDto, SecretConfigValueDto} from "nbook/shared/dto/config.dto";

export const DEFAULT_GLOBAL_EMBEDDING_MODEL = "text-embedding-3-small";
export const DEFAULT_GLOBAL_EMBEDDING_DIMENSIONS = 1536;
export const DEFAULT_GLOBAL_EMBEDDING_TIMEOUT_MS = 30000;

export type EmbeddingRequestOptions = EmbeddingServiceConfigDto["requestOptions"];

export type EmbeddingGlobalDraft = {
    enabled: boolean;
    provider: "openai-compatible";
    model: string;
    dimensions: string;
    /** 新输入的密钥；留空表示不改动已配置的值 */
    apiKey: string;
    apiKeyConfigured: boolean;
    apiKeyMaskedValue: string | null;
    /** 用户显式清除了密钥 */
    apiKeyCleared: boolean;
    baseURL: string;
    timeoutMs: string;
    requestOptions: string;
};

export type EmbeddingProjectDraft = {
    model: string;
    dimensions: string;
};

export type EmbeddingSettingsDraft = {
    global: EmbeddingGlobalDraft;
    project: EmbeddingProjectDraft;
};

export function createGlobalEmbeddingDraft(): EmbeddingGlobalDraft {
    return {
        enabled: false,
        provider: "openai-compatible",
        model: "",
        dimensions: "",
        apiKey: "",
        apiKeyConfigured: false,
        apiKeyMaskedValue: null,
        apiKeyCleared: false,
        baseURL: "",
        timeoutMs: "",
        requestOptions: "",
    };
}

export function createProjectEmbeddingDraft(): EmbeddingProjectDraft {
    return {model: "", dimensions: ""};
}

export function createEmbeddingSettingsDraft(): EmbeddingSettingsDraft {
    return {global: createGlobalEmbeddingDraft(), project: createProjectEmbeddingDraft()};
}

/** 数字写成输入框文本；非数字按空串（未配置）处理。 */
export function stringifyNullableNumber(value: unknown): string {
    return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

/** 空字符串写成 null，表示继承上层配置或保持未配置。 */
export function normalizeNullableText(value: string): string | null {
    const normalized = value.trim();
    return normalized === "" ? null : normalized;
}

/** 解析正整数输入；非法值与空串都按未配置处理。 */
export function parseNullablePositiveInteger(value: string): number | null {
    const normalized = value.trim();
    if (normalized === "") {
        return null;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

/** 解析 OpenAI-compatible embedding 请求扩展参数；非法 JSON 按空对象处理。 */
export function parseRequestOptions(value: string): EmbeddingRequestOptions {
    const normalized = value.trim();
    if (normalized === "") {
        return {};
    }
    try {
        const parsed: unknown = JSON.parse(normalized);
        return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed as EmbeddingRequestOptions
            : {};
    } catch {
        return {};
    }
}

/** secret 写回负载；空输入表示保留旧值，显式清除写空串。 */
export function buildSecretPayload(draft: EmbeddingGlobalDraft): SecretConfigValueDto {
    const value: SecretConfigValueDto = {
        configured: draft.apiKeyConfigured,
        maskedValue: draft.apiKeyMaskedValue,
    };
    if (draft.apiKeyCleared) {
        value.value = "";
    } else if (draft.apiKey.trim() !== "") {
        value.value = draft.apiKey.trim();
    }
    return value;
}

/** Global embedding 配置段。 */
export function buildGlobalEmbeddingPayload(draft: EmbeddingGlobalDraft): EmbeddingServiceConfigDto {
    return {
        enabled: draft.enabled,
        provider: draft.provider,
        model: normalizeNullableText(draft.model) ?? (draft.enabled ? DEFAULT_GLOBAL_EMBEDDING_MODEL : null),
        dimensions: parseNullablePositiveInteger(draft.dimensions) ?? (draft.enabled ? DEFAULT_GLOBAL_EMBEDDING_DIMENSIONS : null),
        apiKey: buildSecretPayload(draft),
        baseURL: draft.baseURL.trim(),
        timeoutMs: parseNullablePositiveInteger(draft.timeoutMs) ?? DEFAULT_GLOBAL_EMBEDDING_TIMEOUT_MS,
        requestOptions: parseRequestOptions(draft.requestOptions),
    };
}

/** Project embedding 覆盖段。 */
export function buildProjectEmbeddingPayload(draft: EmbeddingProjectDraft): EmbeddingProjectConfigDto {
    return {
        model: normalizeNullableText(draft.model),
        dimensions: parseNullablePositiveInteger(draft.dimensions),
    };
}
