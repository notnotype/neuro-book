import {mkdir, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createModels, fauxProvider} from "@earendil-works/pi-ai";
import type {FauxProviderHandle, Model, Models, RegisterFauxProviderOptions} from "@earendil-works/pi-ai";

type ResolvedFauxModel = Model<string> & {providerConfigId: string};

export type FauxModelsFixture = Omit<FauxProviderHandle, "models" | "getModel"> & {
    models: [ResolvedFauxModel, ...ResolvedFauxModel[]];
    getModel(): ResolvedFauxModel;
    getModel(modelId: string): ResolvedFauxModel | undefined;
    runtime: Models;
};

export type FauxProviderConfigFixture = {
    model: ResolvedFauxModel;
    models: {
        default: string;
        providers: Array<{
            id: string;
            name: string;
            enabled: true;
            modelApi: ResolvedFauxModel["api"];
            options: {apiKey: string; baseURL: string; proxy: string; timeoutMs: null; requestOptions: {}};
            models: Array<{id: string; name: string; enabled: true; api: ResolvedFauxModel["api"]; contextWindowTokens: number; maxTokens: number}>;
        }>;
    };
};

/**
 * 创建 suite 私有的 Faux Provider 与 Models，response queue 不与其他测试共享。
 */
export function createFauxModels(options?: RegisterFauxProviderOptions): FauxModelsFixture {
    const faux = fauxProvider(options);
    const runtime = createModels();
    runtime.setProvider(faux.provider);
    const models = faux.models.map(resolvedFauxModel) as [ResolvedFauxModel, ...ResolvedFauxModel[]];
    function getModel(): ResolvedFauxModel;
    function getModel(modelId: string): ResolvedFauxModel | undefined;
    function getModel(modelId?: string): ResolvedFauxModel | undefined {
        const model = modelId === undefined ? faux.getModel() : faux.getModel(modelId);
        return model ? resolvedFauxModel(model) : undefined;
    }
    return {...faux, models, getModel, runtime};
}

/** 在测试Workspace Root写入与Faux runtime完全一致的Provider Config身份。 */
export async function writeFauxProviderConfig(workspaceRoot: string, faux: FauxModelsFixture): Promise<void> {
    const config = fauxProviderConfig(faux);
    await mkdir(join(workspaceRoot, ".nbook"), {recursive: true});
    await writeFile(join(workspaceRoot, ".nbook", "config.json"), JSON.stringify({models: config.models}), "utf8");
}

/** 为需要自定义Provider Config ID或model ID的测试构造一致的配置与runtime模型。 */
export function fauxProviderConfig(
    faux: FauxModelsFixture,
    identity: {providerConfigId?: string; modelId?: string} = {},
): FauxProviderConfigFixture {
    const source = faux.getModel();
    const model = {
        ...source,
        providerConfigId: identity.providerConfigId ?? source.providerConfigId,
        id: identity.modelId ?? source.id,
    };
    return {model, models: {
        default: `${model.providerConfigId}/${model.id}`,
        providers: [{
            id: model.providerConfigId,
            name: "Faux",
            enabled: true,
            modelApi: model.api,
            options: {apiKey: "", baseURL: "", proxy: "", timeoutMs: null, requestOptions: {}},
            models: [{
                id: model.id,
                name: model.name,
                enabled: true,
                api: model.api,
                contextWindowTokens: model.contextWindow,
                maxTokens: model.maxTokens,
            }],
        }],
    }};
}

/** Faux Adapter显式模拟生产Model Resolver注入本地Provider Config身份。 */
function resolvedFauxModel(model: Model<string>): ResolvedFauxModel {
    return {...model, providerConfigId: model.provider};
}
