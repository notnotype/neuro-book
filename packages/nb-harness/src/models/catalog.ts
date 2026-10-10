/**
 * 目录、解析、选择链与能力检查（docs/specs/harness/models.md 输出 1–4、10）。只看传入的配置快照；配置里的服务覆盖 OMP 目录里的同名服务。
 */

import {getBundledModel, getBundledModels, getBundledProviders} from "@oh-my-pi/pi-catalog";
import type {Model} from "@oh-my-pi/pi-catalog";
import {buildModel} from "@oh-my-pi/pi-catalog/build";
import type {HarnessConfig, ProviderConfig, ProviderModelConfig} from "../config/config";
import type {Capabilities, CapabilityProblem, ModelCatalog, ModelResult, ModelSummary, SelectRequest, Selected} from "./types";

/** 与 config 的 MODEL_REF_PATTERN 同一语法（各自声明，不跨模块导入）：服务 id 到第一个 `/` 为止，其余整个是模型 id。 */
const MODEL_REF_PATTERN = /^([A-Za-z0-9._-]+)\/([^\s\p{Cc}]+)$/u;
const ZERO_COST = {input: 0, output: 0, cacheRead: 0, cacheWrite: 0};

type BundledProvider = Parameters<typeof getBundledModel>[0];

export function parseModelRef(ref: string): {providerId: string; modelId: string} | null {
    const match = MODEL_REF_PATTERN.exec(ref);
    return match === null ? null : {providerId: match[1]!, modelId: match[2]!};
}

/** 配置里的模型构造成 OMP `Model`：未给的能力按保守值（Spec 输出 2）。 */
function modelFromConfig(provider: ProviderConfig, model: ProviderModelConfig): Model {
    return buildModel({
        id: model.id,
        name: model.name ?? model.id,
        provider: provider.id,
        api: provider.api,
        baseUrl: provider.baseUrl,
        ...(provider.headers === undefined ? {} : {headers: provider.headers}),
        reasoning: model.reasoning ?? false,
        input: model.input ?? ["text"],
        supportsTools: model.supportsTools ?? true,
        cost: ZERO_COST,
        contextWindow: model.contextWindow ?? null,
        maxTokens: model.maxTokens ?? null,
    });
}

function summaryOf(model: Model, source: ModelSummary["source"]): ModelSummary {
    return {ref: `${model.provider}/${model.id}`, name: model.name, provider: model.provider, source, input: [...model.input], supportsTools: model.supportsTools ?? true, contextWindow: model.contextWindow};
}

export function createModelCatalog(input: {config: HarnessConfig}): ModelCatalog {
    const {config} = input;
    const configured = new Map<string, Model>();
    const configuredProviders = new Set<string>();
    for (const provider of config.providers) {
        configuredProviders.add(provider.id);
        for (const model of provider.models) configured.set(`${provider.id}/${model.id}`, modelFromConfig(provider, model));
    }
    const bundledProviders = new Set<string>(getBundledProviders());

    const resolve = (ref: string): ModelResult<Model> => {
        const parsed = parseModelRef(ref);
        if (parsed === null) return {ok: false, code: "invalid-model-ref", detail: `模型引用必须是 <providerId>/<modelId>：${ref}`};
        const own = configured.get(ref);
        if (own !== undefined) return {ok: true, value: own};
        if (!configuredProviders.has(parsed.providerId) && !bundledProviders.has(parsed.providerId)) return {ok: false, code: "unknown-provider", detail: `配置与 OMP 目录里都没有服务 ${parsed.providerId}`};
        if (bundledProviders.has(parsed.providerId)) {
            try {
                const model = getBundledModel(parsed.providerId as BundledProvider, parsed.modelId) as Model | undefined;
                if (model !== undefined) return {ok: true, value: model};
            } catch {
                // OMP 对不存在的模型抛错，统一按 unknown-model 报。
            }
        }
        return {ok: false, code: "unknown-model", detail: `服务 ${parsed.providerId} 里没有模型 ${parsed.modelId}`};
    };

    const roleModel = (roleId: string): ModelResult<string> => {
        const role = config.roles.items.find((item) => item.id === roleId);
        if (role === undefined) return {ok: false, code: "unknown-role", detail: `配置里没有角色 ${roleId}`};
        if (role.modelKey === null) return {ok: false, code: "role-not-bound", detail: `角色 ${roleId} 没有绑定模型`};
        return {ok: true, value: role.modelKey};
    };

    const select = (request: SelectRequest): ModelResult<Selected> => {
        const chosen = (ref: string, via: Selected["via"], role?: string): ModelResult<Selected> => {
            const resolved = resolve(ref);
            return resolved.ok ? {ok: true, value: {model: resolved.value, via, ...(role === undefined ? {} : {role})}} : resolved;
        };
        if (request.model !== undefined) return chosen(request.model, "explicit");
        if (request.role !== undefined) {
            const bound = roleModel(request.role);
            return bound.ok ? chosen(bound.value, "role", request.role) : bound;
        }
        if (request.profile?.model !== undefined) return chosen(request.profile.model, "profile-model");
        if (request.profile?.defaultRole !== undefined) {
            const bound = roleModel(request.profile.defaultRole);
            return bound.ok ? chosen(bound.value, "profile-role", request.profile.defaultRole) : bound;
        }
        if (config.models.defaultModel !== undefined) return chosen(config.models.defaultModel, "default");
        return {ok: false, code: "no-default-model", detail: "没有显式模型、角色、Profile 的模型或缺省角色，配置里也没有 models.defaultModel"};
    };

    return {
        list: () => {
            const summaries = [...configured.values()].map((model) => summaryOf(model, "config"));
            for (const provider of getBundledProviders()) {
                for (const model of getBundledModels(provider)) {
                    if (!configured.has(`${model.provider}/${model.id}`)) summaries.push(summaryOf(model, "bundled"));
                }
            }
            return summaries;
        },
        resolve,
        select,
        checkCapabilities: (model: Model, required: Capabilities): CapabilityProblem[] => {
            const problems: CapabilityProblem[] = [];
            if (required.tools === true && model.supportsTools === false) problems.push({capability: "tools", detail: `${model.provider}/${model.id} 不支持工具调用`});
            if (required.images === true && !model.input.includes("image")) problems.push({capability: "images", detail: `${model.provider}/${model.id} 不接受图片输入`});
            return problems;
        },
    };
}
