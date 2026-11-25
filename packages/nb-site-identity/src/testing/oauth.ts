/**
 * 包内测试在进程内走对外 OAuth 的流程：经管理员身份调库的 `adminCreateOAuthClient` 登记客户端，经库的 `auth.handler` 授权、换码、
 * 取公钥，用 `node:crypto` 验 id_token。挂载层（计划 3.6）还没有，请求直接发到库的基路径下，不经站点的白名单与改写。不含断言。
 *
 * 用户要有当前条款的同意记录，否则库在登录后把人带去站点的同意页（`auth.ts` 的 `postLogin`），拿不到码。客户端缺省
 * `skip_consent`，不经确认页。
 */

import {createHash, createPublicKey, randomBytes, verify} from "node:crypto";

import {LIB_BASE_PATH} from "../auth";
import {TEST_SITE_URL, TEST_TERMS_VERSION} from "./library";
import type {TestIdentity} from "./module";

/** 测试客户端的回调地址。 */
export const TEST_REDIRECT_URI = "https://client.example/cb";

/** 带当前条款同意的账号：授权时库不会把人带去站点的同意页。 */
export const CONSENTED = {consent: {termsVersion: TEST_TERMS_VERSION, overseasStorage: true}} as const;

export interface TestClient {
    readonly clientId: string;
    readonly clientSecret: string;
}

/** 经库的 `handler` 发一个请求；`path` 相对库的基路径。 */
export function libraryRequest(identity: TestIdentity, path: string, init?: RequestInit): Promise<Response> {
    return identity.assembly.auth.handler(new Request(`${TEST_SITE_URL}${LIB_BASE_PATH}${path}`, init));
}

/** 建一个管理员、以他的会话登记一个机密客户端（`client_secret_basic`，跳过确认）。 */
export async function registerClient(identity: TestIdentity, name = "admin"): Promise<TestClient> {
    const adminId = await identity.addUser(name, {role: "admin", ...CONSENTED});
    const {cookie} = await identity.issue(adminId);
    const created = await identity.assembly.auth.api.adminCreateOAuthClient({
        headers: new Headers({cookie}),
        body: {
            client_name: "测试客户端",
            redirect_uris: [TEST_REDIRECT_URI],
            token_endpoint_auth_method: "client_secret_basic",
            skip_consent: true,
            scope: "openid profile email",
        },
    });
    if (created.client_secret === undefined) throw new Error("the library registered a confidential client without a secret");
    return {clientId: created.client_id, clientSecret: created.client_secret};
}

/** 带 PKCE 的授权：回授权码与它的 `code_verifier`。库没有跳回客户端（例如跳去了登录页）时抛错。 */
export async function authorize(identity: TestIdentity, cookie: string, client: TestClient): Promise<{readonly code: string; readonly verifier: string}> {
    const verifier = randomBytes(32).toString("base64url");
    const query = new URLSearchParams({
        response_type: "code",
        client_id: client.clientId,
        redirect_uri: TEST_REDIRECT_URI,
        state: "test-state",
        scope: "openid profile email",
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

/** 授权并换码，回令牌响应的内容。换码不是 200 时抛错。 */
export async function grantTokens(identity: TestIdentity, cookie: string, client: TestClient): Promise<TokenResponse> {
    const response = await exchange(identity, client, await authorize(identity, cookie, client));
    if (response.status !== 200) throw new Error(`the token endpoint answered ${response.status}`);
    return (await response.json()) as TokenResponse;
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
