/**
 * 由一份服务商与模型的配置建出模型端口要的解析结果（`ModelResolution` 的成功分支）：OMP 的模型对象、`ModelInfo` 与
 * `call`（docs/specs/models/service.md）。
 *
 * - 目录服务商：模型从 OMP 目录取，配置只叠加用户改过的东西（显示名、地址覆盖、单价、压缩触发点、请求头）。
 * - 自定义服务商：模型由配置建（`buildModel`），上下文窗口必须是正整数（压缩要用），缺了不能用。
 * - 密钥与请求头里的 `env:` 每次请求现取：凭据库与环境快照都是同步可读的，所以在 `call` 一开头就能定下这次用的密钥，
 *   “认证方式”要把它放进请求头时也拿得到。取不到时交给适配器按 `auth`、`missing-key` 失败（不发请求）。
 */

import {NO_AUTH_SENTINEL} from "@oh-my-pi/pi-ai/auth-retry";
import {getBundledModel, getBundledProviders, type Model} from "@oh-my-pi/pi-catalog";
import {buildModel} from "@oh-my-pi/pi-catalog/build";

import {ompCall, ompModelInfo} from "../kernel/index.js";
import type {ModelInfo, ModelResolution} from "../kernel/index.js";
import {catalogPrice} from "./catalog.js";
import {envRefName, envValue, type StartupEnv} from "./env.js";

/** 自定义服务商支持的接口格式。 */
export type CustomApi = "openai-completions" | "openai-responses" | "anthropic-messages";

/**
 * 认证方式：`default` 按接口格式（OpenAI 系 `Authorization: Bearer`，Anthropic `x-api-key`）；`bearer` 另加
 * `Authorization: Bearer <密钥>`（Anthropic 格式的中转站常要）；`none` 不带密钥。
 */
export type AuthMode = "default" | "bearer" | "none";

export interface ProviderTarget {
    readonly id: string;
    readonly kind: "catalog" | "custom";
    /** 目录服务商：覆盖目录的地址（中转站）；自定义服务商：必填。 */
    readonly baseUrl?: string;
    /** 只对自定义服务商有意义。 */
    readonly api?: CustomApi;
    /** 有值时密钥取这个环境变量，盖过凭据库里的。 */
    readonly apiKeyEnv?: string;
    readonly auth: AuthMode;
    readonly headers?: Readonly<Record<string, string>>;
}

export interface ModelTarget {
    readonly id: string;
    readonly name?: string;
    readonly contextWindow?: number;
    readonly maxOutput?: number;
    readonly vision?: boolean;
    readonly reasoning?: boolean;
    readonly compactAt?: number;
    /** 每百万 token 的美元单价：输入、输出、缓存读、缓存写；null 是未知，不写时用目录的。 */
    readonly price?: readonly [number, number, number, number] | null;
    readonly headers?: Readonly<Record<string, string>>;
}

export interface KeyAccess {
    /** 凭据库里这家的 API Key。 */
    readonly stored: (provider: string) => string | null;
    readonly env: StartupEnv;
}

export type BuildResult = {readonly ok: true; readonly resolution: Extract<ModelResolution, {ok: true}>; readonly model: Model} | {readonly ok: false; readonly code: "unknown-model"};

export function buildResolution(provider: ProviderTarget, config: ModelTarget, access: KeyAccess): BuildResult {
    const built = provider.kind === "catalog" ? catalogModel(provider, config) : customModel(provider, config);
    if (built === null) return {ok: false, code: "unknown-model"};
    const {model, priceKnown} = built;
    const info: ModelInfo = {...ompModelInfo(model), ...(config.compactAt === undefined ? {} : {compactAt: config.compactAt})};
    return {
        ok: true,
        model,
        resolution: {
            ok: true,
            info,
            call: (request, signal, onDelta) => {
                const missing: string[] = [];
                const headers = resolveHeaders({...provider.headers, ...config.headers}, access.env, missing);
                const key = keyOf(provider, access, missing);
                if (key !== null && provider.auth === "bearer") headers.Authorization = `Bearer ${key}`;
                return ompCall({
                    model,
                    priceKnown,
                    headers,
                    apiKey: () => {
                        if (missing.length > 0 || key === null) throw new Error(`no credential for provider ${provider.id}${missing.length > 0 ? ` (environment variable ${missing.join(", ")} is not set)` : ""}`);
                        return key;
                    },
                })(request, signal, onDelta);
            },
        },
    };
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

function catalogModel(provider: ProviderTarget, config: ModelTarget): {model: Model; priceKnown: boolean} | null {
    // 不认识的服务商 id 让 OMP 抛错，先查目录里有没有这家。
    if (!(getBundledProviders() as readonly string[]).includes(provider.id)) return null;
    const found = getBundledModel(provider.id as Bundled, config.id) as Model | undefined;
    if (found === undefined) return null;
    const priced = config.price === undefined ? null : config.price;
    const model: Model = {
        ...found,
        ...(config.name === undefined ? {} : {name: config.name}),
        ...(provider.baseUrl === undefined ? {} : {baseUrl: provider.baseUrl}),
        ...(priced === null ? {} : {cost: costOf(priced)}),
    };
    const priceKnown = config.price === undefined ? catalogPrice(found) !== null : config.price !== null;
    return {model, priceKnown};
}

function customModel(provider: ProviderTarget, config: ModelTarget): {model: Model; priceKnown: boolean} | null {
    if (provider.baseUrl === undefined || provider.api === undefined) return null;
    if (config.contextWindow === undefined || !Number.isInteger(config.contextWindow) || config.contextWindow <= 0) return null;
    const configured = {
        name: config.name ?? config.id,
        reasoning: config.reasoning ?? false,
        input: (config.vision === true ? ["text", "image"] : ["text"]) as ("text" | "image")[],
        contextWindow: config.contextWindow,
        maxTokens: config.maxOutput ?? null,
        // OMP 要求数字；单价未知时补零，对外的 cost 由 priceKnown 改成 null。
        cost: costOf(config.price ?? [0, 0, 0, 0]),
    };
    const built = buildModel({provider: provider.id, api: provider.api, baseUrl: provider.baseUrl, id: config.id, ...configured} as Parameters<typeof buildModel>[0]) as Model;
    // buildModel 按服务商与 id 套目录里的修正（单价、上限、模态）；这是用户给自定义端点的配置，构建后整个盖回去。
    return {model: {...built, ...configured}, priceKnown: config.price !== undefined && config.price !== null};
}

const costOf = ([input, output, cacheRead, cacheWrite]: readonly [number, number, number, number]) => ({input, output, cacheRead, cacheWrite});
