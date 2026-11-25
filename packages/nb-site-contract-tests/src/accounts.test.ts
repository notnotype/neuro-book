/**
 * 账号接口的黑盒合同（docs/specs/site/accounts.md 输出 4 到 10、22，输入一节的来源头，失败表）：起真实的 `nb-site` 进程，只经
 * HTTP 与命令行看它。登录态用 `create-admin` 建的账号造（注册在后面的片）。响应的形状用合同包的 schema 核对（`Value.Check`）。另
 * 核对账号接口的响应都带 `Cache-Control: no-store`（w00037 t07 实现审查第 5 条）。限流、过载与重启在 `accounts-limits.test.ts`。
 *
 * 本文件测不到、在别处的：
 * - `whoami` 的 503：合同底座只能持写锁，`whoami` 只读、不受写锁影响，造不出“库不可读”；在账号包的 `session.test.ts`。
 * - 没有密码的账号（输出 4 的第三种 `invalid_credentials`、输出 9 的直接设密码）：只有导入与社交注册造得出，在账号包的
 *   `login.test.ts`、`change-password.test.ts`；t08 补合同用例。
 * - 三种失败的响应时间不可分辨：量响应时间在共享的机器上不稳，在账号包里数校验的调用、用注入的睡眠核对下限。
 *
 * 时间预算：起进程、跑命令放在 `beforeAll` 里；用例只发请求。超出 200 毫秒的用例在旁边写明原因。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {Value} from "typebox/value";

import {EmptyResponse, ErrorBody, IDENTITY_PATHS, LoginResponse, MeResponse, MetaResponse, WhoamiResponse} from "@notnotype/nb-site-identity-contract";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {holdWriteLock} from "./testing/fault";
import {cookieJar, createAdmin, IDENTITY_SITE_ENV, identityRequest, login, type CookieJar} from "./testing/identity";
import {requestJson, SANDBOX_SITE_URL, useSiteSandbox, type JsonResponse, type SiteProcess} from "./testing/site";

const sandbox = useSiteSandbox("nb-site-contract-tests accounts.test.ts");

const SETUP_TIMEOUT_MS = 30_000;

const SITE_HOST = new URL(SANDBOX_SITE_URL).host;

/** 请求体的上限（`site.accounts` 输出 22）。 */
const MAX_BODY_BYTES = 16 * 1024;

/**
 * 会话 Cookie 的名字是合同（`site.accounts` 输出 5）：版本之间不变，变了等于让所有人登出。`__Host-` 前缀是浏览器的规则：只收
 * Secure、`Path=/`、不带 `Domain` 的，同一上级域名下的别的子域写不进同名的 Cookie。
 */
const SESSION_COOKIE = "__Host-nbsite.session_token";

const validationFailed = {status: 400, body: {error: {code: "validation_failed", fields: []}}};

function outcome(response: JsonResponse): {readonly status: number; readonly body: unknown} {
    return {status: response.status, body: response.body};
}

/** 失败的响应：形状合 `ErrorBody`，再比状态码与体。 */
function failure(response: JsonResponse): {readonly status: number; readonly body: unknown} {
    expect(Value.Check(ErrorBody, response.body)).toBe(true);
    return outcome(response);
}

