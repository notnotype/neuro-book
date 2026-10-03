import {createError} from "h3";
import type {ModelProviderDraftDto, ProviderCredentialSource} from "nbook/shared/dto/app-settings.dto";
import type {EffectiveConfig} from "nbook/server/config/types";
import {sameProviderConnection} from "nbook/shared/models/provider-connection-identity";

/**
 * 为临时 Provider 请求解析唯一凭据来源。
 * saved 只有在连接身份与当前配置完全一致时才允许读取 Secret。
 */
export function resolveProviderCredential(
    draft: ModelProviderDraftDto,
    source: ProviderCredentialSource,
    config: Pick<EffectiveConfig, "models">,
): ModelProviderDraftDto {
    if (source === "provided") {
        return draft;
    }
    if (source === "cleared") {
        return {...draft, options: {...draft.options, apiKey: ""}};
    }
    const saved = config.models.providers[draft.id];
    if (!saved || !sameProviderConnection({
        id: draft.id,
        baseURL: saved.options.baseURL,
        proxy: saved.options.proxy,
    }, {
        id: draft.id,
        baseURL: draft.options.baseURL,
        proxy: draft.options.proxy,
    })) {
        throw createError({
            statusCode: 400,
            message: `Provider ${draft.id} 的连接身份与已保存配置不一致，拒绝使用已保存凭据。`,
        });
    }
    return {...draft, options: {...draft.options, apiKey: saved.options.apiKey}};
}
