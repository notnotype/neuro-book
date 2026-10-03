import {z} from "zod";
import type {DiscoveryDiagnosticsDto, DiscoveredProviderModelDto, ModelProviderDraftDto} from "nbook/shared/dto/app-settings.dto";
import {deriveModelGroup} from "nbook/shared/models/model-group";

type ProviderFetchInit = RequestInit & {proxy?: string};
type JsonRecord = Record<string, unknown>;

export const PROVIDER_DISCOVERY_ERROR_CODES = [
    "missing-base-url",
    "invalid-base-url",
    "unsupported-discovery",
    "unauthorized",
    "forbidden",
    "rate-limited",
    "timeout",
    "upstream-error",
    "invalid-response",
    "empty-result",
    "response-too-large",
] as const;

export type ProviderDiscoveryErrorCode = typeof PROVIDER_DISCOVERY_ERROR_CODES[number];

/** Provider discovery 的稳定错误合同；不会携带远端响应体、URL 或请求 Header。 */
export class ProviderDiscoveryError extends Error {
    constructor(public readonly code: ProviderDiscoveryErrorCode, message: string) {
        super(message);
        this.name = "ProviderDiscoveryError";
    }
}

/** 从跨模块/测试边界安全读取 discovery 错误码。 */
export function providerDiscoveryErrorCode(error: unknown): ProviderDiscoveryErrorCode | null {
    if (error instanceof ProviderDiscoveryError) {
        return error.code;
    }
    if (typeof error !== "object" || error === null || !("code" in error)) {
        return null;
    }
    const code = (error as {code?: unknown}).code;
    return typeof code === "string" && PROVIDER_DISCOVERY_ERROR_CODES.includes(code as ProviderDiscoveryErrorCode)
        ? code as ProviderDiscoveryErrorCode
        : null;
}

export type DiscoveryResult = {
    models: DiscoveredProviderModelDto[];
    diagnostics: DiscoveryDiagnosticsDto;
};

type ParsedDiscoveryPage = {
    entries: Array<DiscoveredProviderModelDto | null>;
    nextPageToken?: string;
};

type DiscoveryAdapter = {
    id: "openai-models" | "openrouter-models" | "anthropic-models" | "google-models";
    url(provider: ModelProviderDraftDto, baseURL: URL, pageToken?: string): URL;
    systemHeaders(provider: ModelProviderDraftDto): Record<string, string>;
    protectedHeaders: readonly string[];
    parse(payload: unknown): ParsedDiscoveryPage;
    maxPages?: number;
    maxItems?: number;
};

const MAX_DISCOVERY_RESPONSE_BYTES = 5 * 1024 * 1024;
const DEFAULT_DISCOVERY_TIMEOUT_MS = 30_000;
const MAX_GOOGLE_DISCOVERY_PAGES = 5;
const MAX_GOOGLE_DISCOVERY_ITEMS = 5_000;

const OpenAIModelsEnvelopeSchema = z.object({
    data: z.array(z.unknown()),
});

const OpenAIModelItemSchema = z.object({
    id: z.string(),
}).passthrough();

const GoogleModelsEnvelopeSchema = z.object({
    models: z.array(z.unknown()),
    nextPageToken: z.unknown().optional(),
}).passthrough();

const GoogleModelItemSchema = z.object({
    name: z.string(),
}).passthrough();

const openAiAdapter: DiscoveryAdapter = {
    id: "openai-models",
    url: (_provider, baseURL) => modelsUrl(baseURL),
    systemHeaders: bearerHeaders,
    protectedHeaders: ["accept", "authorization"],
    parse: (payload) => parseOpenAIModels(payload, false, null),
};

const openRouterAdapter: DiscoveryAdapter = {
    id: "openrouter-models",
    url: (_provider, baseURL) => modelsUrl(baseURL),
    systemHeaders: bearerHeaders,
    protectedHeaders: ["accept", "authorization"],
    parse: (payload) => parseOpenAIModels(payload, true, "openai-completions"),
};

const anthropicAdapter: DiscoveryAdapter = {
    id: "anthropic-models",
    url: (_provider, baseURL) => modelsUrl(baseURL),
    systemHeaders: anthropicHeaders,
    protectedHeaders: ["accept", "authorization", "x-api-key", "anthropic-version"],
    parse: (payload) => parseOpenAIModels(payload, false, "anthropic-messages"),
};