describe("不要会话的接口（输出 7、22）", () => {
    let site: SiteProcess;
    let dataDir: string;
    let address = 0;
    /** 每个用例一个来源地址。 */
    const from = () => `203.0.113.${String(++address)}`;

    beforeAll(async () => {
        dataDir = await sandbox.dataDir();
        site = await sandbox.start({dataDir, env: IDENTITY_SITE_ENV});
    }, SETUP_TIMEOUT_MS);

    it("没有会话时 whoami 回 anonymous（Smoke）", async () => {
        const response = await identityRequest(site.url, IDENTITY_PATHS.whoami, {from: from()});
        expect(outcome(response)).toEqual({status: 200, body: {state: "anonymous"}});
        expect(Value.Check(WhoamiResponse, response.body)).toBe(true);
        expect(response.headers.getSetCookie()).toEqual([]);
    });

    it("签名不对的 Cookie 也是 anonymous", async () => {
        const response = await identityRequest(site.url, IDENTITY_PATHS.whoami, {from: from(), headers: {Cookie: `${SESSION_COOKIE}=forged.value`}});
        expect(outcome(response)).toEqual({status: 200, body: {state: "anonymous"}});
    });

    it("meta 回当前条款版本、注册是否开放、两个上游都没开放", async () => {
        const response = await identityRequest(site.url, IDENTITY_PATHS.meta, {from: from()});
        expect(response.status).toBe(200);
        expect(Value.Check(MetaResponse, response.body)).toBe(true);
        expect(response.body).toMatchObject({termsVersion: "2026-11-20", providers: {google: false, github: false}});
    });

    it("没有会话时 logout 也成功：回 {}，并清会话 Cookie（HttpOnly、Secure、SameSite=Lax、Path=/、不带 Domain）", async () => {
        const jar = cookieJar();
        const response = await identityRequest(site.url, IDENTITY_PATHS.logout, {method: "POST", from: from(), jar});
        expect(outcome(response)).toEqual({status: 200, body: {}});
        expect(Value.Check(EmptyResponse, response.body)).toBe(true);
        const cleared = jar.last(SESSION_COOKIE);
        expect(cleared?.value).toBe("");
        expect(cleared?.attributes.get("max-age")).toBe("0");
        expect(cleared?.attributes.has("httponly")).toBe(true);
        expect(cleared?.attributes.has("secure")).toBe(true);
        expect(cleared?.attributes.get("samesite")?.toLowerCase()).toBe("lax");
        expect(cleared?.attributes.get("path")).toBe("/");
        expect(cleared?.attributes.has("domain")).toBe(false);
        expect(jar.names()).toEqual([]);
    });

    it("响应都带 Cache-Control: no-store：成功、出错出口、请求体上限与兜底 404 都是", async () => {
        const cases = [
            ["GET whoami", await identityRequest(site.url, IDENTITY_PATHS.whoami, {from: from()})],
            ["GET meta", await identityRequest(site.url, IDENTITY_PATHS.meta, {from: from()})],
            ["POST logout", await identityRequest(site.url, IDENTITY_PATHS.logout, {method: "POST", from: from()})],
            ["validation_failed", await identityRequest(site.url, IDENTITY_PATHS.logout, {method: "POST", from: from(), body: `{"a":1}`})],
            ["body too large", await identityRequest(site.url, IDENTITY_PATHS.logout, {method: "POST", from: from(), body: `{${" ".repeat(MAX_BODY_BYTES)}}`})],
            ["forbidden_origin", await identityRequest(site.url, IDENTITY_PATHS.logout, {method: "POST", from: from(), headers: {Origin: null}})],
            ["not_found", await identityRequest(site.url, "/no-such-path", {from: from()})],
        ] as const;
        expect(cases.map(([name, response]) => ({name, status: response.status, cacheControl: response.headers.get("cache-control")}))).toEqual([
            {name: "GET whoami", status: 200, cacheControl: "no-store"},
            {name: "GET meta", status: 200, cacheControl: "no-store"},
            {name: "POST logout", status: 200, cacheControl: "no-store"},
            {name: "validation_failed", status: 400, cacheControl: "no-store"},
            {name: "body too large", status: 400, cacheControl: "no-store"},
            {name: "forbidden_origin", status: 403, cacheControl: "no-store"},
            {name: "not_found", status: 404, cacheControl: "no-store"},
        ]);
    });

    it("改状态的请求不带来源头、或来源头不是站点地址：forbidden_origin；只读的 GET 不要来源头", async () => {
        const forbidden = {status: 403, body: {error: {code: "forbidden_origin"}}};
        expect(failure(await identityRequest(site.url, IDENTITY_PATHS.logout, {method: "POST", from: from(), headers: {Origin: null}}))).toEqual(forbidden);
        expect(failure(await identityRequest(site.url, IDENTITY_PATHS.logout, {method: "POST", from: from(), headers: {Origin: "https://evil.test"}}))).toEqual(forbidden);
        expect(failure(await identityRequest(site.url, "/no-such-path", {method: "POST", from: from(), headers: {Origin: null}}))).toEqual(forbidden);
        expect((await identityRequest(site.url, IDENTITY_PATHS.whoami, {from: from(), headers: {Origin: null}})).status).toBe(200);
    });

    it("不需要参数的写接口：空体与 {} 过；有键的对象、数组被拒，fields 为空数组", async () => {
        const logout = (body: string | undefined) => identityRequest(site.url, IDENTITY_PATHS.logout, {method: "POST", from: from(), ...(body === undefined ? {} : {body})});
        expect(outcome(await logout(undefined))).toEqual({status: 200, body: {}});
        expect(outcome(await logout("{}"))).toEqual({status: 200, body: {}});
        expect(failure(await logout(`{"a":1}`))).toEqual(validationFailed);
        expect(failure(await logout("[]"))).toEqual(validationFailed);
    });

    it("请求体不是 JSON、不是对象：validation_failed，fields 为空数组；只有 UTF-8 BOM 的体有字节、不是空体，同样被拒", async () => {
        for (const body of ["not json", "{", "null", "1", `"text"`, "﻿"]) {
            expect(failure(await identityRequest(site.url, IDENTITY_PATHS.logout, {method: "POST", from: from(), body}))).toEqual(validationFailed);
        }
    });

    it("请求体超过 16 KiB：定长与分块传输都回 validation_failed，fields 为空数组；正好 16 KiB 的照常读", async () => {
        // 用空白把空对象撑到指定的字节数：它合空体的规则，被拒只可能是因为大小。
        const exact = `{${" ".repeat(MAX_BODY_BYTES - 2)}}`;
        const over = `{${" ".repeat(MAX_BODY_BYTES - 1)}}`;
        expect([Buffer.byteLength(exact), Buffer.byteLength(over)]).toEqual([MAX_BODY_BYTES, MAX_BODY_BYTES + 1]);
        expect(outcome(await identityRequest(site.url, IDENTITY_PATHS.logout, {method: "POST", from: from(), body: exact}))).toEqual({status: 200, body: {}});
        expect(failure(await identityRequest(site.url, IDENTITY_PATHS.logout, {method: "POST", from: from(), body: over}))).toEqual(validationFailed);

        // 流式的请求体没有 Content-Length，按分块传输发：服务端边读边数。
        const chunked = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode(`{${" ".repeat(20_000)}}`));
                controller.close();
            },
        });
        expect(failure(await identityRequest(site.url, IDENTITY_PATHS.logout, {method: "POST", from: from(), body: chunked}))).toEqual(validationFailed);
    });

    it("请求体超过 16 KiB 又不带来源头、或来源头不对：forbidden_origin，来源头排在请求体的上限之前（失败与恢复的先后）", async () => {
        const over = `{${" ".repeat(MAX_BODY_BYTES - 1)}}`;
        const forbidden = {status: 403, body: {error: {code: "forbidden_origin"}}};
        expect(failure(await identityRequest(site.url, IDENTITY_PATHS.logout, {method: "POST", from: from(), headers: {Origin: null}, body: over}))).toEqual(forbidden);
        expect(failure(await identityRequest(site.url, IDENTITY_PATHS.logout, {method: "POST", from: from(), headers: {Origin: "https://evil.test"}, body: over}))).toEqual(forbidden);
    });

    it("前缀下没有的路径与方法：404 not_found 的 ErrorBody，含前缀本身", async () => {
        const notFound = {status: 404, body: {error: {code: "not_found"}}};
        for (const [method, path] of [
            ["GET", ""],
            ["GET", "/"],
            ["GET", "/no-such-path"],
            ["GET", "/auth/get-session"],
            ["POST", "/no-such-path"],
            ["PUT", IDENTITY_PATHS.logout],
            ["GET", IDENTITY_PATHS.logout],
            ["DELETE", IDENTITY_PATHS.whoami],
            ["POST", IDENTITY_PATHS.meta],
        ] as const) {
            const response = await identityRequest(site.url, path, {method, from: from()});
            expect({method, path, ...failure(response)}).toEqual({method, path, ...notFound});
        }
    });

    it("库自带的端点从外部到不了：库的路由前缀下是 404", async () => {
        for (const path of ["/api/identity/auth/get-session", "/api/identity/auth/ok", "/api/identity/auth/nb-session/clear"]) {
            const response = await requestJson(new URL(path.slice(1), site.url).href, {method: "GET", headers: {Host: SITE_HOST, "X-Forwarded-For": from()}});
            expect({path, status: response.status}).toEqual({path, status: 404});
        }
    });

    it("账号库被进程外占着写时，whoami 与 meta 照常回答", async () => {
        const release = holdWriteLock(dataDir, "identity");
        try {
            expect(outcome(await identityRequest(site.url, IDENTITY_PATHS.whoami, {from: from()}))).toEqual({status: 200, body: {state: "anonymous"}});
            expect((await identityRequest(site.url, IDENTITY_PATHS.meta, {from: from()})).status).toBe(200);
        } finally {
            release();
        }
    });

    it("清理任务 purge 能经测试控制入口跑一次", async () => {
        expect(await site.runJob("identity", "purge")).toMatchObject({status: 200});
    });

    it("账号库被进程外占着写时手动跑 purge 得 500 job_failed；放锁后再跑成功", async () => {
        const release = holdWriteLock(dataDir, "identity");
        let locked: JsonResponse;
        try {
            locked = await site.runJob("identity", "purge");
        } finally {
            release();
        }
        expect(outcome(locked)).toEqual({status: 500, body: {code: "job_failed", module: "identity", job: "purge"}});
        expect(outcome(await site.runJob("identity", "purge"))).toEqual({status: 200, body: {status: "done"}});
    });
});

