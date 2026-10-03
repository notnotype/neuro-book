import {
    createModels,
    createProvider,
    envApiKeyAuth,
    hasApi,
    lazyApi,
} from "@earendil-works/pi-ai";
import type {Api, Models, Model, ProviderStreams} from "@earendil-works/pi-ai";
import type {EffectiveConfig} from "nbook/server/config/types";
import {isSupportedPiApi, type SupportedPiApi} from "@notnotype/neuro-book-contracts/provider-config";

const CUSTOM_API_STREAMS = {
    "openai-completions": lazyApi(() => import("@earendil-works/pi-ai/api/openai-completions")),
    "openai-responses": lazyApi(() => import("@earendil-works/pi-ai/api/openai-responses")),
    "anthropic-messages": lazyApi(() => import("@earendil-works/pi-ai/api/anthropic-messages")),
    "google-generative-ai": lazyApi(() => import("@earendil-works/pi-ai/api/google-generative-ai")),
    "bedrock-converse-stream": lazyApi(() => import("@earendil-works/pi-ai/api/bedrock-converse-stream")),
} satisfies Record<SupportedPiApi, ProviderStreams>;

/**
 * 为当前冻结配置和已解析模型选择 Pi runtime。
 *
 * 每个用户 Provider Config 都创建独立 Models + Provider；运行时不读取 builtin catalog。
 */
export function resolvePiModelsFromConfig(
    config: Pick<EffectiveConfig, "models">,
    model: Model<Api>,
): Models {
    const provider = config.models.providers[model.provider];
    if (!provider?.enabled || !provider.models[model.id]?.enabled) {
        throw new Error(`模型未启用或不存在：${model.provider}/${model.id}`);
    }
    if (!isSupportedPiApi(model.api)) {
        throw new Error(`不支持的 Pi API：${model.api}`);
    }

    if (hasApi(model, "openai-completions")) {
        return createCustomModels(model, CUSTOM_API_STREAMS["openai-completions"]);
    }
    if (hasApi(model, "openai-responses")) {
        return createCustomModels(model, CUSTOM_API_STREAMS["openai-responses"]);
    }
    if (hasApi(model, "anthropic-messages")) {
        return createCustomModels(model, CUSTOM_API_STREAMS["anthropic-messages"]);
    }
    if (hasApi(model, "google-generative-ai")) {
        return createCustomModels(model, CUSTOM_API_STREAMS["google-generative-ai"]);
    }
    if (hasApi(model, "bedrock-converse-stream")) {
        return createCustomModels(model, CUSTOM_API_STREAMS["bedrock-converse-stream"]);
    }
    throw new Error(`不支持的 Pi API：${model.api}`);
}

/**
 * 创建只服务当前 invocation 的自定义 Provider runtime。
 */
function createCustomModels<TApi extends SupportedPiApi>(model: Model<TApi>, streams: ProviderStreams): Models {
    const models = createModels();
    models.setProvider(createProvider({
        id: model.provider,
        name: model.provider,
        baseUrl: model.baseUrl,
        headers: model.headers,
        auth: {apiKey: envApiKeyAuth(`${model.provider} API key`, [])},
        models: [model],
        api: streams,
    }));
    return models;
}

/**
 * 读取 resolved model 上的本地 Provider 配置身份。
 */
