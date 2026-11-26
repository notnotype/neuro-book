/**
 * 挂载层（`oauth/mount.ts`）与发现文档（`oauth/discovery.ts`）经入口同样的挂法（`TestIdentity.request`）的可观察结果：只有
 * `site.oauth-provider` 输入表里的“方法加路径”可达，其余是本模块的 404；HEAD 只给公钥与发现文档；请求体上限；授权端点的第 1 步、
 * 去掉 `resource` 与 `claims`、POST 与 GET 同一套、库的跳转改写（库的错误页不外露）；令牌端点只收表单、去掉 `resource`、撞会话外键
 * 回 `invalid_grant`、拒 `DPoP`；用户信息的字段过滤；撤销端点的改写。授权端点的第 2、3 步与站点同意在 `authorize-request.test.ts`。
 *
 * 期望的可达清单照 Spec 的输入表写成字面量，不从 `LIBRARY_PUBLIC_ENDPOINTS` 取：守卫防的就是那张表被放宽。
 */

import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {Hono} from "hono";
import {Value} from "typebox/value";

import {
    CreateOAuthClientResponse,
    DiscoveryDocument,
    IDENTITY_AUTH_PREFIX,
    IDENTITY_PATHS,
    identityPath,
    OAUTH_ENDPOINT_PATHS,
    OAUTH_PAGES,
    OIDC_DISCOVERY_PATHS,
    UserInfoResponse,
} from "@notnotype/nb-site-identity-contract";


import {TEST_SITE_URL} from "../testing/library";
import {createTestIdentity, type TestIdentity} from "../testing/module";
import {addOAuthUser, authorize, CONSENTED, decodeJwt, grantTokens, registerClient, TEST_REDIRECT_URI, type TestClient} from "../testing/oauth";
import {createOAuthApp} from "./mount";

const NOT_FOUND = {error: {code: "not_found"}};
const FORM = "application/x-www-form-urlencoded";

let identity: TestIdentity;
let client: TestClient;
let cookie: string;
let aliceId: number;

