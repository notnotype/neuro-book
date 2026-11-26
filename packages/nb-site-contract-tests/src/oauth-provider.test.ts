/**
 * 对外 OAuth 服务的黑盒合同（docs/specs/site/oauth-provider.md）：起真实的 `nb-site` 进程，扮演接入的第三方应用（`testing/oauth-client.ts`），
 * 只经 HTTP 看它。本文件现在覆盖输入表与输出 1 的可达端点、HEAD、输出 2 的发现文档；输出 3 的授权请求（客户端与回调地址、错误页、
 * 去掉 `resource` 与 `claims`、POST 发起、公开客户端的回环地址、`request` 与 `request_uri`、`response_mode`、`response_type`、
 * 4096 个字符的上限）、4 的登录续接（含改走注册）、5 的确认、6 的令牌端点（`resource`、请求体上限、`DPoP`）、7 的用户信息、
 * 10 的撤销、11 的 id_token、12 的站点同意、13 的每个 `prompt` 值、14 的确认页接口；输出 8、9 里停用客户端与换密钥在授权与换码上
 * 看得到的那一面；验收 1、2 的后一半（前一半在 `oauth-admin.test.ts`）、4、6、7、8、11、12、13、15、20 的前半、21、22 的
 * `response_mode` 那半。
 *
 * 本文件测不到、在账号包里的：白名单对库的全部端点逐个挡住（`oauth/mount.test.ts` 遍历库的端点表）；换码撞会话外键回
 * `invalid_grant`（要在库的两步之间删会话）；带 `resource` 换码时库那边有一行访问令牌（读库）；续接令牌与确认标识 10 分钟的
 * 毫秒边界（库按系统时间签名，合同只拨得动模块的时钟，`oauth/continue.test.ts`）；确认页接口判完、库还没判之间改客户端
 * （`oauth/consent-api.test.ts`）；用户信息在邮箱待补时与库的邮箱已验证列为真时的字段（合同里还造不出这两种账号，
 * `oauth/mount.test.ts`）；按模块时钟判 `max_age`（`oauth/authorize-request.test.ts`）。
 *
 * 时间预算：起进程、建账号、登记共用的客户端放在 `beforeAll` 里；用例只发请求。超出 200 毫秒的用例在旁边写明原因：多数要登录，
 * 登录要算一次密码哈希。拨模块时钟的用例各在自己的进程里：拨过的时钟让之后签出的续接令牌一出来就过期。
 */

import {beforeAll, describe, expect, it} from "bun:test";
import {Value} from "typebox/value";

import {createHash} from "node:crypto";

import {
    ConsentResponse,
    CONTINUE_PARAM,
    DiscoveryDocument,
    IDENTITY_AUTH_PREFIX,
    IDENTITY_PATHS,
    identityPath,
    LoginResponse,
    OAUTH_ENDPOINT_PATHS,
    OAUTH_ERROR_PARAM,
    OAUTH_REQUEST_PARAM,
    OAuthAuthorizationResponse,
    OAuthDecisionResponse,
    OIDC_DISCOVERY_PATHS,
    RegisterResponse,
    RegistrationCodeItem,
    RotateSecretResponse,
    UserInfoResponse,
    type CreateOAuthClientRequest,
} from "@notnotype/nb-site-identity-contract";

import {cookieJar, createAdmin, IDENTITY_SITE_ENV, identityRequest, login, SITE_ORIGIN, type CookieJar} from "./testing/identity";
import {
    authorizationRequest,
    exchangeCode,
    fetchUserInfo,
    registerOAuthClient,
    revokeToken,
    siteFetch,
    step,
    verifyIdToken,
    type AuthorizationRequest,
    type RegisteredClient,
    type SiteResponse,
    type Step,
} from "./testing/oauth-client";
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

const CLIENT_REDIRECT = "https://client.example/cb";

/** 一个客户端的登记请求：缺省是机密、要确认的测试客户端。 */
function clientBody(overrides: Partial<CreateOAuthClientRequest> = {}): CreateOAuthClientRequest {
    return {name: "合同测试客户端", redirectUris: [CLIENT_REDIRECT], type: "confidential", skipConsent: false, ...overrides};
}

/** 跳转地址上某个查询参数；没有时抛错（用例接着要用它）。 */
function paramOf(answer: Step, name: string): string {
    const value = answer.location.searchParams.get(name);
    if (value === null) throw new Error(`${answer.kind} redirect carries no ${name}`);
    return value;
}

/** 授权端点的地址加上 `params`（表单 POST 用它作目标）。 */
const AUTHORIZE_URL = `${SITE_ORIGIN}${OAUTH_ENDPOINT_PATHS.authorize}`;

/**
 * 把授权地址的查询串用 `state` 加长到恰好 `length` 个字符（验收 21），回加长后的参数与 `state`。参数按
 * `application/x-www-form-urlencoded` 写出，GET 的查询串与 POST 的表单体都是这个长度。
 */
function paddedQuery(request: AuthorizationRequest, length: number): {readonly query: URLSearchParams; readonly state: string} {
    const query = new URL(request.url).searchParams;
    query.set("state", "");
    const state = "s".repeat(length - query.toString().length);
    query.set("state", state);
    if (query.toString().length !== length) throw new Error(`could not pad the authorization request to ${String(length)} characters`);
    return {query, state};
}

/** 跳回客户端时看得到的几项：错误码与码在查询串里，片段该是空的。 */
function backAt(answer: Step): {readonly kind: string; readonly error: string | null; readonly state: string | null; readonly iss: string | null; readonly code: boolean; readonly fragment: string} {
    const {searchParams, hash} = answer.location;
    return {kind: answer.kind, error: searchParams.get("error"), state: searchParams.get("state"), iss: searchParams.get("iss"), code: searchParams.has("code"), fragment: hash};
}

/** `access_token` 的 `at_hash`（OpenID Connect Core 3.1.3.6）：SHA-256 的左半，base64url。 */
function atHash(accessToken: string): string {
    return createHash("sha256").update(accessToken).digest().subarray(0, 16).toString("base64url");
}

/** 一个站点进程与在它上面已登录、已同意条款的管理员；`from` 每次给一个新的来源地址。 */
interface FlowSite {
    readonly site: SiteProcess;
    /** 进程的数据目录：重启时用它起新进程。 */
    readonly dataDir: string;
    readonly from: () => string;
    /** 以 `jar` 登录并同意当前条款；不成功时抛错。 */
    readonly signIn: (jar: CookieJar, username: string) => Promise<void>;
}