const googleAdapter: DiscoveryAdapter = {
    id: "google-models",
    url: (provider, baseURL, pageToken) => {
        const url = modelsUrl(baseURL);
        const apiKey = provider.options.apiKey.trim();
        if (apiKey) {
            url.searchParams.set("key", apiKey);
        }
        url.searchParams.set("pageSize", "1000");
        if (pageToken) {
            url.searchParams.set("pageToken", pageToken);
        }
        return url;
    },
    systemHeaders: () => ({accept: "application/json"}),
    protectedHeaders: ["accept", "authorization", "x-api-key"],
    parse: parseGoogleModels,
    maxPages: MAX_GOOGLE_DISCOVERY_PAGES,
    maxItems: MAX_GOOGLE_DISCOVERY_ITEMS,
};

/** 自动发现当前 Provider 的模型，并返回可用于设置页诊断的稳定统计。 */
export async function discoverProviderModelMetadata(provider: ModelProviderDraftDto): Promise<DiscoveryResult> {
    const baseUrlText = provider.options.baseURL.trim();
    if (!baseUrlText) {
        throw new ProviderDiscoveryError("missing-base-url", `${provider.name} 缺少 API Base，无法发现模型。`);
    }

    let baseURL: URL;
    try {
        baseURL = parseHttpUrl(baseUrlText);
    } catch {
        throw new ProviderDiscoveryError("invalid-base-url", `${provider.name} 的 API Base 不是有效的 HTTP(S) URL。`);
    }
    try {
        if (provider.options.proxy.trim()) parseHttpUrl(provider.options.proxy.trim());
    } catch {
        throw new ProviderDiscoveryError("invalid-base-url", `${provider.name} 的代理 URL 不是有效的 HTTP(S) URL。`);
    }

    const adapters = orderedAdapters(provider, baseURL);
    if (adapters.length === 0) {
        throw new ProviderDiscoveryError(
            "unsupported-discovery",
            `${provider.name} 当前配置的模型 API 不支持自动发现，请从 Model Library 添加或手动配置模型。`,
        );
    }

    const attempts: ProviderDiscoveryError[] = [];
    for (const adapter of adapters) {
        try {
            return await runAdapter(provider, baseURL, adapter);
        } catch (error) {
            attempts.push(normalizeDiscoveryError(error));
        }
    }

    const error = attempts[0];
    throw new ProviderDiscoveryError(
        error?.code ?? "upstream-error",
        `${provider.name} 未发现可用模型。${error?.message ?? "请检查连接配置后重试。"}`,
    );
}

async function runAdapter(provider: ModelProviderDraftDto, baseURL: URL, adapter: DiscoveryAdapter): Promise<DiscoveryResult> {
    const timeoutMs = provider.options.timeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS;
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
    const proxyUrl = provider.options.proxy.trim();
    let url = adapter.url(provider, baseURL);
    let nextPageToken: string | undefined;
    let fetchedCount = 0;
    let skippedCount = 0;
    let duplicateCount = 0;
    let pageCount = 0;
    let processedRawItems = 0;
    let truncated = false;
    const models = new Map<string, DiscoveredProviderModelDto>();
    const maxPages = adapter.maxPages ?? 1;
    const maxItems = adapter.maxItems ?? Number.MAX_SAFE_INTEGER;

    try {
        while (true) {
            if (url.origin !== baseURL.origin) {
                throw new ProviderDiscoveryError("invalid-base-url", "发现请求目标与 API Base 不一致。");
            }
            pageCount += 1;
            const init: ProviderFetchInit = {
                method: "GET",
                headers: mergeDiscoveryHeaders(provider, adapter.systemHeaders(provider), adapter.protectedHeaders),
                redirect: "error",
                signal: controller.signal,
                ...(proxyUrl ? {proxy: proxyUrl} : {}),
            };
            const response = await fetch(url, init);
            if (!response.ok) {
                throw errorForUpstreamStatus(response.status);
            }

            const page = adapter.parse(await readJson(response));
            fetchedCount += page.entries.length;
            skippedCount += page.entries.filter((entry) => entry === null).length;

            const remainingItems = Math.max(0, maxItems - processedRawItems);
            const entriesToProcess = page.entries.slice(0, remainingItems);
            if (entriesToProcess.length < page.entries.length) {
                truncated = true;
            }
            processedRawItems += entriesToProcess.length;
            for (const model of entriesToProcess) {
                if (!model) {
                    continue;
                }
                if (models.has(model.id)) {
                    duplicateCount += 1;
                    continue;
                }
                models.set(model.id, model);
            }

            nextPageToken = page.nextPageToken;
            if (!nextPageToken) {
                break;
            }
            if (pageCount >= maxPages || processedRawItems >= maxItems) {
                truncated = true;
                break;
            }
            url = adapter.url(provider, baseURL, nextPageToken);
        }

        if (models.size === 0) {
            if (fetchedCount === 0) {
                throw new ProviderDiscoveryError("empty-result", "上游没有返回模型。");
            }
            throw new ProviderDiscoveryError("invalid-response", "上游返回的模型条目均无法识别。");
        }

        const diagnostics: DiscoveryDiagnosticsDto = {
            fetchedCount,
            returnedCount: models.size,
            skippedCount,
            duplicateCount,
            pageCount,
            truncated,
            partial: skippedCount > 0 || duplicateCount > 0 || truncated,
        };
        return {
            models: [...models.values()].sort((left, right) => left.id.localeCompare(right.id)),
            diagnostics,
        };
    } catch (error) {
        if (error instanceof ProviderDiscoveryError) {
            throw error;
        }
        if (error instanceof Error && error.name === "AbortError") {
            throw new ProviderDiscoveryError("timeout", `请求超时（${String(timeoutMs)}ms）。`);
        }
        throw new ProviderDiscoveryError("upstream-error", "无法连接 Provider 或读取模型列表。");
    } finally {
        globalThis.clearTimeout(timeout);
    }
}

