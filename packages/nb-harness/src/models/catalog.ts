/**
 * OMP 内置模型目录的只读视图（docs/specs/agent/harness.md “模型目录”）：给宿主画选模型的界面、给自定义模型补参数。
 *
 * 认证分类读 `pi-catalog/compat/auth` 与 `compat/providers` 的编译元数据。这两个子路径靠包的 `"./*"` 通配导出，
 * 结构随 OMP 版本变，`tests/catalog.test.ts` 对全部服务商的分类做了快照，升级 OMP 时先看它。
 * “有没有值”与目录分开（`providerKeyReady`）：它读进程环境，宿主决定何时取。
 */

import {getEnvApiKey} from "@oh-my-pi/pi-ai";
import {
    clampThinkingLevelForModel,
    fetchOpenAICompatibleModels,
    getBundledModelReferenceIndex,
    getBundledModels,
    getBundledProviders,
    getSupportedEfforts,
    resolveModelReference,
    type Effort,
    type Model,
} from "@oh-my-pi/pi-catalog";
import {authPolicyFor} from "@oh-my-pi/pi-catalog/compat/auth";
import {providerEntry} from "@oh-my-pi/pi-catalog/compat/providers";


export interface ModelPrice {
    /** 每百万 token 的单价。 */
    readonly input: number;
    readonly output: number;
    readonly cacheRead?: number;
    readonly cacheWrite?: number;
    readonly currency: string;
}

/** 推理档，同 OMP 的 `Effort`，从低到高。 */
export type ThinkingEffort = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export const THINKING_EFFORTS: readonly ThinkingEffort[] = ["minimal", "low", "medium", "high", "xhigh", "max"];

/**
 * 只认环境变量的宿主怎么用这家服务商：
 * - `keyless`：不设密钥也能请求；
 * - `login`：要登录 OMP 拿会过期的令牌，宿主不读登录态，只有它的变量有值时能用；
 * - `key`：设环境变量就能用；
 * - `unsupported`：云厂商凭据链或目录没写认证方式。
 */
export type ProviderAccess = "keyless" | "login" | "key" | "unsupported";

export interface CatalogModel {
    readonly id: string;
    readonly name: string;
    readonly api: string;
    /** 目录给的接口地址。 */
    readonly baseUrl: string;
    readonly contextWindow: number | null;
    readonly maxTokens: number | null;
    readonly reasoning: boolean;
    /** 能选的推理档；不支持推理或推理档不可控时为空。 */
    readonly efforts: readonly ThinkingEffort[];
    readonly images: boolean;
    /** 目录单价全为 0 时为 null：18.2.5 的目录分不出免费与没标价，一律当未知。 */
    readonly price: ModelPrice | null;
}

export interface CatalogProvider {
    readonly id: string;
    readonly name: string;
    readonly access: ProviderAccess;
    /** 目录登记的密钥变量，按 OMP 查找的顺序；OMP 的 hook 另认的来源（例如 `ANTHROPIC_OAUTH_TOKEN`）不在其中。 */
    readonly keyEnvs: readonly string[];
    readonly models: readonly CatalogModel[];
}

type BundledProvider = Parameters<typeof getBundledModels>[0];

/** 认证分类，按顺序取第一个符合的。 */
export function providerAccess(id: string): ProviderAccess {
    const auth = authPolicyFor(id);
    const entry = providerEntry(id);
    if (entry?.allowUnauthenticated === true) return "keyless";
    const refresh = auth?.refresh?.kind;
    const envVars = entry?.envVars ?? [];
    if (refresh === "request" || refresh === "hook") return "login";
    if (auth?.login !== undefined && envVars.length === 0) return "login";
    if (envVars.length > 0) return "key";
    return "unsupported";
}

export function providerKeyEnvs(id: string): readonly string[] {
    return providerEntry(id)?.envVars ?? [];
}

/**
 * 这家服务商在当前进程环境里有没有可用的密钥：OMP 的 `getEnvApiKey` 非空，且不是云凭据链的占位
 * `<authenticated>`（同 OMP 的 `hasConcreteAuth`）。它会读 `.env`，宿主要的是“启动时”的状态就在启动时取一次。
 */
export function providerKeyReady(id: string): boolean {
    const value = getEnvApiKey(id);
    return typeof value === "string" && value.trim() !== "" && value !== "<authenticated>";
}

let catalog: readonly CatalogProvider[] | undefined;

/** 全部服务商与模型（按 OMP 的顺序）。只含静态元数据，进程内算一次。 */
export function listCatalog(): readonly CatalogProvider[] {
    catalog ??= getBundledProviders().map(id => ({
        id,
        name: authPolicyFor(id)?.name ?? id,
        access: providerAccess(id),
        keyEnvs: providerKeyEnvs(id),
        models: (getBundledModels(id as BundledProvider) as Model[]).map(catalogModel),
    }));
    return catalog;
}

export function catalogModel(model: Model): CatalogModel {
    return {
        id: model.id,
        name: model.name,
        api: model.api,
        baseUrl: model.baseUrl,
        contextWindow: positiveOrNull(model.contextWindow),
        maxTokens: positiveOrNull(model.maxTokens),
        reasoning: model.reasoning,
        efforts: supportedEfforts(model),
        images: model.input.includes("image"),
        price: catalogPrice(model),
    };
}