async function startFlowSite(admins: readonly string[]): Promise<FlowSite> {
    const dataDir = await sandbox.dataDir();
    for (const name of admins) await createAdmin(sandbox, dataDir, [name, `${name}@example.com`], PASSWORD);
    const site = await sandbox.start({dataDir, env: IDENTITY_SITE_ENV});
    let address = 0;
    const from = () => `203.0.113.${String(++address % 250)}`;
    const signIn = async (jar: CookieJar, username: string): Promise<void> => {
        if ((await login(site.url, username, PASSWORD, {from: from(), jar})).status !== 200) throw new Error(`${username} could not sign in`);
        const consented = await identityRequest(site.url, IDENTITY_PATHS.meConsent, {method: "POST", jar, from: from(), body: {termsVersion: TERMS_VERSION, overseasStorage: true}});
        if (consented.status !== 200) throw new Error(`${username} could not consent`);
    };
    return {site, dataDir, from, signIn};
}

describe("授权主流程（输出 3 到 5、11、13、14，验收 1、4、13、20 的前半）", () => {
    let flow: FlowSite;
    let site: SiteProcess;
    let root: CookieJar;
    let other: CookieJar;

    const register = (overrides: Partial<CreateOAuthClientRequest> = {}): Promise<RegisteredClient> => registerOAuthClient(site.url, root, flow.from(), clientBody(overrides));

    function showAuthorization(jar: CookieJar, request: string) {
        return identityRequest(site.url, `${IDENTITY_PATHS.oauthAuthorization}?${new URLSearchParams({[OAUTH_REQUEST_PARAM]: request})}`, {jar, from: flow.from()});
    }

    function decide(jar: CookieJar, request: string, accept: boolean) {
        return identityRequest(site.url, IDENTITY_PATHS.oauthAuthorization, {method: "POST", jar, from: flow.from(), body: {request, accept}});
    }

    /** 提交确认并回跳回地址；不是 200 或形状不对时抛错。 */
    async function decidedRedirect(jar: CookieJar, request: string, accept: boolean): Promise<URL> {
        const response = await decide(jar, request, accept);
        if (response.status !== 200 || !Value.Check(OAuthDecisionResponse, response.body)) throw new Error(`deciding answered ${String(response.status)}: ${JSON.stringify(response.body)}`);
        return new URL(response.body.redirectUrl);
    }

    /** 以 `jar` 发起授权并停在确认页，回确认标识。 */
    async function consentRequest(jar: CookieJar, client: RegisteredClient, extra: Readonly<Record<string, string>> = {}): Promise<{readonly request: string; readonly authorization: AuthorizationRequest}> {
        const authorization = authorizationRequest(client, extra);
        const answer = await step(site.url, jar, authorization.url, client);
        if (answer.kind !== "consent") throw new Error(`authorization ended at ${answer.kind}, not at the consent page`);
        return {request: paramOf(answer, OAUTH_REQUEST_PARAM), authorization};
    }

    async function patchClient(client: RegisteredClient, body: unknown): Promise<void> {
        const response = await identityRequest(site.url, identityPath.adminOAuthClient(client.clientId), {method: "PATCH", jar: root, from: flow.from(), body});
        if (response.status !== 200) throw new Error(`patching the client answered ${String(response.status)}`);
    }

    beforeAll(async () => {
        flow = await startFlowSite(["root", "other"]);
        site = flow.site;
        root = cookieJar();
        other = cookieJar();
        await flow.signIn(root, "root");
        await flow.signIn(other, "other");
    }, SETUP_TIMEOUT_MS);

    // 超出预算：登录算一次密码哈希。
    it("走完整流程（Smoke）：授权 → 登录 → 确认 → 换令牌 → 按公钥地址验 id_token → 取用户信息；同一个授权码再换一次被拒（验收 1，输出 4、5、11、14）", async () => {
        const client = await register();
        const authorization = authorizationRequest(client);
        const browser = cookieJar();
        const toLogin = await step(site.url, browser, authorization.url, client);
        expect(toLogin.kind).toBe("login");
        const signedIn = await login(site.url, "root", PASSWORD, {from: flow.from(), jar: browser, continue: paramOf(toLogin, CONTINUE_PARAM)});
        expect({status: signedIn.status, shape: Value.Check(LoginResponse, signedIn.body)}).toEqual({status: 200, shape: true});
        const continueUrl = (signedIn.body as LoginResponse).continueUrl;
        if (continueUrl === undefined) throw new Error("the login answer has no continueUrl");

        const toConsent = await step(site.url, browser, continueUrl, client);
        expect(toConsent.kind).toBe("consent");
        const request = paramOf(toConsent, OAUTH_REQUEST_PARAM);
        const shown = await showAuthorization(browser, request);
        expect({status: shown.status, shape: Value.Check(OAuthAuthorizationResponse, shown.body)}).toEqual({status: 200, shape: true});
        const {scopes, ...rest} = shown.body as OAuthAuthorizationResponse;
        expect({...rest, scopes: [...scopes].sort()}).toEqual({clientName: "合同测试客户端", redirectHost: "client.example", scopes: ["email", "openid", "profile"]});

        const back = await decidedRedirect(browser, request, true);
        expect({to: `${back.origin}${back.pathname}`, state: back.searchParams.get("state"), iss: back.searchParams.get("iss")}).toEqual({to: CLIENT_REDIRECT, state: authorization.state, iss: SITE_ORIGIN});
        const code = back.searchParams.get("code");
        if (code === null) throw new Error("the consent answer carries no code");
        const exchanged = await exchangeCode(site.url, client, code, authorization.verifier);
        expect(exchanged.status).toBe(200);
        const tokens = JSON.parse(exchanged.text) as {access_token: string; id_token: string};
        const document = JSON.parse((await siteFetch(site.url, OIDC_DISCOVERY_PATHS[0])).text) as DiscoveryDocument;
        const {payload} = await verifyIdToken(site.url, tokens.id_token, document.jwks_uri);
        const info = await fetchUserInfo(site.url, tokens.access_token);
        expect(info.status).toBe(200);
        const claims = JSON.parse(info.text) as {sub?: unknown; preferred_username?: unknown};
        expect({username: claims.preferred_username, idTokenSub: payload.sub, aud: payload.aud, nonce: payload.nonce}).toEqual({
            username: "root",
            idTokenSub: claims.sub,
            aud: client.clientId,
            nonce: authorization.nonce,
        });

        const again = await exchangeCode(site.url, client, code, authorization.verifier);
        expect({status: again.status, error: (JSON.parse(again.text) as {error?: unknown}).error}).toEqual({status: 400, error: "invalid_grant"});
    });

    // 超出预算：登录算一次密码哈希。
    it("以表单 POST 发起：跨站 POST 不带会话 Cookie 先被带去登录，经继续地址回到确认、拿到授权码并换出令牌（验收 20 的前半）", async () => {
        const client = await register();
        const authorization = authorizationRequest(client);
        const browser = cookieJar();
        const toLogin = await step(site.url, browser, AUTHORIZE_URL, client, new URL(authorization.url).searchParams);
        expect(toLogin.kind).toBe("login");
        const signedIn = await login(site.url, "root", PASSWORD, {from: flow.from(), jar: browser, continue: paramOf(toLogin, CONTINUE_PARAM)});
        const continueUrl = (signedIn.body as LoginResponse).continueUrl;
        if (continueUrl === undefined) throw new Error("the login answer has no continueUrl");
        const toConsent = await step(site.url, browser, continueUrl, client);
        expect(toConsent.kind).toBe("consent");
        const back = await decidedRedirect(browser, paramOf(toConsent, OAUTH_REQUEST_PARAM), true);
        const code = back.searchParams.get("code");
        if (code === null) throw new Error("the consent answer carries no code");
        expect([back.searchParams.get("state"), (await exchangeCode(site.url, client, code, authorization.verifier)).status]).toEqual([authorization.state, 200]);
    });

    it("带着会话的表单 POST 与 GET 一样到确认页（库不因它是 POST 另查来源）", async () => {
        const client = await register();
        const answer = await step(site.url, root, AUTHORIZE_URL, client, new URL(authorizationRequest(client).url).searchParams);
        expect(answer.kind).toBe("consent");
    });

    it("客户端不对、回调地址不对：GET 与 POST 都不跳回客户端，到 /oauth/consent?error=（输出 3，验收 4）", async () => {
        const client = await register();
        const disabled = await register();
        await patchClient(disabled, {disabled: true});
        const cases: ReadonlyArray<readonly [label: string, client: RegisteredClient, extra: Readonly<Record<string, string>>, code: string]> = [
            ["没有这个客户端", client, {client_id: "no-such-client"}, "client_not_found"],
            ["停用了", disabled, {}, "client_not_found"],
            ["改掉回调地址", client, {redirect_uri: "https://client.example/evil"}, "redirect_uri_invalid"],
            ["换成别的站点", client, {redirect_uri: "https://evil.example/cb"}, "redirect_uri_invalid"],
        ];
        for (const [label, target, extra, code] of cases) {
            const request = authorizationRequest(target, extra);
            for (const answer of [await step(site.url, root, request.url, target), await step(site.url, root, AUTHORIZE_URL, target, new URL(request.url).searchParams)]) {
                expect({label, kind: answer.kind, error: answer.location.searchParams.get(OAUTH_ERROR_PARAM)}).toEqual({label, kind: "error", error: code});
            }
        }
    });

    // 超出预算：登录算一次密码哈希。
    it("登录之后改掉继续地址里的回调地址再继续：也到 /oauth/consent?error=redirect_uri_invalid（验收 4）", async () => {
        const client = await register({skipConsent: true});
        const browser = cookieJar();
        const toLogin = await step(site.url, browser, authorizationRequest(client).url, client);
        const signedIn = await login(site.url, "root", PASSWORD, {from: flow.from(), jar: browser, continue: paramOf(toLogin, CONTINUE_PARAM)});
        const continueUrl = new URL((signedIn.body as LoginResponse).continueUrl ?? "", SITE_ORIGIN);
        continueUrl.searchParams.set("redirect_uri", "https://client.example/evil");
        const answer = await step(site.url, browser, continueUrl.href, client);
        expect({kind: answer.kind, error: answer.location.searchParams.get(OAUTH_ERROR_PARAM)}).toEqual({kind: "error", error: "redirect_uri_invalid"});
    });

    it("回调地址可信时别的错误跳回客户端：不带 openid 是 invalid_scope，带 state 与 iss（输出 3）", async () => {
        const client = await register({skipConsent: true});
        const request = authorizationRequest(client, {scope: "profile"});
        const answer = await step(site.url, root, request.url, client);
        expect({kind: answer.kind, error: answer.location.searchParams.get("error"), state: answer.location.searchParams.get("state"), iss: answer.location.searchParams.get("iss")}).toEqual({
            kind: "redirect-back",
            error: "invalid_scope",
            state: request.state,
            iss: SITE_ORIGIN,
        });
    });

    it("claims 与 resource 被忽略：带要求 acr 的 claims、带不认得的 resource 照样拿到授权码，id_token 的 acr 仍是 0（输出 3、11）", async () => {
        const client = await register({skipConsent: true});
        const document = JSON.parse((await siteFetch(site.url, OIDC_DISCOVERY_PATHS[0])).text) as DiscoveryDocument;
        const request = authorizationRequest(client, {claims: JSON.stringify({id_token: {acr: {essential: true, value: "1"}}}), resource: "https://unknown.example/api"});
        const answer = await step(site.url, root, request.url, client);
        const code = answer.location.searchParams.get("code");
        if (answer.kind !== "redirect-back" || code === null) throw new Error(`authorization ended at ${answer.kind} (${answer.location.search})`);
        const tokens = JSON.parse((await exchangeCode(site.url, client, code, request.verifier)).text) as {id_token: string};
        expect((await verifyIdToken(site.url, tokens.id_token, document.jwks_uri)).payload.acr).toBe("0");
    });

    it("id_token 的字段：iss、sub 与用户信息相同、aud、iat、exp、auth_time、at_hash、acr 为 0、nonce 原样，不带资料字段（输出 11）", async () => {
        const client = await register({skipConsent: true});
        const document = JSON.parse((await siteFetch(site.url, OIDC_DISCOVERY_PATHS[0])).text) as DiscoveryDocument;
        const request = authorizationRequest(client);
        const answer = await step(site.url, root, request.url, client);
        const tokens = JSON.parse((await exchangeCode(site.url, client, paramOf(answer, "code"), request.verifier)).text) as {access_token: string; id_token: string};
        const {payload} = await verifyIdToken(site.url, tokens.id_token, document.jwks_uri);
        const sub = (JSON.parse((await fetchUserInfo(site.url, tokens.access_token)).text) as {sub: string}).sub;
        expect(Object.keys(payload).sort()).toEqual(["acr", "at_hash", "aud", "auth_time", "exp", "iat", "iss", "nonce", "sub"]);
        expect({iss: payload.iss, sub: payload.sub, aud: payload.aud, acr: payload.acr, nonce: payload.nonce, atHash: payload.at_hash}).toEqual({
            iss: document.issuer,
            sub,
            aud: client.clientId,
            acr: "0",
            nonce: request.nonce,
            atHash: atHash(tokens.access_token),
        });
    });

    it("同意过的范围再来不再确认，多要了范围时重新确认；prompt=consent 总显示确认页，免确认的客户端也是（输出 5、13）", async () => {
        const client = await register();
        const {request} = await consentRequest(root, client, {scope: "openid profile"});
        expect((await decidedRedirect(root, request, true)).searchParams.get("code")).not.toBeNull();
        expect((await step(site.url, root, authorizationRequest(client, {scope: "openid profile"}).url, client)).kind).toBe("redirect-back");
        expect((await step(site.url, root, authorizationRequest(client, {scope: "openid profile email"}).url, client)).kind).toBe("consent");
        expect((await step(site.url, root, authorizationRequest(client, {scope: "openid profile", prompt: "consent"}).url, client)).kind).toBe("consent");
        const trusted = await register({skipConsent: true});
        expect((await step(site.url, root, authorizationRequest(trusted, {prompt: "consent"}).url, trusted)).kind).toBe("consent");
    });

    // 超出预算：登录算一次密码哈希。
    it("prompt=login 有会话也先去登录；登录后的继续地址不再要求登录，去那里拿到授权码（输出 4、13）", async () => {
        const client = await register({skipConsent: true});
        const browser = cookieJar();
        await flow.signIn(browser, "root");
        const toLogin = await step(site.url, browser, authorizationRequest(client, {prompt: "login"}).url, client);
        expect(toLogin.kind).toBe("login");
        const signedIn = await login(site.url, "root", PASSWORD, {from: flow.from(), jar: browser, continue: paramOf(toLogin, CONTINUE_PARAM)});
        const answer = await step(site.url, browser, (signedIn.body as LoginResponse).continueUrl ?? "", client);
        expect({kind: answer.kind, code: answer.location.searchParams.has("code")}).toEqual({kind: "redirect-back", code: true});
    });

    // 超出预算：登录算一次密码哈希。
    it("篡改的续接令牌：登录成功，响应不带继续地址（验收 13 的后一半）", async () => {
        const client = await register({skipConsent: true});
        const toLogin = await step(site.url, cookieJar(), authorizationRequest(client).url, client);
        const token = paramOf(toLogin, CONTINUE_PARAM);
        // 令牌对浏览器不透明；改中间的一个字符就是篡改。不改末尾：base64url 末尾那个字符的低位解码时丢掉，`A` 换成 `B` 解出来
        // 一样，令牌照样合格。
        const middle = Math.floor(token.length / 2);
        const tampered = `${token.slice(0, middle)}${token[middle] === "A" ? "B" : "A"}${token.slice(middle + 1)}`;
        const signedIn = await login(site.url, "root", PASSWORD, {from: flow.from(), jar: cookieJar(), continue: tampered});
        expect({status: signedIn.status, continueUrl: (signedIn.body as LoginResponse).continueUrl}).toEqual({status: 200, continueUrl: undefined});
    });

    it("确认标识：拒绝带 access_denied 跳回；同一个标识拒绝后再同意拿到码；别的账号提交时按他的会话算（输出 14）", async () => {
        const client = await register();
        const {request, authorization} = await consentRequest(root, client);
        const denied = await decidedRedirect(root, request, false);
        expect({to: `${denied.origin}${denied.pathname}`, error: denied.searchParams.get("error"), state: denied.searchParams.get("state")}).toEqual({to: CLIENT_REDIRECT, error: "access_denied", state: authorization.state});
        const accepted = await decidedRedirect(root, request, true);
        expect((await exchangeCode(site.url, client, accepted.searchParams.get("code") ?? "", authorization.verifier)).status).toBe(200);

        const byOther = await decidedRedirect(other, request, true);
        const tokens = JSON.parse((await exchangeCode(site.url, client, byOther.searchParams.get("code") ?? "", authorization.verifier)).text) as {access_token: string};
        expect((JSON.parse((await fetchUserInfo(site.url, tokens.access_token)).text) as {preferred_username?: unknown}).preferred_username).toBe("other");
    });

    it("确认页打开之后客户端被停用：GET、同意、拒绝都回 404 client_not_found；回调地址被改得不再匹配：都回 400 redirect_uri_invalid（输出 14）", async () => {
        const cases = [
            ["停用", {disabled: true}, 404, "client_not_found"],
            ["改回调地址", {redirectUris: ["https://client.example/new"]}, 400, "redirect_uri_invalid"],
        ] as const;
        for (const [label, change, status, code] of cases) {
            const client = await register();
            const {request} = await consentRequest(root, client);
            await patchClient(client, change);
            const expected = {status, body: {error: {code}}};
            for (const [kind, response] of [
                ["GET", await showAuthorization(root, request)],
                ["同意", await decide(root, request, true)],
                ["拒绝", await decide(root, request, false)],
            ] as const) {
                expect({label, kind, status: response.status, body: response.body}).toEqual({label, kind, ...expected});
            }
        }
    });

    it("公开客户端的 http 回环回调地址换了端口也能拿到授权码，并以 client_id 换出令牌（输出 3、6）", async () => {
        const registered = await register({type: "public", redirectUris: ["http://127.0.0.1:8123/cb"], skipConsent: true});
        // 本机应用每次起在不同的端口上（RFC 8252）。
        const client: RegisteredClient = {...registered, redirectUri: "http://127.0.0.1:49152/cb"};
        const request = authorizationRequest(client);
        const answer = await step(site.url, root, request.url, client);
        expect({kind: answer.kind, to: `${answer.location.origin}${answer.location.pathname}`}).toEqual({kind: "redirect-back", to: "http://127.0.0.1:49152/cb"});
        expect((await exchangeCode(site.url, client, paramOf(answer, "code"), request.verifier)).status).toBe(200);
        const localhost = authorizationRequest({...registered, redirectUri: "http://localhost:8123/cb"});
        const rejected = await step(site.url, root, localhost.url, client);
        expect({kind: rejected.kind, error: rejected.location.searchParams.get(OAUTH_ERROR_PARAM)}).toEqual({kind: "error", error: "redirect_uri_invalid"});
    });

    it("停用客户端：它的访问令牌调用户信息得 401，没用掉的授权码换码得 invalid_client（输出 8、16）", async () => {
        const client = await register({skipConsent: true});
        const used = authorizationRequest(client);
        const tokens = JSON.parse((await exchangeCode(site.url, client, paramOf(await step(site.url, root, used.url, client), "code"), used.verifier)).text) as {access_token: string};
        const pending = authorizationRequest(client);
        const code = paramOf(await step(site.url, root, pending.url, client), "code");
        await patchClient(client, {disabled: true});
        expect((await fetchUserInfo(site.url, tokens.access_token)).status).toBe(401);
        expect((JSON.parse((await exchangeCode(site.url, client, code, pending.verifier)).text) as {error?: unknown}).error).toBe("invalid_client");
    });

    it("换密钥后旧密钥换码得 invalid_client，新密钥换得出（输出 9）", async () => {
        const client = await register({skipConsent: true});
        const rotated = await identityRequest(site.url, identityPath.adminOAuthClientRotate(client.clientId), {method: "POST", jar: root, from: flow.from()});
        expect({status: rotated.status, shape: Value.Check(RotateSecretResponse, rotated.body)}).toEqual({status: 200, shape: true});
        const renewed: RegisteredClient = {...client, clientSecret: (rotated.body as RotateSecretResponse).clientSecret};
        const first = authorizationRequest(client);
        const firstCode = paramOf(await step(site.url, root, first.url, client), "code");
        expect((JSON.parse((await exchangeCode(site.url, client, firstCode, first.verifier)).text) as {error?: unknown}).error).toBe("invalid_client");
        const second = authorizationRequest(client);
        expect((await exchangeCode(site.url, renewed, paramOf(await step(site.url, root, second.url, client), "code"), second.verifier)).status).toBe(200);
    });

    /** 带续接令牌以 `username` 登录，回响应给的继续地址；不是 200 或没有继续地址时抛错。 */
    async function loginToContinue(jar: CookieJar, toLogin: Step, username = "root"): Promise<string> {
        const signedIn = await login(site.url, username, PASSWORD, {from: flow.from(), jar, continue: paramOf(toLogin, CONTINUE_PARAM)});
        const continueUrl = signedIn.status === 200 ? (signedIn.body as LoginResponse).continueUrl : undefined;
        if (continueUrl === undefined) throw new Error(`signing in with the continue token answered ${String(signedIn.status)} without a continueUrl`);
        return continueUrl;
    }

    /** 免确认的客户端以 `jar` 拿码并换出访问令牌。 */
    async function accessTokenOf(jar: CookieJar, client: RegisteredClient, scope = "openid profile email"): Promise<string> {
        const request = authorizationRequest(client, {scope});
        const exchanged = await exchangeCode(site.url, client, paramOf(await step(site.url, jar, request.url, client), "code"), request.verifier);
        if (exchanged.status !== 200) throw new Error(`exchanging the code answered ${String(exchanged.status)}`);
        return (JSON.parse(exchanged.text) as {access_token: string}).access_token;
    }

    it("交库前要拒的参数跳回客户端，错误码在查询串里、带 state 与 iss，GET 与表单 POST 相同（输出 3、13，验收 22 的后半）", async () => {
        const client = await register({skipConsent: true});
        const cases: ReadonlyArray<readonly [label: string, extra: Readonly<Record<string, string>>, error: string]> = [
            ["request", {request: "eyJhbGciOiJub25lIn0.e30."}, "request_not_supported"],
            ["request_uri", {request_uri: "https://client.example/request.jwt"}, "request_uri_not_supported"],
            ["response_mode=fragment", {response_mode: "fragment"}, "invalid_request"],
            ["response_mode=form_post", {response_mode: "form_post"}, "invalid_request"],
            ["response_type=token", {response_type: "token"}, "unsupported_response_type"],
            ["prompt=none consent", {prompt: "none consent"}, "invalid_request"],
            ["prompt=none login", {prompt: "none login"}, "invalid_request"],
            ["prompt=create", {prompt: "create"}, "invalid_request"],
            ["prompt=select_account", {prompt: "select_account"}, "invalid_request"],
            ["prompt 是不认得的值", {prompt: "bogus"}, "invalid_request"],
        ];
        for (const [label, extra, error] of cases) {
            const request = authorizationRequest(client, extra);
            for (const [via, answer] of [
                ["GET", await step(site.url, root, request.url, client)],
                ["POST", await step(site.url, root, AUTHORIZE_URL, client, new URL(request.url).searchParams)],
            ] as const) {
                expect({label, via, ...backAt(answer)}).toEqual({label, via, kind: "redirect-back", error, state: request.state, iss: SITE_ORIGIN, code: false, fragment: ""});
            }
        }
    });

    it("prompt 的合格值：none 时有会话的免确认客户端拿到码、没有会话跳回 login_required、没同意过的客户端跳回 consent_required；login 去登录页；consent 去确认页；login consent 先去登录页（输出 13，验收 8）", async () => {
        const trusted = await register({skipConsent: true});
        const asking = await register();
        const outcome = async (jar: CookieJar, client: RegisteredClient, prompt: string) => {
            const answer = await step(site.url, jar, authorizationRequest(client, {prompt}).url, client);
            return {prompt, kind: answer.kind, error: answer.location.searchParams.get("error"), code: answer.location.searchParams.has("code")};
        };
        expect(await outcome(root, trusted, "none")).toEqual({prompt: "none", kind: "redirect-back", error: null, code: true});
        expect(await outcome(cookieJar(), trusted, "none")).toEqual({prompt: "none", kind: "redirect-back", error: "login_required", code: false});
        expect(await outcome(root, asking, "none")).toEqual({prompt: "none", kind: "redirect-back", error: "consent_required", code: false});
        expect(await outcome(root, trusted, "login")).toEqual({prompt: "login", kind: "login", error: null, code: false});
        expect(await outcome(root, trusted, "consent")).toEqual({prompt: "consent", kind: "consent", error: null, code: false});
        expect(await outcome(root, trusted, "login consent")).toEqual({prompt: "login consent", kind: "login", error: null, code: false});
    });

    it("带 essential acr 的 claims 与不带时结果相同：没有会话都去登录页，有会话的免确认客户端都拿到码（输出 3）", async () => {
        const client = await register({skipConsent: true});
        const claims = JSON.stringify({id_token: {acr: {essential: true, value: "1"}}});
        for (const [label, jar, expected] of [
            ["没有会话", cookieJar(), "login"],
            ["有会话", root, "redirect-back"],
        ] as const) {
            const results = [];
            for (const extra of [{}, {claims}] as ReadonlyArray<Readonly<Record<string, string>>>) {
                const answer = await step(site.url, jar, authorizationRequest(client, extra).url, client);
                results.push({kind: answer.kind, code: answer.location.searchParams.has("code")});
            }
            expect({label, plain: results[0]?.kind}).toEqual({label, plain: expected});
            expect({label, withClaims: results[1]}).toEqual({label, withClaims: results[0]});
        }
    });

    // 超出预算：登录算两次密码哈希。
    it("查询串正好 4096 个字符：经匿名登录（GET 与跨站的表单 POST）、经确认都拿到授权码；4097 个字符跳回 invalid_request（验收 21；补交同意那条在“站点同意门槛”）", async () => {
        const trusted = await register({skipConsent: true});
        const asking = await register();
        for (const via of ["GET", "POST"] as const) {
            const request = authorizationRequest(trusted);
            const {query, state} = paddedQuery(request, 4096);
            const browser = cookieJar();
            const toLogin = via === "GET" ? await step(site.url, browser, `${AUTHORIZE_URL}?${query}`, trusted) : await step(site.url, browser, AUTHORIZE_URL, trusted, query);
            expect({via, kind: toLogin.kind}).toEqual({via, kind: "login"});
            const back = await step(site.url, browser, await loginToContinue(browser, toLogin), trusted);
            expect({via, ...backAt(back)}).toEqual({via, kind: "redirect-back", error: null, state, iss: SITE_ORIGIN, code: true, fragment: ""});
            expect((await exchangeCode(site.url, trusted, paramOf(back, "code"), request.verifier)).status).toBe(200);
        }

        const request = authorizationRequest(asking);
        const {query, state} = paddedQuery(request, 4096);
        const toConsent = await step(site.url, root, `${AUTHORIZE_URL}?${query}`, asking);
        expect(toConsent.kind).toBe("consent");
        const decided = await decidedRedirect(root, paramOf(toConsent, OAUTH_REQUEST_PARAM), true);
        expect(decided.searchParams.get("state")).toBe(state);
        expect((await exchangeCode(site.url, asking, decided.searchParams.get("code") ?? "", request.verifier)).status).toBe(200);

        for (const via of ["GET", "POST"] as const) {
            const over = paddedQuery(authorizationRequest(trusted), 4097);
            const answer = via === "GET" ? await step(site.url, root, `${AUTHORIZE_URL}?${over.query}`, trusted) : await step(site.url, root, AUTHORIZE_URL, trusted, over.query);
            expect({via, ...backAt(answer)}).toEqual({via, kind: "redirect-back", error: "invalid_request", state: over.state, iss: SITE_ORIGIN, code: false, fragment: ""});
        }
    });

    // 超出预算：注册算一次密码哈希。
    it("从 /login?continue= 改走注册：注册响应给继续地址，去那里拿到新账号的授权码（site.accounts 输出 4）", async () => {
        const client = await register({skipConsent: true});
        const issued = await identityRequest(site.url, IDENTITY_PATHS.adminRegistrationCodes, {method: "POST", jar: root, from: flow.from(), body: {maxUses: 1}});
        if (issued.status !== 200 || !Value.Check(RegistrationCodeItem, issued.body)) throw new Error(`issuing a registration code answered ${String(issued.status)}`);
        const browser = cookieJar();
        const request = authorizationRequest(client);
        const toLogin = await step(site.url, browser, request.url, client);
        const registered = await identityRequest(site.url, IDENTITY_PATHS.register, {
            method: "POST",
            jar: browser,
            from: flow.from(),
            body: {username: "joiner", email: "joiner@example.com", password: PASSWORD, registrationCode: issued.body.code, termsVersion: TERMS_VERSION, overseasStorage: true, continue: paramOf(toLogin, CONTINUE_PARAM)},
        });
        expect({status: registered.status, shape: Value.Check(RegisterResponse, registered.body)}).toEqual({status: 200, shape: true});
        const continueUrl = (registered.body as RegisterResponse).continueUrl;
        if (continueUrl === undefined) throw new Error("the register answer has no continueUrl");
        const back = await step(site.url, browser, continueUrl, client);
        expect(backAt(back)).toEqual({kind: "redirect-back", error: null, state: request.state, iss: SITE_ORIGIN, code: true, fragment: ""});
        const tokens = JSON.parse((await exchangeCode(site.url, client, paramOf(back, "code"), request.verifier)).text) as {access_token: string};
        expect((JSON.parse((await fetchUserInfo(site.url, tokens.access_token)).text) as {preferred_username?: unknown}).preferred_username).toBe("joiner");
    });

    it("用户信息：设了头像也没有 picture，email_verified 为 false，形状合 UserInfoResponse，GET 与 POST 相同；按范围给字段（输出 7）", async () => {
        const client = await register({skipConsent: true});
        const patched = await identityRequest(site.url, IDENTITY_PATHS.me, {method: "PATCH", jar: other, from: flow.from(), body: {avatarUrl: "https://img.example/other.png"}});
        expect(patched.status).toBe(200);
        const full = await accessTokenOf(other, client);
        const answers = [];
        for (const method of ["GET", "POST"] as const) {
            const response = await siteFetch(site.url, OAUTH_ENDPOINT_PATHS.userinfo, {method, headers: {Authorization: `Bearer ${full}`}});
            answers.push({method, status: response.status, cacheControl: response.headers.get("cache-control"), body: JSON.parse(response.text) as Record<string, unknown>});
        }
        const sub = answers[0]?.body.sub;
        const profile = {preferred_username: "other", name: "other"};
        const email = {email_pending: false, email: "other@example.com", email_verified: false};
        expect(answers).toEqual((["GET", "POST"] as const).map((method) => ({method, status: 200, cacheControl: "no-store", body: {sub, ...profile, ...email}})));
        expect(Value.Check(UserInfoResponse, answers[0]?.body)).toBe(true);

        for (const [scope, expected] of [
            ["openid", {sub}],
            ["openid profile", {sub, ...profile}],
            ["openid email", {sub, ...email}],
        ] as const) {
            const info = await fetchUserInfo(site.url, await accessTokenOf(other, client, scope));
            expect({scope, body: JSON.parse(info.text) as unknown}).toEqual({scope, body: expected});
        }
    });

    it("带 DPoP 头换令牌回 invalid_request、不发令牌；同一个码不带它照常换出（输出 6，验收 12）", async () => {
        const client = await register({skipConsent: true});
        const request = authorizationRequest(client);
        const code = paramOf(await step(site.url, root, request.url, client), "code");
        const form = new URLSearchParams({grant_type: "authorization_code", code, redirect_uri: client.redirectUri, code_verifier: request.verifier});
        const response = await siteFetch(site.url, OAUTH_ENDPOINT_PATHS.token, {
            method: "POST",
            headers: {"Content-Type": FORM, Authorization: `Basic ${Buffer.from(`${client.clientId}:${client.clientSecret ?? ""}`).toString("base64")}`, DPoP: "eyJ0eXAiOiJkcG9wK2p3dCJ9.e30.c2ln"},
            body: form.toString(),
        });
        expect({status: response.status, body: JSON.parse(response.text) as unknown}).toEqual({status: 400, body: {error: "invalid_request"}});
        expect((await exchangeCode(site.url, client, code, request.verifier)).status).toBe(200);
    });

    it("撤销：公开客户端撤销自己的令牌后它得 401；已撤销的、不存在的、别的客户端的令牌都回 200，后者不起作用；不带 token 回 invalid_request（输出 10，验收 11）", async () => {
        const publicClient = await register({type: "public", redirectUris: ["http://127.0.0.1:8123/cb"], skipConsent: true});
        const confidential = await register({skipConsent: true});
        const mine = await accessTokenOf(root, publicClient);
        const theirs = await accessTokenOf(root, confidential);
        const revoked = async (token: string) => {
            const response = await revokeToken(site.url, publicClient, token);
            return {token: token === mine ? "mine" : token === theirs ? "theirs" : token, status: response.status, cacheControl: response.headers.get("cache-control")};
        };
        const ok = (token: string) => ({token, status: 200, cacheControl: "no-store"});
        expect(await revoked(theirs)).toEqual(ok("theirs"));
        expect((await fetchUserInfo(site.url, theirs)).status).toBe(200);
        expect(await revoked(mine)).toEqual(ok("mine"));
        expect((await fetchUserInfo(site.url, mine)).status).toBe(401);
        expect(await revoked(mine)).toEqual(ok("mine"));
        expect(await revoked("no-such-token")).toEqual(ok("no-such-token"));
        const missing = await siteFetch(site.url, OAUTH_ENDPOINT_PATHS.revoke, {method: "POST", headers: {"Content-Type": FORM}, body: new URLSearchParams({client_id: publicClient.clientId}).toString()});
        expect({status: missing.status, error: (JSON.parse(missing.text) as {error?: unknown}).error}).toEqual({status: 400, error: "invalid_request"});
    });
});

