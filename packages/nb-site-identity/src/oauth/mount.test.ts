/**
 * 挂载层（`oauth/mount.ts`）与发现文档（`oauth/discovery.ts`）经入口同样的挂法（`TestIdentity.request`）的可观察结果：只有
 * `site.oauth-provider` 输入表里的“方法加路径”可达，其余是本模块的 404；HEAD 只给公钥与发现文档；请求体上限；令牌端点只收表单、
 * 去掉 `resource`、撞会话外键回 `invalid_grant`。
 *
 * 期望的可达清单照 Spec 的输入表写成字面量，不从 `LIBRARY_PUBLIC_ENDPOINTS` 取：守卫防的就是那张表被放宽。
 */

import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {Hono} from "hono";
import {Value} from "typebox/value";

import {DiscoveryDocument, IDENTITY_AUTH_PREFIX, OAUTH_ENDPOINT_PATHS, OIDC_DISCOVERY_PATHS} from "@notnotype/nb-site-identity-contract";

import {TEST_SITE_URL} from "../testing/library";
import {createTestIdentity, type TestIdentity} from "../testing/module";
import {addOAuthUser, authorize, CONSENTED, decodeJwt, registerClient, TEST_REDIRECT_URI, type TestClient} from "../testing/oauth";
import {createOAuthApp} from "./mount";

const NOT_FOUND = {error: {code: "not_found"}};
const FORM = "application/x-www-form-urlencoded";

let identity: TestIdentity;
let client: TestClient;
let cookie: string;

beforeEach(async () => {
    identity = await createTestIdentity("oauth-mount");
    client = await registerClient(identity);
    ({cookie} = await identity.issue(await addOAuthUser(identity, "alice", CONSENTED)));
});

afterEach(async () => {
    await identity.assembly.close();
    await identity.root.cleanup();
});

function basicAuth(target: TestClient): string {
    return `Basic ${Buffer.from(`${target.clientId}:${target.clientSecret}`).toString("base64")}`;
}

/** 经挂载层换码（`client_secret_basic`）；`extra` 加进表单。 */
function exchangeViaMount(grant: {readonly code: string; readonly verifier: string}, extra: Readonly<Record<string, string>> = {}): Promise<Response> {
    const body = new URLSearchParams({grant_type: "authorization_code", code: grant.code, redirect_uri: TEST_REDIRECT_URI, code_verifier: grant.verifier, ...extra});
    return identity.request(OAUTH_ENDPOINT_PATHS.token, {method: "POST", headers: {"content-type": FORM, authorization: basicAuth(client)}, body: body.toString()});
}

/** 响应是不是本模块兜底的 404（`ErrorBody` 的 `not_found`）：库自己的 404 没有这个体，用它分辨请求有没有被交给库。 */
async function isOwnNotFound(response: Response, method: string): Promise<boolean> {
    if (response.status !== 404) return false;
    // HEAD 没有正文，只能看状态。
    if (method === "HEAD") return true;
    const text = await response.text();
    return text === JSON.stringify(NOT_FOUND);
}

const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] as const;

/** `site.oauth-provider` 输入表里 `/api/identity/auth/` 下的“方法加路径”（公钥另收 HEAD）。社交上游都没开放，回调不在里面。 */
const PUBLIC_ROUTES = [
    "GET /oauth2/authorize",
    "POST /oauth2/authorize",
    "POST /oauth2/token",
    "GET /oauth2/userinfo",
    "POST /oauth2/userinfo",
    "POST /oauth2/revoke",
    "GET /jwks",
    "HEAD /jwks",
];

