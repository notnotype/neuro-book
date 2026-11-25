/**
 * 社交登录与关联的黑盒合同（docs/specs/site/accounts.md 输出 11、12、15、23，时序一节社交那几句，验收 10 到 13；
 * docs/specs/site/oauth-provider.md 验收 14 与输出 7 的 `email_verified`）：起真实的 `nb-site` 进程，上游是仿真的 Google 与
 * GitHub（`@notnotype/neuro-book-test-support/oauth-upstream`，第三方的替身），浏览器经 `testing/oauth-client.ts` 的
 * `followSocial` 走发起、上游、回调三步。账号用 `create-admin` 建，关联要它们的密码。
 *
 * 本文件测不到、在账号包里的（`nb-site-identity` 的 `social/login.test.ts`、`social/link.test.ts`）：上游已返回、关联钩子复核
 * 之前会话被结束（要在库的两步之间插入动作）；两个关联并发；库插 `account` 失败留下的孤行；库表里不存上游令牌、`emailVerified`
 * 列仍为 false（读库）；清理任务删流程行。社交注册与解绑在后面的片。
 *
 * 时间预算：起进程、建账号放在 `beforeAll` 里。关联的用例要核对当前密码（算一次哈希），超出 200 毫秒，在旁边写明。
 * 拨时钟的用例（验收 10 的过期）另起一个进程：拨过 10 分钟也让续接令牌等别的按模块时钟判的东西过期，与别的用例共用会互相牵连。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";

import {startFakeUpstream, upstreamEnv, type FakeGoogleUser, type FakeUpstream} from "@notnotype/neuro-book-test-support/oauth-upstream";
import {CONTINUE_PARAM, IDENTITY_PATHS, identityPath, SOCIAL_CALLBACK_PATHS, WhoamiResponse, type SocialProvider} from "@notnotype/nb-site-identity-contract";
import {Value} from "typebox/value";

import {cookieJar, createAdmin, IDENTITY_SITE_ENV, identityRequest, login, SITE_ORIGIN, type CookieJar} from "./testing/identity";
import {
    authorizationRequest,
    exchangeCode,
    fetchUserInfo,
    followSocial,
    openSocialCallback,
    registerOAuthClient,
    socialStartUrl,
    step,
    upstreamCallback,
    type SocialLanding,
} from "./testing/oauth-client";
import {useSiteSandbox, type JsonResponse, type SiteProcess} from "./testing/site";

const sandbox = useSiteSandbox("nb-site-contract-tests accounts-social.test.ts");

const SETUP_TIMEOUT_MS = 60_000;
const TERMS_VERSION = "2026-11-20";
const PASSWORD = "social-PW-q7Hn24";
const FLOW_MS = 10 * 60_000;
const SESSION_COOKIE = "__Host-nbsite.session_token";

/** `jar` 现在登录着的用户名；没有会话时为 null。 */
async function signedInAs(site: SiteProcess, jar: CookieJar, from: string): Promise<string | null> {
    const response = await identityRequest(site.url, IDENTITY_PATHS.whoami, {jar, from});
    if (response.status !== 200 || !Value.Check(WhoamiResponse, response.body)) throw new Error(`whoami answered ${String(response.status)}: ${JSON.stringify(response.body)}`);
    return response.body.state === "authenticated" ? response.body.user.username : null;
}

function googleUser(sub: string, email: string | null = `${sub}@gmail.test`): FakeGoogleUser {
    return {sub, ...(email === null ? {} : {email}), email_verified: true, name: `Name ${sub}`};
}

/** 落点里用例要比的：路径与 `social_error`。 */
function landed(landing: SocialLanding): {readonly status: number; readonly path: string; readonly socialError: string | null} {
    return {status: landing.status, path: landing.location.pathname, socialError: landing.socialError};
}