describe("站点同意门槛（输出 12、13，验收 21 的补交同意那条）", () => {
    let flow: FlowSite;
    let client: RegisteredClient;
    /** 登录了、没同意当前条款的会话。 */
    let late: CookieJar;

    beforeAll(async () => {
        flow = await startFlowSite(["root", "late"]);
        const root = cookieJar();
        await flow.signIn(root, "root");
        client = await registerOAuthClient(flow.site.url, root, flow.from(), clientBody({skipConsent: true}));
        late = cookieJar();
        if ((await login(flow.site.url, "late", PASSWORD, {from: flow.from(), jar: late})).status !== 200) throw new Error("late could not sign in");
    }, SETUP_TIMEOUT_MS);

    it("缺同意时 prompt=none 跳回 interaction_required，prompt=login 先去登录页；查询串正好 4096 个字符时去 /consent?continue=，补交同意后去继续地址拿到授权码", async () => {
        const {site} = flow;
        const outcome = async (extra: Readonly<Record<string, string>>) => {
            const answer = await step(site.url, late, authorizationRequest(client, extra).url, client);
            return {kind: answer.kind, error: answer.location.searchParams.get("error")};
        };
        expect(await outcome({prompt: "none"})).toEqual({kind: "redirect-back", error: "interaction_required"});
        expect(await outcome({prompt: "login"})).toEqual({kind: "login", error: null});

        const request = authorizationRequest(client);
        const {query, state} = paddedQuery(request, 4096);
        const toConsent = await step(site.url, late, `${AUTHORIZE_URL}?${query}`, client);
        expect(toConsent.kind).toBe("site-consent");
        const consented = await identityRequest(site.url, IDENTITY_PATHS.meConsent, {
            method: "POST",
            jar: late,
            from: flow.from(),
            body: {termsVersion: TERMS_VERSION, overseasStorage: true, continue: paramOf(toConsent, CONTINUE_PARAM)},
        });
        expect({status: consented.status, shape: Value.Check(ConsentResponse, consented.body)}).toEqual({status: 200, shape: true});
        const continueUrl = (consented.body as ConsentResponse).continueUrl;
        if (continueUrl === undefined) throw new Error("the consent answer has no continueUrl");
        const back = await step(site.url, late, continueUrl, client);
        expect(backAt(back)).toEqual({kind: "redirect-back", error: null, state, iss: SITE_ORIGIN, code: true, fragment: ""});
        expect((await exchangeCode(site.url, client, paramOf(back, "code"), request.verifier)).status).toBe(200);
    });
});

