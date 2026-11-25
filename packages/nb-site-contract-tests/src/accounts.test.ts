/**
 * 账号接口的黑盒合同（docs/specs/site/accounts.md 输出 5、7、22，输入一节的来源头，失败表）：起真实的 `nb-site` 进程，只经 HTTP
 * 看它。响应的形状用合同包的 schema 核对（`Value.Check`）。另核对账号接口的响应都带 `Cache-Control: no-store`（w00037 t07
 * 实现审查第 5 条）。
 *
 * 本文件测不到、在别处的（w00037 t07 第 3 片还没有对外的登录，造不出会话）：
 * - 已登录的 `whoami`、登出只结束当前会话、写锁下登出得 503 且会话仍可用：第 4 片有了登录后补进本文件；在那之前由账号包的
 *   包内测试（`nb-site-identity` 的 `app.test.ts`、`session.test.ts`）覆盖。
 *
 * 时间预算：起进程放在 `beforeAll` 里；用例只发请求。
 */

import {beforeAll, describe, expect, it} from "bun:test";
import {Value} from "typebox/value";

import {EmptyResponse, ErrorBody, IDENTITY_PATHS, MetaResponse, WhoamiResponse} from "@notnotype/nb-site-identity-contract";

import {holdWriteLock} from "./testing/fault";
import {cookieJar, IDENTITY_SITE_ENV, identityRequest} from "./testing/identity";
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
