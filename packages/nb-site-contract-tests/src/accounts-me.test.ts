/**
 * 改资料、自己的会话与邀请码的黑盒合同（docs/specs/site/accounts.md 输出 1 的邀请那半句、8、10 的门槛、17、18、22，失败表的
 * `email_taken`、`invite_code_limit`、`not_found`，验收 6）：起真实的 `nb-site` 进程，只经 HTTP 与命令行看它。登录态用
 * `create-admin` 建的账号造；用邀请码注册要的注册码由其中一个管理员经管理接口发放（`site.admin` 输出 7）。
 *
 * 本文件测不到、在别处的：
 * - 邀请人：输出 1 的“管理详情里邀请人是它的主人”在 `admin.test.ts` 的账号详情用例，这里只看邀请码列表里的已用次数；库里记下的
 *   邀请人另在账号包的 `invite-codes.test.ts`。
 * - 过期、用完与旧站导入的邀请码：生成的码不限次数、不过期，合同里造不出；在账号包的 `invite-codes.test.ts`、`register.test.ts`。
 * - 会话列表里同一时刻建的会话的先后、最后使用时间按小时更新、列里存了别的写法：要拨库的时钟或改库，在账号包的
 *   `my-sessions.test.ts`。
 * - 写事务复核会话、并发的生成不越过上限：要在两步之间插入动作，在账号包的 `me.test.ts`、`invite-codes.test.ts`。
 *
 * 时间预算：起进程、跑命令放在 `beforeAll` 里；用例只发请求。超出 200 毫秒的用例在旁边写明原因。
 */

import {beforeAll, describe, expect, it} from "bun:test";
import {Value} from "typebox/value";

import {
    EmptyResponse,
    ErrorBody,
    IDENTITY_PATHS,
    identityPath,
    InviteCodeItem,
    InviteCodeListResponse,
    MeResponse,
    RegistrationCodeItem,
    SessionListResponse,
} from "@notnotype/nb-site-identity-contract";

import {cookieJar, createAdmin, IDENTITY_SITE_ENV, identityRequest, login, type CookieJar} from "./testing/identity";
import {useSiteSandbox, type JsonResponse, type SiteProcess} from "./testing/site";

const sandbox = useSiteSandbox("nb-site-contract-tests accounts-me.test.ts");

const SETUP_TIMEOUT_MS = 30_000;
const TERMS_VERSION = "2026-11-20";
const PASSWORD = "owner-PW-w6Lm93";
/** 会话 Cookie 的名字（`site.accounts` 输出 5）。 */
const SESSION_COOKIE = "__Host-nbsite.session_token";

const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0";
const CHROME_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function outcome(response: JsonResponse): {readonly status: number; readonly body: unknown} {
    return {status: response.status, body: response.body};
}

/** 失败的响应：形状合 `ErrorBody`，再比状态码与体。 */
function failure(response: JsonResponse): {readonly status: number; readonly body: unknown} {
    expect(Value.Check(ErrorBody, response.body)).toBe(true);
    return outcome(response);
}

const rejected = (code: string, status: number) => ({status, body: {error: {code}}});
const consentRequired = rejected("consent_required", 403);
const unauthenticated = rejected("unauthenticated", 401);
const notFound = rejected("not_found", 404);

/** 罐里会话 Cookie 的 `名字=值`，结束之后仍拿它去问（罐会把清掉的删了）。 */
function sessionHeader(jar: CookieJar): string {
    const cookie = jar.last(SESSION_COOKIE);
    if (cookie === undefined || cookie.value === "") throw new Error("no session cookie in the jar");
    return `${SESSION_COOKIE}=${cookie.value}`;
}