describe("条款版本提高之后（验收 15，输出 12、14）", () => {
    const NEW_TERMS_VERSION = "2026-12-01";
    let restarted: SiteProcess;
    let root: CookieJar;
    let trusted: RegisteredClient;
    let asking: RegisteredClient;
    /** 重启前打开的确认页的确认标识。 */
    let pending: string;
    let address = 0;
    const from = () => `192.0.2.${String(++address % 250)}`;

    beforeAll(async () => {
        const flow = await startFlowSite(["root"]);
        root = cookieJar();
        await flow.signIn(root, "root");
        trusted = await registerOAuthClient(flow.site.url, root, flow.from(), clientBody({skipConsent: true}));
        asking = await registerOAuthClient(flow.site.url, root, flow.from(), clientBody());
        const toConsent = await step(flow.site.url, root, authorizationRequest(asking).url, asking);
        if (toConsent.kind !== "consent") throw new Error(`authorization ended at ${toConsent.kind}, not at the consent page`);
        pending = paramOf(toConsent, OAUTH_REQUEST_PARAM);
        await flow.site.stop();
        restarted = await sandbox.start({dataDir: flow.dataDir, env: {...IDENTITY_SITE_ENV, NB_SITE_IDENTITY_TERMS_VERSION: NEW_TERMS_VERSION}});
    }, SETUP_TIMEOUT_MS);

    it("旧会话打开过的确认页：GET 与同意都得 consent_required，不发码；发起授权被带到 /consent?continue=，补交新版本的同意后去继续地址拿到授权码", async () => {
        const consentRequired = {status: 403, body: {error: {code: "consent_required"}}};
        const shown = await identityRequest(restarted.url, `${IDENTITY_PATHS.oauthAuthorization}?${new URLSearchParams({[OAUTH_REQUEST_PARAM]: pending})}`, {jar: root, from: from()});
        expect({status: shown.status, body: shown.body}).toEqual(consentRequired);
        const decided = await identityRequest(restarted.url, IDENTITY_PATHS.oauthAuthorization, {method: "POST", jar: root, from: from(), body: {request: pending, accept: true}});
        expect({status: decided.status, body: decided.body}).toEqual(consentRequired);

        const request = authorizationRequest(trusted);
        const toConsent = await step(restarted.url, root, request.url, trusted);
        expect(toConsent.kind).toBe("site-consent");
        const consented = await identityRequest(restarted.url, IDENTITY_PATHS.meConsent, {
            method: "POST",
            jar: root,
            from: from(),
            body: {termsVersion: NEW_TERMS_VERSION, overseasStorage: true, continue: paramOf(toConsent, CONTINUE_PARAM)},
        });
        expect({status: consented.status, shape: Value.Check(ConsentResponse, consented.body)}).toEqual({status: 200, shape: true});
        const continueUrl = (consented.body as ConsentResponse).continueUrl;
        if (continueUrl === undefined) throw new Error("the consent answer has no continueUrl");
        const back = await step(restarted.url, root, continueUrl, trusted);
        expect(backAt(back)).toMatchObject({kind: "redirect-back", error: null, state: request.state, code: true});
        expect((await exchangeCode(restarted.url, trusted, paramOf(back, "code"), request.verifier)).status).toBe(200);
    });
});