function parseHttpUrl(value: string): URL {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new TypeError("URL protocol must be HTTP or HTTPS");
    }
    return parsed;
}

/** 按连接已知协议选择发现 Adapter，不轮换 API key 的认证形式。 */
function orderedAdapters(provider: ModelProviderDraftDto, baseURL: URL): DiscoveryAdapter[] {
    const host = baseURL.hostname.toLowerCase();
    if (provider.modelApi === "anthropic-messages") {
        return [anthropicAdapter];
    }
    if (provider.modelApi === "bedrock-converse-stream") {
        return [];
    }
    if (provider.modelApi === "google-generative-ai") {
        return [googleAdapter];
    }
    if (isHostnameOrSubdomain(host, "openrouter.ai")) {
        return [openRouterAdapter];
    }
    if (isHostnameOrSubdomain(host, "googleapis.com")) {
        return [googleAdapter];
    }
    return [openAiAdapter];
}

/** 只接受精确域名或其子域名，避免 evil-openrouter.ai 等误选协议。 */
function isHostnameOrSubdomain(hostname: string, domain: string): boolean {
    return hostname === domain || hostname.endsWith(`.${domain}`);
}

function modelsUrl(baseURL: URL): URL {
    const url = new URL(baseURL.toString());
    url.pathname = `${url.pathname.replace(/\/+$/u, "")}/models`;
    url.search = "";
    return url;
}

function bearerHeaders(provider: ModelProviderDraftDto): Record<string, string> {
    const headers: Record<string, string> = {accept: "application/json"};
    const apiKey = provider.options.apiKey.trim();
    if (apiKey) {
        headers.authorization = `Bearer ${apiKey}`;
    }
    return headers;
}

/** Anthropic-compatible 模型目录只在用户明确选择协议后使用 x-api-key。 */
function anthropicHeaders(provider: ModelProviderDraftDto): Record<string, string> {
    const headers: Record<string, string> = {
        accept: "application/json",
        "anthropic-version": "2023-06-01",
    };
    const apiKey = provider.options.apiKey.trim();
    if (apiKey) {
        headers["x-api-key"] = apiKey;
    }
    return headers;
}

/** 合并用户额外 Header；认证和协议 Header 始终由 Adapter 优先控制。 */
function mergeDiscoveryHeaders(
    provider: ModelProviderDraftDto,
    systemHeaders: Record<string, string>,
    protectedHeaders: readonly string[],
): Record<string, string> {
    const protectedNames = new Set([
        ...protectedHeaders,
        ...Object.keys(systemHeaders),
    ].map((header) => header.toLowerCase()));
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(provider.options.requestOptions.headers ?? {})) {
        if (value === null || protectedNames.has(name.toLowerCase())) {
            continue;
        }
        headers[name] = value;
    }
    for (const [name, value] of Object.entries(systemHeaders)) {
        headers[name] = value;
    }
    return headers;
}