describe("改资料、自己的会话与邀请码（输出 1、8、17、18）", () => {
    let site: SiteProcess;
    let address = 0;
    const from = () => `198.51.100.${String(++address)}`;

    beforeAll(async () => {
        const dataDir = await sandbox.dataDir();
        // 第一个命令在空的数据目录上先执行迁移；之后的可以同时跑。
        await createAdmin(sandbox, dataDir, ["profile", "profile@example.com"], PASSWORD);
        await Promise.all([
            createAdmin(sandbox, dataDir, ["taken", "taken@example.com"], PASSWORD),
            createAdmin(sandbox, dataDir, ["nomail"], PASSWORD),
            createAdmin(sandbox, dataDir, ["devices", "devices@example.com"], PASSWORD),
            createAdmin(sandbox, dataDir, ["inviter", "inviter@example.com"], PASSWORD),
            createAdmin(sandbox, dataDir, ["gated", "gated@example.com"], PASSWORD),
        ]);
        site = await sandbox.start({dataDir, env: IDENTITY_SITE_ENV});
    }, SETUP_TIMEOUT_MS);

    /** 登录（可以给 `User-Agent`）并补交同意，返回装着会话的罐。 */
    async function consented(username: string, userAgent?: string): Promise<CookieJar> {
        const jar = cookieJar();
        const source = from();
        const headers: Record<string, string> = userAgent === undefined ? {} : {"User-Agent": userAgent};
        expect((await login(site.url, username, PASSWORD, {from: source, jar, headers})).status).toBe(200);
        expect((await identityRequest(site.url, IDENTITY_PATHS.meConsent, {method: "POST", from: source, jar, body: {termsVersion: TERMS_VERSION, overseasStorage: true}})).status).toBe(200);
        return jar;
    }

    const patchMe = (jar: CookieJar, body: unknown) => identityRequest(site.url, IDENTITY_PATHS.me, {method: "PATCH", from: from(), jar, body});
    const getMe = (jar: CookieJar) => identityRequest(site.url, IDENTITY_PATHS.me, {from: from(), jar});
    const listSessions = (jar: CookieJar) => identityRequest(site.url, IDENTITY_PATHS.meSessions, {from: from(), jar});
    const endSession = (jar: CookieJar, id: number) => identityRequest(site.url, identityPath.meSession(id), {method: "DELETE", from: from(), jar});
    const listCodes = (jar: CookieJar) => identityRequest(site.url, IDENTITY_PATHS.meInviteCodes, {from: from(), jar});
    const generate = (jar: CookieJar) => identityRequest(site.url, IDENTITY_PATHS.meInviteCodes, {method: "POST", from: from(), jar});
    const disable = (jar: CookieJar, id: number) => identityRequest(site.url, identityPath.meInviteCode(id), {method: "PATCH", from: from(), jar, body: {disabled: true}});

    async function generated(jar: CookieJar): Promise<InviteCodeItem> {
        const response = await generate(jar);
        expect({status: response.status, shape: Value.Check(InviteCodeItem, response.body)}).toEqual({status: 200, shape: true});
        return response.body as InviteCodeItem;
    }

    async function codes(jar: CookieJar): Promise<InviteCodeItem[]> {
        const response = await listCodes(jar);
        expect({status: response.status, shape: Value.Check(InviteCodeListResponse, response.body)}).toEqual({status: 200, shape: true});
        return [...(response.body as InviteCodeListResponse).items];
    }

    // 超出 200 毫秒的预算：登录算一次密码哈希。
    it("改资料（Smoke）：每个字段单独改，回更新后的资料、me 读到同样的；邮箱转小写；头像、网站、签名给 null 清空", async () => {
        const jar = await consented("profile");
        const cases = [
            [{displayName: "Profile Shown"}, {displayName: "Profile Shown"}],
            [{avatarUrl: "https://cdn.example/profile.png"}, {avatarUrl: "https://cdn.example/profile.png"}],
            [{website: "http://profile.example"}, {website: "http://profile.example"}],
            [{bio: "写长篇的人 🌸"}, {bio: "写长篇的人 🌸"}],
            [{email: "Profile.New@Example.COM"}, {email: "profile.new@example.com", emailPending: false}],
            [{avatarUrl: null, website: null, bio: null}, {avatarUrl: null, website: null, bio: null}],
        ] as const;
        for (const [body, expected] of cases) {
            const response = await patchMe(jar, body);
            expect({body, status: response.status, shape: Value.Check(MeResponse, response.body)}).toEqual({body, status: 200, shape: true});
            expect(response.body).toMatchObject({username: "profile", ...expected});
            expect((await getMe(jar)).body).toEqual(response.body);
        }
        expect((await login(site.url, "PROFILE.NEW@example.com", PASSWORD, {from: from()})).status).toBe(200);
    });

    // 超出 200 毫秒的预算：登录算一次密码哈希。
    it("拒收：空对象 fields 为空数组；多余的键（含用户名）、不是 http 或 https 的地址、.invalid 结尾的邮箱列出字段；邮箱是别人的得 email_taken；改成自己现在的邮箱照样成功", async () => {
        const jar = await consented("taken");
        const before = (await getMe(jar)).body;
        const cases: readonly (readonly [body: unknown, fields: readonly string[]])[] = [
            [{}, []],
            [{username: "renamed"}, ["username"]],
            [{avatarUrl: "ftp://cdn.example/a.png"}, ["avatarUrl"]],
            [{website: "https://"}, ["website"]],
            [{email: "taken@placeholder.invalid"}, ["email"]],
        ];
        for (const [body, fields] of cases) expect({request: body, ...failure(await patchMe(jar, body))}).toEqual({request: body, status: 400, body: {error: {code: "validation_failed", fields}}});
        expect(failure(await patchMe(jar, {displayName: "Changed", email: "INVITER@example.com"}))).toEqual(rejected("email_taken", 409));
        expect((await getMe(jar)).body).toEqual(before);
        const same = await patchMe(jar, {email: "TAKEN@example.com"});
        expect({status: same.status, email: (same.body as MeResponse).email}).toEqual({status: 200, email: "taken@example.com"});
    });

    // 超出 200 毫秒的预算：两次登录各算一次密码哈希。
    it("邮箱待补的账号补上邮箱：emailPending 清掉，之后能用这个邮箱登录", async () => {
        const jar = await consented("nomail");
        expect((await getMe(jar)).body).toMatchObject({email: null, emailPending: true});
        expect((await patchMe(jar, {email: "nomail@example.org"})).body).toMatchObject({email: "nomail@example.org", emailPending: false});
        expect((await login(site.url, "nomail@example.org", PASSWORD, {from: from()})).status).toBe(200);
    });

    // 超出 200 毫秒的预算：三次登录各算一次密码哈希。
    it("会话列表：只给浏览器与系统的名字，认不出的为 null，标出当前会话；结束别的会话后它的 Cookie 得 unauthenticated；结束当前会话清 Cookie", async () => {
        const firefox = await consented("devices", FIREFOX_LINUX);
        const chrome = await consented("devices", CHROME_WINDOWS);
        const unknown = await consented("devices", "curl/8.10.1");

        const listed = await listSessions(chrome);
        expect({status: listed.status, shape: Value.Check(SessionListResponse, listed.body)}).toEqual({status: 200, shape: true});
        const text = JSON.stringify(listed.body);
        expect(text).not.toContain("Mozilla");
        expect(text).not.toContain("curl");
        // 三个会话的建立时间可能落在同一毫秒，先后按合同是“建立时间倒序、再按 id 倒序”，这里只比集合。
        const items = (listed.body as SessionListResponse).items;
        expect(items.map(({browser, os, current}) => ({browser, os, current})).sort((a, b) => String(a.browser).localeCompare(String(b.browser)))).toEqual([
            {browser: "Chrome", os: "Windows", current: true},
            {browser: "Firefox", os: "Linux", current: false},
            {browser: null, os: null, current: false},
        ]);
        expect(items.map((item) => item.createdAt)).toEqual(items.map((item) => item.createdAt).sort().reverse());

        const firefoxId = items.find((item) => item.browser === "Firefox")!.id;
        const ended = await endSession(chrome, firefoxId);
        expect({...outcome(ended), shape: Value.Check(EmptyResponse, ended.body), setCookies: ended.headers.getSetCookie()}).toEqual({status: 200, body: {}, shape: true, setCookies: []});
        expect(failure(await identityRequest(site.url, IDENTITY_PATHS.me, {from: from(), headers: {Cookie: sessionHeader(firefox)}}))).toEqual(unauthenticated);
        expect(((await listSessions(chrome)).body as SessionListResponse).items).toHaveLength(2);

        const currentId = items.find((item) => item.current)!.id;
        const endedCurrent = await endSession(chrome, currentId);
        expect(outcome(endedCurrent)).toEqual({status: 200, body: {}});
        expect(chrome.last(SESSION_COOKIE)?.attributes.get("max-age")).toBe("0");
        expect(chrome.names()).toEqual([]);
        // 结束的只是那两个：第三个会话照常可用。
        expect((await getMe(unknown)).status).toBe(200);
    });

    // 超出 200 毫秒的预算：两次登录各算一次密码哈希。
    it("结束别人的会话与不存在的会话：not_found，别人的会话照常可用", async () => {
        const mine = await consented("profile");
        const theirs = await consented("taken");
        const theirId = ((await listSessions(theirs)).body as SessionListResponse).items.find((item) => item.current)!.id;
        expect(failure(await endSession(mine, theirId))).toEqual(notFound);
        expect(failure(await endSession(mine, theirId + 10_000))).toEqual(notFound);
        expect((await getMe(theirs)).status).toBe(200);
    });

    // 超出 200 毫秒的预算：登录与三次注册各算一次密码哈希，另生成十几个码。
    it("邀请码：第 11 个得 invite_code_limit，停用一个后能再生成；用邀请码注册后列表里已用次数加 1；停用的码注册得 invite_code_invalid；别人的码 not_found", async () => {
        const jar = await consented("inviter");
        const first = await generated(jar);
        expect(first).toMatchObject({usedCount: 0, maxUses: null, expiresAt: null, usable: true});
        for (let index = 1; index < 10; index += 1) await generated(jar);
        expect(failure(await generate(jar))).toEqual(rejected("invite_code_limit", 409));
        const second = (await codes(jar)).find((item) => item.id !== first.id)!;
        const disabled = await disable(jar, second.id);
        expect({status: disabled.status, body: disabled.body}).toEqual({status: 200, body: {...second, usable: false}});
        expect((await disable(jar, second.id)).status).toBe(200);
        await generated(jar);
        expect(failure(await generate(jar))).toEqual(rejected("invite_code_limit", 409));

        // 用邀请码注册要一个注册码：这个管理员经管理接口发一个。
        const issued = await identityRequest(site.url, IDENTITY_PATHS.adminRegistrationCodes, {method: "POST", from: from(), jar, body: {maxUses: null}});
        expect(Value.Check(RegistrationCodeItem, issued.body)).toBe(true);
        const registrationCode = (issued.body as RegistrationCodeItem).code;
        const register = (username: string, inviteCode: string) =>
            identityRequest(site.url, IDENTITY_PATHS.register, {
                method: "POST",
                from: from(),
                body: {username, email: `${username}@example.com`, password: PASSWORD, registrationCode, inviteCode, termsVersion: TERMS_VERSION, overseasStorage: true},
            });
        expect((await register("invited1", first.code)).status).toBe(200);
        expect((await register("invited2", first.code)).status).toBe(200);
        expect((await codes(jar)).find((item) => item.id === first.id)).toEqual({...first, usedCount: 2});
        expect(failure(await register("invited3", second.code))).toEqual(rejected("invite_code_invalid", 422));

        const other = await consented("profile");
        expect(failure(await disable(other, first.id))).toEqual(notFound);
        expect((await codes(other)).map((item) => item.id)).not.toContain(first.id);
        expect((await codes(jar)).find((item) => item.id === first.id)?.usable).toBe(true);
    });

    // 超出 200 毫秒的预算：登录算一次密码哈希。
    it("在同意门槛之内：缺同意时改资料、会话列表与结束、邀请码的列表、生成与停用都得 consent_required；me 照常读", async () => {
        const jar = cookieJar();
        expect((await login(site.url, "gated", PASSWORD, {from: from(), jar})).status).toBe(200);
        const cases = [
            ["PATCH me", await patchMe(jar, {displayName: "Changed"})],
            ["GET me/sessions", await listSessions(jar)],
            ["DELETE me/sessions/:id", await endSession(jar, 1)],
            ["GET me/invite-codes", await listCodes(jar)],
            ["POST me/invite-codes", await generate(jar)],
            ["PATCH me/invite-codes/:id", await disable(jar, 1)],
        ] as const;
        for (const [name, response] of cases) expect({name, ...failure(response)}).toEqual({name, ...consentRequired});
        expect((await getMe(jar)).body).toMatchObject({displayName: "gated", consentRequired: true});
    });
});

