/**
 * 读服务商自己的模型列表（docs/specs/models/service.md“模型来源”）：按实例生效的协议、地址与认证发 `GET`，交回列表原生的字段与
 * 分类证据，不查目录、不补值（那是调用方按部署现算的）。
 *
 * - 不跟随重定向（`redirect: "manual"`，3xx 算 `bad-response`）：密钥只发往配置的地址。
 * - 段 C 之前直连（`proxy: false`），同模型请求。
 * - **只有读完整才算成功**：分页的协议读到末页；重复游标、页数或行数超限、单页超字节都算失败，不截断成一份“看起来成功”的短表。
 */

import type {WireApi} from "./catalog.js";

/** 列表的变体：OpenAI 兼容的 `/models`、OpenRouter 的（带模态与窗口）、Anthropic 的 `/v1/models`、Gemini 的 `/models`。 */
export type ListingFlavor = "openai" | "openrouter" | "anthropic" | "gemini";

/**
 * 列表里的一行。`kind`：列表自己说明了是不是对话模型（Gemini 的 `supportedGenerationMethods`、OpenRouter 的输出模态）时为
 * `chat` 或 `other`，否则 `unknown`，由调用方查目录或按规则处理。
 */
export interface ListedModel {
    readonly id: string;
    readonly name?: string;
    readonly kind: "chat" | "other" | "unknown";
    readonly contextWindow?: number;
    readonly maxOutput?: number;
    readonly vision?: boolean;
}

/** `auth` 401、403；`not-found` 404、405（服务商没有列表接口）；`unreachable` 连不上；`bad-response` 其余；`cancelled` 被调用方取消。 */
export type ListingFailure = "auth" | "not-found" | "unreachable" | "bad-response" | "cancelled";

export type ListingResult =
    | {readonly ok: true; readonly rows: readonly ListedModel[]}
    | {readonly ok: false; readonly reason: ListingFailure; readonly status: number | null; readonly message: string};

/** 完整性的上限：超了算失败。现在最大的公开列表（OpenRouter）约 600 行、1 MiB。 */
export const LISTING_LIMITS = {pages: 20, pageBytes: 8 * 1024 * 1024, rows: 5000, idLength: 256} as const;

export interface ListModelsOptions {
    readonly flavor: ListingFlavor;
    /** 实例生效的对话地址（与对话请求同一个）。 */
    readonly baseUrl: string;
    /** 认证头与配置的请求头，调用方合好（`listingHeaders`）。 */
    readonly headers: Readonly<Record<string, string>>;
    readonly signal: AbortSignal;
}

/** 按协议与模板定变体：OpenRouter 的模板用它自己的列表形状，其余按协议。 */
export function listingFlavor(api: WireApi, template: string | null): ListingFlavor {
    if (template === "openrouter" && (api === "openai-completions" || api === "openai-responses")) return "openrouter";
    if (api === "anthropic-messages") return "anthropic";
    if (api === "google-generative-ai") return "gemini";
    return "openai";
}

/**
 * 列表请求的认证头：协议的缺省头在前，配置的请求头（`requestAuth` 已合好、含 `bearer` 方式另加的 `Authorization`）在后、同名时
 * 盖过缺省。Anthropic 跟随模板时用 `x-api-key`，否则用 `Authorization: Bearer`，与对话请求一致（B1 的线上核对）。`key` 为 null 时不带。
 */
export function listingHeaders(flavor: ListingFlavor, key: string | null, configured: Readonly<Record<string, string>>, follows: boolean): Record<string, string> {
    const headers: Record<string, string> = {accept: "application/json"};
    if (key !== null) {
        if (flavor === "gemini") headers["x-goog-api-key"] = key;
        else if (flavor === "anthropic" && follows) headers["x-api-key"] = key;
        else headers.authorization = `Bearer ${key}`;
    }
    if (flavor === "anthropic") headers["anthropic-version"] = "2023-06-01";
    const lower = new Map(Object.keys(headers).map((name) => [name.toLowerCase(), name]));
    for (const [name, value] of Object.entries(configured)) {
        const existing = lower.get(name.toLowerCase());
        if (existing !== undefined) delete headers[existing];
        headers[name] = value;
    }
    return headers;
}

