/**
 * 续接（`oauth/continue.ts`）与登录带 `continue`（`site.oauth-provider` 输出 4、13 的 `prompt=login`、时序一节；`site.accounts`
 * 输出 4）。令牌都取自授权端点真实给的 `/login?continue=`，经挂载层（`TestIdentity.request`）。
 *
 * 10 分钟的边界按授权请求前后的系统时间夹出来：库按系统时间写签名时刻，用例不读令牌里的字段（令牌对浏览器不透明，边界与兼容一节）。
 */

import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {Value} from "typebox/value";

import {CONTINUE_PARAM, LoginResponse, OAUTH_ENDPOINT_PATHS, OAUTH_PAGES} from "@notnotype/nb-site-identity-contract";

import {TEST_SITE_URL} from "../testing/library";
import {createTestIdentity, sessionCookieOf, type TestIdentity} from "../testing/module";
import {addOAuthUser, CONSENTED, registerClient, TEST_REDIRECT_URI, type TestClient} from "../testing/oauth";
import {CONTINUE_LIFETIME_MS, MAX_CONTINUE_TOKEN_LENGTH, resolveContinue} from "./continue";

/** 库加的五个签名字段（升级清单“续接的签名参数”一行）；照计划 3.7 写成字面量，不从实现取。 */
const SIGNED_FIELDS = ["sig", "exp", "ba_iat", "ba_pl", "ba_param"] as const;

const PASSWORD = "correct horse battery";

let identity: TestIdentity;
let client: TestClient;
let secret: string;

beforeEach(async () => {
    identity = await createTestIdentity("oauth-continue");
    client = await registerClient(identity);
    secret = (await identity.assembly.auth.$context).secret;
    await addOAuthUser(identity, "alice", {...CONSENTED, password: PASSWORD});
});

afterEach(async () => {
    await identity.assembly.close();
    await identity.root.cleanup();
});

function authorizeParams(extra: Readonly<Record<string, string>> = {}): URLSearchParams {
    return new URLSearchParams({
        response_type: "code",
        client_id: client.clientId,
        redirect_uri: TEST_REDIRECT_URI,
        scope: "openid profile",
        state: "st",
        code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
        code_challenge_method: "S256",
        ...extra,
    });
}

/** 没有会话时发起授权，回登录页地址上的续接令牌，并夹住库签名的时刻。 */
async function continueToken(params: URLSearchParams): Promise<{readonly token: string; readonly signedAfter: number; readonly signedBefore: number}> {
    const signedAfter = Date.now();
    const response = await identity.request(`${OAUTH_ENDPOINT_PATHS.authorize}?${params}`);
    const signedBefore = Date.now();
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") ?? "", TEST_SITE_URL);
    expect(location.pathname).toBe(OAUTH_PAGES.login);
    const token = location.searchParams.get(CONTINUE_PARAM);
    if (token === null) throw new Error("the login redirect carries no continue token");
    return {token, signedAfter, signedBefore};
}

function login(body: Readonly<Record<string, unknown>>): Promise<Response> {
    return identity.fetch("/login", {method: "POST", headers: {origin: TEST_SITE_URL, "content-type": "application/json"}, body: JSON.stringify({identifier: "alice", password: PASSWORD, ...body})});
}

function sortedEntries(params: URLSearchParams): string[][] {
    return [...params].map(([name, value]) => [name, value]).sort((a, b) => (a.join("=") < b.join("=") ? -1 : 1));
}

/** 跟着继续地址带会话 Cookie 回到授权端点，回跳转的去处。 */
async function follow(continueUrl: string, cookie: string): Promise<URL> {
    const response = await identity.request(continueUrl, {headers: {cookie}});
    expect(response.status).toBe(302);
    return new URL(response.headers.get("location") ?? "", TEST_SITE_URL);
}

