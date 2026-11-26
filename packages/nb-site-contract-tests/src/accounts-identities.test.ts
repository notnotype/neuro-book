/**
 * 上游身份的列表与解绑、没有密码的账号的密码登录与设密码（docs/specs/site/accounts.md 输出 4、9 的“没有密码的账号”那半，输出 16、
 * 24，失败表的 `last_login_method`）：起真实的 `nb-site` 进程，上游是仿真的 Google 与 GitHub（第三方的替身），没有密码的账号经
 * 社交注册建出（合同里造它只有这一条路）。
 *
 * 本文件测不到、在账号包里的（`nb-site-identity` 的 `social/identities.test.ts`）：密码那一行的 id 不算上游身份（合同里看不到
 * 它的 id）；没有密码的账号并发解绑两个身份（要两个请求同时排进写队列）。
 *
 * 时间预算：起进程、建有密码的账号放在 `beforeAll` 里。没有密码的账号只能在用例里经社交注册建，每走一次社交流程（注册、关联、
 * 登录）是发起、上游、回调三个请求，实测约 80 到 100 毫秒；用密码登录、关联核对当前密码、设密码另要算密码哈希。每条用例
 * 至少走两次流程，都超出 200 毫秒，在旁边写明。每条用例用自己的账号与上游身份，不靠先后。
 */

import {beforeAll, afterAll, describe, expect, it} from "bun:test";

import {startFakeUpstream, upstreamEnv, type FakeGitHubUser, type FakeGoogleUser, type FakeUpstream} from "@notnotype/neuro-book-test-support/oauth-upstream";
import {IDENTITY_PATHS, IdentityListResponse, identityPath, RegistrationCodeItem, WhoamiResponse, type IdentityItem, type SocialProvider} from "@notnotype/nb-site-identity-contract";
import {Value} from "typebox/value";

import {cookieJar, createAdmin, IDENTITY_SITE_ENV, identityRequest, login, type CookieJar} from "./testing/identity";
import {followSocial, type SocialLanding} from "./testing/oauth-client";
import {useSiteSandbox, type JsonResponse, type SiteProcess} from "./testing/site";

const sandbox = useSiteSandbox("nb-site-contract-tests accounts-identities.test.ts");

const SETUP_TIMEOUT_MS = 60_000;
const TERMS_VERSION = "2026-11-20";
const PASSWORD = "identity-PW-r5Tm82";
const NEW_PASSWORD = "identity-new-PW-w3Qz47";

function googleUser(sub: string, email = `${sub}@gmail.test`): FakeGoogleUser {
    return {sub, email, email_verified: true, name: `Name ${sub}`};
}

function githubUser(id: number, login: string): FakeGitHubUser {
    return {id, login, name: null, email: null, emails: [{email: `${login}@github.test`, primary: true, verified: true, visibility: null}]};
}

/** 落点里用例要比的：路径与 `social_error`。 */
function landed(landing: SocialLanding): {readonly path: string; readonly socialError: string | null} {
    return {path: landing.location.pathname, socialError: landing.socialError};
}

