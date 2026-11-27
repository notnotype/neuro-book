/**
 * 包内测试在进程内走对外 OAuth 的流程：经管理员身份调库的 `adminCreateOAuthClient` 登记客户端，经库的 `auth.handler` 授权、换码、
 * 调用户信息、取公钥，用 `node:crypto` 验 id_token。请求直接发到库的 `handler`，不经挂载层（`oauth/mount.ts`）的白名单与改写：
 * 看库本身行为的用例（`oauth/provider.test.ts` 的关掉的路径）要的就是这样；经挂载层的用 `TestIdentity.request`。不含断言。
 *
 * 用户要有当前条款的同意记录，否则库在登录后把人带去站点的同意页（`auth.ts` 的 `postLogin`），拿不到码。客户端缺省
 * `skip_consent`，不经确认页。
 */

import {createHash, createPublicKey, randomBytes, verify} from "node:crypto";

import {LIB_BASE_PATH} from "../auth";
import {TEST_SITE_URL, TEST_TERMS_VERSION} from "./library";
import type {TestIdentity, TestUserOptions} from "./module";

/** 测试客户端的回调地址。 */
export const TEST_REDIRECT_URI = "https://client.example/cb";

/** 带当前条款同意的账号：授权时库不会把人带去站点的同意页。 */
export const CONSENTED = {consent: {termsVersion: TEST_TERMS_VERSION, overseasStorage: true}} as const;

/**
 * 建一个要调用户信息的账号：`addUser` 之外另写资料行（邮箱不是待补）。`addUser` 不写资料行，而用户信息的扩展字段读它
 * （`auth.ts` 的 `customUserInfoClaims`），没有时用户信息端点以程序错误失败。
 */
export async function addOAuthUser(identity: TestIdentity, username: string, options: TestUserOptions = {}): Promise<number> {
    const userId = await identity.addUser(username, options);
    await identity.conn.write((tx) => tx.query(`INSERT INTO identity_profile (user_id, email_pending) VALUES (?, 0)`).run(userId));
    return userId;
}

export interface TestClient {
    readonly clientId: string;
    readonly clientSecret: string;
}

/** 经库的 `handler` 发一个请求；`path` 相对库的基路径。 */
export function libraryRequest(identity: TestIdentity, path: string, init?: RequestInit): Promise<Response> {
    return identity.assembly.auth.handler(new Request(`${TEST_SITE_URL}${LIB_BASE_PATH}${path}`, init));
}

export interface TestClientOptions {
    /** 缺省跳过确认；给 `false` 时授权会经确认页（`oauth/consent-api.ts`）。 */
    readonly skipConsent?: boolean;
}

/** 建一个管理员、以他的会话登记一个机密客户端（`client_secret_basic`，缺省跳过确认）。`name` 是管理员的用户名。 */
export async function registerClient(identity: TestIdentity, name = "admin", options: TestClientOptions = {}): Promise<TestClient> {
    const adminId = await identity.addUser(name, {role: "admin", ...CONSENTED});
    const {cookie} = await identity.issue(adminId);
    const created = await identity.assembly.auth.api.adminCreateOAuthClient({
        headers: new Headers({cookie}),
        body: {
            client_name: "测试客户端",
            redirect_uris: [TEST_REDIRECT_URI],
            token_endpoint_auth_method: "client_secret_basic",
            skip_consent: options.skipConsent ?? true,
            scope: "openid profile email",
        },
    });
    if (created.client_secret === undefined) throw new Error("the library registered a confidential client without a secret");
    return {clientId: created.client_id, clientSecret: created.client_secret};
}

