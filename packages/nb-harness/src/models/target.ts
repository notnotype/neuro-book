/**
 * 由一份服务商（模板的实例）与模型的配置建出模型端口要的解析结果（`ModelResolution` 的成功分支）：OMP 的模型对象、`ModelInfo` 与
 * `call`（docs/specs/models/service.md、docs/specs/harness/models.md）。
 *
 * - 元数据按（模板的 OMP 服务商，模型 id）取打包目录里的那一行；协议、地址与实例覆盖叠上去。同模板、同协议的行整行沿用
 *   （专用处理随它），协议不同的行只借能力字段（上下文窗口、上限、模态、推理、单价），不带协议专属的字段。
 * - 发给 OMP 的身份（`Model.provider`）：协议与地址都跟随模板时是模板的 OMP id，否则、或空白模板，是中性身份 `NEUTRAL_PROVIDER`。
 *   OMP 按这个身份走各家的专用处理，并会按进程环境变量改写请求地址，所以无论哪种，请求发出前都核对完整地址（`wireGuard`）。
 * - 密钥与请求头里的 `env:` 每次请求现取：凭据库与环境快照都是同步可读的，所以在 `call` 一开头就能定下这次用的密钥，
 *   “认证方式”要把它放进请求头时也拿得到。取不到时交给适配器按 `auth`、`missing-key` 失败（不发请求）。
 */

import {unlink} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {NO_AUTH_SENTINEL} from "@oh-my-pi/pi-ai/auth-retry";
import {getBundledModel, getBundledProviders, type Model} from "@oh-my-pi/pi-catalog";
import {buildModel} from "@oh-my-pi/pi-catalog/build";
import {getLogsDir} from "@oh-my-pi/pi-utils";

import {ompCall, ompModelInfo} from "../kernel/index.js";
import type {ModelInfo, ModelResolution, OmpFetchFailure, OmpIdentity, OmpTransport} from "../kernel/index.js";
import {catalogPrice, templateRoutes, unsendableReason, wireApiOf} from "./catalog.js";
import type {WireApi} from "./catalog.js";
import {envRefName, envValue, type StartupEnv} from "./env.js";

/** 实例的线协议：对话用的四种。 */
export type CustomApi = WireApi;

/** 中性身份：实例改了协议或地址、或来自空白模板时，发给 OMP 的服务商 id（不触发任何一家的专用处理）。 */
export const NEUTRAL_PROVIDER = "generic-endpoint";

/**
 * 认证方式：`default` 按接口格式（OpenAI 系 `Authorization: Bearer`，Anthropic `x-api-key`）；`bearer` 另加
 * `Authorization: Bearer <密钥>`（Anthropic 格式的中转站常要）；`none` 不带密钥。
 */
export type AuthMode = "default" | "bearer" | "none";

export interface ProviderTarget {
    /** 实例 id：公开引用 `<id>/<模型>` 的前半，凭据库按它存密钥。 */
    readonly id: string;
    /** 模板在 OMP 打包目录里的服务商 id；空白模板为 null。 */
    readonly template: string | null;
    /** 协议与地址都跟随模板（地区地址也算跟随）：为真时发给 OMP 的身份是模板的 OMP id。空白模板恒为假。 */
    readonly follows: boolean;
    /** 覆盖模板的协议；空白模板必填。 */
    readonly api?: WireApi;
    /** 模板的缺省协议：没有覆盖、又没有同 id 的目录行（手加的模型）时用它。 */
    readonly defaultApi?: WireApi;
    /** 覆盖模板的地址（或地区地址）；空白模板必填。 */
    readonly baseUrl?: string;
    /** 有值时密钥取这个环境变量，盖过凭据库里的。 */
    readonly apiKeyEnv?: string;
    readonly auth: AuthMode;
    readonly headers?: Readonly<Record<string, string>>;
}

export interface ModelTarget {
    readonly id: string;
    /** 用户手加的模型：不查目录行（目录后来恰好有了同 id 的，也不改它的能力与来历），窗口必须自己给。 */
    readonly manual?: boolean;
    readonly name?: string;
    readonly contextWindow?: number;
    readonly maxOutput?: number;
    readonly vision?: boolean;
    readonly reasoning?: boolean;
    readonly compactAt?: number;
    /** 触发点要等窗口知道了才算得出（窗口可能来自目录）：给了就用它的结果，没有结果时退回 `compactAt`。 */
    readonly compactAtFor?: (contextWindow: number) => number | undefined;
    /** 每百万 token 的美元单价：输入、输出、缓存读、缓存写；null 是未知，不写时用目录的。 */
    readonly price?: readonly [number, number, number, number] | null;
    readonly headers?: Readonly<Record<string, string>>;
}

