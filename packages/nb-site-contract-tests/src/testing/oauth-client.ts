/**
 * 对外 OAuth 的测试客户端（w00037 t08 计划 3.14）：扮演一个接入站点的第三方应用，只经 HTTP 说话。经管理接口登记客户端；造带 PKCE
 * 的授权地址；`step` 一次只发一个请求、不跟随跳转，把跳转归成五类；换码、调用户信息、撤销；按公钥地址验 id_token。另有浏览器走
 * 社交流程的几步（`followSocial`：经仿真上游的授权地址拿回调地址，带 state Cookie 请求回调，回落点）。不含断言。
 *
 * 地址：发现文档与跳转里的地址是站点地址（`https://site.test/...`），进程只在回环上监听。`siteFetch` 把站点地址换成进程的地址、
 * 补站点的 `Host`，路径与查询串原样带过去。
 */

import {createHash, createPublicKey, randomBytes, verify} from "node:crypto";

import {CreateOAuthClientResponse, IDENTITY_PATHS, OAUTH_ENDPOINT_PATHS, OAUTH_PAGES, OAUTH_REQUEST_PARAM, type CreateOAuthClientRequest} from "@notnotype/nb-site-identity-contract";
import {Value} from "typebox/value";

import {identityRequest, type CookieJar} from "./identity";
import {REQUEST_TIMEOUT_MS, SANDBOX_SITE_URL} from "./site";

const SITE_HOST = new URL(SANDBOX_SITE_URL).host;

/** 一次请求的结果：正文读成文字，由用例决定怎么解析（HEAD 没有正文，标准端点的错误体不是 `ErrorBody`）。 */
export interface SiteResponse {
    readonly status: number;
    readonly headers: Headers;
    readonly text: string;
}

export interface SiteFetchInit {
    readonly method?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: string;
    /** 给了时回送它的 Cookie，并把响应的 `Set-Cookie` 存进去。 */
    readonly jar?: CookieJar;
}

/**
 * 请求站点上的一个地址：`target` 是站点地址或从站点根起的路径。不跟随跳转；整个请求（含读完正文）至多 `REQUEST_TIMEOUT_MS`，
 * 到点中断并抛错。
 */
export async function siteFetch(processUrl: string, target: string, init: SiteFetchInit = {}): Promise<SiteResponse> {
    const site = new URL(target, SANDBOX_SITE_URL);
    if (site.origin !== new URL(SANDBOX_SITE_URL).origin) throw new Error(`${target} is not an address on the site`);
    const headers = new Headers({Host: SITE_HOST, ...init.headers});
    const cookie = init.jar?.header();
    if (cookie !== undefined) headers.set("Cookie", cookie);
    const response = await fetch(new URL(`${site.pathname}${site.search}`, processUrl), {
        method: init.method ?? "GET",
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        ...(init.body === undefined ? {} : {body: init.body}),
    });
    const text = await response.text();
    init.jar?.store(response);
    return {status: response.status, headers: response.headers, text};
}

export interface RegisteredClient {
    readonly clientId: string;
    /** 公开客户端为 null。 */
    readonly clientSecret: string | null;
    readonly redirectUri: string;
}

/** 以管理员的会话经 `POST admin/oauth-clients` 登记一个客户端；不是 200 或形状不对时抛错。回调地址取第一个。 */
export async function registerOAuthClient(processUrl: string, admin: CookieJar, from: string, body: CreateOAuthClientRequest): Promise<RegisteredClient> {
    const response = await identityRequest(processUrl, IDENTITY_PATHS.adminOAuthClients, {method: "POST", jar: admin, from, body});
    if (response.status !== 200 || !Value.Check(CreateOAuthClientResponse, response.body)) throw new Error(`registering an OAuth client answered ${String(response.status)}`);
    const redirectUri = body.redirectUris[0];
    if (redirectUri === undefined) throw new Error("an OAuth client needs a redirect URI");
    return {clientId: response.body.client.clientId, clientSecret: response.body.clientSecret, redirectUri};
}

export interface AuthorizationRequest {
    /** 授权端点的站点地址，带全部参数。 */
    readonly url: string;
    readonly verifier: string;
    readonly state: string;
    readonly nonce: string;
}

/** 带 PKCE（S256）、`state` 与 `nonce` 的授权地址；`extra` 盖在缺省参数上。 */
export function authorizationRequest(client: RegisteredClient, extra: Readonly<Record<string, string>> = {}): AuthorizationRequest {
    const verifier = randomBytes(32).toString("base64url");
    const state = randomBytes(8).toString("hex");
    const nonce = randomBytes(8).toString("hex");
    const query = new URLSearchParams({
        response_type: "code",
        client_id: client.clientId,
        redirect_uri: client.redirectUri,
        scope: "openid profile email",
        state,
        nonce,
        code_challenge: createHash("sha256").update(verifier).digest("base64url"),
        code_challenge_method: "S256",
        ...extra,
    });
    return {url: `${SANDBOX_SITE_URL}${OAUTH_ENDPOINT_PATHS.authorize}?${query}`, verifier, state, nonce};
}

