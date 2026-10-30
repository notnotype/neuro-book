/**
 * 模型与密钥（docs/specs/agent/harness.md “模型”一节、输出 18）。
 *
 * 密钥绑定在模型实例上，不按 provider 全局取：OMP 的 `getApiKey` 返回空时会退回同一 provider 的默认密钥
 * （设计审查实测，自定义地址下会发出别的 `OPENAI_API_KEY`），所以指定的变量缺失时这里直接抛
 * `MissingModelKeyError`，由 harness 在发请求前归为 `auth`。另注意 OMP 导入时会从项目、agent、配置目录与
 * 家目录的 `.env` 补进环境变量，“只读宿主给的变量”在 OMP 进程里不成立。
 */

import {getEnvApiKey} from "@oh-my-pi/pi-ai";
import {NO_AUTH_SENTINEL} from "@oh-my-pi/pi-ai/auth-retry";
import {getBundledModel, getBundledModels, getBundledProviders, type Model} from "@oh-my-pi/pi-catalog";
import {buildModel} from "@oh-my-pi/pi-catalog/build";

import {catalogPrice, providerAccess, providerKeyEnvs} from "./catalog.js";

/** 指定的密钥变量缺失或为空。`variables` 是可以设的变量（目录服务商可能有几个，按 OMP 查找的顺序）。 */
export class MissingModelKeyError extends Error {
    readonly variables: readonly string[];

    constructor(variables: string | readonly string[]) {
        const list = typeof variables === "string" ? [variables] : variables;
        super(list.length === 0 ? "模型没有指定密钥来源" : `模型的密钥变量 ${list.join(" 或 ")} 没有设置`);
        this.name = "MissingModelKeyError";
        this.variables = list;
    }
}

export interface ModelPrice {
    /** 每百万 token 的单价。 */
    readonly input: number;
    readonly output: number;
    readonly cacheRead?: number;
    readonly cacheWrite?: number;
    readonly currency: string;
}

export interface DefineModelOptions {
    readonly provider: string;
    readonly api: Model["api"];
    readonly baseUrl: string;
    readonly id: string;
    readonly name?: string;
    /** 保存密钥的环境变量名；与 `apiKey: "none"` 二选一。 */
    readonly apiKeyEnv?: string;
    /** `"none"`：端点不要认证（只在 OpenAI 兼容端点验证过）。 */
    readonly apiKey?: "none";
    readonly reasoning?: boolean;
    readonly input?: readonly ("text" | "image")[];
    readonly contextWindow?: number | null;
    readonly maxTokens?: number | null;
    readonly price?: ModelPrice;
}

/** 解析好的模型：OMP 的模型对象、绑定在它身上的密钥解析，以及单价是否已知。 */
export interface ResolvedModel {
    readonly model: Model;
    readonly apiKey: () => string;
    readonly priceKnown: boolean;
}

export function defineModel(options: DefineModelOptions): ResolvedModel {
    for (const field of ["provider", "baseUrl", "id"] as const) {
        if (options[field].trim() === "") throw new Error(`defineModel 的 ${field} 不能为空`);
    }
    if ((options.apiKeyEnv === undefined) === (options.apiKey === undefined)) {
        throw new Error("defineModel 要恰好给 apiKeyEnv 或 apiKey: \"none\" 中的一个");
    }
    const price = options.price;
    const configured = {
        name: options.name ?? options.id,
        reasoning: options.reasoning ?? false,
        input: [...(options.input ?? ["text"])] as ("text" | "image")[],
        contextWindow: options.contextWindow ?? null,
        maxTokens: options.maxTokens ?? null,
        // OMP 要求数字；单价未知时补零，对外的 cost 由 priceKnown 改成 null。
        cost: {input: price?.input ?? 0, output: price?.output ?? 0, cacheRead: price?.cacheRead ?? 0, cacheWrite: price?.cacheWrite ?? 0},
    };
    const built = buildModel({provider: options.provider, api: options.api, baseUrl: options.baseUrl, id: options.id, ...configured} as Parameters<typeof buildModel>[0]) as Model;
    // buildModel 会按 provider 与 id 套目录里的修正（单价、分时价、上限、模态）。这里是宿主给自定义端点的配置，
    // 构建后用宿主的值整个盖回去：cost 整个替换，去掉目录附加的分时价与长上下文价。
    const model: Model = {...built, ...configured};
    const variable = options.apiKeyEnv;
    return {
        model,
        priceKnown: price !== undefined,
        apiKey: variable === undefined ? () => NO_AUTH_SENTINEL : () => readKey(variable),
    };
}

function readKey(variable: string): string {
    const value = process.env[variable] ?? Bun.env[variable];
    if (value === undefined || value.trim() === "") throw new MissingModelKeyError(variable);
    return value;
}

/** 已知的 provider id 列表（OMP 目录）。 */
export function listProviders(): readonly string[] {
    return getBundledProviders();
}

type BundledProvider = Parameters<typeof getBundledModel>[0];

/**
 * 内置目录里的模型（`provider/modelId`，或全局唯一的裸 modelId）。密钥用 OMP 的 `getEnvApiKey` 取：它在目录登记的变量
 * 之外还走 OMP 的 hook（例如 anthropic 也认 `ANTHROPIC_OAUTH_TOKEN`），自己按变量列表取会漏掉这些来源。缺失时失败，
 * 只有不要认证的服务商（`keyless`）不带密钥发请求。单价按目录，全为 0 当未知（见 `catalogPrice`）。
 */
export function resolveModel(reference: string): ResolvedModel {
    const model = lookupModel(reference);
    const keyless = providerAccess(model.provider) === "keyless";
    return {
        model,
        priceKnown: catalogPrice(model) !== null,
        apiKey: () => {
            const value = getEnvApiKey(model.provider);
            if (typeof value === "string" && value.trim() !== "") return value;
            if (keyless) return NO_AUTH_SENTINEL;
            throw new MissingModelKeyError(providerKeyEnvs(model.provider));
        },
    };
}

function lookupModel(reference: string): Model {
    const trimmed = reference.trim();
    if (trimmed === "") throw new Error("模型引用不能为空");
    const slash = trimmed.indexOf("/");
    if (slash > 0) {
        const provider = trimmed.slice(0, slash);
        const modelId = trimmed.slice(slash + 1);
        if (!listProviders().includes(provider)) throw new Error(`未知 provider：${provider}（模型引用：${reference}）`);
        let model: Model | undefined;
        try {
            model = getBundledModel(provider as BundledProvider, modelId) as Model | undefined;
        } catch (error) {
            throw new Error(`未知模型：${reference}`, {cause: error});
        }
        if (model === undefined) throw new Error(`未知模型：${reference}`);
        return model;
    }
    const matches: Model[] = [];
    for (const provider of getBundledProviders()) {
        for (const model of getBundledModels(provider as BundledProvider)) {
            if (model.id === trimmed) matches.push(model);
        }
    }
    if (matches.length === 1) return matches[0]!;
    if (matches.length === 0) throw new Error(`未知模型：${reference}`);
    throw new Error(`模型 id 不唯一（命中 ${matches.length} 个 provider）：${reference}；请写成 provider/modelId`);
}
