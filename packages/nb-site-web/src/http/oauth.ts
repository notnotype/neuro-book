/**
 * 授权确认页的两个接口（`site.oauth-provider` 输出 14）。单独一个模块、只由授权确认页导入：访客第一屏的入口块里不带它。
 *
 * 两个都要有会话、都在同意门槛之内：`unauthenticated` 与门槛那种 `consent_required` 照常走统一处理（带人去登录页或同意页，
 * 带上回来的 `next`）。`authorization_expired`、`client_not_found`、`redirect_uri_invalid` 由页面换整张卡片。
 */

import {IDENTITY_API_PREFIX, IDENTITY_PATHS, OAUTH_REQUEST_PARAM} from "@notnotype/nb-site-identity-contract/constants";
import type {OAuthAuthorizationResponse, OAuthDecisionRequest, OAuthDecisionResponse} from "@notnotype/nb-site-identity-contract/constants";

import type {ApiCore, Result} from "./core";

export interface OAuthApi {
    /** 读一次待确认的授权请求：客户端名字、回调的主机名、要的范围。 */
    authorization(request: string): Promise<Result<OAuthAuthorizationResponse>>;
    /** 同意或拒绝：成功回跳回客户端的地址（同意时带授权码，拒绝时带 `access_denied`）。 */
    decide(body: OAuthDecisionRequest): Promise<Result<OAuthDecisionResponse>>;
}

export function createOAuthApi(core: ApiCore): OAuthApi {
    const relative = `${IDENTITY_API_PREFIX}${IDENTITY_PATHS.oauthAuthorization}`;
    return {
        authorization: (request) => core.request<OAuthAuthorizationResponse>({
            method: "GET",
            path: `${relative}?${new URLSearchParams({[OAUTH_REQUEST_PARAM]: request}).toString()}`,
        }),
        decide: (body) => core.request<OAuthDecisionResponse>({method: "POST", path: relative, body}),
    };
}