async function readJson(response: Response): Promise<unknown> {
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_DISCOVERY_RESPONSE_BYTES) {
        throw new ProviderDiscoveryError("response-too-large", "Provider 响应体超过允许大小。");
    }
    const text = await readResponseText(response);
    try {
        return JSON.parse(text) as unknown;
    } catch {
        throw new ProviderDiscoveryError("invalid-response", "Provider 返回的模型列表不是有效 JSON。");
    }
}

/** 在读取过程中执行硬字节上限，避免未知 Content-Length 的响应占满内存。 */
async function readResponseText(response: Response): Promise<string> {
    if (!response.body) {
        return "";
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
        while (true) {
            const chunk = await reader.read();
            if (chunk.done) {
                break;
            }
            totalBytes += chunk.value.byteLength;
            if (totalBytes > MAX_DISCOVERY_RESPONSE_BYTES) {
                await reader.cancel("响应体过大");
                throw new ProviderDiscoveryError("response-too-large", "Provider 响应体超过允许大小。");
            }
            chunks.push(chunk.value);
        }
    } catch (error) {
        await reader.cancel().catch(() => undefined);
        throw error;
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
}

function parseOpenAIModels(
    payload: unknown,
    includePricing: boolean,
    api: DiscoveredProviderModelDto["api"],
): ParsedDiscoveryPage {
    const parsed = OpenAIModelsEnvelopeSchema.safeParse(payload);
    if (!parsed.success) {
        throw new ProviderDiscoveryError("invalid-response", "上游模型列表响应格式不匹配。");
    }

    const entries = parsed.data.data.map((item): DiscoveredProviderModelDto | null => {
        const parsedItem = OpenAIModelItemSchema.safeParse(item);
        if (!parsedItem.success) {
            return null;
        }
        const raw = parsedItem.data;
        const id = raw.id.trim();
        if (!id) {
            return null;
        }
        const modalities = readStringArray(raw.input_modalities) ?? readStringArray(readRecord(raw.architecture)?.input_modalities);
        const supportedParameters = readStringArray(raw.supported_parameters);
        return {
            id,
            name: readNonEmptyString(raw.name) ?? readNonEmptyString(raw.display_name) ?? id,
            group: deriveModelGroup(id),
            api,
            reasoning: readBoolean(raw.reasoning)
                ?? readBoolean(raw.supports_reasoning)
                ?? (supportedParameters
                    ? supportedParameters.some((parameter) => parameter === "reasoning" || parameter === "include_reasoning")
                    : null),
            input: modalities ? normalizeModalities(modalities) : null,
            contextWindowTokens: positiveInteger(raw.context_length)
                ?? positiveInteger(raw.context_window)
                ?? positiveInteger(raw.max_context_length)
                ?? positiveInteger(raw.max_model_len),
            maxTokens: positiveInteger(raw.max_completion_tokens)
                ?? positiveInteger(raw.max_output_tokens)
                ?? positiveInteger(readRecord(raw.top_provider)?.max_completion_tokens),
            cost: includePricing ? normalizeOpenRouterCost(raw.pricing) : null,
            compat: null,
            headers: null,
            thinkingLevelMap: null,
        };
    });
    return {entries};
}

function parseGoogleModels(payload: unknown): ParsedDiscoveryPage {
    const parsed = GoogleModelsEnvelopeSchema.safeParse(payload);
    if (!parsed.success) {
        throw new ProviderDiscoveryError("invalid-response", "Google 模型列表响应格式不匹配。");
    }

    const entries = parsed.data.models.map((item): DiscoveredProviderModelDto | null => {
        const parsedItem = GoogleModelItemSchema.safeParse(item);
        if (!parsedItem.success) {
            return null;
        }
        const raw = parsedItem.data;
        const id = raw.name.replace(/^models\//u, "").trim();
        if (!id) {
            return null;
        }
        const supportedMethods = readStringArray(raw.supportedGenerationMethods);
        if (supportedMethods && !supportedMethods.includes("generateContent")) {
            return null;
        }
        return {
            id,
            name: readNonEmptyString(raw.displayName) ?? id,
            group: deriveModelGroup(id),
            api: "google-generative-ai",
            reasoning: readBoolean(raw.reasoning) ?? readBoolean(raw.supportsReasoning),
            input: ["text"],
            contextWindowTokens: positiveInteger(raw.inputTokenLimit),
            maxTokens: positiveInteger(raw.outputTokenLimit),
            cost: null,
            compat: null,
            headers: null,
            thinkingLevelMap: null,
        };
    });
    return {
        entries,
        nextPageToken: readNonEmptyString(parsed.data.nextPageToken) ?? undefined,
    };
}

function positiveInteger(value: unknown): number | null {
    const parsed = numberLike(value);
    return parsed !== null && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function numberLike(value: unknown): number | null {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function readBoolean(value: unknown): boolean | null {
    return typeof value === "boolean" ? value : null;
}

function readNonEmptyString(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readRecord(value: unknown): JsonRecord | null {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as JsonRecord
        : null;
}

function readStringArray(value: unknown): string[] | null {
    if (!Array.isArray(value)) {
        return null;
    }
    return value.every((item): item is string => typeof item === "string") ? value : null;
}

function normalizeModalities(values: string[]): Array<"text" | "image"> | null {
    const normalized = [...new Set(values.flatMap((value) => value === "image" ? ["image" as const] : value === "text" ? ["text" as const] : []))];
    return normalized.length ? normalized : null;
}

function normalizeOpenRouterCost(pricing: unknown): DiscoveredProviderModelDto["cost"] {
    const record = readRecord(pricing);
    if (!record) {
        return null;
    }
    const input = perTokenPrice(record.prompt);
    const output = perTokenPrice(record.completion);
    if (input === null || output === null) {
        return null;
    }
    return {
        input,
        output,
        cacheRead: perTokenPrice(record.input_cache_read) ?? 0,
        cacheWrite: perTokenPrice(record.input_cache_write) ?? 0,
        tiers: [],
    };
}

function perTokenPrice(value: unknown): number | null {
    if (value === undefined || value === null || value === "") {
        return null;
    }
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
    return Number.isFinite(parsed) && parsed >= 0 ? parsed * 1_000_000 : null;
}

function mergeErrorMessage(error: unknown): string {
    const code = providerDiscoveryErrorCode(error);
    return code ? discoveryErrorDefaultMessage(code) : "无法连接 Provider 或读取模型列表。";
}

function normalizeDiscoveryError(error: unknown): ProviderDiscoveryError {
    if (error instanceof ProviderDiscoveryError) {
        return error;
    }
    const code = providerDiscoveryErrorCode(error) ?? "upstream-error";
    return new ProviderDiscoveryError(code, mergeErrorMessage(error));
}

function errorForUpstreamStatus(status: number): ProviderDiscoveryError {
    if (status === 401) {
        return new ProviderDiscoveryError("unauthorized", "上游拒绝访问模型列表（HTTP 401）。");
    }
    if (status === 403) {
        return new ProviderDiscoveryError("forbidden", "上游拒绝访问模型列表（HTTP 403）。");
    }
    if (status === 429) {
        return new ProviderDiscoveryError("rate-limited", "上游暂时限制模型列表请求（HTTP 429）。");
    }
    return new ProviderDiscoveryError("upstream-error", `上游模型列表请求失败（HTTP ${String(status)}）。`);
}

function discoveryErrorDefaultMessage(code: ProviderDiscoveryErrorCode): string {
    switch (code) {
        case "missing-base-url": return "缺少 API Base。";
        case "invalid-base-url": return "API Base 无效。";
        case "unsupported-discovery": return "当前模型 API 不支持自动发现。";
        case "unauthorized": return "上游拒绝访问模型列表（HTTP 401）。";
        case "forbidden": return "上游拒绝访问模型列表（HTTP 403）。";
        case "rate-limited": return "上游暂时限制模型列表请求（HTTP 429）。";
        case "timeout": return "请求模型列表超时。";
        case "upstream-error": return "无法连接 Provider 或读取模型列表。";
        case "invalid-response": return "上游模型列表响应格式不匹配。";
        case "empty-result": return "上游没有返回模型。";
        case "response-too-large": return "Provider 响应体超过允许大小。";
    }
}