/** 第一页与后续页的地址；`cursor` 是上一页交回的游标。 */
export function listingUrl(flavor: ListingFlavor, baseUrl: string, cursor: string | null): URL {
    const base = baseUrl.replace(/\/+$/u, "");
    switch (flavor) {
        case "openai":
        case "openrouter":
            return new URL(`${base}/models`);
        case "anthropic": {
            // 打包目录里 Anthropic 的地址有带 `/v1` 与不带的两种，对话请求都接 `/v1/messages` 或 `/messages`；列表固定在 `/v1/models`。
            const url = new URL(`${/\/v1$/u.test(base) ? base : `${base}/v1`}/models`);
            url.searchParams.set("limit", "1000");
            if (cursor !== null) url.searchParams.set("after_id", cursor);
            return url;
        }
        case "gemini": {
            const url = new URL(`${base}/models`);
            url.searchParams.set("pageSize", "1000");
            if (cursor !== null) url.searchParams.set("pageToken", cursor);
            return url;
        }
    }
}

class BadResponse extends Error {}

export async function listModels(options: ListModelsOptions): Promise<ListingResult> {
    const rows = new Map<string, ListedModel>();
    const cursors = new Set<string>();
    let cursor: string | null = null;
    for (let page = 1; ; page += 1) {
        if (page > LISTING_LIMITS.pages) return bad(null, `the list has more than ${String(LISTING_LIMITS.pages)} pages`);
        let response: Response;
        try {
            response = await fetch(listingUrl(options.flavor, options.baseUrl, cursor), {method: "GET", headers: {...options.headers}, redirect: "manual", signal: options.signal, proxy: false} as RequestInit);
        } catch (error) {
            return thrown(error, options.signal);
        }
        if (response.status === 401 || response.status === 403) return drain(response, "auth");
        if (response.status === 404 || response.status === 405) return drain(response, "not-found");
        if (response.status !== 200) return drain(response, "bad-response");
        let body: unknown;
        try {
            body = JSON.parse(await readBounded(response, LISTING_LIMITS.pageBytes));
        } catch (error) {
            if (error instanceof BadResponse) return bad(200, error.message);
            if (error instanceof SyntaxError) return bad(200, "the response is not JSON");
            return thrown(error, options.signal);
        }
        let parsed: {rows: ListedModel[]; next: string | null};
        try {
            parsed = parsePage(options.flavor, body);
        } catch (error) {
            if (error instanceof BadResponse) return bad(200, error.message);
            throw error;
        }
        for (const row of parsed.rows) if (!rows.has(row.id)) rows.set(row.id, row);
        if (rows.size > LISTING_LIMITS.rows) return bad(200, `the list has more than ${String(LISTING_LIMITS.rows)} models`);
        if (parsed.next === null) return {ok: true, rows: [...rows.values()]};
        if (cursors.has(parsed.next)) return bad(200, "the list repeated a page cursor");
        cursors.add(parsed.next);
        cursor = parsed.next;
    }
}

const bad = (status: number | null, message: string): ListingResult => ({ok: false, reason: "bad-response", status, message});

function thrown(error: unknown, signal: AbortSignal): ListingResult {
    if (signal.aborted) return {ok: false, reason: "cancelled", status: null, message: "the request was cancelled"};
    return {ok: false, reason: "unreachable", status: null, message: error instanceof Error ? error.message : String(error)};
}

/** 失败的响应只取前一段原文作说明（不读完一个可能很大的错误页）。 */
async function drain(response: Response, reason: ListingFailure): Promise<ListingResult> {
    let text = "";
    try {
        text = (await readBounded(response, 2048, true)).trim();
    } catch {
        // 说明读不到不影响分类。
    }
    const status = response.status;
    return {ok: false, reason, status, message: `the endpoint answered ${String(status)}${text === "" ? "" : `: ${text.slice(0, 300)}`}`};
}

/** 按字节读响应体；超过上限时取消读取，`truncate` 为真时交回已读的一段，否则抛 `BadResponse`。 */
async function readBounded(response: Response, limit: number, truncate = false): Promise<string> {
    const reader = response.body?.getReader();
    if (reader === undefined) return "";
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
        const {done, value} = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) {
            await reader.cancel();
            if (!truncate) throw new BadResponse(`a page is larger than ${String(limit)} bytes`);
            chunks.push(value.subarray(0, value.byteLength - (size - limit)));
            break;
        }
        chunks.push(value);
    }
    return new TextDecoder().decode(Buffer.concat(chunks));
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const positive = (value: unknown): number | undefined => (typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined);
const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() !== "" ? value.trim() : undefined);

