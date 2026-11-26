/**
 * 授权端点交库之前的第 2、3 步与站点同意（`oauth/authorize-request.ts`、`oauth/mount.ts` 的 `authorizeEndpoint`、`auth.ts` 的
 * `postLogin`；`site.oauth-provider` 输出 3、12、13，验收 21、22）。都经挂载层（`TestIdentity.request`），交的是真的库。
 *
 * 模块时钟与库的系统时间在这里起点相同；判 `max_age` 与会话到期的用例只拨模块的时钟，库按系统时间判不出，看到的结果来自第 3 步。
 */

import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {Value} from "typebox/value";

import {CONTINUE_PARAM, ConsentResponse, IDENTITY_PATHS, LoginResponse, OAUTH_ENDPOINT_PATHS, OAUTH_PAGES} from "@notnotype/nb-site-identity-contract";

import {TEST_SITE_URL} from "../testing/library";
import {createTestIdentity, sessionCookieOf, TEST_CONFIG, TEST_TERMS_VERSION, type TestIdentity} from "../testing/module";
import {addOAuthUser, CONSENTED, decodeJwt, registerClient, TEST_REDIRECT_URI, type TestClient} from "../testing/oauth";

const FORM = "application/x-www-form-urlencoded";
const VERIFIER = "v".repeat(43);
const CHALLENGE = new Bun.CryptoHasher("sha256").update(VERIFIER).digest("base64url");
const PASSWORD = "correct horse battery";
const DAY_MS = 86_400_000;

let identity: TestIdentity;
let client: TestClient;
/** 有当前条款同意的账号。 */
let alice: {readonly userId: number; readonly cookie: string};
/** 没有同意记录的账号：授权时库的 `postLogin` 带他去站点的同意页。 */
let bob: {readonly userId: number; readonly cookie: string};

beforeEach(async () => {
    identity = await createTestIdentity("oauth-authorize-request");
    client = await registerClient(identity);
    const aliceId = await addOAuthUser(identity, "alice", {...CONSENTED, password: PASSWORD});
    alice = {userId: aliceId, cookie: (await identity.issue(aliceId)).cookie};
    const bobId = await addOAuthUser(identity, "bob", {password: PASSWORD});
    bob = {userId: bobId, cookie: (await identity.issue(bobId)).cookie};
});

afterEach(async () => {
    await identity.assembly.close();
    await identity.root.cleanup();
});

function params(extra: Readonly<Record<string, string>> = {}): URLSearchParams {
    return new URLSearchParams({
        response_type: "code",
        client_id: client.clientId,
        redirect_uri: TEST_REDIRECT_URI,
        scope: "openid profile email",
        state: "s",
        code_challenge: CHALLENGE,
        code_challenge_method: "S256",
        ...extra,
    });
}

/** 把 `state` 加长到查询串恰好 `length` 个字符。 */
function ofLength(query: URLSearchParams, length: number): string {
    const padded = new URLSearchParams(query);
    padded.set("state", "");
    padded.set("state", "a".repeat(length - padded.toString().length));
    const text = padded.toString();
    if (text.length !== length) throw new Error(`could not pad the query to ${length} characters`);
    return text;
}

/** 三种发起：浏览器导航的 GET、页面里 `fetch` 的 GET、别的站点的表单 POST。 */
const KINDS = ["GET", "fetch", "POST"] as const;

interface Outcome {
    readonly status: number;
    readonly location: string;
    readonly setCookies: string[];
}

async function send(kind: (typeof KINDS)[number], query: URLSearchParams | string, cookie: string | null): Promise<Outcome> {
    const headers: Record<string, string> = cookie === null ? {} : {cookie};
    const response =
        kind === "POST"
            ? await identity.request(OAUTH_ENDPOINT_PATHS.authorize, {method: "POST", headers: {"content-type": FORM, origin: "https://client.example", ...headers}, body: query.toString()})
            : await identity.request(`${OAUTH_ENDPOINT_PATHS.authorize}?${query}`, {headers: kind === "fetch" ? {"sec-fetch-mode": "cors", ...headers} : headers});
    return {status: response.status, location: response.headers.get("location") ?? "", setCookies: response.headers.getSetCookie()};
}