const DAY_MS = 86_400_000;
/** 会话时长的缺省值（`NB_SITE_IDENTITY_SESSION_DAYS`）。 */
const SESSION_MS = 30 * DAY_MS;
const TERMS_VERSION = "2026-11-20";

const invalidCredentials = {status: 401, body: {error: {code: "invalid_credentials"}}};
const consentRequired = {status: 403, body: {error: {code: "consent_required"}}};
const unavailable = {status: 503, body: {error: {code: "unavailable"}}};

/** 罐里会话 Cookie 的 `名字=值`，登出、失效之后仍拿它去问（罐会把清掉的删了）。 */
function sessionHeader(jar: CookieJar): string {
    const cookie = jar.last(SESSION_COOKIE);
    if (cookie === undefined || cookie.value === "") throw new Error("no session cookie in the jar");
    return `${SESSION_COOKIE}=${cookie.value}`;
}

describe("登录、会话、me 与同意（输出 4、5、6、7、8、9、10）", () => {
    const PASSWORD = "root-PW-x4Hq27";
    const NEW_PASSWORD = "changed-PW-p9Rt35";
    let site: SiteProcess;
    let dataDir: string;
    let rootId: number;
    let address = 0;
    const from = () => `198.51.100.${String(++address)}`;

    beforeAll(async () => {
        dataDir = await sandbox.dataDir();
        // 第一个命令在空的数据目录上先执行迁移；之后的可以同时跑。
        rootId = await createAdmin(sandbox, dataDir, ["root", "root@example.com"], PASSWORD);
        await Promise.all([
            createAdmin(sandbox, dataDir, ["nomail"], PASSWORD),
            createAdmin(sandbox, dataDir, ["gated", "gated@example.com"], PASSWORD),
            createAdmin(sandbox, dataDir, ["changer", "changer@example.com"], PASSWORD),
        ]);
        site = await sandbox.start({dataDir, env: IDENTITY_SITE_ENV});
    }, SETUP_TIMEOUT_MS);

    async function whoami(cookie: string): Promise<JsonResponse> {
        return identityRequest(site.url, IDENTITY_PATHS.whoami, {from: from(), headers: {Cookie: cookie}});
    }

    /** 登录并补交同意，返回装着会话的罐。 */
    async function consented(username: string, password: string): Promise<CookieJar> {
        const jar = cookieJar();
        const source = from();
        expect((await login(site.url, username, password, {from: source, jar})).status).toBe(200);
        expect((await identityRequest(site.url, IDENTITY_PATHS.meConsent, {method: "POST", from: source, jar, body: {termsVersion: TERMS_VERSION, overseasStorage: true}})).status).toBe(200);
        return jar;
    }

    it("用户名登录（Smoke）：回公开资料与会话 Cookie（名字、HttpOnly、Secure、SameSite=Lax、Path=/、不带 Domain），已登录的 whoami 回账号与角色、不带 Set-Cookie", async () => {
        const jar = cookieJar();
        const response = await login(site.url, "root", PASSWORD, {from: from(), jar});
        expect(response.status).toBe(200);
        expect(Value.Check(LoginResponse, response.body)).toBe(true);
        expect(response.body).toMatchObject({user: {id: rootId, username: "root", role: "admin"}});
        const cookie = jar.last(SESSION_COOKIE);
        expect(cookie?.value).not.toBe("");
        expect({
            httpOnly: cookie?.attributes.has("httponly"),
            secure: cookie?.attributes.has("secure"),
            sameSite: cookie?.attributes.get("samesite")?.toLowerCase(),
            path: cookie?.attributes.get("path"),
            domain: cookie?.attributes.has("domain"),
        }).toEqual({httpOnly: true, secure: true, sameSite: "lax", path: "/", domain: false});

        const asked = await whoami(sessionHeader(jar));
        expect(outcome(asked)).toEqual({status: 200, body: {state: "authenticated", user: {id: rootId, username: "root", role: "admin"}}});
        expect(Value.Check(WhoamiResponse, asked.body)).toBe(true);
        expect(asked.headers.getSetCookie()).toEqual([]);
    });

    it("邮箱登录，大小写不同也认", async () => {
        const response = await login(site.url, "ROOT@Example.COM", PASSWORD, {from: from()});
        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({user: {id: rootId}});
    });

    it("密码错、账号不存在：同一个 invalid_credentials，不带 Set-Cookie", async () => {
        for (const [name, identifier, password] of [
            ["密码错", "root", "wrong-PW-000000"],
            ["账号不存在", "nobody", PASSWORD],
            ["邮箱不存在", "nobody@example.com", PASSWORD],
        ] as const) {
            const response = await login(site.url, identifier, password, {from: from()});
            expect({name, ...failure(response), setCookies: response.headers.getSetCookie()}).toEqual({name, ...invalidCredentials, setCookies: []});
        }
    });

    it("字段不合格：validation_failed 列出字段", async () => {
        const response = await identityRequest(site.url, IDENTITY_PATHS.login, {method: "POST", from: from(), body: {identifier: "", password: "x".repeat(129)}});
        expect(failure(response)).toEqual({status: 400, body: {error: {code: "validation_failed", fields: expect.arrayContaining(["identifier", "password"])}}});
    });

    it("可信代理不给转发头：登录得 forbidden_origin", async () => {
        const response = await login(site.url, "root", PASSWORD, {from: from(), headers: {"X-Forwarded-For": null}});
        expect(failure(response)).toEqual({status: 403, body: {error: {code: "forbidden_origin"}}});
    });

    it("同一个账号两个会话并存；登出回 {} 并清 Cookie，只结束当前这个", async () => {
        const first = cookieJar();
        const second = cookieJar();
        expect((await login(site.url, "root", PASSWORD, {from: from(), jar: first})).status).toBe(200);
        expect((await login(site.url, "root", PASSWORD, {from: from(), jar: second})).status).toBe(200);
        const firstCookie = sessionHeader(first);
        expect(sessionHeader(second)).not.toBe(firstCookie);

        const out = await identityRequest(site.url, IDENTITY_PATHS.logout, {method: "POST", from: from(), jar: first});
        expect(outcome(out)).toEqual({status: 200, body: {}});
        expect(first.names()).toEqual([]);
        expect((await whoami(firstCookie)).body).toEqual({state: "anonymous"});
        expect((await whoami(sessionHeader(second))).body).toMatchObject({state: "authenticated"});
    });

    // 超出 200 毫秒的预算：服务撞写锁时等满连接的 busy_timeout（250 毫秒）才报忙。
    it("账号库被进程外占着写时：登出得 503 unavailable、不清 Cookie，放锁后会话仍可用；登录得 503 unavailable", async () => {
        const jar = cookieJar();
        expect((await login(site.url, "root", PASSWORD, {from: from(), jar})).status).toBe(200);
        const cookie = sessionHeader(jar);
        const release = holdWriteLock(dataDir, "identity");
        let out: JsonResponse;
        let locked: JsonResponse;
        try {
            out = await identityRequest(site.url, IDENTITY_PATHS.logout, {method: "POST", from: from(), headers: {Cookie: cookie}});
            locked = await login(site.url, "root", PASSWORD, {from: from()});
        } finally {
            release();
        }
        expect({...failure(out), setCookies: out.headers.getSetCookie()}).toEqual({...unavailable, setCookies: []});
        expect((await whoami(cookie)).body).toMatchObject({state: "authenticated"});
        expect({...failure(locked), setCookies: locked.headers.getSetCookie()}).toEqual({...unavailable, setCookies: []});
    });

    it("me 回公开资料加邮箱、有没有密码、邮箱待补、缺不缺同意；没给邮箱建的管理员邮箱待补、email 为 null", async () => {
        const jar = cookieJar();
        const source = from();
        expect((await login(site.url, "root", PASSWORD, {from: source, jar})).status).toBe(200);
        const me = await identityRequest(site.url, IDENTITY_PATHS.me, {from: source, jar});
        expect(me.status).toBe(200);
        expect(Value.Check(MeResponse, me.body)).toBe(true);
        expect(me.body).toMatchObject({id: rootId, username: "root", role: "admin", email: "root@example.com", emailPending: false, hasPassword: true});

        const pending = cookieJar();
        expect((await login(site.url, "nomail", PASSWORD, {from: source, jar: pending})).status).toBe(200);
        const pendingMe = await identityRequest(site.url, IDENTITY_PATHS.me, {from: source, jar: pending});
        expect(Value.Check(MeResponse, pendingMe.body)).toBe(true);
        expect(pendingMe.body).toMatchObject({username: "nomail", email: null, emailPending: true, hasPassword: true});
    });

    it("同意门槛：新建的管理员登录后 consentRequired 为真，me/password 得 consent_required；补交旧版本或不同意境外存放仍被拒；补交当前版本后放行", async () => {
        const jar = cookieJar();
        const source = from();
        expect((await login(site.url, "gated", PASSWORD, {from: source, jar})).status).toBe(200);
        expect((await identityRequest(site.url, IDENTITY_PATHS.me, {from: source, jar})).body).toMatchObject({consentRequired: true});
        const tryChange = () => identityRequest(site.url, IDENTITY_PATHS.mePassword, {method: "POST", from: source, jar, body: {currentPassword: "wrong-PW-000000", newPassword: NEW_PASSWORD}});
        expect(failure(await tryChange())).toEqual(consentRequired);
        expect((await whoami(sessionHeader(jar))).body).toMatchObject({state: "authenticated"});

        const submit = (body: unknown) => identityRequest(site.url, IDENTITY_PATHS.meConsent, {method: "POST", from: source, jar, body});
        expect(failure(await submit({termsVersion: "2020-01-01", overseasStorage: true}))).toEqual(consentRequired);
        expect(failure(await submit({termsVersion: TERMS_VERSION, overseasStorage: false}))).toEqual(consentRequired);
        const accepted = await submit({termsVersion: TERMS_VERSION, overseasStorage: true});
        expect(accepted.status).toBe(200);
        expect(Value.Check(MeResponse, accepted.body)).toBe(true);
        expect(accepted.body).toMatchObject({username: "gated", consentRequired: false});
        // 过了门槛：轮到核对旧密码，旧密码错得 invalid_credentials。
        expect(failure(await tryChange())).toEqual(invalidCredentials);
    });

    it("改密码：旧密码错得 invalid_credentials；对了回 {}，另一个会话失效、当前的保留，之后只有新密码能登录", async () => {
        const current = await consented("changer", PASSWORD);
        const other = cookieJar();
        expect((await login(site.url, "changer", PASSWORD, {from: from(), jar: other})).status).toBe(200);
        const change = (currentPassword: string) => identityRequest(site.url, IDENTITY_PATHS.mePassword, {method: "POST", from: from(), jar: current, body: {currentPassword, newPassword: NEW_PASSWORD}});

        expect(failure(await change("wrong-PW-000000"))).toEqual(invalidCredentials);
        expect((await whoami(sessionHeader(other))).body).toMatchObject({state: "authenticated"});

        const changed = await change(PASSWORD);
        expect(outcome(changed)).toEqual({status: 200, body: {}});
        expect(Value.Check(EmptyResponse, changed.body)).toBe(true);
        expect((await whoami(sessionHeader(current))).body).toMatchObject({state: "authenticated"});
        expect((await whoami(sessionHeader(other))).body).toEqual({state: "anonymous"});
        expect(failure(await login(site.url, "changer", PASSWORD, {from: from()}))).toEqual(invalidCredentials);
        expect((await login(site.url, "changer", NEW_PASSWORD, {from: from()})).status).toBe(200);
    });

    it("有密码的账号改密码不带旧密码：validation_failed 点名 currentPassword", async () => {
        const jar = await consented("root", PASSWORD);
        const response = await identityRequest(site.url, IDENTITY_PATHS.mePassword, {method: "POST", from: from(), jar, body: {newPassword: NEW_PASSWORD}});
        expect(failure(response)).toEqual({status: 400, body: {error: {code: "validation_failed", fields: ["currentPassword"]}}});
    });

    // 超出 200 毫秒的预算：登录算一次密码哈希。
    it("补交同意时条款版本不是日期的写法（v1）：validation_failed，fields 是 termsVersion（输出 3、10）", async () => {
        const jar = cookieJar();
        const source = from();
        expect((await login(site.url, "root", PASSWORD, {from: source, jar})).status).toBe(200);
        const response = await identityRequest(site.url, IDENTITY_PATHS.meConsent, {method: "POST", from: source, jar, body: {termsVersion: "v1", overseasStorage: true}});
        expect(failure(response)).toEqual({status: 400, body: {error: {code: "validation_failed", fields: ["termsVersion"]}}});
    });

    it("没有会话：me 与改密码得 unauthenticated", async () => {
        const unauthenticated = {status: 401, body: {error: {code: "unauthenticated"}}};
        expect(failure(await identityRequest(site.url, IDENTITY_PATHS.me, {from: from()}))).toEqual(unauthenticated);
        expect(failure(await identityRequest(site.url, IDENTITY_PATHS.mePassword, {method: "POST", from: from(), body: {newPassword: NEW_PASSWORD}}))).toEqual(unauthenticated);
    });
});