describe("验收 6：条款版本提高后（输出 10）", () => {
    const NEW_TERMS_VERSION = "2026-12-01";
    let restarted: SiteProcess;
    let jar: CookieJar;
    let code: InviteCodeItem;

    beforeAll(async () => {
        const dataDir = await sandbox.dataDir();
        await createAdmin(sandbox, dataDir, ["terms", "terms@example.com"], PASSWORD);
        const first = await sandbox.start({dataDir, env: IDENTITY_SITE_ENV});
        jar = cookieJar();
        if ((await login(first.url, "terms", PASSWORD, {from: "203.0.113.80", jar})).status !== 200) throw new Error("the account could not sign in");
        const consent = await identityRequest(first.url, IDENTITY_PATHS.meConsent, {method: "POST", from: "203.0.113.80", jar, body: {termsVersion: TERMS_VERSION, overseasStorage: true}});
        if (consent.status !== 200) throw new Error("the account could not consent");
        const generatedCode = await identityRequest(first.url, IDENTITY_PATHS.meInviteCodes, {method: "POST", from: "203.0.113.80", jar});
        if (generatedCode.status !== 200) throw new Error(`generating an invite code answered ${String(generatedCode.status)}`);
        code = generatedCode.body as InviteCodeItem;
        await first.stop();
        restarted = await sandbox.start({dataDir, env: {...IDENTITY_SITE_ENV, NB_SITE_IDENTITY_TERMS_VERSION: NEW_TERMS_VERSION}});
    }, SETUP_TIMEOUT_MS);

    it("旧会话调 me/invite-codes 得 consent_required；补交新版本的同意后恢复，码还在", async () => {
        const list = () => identityRequest(restarted.url, IDENTITY_PATHS.meInviteCodes, {from: "203.0.113.81", jar});
        expect(failure(await list())).toEqual(consentRequired);
        expect((await identityRequest(restarted.url, IDENTITY_PATHS.me, {from: "203.0.113.81", jar})).body).toMatchObject({consentRequired: true});
        expect(failure(await identityRequest(restarted.url, IDENTITY_PATHS.meConsent, {method: "POST", from: "203.0.113.81", jar, body: {termsVersion: TERMS_VERSION, overseasStorage: true}}))).toEqual(consentRequired);
        const accepted = await identityRequest(restarted.url, IDENTITY_PATHS.meConsent, {method: "POST", from: "203.0.113.81", jar, body: {termsVersion: NEW_TERMS_VERSION, overseasStorage: true}});
        expect(accepted.status).toBe(200);
        const recovered = await list();
        expect({status: recovered.status, body: recovered.body}).toEqual({status: 200, body: {items: [code]}});
    });
});