/** 跳回客户端时地址里的几项；不是跳回客户端时 `to` 是站内页面的路径。错误与码都该在查询串里，`hash` 记着片段。 */
function where(location: string): {readonly to: string; readonly error: string | null; readonly state: string | null; readonly iss: string | null; readonly code: boolean; readonly hash: string} {
    const url = new URL(location, TEST_SITE_URL);
    const to = url.origin === TEST_SITE_URL ? url.pathname : `${url.origin}${url.pathname}`;
    return {to, error: url.searchParams.get("error"), state: url.searchParams.get("state"), iss: url.searchParams.get("iss"), code: url.searchParams.has("code"), hash: url.hash};
}

const backWith = (error: string) => ({to: TEST_REDIRECT_URI, error, state: "s", iss: TEST_SITE_URL, code: false, hash: ""});
const backWithCode = {to: TEST_REDIRECT_URI, error: null, state: "s", iss: TEST_SITE_URL, code: true, hash: ""};
const page = (path: string) => ({to: path, error: null, state: null, iss: null, code: false, hash: ""});

/** 站内页面地址上的续接令牌。 */
function continueOf(location: string): string {
    const token = new URL(location, TEST_SITE_URL).searchParams.get(CONTINUE_PARAM);
    if (token === null) throw new Error(`no continue token in ${location}`);
    return token;
}

async function login(username: string, token: string): Promise<{readonly continueUrl: string; readonly cookie: string}> {
    const response = await identity.fetch(IDENTITY_PATHS.login, {
        method: "POST",
        headers: {origin: TEST_SITE_URL, "content-type": "application/json"},
        body: JSON.stringify({identifier: username, password: PASSWORD, continue: token}),
    });
    const body = await response.json();
    expect({status: response.status, shape: Value.Check(LoginResponse, body)}).toEqual({status: 200, shape: true});
    const {continueUrl} = body as LoginResponse;
    if (continueUrl === undefined) throw new Error("the login answer has no continueUrl");
    return {continueUrl, cookie: sessionCookieOf(response.headers.getSetCookie())};
}

async function submitConsent(cookie: string, token: string): Promise<string> {
    const response = await identity.fetch(IDENTITY_PATHS.meConsent, {
        method: "POST",
        headers: {origin: TEST_SITE_URL, "content-type": "application/json", cookie},
        body: JSON.stringify({termsVersion: TEST_TERMS_VERSION, overseasStorage: true, continue: token}),
    });
    const body = await response.json();
    expect({status: response.status, shape: Value.Check(ConsentResponse, body)}).toEqual({status: 200, shape: true});
    const {continueUrl} = body as ConsentResponse;
    if (continueUrl === undefined) throw new Error("the consent answer has no continueUrl");
    return continueUrl;
}

/** 带会话去继续地址，回跳转的去处。 */
async function follow(continueUrl: string, cookie: string): Promise<string> {
    const response = await identity.request(continueUrl, {headers: {cookie}});
    expect(response.status).toBe(302);
    return response.headers.get("location") ?? "";
}