describe("id_token 的 auth_time（验收 13）", () => {
    let flow: FlowSite;

    beforeAll(async () => {
        flow = await startFlowSite(["root"]);
        await flow.signIn(cookieJar(), "root");
    }, SETUP_TIMEOUT_MS);

    // 超出预算：登录算一次密码哈希。
    it("是续接的那次登录的时间，不是换码的时间", async () => {
        const {site} = flow;
        const root = cookieJar();
        await flow.signIn(root, "root");
        const client = await registerOAuthClient(site.url, root, flow.from(), clientBody({skipConsent: true}));
        const browser = cookieJar();
        const request = authorizationRequest(client);
        const toLogin = await step(site.url, browser, request.url, client);
        const before = await site.advanceClock(1);
        const signedIn = await login(site.url, "root", PASSWORD, {from: flow.from(), jar: browser, continue: paramOf(toLogin, CONTINUE_PARAM)});
        const after = await site.advanceClock(1);
        // 登录与换码之间拨过 5 分钟：auth_time 取自换码时的时间就落在登录的区间之外。
        await site.advanceClock(5 * 60_000);
        const answer = await step(site.url, browser, (signedIn.body as LoginResponse).continueUrl ?? "", client);
        const tokens = JSON.parse((await exchangeCode(site.url, client, paramOf(answer, "code"), request.verifier)).text) as {id_token: string};
        const document = JSON.parse((await siteFetch(site.url, OIDC_DISCOVERY_PATHS[0])).text) as DiscoveryDocument;
        const authTime = (await verifyIdToken(site.url, tokens.id_token, document.jwks_uri)).payload.auth_time as number;
        expect({authTime, inLogin: authTime >= Math.floor(before / 1000) && authTime <= Math.ceil(after / 1000)}).toEqual({authTime, inLogin: true});
    });
});