/** 这次落点有没有发会话 Cookie（不算清掉它的那一条）。 */
function setsSession(landing: SocialLanding): boolean {
    return landing.response.headers.getSetCookie().some((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`) && !/max-age=0/iu.test(cookie));
}

describe("社交登录与关联（输出 11、12、15、23，验收 10 到 13；site.oauth-provider 验收 14）", () => {
    let upstream: FakeUpstream;
    let site: SiteProcess;
    let address = 0;
    const from = () => `203.0.113.${String(++address % 250)}`;

    /** 以 `jar` 登录并同意当前条款；不成功时抛错。 */
    async function signIn(jar: CookieJar, username: string): Promise<void> {
        if ((await login(site.url, username, PASSWORD, {from: from(), jar})).status !== 200) throw new Error(`${username} could not sign in`);
        const consented = await identityRequest(site.url, IDENTITY_PATHS.meConsent, {method: "POST", jar, from: from(), body: {termsVersion: TERMS_VERSION, overseasStorage: true}});
        if (consented.status !== 200) throw new Error(`${username} could not consent`);
    }

    function start(jar: CookieJar, provider: SocialProvider | string, body: unknown): Promise<JsonResponse> {
        return identityRequest(site.url, identityPath.socialStart(provider as SocialProvider), {method: "POST", jar, from: from(), body});
    }

    function socialLogin(jar: CookieJar, provider: SocialProvider = "google"): Promise<SocialLanding> {
        return start(jar, provider, {intent: "login"}).then((response) => followSocial(site.url, jar, response));
    }

    async function link(jar: CookieJar, provider: SocialProvider = "google"): Promise<SocialLanding> {
        return followSocial(site.url, jar, await start(jar, provider, {intent: "link", currentPassword: PASSWORD}));
    }

    function whoami(jar: CookieJar): Promise<string | null> {
        return signedInAs(site, jar, from());
    }

    beforeAll(async () => {
        upstream = await startFakeUpstream();
        const dataDir = await sandbox.dataDir();
        for (const name of ["root", "alice", "bob", "carol", "dave"]) await createAdmin(sandbox, dataDir, [name, `${name}@example.com`], PASSWORD);
        site = await sandbox.start({dataDir, env: {...IDENTITY_SITE_ENV, ...upstreamEnv(upstream)}});
    }, SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await upstream.close();
    });

    it("站点信息按配置列出两个上游；:provider 不是两个上游之一时 404（输出 11）", async () => {
        const meta = await identityRequest(site.url, IDENTITY_PATHS.meta, {from: from()});
        expect((meta.body as {providers?: unknown}).providers).toEqual({google: true, github: true});
        const unknown = await start(cookieJar(), "twitter", {intent: "login"});
        expect({status: unknown.status, body: unknown.body}).toEqual({status: 404, body: {error: {code: "not_found"}}});
    });

    it("没有关联任何账号的上游身份：回 /login 带 social_not_registered，不发会话（输出 12、23）", async () => {
        upstream.setUser("google", googleUser("g-stranger"));
        const browser = cookieJar();
        const landing = await socialLogin(browser);
        expect(landed(landing)).toEqual({status: 302, path: "/login", socialError: "social_not_registered"});
        expect(setsSession(landing)).toBe(false);
        expect(await whoami(browser)).toBeNull();
    });

    // 超出预算：关联核对一次当前密码。
    it("关联成功回 /account；之后用这个身份登录回 /、建立会话；Google 与 GitHub 都是（输出 12、15、23）", async () => {
        const alice = cookieJar();
        await signIn(alice, "alice");
        upstream.setUser("google", googleUser("g-alice"));
        expect(landed(await link(alice))).toEqual({status: 302, path: "/account", socialError: null});
        upstream.setUser("github", {id: 1001, login: "alice-gh", name: null, email: null, emails: [{email: "alice@github.test", primary: true, verified: true, visibility: null}]});
        expect(landed(await link(alice, "github"))).toEqual({status: 302, path: "/account", socialError: null});

        for (const provider of ["google", "github"] as const) {
            const browser = cookieJar();
            const landing = await socialLogin(browser, provider);
            expect({provider, ...landed(landing), session: setsSession(landing)}).toEqual({provider, status: 302, path: "/", socialError: null, session: true});
            expect({provider, username: await whoami(browser)}).toEqual({provider, username: "alice"});
        }
    });

    // 超出预算：关联核对当前密码。
    it("再关联同一个身份、在该上游已有身份时 identity_exists；身份已关联别的账号时 identity_taken（输出 15）", async () => {
        const bob = cookieJar();
        const carol = cookieJar();
        await signIn(bob, "bob");
        await signIn(carol, "carol");
        upstream.setUser("google", googleUser("g-bob"));
        expect(landed(await link(bob)).socialError).toBeNull();

        expect(landed(await link(bob))).toEqual({status: 302, path: "/account", socialError: "identity_exists"});
        upstream.setUser("google", googleUser("g-bob-second"));
        expect(landed(await link(bob))).toEqual({status: 302, path: "/account", socialError: "identity_exists"});
        upstream.setUser("google", googleUser("g-bob"));
        expect(landed(await link(carol))).toEqual({status: 302, path: "/account", socialError: "identity_taken"});
        // carol 没关联上：这个身份登录仍是 bob。
        const browser = cookieJar();
        await socialLogin(browser);
        expect(await whoami(browser)).toBe("bob");
    });

    // 超出预算：关联核对一次当前密码。
    it("已关联的身份这次上游没给邮箱：登录回 /login 带 social_failed，不发会话（输出 12）", async () => {
        const dave = cookieJar();
        await signIn(dave, "dave");
        upstream.setUser("github", {id: 4004, login: "dave-gh", name: "Dave", email: null, emails: [{email: "dave@github.test", primary: true, verified: true, visibility: null}]});
        expect(landed(await link(dave, "github")).socialError).toBeNull();

        upstream.setUser("github", {id: 4004, login: "dave-gh", name: "Dave", email: null, emails: []});
        const landing = await socialLogin(cookieJar(), "github");
        expect(landed(landing)).toEqual({status: 302, path: "/login", socialError: "social_failed"});
        expect(setsSession(landing)).toBe(false);
    });

    it("在上游点了取消：social_cancelled；上游换令牌出错：social_failed（失败表）", async () => {
        upstream.setUser("google", googleUser("g-alice"));
        upstream.cancelNext("google");
        expect(landed(await socialLogin(cookieJar()))).toEqual({status: 302, path: "/login", socialError: "social_cancelled"});
        upstream.failToken("google");
        expect(landed(await socialLogin(cookieJar()))).toEqual({status: 302, path: "/login", socialError: "social_failed"});
        upstream.setUser("github", {id: 1001, login: "alice-gh", name: null, email: null, emails: [{email: "alice@github.test", primary: true, verified: true, visibility: null}]});
        upstream.failToken("github");
        expect(landed(await socialLogin(cookieJar(), "github"))).toEqual({status: 302, path: "/login", socialError: "social_failed"});
    });

    it("同一个回调地址第二次到达：social_state_invalid，不建会话（验收 10 的前半；过期在文件末的另一个进程上）", async () => {
        upstream.setUser("google", googleUser("g-alice"));
        const browser = cookieJar();
        const started = await start(browser, "google", {intent: "login"});
        const callback = await upstreamCallback(socialStartUrl(started));
        expect(landed(await openSocialCallback(site.url, browser, callback)).socialError).toBeNull();
        // 重放的浏览器带着发起时的 state Cookie（第一次回调清掉了浏览器里的那份）：拒它的是流程只能用一次，不是 Cookie 对不上。
        const replayer = cookieJar();
        replayer.store(started);
        const replay = await openSocialCallback(site.url, replayer, callback);
        expect({...landed(replay), session: setsSession(replay)}).toEqual({status: 302, path: "/login", socialError: "social_state_invalid", session: false});
        expect(await whoami(replayer)).toBeNull();
    });

    it("带有效 state 的回调地址里写了 error：本站的码与库的码都是 social_failed，只有 access_denied 是 social_cancelled（验收 11）", async () => {
        for (const [error, expected] of [
            ["username_taken", "social_failed"],
            ["account_already_linked_to_different_user", "social_failed"],
            ["access_denied", "social_cancelled"],
        ] as const) {
            const browser = cookieJar();
            const state = new URL(socialStartUrl(await start(browser, "google", {intent: "login"}))).searchParams.get("state") ?? "";
            const landing = await openSocialCallback(site.url, browser, `${SITE_ORIGIN}${SOCIAL_CALLBACK_PATHS.google}?${new URLSearchParams({state, error})}`);
            expect({error, ...landed(landing)}).toEqual({error, status: 302, path: "/login", socialError: expected});
        }
    });

    // 超出预算：关联发起时核对当前密码。
    it("关联发起之后结束那次会话：回调不关联，回 /account 带 social_state_invalid（验收 12）", async () => {
        const carol = cookieJar();
        await signIn(carol, "carol");
        upstream.setUser("google", googleUser("g-carol-late"));
        const callback = await upstreamCallback(socialStartUrl(await start(carol, "google", {intent: "link", currentPassword: PASSWORD})));
        expect((await identityRequest(site.url, IDENTITY_PATHS.logout, {method: "POST", jar: carol, from: from()})).status).toBe(200);
        expect(landed(await openSocialCallback(site.url, carol, callback))).toEqual({status: 302, path: "/account", socialError: "social_state_invalid"});
        expect(landed(await socialLogin(cookieJar())).socialError).toBe("social_not_registered");
    });

    // 超出预算：关联发起时核对当前密码。
    it("浏览器 A 发起、浏览器 B（另一份 Cookie）打开回调：social_state_invalid，B 没有会话；关联意图时不关联（验收 13）", async () => {
        upstream.setUser("google", googleUser("g-alice"));
        const browserA = cookieJar();
        const browserB = cookieJar();
        const callbackA = await upstreamCallback(socialStartUrl(await start(browserA, "google", {intent: "login"})));
        await start(browserB, "google", {intent: "login"});
        const opened = await openSocialCallback(site.url, browserB, callbackA);
        expect({...landed(opened), session: setsSession(opened)}).toEqual({status: 302, path: "/login", socialError: "social_state_invalid", session: false});
        expect(await whoami(browserB)).toBeNull();

        const dave = cookieJar();
        await signIn(dave, "dave");
        upstream.setUser("google", googleUser("g-dave-other-browser"));
        const linkCallback = await upstreamCallback(socialStartUrl(await start(dave, "google", {intent: "link", currentPassword: PASSWORD})));
        const otherBrowser = cookieJar();
        await start(otherBrowser, "google", {intent: "login"});
        expect(landed(await openSocialCallback(site.url, otherBrowser, linkCallback))).toEqual({status: 302, path: "/account", socialError: "social_state_invalid"});
        expect(landed(await socialLogin(cookieJar())).socialError).toBe("social_not_registered");
    });

    // 超出预算：关联核对当前密码、登记客户端。
    it("从 /login?continue=… 改走社交登录：回到授权请求，拿到授权码；用户信息的 email_verified 仍为 false（oauth-provider 验收 14、输出 7）", async () => {
        const root = cookieJar();
        await signIn(root, "root");
        // 上游说已验证、与账号相同的邮箱：库在再登录时会想把账号的邮箱记成已验证。
        upstream.setUser("google", googleUser("g-root", "root@example.com"));
        expect(landed(await link(root)).socialError).toBeNull();
        const client = await registerOAuthClient(site.url, root, from(), {name: "社交合同客户端", redirectUris: ["https://client.example/cb"], type: "confidential", skipConsent: true});

        const browser = cookieJar();
        const authorization = authorizationRequest(client);
        const toLogin = await step(site.url, browser, authorization.url, client);
        const continueToken = toLogin.location.searchParams.get(CONTINUE_PARAM);
        if (toLogin.kind !== "login" || continueToken === null) throw new Error(`authorization ended at ${toLogin.kind}, not at the login page with a continue token`);
        const landing = await followSocial(site.url, browser, await start(browser, "google", {intent: "login", continue: continueToken}));
        expect(landing.socialError).toBeNull();
        const back = await step(site.url, browser, landing.location.href, client);
        const code = back.location.searchParams.get("code");
        expect({kind: back.kind, state: back.location.searchParams.get("state"), code: code !== null}).toEqual({kind: "redirect-back", state: authorization.state, code: true});

        const tokens = JSON.parse((await exchangeCode(site.url, client, code ?? "", authorization.verifier)).text) as {access_token: string};
        const info = JSON.parse((await fetchUserInfo(site.url, tokens.access_token)).text) as Record<string, unknown>;
        expect({username: info.preferred_username, email: info.email, emailVerified: info.email_verified}).toEqual({username: "root", email: "root@example.com", emailVerified: false});
    });
});

describe("发起过了 10 分钟（验收 10 的后半）", () => {
    it("回调到达时流程已过期：social_state_invalid，不建会话", async () => {
        const upstream = await startFakeUpstream();
        try {
            const dataDir = await sandbox.dataDir();
            await createAdmin(sandbox, dataDir, ["erin", "erin@example.com"], PASSWORD);
            const site = await sandbox.start({dataDir, env: {...IDENTITY_SITE_ENV, ...upstreamEnv(upstream)}});
            const erin = cookieJar();
            if ((await login(site.url, "erin", PASSWORD, {from: "203.0.113.8", jar: erin})).status !== 200) throw new Error("erin could not sign in");
            const consented = await identityRequest(site.url, IDENTITY_PATHS.meConsent, {method: "POST", jar: erin, from: "203.0.113.8", body: {termsVersion: TERMS_VERSION, overseasStorage: true}});
            if (consented.status !== 200) throw new Error("erin could not consent");
            upstream.setUser("google", googleUser("g-erin"));
            const linked = await followSocial(site.url, erin, await identityRequest(site.url, identityPath.socialStart("google"), {method: "POST", jar: erin, from: "203.0.113.8", body: {intent: "link", currentPassword: PASSWORD}}));
            expect(landed(linked).socialError).toBeNull();

            // 这个身份已关联：没过期时它会登录成功，过期的拒绝只能来自流程的时限。
            const late = cookieJar();
            const callback = await upstreamCallback(socialStartUrl(await identityRequest(site.url, identityPath.socialStart("google"), {method: "POST", jar: late, from: "203.0.113.9", body: {intent: "login"}})));
            await site.advanceClock(FLOW_MS);
            const expired = await openSocialCallback(site.url, late, callback);
            expect({...landed(expired), session: setsSession(expired)}).toEqual({status: 302, path: "/login", socialError: "social_state_invalid", session: false});
            expect(await signedInAs(site, late, "203.0.113.9")).toBeNull();
        } finally {
            await upstream.close();
        }
    }, SETUP_TIMEOUT_MS);
});

describe("上游的配置（site.accounts 输入一节，输出 11）", () => {
    it("一个上游只给了客户端 id：config_invalid，问题报在没给的密钥上，输出里没有取值", async () => {
        const dataDir = await sandbox.dataDir();
        const result = await sandbox.run("serve", {dataDir, env: {...IDENTITY_SITE_ENV, NB_SITE_IDENTITY_GOOGLE_CLIENT_ID: "half-configured-client-id"}});
        expect(result.exitCode).not.toBe(0);
        expect(result.failure?.code).toBe("config_invalid");
        expect(result.failure?.problems).toContainEqual({name: "NB_SITE_IDENTITY_GOOGLE_CLIENT_SECRET", problem: "missing"});
        expect(`${result.stdout}\n${result.stderr}`).not.toContain("half-configured-client-id");
    });

    it("只开放 GitHub：发起 Google 回 403 provider_disabled，站点信息里 Google 为 false", async () => {
        const upstream = await startFakeUpstream();
        try {
            const env = Object.fromEntries(Object.entries(upstreamEnv(upstream)).filter(([name]) => !name.startsWith("NB_SITE_IDENTITY_GOOGLE_")));
            const site = await sandbox.start({dataDir: await sandbox.dataDir(), env: {...IDENTITY_SITE_ENV, ...env}});
            const disabled = await identityRequest(site.url, identityPath.socialStart("google"), {method: "POST", from: "203.0.113.7", body: {intent: "login"}});
            expect({status: disabled.status, body: disabled.body}).toEqual({status: 403, body: {error: {code: "provider_disabled"}}});
            const meta = await identityRequest(site.url, IDENTITY_PATHS.meta, {from: "203.0.113.7"});
            expect((meta.body as {providers?: unknown}).providers).toEqual({google: false, github: true});
        } finally {
            await upstream.close();
        }
    }, SETUP_TIMEOUT_MS);
});
