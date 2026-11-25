/**
 * 两份发现文档（`site.oauth-provider` 输出 2；计划 3.6）：`/.well-known/openid-configuration` 与
 * `/.well-known/oauth-authorization-server` 回同一份，由自家路由给，不转发库的。库的那份照它的全部能力写（内省、
 * `client_secret_post`、DPoP、`claims_parameter_supported` 等），合同只列本站支持的，所以能力字段在这里写成常量；端点地址仍取库的
 * `getOpenIdConfig()`，随库的基路径与签发者变。
 */

import {Hono} from "hono";

import {ID_TOKEN_CLAIMS, OAUTH_SCOPES, OIDC_DISCOVERY_PATHS, USERINFO_CLAIMS, type DiscoveryDocument} from "@notnotype/nb-site-identity-contract";

import type {IdentityAuth} from "../auth";
import {failureFor, failureResponse, respondFailure} from "../errors";
import type {IdentityLog} from "../index";
import {SIGNING_ALG} from "./signing-key";

/** `/.well-known` 子应用挂的前缀；两份文档的地址去掉它就是子应用里的路由。 */
export const WELL_KNOWN_PREFIX = "/.well-known";

/** 发现文档的缓存时长（秒）：文档启动后不变，客户端可以缓存一会儿。 */
const DISCOVERY_MAX_AGE_SECONDS = 300;

/**
 * 生成发现文档。启动时调一次（`module.ts`），之后不变：端点地址与签名算法只随配置与启动检查变。签名算法写 `SIGNING_ALG`：启动检查
 * （`prepareSigningKey`）已保证表里只有这个算法的钥。
 */
export async function buildDiscoveryDocument(auth: IdentityAuth): Promise<DiscoveryDocument> {
    const library = await auth.api.getOpenIdConfig();
    // 库的类型里这三项可以没有（随插件的选项）；本模块的装配都开着，没有就是装配错了，不带着残缺的文档启动。
    const {userinfo_endpoint: userinfoEndpoint, jwks_uri: jwksUri, revocation_endpoint: revocationEndpoint} = library;
    if (userinfoEndpoint === undefined || jwksUri === undefined || revocationEndpoint === undefined) {
        throw new Error("the library's OpenID configuration lacks the userinfo, jwks or revocation endpoint");
    }
    return {
        issuer: library.issuer,
        authorization_endpoint: library.authorization_endpoint,
        token_endpoint: library.token_endpoint,
        userinfo_endpoint: userinfoEndpoint,
        jwks_uri: jwksUri,
        revocation_endpoint: revocationEndpoint,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["client_secret_basic", "none"],
        revocation_endpoint_auth_methods_supported: ["client_secret_basic", "none"],
        scopes_supported: [...OAUTH_SCOPES],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: [SIGNING_ALG],
        prompt_values_supported: ["none", "login", "consent"],
        // 库对 `response_mode=fragment` 仍把结果写进查询串，不写这一项时按 RFC 8414 的缺省就成了 query 与 fragment（omp 设计审查第 4 条）。
        response_modes_supported: ["query"],
        claims_supported: [...new Set([...USERINFO_CLAIMS, ...ID_TOKEN_CLAIMS])],
        authorization_response_iss_parameter_supported: true,
        request_parameter_supported: false,
        request_uri_parameter_supported: false,
    };
}

/** 挂在 `WELL_KNOWN_PREFIX` 下的子应用：两份文档，其余 404。HEAD 由 Hono 按 GET 分派、去掉正文（输入表下那句）。 */
export function createWellKnownApp(document: DiscoveryDocument, log: Pick<IdentityLog, "warn" | "error">): Hono {
    const app = new Hono();
    const body = JSON.stringify(document);
    // `Content-Length` 显式写上：HEAD 的回答要带与 GET 相同的头，Hono 去掉正文之后服务器按空体补的是 0。
    const headers = {"Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)), "Cache-Control": `public, max-age=${DISCOVERY_MAX_AGE_SECONDS}`};
    for (const path of OIDC_DISCOVERY_PATHS) app.get(path.slice(WELL_KNOWN_PREFIX.length), (c) => c.body(body, 200, headers));
    app.all("*", (c) => respondFailure(c, failureResponse("not_found")));
    app.onError((error, c) => respondFailure(c, failureFor(error, log)));
    return app;
}