/** 带 PKCE 的授权：回授权码与它的 `code_verifier`。`scope` 缺省是三个都要。库没有跳回客户端（例如跳去了登录页）时抛错。 */
export async function authorize(identity: TestIdentity, cookie: string, client: TestClient, scope = "openid profile email"): Promise<{readonly code: string; readonly verifier: string}> {
    const verifier = randomBytes(32).toString("base64url");
    const query = new URLSearchParams({
        response_type: "code",
        client_id: client.clientId,
        redirect_uri: TEST_REDIRECT_URI,
        state: "test-state",
        scope,
        code_challenge: createHash("sha256").update(verifier).digest("base64url"),
        code_challenge_method: "S256",
    });
    const response = await libraryRequest(identity, `/oauth2/authorize?${query}`, {headers: {cookie}});
    const location = response.headers.get("location");
    const code = location?.startsWith(TEST_REDIRECT_URI) === true ? new URL(location).searchParams.get("code") : null;
    if (code === null) throw new Error(`authorize did not redirect back with a code (status ${response.status})`);
    return {code, verifier};
}

/** 换码（`client_secret_basic`）。回原始的响应，由用例判状态码与内容。 */
export function exchange(identity: TestIdentity, client: TestClient, grant: {readonly code: string; readonly verifier: string}): Promise<Response> {
    const body = new URLSearchParams({grant_type: "authorization_code", code: grant.code, redirect_uri: TEST_REDIRECT_URI, code_verifier: grant.verifier});
    return libraryRequest(identity, "/oauth2/token", {
        method: "POST",
        headers: {
            "content-type": "application/x-www-form-urlencoded",
            authorization: `Basic ${Buffer.from(`${client.clientId}:${client.clientSecret}`).toString("base64")}`,
        },
        body: body.toString(),
    });
}

export interface TokenResponse {
    readonly access_token: string;
    readonly id_token: string;
    readonly expires_in: number;
    readonly token_type: string;
}

/** 授权并换码，回令牌响应的内容；`scope` 同 `authorize`。换码不是 200 时抛错。 */
export async function grantTokens(identity: TestIdentity, cookie: string, client: TestClient, scope?: string): Promise<TokenResponse> {
    const response = await exchange(identity, client, await authorize(identity, cookie, client, scope));
    if (response.status !== 200) throw new Error(`the token endpoint answered ${response.status}`);
    return (await response.json()) as TokenResponse;
}

/** 带访问令牌调库的用户信息端点（GET，`Authorization: Bearer`）。回原始的响应：令牌有效时 200，被撤或查不到时 401。 */
export function userinfo(identity: TestIdentity, accessToken: string): Promise<Response> {
    return libraryRequest(identity, "/oauth2/userinfo", {headers: {authorization: `Bearer ${accessToken}`}});
}

export interface PublicJwk {
    readonly kid: string;
    readonly kty: string;
    readonly alg?: string;
    readonly [field: string]: unknown;
}

/** 公钥地址（库的 `/jwks`）列出的钥匙。 */
export async function publicKeys(identity: TestIdentity): Promise<PublicJwk[]> {
    const response = await libraryRequest(identity, "/jwks");
    if (response.status !== 200) throw new Error(`the jwks endpoint answered ${response.status}`);
    return ((await response.json()) as {keys: PublicJwk[]}).keys;
}

/** JWT 的头与载荷，不验签。 */
export function decodeJwt(token: string): {readonly header: Record<string, unknown>; readonly payload: Record<string, unknown>} {
    const [header, payload] = token.split(".");
    if (header === undefined || payload === undefined) throw new Error("not a JWT");
    return {header: JSON.parse(Buffer.from(header, "base64url").toString("utf8")), payload: JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))};
}

/** 用 `keys` 里与头的 `kid` 相同的公钥验 RS256 签名；没有这把公钥或签名不对时为 false。 */
export function verifiesWith(token: string, keys: readonly PublicJwk[]): boolean {
    const [header, payload, signature] = token.split(".");
    if (header === undefined || payload === undefined || signature === undefined) return false;
    const key = keys.find((candidate) => candidate.kid === decodeJwt(token).header.kid);
    if (key === undefined) return false;
    return verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), createPublicKey({key: key as Record<string, unknown> & {kty: string}, format: "jwk"}), Buffer.from(signature, "base64url"));
}