describe("登录带续接令牌", () => {
    it("合格时响应带继续地址：回到授权端点、参数与发起时相同、不含五个签名字段，去那里拿到授权码（输出 4，验收 13）", async () => {
        const params = authorizeParams();
        const {token} = await continueToken(params);
        const response = await login({continue: token});
        expect(response.status).toBe(200);
        const body = (await response.json()) as LoginResponse;
        expect(Value.Check(LoginResponse, body)).toBe(true);
        if (body.continueUrl === undefined) throw new Error("expected a continue url");
        const continueUrl = new URL(body.continueUrl, TEST_SITE_URL);
        expect(continueUrl.pathname).toBe(OAUTH_ENDPOINT_PATHS.authorize);
        expect(SIGNED_FIELDS.filter((field) => continueUrl.searchParams.has(field))).toEqual([]);
        expect(sortedEntries(continueUrl.searchParams)).toEqual(sortedEntries(params));

        const back = await follow(body.continueUrl, sessionCookieOf(response.headers.getSetCookie()));
        expect(`${back.origin}${back.pathname}`).toBe(TEST_REDIRECT_URI);
        expect(back.searchParams.get("code")).not.toBeNull();
        expect(back.searchParams.get("state")).toBe("st");
    });

    it("被篡改的令牌照常登录，响应不带继续地址", async () => {
        const {token} = await continueToken(authorizeParams());
        // 改掉被签名的 `state`，签名还是原来的。
        const tampered = Buffer.from(Buffer.from(token, "base64url").toString("utf8").replace("state=st", "state=xx"), "utf8").toString("base64url");
        expect(tampered).not.toBe(token);
        const response = await login({continue: tampered});
        expect(response.status).toBe(200);
        expect(await response.json()).not.toHaveProperty("continueUrl");
    });

    it("按模块的时钟过了 10 分钟：照常登录，响应不带继续地址", async () => {
        const {token, signedBefore} = await continueToken(authorizeParams());
        identity.clock.set(signedBefore + CONTINUE_LIFETIME_MS + 1);
        const response = await login({continue: token});
        expect(response.status).toBe(200);
        expect(await response.json()).not.toHaveProperty("continueUrl");
    });

    it("prompt=login 与 max_age 由这次登录满足：继续地址去掉它们，去那里拿到授权码，不再回登录页（输出 4、13）", async () => {
        const {token} = await continueToken(authorizeParams({prompt: "login", max_age: "0"}));
        const response = await login({continue: token});
        const body = (await response.json()) as LoginResponse;
        if (body.continueUrl === undefined) throw new Error("expected a continue url");
        const continueUrl = new URL(body.continueUrl, TEST_SITE_URL);
        expect([continueUrl.searchParams.has("prompt"), continueUrl.searchParams.has("max_age")]).toEqual([false, false]);
        const back = await follow(body.continueUrl, sessionCookieOf(response.headers.getSetCookie()));
        expect(`${back.origin}${back.pathname}`).toBe(TEST_REDIRECT_URI);
        expect(back.searchParams.get("code")).not.toBeNull();
    });
});

describe("resolveContinue", () => {
    it("签名起 10 分钟内合格，按模块时钟再过 1 毫秒不合格", async () => {
        const {token, signedAfter, signedBefore} = await continueToken(authorizeParams());
        // 签名时刻在 [signedAfter, signedBefore] 里：前者加 10 分钟一定还没过，后者加 10 分钟再加 1 毫秒一定过了。
        expect(await resolveContinue(token, signedAfter + CONTINUE_LIFETIME_MS, "login", secret)).not.toBeNull();
        expect(await resolveContinue(token, signedBefore + CONTINUE_LIFETIME_MS + 1, "login", secret)).toBeNull();
    });

    it("超长、不是 base64url、解不成 UTF-8、换了密钥、截断的令牌都不合格", async () => {
        const {token, signedAfter} = await continueToken(authorizeParams());
        const now = signedAfter;
        // 合格的令牌后面接上 `&state=x` 再编码：签名不变，参数多了。
        const appended = Buffer.from(`${Buffer.from(token, "base64url").toString("utf8")}&state=x`, "utf8").toString("base64url");
        const cases: ReadonlyArray<readonly [label: string, token: string, secret: string]> = [
            ["超长", "A".repeat(MAX_CONTINUE_TOKEN_LENGTH + 1), secret],
            ["不是 base64url", `${token}!`, secret],
            ["解不成 UTF-8", Buffer.from([0xff, 0xfe, 0xfd]).toString("base64url"), secret],
            ["换了密钥", token, `${secret}x`],
            // 末尾是 `sig=…%3D`：只截掉 `%3D` 时签名不变（库比签名前去掉填充），多截几个字符才动到签名。
            ["截断", token.slice(0, -8), secret],
            ["多接了参数", appended, secret],
            ["空的", "", secret],
        ];
        for (const [label, candidate, key] of cases) expect({label, url: await resolveContinue(candidate, now, "login", key)}).toEqual({label, url: null});
        expect(await resolveContinue(token, now, "login", secret)).not.toBeNull();
    });

    it("prompt 里只去掉 login，别的值留着；补交同意的消费者 prompt 与 max_age 都留着（输出 12）", async () => {
        const {token, signedAfter} = await continueToken(authorizeParams({prompt: "login consent", max_age: "60"}));
        const asLogin = new URL((await resolveContinue(token, signedAfter, "login", secret)) ?? "", TEST_SITE_URL);
        expect([asLogin.searchParams.get("prompt"), asLogin.searchParams.get("max_age")]).toEqual(["consent", null]);
        const asConsent = new URL((await resolveContinue(token, signedAfter, "consent", secret)) ?? "", TEST_SITE_URL);
        expect([asConsent.searchParams.get("prompt"), asConsent.searchParams.get("max_age")]).toEqual(["login consent", "60"]);
        expect(SIGNED_FIELDS.filter((field) => asConsent.searchParams.has(field))).toEqual([]);
    });
});
