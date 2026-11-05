/**
 * 由一份服务商与模型的配置建出模型端口要的解析结果（`ModelResolution` 的成功分支）：OMP 的模型对象、`ModelInfo` 与
 * `call`（docs/specs/models/service.md）。
 *
 * - 目录服务商：模型从 OMP 目录取，配置只叠加用户改过的东西（显示名、地址覆盖、单价、压缩触发点、请求头）。
 * - 自定义服务商：模型由配置建（`buildModel`），上下文窗口必须是正整数（压缩要用），缺了不能用。
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
import type {ModelInfo, ModelResolution, OmpTransport} from "../kernel/index.js";
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

export type BuildResult = {readonly ok: true; readonly resolution: Extract<ModelResolution, {ok: true}>; readonly model: Model} | {readonly ok: false; readonly code: "unknown-model"};

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

/** `transport` 每次请求现读：解析结果会被缓存，设置改了要从下一次请求起生效。 */
export function buildResolution(provider: ProviderTarget, config: ModelTarget, access: KeyAccess, transport?: () => OmpTransport): BuildResult {
    const built = provider.kind === "catalog" ? catalogModel(provider, config) : customModel(provider, config);
    if (built === null) return {ok: false, code: "unknown-model"};
    const {model, priceKnown} = built;
    const base = ompModelInfo(model);
    const compactAt = config.compactAtFor?.(base.contextWindow) ?? config.compactAt;
    const info: ModelInfo = {...base, ...(compactAt === undefined ? {} : {compactAt})};
    return {
        ok: true,
        model,
        resolution: {
            ok: true,
            info,
            call: (request, signal, onDelta) => {
                const {key, headers, missing} = requestAuth(provider, config, access);
                return ompCall({
                    model,
                    priceKnown,
                    headers,
                    onRequestDump: discardRequestDump,
                    ...(transport === undefined ? {} : {transport: transport()}),
                    apiKey: () => {
                        if (missing.length > 0 || key === null) throw new Error(`no credential for provider ${provider.id}${missing.length > 0 ? ` (environment variable ${missing.join(", ")} is not set)` : ""}`);
                        return key;
                    },
                })(request, signal, onDelta);
            },
        },
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