/** 授权流程里的一次跳转落在哪里（`site.oauth-provider` 输出 3 到 5）。 */
export type StepKind = "login" | "site-consent" | "consent" | "error" | "redirect-back";

export interface Step {
    readonly kind: StepKind;
    /** 跳转的目标，按站点地址解析过。 */
    readonly location: URL;
    readonly response: SiteResponse;
}

/**
 * 以浏览器的身份 GET 一次 `url`（站点地址），不跟随跳转，按 `Location` 归类：跳回客户端的回调地址、站点的登录页、站点同意页、
 * 授权确认页（带确认标识）、授权确认页上的错误（带 `error`）。不是跳转或不在这五类里时抛错，错误里带状态与目标。
 *
 * 给了 `form` 时改为 POST：`url` 是授权端点，参数在表单体里，`Origin` 是客户端回调地址的 origin（客户端的页面提交的表单，
 * `site.oauth-provider` 输出 3）。浏览器跨站 POST 不带站点的 `SameSite=Lax` 会话 Cookie，要模拟它就给一个空的 `jar`。
 */
export async function step(processUrl: string, jar: CookieJar, url: string, client: RegisteredClient, form?: URLSearchParams): Promise<Step> {
    const init: SiteFetchInit =
        form === undefined
            ? {jar}
            : {jar, method: "POST", headers: {"Content-Type": "application/x-www-form-urlencoded", Origin: new URL(client.redirectUri).origin}, body: form.toString()};
    const response = await siteFetch(processUrl, url, init);
    const target = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || target === null) throw new Error(`${url} answered ${String(response.status)} without a redirect`);
    const location = new URL(target, SANDBOX_SITE_URL);
    const kind = stepKind(location, client);
    if (kind === undefined) throw new Error(`${url} redirected somewhere outside the authorization flow: ${location.origin}${location.pathname}`);
    return {kind, location, response};
}

function stepKind(location: URL, client: RegisteredClient): StepKind | undefined {
    const redirect = new URL(client.redirectUri);
    if (location.origin === redirect.origin && location.pathname === redirect.pathname) return "redirect-back";
    if (location.origin !== new URL(SANDBOX_SITE_URL).origin) return undefined;
    if (location.pathname === OAUTH_PAGES.login) return "login";
    if (location.pathname === OAUTH_PAGES.siteConsent) return "site-consent";
    if (location.pathname === OAUTH_PAGES.consent) return location.searchParams.has(OAUTH_REQUEST_PARAM) ? "consent" : "error";
    return undefined;
}

function clientAuthentication(client: RegisteredClient, form: URLSearchParams): Record<string, string> {
    // 机密客户端用 `client_secret_basic`；公开客户端不带密钥、在表单里带 `client_id`（输出 6）。
    if (client.clientSecret === null) {
        form.set("client_id", client.clientId);
        return {};
    }
    return {Authorization: `Basic ${Buffer.from(`${client.clientId}:${client.clientSecret}`).toString("base64")}`};
}

/** 换码（`POST` 令牌端点，表单）；`extra` 加进表单。回原始的响应。 */
export function exchangeCode(processUrl: string, client: RegisteredClient, code: string, verifier: string, extra: Readonly<Record<string, string>> = {}): Promise<SiteResponse> {
    const form = new URLSearchParams({grant_type: "authorization_code", code, redirect_uri: client.redirectUri, code_verifier: verifier, ...extra});
    const headers = {"Content-Type": "application/x-www-form-urlencoded", ...clientAuthentication(client, form)};
    return siteFetch(processUrl, OAUTH_ENDPOINT_PATHS.token, {method: "POST", headers, body: form.toString()});
}

/** 带访问令牌调用户信息端点（`GET`，`Authorization: Bearer`）。 */
export function fetchUserInfo(processUrl: string, accessToken: string): Promise<SiteResponse> {
    return siteFetch(processUrl, OAUTH_ENDPOINT_PATHS.userinfo, {headers: {Authorization: `Bearer ${accessToken}`}});
}

/** 撤销一个令牌（`POST` 撤销端点，表单）。 */
export function revokeToken(processUrl: string, client: RegisteredClient, token: string): Promise<SiteResponse> {
    const form = new URLSearchParams({token});
    const headers = {"Content-Type": "application/x-www-form-urlencoded", ...clientAuthentication(client, form)};
    return siteFetch(processUrl, OAUTH_ENDPOINT_PATHS.revoke, {method: "POST", headers, body: form.toString()});
}