describe("白名单", () => {
    it("库的全部端点乘六种方法经挂好的入口：只有输入表里的可达，其余都是本模块的 404、没交给库", async () => {
        // 不按前缀过滤：库的管理端点（`/admin/...`）、会话端点（`/get-session`）与 OAuth 端点一样要挡。
        const paths = new Set(Object.values(identity.assembly.auth.api as Record<string, {readonly path?: string}>).flatMap((endpoint) => (endpoint.path === undefined ? [] : [endpoint.path])));
        expect(paths.size).toBeGreaterThan(80);
        const reachable: string[] = [];
        for (const path of [...paths].sort()) {
            const concrete = path.replaceAll(/:\w+/gu, "x");
            for (const method of METHODS) {
                // 带体的方法发表单：白名单里的端点都收它，能走到库；白名单外的不论体是什么都该在兜底挡下。
                const init: RequestInit = method === "GET" || method === "HEAD" ? {method, headers: {cookie}} : {method, headers: {cookie, origin: TEST_SITE_URL, "content-type": FORM}, body: ""};
                const response = await identity.request(`${IDENTITY_AUTH_PREFIX}${concrete}`, init);
                if (!(await isOwnNotFound(response, method))) reachable.push(`${method} ${concrete}`);
            }
        }
        expect(reachable.sort()).toEqual([...PUBLIC_ROUTES].sort());
    });

    it("点名的库端点是本模块的 404：登记客户端、冒充用户、令牌、读会话、登出、库的错误页", async () => {
        const named = [
            ["POST", "/admin/oauth2/create-client"],
            ["POST", "/admin/impersonate-user"],
            ["GET", "/token"],
            ["GET", "/get-session"],
            ["POST", "/sign-out"],
            ["GET", "/error"],
        ] as const;
        const results = [];
        for (const [method, path] of named) {
            const init: RequestInit = method === "GET" ? {headers: {cookie}} : {method, headers: {cookie, origin: TEST_SITE_URL, "content-type": "application/json"}, body: "{}"};
            const response = await identity.request(`${IDENTITY_AUTH_PREFIX}${path}`, init);
            results.push({route: `${method} ${path}`, status: response.status, body: await response.json()});
        }
        expect(results).toEqual(named.map(([method, path]) => ({route: `${method} ${path}`, status: 404, body: NOT_FOUND})));
    });

    it("路径的写法不同就不是同一个端点：多了斜杠、大小写不同、末尾带斜杠都是 404", async () => {
        for (const path of [`${IDENTITY_AUTH_PREFIX}//jwks`, `${IDENTITY_AUTH_PREFIX}/JWKS`, `${IDENTITY_AUTH_PREFIX}/jwks/`, `${IDENTITY_AUTH_PREFIX}/oauth2//token`]) {
            const response = await identity.request(path);
            expect({path, status: response.status, body: await response.json()}).toEqual({path, status: 404, body: NOT_FOUND});
        }
    });

    it("社交回调只放开放了的上游、只收 GET", async () => {
        // 产品的装配还没有开放任何上游（配置在计划 3.12）；这里另建一个开放了 Google 的挂载层，挂法与入口相同。
        const app = new Hono();
        app.route(IDENTITY_AUTH_PREFIX, createOAuthApp({auth: identity.assembly.auth, log: identity.log, socialProviders: ["google"]}));
        const send = (method: string, provider: string) => app.fetch(new Request(`${TEST_SITE_URL}${IDENTITY_AUTH_PREFIX}/callback/${provider}`, {method}));
        // 开放了的上游交库：没有 state 时库把人带去它的错误页（这一步的改写在第 8 片）。
        expect((await send("GET", "google")).status).toBe(302);
        for (const [method, provider] of [["POST", "google"], ["HEAD", "google"], ["GET", "github"], ["GET", "x"]] as const) {
            expect({method, provider, ownNotFound: await isOwnNotFound(await send(method, provider), method)}).toEqual({method, provider, ownNotFound: true});
        }
        // 产品的装配里谷歌的回调也是 404。
        expect(await isOwnNotFound(await identity.request(`${IDENTITY_AUTH_PREFIX}/callback/google`), "GET")).toBe(true);
    });
});

describe("HEAD", () => {
    it("公钥与两份发现文档的 HEAD 与 GET 同状态、同头，没有正文", async () => {
        for (const path of [OAUTH_ENDPOINT_PATHS.jwks, ...OIDC_DISCOVERY_PATHS]) {
            const get = await identity.request(path);
            const head = await identity.request(path, {method: "HEAD"});
            expect({path, status: get.status, body: (await get.text()).length > 0}).toEqual({path, status: 200, body: true});
            expect({path, status: head.status, headers: [...head.headers], body: await head.text()}).toEqual({path, status: get.status, headers: [...get.headers], body: ""});
        }
    });

    it("授权与用户信息端点的 HEAD 是 404", async () => {
        for (const path of [OAUTH_ENDPOINT_PATHS.authorize, OAUTH_ENDPOINT_PATHS.userinfo]) {
            const response = await identity.request(path, {method: "HEAD", headers: {cookie}});
            expect({path, status: response.status}).toEqual({path, status: 404});
        }
    });
});