describe("第 2 步：交库之前挡下的参数", () => {
    it("合同要拒的参数跳回客户端，错误码在查询串里、带 state 与 iss；三种发起相同（输出 3、13，验收 22）", async () => {
        const repeated = (name: string, first: string, second: string) => `${params({[name]: first})}&${name}=${second}`;
        const withoutResponseType = params();
        withoutResponseType.delete("response_type");
        const cases: ReadonlyArray<readonly [label: string, query: URLSearchParams | string, error: string]> = [
            ["request", params({request: "a.b.c"}), "request_not_supported"],
            ["request_uri", params({request_uri: "urn:example:x"}), "request_uri_not_supported"],
            ["request 与 request_uri 都带", params({request: "a.b.c", request_uri: "urn:example:x"}), "request_not_supported"],
            // 库对这一种把错误放在片段里（升级清单“授权请求的参数”一行）。
            ["response_type=token", params({response_type: "token"}), "unsupported_response_type"],
            ["response_type=code id_token", params({response_type: "code id_token"}), "unsupported_response_type"],
            ["没有 response_type", withoutResponseType, "invalid_request"],
            ["response_type 两个", repeated("response_type", "code", "code"), "invalid_request"],
            // 库对这一种照样把码放进查询串。
            ["response_mode=fragment", params({response_mode: "fragment"}), "invalid_request"],
            ["response_mode=form_post", params({response_mode: "form_post"}), "invalid_request"],
            ["response_mode 两个", repeated("response_mode", "query", "query"), "invalid_request"],
            ["prompt=create", params({prompt: "create"}), "invalid_request"],
            ["prompt=select_account", params({prompt: "select_account"}), "invalid_request"],
            ["prompt=none consent", params({prompt: "none consent"}), "invalid_request"],
            ["prompt=none login", params({prompt: "none login"}), "invalid_request"],
            ["prompt 是空串", params({prompt: ""}), "invalid_request"],
            ["prompt 两个", repeated("prompt", "login", "consent"), "invalid_request"],
        ];
        for (const [label, query, error] of cases) {
            for (const kind of KINDS) {
                const {status, location} = await send(kind, query, alice.cookie);
                expect({label, kind, status, ...where(location)}).toEqual({label, kind, status: 302, ...backWith(error)});
            }
        }
    });

    it("合格的 prompt 与 response_mode=query 照常：login consent 去登录页，query 拿到码", async () => {
        expect(where((await send("GET", params({prompt: "login consent"}), alice.cookie)).location)).toEqual(page(OAUTH_PAGES.login));
        expect(where((await send("GET", params({response_mode: "query"}), alice.cookie)).location)).toEqual(backWithCode);
        // 空格多几个也是同一组值。
        expect(where((await send("GET", params({prompt: " consent  "}), alice.cookie)).location)).toEqual(page(OAUTH_PAGES.consent));
    });

    it("客户端或回调地址不对时先回本站错误页，不看别的参数", async () => {
        const {location} = await send("GET", params({client_id: "no-such-client", request: "a.b.c", response_mode: "fragment"}), alice.cookie);
        expect(location).toBe(`${OAUTH_PAGES.consent}?error=client_not_found`);
    });

    it("查询串与表单体正好 4096 个字符拿到码，4097 个字符跳回 invalid_request（验收 21）", async () => {
        for (const kind of KINDS) {
            expect({kind, ...where((await send(kind, ofLength(params(), 4096), alice.cookie)).location)}).toEqual({kind, ...backWithCode, state: expect.any(String)});
            expect({kind, ...where((await send(kind, ofLength(params(), 4097), alice.cookie)).location)}).toEqual({kind, ...backWith("invalid_request"), state: expect.any(String)});
        }
    });

    it("原样不到 4096 个字符、重新编码后超过的也跳回 invalid_request：库签名的是重新编码的写法", async () => {
        // `/` 原样不编码时一个字符，重新编码后是 `%2F`。
        const base = params();
        base.delete("state");
        const raw = `${base}&state=${"/".repeat(4000 - base.toString().length - "&state=".length)}`;
        expect(raw.length).toBe(4000);
        expect(where((await send("GET", raw, alice.cookie)).location)).toMatchObject({to: TEST_REDIRECT_URI, error: "invalid_request", code: false});
    });

    it("4096 个字符里有几百个不认得的参数名：登录之后照样续接、拿到码（续接令牌不因长度丢掉）", async () => {
        const query = params();
        for (let index = 0; query.toString().length < 4000; index += 1) query.append(`x${index.toString(36)}`, "");
        const text = ofLength(query, 4096);
        const {location} = await send("GET", text, null);
        expect(where(location)).toEqual(page(OAUTH_PAGES.login));
        const {continueUrl, cookie} = await login("alice", continueOf(location));
        expect(where(await follow(continueUrl, cookie))).toMatchObject({to: TEST_REDIRECT_URI, code: true});
    });

    it("带 essential acr 的 claims 与不带时结果相同：没有会话去登录页、有会话拿到码（输出 3）", async () => {
        const claims = JSON.stringify({id_token: {acr: {essential: true, value: "1"}}});
        for (const cookie of [null, alice.cookie]) {
            const plain = where((await send("GET", params(), cookie)).location);
            const withClaims = where((await send("GET", params({claims}), cookie)).location);
            expect({cookie: cookie !== null, ...withClaims}).toEqual({cookie: cookie !== null, ...plain});
        }
    });
});