describe("会话的时长与延长（输出 5、7）", () => {
    const PASSWORD = "clock-PW-k3Vb68";
    let site: SiteProcess;
    let address = 0;
    const from = () => `192.0.2.${String(++address)}`;

    beforeAll(async () => {
        const dataDir = await sandbox.dataDir();
        await createAdmin(sandbox, dataDir, ["clock"], PASSWORD);
        site = await sandbox.start({dataDir, env: IDENTITY_SITE_ENV});
    }, SETUP_TIMEOUT_MS);

    async function signedIn(): Promise<string> {
        const jar = cookieJar();
        expect((await login(site.url, "clock", PASSWORD, {from: from(), jar})).status).toBe(200);
        return sessionHeader(jar);
    }

    it("拨一天多：whoami 不延长、不带 Set-Cookie；me 延长并带回同一个令牌的 Cookie；到原到期时间之后仍有效", async () => {
        const cookie = await signedIn();
        await site.advanceClock(DAY_MS + 60_000);
        const asked = await identityRequest(site.url, IDENTITY_PATHS.whoami, {from: from(), headers: {Cookie: cookie}});
        expect({body: asked.body, setCookies: asked.headers.getSetCookie()}).toEqual({body: expect.objectContaining({state: "authenticated"}), setCookies: []});

        const jar = cookieJar();
        const me = await identityRequest(site.url, IDENTITY_PATHS.me, {from: from(), headers: {Cookie: cookie}, jar});
        expect(me.status).toBe(200);
        expect(sessionHeader(jar)).toBe(cookie);

        await site.advanceClock(SESSION_MS - DAY_MS);
        expect((await identityRequest(site.url, IDENTITY_PATHS.whoami, {from: from(), headers: {Cookie: cookie}})).body).toMatchObject({state: "authenticated"});
    });

    it("拨过会话时长：会话失效，whoami 回 anonymous、me 得 unauthenticated", async () => {
        const cookie = await signedIn();
        await site.advanceClock(SESSION_MS + 60_000);
        expect((await identityRequest(site.url, IDENTITY_PATHS.whoami, {from: from(), headers: {Cookie: cookie}})).body).toEqual({state: "anonymous"});
        expect(failure(await identityRequest(site.url, IDENTITY_PATHS.me, {from: from(), headers: {Cookie: cookie}}))).toEqual({status: 401, body: {error: {code: "unauthenticated"}}});
    });
});

