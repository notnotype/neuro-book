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
    getBundledModel,
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

import type {OnlineCatalog} from "./online-catalog.js";


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

/**
 * 能当对话模型用的线协议（模型清单只收这些，embedding、图片、语音、检索等不进）。OMP 给 OpenRouter 的复合协议 `openrouter` 在
 * 这里换成它实际走的显式协议：服务端进程的环境变量 `PI_OPENROUTER_RESPONSES` 为 `0` 时是 Chat Completions，否则是 Responses
 * （与 pi-ai 自己的判断相同，升级前设了这个变量的用户照旧）。物化之后模型带的是显式协议，请求时不再随环境变量变。
 */
export type WireApi = "openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai";

export function wireApiOf(api: string): WireApi | null {
    switch (api) {
        case "openai-completions":
        case "openai-responses":
        case "anthropic-messages":
        case "google-generative-ai":
            return api;
        case "openrouter":
            return process.env.PI_OPENROUTER_RESPONSES === "0" ? "openai-completions" : "openai-responses";
        default:
            return null;
    }
}

export interface CatalogModel {
    readonly id: string;
    readonly name: string;
    readonly api: string;
    /** 对话用的显式协议；不是对话模型（embedding、图片等）或走 `fetch` 之外的传输时为 null。 */
    readonly wire: WireApi | null;
    /** 对话类模型（不是图片生成、裁判等独立的模型）。 */
    readonly chat: boolean;
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
        models: (getBundledModels(id as BundledProvider) as Model[]).map((model) => catalogModel(model)),
    }));
    return catalog;
}

/** `priced`：在线目录的行按原文判断价目是否存在（在而全为 0 是免费）；不给时按打包目录的规则（全为 0 当未知）。 */
export function catalogModel(model: Model, priced?: boolean): CatalogModel {
    return {
        id: model.id,
        name: model.name,
        api: model.api,
        wire: wireApiOf(model.api),
        // 同一个 HTTP 协议也用来跑图片生成、裁判这类独立的模型：只有对话类的才进模型清单（`kind` 缺省是对话）。
        chat: (model.kind ?? "chat") === "chat",
        baseUrl: model.baseUrl,
        contextWindow: positiveOrNull(model.contextWindow),
        maxTokens: positiveOrNull(model.maxTokens),
        reasoning: model.reasoning,
        efforts: supportedEfforts(model),
        images: model.input.includes("image"),
        price: priced === undefined ? catalogPrice(model) : priced ? {input: model.cost.input, output: model.cost.output, cacheRead: model.cost.cacheRead, cacheWrite: model.cost.cacheWrite, currency: "USD"} : null,
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

/** 这家服务商打包目录里的对话模型（对话类、走 `fetch` 的显式协议）。 */
export function chatModels(provider: string): readonly CatalogModel[] {
    return listCatalog().find((item) => item.id === provider)?.models.filter((model) => model.wire !== null && model.chat) ?? [];
}

/**
 * 打包目录里有、但不能当对话模型发的行为什么不行：不是对话类（图片生成、裁判……），或传输不走 HTTP 请求（Bedrock、Cursor、Codex）。
 * 目录里没有这一行，或它能发，为 null。
 */
export function unsendableReason(provider: string, id: string): "not-chat" | "transport" | null {
    const row = listCatalog().find((item) => item.id === provider)?.models.find((model) => model.id === id);
    if (row === undefined) return null;
    if (!row.chat) return "not-chat";
    return row.wire === null ? "transport" : null;
}

/**
 * 这家服务商各协议的对话地址：同一协议下取多数模型用的那个（混合协议的服务商，如 OpenCode Zen，各协议的地址不同）。地址里带
 * 占位（`{region}`、`<account>`）的不给，要用户自己填。
 */
export function templateRoutes(provider: string): ReadonlyArray<{readonly api: WireApi; readonly baseUrl: string}> {
    const counts = new Map<WireApi, Map<string, number>>();
    for (const model of chatModels(provider)) {
        if (model.wire === null || /[{}<>]/u.test(model.baseUrl) || model.baseUrl === "") continue;
        const urls = counts.get(model.wire) ?? new Map<string, number>();
        urls.set(model.baseUrl, (urls.get(model.baseUrl) ?? 0) + 1);
        counts.set(model.wire, urls);
    }
    return [...counts].map(([api, urls]) => ({api, baseUrl: [...urls].sort((a, b) => b[1] - a[1])[0]![0]}));
}

/** 目录里的一行：OMP 的模型对象、给界面的只读视图与价目是否已知。 */
export interface CatalogRow {
    readonly model: Model;
    readonly info: CatalogModel;
    readonly priceKnown: boolean;
}

/**
 * 模型元数据的视图：打包目录为底，在线目录只补打包里没有的模型（同 id 的用打包的：打包时做过修正）。按（OMP 服务商，模型 id）查。
 * 一个视图是不可变的；在线目录换了，调用方换一个新的视图。
 */
export interface CatalogView {
    /** 这家的对话模型（对话类、走 `fetch` 的显式协议），打包的在前。 */
    chatModels(provider: string): readonly CatalogModel[];
    /** 任何种类的一行；没有为 undefined。 */
    find(provider: string, id: string): CatalogRow | undefined;
    /** 有这一行但不能当对话模型发时说为什么（同 `unsendableReason`）。 */
    unsendable(provider: string, id: string): "not-chat" | "transport" | null;
}

export function createCatalogView(online?: OnlineCatalog): CatalogView {
    const extra = new Map<string, Map<string, CatalogRow>>();
    for (const [provider, rows] of online?.providers ?? []) {
        const bundled = new Set(listCatalog().find((item) => item.id === provider)?.models.map((model) => model.id) ?? []);
        const map = new Map<string, CatalogRow>();
        for (const row of rows) if (!bundled.has(row.model.id) && !map.has(row.model.id)) map.set(row.model.id, {model: row.model, info: catalogModel(row.model, row.priced), priceKnown: row.priced});
        if (map.size > 0) extra.set(provider, map);
    }
    const chat = new Map<string, readonly CatalogModel[]>();
    const find = (provider: string, id: string): CatalogRow | undefined => {
        const added = extra.get(provider)?.get(id);
        if (added !== undefined) return added;
        if (!(getBundledProviders() as readonly string[]).includes(provider)) return undefined;
        const model = getBundledModel(provider as BundledProvider, id) as Model | undefined;
        return model === undefined ? undefined : {model, info: catalogModel(model), priceKnown: catalogPrice(model) !== null};
    };
    return {
        chatModels: (provider) => {
            let found = chat.get(provider);
            if (found === undefined) {
                found = [...chatModels(provider), ...[...(extra.get(provider)?.values() ?? [])].map((row) => row.info).filter((model) => model.wire !== null && model.chat)];
                chat.set(provider, found);
            }
            return found;
        },
        find,
        unsendable: (provider, id) => {
            const row = find(provider, id);
            if (row === undefined) return null;
            if (!row.info.chat) return "not-chat";
            return row.info.wire === null ? "transport" : null;
        },
    };
}