describe("上游身份的列表与解绑（输出 16、24）；没有密码的账号（输出 4、9）", () => {
    let upstream: FakeUpstream;
    let site: SiteProcess;
    let admin: CookieJar;
    let address = 0;
    const from = () => `192.0.2.${String(++address % 250)}`;

    beforeAll(async () => {
        upstream = await startFakeUpstream();
        const dataDir = await sandbox.dataDir();
        for (const name of ["root", "pat", "quinn"]) await createAdmin(sandbox, dataDir, [name, `${name}@example.com`], PASSWORD);
        site = await sandbox.start({dataDir, env: {...IDENTITY_SITE_ENV, ...upstreamEnv(upstream)}});
        admin = cookieJar();
        await signIn(admin, "root");
    }, SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await upstream.close();
    });

    /** 以 `jar` 用密码登录并同意当前条款；不成功时抛错。 */
    async function signIn(jar: CookieJar, username: string): Promise<void> {
        if ((await login(site.url, username, PASSWORD, {from: from(), jar})).status !== 200) throw new Error(`${username} could not sign in`);
        const consented = await identityRequest(site.url, IDENTITY_PATHS.meConsent, {method: "POST", jar, from: from(), body: {termsVersion: TERMS_VERSION, overseasStorage: true}});
        if (consented.status !== 200) throw new Error(`${username} could not consent`);
    }

    function start(jar: CookieJar, provider: SocialProvider, body: unknown): Promise<JsonResponse> {
        return identityRequest(site.url, identityPath.socialStart(provider), {method: "POST", jar, from: from(), body});
    }

    /** 用 `google` 上游现在登录着的人做社交注册，回登录着这个新账号的浏览器（没有密码）；不成功时抛错。 */
    async function socialRegister(username: string, user: FakeGoogleUser): Promise<CookieJar> {
        const issued = await identityRequest(site.url, IDENTITY_PATHS.adminRegistrationCodes, {method: "POST", from: from(), jar: admin, body: {maxUses: 1}});
        if (issued.status !== 200 || !Value.Check(RegistrationCodeItem, issued.body)) throw new Error(`issuing a registration code answered ${String(issued.status)}`);
        upstream.setUser("google", user);
        const browser = cookieJar();
        const body = {intent: "register", username, registrationCode: issued.body.code, termsVersion: TERMS_VERSION, overseasStorage: true};
        const landing = await followSocial(site.url, browser, await start(browser, "google", body));
        if (landing.socialError !== null) throw new Error(`social registration of ${username} landed with ${landing.socialError}`);
        return browser;
    }

    /** 关联 `provider` 上游现在登录着的人；`currentPassword` 为 undefined 时不带（没有密码的账号）。 */
    async function link(jar: CookieJar, provider: SocialProvider, currentPassword?: string): Promise<SocialLanding> {
        return followSocial(site.url, jar, await start(jar, provider, {intent: "link", ...(currentPassword === undefined ? {} : {currentPassword})}));
    }

    /** 用 `provider` 上游现在登录着的人以登录意图走一次，回落点与新浏览器登录着的用户名（没有会话时为 null）。 */
    async function socialLogin(provider: SocialProvider): Promise<{readonly socialError: string | null; readonly username: string | null}> {
        const browser = cookieJar();
        const landing = await followSocial(site.url, browser, await start(browser, provider, {intent: "login"}));
        const whoami = await identityRequest(site.url, IDENTITY_PATHS.whoami, {jar: browser, from: from()});
        if (!Value.Check(WhoamiResponse, whoami.body)) throw new Error(`whoami answered ${String(whoami.status)}`);
        return {socialError: landing.socialError, username: whoami.body.state === "authenticated" ? whoami.body.user.username : null};
    }

    /** `GET me/identities`，核过形状；不是 200 时抛错。 */
    async function identities(jar: CookieJar): Promise<IdentityItem[]> {
        const response = await identityRequest(site.url, IDENTITY_PATHS.meIdentities, {jar, from: from()});
        if (response.status !== 200 || !Value.Check(IdentityListResponse, response.body)) throw new Error(`listing identities answered ${String(response.status)}: ${JSON.stringify(response.body)}`);
        return response.body.items;
    }

    async function unlink(jar: CookieJar, id: number): Promise<{readonly status: number; readonly body: unknown}> {
        const response = await identityRequest(site.url, identityPath.meIdentity(id), {method: "DELETE", jar, from: from()});
        return {status: response.status, body: response.body};
    }

    function idOf(items: readonly IdentityItem[], provider: SocialProvider): number {
        const item = items.find((candidate) => candidate.provider === provider);
        if (item === undefined) throw new Error(`no ${provider} identity is listed`);
        return item.id;
    }

    // 超出预算：社交注册与关联两次社交流程。
    it("列表（输出 24）：每项有 id、上游名、注册或关联时上游给的原样的账号名字与关联时间；按关联的先后；只列自己的", async () => {
        const nina = await socialRegister("nina", googleUser("g-nina", "Nina@Gmail.test"));
        upstream.setUser("github", githubUser(8101, "Nina-GH"));
        expect(landed(await link(nina, "github"))).toEqual({path: "/account", socialError: null});

        const items = await identities(nina);
        expect(items.map(({provider, accountName}) => ({provider, accountName}))).toEqual([
            {provider: "google", accountName: "Nina@Gmail.test"},
            {provider: "github", accountName: "Nina-GH"},
        ]);
        expect(Date.parse(items[0]!.linkedAt) <= Date.parse(items[1]!.linkedAt)).toBe(true);
        expect(new Set(items.map((item) => item.id)).size).toBe(2);
        expect(await identities(admin)).toEqual([]);
    });

    // 超出预算：社交注册、关联与两次社交登录共四次社交流程。
    it("没有密码、有两个上游身份的账号：能解绑一个；只剩一个时 last_login_method，身份还在、照样能用它登录；解绑了的上游登录得 social_not_registered（输出 16）", async () => {
        const olive = await socialRegister("olive", googleUser("g-olive"));
        upstream.setUser("github", githubUser(8102, "olive-gh"));
        expect(landed(await link(olive, "github")).socialError).toBeNull();
        const before = await identities(olive);

        expect(await unlink(olive, idOf(before, "github"))).toEqual({status: 200, body: {}});
        const remaining = await identities(olive);
        expect(remaining.map((item) => item.provider)).toEqual(["google"]);
        expect(await socialLogin("github")).toEqual({socialError: "social_not_registered", username: null});

        expect(await unlink(olive, idOf(remaining, "google"))).toEqual({status: 409, body: {error: {code: "last_login_method"}}});
        expect(await identities(olive)).toEqual(remaining);
        upstream.setUser("google", googleUser("g-olive"));
        expect(await socialLogin("google")).toEqual({socialError: null, username: "olive"});
    });

    // 超出预算：三次密码登录与设密码，另走社交注册与社交登录两次流程。
    it("社交注册的账号没有密码：用密码登录得 invalid_credentials；直接设密码（不带旧密码）之后能用它登录，也就能解绑最后一个上游身份（输出 4、9、16）", async () => {
        const piper = await socialRegister("piper", googleUser("g-piper"));
        for (const identifier of ["piper", "g-piper@gmail.test"]) {
            const attempt = await login(site.url, identifier, NEW_PASSWORD, {from: from()});
            expect({identifier, status: attempt.status, body: attempt.body}).toEqual({identifier, status: 401, body: {error: {code: "invalid_credentials"}}});
        }

        const set = await identityRequest(site.url, IDENTITY_PATHS.mePassword, {method: "POST", jar: piper, from: from(), body: {newPassword: NEW_PASSWORD}});
        expect({status: set.status, body: set.body}).toEqual({status: 200, body: {}});
        expect((await login(site.url, "piper", NEW_PASSWORD, {from: from()})).status).toBe(200);

        expect(await unlink(piper, idOf(await identities(piper), "google"))).toEqual({status: 200, body: {}});
        expect(await identities(piper)).toEqual([]);
        upstream.setUser("google", googleUser("g-piper"));
        expect(await socialLogin("google")).toEqual({socialError: "social_not_registered", username: null});
    });

    // 超出预算：两次密码登录与三次关联各算一次密码哈希，另走三次社交登录。
    it("有密码、只关联了一个上游身份的账号能解绑它（输出 16）；解绑后这个身份马上能再被关联，自己与别的账号都行，不被上一次关联挡住", async () => {
        const pat = cookieJar();
        const quinn = cookieJar();
        await signIn(pat, "pat");
        await signIn(quinn, "quinn");
        upstream.setUser("google", googleUser("g-pat"));
        expect(landed(await link(pat, "google", PASSWORD)).socialError).toBeNull();

        expect(await unlink(pat, idOf(await identities(pat), "google"))).toEqual({status: 200, body: {}});
        expect(await identities(pat)).toEqual([]);
        expect(await socialLogin("google")).toEqual({socialError: "social_not_registered", username: null});

        expect(landed(await link(pat, "google", PASSWORD))).toEqual({path: "/account", socialError: null});
        expect(await socialLogin("google")).toEqual({socialError: null, username: "pat"});

        expect(await unlink(pat, idOf(await identities(pat), "google"))).toEqual({status: 200, body: {}});
        expect(landed(await link(quinn, "google", PASSWORD))).toEqual({path: "/account", socialError: null});
        expect(await socialLogin("google")).toEqual({socialError: null, username: "quinn"});
        expect((await identities(quinn)).map(({provider, accountName}) => ({provider, accountName}))).toEqual([{provider: "google", accountName: "g-pat@gmail.test"}]);
    });

    // 超出预算：两次社交注册与一次关联共三次社交流程。
    it("别人的、不存在的身份 id 回 not_found，那个身份不受影响；id 不是正整数时 validation_failed；没有会话时 unauthenticated（输出 16，失败表）", async () => {
        const rita = await socialRegister("rita", googleUser("g-rita"));
        const sam = await socialRegister("sam", googleUser("g-sam"));
        upstream.setUser("github", githubUser(8103, "sam-gh"));
        expect(landed(await link(sam, "github")).socialError).toBeNull();
        const ritas = await identities(rita);

        expect(await unlink(sam, idOf(ritas, "google"))).toEqual({status: 404, body: {error: {code: "not_found"}}});
        expect(await unlink(sam, 2_000_000_000)).toEqual({status: 404, body: {error: {code: "not_found"}}});
        expect(await identities(rita)).toEqual(ritas);
        expect((await identities(sam)).length).toBe(2);

        const malformed = await identityRequest(site.url, `${IDENTITY_PATHS.meIdentities}/abc`, {method: "DELETE", jar: sam, from: from()});
        expect({status: malformed.status, body: malformed.body}).toEqual({status: 400, body: {error: {code: "validation_failed", fields: ["id"]}}});
        for (const method of ["GET", "DELETE"] as const) {
            const path = method === "GET" ? IDENTITY_PATHS.meIdentities : identityPath.meIdentity(idOf(ritas, "google"));
            const anonymous = await identityRequest(site.url, path, {method, from: from()});
            expect({method, status: anonymous.status, body: anonymous.body}).toEqual({method, status: 401, body: {error: {code: "unauthenticated"}}});
        }
        expect(await identities(rita)).toEqual(ritas);
    });
});