describe("会话时长取配置的值（输入一节的 NB_SITE_IDENTITY_SESSION_DAYS，输出 5）", () => {
    const PASSWORD = "days-PW-m4Rt82";
    /** 不是缺省的 30 天：缺省值上看不出配置有没有接上。 */
    const SESSION_DAYS = 2;
    let site: SiteProcess;
    let address = 0;
    const from = () => `192.0.2.${String(100 + ++address)}`;

    beforeAll(async () => {
        const dataDir = await sandbox.dataDir();
        await createAdmin(sandbox, dataDir, ["days"], PASSWORD);
        site = await sandbox.start({dataDir, env: {...IDENTITY_SITE_ENV, NB_SITE_IDENTITY_SESSION_DAYS: String(SESSION_DAYS)}});
    }, SETUP_TIMEOUT_MS);

    // 超出 200 毫秒的预算：登录算一次密码哈希。
    it("设成 2 天：登录的 Cookie 的 Max-Age 是 2 天；拨到 2 天之前一分钟仍有效，拨过 2 天会话失效", async () => {
        const jar = cookieJar();
        expect((await login(site.url, "days", PASSWORD, {from: from(), jar})).status).toBe(200);
        expect(jar.last(SESSION_COOKIE)?.attributes.get("max-age")).toBe(String((SESSION_DAYS * DAY_MS) / 1000));
        const cookie = sessionHeader(jar);
        // 只用 whoami 问：它不延长会话（输出 7），到期时间始终是登录时定的那一刻。
        const ask = async () => (await identityRequest(site.url, IDENTITY_PATHS.whoami, {from: from(), headers: {Cookie: cookie}})).body;
        await site.advanceClock(SESSION_DAYS * DAY_MS - 60_000);
        expect(await ask()).toMatchObject({state: "authenticated"});
        await site.advanceClock(120_000);
        expect(await ask()).toEqual({state: "anonymous"});
    });

    // 上一条只经 whoami，碰不到延长；延长另按会话时长算新的到期时间，配置没接到那里时上一条照样通过（变异看到过）。
    it("延长也按 2 天：用了一天多以后 me 延长、Cookie 的 Max-Age 仍是 2 天；登录时定的到期时刻过后仍有效，从延长那一刻起过 2 天失效", async () => {
        const jar = cookieJar();
        expect((await login(site.url, "days", PASSWORD, {from: from(), jar})).status).toBe(200);
        const cookie = sessionHeader(jar);
        const ask = async () => (await identityRequest(site.url, IDENTITY_PATHS.whoami, {from: from(), headers: {Cookie: cookie}})).body;

        await site.advanceClock(DAY_MS + 60_000);
        const extended = cookieJar();
        expect((await identityRequest(site.url, IDENTITY_PATHS.me, {from: from(), headers: {Cookie: cookie}, jar: extended})).status).toBe(200);
        expect(extended.last(SESSION_COOKIE)?.attributes.get("max-age")).toBe(String((SESSION_DAYS * DAY_MS) / 1000));

        await site.advanceClock(DAY_MS);
        expect(await ask()).toMatchObject({state: "authenticated"});
        await site.advanceClock(DAY_MS + 60_000);
        expect(await ask()).toEqual({state: "anonymous"});
    });
});