beforeEach(async () => {
    identity = await createTestIdentity("oauth-mount");
    client = await registerClient(identity);
    aliceId = await addOAuthUser(identity, "alice", CONSENTED);
    ({cookie} = await identity.issue(aliceId));
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

    it("百分号编码的写法是本模块的 404、没交给库：各对外端点编码一个字母，前缀里编码一段；原样的写法照旧可达", async () => {
        const query = new URLSearchParams({
            response_type: "code",
            client_id: client.clientId,
            redirect_uri: TEST_REDIRECT_URI,
            scope: "openid",
            state: "s",
            code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
            code_challenge_method: "S256",
        });
        const form = (body: string): RequestInit => ({method: "POST", headers: {"content-type": FORM, authorization: basicAuth(client)}, body});
        // 每项：编码的写法、原样的写法、请求。原样的写法放在一起发，证明编码之外的部分都是可达的请求。
        const cases: ReadonlyArray<readonly [encoded: string, plain: string, init: RequestInit]> = [
            [`/api/identity/auth/oauth2/%61uthorize?${query}`, `${OAUTH_ENDPOINT_PATHS.authorize}?${query}`, {headers: {cookie}}],
            ["/api/identity/auth/oauth2/%74oken", OAUTH_ENDPOINT_PATHS.token, form("grant_type=authorization_code")],
            ["/api/identity/auth/oauth2/%75serinfo", OAUTH_ENDPOINT_PATHS.userinfo, {}],
            ["/api/identity/auth/oauth2/r%65voke", OAUTH_ENDPOINT_PATHS.revoke, form("token=no-such-token")],
            ["/api/identity/auth/jwk%73", OAUTH_ENDPOINT_PATHS.jwks, {}],
            [`/api/identity/%61uth/oauth2/authorize?${query}`, `${OAUTH_ENDPOINT_PATHS.authorize}?${query}`, {headers: {cookie}}],
        ];
        for (const [encoded, plain, init] of cases) {
            const method = init.method ?? "GET";
            expect({encoded, ownNotFound: await isOwnNotFound(await identity.request(encoded, init), method)}).toEqual({encoded, ownNotFound: true});
            expect({plain, ownNotFound: await isOwnNotFound(await identity.request(plain, init), method)}).toEqual({plain, ownNotFound: false});
        }
    });

    it("社交回调只放开放了的上游、只收 GET", async () => {
        // 测试的装配没有开放任何上游；这里另建一个只开放 Google 的挂载层，挂法与入口相同。回调的处理换成回上游名的一个函数：
        // 这条只看挂载层把哪些请求交给它，回调本身由 `social/callback.test.ts` 与合同用例测。
        const app = new Hono();
        app.route(IDENTITY_AUTH_PREFIX, createOAuthApp({
                auth: identity.assembly.auth,
                conn: identity.conn,
                sessions: identity.assembly.sessions,
                clock: identity.clock,
                siteOrigin: TEST_SITE_URL,
                log: identity.log,
                social: {providers: ["google"], callback: (_c, provider) => Promise.resolve(new Response(provider))},
            }));
        const send = (method: string, provider: string) => app.fetch(new Request(`${TEST_SITE_URL}${IDENTITY_AUTH_PREFIX}/callback/${provider}`, {method}));
        const reached = await send("GET", "google");
        expect({status: reached.status, body: await reached.text()}).toEqual({status: 200, body: "google"});
        for (const [method, provider] of [["POST", "google"], ["HEAD", "google"], ["GET", "github"], ["GET", "x"]] as const) {
            expect({method, provider, ownNotFound: await isOwnNotFound(await send(method, provider), method)}).toEqual({method, provider, ownNotFound: true});
        }
        // 没开放上游的装配里谷歌的回调也是 404。
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

describe("授权端点的判断与改写", () => {
    /** 三种发起：浏览器导航的 GET、页面里 `fetch` 的 GET（库对它回 JSON 而不是 302）、表单 POST（别的站点发起）。 */
    const KINDS = ["GET", "fetch", "POST"] as const;

    function params(target: {readonly clientId: string}, extra: Readonly<Record<string, string>> = {}, redirectUri = TEST_REDIRECT_URI): URLSearchParams {
        return new URLSearchParams({
            response_type: "code",
            client_id: target.clientId,
            redirect_uri: redirectUri,
            scope: "openid",
            state: "s",
            code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
            code_challenge_method: "S256",
            ...extra,
        });
    }

    /** 发起授权，回状态与跳转的去处。都带 alice 的会话 Cookie：带着会话也不该跳回不可信的地址。 */
    async function send(kind: (typeof KINDS)[number], query: URLSearchParams | string, headers: Readonly<Record<string, string>> = {cookie}): Promise<{readonly status: number; readonly location: string | null}> {
        const response =
            kind === "POST"
                ? await identity.request(OAUTH_ENDPOINT_PATHS.authorize, {method: "POST", headers: {"content-type": FORM, origin: "https://client.example", ...headers}, body: query.toString()})
                : await identity.request(`${OAUTH_ENDPOINT_PATHS.authorize}?${query}`, {headers: kind === "fetch" ? {"sec-fetch-mode": "cors", ...headers} : headers});
        return {status: response.status, location: response.headers.get("location")};
    }

    const codeOf = (location: string | null, redirectUri = TEST_REDIRECT_URI): string | null =>
        location?.startsWith(`${redirectUri}?`) === true ? new URL(location).searchParams.get("code") : null;

    async function admin(): Promise<string> {
        return (await identity.issue(await identity.addUser("root", {role: "admin", ...CONSENTED}))).cookie;
    }

    function adminSend(adminCookie: string, method: "POST" | "PATCH", path: string, body: unknown): Promise<Response> {
        return identity.fetch(path, {method, headers: {origin: TEST_SITE_URL, "content-type": "application/json", cookie: adminCookie}, body: JSON.stringify(body)});
    }

    it("客户端不对、回调地址不对：不跳回客户端，三种发起都到本站错误页，库的错误页地址不出现（输出 3，验收 4）", async () => {
        const disabled = await registerClient(identity, "admin2");
        expect((await adminSend(await admin(), "PATCH", identityPath.adminOAuthClient(disabled.clientId), {disabled: true})).status).toBe(200);
        const missingClient = params(client);
        missingClient.delete("client_id");
        const cases: ReadonlyArray<readonly [label: string, query: URLSearchParams | string, code: string]> = [
            ["没有这个客户端", params({clientId: "no-such-client"}), "client_not_found"],
            ["停用了", params(disabled), "client_not_found"],
            ["没带客户端", missingClient, "client_not_found"],
            ["客户端出现两次", `${params(client)}&client_id=${client.clientId}`, "client_not_found"],
            ["回调地址没登记", params(client, {}, "https://client.example/other"), "redirect_uri_invalid"],
            ["回调地址带了片段", params(client, {}, `${TEST_REDIRECT_URI}#`), "redirect_uri_invalid"],
            ["回调地址出现两次", `${params(client)}&redirect_uri=${encodeURIComponent(TEST_REDIRECT_URI)}`, "redirect_uri_invalid"],
        ];
        for (const [label, query, code] of cases) {
            for (const kind of KINDS) {
                expect({label, kind, ...(await send(kind, query))}).toEqual({label, kind, status: 302, location: `${OAUTH_PAGES.consent}?error=${code}`});
            }
        }
    });

    it("回调地址可信时库判出的错误跳回客户端，带 state；fetch 发起也回 302，不是库的 JSON", async () => {
        for (const kind of KINDS) {
            const {status, location} = await send(kind, params(client, {scope: "profile"}));
            const back = new URL(location ?? "");
            expect({kind, status, to: `${back.origin}${back.pathname}`, error: back.searchParams.get("error"), state: back.searchParams.get("state")}).toEqual({
                kind,
                status: 302,
                to: TEST_REDIRECT_URI,
                error: "invalid_scope",
                state: "s",
            });
        }
    });

    it("没有会话时三种发起都到 /login?continue=，不是库的签名参数地址", async () => {
        for (const kind of KINDS) {
            const {status, location} = await send(kind, params(client), {});
            const page = new URL(location ?? "", TEST_SITE_URL);
            expect({kind, status, path: page.pathname, params: [...page.searchParams.keys()]}).toEqual({kind, status: 302, path: OAUTH_PAGES.login, params: ["continue"]});
        }
    });

    it("resource 与 claims 交库前去掉：不认得的 resource、不是 JSON 的 claims、要求 acr 的 claims，GET 与 POST 都拿到授权码（输出 3）", async () => {
        const extras: ReadonlyArray<Readonly<Record<string, string>>> = [{resource: "https://unknown.example/api"}, {claims: "not-json"}, {claims: JSON.stringify({id_token: {acr: {essential: true, value: "1"}}})}];
        for (const extra of extras) {
            for (const kind of ["GET", "POST"] as const) {
                const {location} = await send(kind, params(client, extra));
                expect({extra, kind, code: codeOf(location) !== null}).toEqual({extra, kind, code: true});
            }
        }
    });

    it("授权请求带用户信息端点的 resource：换出的访问令牌仍不透明（库按 resource 会发 JWT）", async () => {
        const verifier = "a".repeat(43);
        const challenge = new Bun.CryptoHasher("sha256").update(verifier).digest("base64url");
        const {location} = await send("GET", params(client, {resource: `${TEST_SITE_URL}${OAUTH_ENDPOINT_PATHS.userinfo}`, code_challenge: challenge}));
        const code = codeOf(location);
        if (code === null) throw new Error("expected a code");
        const response = await exchangeViaMount({code, verifier});
        expect(response.status).toBe(200);
        expect(((await response.json()) as {access_token: string}).access_token.split(".")).toHaveLength(1);
    });

    it("POST 改成 GET 交库：带会话 Cookie 而不带 Origin、或 Origin 是别的站点，都与 GET 一样拿到授权码", async () => {
        const noOrigin = await identity.request(OAUTH_ENDPOINT_PATHS.authorize, {method: "POST", headers: {"content-type": FORM, cookie}, body: params(client).toString()});
        expect(codeOf(noOrigin.headers.get("location"))).not.toBeNull();
        expect(codeOf((await send("POST", params(client))).location)).not.toBeNull();
        // POST 时地址上的查询串不算：参数只看表单体（与库对 POST 只读体一致）。
        const queryOnly = await identity.request(`${OAUTH_ENDPOINT_PATHS.authorize}?${params(client)}`, {method: "POST", headers: {"content-type": FORM, cookie}, body: ""});
        expect(queryOnly.headers.get("location")).toBe(`${OAUTH_PAGES.consent}?error=client_not_found`);
    });

    it("公开客户端的 http 回环回调地址不比端口；主机、路径仍逐字比，localhost 与 127.0.0.1 不相等（输出 3）", async () => {
        const created = await adminSend(await admin(), "POST", IDENTITY_PATHS.adminOAuthClients, {name: "本机应用", redirectUris: ["http://127.0.0.1:8123/cb"], type: "public", skipConsent: true});
        expect(created.status).toBe(200);
        const body = await created.json();
        expect(Value.Check(CreateOAuthClientResponse, body)).toBe(true);
        const publicClient = (body as CreateOAuthClientResponse).client;
        for (const redirectUri of ["http://127.0.0.1:8123/cb", "http://127.0.0.1:49152/cb", "http://127.0.0.1/cb"]) {
            const {location} = await send("GET", params(publicClient, {}, redirectUri));
            expect({redirectUri, code: codeOf(location, redirectUri) !== null}).toEqual({redirectUri, code: true});
        }
        for (const redirectUri of ["http://localhost:8123/cb", "http://127.0.0.1:8123/other", "https://127.0.0.1:8123/cb"]) {
            for (const kind of KINDS) {
                expect({redirectUri, kind, ...(await send(kind, params(publicClient, {}, redirectUri)))}).toEqual({redirectUri, kind, status: 302, location: `${OAUTH_PAGES.consent}?error=redirect_uri_invalid`});
            }
        }
        // 机密客户端（库的 `web`）照样逐字比：登记值没有端口变化的余地，换主机大小写也不算。
        expect((await send("GET", params(client, {}, "https://CLIENT.example/cb"))).location).toBe(`${OAUTH_PAGES.consent}?error=redirect_uri_invalid`);
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

    it("带 DPoP 头回 400 invalid_request、不发令牌，码没被用掉（输出 6）", async () => {
        const grant = await authorize(identity, cookie, client);
        const body = new URLSearchParams({grant_type: "authorization_code", code: grant.code, redirect_uri: TEST_REDIRECT_URI, code_verifier: grant.verifier}).toString();
        const response = await identity.request(OAUTH_ENDPOINT_PATHS.token, {method: "POST", headers: {"content-type": FORM, authorization: basicAuth(client), dpop: "a.b.c"}, body});
        expect({status: response.status, cacheControl: response.headers.get("cache-control"), body: await response.json()}).toEqual({status: 400, cacheControl: "no-store", body: {error: "invalid_request"}});
        expect((await exchangeViaMount(grant)).status).toBe(200);
    });
});

describe("用户信息端点", () => {
    async function infoOf(accessToken: string, method: "GET" | "POST" = "GET"): Promise<{readonly status: number; readonly cacheControl: string | null; readonly body: unknown}> {
        const response = await identity.request(OAUTH_ENDPOINT_PATHS.userinfo, {method, headers: {authorization: `Bearer ${accessToken}`}});
        return {status: response.status, cacheControl: response.headers.get("cache-control"), body: await response.json()};
    }

    it("设了头像、库的邮箱已验证列为真时：没有 picture，email_verified 为 false，合合同的形状；GET 与 POST 相同（输出 7）", async () => {
        // 库按 `user.image` 给 `picture`、按 `user.emailVerified` 给 `email_verified`（升级清单“用户信息的字段”一行）。
        await identity.conn.write((tx) => tx.query(`UPDATE "user" SET "image" = 'https://img.example/a.png', "emailVerified" = 1 WHERE "id" = ?`).run(aliceId));
        const {access_token} = await grantTokens(identity, cookie, client);
        const expected = {status: 200, cacheControl: "no-store", body: {sub: String(aliceId), preferred_username: "alice", name: "alice", email_pending: false, email: "alice@example.com", email_verified: false}};
        for (const method of ["GET", "POST"] as const) {
            const info = await infoOf(access_token, method);
            expect({method, ...info}).toEqual({method, ...expected});
            expect(Value.Check(UserInfoResponse, info.body)).toBe(true);
        }
    });

    it("按范围给字段：只有 openid 时只有 sub；有 profile 没有 email 时没有邮箱的几项", async () => {
        const openidOnly = await grantTokens(identity, cookie, client, "openid");
        expect((await infoOf(openidOnly.access_token)).body).toEqual({sub: String(aliceId)});
        const profile = await grantTokens(identity, cookie, client, "openid profile");
        expect((await infoOf(profile.access_token)).body).toEqual({sub: String(aliceId), preferred_username: "alice", name: "alice"});
    });

    it("邮箱待补时只有 email_pending: true，没有 email 与 email_verified", async () => {
        await identity.conn.write((tx) => tx.query(`UPDATE identity_profile SET email_pending = 1 WHERE user_id = ?`).run(aliceId));
        const {access_token} = await grantTokens(identity, cookie, client);
        const info = await infoOf(access_token);
        expect(info.body).toEqual({sub: String(aliceId), preferred_username: "alice", name: "alice", email_pending: true});
        expect(Value.Check(UserInfoResponse, info.body)).toBe(true);
    });

    it("没有令牌与令牌不对都是 401、不许缓存；WWW-Authenticate 只有一个 Bearer 质询、不宣告 DPoP，令牌不对时带 invalid_token；体里的 error 分别是 invalid_request、invalid_token（失败与恢复）", async () => {
        // 以 DPoP 方案带令牌时库只给 DPoP 质询（升级清单“用户信息的字段”一行）：照样只回 Bearer。不带令牌时按 RFC 6750 第 3.1 节
        // 质询里不带错误码，码在体里。
        const cases = [
            ["不带令牌", {}, null, "invalid_request"],
            ["令牌不对", {authorization: "Bearer not-a-token"}, "invalid_token", "invalid_token"],
            ["以 DPoP 方案带令牌", {authorization: "DPoP not-a-token"}, "invalid_token", "invalid_token"],
        ] as const;
        for (const [name, headers, challengeError, bodyError] of cases) {
            const response = await identity.request(OAUTH_ENDPOINT_PATHS.userinfo, {headers});
            const challenge = response.headers.get("www-authenticate") ?? "";
            expect({
                name,
                status: response.status,
                cacheControl: response.headers.get("cache-control"),
                // 质询的方案名是开头的 token，与逗号之后、后面跟空白或行尾的 token（下一个质询）；参数名后面跟的是 `=`。
                schemes: [...challenge.matchAll(/(?:^|,)\s*([A-Za-z][\w-]*)(?=\s+[\w-]+=|\s*,|\s*$)/gu)].map((match) => match[1]),
                dpop: /dpop/iu.test(challenge),
                challengeError: /\berror="([^"]*)"/u.exec(challenge)?.[1] ?? null,
                bodyError: ((await response.json()) as {error?: unknown}).error,
            }).toEqual({name, status: 401, cacheControl: "no-store", schemes: ["Bearer"], dpop: false, challengeError, bodyError});
        }
    });
});

describe("撤销端点", () => {
    function revoke(target: TestClient, form: Readonly<Record<string, string>> | string): Promise<Response> {
        const body = typeof form === "string" ? form : new URLSearchParams(form).toString();
        return identity.request(OAUTH_ENDPOINT_PATHS.revoke, {method: "POST", headers: {"content-type": FORM, authorization: basicAuth(target)}, body});
    }

    async function outcome(response: Response): Promise<{readonly status: number; readonly cacheControl: string | null; readonly body: string}> {
        return {status: response.status, cacheControl: response.headers.get("cache-control"), body: await response.text()};
    }

    it("撤销自己的令牌回 200，之后用户信息得 401；再撤一次、撤不存在的令牌也回 200（输出 10）", async () => {
        const {access_token} = await grantTokens(identity, cookie, client);
        expect(await outcome(await revoke(client, {token: access_token}))).toMatchObject({status: 200, cacheControl: "no-store"});
        expect((await identity.request(OAUTH_ENDPOINT_PATHS.userinfo, {headers: {authorization: `Bearer ${access_token}`}})).status).toBe(401);
        // 库对这两种回 400 invalid_request（升级清单“撤销的回应”一行），模块改成 200。
        expect(await outcome(await revoke(client, {token: access_token}))).toEqual({status: 200, cacheControl: "no-store", body: ""});
        expect(await outcome(await revoke(client, {token: "no-such-token", token_type_hint: "access_token"}))).toEqual({status: 200, cacheControl: "no-store", body: ""});
    });

    it("别的客户端的令牌回 200、不起作用", async () => {
        const other = await registerClient(identity, "admin2");
        const {access_token} = await grantTokens(identity, cookie, client);
        expect(await outcome(await revoke(other, {token: access_token}))).toMatchObject({status: 200, cacheControl: "no-store"});
        expect((await identity.request(OAUTH_ENDPOINT_PATHS.userinfo, {headers: {authorization: `Bearer ${access_token}`}})).status).toBe(200);
    });

    it("不带 token、token 为空、带两个 token 都回 400 invalid_request（输出 10）", async () => {
        const {access_token} = await grantTokens(identity, cookie, client);
        for (const form of ["", "token=", "token=a&token=b"]) {
            const response = await revoke(client, form);
            expect({form, status: response.status, cacheControl: response.headers.get("cache-control"), error: ((await response.json()) as {error: string}).error}).toEqual({form, status: 400, cacheControl: "no-store", error: "invalid_request"});
        }
        // 都没撤掉什么。
        expect((await identity.request(OAUTH_ENDPOINT_PATHS.userinfo, {headers: {authorization: `Bearer ${access_token}`}})).status).toBe(200);
    });

    it("客户端认证参数不合格回 400 invalid_request、不改写成 200，令牌没被撤：client_id 或 client_secret 出现多次、Basic 又在表单里带密钥", async () => {
        const {access_token} = await grantTokens(identity, cookie, client);
        const token = `token=${encodeURIComponent(access_token)}`;
        const post = (headers: Readonly<Record<string, string>>, body: string) => identity.request(OAUTH_ENDPOINT_PATHS.revoke, {method: "POST", headers: {"content-type": FORM, ...headers}, body});
        const cases: ReadonlyArray<readonly [label: string, headers: Readonly<Record<string, string>>, body: string]> = [
            ["client_id 两次、没带密钥", {}, `${token}&client_id=${client.clientId}&client_id=${client.clientId}`],
            ["client_secret 两次", {}, `${token}&client_id=${client.clientId}&client_secret=${client.clientSecret}&client_secret=${client.clientSecret}`],
            ["Basic 加表单里的 client_secret", {authorization: basicAuth(client)}, `${token}&client_secret=${client.clientSecret}`],
        ];
        const results = [];
        for (const [label, headers, body] of cases) {
            const response = await post(headers, body);
            // 读成文本再比：被改写成 200 时体是空的，`json()` 会抛，看不出回了什么。
            results.push({label, status: response.status, cacheControl: response.headers.get("cache-control"), body: await response.text()});
        }
        expect(results).toEqual(cases.map(([label]) => ({label, status: 400, cacheControl: "no-store", body: JSON.stringify({error: "invalid_request"})})));
        expect((await identity.request(OAUTH_ENDPOINT_PATHS.userinfo, {headers: {authorization: `Bearer ${access_token}`}})).status).toBe(200);
        // 空值不算出现（与库一致）：多一个空的 client_id 照常撤。
        expect((await post({authorization: basicAuth(client)}, `${token}&client_id=&client_id=${client.clientId}`)).status).toBe(200);
        expect((await identity.request(OAUTH_ENDPOINT_PATHS.userinfo, {headers: {authorization: `Bearer ${access_token}`}})).status).toBe(401);
    });

    it("客户端认证不过回 401 invalid_client，不改写成 200", async () => {
        const response = await revoke({clientId: client.clientId, clientSecret: "wrong"}, {token: "no-such-token"});
        expect({status: response.status, error: ((await response.json()) as {error: string}).error}).toEqual({status: 401, error: "invalid_client"});
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