describe("续接令牌与确认标识过了 10 分钟（验收 13、输出 14）", () => {
    let flow: FlowSite;

    beforeAll(async () => {
        flow = await startFlowSite(["root"]);
    }, SETUP_TIMEOUT_MS);

    // 超出预算：登录算两次密码哈希。
    it("登录成功、响应不带继续地址；确认页的 GET、同意、拒绝都回 410 authorization_expired", async () => {
        const {site} = flow;
        const root = cookieJar();
        await flow.signIn(root, "root");
        const client = await registerOAuthClient(site.url, root, flow.from(), clientBody());
        const toLogin = await step(site.url, cookieJar(), authorizationRequest(client).url, client);
        const toConsent = await step(site.url, root, authorizationRequest(client).url, client);
        expect([toLogin.kind, toConsent.kind]).toEqual(["login", "consent"]);
        const request = paramOf(toConsent, OAUTH_REQUEST_PARAM);
        await site.advanceClock(10 * 60_000 + 1);

        const signedIn = await login(site.url, "root", PASSWORD, {from: flow.from(), jar: cookieJar(), continue: paramOf(toLogin, CONTINUE_PARAM)});
        expect({status: signedIn.status, continueUrl: (signedIn.body as LoginResponse).continueUrl}).toEqual({status: 200, continueUrl: undefined});
        const expired = {status: 410, body: {error: {code: "authorization_expired"}}};
        const shown = await identityRequest(site.url, `${IDENTITY_PATHS.oauthAuthorization}?${new URLSearchParams({[OAUTH_REQUEST_PARAM]: request})}`, {jar: root, from: flow.from()});
        expect({status: shown.status, body: shown.body}).toEqual(expired);
        for (const accept of [true, false]) {
            const decided = await identityRequest(site.url, IDENTITY_PATHS.oauthAuthorization, {method: "POST", jar: root, from: flow.from(), body: {request, accept}});
            expect({accept, status: decided.status, body: decided.body}).toEqual({accept, ...expired});
        }
    });
});