/** 目录单价：全为 0 当未知（见 `CatalogModel.price`）。 */
export function catalogPrice(model: Model): ModelPrice | null {
    const cost = model.cost;
    if (cost === undefined || [cost.input, cost.output, cost.cacheRead, cost.cacheWrite].every(value => (value ?? 0) === 0)) return null;
    return {input: cost.input, output: cost.output, cacheRead: cost.cacheRead, cacheWrite: cost.cacheWrite, currency: "USD"};
}

export function supportedEfforts(model: Model): readonly ThinkingEffort[] {
    return getSupportedEfforts(model) as readonly string[] as readonly ThinkingEffort[];
}

/** 把选的推理档夹到模型支持的档（同 OMP）：不支持推理的模型得到 undefined，即不发推理参数。 */
export function clampEffort(model: Model, requested: ThinkingEffort | undefined): ThinkingEffort | undefined {
    return clampThinkingLevelForModel(model, requested as Effort | undefined) as ThinkingEffort | undefined;
}

/** 按模型名在目录里找到的参照：自定义模型没写的参数从这里补（同 OMP 的 `finalizeCustomModel`）。 */
export interface CatalogSuggestion {
    /** 参照的目录模型，`服务商/模型名`。 */
    readonly from: string;
    readonly contextWindow: number | null;
    readonly maxTokens: number | null;
    readonly reasoning: boolean;
    readonly images: boolean;
}

/** 按模型名找参照（认得代理常见的前后缀，例如 `openai/gpt-5`）；找不到时为 null。 */
export function suggestFromCatalog(modelId: string): CatalogSuggestion | null {
    const reference = resolveModelReference(modelId, getBundledModelReferenceIndex()) as Model | undefined;
    if (reference === undefined) return null;
    return {
        from: `${reference.provider}/${reference.id}`,
        contextWindow: positiveOrNull(reference.contextWindow),
        maxTokens: positiveOrNull(reference.maxTokens),
        reasoning: reference.reasoning,
        images: reference.input.includes("image"),
    };
}

function positiveOrNull(value: number | null | undefined): number | null {
    return typeof value === "number" && value > 0 ? value : null;
}

/** 读 OpenAI 兼容服务的 `/models` 得到的一个模型；`suggested` 是按模型名在目录里找到的参照，只是建议。 */
export interface DiscoveredModel {
    readonly id: string;
    readonly name: string;
    readonly suggested: CatalogSuggestion | null;
}

/**
 * 读 `/models` 的结果：`found` 读到模型；`empty` 服务回了空列表；`not_supported` 服务没有这个接口（404）；`auth` 密钥
 * 被拒（401、403）；`unreachable` 连不上或超时；`failed` 其余（别的状态码、回的不是模型列表）。
 */
export type DiscoveryResult =
    | {readonly state: "found"; readonly models: readonly DiscoveredModel[]}
    | {readonly state: "empty"}
    | {readonly state: "not_supported"; readonly status: number}
    | {readonly state: "auth"; readonly status: number}
    | {readonly state: "unreachable"; readonly message: string}
    | {readonly state: "failed"; readonly status: number | null; readonly message: string};

export interface DiscoverModelsOptions {
    readonly api: "openai-completions" | "openai-responses";
    readonly baseUrl: string;
    /** 不给时不带认证头。 */
    readonly apiKey?: string;
    /** 另带的请求头（宿主配置的，`env:` 已解析）。 */
    readonly headers?: Readonly<Record<string, string>>;
    readonly signal?: AbortSignal;
    /** 不给 `signal` 时的超时，缺省用 OMP 的（10 秒）。 */
    readonly timeoutMs?: number;
}

/**
 * 读 OpenAI 兼容服务的 `/models`（同 OMP 的 `openai-models-list` 发现）。OMP 的 `fetchOpenAICompatibleModels` 失败时
 * 只回 `null`，所以把 `fetch` 包一层，记下这次请求的状态码或网络错误来分原因，不按错误文案猜。响应体也在这一层读完：
 * OMP 读响应体出错（包括超时中止）同样只回 `null`，读不完要算连不上，不能落到“回应不是模型列表”。
 */
export async function discoverModels(options: DiscoverModelsOptions): Promise<DiscoveryResult> {
    let status: number | null = null;
    let networkError: unknown = null;
    const recording = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
        try {
            const response = await fetch(input, init);
            // 请求的 signal（OMP 的超时）同样中止响应体的读取。
            const body = await response.text();
            status = response.status;
            return new Response(body, {status: response.status, statusText: response.statusText, headers: response.headers});
        } catch (error) {
            networkError = error;
            throw error;
        }
    };
    const specs = await fetchOpenAICompatibleModels({
        api: options.api,
        provider: "custom",
        baseUrl: options.baseUrl,
        ...(options.apiKey === undefined ? {} : {apiKey: options.apiKey}),
        ...(options.headers === undefined ? {} : {headers: {...options.headers}}),
        ...(options.signal === undefined ? {} : {signal: options.signal}),
        ...(options.timeoutMs === undefined ? {} : {timeoutMs: options.timeoutMs}),
        fetch: recording as typeof fetch,
    });
    if (specs !== null) {
        if (specs.length === 0) return {state: "empty"};
        return {state: "found", models: specs.map(spec => ({id: spec.id, name: spec.name, suggested: suggestFromCatalog(spec.id)}))};
    }
    if (networkError !== null || status === null) return {state: "unreachable", message: networkError instanceof Error ? networkError.message : "连不上，或者超时"};
    if (status === 404) return {state: "not_supported", status};
    if (status === 401 || status === 403) return {state: "auth", status};
    return {state: "failed", status, message: status >= 200 && status < 300 ? "回应不是模型列表" : `服务回了 ${status}`};
}
