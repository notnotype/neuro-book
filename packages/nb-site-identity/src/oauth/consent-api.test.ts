/**
 * 授权确认页的接口（`oauth/consent-api.ts`；`site.oauth-provider` 输出 14、时序一节）。确认标识都取自授权端点真实给的
 * `/oauth/consent?request=`，客户端的停用与改回调地址经管理接口。
 *
 * 这里另测合同测试造不出的一种先后：接口判完客户端、库还没判之间客户端被停用或回调地址被改（经 `wrapOAuthConsent` 在交库之前
 * 插入改动，交库的仍是真的库）。
 */

import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {Value} from "typebox/value";

import {CreateOAuthClientResponse, IDENTITY_PATHS, identityPath, OAUTH_ENDPOINT_PATHS, OAUTH_PAGES, OAuthAuthorizationResponse, OAuthDecisionResponse} from "@notnotype/nb-site-identity-contract";

import {TEST_SITE_URL} from "../testing/library";
import {createTestIdentity, type TestIdentity} from "../testing/module";
import {addOAuthUser, CONSENTED, decodeJwt, registerClient, TEST_REDIRECT_URI, type TestClient} from "../testing/oauth";
import {CONTINUE_LIFETIME_MS} from "./continue";

const FORM = "application/x-www-form-urlencoded";
const VERIFIER = "v".repeat(43);

let identity: TestIdentity;
let client: TestClient;
let alice: {readonly userId: number; readonly cookie: string};
let adminCookie: string;
/** 交库之前插入的动作；每个用例之后清掉。 */
let beforeLibrary: (() => Promise<void>) | null = null;

beforeEach(async () => {
    identity = await createTestIdentity("oauth-consent-api", {
        overrides: {
            wrapOAuthConsent: (decide) => async (accept, signedQuery, cookie) => {
                await beforeLibrary?.();
                return decide(accept, signedQuery, cookie);
            },
        },
    });
    client = await registerClient(identity, "admin", {skipConsent: false});
    const userId = await addOAuthUser(identity, "alice", CONSENTED);
    alice = {userId, cookie: (await identity.issue(userId)).cookie};
    adminCookie = (await identity.issue(await identity.addUser("root", {role: "admin", ...CONSENTED}))).cookie;
});

afterEach(async () => {
    beforeLibrary = null;
    await identity.assembly.close();
    await identity.root.cleanup();
});

function adminSend(method: "POST" | "PATCH", path: string, body: unknown): Promise<Response> {
    return identity.fetch(path, {method, headers: {origin: TEST_SITE_URL, "content-type": "application/json", cookie: adminCookie}, body: JSON.stringify(body)});
}

async function patchClient(target: {readonly clientId: string}, body: unknown): Promise<void> {
    expect((await adminSend("PATCH", identityPath.adminOAuthClient(target.clientId), body)).status).toBe(200);
}

/** 带 `cookie` 发起授权，回确认页地址上的确认标识，并夹住库签名的时刻（库按系统时间签）。 */
async function consentRequest(
    target: {readonly clientId: string} = client,
    options: {readonly cookie?: string; readonly redirectUri?: string; readonly scope?: string} = {},
): Promise<{readonly request: string; readonly signedAfter: number; readonly signedBefore: number}> {
    const query = new URLSearchParams({
        response_type: "code",
        client_id: target.clientId,
        redirect_uri: options.redirectUri ?? TEST_REDIRECT_URI,
        scope: options.scope ?? "openid profile email",
        state: "st",
        code_challenge: new Bun.CryptoHasher("sha256").update(VERIFIER).digest("base64url"),
        code_challenge_method: "S256",
    });
    const signedAfter = Date.now();
    const response = await identity.request(`${OAUTH_ENDPOINT_PATHS.authorize}?${query}`, {headers: {cookie: options.cookie ?? alice.cookie}});
    const signedBefore = Date.now();
    const location = new URL(response.headers.get("location") ?? "", TEST_SITE_URL);
    expect({status: response.status, path: location.pathname}).toEqual({status: 302, path: OAUTH_PAGES.consent});
    const request = location.searchParams.get("request");
    if (request === null) throw new Error("the consent redirect carries no request");
    return {request, signedAfter, signedBefore};
}

async function outcome(response: Response): Promise<{readonly status: number; readonly body: unknown}> {
    return {status: response.status, body: await response.json()};
}

