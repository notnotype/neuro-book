/**
 * 对外 OAuth 服务的黑盒合同（docs/specs/site/oauth-provider.md）：起真实的 `nb-site` 进程，扮演接入的第三方应用（`testing/oauth-client.ts`），
 * 只经 HTTP 看它。本文件现在覆盖输入表与输出 1 的可达端点、HEAD、输出 2 的发现文档、输出 6 的令牌端点（`resource`、请求体上限）、
 * 验收 2 的后一半与验收 6。
 *
 * 本文件测不到、在账号包里的：白名单对库的全部端点逐个挡住（`oauth/mount.test.ts` 遍历库的端点表）；换码撞会话外键回
 * `invalid_grant`（要在库的两步之间删会话）；带 `resource` 换码时库那边有一行访问令牌（读库）。
 *
 * 时间预算：起进程、建账号、登记客户端放在 `beforeAll` 里；用例只发请求。超出 200 毫秒的用例在旁边写明原因。
 */

import {beforeAll, describe, expect, it} from "bun:test";
import {Value} from "typebox/value";

import {DiscoveryDocument, IDENTITY_AUTH_PREFIX, IDENTITY_PATHS, OAUTH_ENDPOINT_PATHS, OIDC_DISCOVERY_PATHS} from "@notnotype/nb-site-identity-contract";

import {cookieJar, createAdmin, IDENTITY_SITE_ENV, identityRequest, login, SITE_ORIGIN, type CookieJar} from "./testing/identity";
import {authorizationRequest, exchangeCode, fetchUserInfo, registerOAuthClient, siteFetch, step, verifyIdToken, type RegisteredClient, type SiteResponse} from "./testing/oauth-client";
import {useSiteSandbox, type SiteProcess} from "./testing/site";

const sandbox = useSiteSandbox("nb-site-contract-tests oauth-provider.test.ts");

const SETUP_TIMEOUT_MS = 30_000;
const TERMS_VERSION = "2026-11-20";
const PASSWORD = "admin-PW-t5Rk82";
const FORM = "application/x-www-form-urlencoded";

/** 输出 2 列的能力字段，端点地址另比。 */
const CAPABILITIES = {
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "none"],
    revocation_endpoint_auth_methods_supported: ["client_secret_basic", "none"],
    scopes_supported: ["openid", "profile", "email"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    prompt_values_supported: ["none", "login", "consent"],
    response_modes_supported: ["query"],
    authorization_response_iss_parameter_supported: true,
    request_parameter_supported: false,
    request_uri_parameter_supported: false,
};

/** 输出 7 的用户信息字段与输出 11 的 id_token 字段的并集。 */
const CLAIMS = ["sub", "preferred_username", "name", "email_pending", "email", "email_verified", "iss", "aud", "iat", "exp", "auth_time", "at_hash", "acr", "nonce"];

/** 集合含义的字段排好序再比：合同不规定先后。 */
function normalized(document: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(document).map(([key, value]) => [key, Array.isArray(value) ? [...(value as string[])].sort() : value]));
}

/** 比较 HEAD 与 GET 的头时去掉每个请求各不相同的两个：`Date` 与请求 id（`site.operations` 的 `X-Request-Id`）。 */
function comparableHeaders(response: SiteResponse): [string, string][] {
    return [...response.headers].filter(([name]) => name !== "date" && name !== "x-request-id");
}

