import {getBundledModel, getBundledModels, getBundledProviders, type Model} from "@oh-my-pi/pi-catalog";
import {getEnvApiKey} from "@oh-my-pi/pi-ai";

/** 已知的 provider id 列表（OMP 目录）。 */
export function listProviders(): readonly string[] {
    return getBundledProviders();
}

type CatalogProvider = Parameters<typeof getBundledModel>[0];

/** 解析 `provider/modelId`（或全局唯一的裸 modelId）为目录里的模型。 */
export function resolveModel(reference: string): Model {
    const trimmed = reference.trim();
    if (trimmed === "") {
        throw new Error("模型引用不能为空");
    }
    const slash = trimmed.indexOf("/");
    if (slash > 0) {
        const provider = trimmed.slice(0, slash);
        const modelId = trimmed.slice(slash + 1);
        if (!listProviders().includes(provider)) {
            throw new Error(`未知 provider：${provider}（模型引用：${reference}）`);
        }
        return loadBundledModel(provider, modelId, reference);
    }

    const matches: Model[] = [];
    for (const provider of getBundledProviders()) {
        for (const model of getBundledModels(provider as CatalogProvider)) {
            if (model.id === trimmed) matches.push(model);
        }
    }
    if (matches.length === 1) {
        return matches[0];
    }
    if (matches.length === 0) {
        throw new Error(`未知模型：${reference}`);
    }
    throw new Error(`模型 id 不唯一（命中 ${matches.length} 个 provider）：${reference}；请写成 provider/modelId`);
}

function loadBundledModel(provider: string, modelId: string, reference: string): Model {
    try {
        const model = getBundledModel(provider as CatalogProvider, modelId) as Model | undefined;
        if (model === undefined) throw new Error("missing");
        return model;
    } catch {
        throw new Error(`未知模型：${reference}`);
    }
}

/**
 * 从环境解析 API key：优先 OMP 的 `getEnvApiKey(provider)`；
 * `deepseek` 额外回退到 `DEEPSEEK_API_KEY`（OMP 的 env 模块在 import 期已把仓库根 `.env` 注入 `Bun.env`）。
 */
export function createEnvApiKeyResolver(): (model: Model) => string | undefined {
    return (model) => {
        const fromProvider = getEnvApiKey(model.provider);
        if (typeof fromProvider === "string" && fromProvider !== "") return fromProvider;
        if (model.provider === "deepseek") {
            const fallback = process.env.DEEPSEEK_API_KEY ?? Bun.env.DEEPSEEK_API_KEY;
            if (typeof fallback === "string" && fallback !== "") return fallback;
        }
        return undefined;
    };
}

/** 用 `DEEPSEEK_API_BASE` 覆盖 deepseek 模型的 baseUrl（其它 provider 原样返回）。 */
export function applyBaseUrlOverride(model: Model): Model {
    if (model.provider !== "deepseek") return model;
    const override = process.env.DEEPSEEK_API_BASE ?? Bun.env.DEEPSEEK_API_BASE;
    if (typeof override !== "string" || override.trim() === "") return model;
    return {...model, baseUrl: override.trim()};
}