function show(request: string, cookie: string | null = alice.cookie): Promise<Response> {
    return identity.fetch(`${IDENTITY_PATHS.oauthAuthorization}?${new URLSearchParams({request})}`, {headers: cookie === null ? {} : {cookie}});
}

function decide(request: string, accept: boolean, cookie: string | null = alice.cookie): Promise<Response> {
    return identity.fetch(IDENTITY_PATHS.oauthAuthorization, {
        method: "POST",
        headers: {origin: TEST_SITE_URL, "content-type": "application/json", ...(cookie === null ? {} : {cookie})},
        body: JSON.stringify({request, accept}),
    });
}

/** 提交并回跳回地址。 */
async function redirectAfter(request: string, accept: boolean, cookie?: string): Promise<URL> {
    const response = await decide(request, accept, cookie);
    const body = await response.json();
    expect({status: response.status, shape: Value.Check(OAuthDecisionResponse, body)}).toEqual({status: 200, shape: true});
    return new URL((body as OAuthDecisionResponse).redirectUrl);
}

function exchange(code: string): Promise<Response> {
    return identity.request(OAUTH_ENDPOINT_PATHS.token, {
        method: "POST",
        headers: {"content-type": FORM, authorization: `Basic ${Buffer.from(`${client.clientId}:${client.clientSecret}`).toString("base64")}`},
        body: new URLSearchParams({grant_type: "authorization_code", code, redirect_uri: TEST_REDIRECT_URI, code_verifier: VERIFIER}).toString(),
    });
}

const failure = (status: number, code: string) => ({status, body: {error: {code}}});

describe("GET oauth/authorization", () => {
    it("回客户端名字、回调地址的主机名与要的范围（输出 14）", async () => {
        const {request} = await consentRequest(client, {scope: "openid email"});
        const response = await show(request);
        const body = await response.json();
        expect(Value.Check(OAuthAuthorizationResponse, body)).toBe(true);
        expect({status: response.status, body}).toEqual({status: 200, body: {clientName: "测试客户端", redirectHost: "client.example", scopes: ["openid", "email"]}});
    });

    it("回调地址带非缺省端口时主机名连同端口", async () => {
        const created = await adminSend("POST", IDENTITY_PATHS.adminOAuthClients, {name: "带端口", redirectUris: ["https://client.example:8443/cb"], type: "confidential", skipConsent: false});
        const withPort = ((await created.json()) as CreateOAuthClientResponse).client;
        const {request} = await consentRequest(withPort, {redirectUri: "https://client.example:8443/cb"});
        expect(((await (await show(request)).json()) as OAuthAuthorizationResponse).redirectHost).toBe("client.example:8443");
    });
});

describe("POST oauth/authorization", () => {
    it("同意带授权码跳回、拒绝带 access_denied 跳回，都带 state 与 iss；同一个标识拒绝后再同意拿到码，再同意一次再发一个码，前一个不作废，各自只能换一次", async () => {
        const {request} = await consentRequest();
        const denied = await redirectAfter(request, false);
        expect({to: `${denied.origin}${denied.pathname}`, error: denied.searchParams.get("error"), state: denied.searchParams.get("state"), iss: denied.searchParams.get("iss")}).toEqual({
            to: TEST_REDIRECT_URI,
            error: "access_denied",
            state: "st",
            iss: TEST_SITE_URL,
        });
        const first = await redirectAfter(request, true);
        const second = await redirectAfter(request, true);
        const codes = [first.searchParams.get("code"), second.searchParams.get("code")];
        expect(codes.every((code) => code !== null)).toBe(true);
        expect(codes[0]).not.toBe(codes[1]);
        expect([first.searchParams.get("state"), first.searchParams.get("iss")]).toEqual(["st", TEST_SITE_URL]);
        // 先换后发的那个，再换先发的那个：再次同意不让前一个作废（输出 14）；各自再换一次都被拒（输出 6）。
        const results = [];
        for (const code of [codes[1]!, codes[0]!, codes[1]!, codes[0]!]) {
            const response = await exchange(code);
            results.push(response.status === 200 ? "ok" : ((await response.json()) as {error?: unknown}).error);
        }
        expect(results).toEqual(["ok", "ok", "invalid_grant", "invalid_grant"]);
    });

    it("确认标识不绑定会话：别的账号提交时按提交时的会话算，换出的 id_token 是他的", async () => {
        const {request} = await consentRequest();
        const bobId = await addOAuthUser(identity, "bob", CONSENTED);
        const {cookie: bob} = await identity.issue(bobId);
        const code = (await redirectAfter(request, true, bob)).searchParams.get("code");
        if (code === null) throw new Error("expected a code");
        const tokens = (await (await exchange(code)).json()) as {id_token: string};
        expect(decodeJwt(tokens.id_token).payload.sub).toBe(String(bobId));
    });
});

