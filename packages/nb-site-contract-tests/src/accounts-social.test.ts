/**
 * 社交登录、注册与关联的黑盒合同（docs/specs/site/accounts.md 输出 11 到 15、23，时序一节社交那几句，验收 4、5、8 到 14；
 * docs/specs/site/oauth-provider.md 验收 14 与输出 7 的 `email_verified`）：起真实的 `nb-site` 进程，上游是仿真的 Google 与
 * GitHub（`@notnotype/neuro-book-test-support/oauth-upstream`，第三方的替身），浏览器经 `testing/oauth-client.ts` 的
 * `followSocial` 走发起、上游、回调三步。账号用 `create-admin` 建，关联要它们的密码。
 *
 * 本文件测不到、在账号包里的（`nb-site-identity` 的 `social/login.test.ts`、`social/link.test.ts`、`social/register.test.ts`）：
 * 上游已返回、关联钩子复核之前会话被结束（要在库的两步之间插入动作）；两个关联并发；关联与注册按固定的先后争同一个身份（这里
 * 只能并发打开、不定先后）；库插 `account` 失败留下的孤行、注册写到一半失败时全部回滚；库表里不存上游令牌、`emailVerified`
 * 列仍为 false（读库）；发起检查的各个码与限流；清理任务删流程行。列表与解绑在 `accounts-identities.test.ts`。
 *
 * 时间预算：起进程、建账号放在 `beforeAll` 里。关联的用例要核对当前密码（算一次哈希），超出 200 毫秒，在旁边写明。社交注册
 * 另起一个进程，账号与注册码不与登录、关联的用例互相牵连。
 * 拨时钟的用例（验收 10 的过期）另起一个进程：拨过 10 分钟也让续接令牌等别的按模块时钟判的东西过期，与别的用例共用会互相牵连。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";

import {startFakeUpstream, upstreamEnv, type FakeGitHubUser, type FakeGoogleUser, type FakeUpstream} from "@notnotype/neuro-book-test-support/oauth-upstream";
import {
    AdminUserDetail,
    CONTINUE_PARAM,
    IDENTITY_PATHS,
    identityPath,
    RegistrationCodeItem,
    RegistrationCodeListResponse,
    SOCIAL_CALLBACK_PATHS,
    UserListResponse,
    WhoamiResponse,
    type SocialProvider,
} from "@notnotype/nb-site-identity-contract";
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
/** 回调查询串（不含 `?`）的字符数上限（t08 计划 3.6；Spec 的失败表只写落点的码，没写这个数）。 */
const CALLBACK_QUERY_LIMIT = 8192;

/** `jar` 现在登录着的用户名；没有会话时为 null。 */
async function signedInAs(site: SiteProcess, jar: CookieJar, from: string): Promise<string | null> {
    const response = await identityRequest(site.url, IDENTITY_PATHS.whoami, {jar, from});
    if (response.status !== 200 || !Value.Check(WhoamiResponse, response.body)) throw new Error(`whoami answered ${String(response.status)}: ${JSON.stringify(response.body)}`);
    return response.body.state === "authenticated" ? response.body.user.username : null;
}