describe("授权端点的 POST", () => {
    function authorizeParams(): URLSearchParams {
        return new URLSearchParams({
            response_type: "code",
            client_id: client.clientId,
            redirect_uri: TEST_REDIRECT_URI,
            scope: "openid",
            state: "s",
            code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
            code_challenge_method: "S256",
        });
    }

    it("表单发起与 GET 发起得到同样的结果：没有会话时都去登录页", async () => {
        const get = await identity.request(`${OAUTH_ENDPOINT_PATHS.authorize}?${authorizeParams()}`);
        const post = await identity.request(OAUTH_ENDPOINT_PATHS.authorize, {method: "POST", headers: {"content-type": `${FORM}; charset=UTF-8`, origin: "https://client.example"}, body: authorizeParams().toString()});
        const target = (response: Response) => ({status: response.status, path: new URL(response.headers.get("location") ?? "", TEST_SITE_URL).pathname});
        expect(target(post)).toEqual(target(get));
        expect(target(get)).toEqual({status: 302, path: "/login"});
    });

    it("不是表单类型的 POST 是 404，与白名单外的方法一样", async () => {
        const bodies: ReadonlyArray<readonly [contentType: string | null, body: string]> = [
            ["application/json", JSON.stringify(Object.fromEntries(authorizeParams()))],
            ["text/plain", authorizeParams().toString()],
            ["multipart/form-data; boundary=x", "--x--"],
            [null, authorizeParams().toString()],
        ];
        for (const [contentType, body] of bodies) {
            // 不带类型的体由 `Request` 按字符串补成 text/plain；照样不是表单。
            const headers: Record<string, string> = contentType === null ? {} : {"content-type": contentType};
            const response = await identity.request(OAUTH_ENDPOINT_PATHS.authorize, {method: "POST", headers, body});
            expect({contentType, status: response.status, body: await response.json()}).toEqual({contentType, status: 404, body: NOT_FOUND});
        }
    });
});