describe("清理任务在服务启动后先跑一次（定时任务一节）", () => {
    let site: SiteProcess;
    let release: (() => void) | undefined;

    // 合同里造不出启动时已经到期的会话：测试控制入口只能往前拨，进程重启后时间回到墙钟，上一个进程发的会话都还没到期；任务成功时
    // 也不一定写日志（没删到会话时不写）。所以让它在启动时就撞上进程外的写锁：自己跑起来的那一次以失败结束，日志里有一行
    // `job.failed`（`site.operations` 失败表的 `job_failed` 一行），而用例从头到尾不经测试控制入口触发它。
    beforeAll(async () => {
        const dataDir = await sandbox.dataDir();
        // 先起一次再停（持锁要库文件已经在）：迁移都跑过、账号模块的签名钥也建好了（第一次启动要写账号的库，`site.oauth-provider`
        // 输出 17），再启动时只核对迁移记录、读签名钥，不写账号的库。
        const prepared = await sandbox.start({dataDir});
        const stopped = await prepared.stop();
        if (stopped !== 0) throw new Error(`the preparing serve exited ${String(stopped)}\nstderr:\n${prepared.stderr()}`);
        release = holdWriteLock(dataDir, "identity");
        site = await sandbox.start({dataDir});
    }, SETUP_TIMEOUT_MS);

    afterAll(() => release?.());

    it("不经测试控制入口，purge 自己跑过一次：启动时账号库被占着写，日志里有这个任务失败的一行；放锁后服务照常", async () => {
        try {
            // 等不到就是没跑：没有“启动后先跑一次”时第一次要等 10 分钟。
            await waitUntil("identity purge 的 job.failed 一行", () => site.logs().find((line) => line.event === "job.failed" && line.module === "identity" && line.job === "purge"));
        } finally {
            release?.();
        }
        expect((await identityRequest(site.url, IDENTITY_PATHS.whoami, {from: "192.0.2.1"})).status).toBe(200);
        expect(site.exitCode).toBeNull();
    });
});