export interface KeyAccess {
    /** 凭据库里这家的 API Key。 */
    readonly stored: (provider: string) => string | null;
    readonly env: StartupEnv;
}

/** 解析时宿主给的挂钩；都不给时按没有身份、不核对“解析后配置是否变过”处理（直接用目标的测试）。 */
export interface ResolveHooks {
    /** `call` 每次请求现读。 */
    readonly transport?: () => OmpTransport;
    /** 这次解析得到的有效协议与地址，宿主据此算部署身份（`deployment`）与凭据身份（`credential`，要用到 `key`）。 */
    readonly identityOf?: (effective: {readonly api: WireApi; readonly baseUrl: string; readonly key: string | null; readonly headers: Readonly<Record<string, string>>}) => OmpIdentity;
    /** 发出前再问一次：这份解析用的配置现在还是实例的当前配置吗（解析后实例被改了地址或换了凭据，旧解析不能再发）。 */
    readonly stillCurrent?: () => boolean;
    /** 公开引用的实例名；不给用 `ProviderTarget.id`。 */
    readonly publicName?: string;
}

export interface BuiltModel {
    readonly ok: true;
    readonly resolution: Extract<ModelResolution, {ok: true}>;
    readonly model: Model;
    /** 生效的协议与对话地址（元数据或实例覆盖得出）。 */
    readonly api: WireApi;
    readonly baseUrl: string;
}
/**
 * 建不出来：`unknown-model` 是目录里没有、缺上下文窗口或协议与地址凑不齐；`transport-unsupported` 是目录里有这一行、但它不能当对话
 * 模型发（不是对话类，或传输不走 HTTP 请求），`reason` 说是哪一种。对会话两者都是 `unknown-model`，由模型服务映射。
 */
export type BuildResult = BuiltModel | {readonly ok: false; readonly code: "unknown-model"} | {readonly ok: false; readonly code: "transport-unsupported"; readonly reason: "not-chat" | "transport"};

/**
 * 删 `pi-ai` 落盘的请求全文（docs/specs/harness/models.md 输出 19）。路径是从错误文字里取的，而错误文字含服务商的正文，可以伪造：
 * 不是它自己日志目录下的就不删。文件已经没了算达成（它后台清理也会删）。
 */