describe("第 3 步与站点同意", () => {
    it("缺站点同意时的先后：先登录与 max_age，再站点同意，再确认页；prompt=none 时跳回 interaction_required（输出 12、13）", async () => {
        // 已登录、缺同意：去站点同意页。
        expect(where((await send("GET", params(), bob.cookie)).location)).toEqual(page(OAUTH_PAGES.siteConsent));
        expect(where((await send("GET", params({prompt: "none"}), bob.cookie)).location)).toEqual(backWith("interaction_required"));
        // 要重新登录的先于站点同意。
        expect(where((await send("GET", params({prompt: "login"}), bob.cookie)).location)).toEqual(page(OAUTH_PAGES.login));
        identity.clock.advance(61_000);
        expect(where((await send("GET", params({max_age: "60"}), bob.cookie)).location)).toEqual(page(OAUTH_PAGES.login));
        // 站点同意先于确认页：免确认的客户端带 prompt=consent 也先去站点同意页。
        expect(where((await send("GET", params({prompt: "consent"}), bob.cookie)).location)).toEqual(page(OAUTH_PAGES.siteConsent));
    });

    it("补交同意带续接令牌：继续地址回到授权端点拿到码；prompt=consent 时接着去确认页", async () => {
        const plain = await send("GET", params(), bob.cookie);
        expect(where(await follow(await submitConsent(bob.cookie, continueOf(plain.location)), bob.cookie))).toEqual(backWithCode);

        await identity.conn.write((tx) => tx.query(`DELETE FROM identity_consent WHERE user_id = ?`).run(bob.userId));
        const consent = await send("GET", params({prompt: "consent"}), bob.cookie);
        expect(where(await follow(await submitConsent(bob.cookie, continueOf(consent.location)), bob.cookie))).toEqual(page(OAUTH_PAGES.consent));
    });

    it("会话在 max_age 之内时去站点同意页；补交花的时间让会话超过 max_age 也不再要求登录，续接拿到码（输出 12、13）", async () => {
        identity.clock.advance(50_000);
        const {location} = await send("GET", params({max_age: "100"}), bob.cookie);
        expect(where(location)).toEqual(page(OAUTH_PAGES.siteConsent));
        // 在站点同意页上停过 max_age 剩下的 50 秒：发起时已满足的 max_age 不因补交花的时间再要求登录（输出 12）。
        identity.clock.advance(60_000);
        expect(where(await follow(await submitConsent(bob.cookie, continueOf(location)), bob.cookie))).toEqual(backWithCode);
    });

    it("max_age 按模块的时钟：会话建立以来超过它就去登录页，没超过拿到码；登录后续接拿到码、auth_time 是新会话的时刻（输出 13）", async () => {
        identity.clock.advance(100_000);
        expect(where((await send("GET", params({max_age: "100"}), alice.cookie)).location)).toEqual(backWithCode);
        identity.clock.advance(1);
        const {location, setCookies} = await send("GET", params({max_age: "100"}), alice.cookie);
        expect(where(location)).toEqual(page(OAUTH_PAGES.login));
        // 会话本身还有效：不清它的 Cookie。
        expect(setCookies).toEqual([]);

        identity.clock.advance(5_000);
        const loggedInAt = identity.clock.now();
        const {continueUrl, cookie} = await login("alice", continueOf(location));
        const back = new URL(await follow(continueUrl, cookie));
        const code = back.searchParams.get("code");
        if (code === null) throw new Error("expected a code");
        const response = await identity.request(OAUTH_ENDPOINT_PATHS.token, {
            method: "POST",
            headers: {"content-type": FORM, authorization: `Basic ${Buffer.from(`${client.clientId}:${client.clientSecret}`).toString("base64")}`},
            body: new URLSearchParams({grant_type: "authorization_code", code, redirect_uri: TEST_REDIRECT_URI, code_verifier: VERIFIER}).toString(),
        });
        expect(response.status).toBe(200);
        const {id_token} = (await response.json()) as {id_token: string};
        expect(decodeJwt(id_token).payload.auth_time).toBe(Math.floor(loggedInAt / 1000));
    });

    it("按模块的时钟已到期的会话当作没有会话：去登录页并清 Cookie；prompt=none 时跳回 login_required", async () => {
        identity.clock.advance(TEST_CONFIG.sessionDays * DAY_MS);
        expect(where((await send("GET", params({prompt: "none"}), alice.cookie)).location)).toEqual(backWith("login_required"));
        const {location, setCookies} = await send("GET", params(), alice.cookie);
        expect(where(location)).toEqual(page(OAUTH_PAGES.login));
        // 第一次读时已删掉到期的行、清了 Cookie；这一次库查不到会话，模块仍清这个没用的 Cookie。
        expect(setCookies.some((cookie) => /max-age=0/iu.test(cookie))).toBe(true);
    });
});