/** 公钥地址列出的一把钥（JWK）；`createPublicKey` 读其余字段。 */
interface PublicJwk {
    readonly kid?: string;
    readonly kty: string;
    readonly [field: string]: unknown;
}

export interface VerifiedIdToken {
    readonly header: Readonly<Record<string, unknown>>;
    readonly payload: Readonly<Record<string, unknown>>;
}

function decodeSegment(segment: string): Record<string, unknown> {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as Record<string, unknown>;
}

/**
 * 从 `jwksUri`（发现文档里的公钥地址）取公钥，用头里 `kid` 相同的那把验 RS256 签名；验过才回头与载荷。头的 `alg` 不是 RS256、
 * 公钥地址里没有这把钥或签名不对时抛错。载荷里的字段由用例核对。
 */
export async function verifyIdToken(processUrl: string, idToken: string, jwksUri: string): Promise<VerifiedIdToken> {
    const [header, payload, signature] = idToken.split(".");
    if (header === undefined || payload === undefined || signature === undefined) throw new Error("the id_token is not a JWS in compact form");
    const decodedHeader = decodeSegment(header);
    if (decodedHeader.alg !== "RS256") throw new Error(`the id_token is signed with ${String(decodedHeader.alg)}, not RS256`);
    const jwks = await siteFetch(processUrl, jwksUri);
    if (jwks.status !== 200) throw new Error(`the jwks endpoint answered ${String(jwks.status)}`);
    const keys = (JSON.parse(jwks.text) as {keys: PublicJwk[]}).keys;
    const key = keys.find((candidate) => candidate.kid === decodedHeader.kid);
    if (key === undefined) throw new Error(`the jwks endpoint lists no key with kid ${String(decodedHeader.kid)}`);
    if (!verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), createPublicKey({key, format: "jwk"}), Buffer.from(signature, "base64url"))) {
        throw new Error("the id_token signature does not verify with the listed key");
    }
    return {header: decodedHeader, payload: decodeSegment(payload)};
}

/** 社交流程跳回站点的落点（`site.accounts` 输出 23）。 */
export interface SocialLanding {
    readonly status: number;
    /** 跳转的目标，按站点地址解析过。 */
    readonly location: URL;
    /** 落点的 `social_error`；成功时为 null。 */
    readonly socialError: string | null;
    readonly response: SiteResponse;
}

/**
 * 以浏览器的身份请求发起接口给的上游地址（仿真上游自动同意、302 回站点的回调），回那个回调的站点地址。上游没跳回站点时抛错。
 * 上游不是被测系统，直接请求它，不经 `siteFetch`。
 */
export async function upstreamCallback(upstreamUrl: string): Promise<string> {
    const response = await fetch(upstreamUrl, {redirect: "manual", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)});
    await response.arrayBuffer();
    const location = response.headers.get("location");
    if (response.status !== 302 || location === null) throw new Error(`the upstream answered ${String(response.status)} without a redirect`);
    if (new URL(location).origin !== new URL(SANDBOX_SITE_URL).origin) throw new Error(`the upstream redirected off the site: ${new URL(location).origin}`);
    return location;
}

/** 以 `jar`（带着它的 state Cookie 与会话 Cookie）打开站点的回调地址，回落点；站点没跳转时抛错。 */
export async function openSocialCallback(processUrl: string, jar: CookieJar, callbackUrl: string): Promise<SocialLanding> {
    const response = await siteFetch(processUrl, callbackUrl, {jar});
    const target = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || target === null) throw new Error(`the social callback answered ${String(response.status)} without a redirect`);
    const location = new URL(target, SANDBOX_SITE_URL);
    return {status: response.status, location, socialError: location.searchParams.get("social_error"), response};
}

/** 发起接口的成功响应里的上游地址；不是 200 时抛错，带上响应体。 */
export function socialStartUrl(start: {readonly status: number; readonly body: unknown}): string {
    const url = (start.body as {readonly url?: unknown} | null)?.url;
    if (start.status !== 200 || typeof url !== "string") throw new Error(`social start answered ${String(start.status)}: ${JSON.stringify(start.body)}`);
    return url;
}

/** 一个浏览器走完一次社交流程：发起的响应（state Cookie 已存进 `jar`）→ 上游 → 回调，回落点。 */
export async function followSocial(processUrl: string, jar: CookieJar, start: {readonly status: number; readonly body: unknown}): Promise<SocialLanding> {
    return openSocialCallback(processUrl, jar, await upstreamCallback(socialStartUrl(start)));
}