async function discardRequestDump(path: string): Promise<void> {
    if (dirname(resolve(path)) !== join(getLogsDir(), "http-400-requests")) return;
    try {
        await unlink(path);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
}

/** `hooks.transport` 每次请求现读：解析结果会被缓存，设置改了要从下一次请求起生效。 */
export function buildResolution(provider: ProviderTarget, config: ModelTarget, access: KeyAccess, hooks: ResolveHooks = {}): BuildResult {
    const built = materialize(provider, config);
    if (built === null) return {ok: false, code: "unknown-model"};
    if ("unsendable" in built) return {ok: false, code: "transport-unsupported", reason: built.unsendable};
    const {model, priceKnown, api, baseUrl} = built;
    const name = `${hooks.publicName ?? provider.id}/${config.id}`;
    const base = ompModelInfo(model, name);
    const compactAt = config.compactAtFor?.(base.contextWindow) ?? config.compactAt;
    const info: ModelInfo = {...base, ...(compactAt === undefined ? {} : {compactAt})};
    const wire = wireGuard(api, baseUrl);
    const identity = hooks.identityOf?.({api, baseUrl, key: keyOf(provider, access, []), headers: requestAuth(provider, config, access).headers});
    return {
        ok: true,
        model,
        api,
        baseUrl,
        resolution: {
            ok: true,
            info,
            call: (request, signal, onDelta, meta) => {
                const {key, headers, missing} = requestAuth(provider, config, access);
                return ompCall({
                    model,
                    name,
                    priceKnown,
                    headers,
                    ...(identity === undefined ? {} : {identity}),
                    guard: (url) => (hooks.stillCurrent?.() === false ? {code: "endpoint-mismatch", message: "the provider was changed after this model was resolved; resolve it again"} : wire(url)),
                    ...(provider.auth === "none" ? {keyless: true} : {}),
                    // 代理设置要到网络出口（w00032 t43 段 C）才有：在那之前模型请求一律直连，不吃进程环境里的代理变量。
                    direct: true,
                    onRequestDump: discardRequestDump,
                    ...(hooks.transport === undefined ? {} : {transport: hooks.transport()}),
                    apiKey: () => {
                        if (missing.length > 0 || key === null) throw new Error(`no credential for provider ${provider.id}${missing.length > 0 ? ` (environment variable ${missing.join(", ")} is not set)` : ""}`);
                        return key;
                    },
                })(request, signal, onDelta, meta);
            },
        },
    };
}

/**
 * 请求发出前核对完整地址（协议、主机、端口、路径、查询）：必须是这一协议在这个有效地址下会请求的那几个。OMP 对有的服务商
 * 会按环境变量改写地址，连主机不变只改路径的也有（探针记在 Task 证据 `b1-probes.txt`）；这里在最内层挡住，不依赖身份选择。
 * 路径后缀按协议写：各协议的 SDK 在地址后接的固定段，不识别的后缀一律拒绝（宁可误拒、让用户改地址，也不把密钥发到别处）。
 */
export function wireGuard(api: WireApi, baseUrl: string): (url: URL) => OmpFetchFailure | null {
    const base = new URL(baseUrl);
    const basePath = base.pathname.replace(/\/+$/u, "");
    const mismatch = (url: URL): OmpFetchFailure => ({code: "endpoint-mismatch", message: `request to ${url.origin}${url.pathname} does not match the configured ${api} endpoint ${base.origin}${basePath}`});
    return (url) => {
        if (url.origin !== base.origin || !url.pathname.startsWith(`${basePath}/`) || url.username !== "" || url.password !== "") return mismatch(url);
        const rest = url.pathname.slice(basePath.length);
        const keys = [...url.searchParams.keys()];
        switch (api) {
            case "openai-completions":
                return rest === "/chat/completions" && keys.length === 0 ? null : mismatch(url);
            case "openai-responses":
                return rest === "/responses" && keys.length === 0 ? null : mismatch(url);
            case "anthropic-messages":
                return (rest === "/messages" || rest === "/v1/messages") && keys.every((key) => key === "beta") ? null : mismatch(url);
            case "google-generative-ai":
                return /^\/models\/[^/]+:(?:stream)?[Gg]enerateContent$/u.test(rest) && keys.every((key) => key === "alt") ? null : mismatch(url);
        }
    };
}

/**
 * 一次请求用的密钥与请求头：请求头是服务商级与模型级合好（同名时模型的赢）、`env:` 已解析的；“认证方式”为 `bearer` 时另加
 * `Authorization`。`missing` 是没有值的环境变量（密钥的或请求头的），非空时这次请求不该发出。发现模型列表也用它。
 */
export function requestAuth(provider: ProviderTarget, config: Pick<ModelTarget, "headers"> | null, access: KeyAccess): {key: string | null; headers: Record<string, string>; missing: string[]} {
    const missing: string[] = [];
    const headers = resolveHeaders({...provider.headers, ...config?.headers}, access.env, missing);
    const key = keyOf(provider, access, missing);
    if (key !== null && provider.auth === "bearer") headers.Authorization = `Bearer ${key}`;
    return {key, headers, missing};
}

/** 这家现在有没有可用的密钥（不要认证的算有）；解析时报 `no-credentials` 用。 */
export function hasCredential(provider: ProviderTarget, access: KeyAccess): boolean {
    return keyOf(provider, access, []) !== null;
}

function keyOf(provider: ProviderTarget, access: KeyAccess, missing: string[]): string | null {
    if (provider.auth === "none") return NO_AUTH_SENTINEL;
    if (provider.apiKeyEnv !== undefined) {
        const value = envValue(access.env, provider.apiKeyEnv);
        if (value === null) missing.push(provider.apiKeyEnv);
        return value;
    }
    return access.stored(provider.id);
}

function resolveHeaders(headers: Readonly<Record<string, string>>, env: StartupEnv, missing: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) {
        const variable = envRefName(value);
        if (variable === null) {
            out[name] = value;
            continue;
        }
        const resolved = envValue(env, variable);
        if (resolved === null) missing.push(variable);
        else out[name] = resolved;
    }
    return out;
}