describe("对外 OAuth 的端点与发现文档（输入表、输出 1、2、6，验收 2、6）", () => {
    let site: SiteProcess;
    let admin: CookieJar;
    let client: RegisteredClient;
    let address = 0;
    const from = () => `198.51.100.${String(++address % 250)}`;

    /** 机密客户端走完授权（已登录、已同意条款、免确认的客户端），回码与它的 PKCE 校验值。 */
    async function authorizedCode(extra: Readonly<Record<string, string>> = {}): Promise<{code: string; verifier: string; nonce: string}> {
        const request = authorizationRequest(client, extra);
        const answer = await step(site.url, admin, request.url, client);
        const code = answer.location.searchParams.get("code");
        if (answer.kind !== "redirect-back" || code === null) throw new Error(`authorization ended at ${answer.kind}, not back at the client with a code`);
        return {code, verifier: request.verifier, nonce: request.nonce};
    }

    beforeAll(async () => {
        const dataDir = await sandbox.dataDir();
        await createAdmin(sandbox, dataDir, ["root", "root@example.com"], PASSWORD);
        site = await sandbox.start({dataDir, env: IDENTITY_SITE_ENV});
        admin = cookieJar();
        if ((await login(site.url, "root", PASSWORD, {from: from(), jar: admin})).status !== 200) throw new Error("root could not sign in");
        const consented = await identityRequest(site.url, IDENTITY_PATHS.meConsent, {method: "POST", jar: admin, from: from(), body: {termsVersion: TERMS_VERSION, overseasStorage: true}});
        if (consented.status !== 200) throw new Error("root could not consent");
        client = await registerOAuthClient(site.url, admin, from(), {name: "合同测试客户端", redirectUris: ["https://client.example/cb"], type: "confidential", skipConsent: true});
    }, SETUP_TIMEOUT_MS);

    it("两份发现文档内容相同，逐字段是输出 2 的值，签发者是站点地址的 origin", async () => {
        const documents: Record<string, unknown>[] = [];
        for (const path of OIDC_DISCOVERY_PATHS) {
            const response = await siteFetch(site.url, path);
            expect({path, status: response.status}).toEqual({path, status: 200});
            documents.push(JSON.parse(response.text) as Record<string, unknown>);
        }
        const [first, second] = documents;
        expect(second).toEqual(first!);
        expect(Value.Check(DiscoveryDocument, first)).toBe(true);
        expect(normalized(first!)).toEqual(
            normalized({
                issuer: SITE_ORIGIN,
                authorization_endpoint: `${SITE_ORIGIN}${OAUTH_ENDPOINT_PATHS.authorize}`,
                token_endpoint: `${SITE_ORIGIN}${OAUTH_ENDPOINT_PATHS.token}`,
                userinfo_endpoint: `${SITE_ORIGIN}${OAUTH_ENDPOINT_PATHS.userinfo}`,
                jwks_uri: `${SITE_ORIGIN}${OAUTH_ENDPOINT_PATHS.jwks}`,
                revocation_endpoint: `${SITE_ORIGIN}${OAUTH_ENDPOINT_PATHS.revoke}`,
                ...CAPABILITIES,
                claims_supported: CLAIMS,
            }),
        );
    });

    it("发现文档列出的每个端点地址都可达（按它在输入表里的方法）", async () => {
        const document = JSON.parse((await siteFetch(site.url, OIDC_DISCOVERY_PATHS[0])).text) as DiscoveryDocument;
        const form = {method: "POST", headers: {"Content-Type": FORM}, body: ""};
        const answers = {
            authorization_endpoint: (await siteFetch(site.url, document.authorization_endpoint)).status,
            token_endpoint: (await siteFetch(site.url, document.token_endpoint, form)).status,
            userinfo_endpoint: (await siteFetch(site.url, document.userinfo_endpoint)).status,
            revocation_endpoint: (await siteFetch(site.url, document.revocation_endpoint, form)).status,
            jwks_uri: (await siteFetch(site.url, document.jwks_uri)).status,
        };
        // 不带参数的请求各有各的失败（跳转、400、401），只要求不是 404；公钥地址要真的给出公钥。
        expect(Object.entries(answers).filter(([, status]) => status === 404)).toEqual([]);
        expect(answers.jwks_uri).toBe(200);
    });

    it("公钥地址与两份发现文档收 HEAD：状态与头同 GET，没有正文", async () => {
        for (const path of [OAUTH_ENDPOINT_PATHS.jwks, ...OIDC_DISCOVERY_PATHS]) {
            const get = await siteFetch(site.url, path);
            const head = await siteFetch(site.url, path, {method: "HEAD"});
            expect({path, status: head.status, headers: comparableHeaders(head), text: head.text}).toEqual({path, status: get.status, headers: comparableHeaders(get), text: ""});
            expect(get.text.length).toBeGreaterThan(0);
        }
    });

    it("两个前缀下不在清单里的地址与方法都是 404：HEAD 与 PUT 授权端点、内省、登出、自助登记，以及库的别的端点（验收 2 的后一半）", async () => {
        const cookie = admin.header();
        const unlisted: ReadonlyArray<readonly [method: string, path: string]> = [
            ["HEAD", OAUTH_ENDPOINT_PATHS.authorize],
            ["PUT", OAUTH_ENDPOINT_PATHS.authorize],
            ["DELETE", OAUTH_ENDPOINT_PATHS.authorize],
            ["HEAD", OAUTH_ENDPOINT_PATHS.userinfo],
            ["GET", OAUTH_ENDPOINT_PATHS.token],
            ["GET", OAUTH_ENDPOINT_PATHS.revoke],
            ["POST", OAUTH_ENDPOINT_PATHS.jwks],
            ["POST", `${IDENTITY_AUTH_PREFIX}/oauth2/introspect`],
            ["GET", `${IDENTITY_AUTH_PREFIX}/oauth2/end-session`],
            ["POST", `${IDENTITY_AUTH_PREFIX}/oauth2/end-session`],
            ["POST", `${IDENTITY_AUTH_PREFIX}/oauth2/register`],
            ["POST", `${IDENTITY_AUTH_PREFIX}/oauth2/create-client`],
            ["POST", `${IDENTITY_AUTH_PREFIX}/oauth2/consent`],
            ["POST", `${IDENTITY_AUTH_PREFIX}/admin/oauth2/create-client`],
            ["GET", `${IDENTITY_AUTH_PREFIX}/get-session`],
            ["POST", `${IDENTITY_AUTH_PREFIX}/sign-out`],
            ["POST", `${IDENTITY_AUTH_PREFIX}/sign-in/email`],
            ["GET", `${IDENTITY_AUTH_PREFIX}/token`],
            ["GET", `${IDENTITY_AUTH_PREFIX}/error`],
            // 没开放的上游的回调。
            ["GET", `${IDENTITY_AUTH_PREFIX}/callback/google`],
            ["GET", `${IDENTITY_AUTH_PREFIX}/callback/github`],
            ["GET", IDENTITY_AUTH_PREFIX],
            ["GET", "/.well-known/jwks.json"],
            ["GET", "/.well-known/oauth-protected-resource"],
            ["POST", OIDC_DISCOVERY_PATHS[0]],
            ["PUT", OIDC_DISCOVERY_PATHS[1]],
        ];
        const answers = [];
        for (const [method, path] of unlisted) {
            const hasBody = method !== "GET" && method !== "HEAD";
            const headers: Record<string, string> = {Origin: SITE_ORIGIN, ...(cookie === undefined ? {} : {Cookie: cookie}), ...(hasBody ? {"Content-Type": "application/json"} : {})};
            const response = await siteFetch(site.url, path, {method, headers, ...(hasBody ? {body: "{}"} : {})});
            answers.push({route: `${method} ${path}`, status: response.status});
        }
        expect(answers).toEqual(unlisted.map(([method, path]) => ({route: `${method} ${path}`, status: 404})));
    });

    it("授权端点的 POST 只收表单：别的类型是 404", async () => {
        const request = new URL(authorizationRequest(client).url);
        const json = await siteFetch(site.url, OAUTH_ENDPOINT_PATHS.authorize, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(Object.fromEntries(request.searchParams))});
        expect(json.status).toBe(404);
        // 同样的参数放进表单：到得了授权端点（跨站的 POST 不带会话，去登录页）。
        const form = await siteFetch(site.url, OAUTH_ENDPOINT_PATHS.authorize, {method: "POST", headers: {"Content-Type": FORM}, body: request.searchParams.toString()});
        expect({status: form.status, path: new URL(form.headers.get("location") ?? "", SITE_ORIGIN).pathname}).toEqual({status: 302, path: "/login"});
    });

    it("按发现文档的 jwks_uri 取公钥验 id_token：RS256 签名对，iss、aud、nonce 都对，exp - iat 为 3600（验收 6）", async () => {
        const document = JSON.parse((await siteFetch(site.url, OIDC_DISCOVERY_PATHS[0])).text) as DiscoveryDocument;
        const {code, verifier, nonce} = await authorizedCode();
        const exchanged = await exchangeCode(site.url, client, code, verifier);
        expect({status: exchanged.status, cacheControl: exchanged.headers.get("cache-control")}).toEqual({status: 200, cacheControl: "no-store"});
        const tokens = JSON.parse(exchanged.text) as {id_token: string; token_type: string; expires_in: number};
        expect({tokenType: tokens.token_type, expiresIn: tokens.expires_in}).toEqual({tokenType: "Bearer", expiresIn: 3600});
        const {header, payload} = await verifyIdToken(site.url, tokens.id_token, document.jwks_uri);
        expect(header.alg).toBe("RS256");
        expect({iss: payload.iss, aud: payload.aud, nonce: payload.nonce, lifetime: (payload.exp as number) - (payload.iat as number)}).toEqual({iss: document.issuer, aud: client.clientId, nonce, lifetime: 3600});
    });

    it("换码时带 resource 被忽略：拿到的仍是不透明的访问令牌，用户信息端点认它（输出 6）", async () => {
        const {code, verifier} = await authorizedCode();
        const exchanged = await exchangeCode(site.url, client, code, verifier, {resource: `${SITE_ORIGIN}${OAUTH_ENDPOINT_PATHS.userinfo}`});
        expect(exchanged.status).toBe(200);
        const accessToken = (JSON.parse(exchanged.text) as {access_token: string}).access_token;
        // 不透明：不是 JWS 的三段式。
        expect(accessToken.split(".")).toHaveLength(1);
        expect((await fetchUserInfo(site.url, accessToken)).status).toBe(200);
    });

    it("令牌端点 17 KB 的表单得 400 invalid_request", async () => {
        const form = new URLSearchParams({grant_type: "authorization_code", code: "x", code_verifier: "y", redirect_uri: client.redirectUri, padding: "a".repeat(17 * 1024)});
        const response = await siteFetch(site.url, OAUTH_ENDPOINT_PATHS.token, {method: "POST", headers: {"Content-Type": FORM}, body: form.toString()});
        expect({status: response.status, body: JSON.parse(response.text) as unknown}).toEqual({status: 400, body: {error: "invalid_request"}});
    });
});