describe("令牌端点", () => {
    it("带 resource 换码：拿到的仍是不透明令牌、有 oauthAccessToken 行，用户信息认它；响应不许缓存", async () => {
        const grant = await authorize(identity, cookie, client);
        // 资源取用户信息端点的地址：库认得它，不去掉时发 JWT、不写行（升级清单“允许的访问令牌都有 oauthAccessToken 行”）。
        const response = await exchangeViaMount(grant, {resource: `${TEST_SITE_URL}${OAUTH_ENDPOINT_PATHS.userinfo}`});
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        const tokens = (await response.json()) as {access_token: string; token_type: string; id_token: string};
        expect(tokens.access_token.split(".")).toHaveLength(1);
        expect(decodeJwt(tokens.id_token).payload.aud).toBe(client.clientId);
        const rows = await identity.conn.read((tx) => tx.query<{n: number}, []>(`SELECT count(*) AS n FROM "oauthAccessToken"`).get()!.n);
        expect(rows).toBe(1);
        const info = await identity.request(OAUTH_ENDPOINT_PATHS.userinfo, {headers: {authorization: `Bearer ${tokens.access_token}`}});
        expect(info.status).toBe(200);
    });

    it("不是表单的请求回 400 invalid_request，不交库", async () => {
        const grant = await authorize(identity, cookie, client);
        const body = JSON.stringify({grant_type: "authorization_code", code: grant.code, redirect_uri: TEST_REDIRECT_URI, code_verifier: grant.verifier});
        const response = await identity.request(OAUTH_ENDPOINT_PATHS.token, {method: "POST", headers: {"content-type": "application/json", authorization: basicAuth(client)}, body});
        expect({status: response.status, cacheControl: response.headers.get("cache-control"), body: await response.json()}).toEqual({status: 400, cacheControl: "no-store", body: {error: "invalid_request"}});
        // 码没被用掉：库没看到这个请求。
        expect((await exchangeViaMount(grant)).status).toBe(200);
    });

    it("换码时会话被删、插令牌撞外键：回 400 invalid_grant 并记一行日志，不发令牌", async () => {
        const grant = await authorize(identity, cookie, client);
        // 库换码先删码（`verification` 的行）再插令牌；在删码之后删掉会话，就是“换码与结束会话撞上”（计划问 10）。临时触发器只在
        // 模块这条连接上。
        await identity.conn.write((tx) => tx.query(`CREATE TEMP TRIGGER drop_sessions AFTER DELETE ON main.verification BEGIN DELETE FROM main."session"; END`).run());
        const response = await exchangeViaMount(grant);
        expect({status: response.status, cacheControl: response.headers.get("cache-control"), body: await response.json()}).toEqual({status: 400, cacheControl: "no-store", body: {error: "invalid_grant"}});
        expect(identity.log.lines.filter((line) => line.event === "identity.oauth_token_raced").map((line) => line.level)).toEqual(["warn"]);
        expect(await identity.conn.read((tx) => tx.query<{n: number}, []>(`SELECT count(*) AS n FROM "oauthAccessToken"`).get()!.n)).toBe(0);
    });

    it("请求体超过 16 KiB 回 400 invalid_request：定长的与分块的都按读到的字节数判", async () => {
        const grant = await authorize(identity, cookie, client);
        const oversized = new URLSearchParams({grant_type: "authorization_code", code: grant.code, redirect_uri: TEST_REDIRECT_URI, code_verifier: grant.verifier, padding: "a".repeat(17 * 1024)}).toString();
        const fixed = await identity.request(OAUTH_ENDPOINT_PATHS.token, {method: "POST", headers: {"content-type": FORM, authorization: basicAuth(client)}, body: oversized});
        const bytes = new TextEncoder().encode(oversized);
        const chunked = await identity.request(OAUTH_ENDPOINT_PATHS.token, {
            method: "POST",
            headers: {"content-type": FORM, authorization: basicAuth(client)},
            body: new ReadableStream({
                start(controller) {
                    controller.enqueue(bytes.slice(0, 8 * 1024));
                    controller.enqueue(bytes.slice(8 * 1024));
                    controller.close();
                },
            }),
        });
        for (const [name, response] of [["fixed", fixed], ["chunked", chunked]] as const) {
            expect({name, status: response.status, cacheControl: response.headers.get("cache-control"), body: await response.json()}).toEqual({name, status: 400, cacheControl: "no-store", body: {error: "invalid_request"}});
        }
        // 两次都没交库：码还在，照常换得出。
        expect((await exchangeViaMount(grant)).status).toBe(200);
    });
});

describe("发现文档", () => {
    it("两份内容相同、合合同的形状，不是库自己的那份；可以缓存 5 分钟", async () => {
        const documents = [];
        for (const path of OIDC_DISCOVERY_PATHS) {
            const response = await identity.request(path);
            expect({path, status: response.status, cacheControl: response.headers.get("cache-control")}).toEqual({path, status: 200, cacheControl: "public, max-age=300"});
            documents.push(await response.json());
        }
        expect(documents[1]).toEqual(documents[0]);
        expect(Value.Check(DiscoveryDocument, documents[0])).toBe(true);
        expect(documents[0]).toMatchObject({issuer: TEST_SITE_URL, response_modes_supported: ["query"], jwks_uri: `${TEST_SITE_URL}${OAUTH_ENDPOINT_PATHS.jwks}`});
    });

    it("/.well-known 下别的地址与方法是 404", async () => {
        for (const [method, path] of [["GET", "/.well-known/jwks.json"], ["POST", OIDC_DISCOVERY_PATHS[0]], ["PUT", OIDC_DISCOVERY_PATHS[1]], ["GET", "/.well-known/"]] as const) {
            const response = await identity.request(path, {method});
            expect({method, path, status: response.status, body: await response.json()}).toEqual({method, path, status: 404, body: NOT_FOUND});
        }
    });
});