function modelId(value: unknown): string {
    if (typeof value !== "string" || value === "" || value.length > LISTING_LIMITS.idLength || /[\u0000-\u001f]/u.test(value)) throw new BadResponse("a model in the list has no usable id");
    return value;
}

function parsePage(flavor: ListingFlavor, body: unknown): {rows: ListedModel[]; next: string | null} {
    switch (flavor) {
        case "openai":
        case "openrouter": {
            const data = Array.isArray(body) ? body : isRecord(body) ? body.data : undefined;
            if (!Array.isArray(data)) throw new BadResponse("the response is not a model list");
            return {rows: data.map((item) => (flavor === "openrouter" ? openRouterRow(item) : openAiRow(item))), next: null};
        }
        case "anthropic": {
            if (!isRecord(body) || !Array.isArray(body.data)) throw new BadResponse("the response is not a model list");
            const rows = body.data.map((item): ListedModel => {
                if (!isRecord(item)) throw new BadResponse("a model in the list is not an object");
                const name = text(item.display_name);
                // Anthropic 的列表只有对话模型；窗口与上限它不给，由目录或用户补。
                return {id: modelId(item.id), kind: "chat", ...(name === undefined ? {} : {name})};
            });
            const more = body.has_more === true;
            const last = typeof body.last_id === "string" && body.last_id !== "" ? body.last_id : null;
            if (more && last === null) throw new BadResponse("the list says it has more pages but gives no cursor");
            return {rows, next: more ? last : null};
        }
        case "gemini": {
            if (!isRecord(body) || (body.models !== undefined && !Array.isArray(body.models))) throw new BadResponse("the response is not a model list");
            const rows = ((body.models ?? []) as unknown[]).map((item): ListedModel => {
                if (!isRecord(item) || typeof item.name !== "string") throw new BadResponse("a model in the list has no name");
                const id = modelId(item.name.startsWith("models/") ? item.name.slice("models/".length) : item.name);
                const methods = Array.isArray(item.supportedGenerationMethods) ? item.supportedGenerationMethods : null;
                const name = text(item.displayName);
                const contextWindow = positive(item.inputTokenLimit);
                const maxOutput = positive(item.outputTokenLimit);
                return {
                    id,
                    kind: methods === null ? "unknown" : methods.includes("generateContent") || methods.includes("streamGenerateContent") ? "chat" : "other",
                    ...(name === undefined ? {} : {name}),
                    ...(contextWindow === undefined ? {} : {contextWindow}),
                    ...(maxOutput === undefined ? {} : {maxOutput}),
                };
            });
            const next = typeof body.nextPageToken === "string" && body.nextPageToken !== "" ? body.nextPageToken : null;
            return {rows, next};
        }
    }
}

function openAiRow(item: unknown): ListedModel {
    if (!isRecord(item)) throw new BadResponse("a model in the list is not an object");
    const name = text(item.name);
    // 个别兼容服务（Together、OpenRouter 的镜像）在 `/models` 里带窗口；OpenAI 自己不带。
    const contextWindow = positive(item.context_length) ?? positive(item.context_window);
    return {id: modelId(item.id), kind: "unknown", ...(name === undefined ? {} : {name}), ...(contextWindow === undefined ? {} : {contextWindow})};
}

function openRouterRow(item: unknown): ListedModel {
    if (!isRecord(item)) throw new BadResponse("a model in the list is not an object");
    const name = text(item.name);
    const contextWindow = positive(item.context_length);
    const maxOutput = isRecord(item.top_provider) ? positive(item.top_provider.max_completion_tokens) : undefined;
    const architecture = isRecord(item.architecture) ? item.architecture : null;
    const input = architecture !== null && Array.isArray(architecture.input_modalities) ? architecture.input_modalities : null;
    const output = architecture !== null && Array.isArray(architecture.output_modalities) ? architecture.output_modalities : null;
    const kind = output === null ? "unknown" : output.includes("text") && (input === null || input.includes("text")) ? "chat" : "other";
    return {
        id: modelId(item.id),
        kind,
        ...(name === undefined ? {} : {name}),
        ...(contextWindow === undefined ? {} : {contextWindow}),
        ...(maxOutput === undefined ? {} : {maxOutput}),
        ...(input === null ? {} : {vision: input.includes("image")}),
    };
}