type Bundled = Parameters<typeof getBundledModel>[0];

interface Materialized {
    readonly model: Model;
    readonly priceKnown: boolean;
    readonly api: WireApi;
    readonly baseUrl: string;
}

/**
 * 元数据加实例覆盖得到 OMP 模型。同模板且同协议的目录行整行沿用（专用处理随它）；协议不同或空白模板时只借能力字段、按中性
 * 身份用 `buildModel` 建。自定义（没有目录行）的上下文窗口必须是正整数（压缩要用），缺了不能用。
 */
function materialize(provider: ProviderTarget, config: ModelTarget): Materialized | {readonly unsendable: "not-chat" | "transport"} | null {
    if (config.manual !== true && provider.template !== null) {
        const unsendable = unsendableReason(provider.template, config.id);
        if (unsendable !== null) return {unsendable};
    }
    const bundled = provider.template === null || config.manual === true ? undefined : bundledRow(provider.template, config.id);
    const bundledWire = bundled === undefined ? null : wireApiOf(bundled.api);
    const api = provider.api ?? bundledWire ?? provider.defaultApi ?? null;
    if (api === null) return null;
    const sameProtocol = bundled !== undefined && bundledWire === api;
    const route = sameProtocol ? bundled.baseUrl : provider.template === null ? undefined : templateRoutes(provider.template).find((item) => item.api === api)?.baseUrl;
    const baseUrl = provider.baseUrl ?? route;
    if (baseUrl === undefined || baseUrl === "" || !URL.canParse(baseUrl)) return null;
    const priceKnown = config.price === undefined ? bundled !== undefined && catalogPrice(bundled) !== null : config.price !== null;
    const priced = config.price === undefined ? null : config.price;
    if (provider.follows && sameProtocol) {
        const model: Model = {
            ...bundled,
            api,
            baseUrl,
            ...(config.name === undefined ? {} : {name: config.name}),
            ...(priced === null ? {} : {cost: costOf(priced)}),
            ...(config.contextWindow === undefined ? {} : {contextWindow: config.contextWindow}),
            ...(config.maxOutput === undefined ? {} : {maxTokens: config.maxOutput}),
            ...(config.reasoning === undefined ? {} : {reasoning: config.reasoning}),
            ...(config.vision === undefined ? {} : {input: config.vision ? ["text", "image"] : ["text"]}),
        } as Model;
        return {model, priceKnown, api, baseUrl};
    }
    const contextWindow = config.contextWindow ?? positive(bundled?.contextWindow);
    if (contextWindow === undefined) return null;
    const configured = {
        name: config.name ?? bundled?.name ?? config.id,
        reasoning: config.reasoning ?? bundled?.reasoning ?? false,
        input: (config.vision === undefined ? bundled?.input.includes("image") === true : config.vision) ? ["text", "image"] as const : ["text"] as const,
        contextWindow,
        maxTokens: config.maxOutput ?? positive(bundled?.maxTokens) ?? null,
        // OMP 要求数字；单价未知时补零，对外的 cost 由 priceKnown 改成 null。
        cost: costOf(config.price ?? (bundled === undefined ? [0, 0, 0, 0] : [bundled.cost.input, bundled.cost.output, bundled.cost.cacheRead ?? 0, bundled.cost.cacheWrite ?? 0])),
    };
    const built = buildModel({provider: NEUTRAL_PROVIDER, api, baseUrl, id: config.id, ...configured, input: [...configured.input]} as Parameters<typeof buildModel>[0]) as Model;
    // buildModel 按服务商与 id 套目录里的修正；这是用户给端点的配置，构建后整个盖回去。
    return {model: {...built, ...configured, input: [...configured.input]} as Model, priceKnown, api, baseUrl};
}

function bundledRow(template: string, id: string): Model | undefined {
    // 不认识的服务商 id 让 OMP 抛错，先查目录里有没有这家。
    if (!(getBundledProviders() as readonly string[]).includes(template)) return undefined;
    return getBundledModel(template as Bundled, id) as Model | undefined;
}

const positive = (value: number | null | undefined): number | undefined => (typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined);

const costOf = ([input, output, cacheRead, cacheWrite]: readonly [number, number, number, number]) => ({input, output, cacheRead, cacheWrite});