describe("两个接口共同的判断", () => {
    it("被篡改的标识：GET、同意、拒绝都回 410 authorization_expired", async () => {
        const {request} = await consentRequest();
        const tampered = Buffer.from(Buffer.from(request, "base64url").toString("utf8").replace("state=st", "state=xx"), "utf8").toString("base64url");
        for (const response of [await show(tampered), await decide(tampered, true), await decide(tampered, false), await show("not a token")]) {
            expect(await outcome(response)).toEqual(failure(410, "authorization_expired"));
        }
    });

    it("按模块时钟签名起 10 分钟内可用，再过 1 毫秒 GET、同意、拒绝都回 410", async () => {
        const {request, signedAfter, signedBefore} = await consentRequest();
        identity.clock.set(signedAfter + CONTINUE_LIFETIME_MS);
        expect((await show(request)).status).toBe(200);
        identity.clock.set(signedBefore + CONTINUE_LIFETIME_MS + 1);
        for (const response of [await show(request), await decide(request, true), await decide(request, false)]) expect(await outcome(response)).toEqual(failure(410, "authorization_expired"));
    });

    it("GET 与 POST 之间客户端被停用：GET、同意、拒绝都回 404 client_not_found，不给跳回地址", async () => {
        const {request} = await consentRequest();
        await patchClient(client, {disabled: true});
        for (const response of [await show(request), await decide(request, true), await decide(request, false)]) expect(await outcome(response)).toEqual(failure(404, "client_not_found"));
    });

    it("GET 与 POST 之间回调地址被改得不再匹配：GET、同意、拒绝都回 400 redirect_uri_invalid", async () => {
        const {request} = await consentRequest();
        await patchClient(client, {redirectUris: ["https://client.example/new"]});
        for (const response of [await show(request), await decide(request, true), await decide(request, false)]) expect(await outcome(response)).toEqual(failure(400, "redirect_uri_invalid"));
    });

    it("接口判完、库还没判时才停用或改回调地址：同意与拒绝回的码与先改时相同（计划 3.9）", async () => {
        const changes = [
            ["停用", {disabled: true}, failure(404, "client_not_found")],
            ["改回调地址", {redirectUris: ["https://client.example/new"]}, failure(400, "redirect_uri_invalid")],
        ] as const;
        let index = 0;
        for (const [label, change, expected] of changes) {
            for (const accept of [true, false]) {
                index += 1;
                const target = await registerClient(identity, `admin${index}`, {skipConsent: false});
                const {request} = await consentRequest(target);
                beforeLibrary = () => patchClient(target, change);
                const response = await decide(request, accept);
                beforeLibrary = null;
                expect({label, accept, ...(await outcome(response))}).toEqual({label, accept, ...expected});
            }
        }
        // 库给的是它的错误页（同意时 `client_disabled`、`invalid_redirect`，拒绝时 `access_denied`），码都由第 1 步重判得出，不落到表外。
        expect(identity.log.lines.filter((line) => line.event === "identity.oauth_library_error_page")).toEqual([]);
    });

    it("要会话且受同意门槛约束：打开确认页之后站点同意失效，GET、同意、拒绝都回 403 consent_required；没有会话回 401", async () => {
        const {request} = await consentRequest();
        for (const response of [await show(request, null), await decide(request, true, null)]) expect(await outcome(response)).toEqual(failure(401, "unauthenticated"));
        // 库给确认页的签名参数带着发起的会话 id，同一会话提交时库不再判站点同意（升级清单“确认标识带发起会话”一行）：挡住它的只有接口这一道。
        await identity.conn.write((tx) => tx.query(`DELETE FROM identity_consent WHERE user_id = ?`).run(alice.userId));
        for (const response of [await show(request), await decide(request, true), await decide(request, false)]) expect(await outcome(response)).toEqual(failure(403, "consent_required"));
    });
});