function googleUser(sub: string, email: string | null = `${sub}@gmail.test`, verified = true): FakeGoogleUser {
    return {sub, ...(email === null ? {} : {email}), email_verified: verified, name: `Name ${sub}`};
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

describe("社交注册（输出 13、14、23，验收 4、5、8、9、13、14；site.oauth-provider 输出 4 的 continue）", () => {
    let upstream: FakeUpstream;
    let site: SiteProcess;
    let admin: CookieJar;
    let address = 0;
    const from = () => `198.51.100.${String(++address % 250)}`;

    beforeAll(async () => {
        upstream = await startFakeUpstream();
        const dataDir = await sandbox.dataDir();
        for (const name of ["root", "grace", "holder", "linker"]) await createAdmin(sandbox, dataDir, [name, `${name}@example.com`], PASSWORD);
        site = await sandbox.start({dataDir, env: {...IDENTITY_SITE_ENV, ...upstreamEnv(upstream)}});
        admin = cookieJar();
        await consentedSignIn(admin, "root");
    }, SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await upstream.close();
    });

    async function consentedSignIn(jar: CookieJar, username: string): Promise<void> {
        if ((await login(site.url, username, PASSWORD, {from: from(), jar})).status !== 200) throw new Error(`${username} could not sign in`);
        const consented = await identityRequest(site.url, IDENTITY_PATHS.meConsent, {method: "POST", jar, from: from(), body: {termsVersion: TERMS_VERSION, overseasStorage: true}});
        if (consented.status !== 200) throw new Error(`${username} could not consent`);
    }

    async function issueCode(maxUses: number | null = 1): Promise<RegistrationCodeItem> {
        const response = await identityRequest(site.url, IDENTITY_PATHS.adminRegistrationCodes, {method: "POST", from: from(), jar: admin, body: {maxUses}});
        if (response.status !== 200 || !Value.Check(RegistrationCodeItem, response.body)) throw new Error(`issuing a registration code answered ${String(response.status)}`);
        return response.body;
    }

    async function usedCount(code: RegistrationCodeItem): Promise<number> {
        const response = await identityRequest(site.url, `${IDENTITY_PATHS.adminRegistrationCodes}?pageSize=100`, {from: from(), jar: admin});
        if (!Value.Check(RegistrationCodeListResponse, response.body)) throw new Error(`listing registration codes answered ${String(response.status)}`);
        const item = response.body.items.find((candidate) => candidate.id === code.id);
        if (item === undefined) throw new Error(`registration code ${String(code.id)} is not in the first page`);
        return item.usedCount;
    }

    /** 站点上全部账号的用户名（管理员的账号列表，按用户名排）：没建出的账号不在里面。 */
    async function usernames(): Promise<string[]> {
        const response = await identityRequest(site.url, `${IDENTITY_PATHS.adminUsers}?pageSize=100`, {from: from(), jar: admin});
        if (!Value.Check(UserListResponse, response.body)) throw new Error(`listing users answered ${String(response.status)}`);
        return response.body.items.map((item) => item.username).toSorted();
    }

    /** 管理员看到的一个账号的登录方式。 */
    async function loginMethods(username: string): Promise<{readonly hasPassword: boolean; readonly providers: readonly string[]}> {
        const list = await identityRequest(site.url, `${IDENTITY_PATHS.adminUsers}?${new URLSearchParams({q: username, pageSize: "100"})}`, {from: from(), jar: admin});
        if (!Value.Check(UserListResponse, list.body)) throw new Error(`listing users answered ${String(list.status)}`);
        const id = list.body.items.find((item) => item.username === username)?.id;
        if (id === undefined) throw new Error(`no account named ${username}`);
        const detail = await identityRequest(site.url, identityPath.adminUser(id), {from: from(), jar: admin});
        if (!Value.Check(AdminUserDetail, detail.body)) throw new Error(`the account detail answered ${String(detail.status)}`);
        return {hasPassword: detail.body.hasPassword, providers: detail.body.providers};
    }

    function registerBody(code: RegistrationCodeItem, username: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
        return {intent: "register", username, registrationCode: code.code, termsVersion: TERMS_VERSION, overseasStorage: true, ...extra};
    }

    function start(jar: CookieJar, provider: SocialProvider, body: unknown): Promise<JsonResponse> {
        return identityRequest(site.url, identityPath.socialStart(provider), {method: "POST", jar, from: from(), body});
    }

    function whoami(jar: CookieJar): Promise<string | null> {
        return signedInAs(site, jar, from());
    }

    function githubUser(id: number, email: string, verified = true): FakeGitHubUser {
        return {id, login: `gh-${String(id)}`, name: null, email: null, emails: [{email, primary: true, verified, visibility: null}]};
    }

    it("社交注册（Smoke）：缺注册码时不跳转；带齐后回调建出账号并有会话，账号没有密码、邮箱不算验证过、码用了 1 次；同一个身份再以登录意图回来直接登录（验收 4）", async () => {
        const code = await issueCode(3);
        upstream.setUser("google", googleUser("g-nina", "Nina@Gmail.test"));
        const browser = cookieJar();
        const {registrationCode: _omitted, ...withoutCode} = registerBody(code, "Nina");
        const missing = await start(browser, "google", withoutCode);
        expect({status: missing.status, body: missing.body}).toEqual({status: 400, body: {error: {code: "validation_failed", fields: ["registrationCode"]}}});

        const landing = await followSocial(site.url, browser, await start(browser, "google", registerBody(code, "Nina")));
        expect({...landed(landing), session: setsSession(landing)}).toEqual({status: 302, path: "/", socialError: null, session: true});
        const me = await identityRequest(site.url, IDENTITY_PATHS.me, {jar: browser, from: from()});
        expect(me.body).toMatchObject({username: "nina", displayName: "Nina", email: "nina@gmail.test", hasPassword: false, consentRequired: false});
        expect(await loginMethods("nina")).toEqual({hasPassword: false, providers: ["google"]});
        expect(await usedCount(code)).toBe(1);

        const again = cookieJar();
        const relogin = await followSocial(site.url, again, await start(again, "google", {intent: "login"}));
        expect({...landed(relogin), username: await whoami(again)}).toEqual({status: 302, path: "/", socialError: null, username: "nina"});
    });

    it("上游给的邮箱没验证过：Google 与 GitHub 都 social_email_missing，不建账号、不扣码（输出 13）", async () => {
        const code = await issueCode();
        for (const [provider, setUser] of [
            ["google", () => upstream.setUser("google", googleUser("g-unverified", "unverified@gmail.test", false))],
            ["github", () => upstream.setUser("github", githubUser(5005, "unverified@github.test", false))],
        ] as const) {
            setUser();
            const browser = cookieJar();
            const landing = await followSocial(site.url, browser, await start(browser, provider, registerBody(code, "unverified")));
            expect({provider, ...landed(landing), session: setsSession(landing)}).toEqual({provider, status: 302, path: "/register", socialError: "social_email_missing", session: false});
        }
        expect({used: await usedCount(code), users: (await usernames()).includes("unverified")}).toEqual({used: 0, users: false});
    });

    // 超出预算：关联核对一次当前密码。
    it("注册意图碰上已关联某个账号的上游身份：identity_taken，不建账号、不建会话、不扣码（输出 13）", async () => {
        const holder = cookieJar();
        await consentedSignIn(holder, "holder");
        upstream.setUser("google", googleUser("g-holder"));
        expect(landed(await followSocial(site.url, holder, await start(holder, "google", {intent: "link", currentPassword: PASSWORD}))).socialError).toBeNull();

        const code = await issueCode();
        const browser = cookieJar();
        const landing = await followSocial(site.url, browser, await start(browser, "google", registerBody(code, "newcomer")));
        expect({...landed(landing), session: setsSession(landing), username: await whoami(browser)}).toEqual({
            status: 302,
            path: "/register",
            socialError: "identity_taken",
            session: false,
            username: null,
        });
        expect({used: await usedCount(code), users: (await usernames()).includes("newcomer")}).toEqual({used: 0, users: false});
    });

    it("上游给的已验证邮箱已被一个密码账号占用：email_taken，不建账号、不关联，原账号仍只有密码一种登录方式（输出 14，验收 5）", async () => {
        const code = await issueCode();
        upstream.setUser("google", googleUser("g-grace-twin", "grace@example.com"));
        const browser = cookieJar();
        const landing = await followSocial(site.url, browser, await start(browser, "google", registerBody(code, "gracetwin")));
        expect({...landed(landing), session: setsSession(landing)}).toEqual({status: 302, path: "/register", socialError: "email_taken", session: false});
        expect({used: await usedCount(code), methods: await loginMethods("grace")}).toEqual({used: 0, methods: {hasPassword: true, providers: []}});
        const login = cookieJar();
        expect(landed(await followSocial(site.url, login, await start(login, "google", {intent: "login"}))).socialError).toBe("social_not_registered");
    });

    it("只剩一次的注册码，两个仿真上游的社交注册并发回调：恰好一个建出账号，另一个跳回 /register 带 registration_code_invalid（验收 8）", async () => {
        const code = await issueCode(1);
        upstream.setUser("google", googleUser("g-race"));
        upstream.setUser("github", githubUser(6006, "race@github.test"));
        const browsers = [cookieJar(), cookieJar()];
        // 两个发起都在码还没被用时过了检查；回调同时打开。
        const callbacks = [
            await upstreamCallback(socialStartUrl(await start(browsers[0]!, "google", registerBody(code, "racegoogle")))),
            await upstreamCallback(socialStartUrl(await start(browsers[1]!, "github", registerBody(code, "racegithub")))),
        ];
        const landings = await Promise.all(callbacks.map((callback, index) => openSocialCallback(site.url, browsers[index]!, callback)));
        const outcomes = landings.map((landing) => landed(landing));
        expect(outcomes.toSorted((left, right) => String(left.socialError).localeCompare(String(right.socialError)))).toEqual([
            {status: 302, path: "/", socialError: null},
            {status: 302, path: "/register", socialError: "registration_code_invalid"},
        ]);
        const winner = outcomes[0]!.socialError === null ? "racegoogle" : "racegithub";
        expect({used: await usedCount(code), users: (await usernames()).filter((name) => name.startsWith("race"))}).toEqual({used: 1, users: [winner]});
    });

    it("发起之后、回调之前停用注册码：回调跳回 /register 带 registration_code_invalid，不建账号（验收 9）", async () => {
        const code = await issueCode(null);
        upstream.setUser("google", googleUser("g-late-code"));
        const browser = cookieJar();
        const callback = await upstreamCallback(socialStartUrl(await start(browser, "google", registerBody(code, "latecode"))));
        const disabled = await identityRequest(site.url, identityPath.adminRegistrationCode(code.id), {method: "PATCH", from: from(), jar: admin, body: {disabled: true}});
        expect(disabled.status).toBe(200);
        const landing = await openSocialCallback(site.url, browser, callback);
        expect({...landed(landing), session: setsSession(landing)}).toEqual({status: 302, path: "/register", socialError: "registration_code_invalid", session: false});
        expect({used: await usedCount(code), users: (await usernames()).includes("latecode")}).toEqual({used: 0, users: false});
    });

    it("浏览器 A 发起社交注册、浏览器 B 打开回调：social_state_invalid，B 没有会话、不扣码（验收 13 的注册意图）", async () => {
        const code = await issueCode();
        upstream.setUser("google", googleUser("g-other-browser"));
        const browserA = cookieJar();
        const browserB = cookieJar();
        const callbackA = await upstreamCallback(socialStartUrl(await start(browserA, "google", registerBody(code, "otherbrowser"))));
        await start(browserB, "google", {intent: "login"});
        const opened = await openSocialCallback(site.url, browserB, callbackA);
        expect({...landed(opened), session: setsSession(opened), username: await whoami(browserB)}).toEqual({
            status: 302,
            path: "/register",
            socialError: "social_state_invalid",
            session: false,
            username: null,
        });
        expect({used: await usedCount(code), users: (await usernames()).includes("otherbrowser")}).toEqual({used: 0, users: false});
    });

    // 超出预算：关联核对一次当前密码。
    it("一个账号的关联与另一个人的社交注册并发回调同一个上游身份：至多一边成功，注册输了不建账号、不扣码，带 identity_taken（验收 14）", async () => {
        const linker = cookieJar();
        await consentedSignIn(linker, "linker");
        const code = await issueCode();
        upstream.setUser("google", googleUser("g-contested"));
        const registrant = cookieJar();
        const linkCallback = await upstreamCallback(socialStartUrl(await start(linker, "google", {intent: "link", currentPassword: PASSWORD})));
        const registerCallback = await upstreamCallback(socialStartUrl(await start(registrant, "google", registerBody(code, "contested"))));
        const [linked, registered] = await Promise.all([openSocialCallback(site.url, linker, linkCallback), openSocialCallback(site.url, registrant, registerCallback)]);

        const outcome = {link: landed(linked), register: {...landed(registered), session: setsSession(registered)}};
        expect([outcome.link.socialError, outcome.register.socialError].filter((error) => error === null).length).toBeLessThanOrEqual(1);
        if (outcome.register.socialError === null) {
            expect(outcome).toEqual({link: {status: 302, path: "/account", socialError: "identity_taken"}, register: {status: 302, path: "/", socialError: null, session: true}});
            expect({used: await usedCount(code), methods: await loginMethods("contested")}).toEqual({used: 1, methods: {hasPassword: false, providers: ["google"]}});
        } else {
            expect(outcome.register).toEqual({status: 302, path: "/register", socialError: "identity_taken", session: false});
            expect({used: await usedCount(code), users: (await usernames()).includes("contested")}).toEqual({used: 0, users: false});
        }
    });

    it("从 /login?continue=… 改走社交注册：成功后到继续地址，回到授权请求、拿到授权码（输出 23，site.oauth-provider 输出 4）", async () => {
        const client = await registerOAuthClient(site.url, admin, from(), {name: "社交注册合同客户端", redirectUris: ["https://client.example/cb"], type: "confidential", skipConsent: true});
        const browser = cookieJar();
        const authorization = authorizationRequest(client);
        const toLogin = await step(site.url, browser, authorization.url, client);
        const continueToken = toLogin.location.searchParams.get(CONTINUE_PARAM);
        if (toLogin.kind !== "login" || continueToken === null) throw new Error(`authorization ended at ${toLogin.kind}, not at the login page with a continue token`);

        const code = await issueCode();
        upstream.setUser("google", googleUser("g-continue"));
        const landing = await followSocial(site.url, browser, await start(browser, "google", registerBody(code, "continued", {continue: continueToken})));
        expect({socialError: landing.socialError, session: setsSession(landing)}).toEqual({socialError: null, session: true});
        const back = await step(site.url, browser, landing.location.href, client);
        expect({kind: back.kind, state: back.location.searchParams.get("state"), code: back.location.searchParams.get("code") !== null}).toEqual({kind: "redirect-back", state: authorization.state, code: true});
    });

    it("回调的查询串超过 8192 个字符：social_state_invalid，不扣码；同一个回调凑到正好 8192 个字符时照常注册（输出 13 的回调）", async () => {
        const code = await issueCode();
        upstream.setUser("google", googleUser("g-long-query"));
        const browser = cookieJar();
        const callback = new URL(await upstreamCallback(socialStartUrl(await start(browser, "google", registerBody(code, "longquery")))));
        // 补一个上游不会带的参数，把查询串（不含 `?`）凑到指定长度。
        const padded = (length: number): string => {
            const url = new URL(callback);
            url.searchParams.set("pad", "");
            url.searchParams.set("pad", "x".repeat(length - (url.search.length - 1)));
            return url.href;
        };
        const tooLong = await openSocialCallback(site.url, browser, padded(CALLBACK_QUERY_LIMIT + 1));
        expect({...landed(tooLong), session: setsSession(tooLong)}).toEqual({status: 302, path: "/register", socialError: "social_state_invalid", session: false});
        expect(await usedCount(code)).toBe(0);

        const atLimit = await openSocialCallback(site.url, browser, padded(CALLBACK_QUERY_LIMIT));
        expect({...landed(atLimit), session: setsSession(atLimit), username: await whoami(browser)}).toEqual({status: 302, path: "/", socialError: null, session: true, username: "longquery"});
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
