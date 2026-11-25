/**
 * 账号的限流、过载与重启（docs/specs/site/accounts.md 输出 19、20，时序一节“重启服务不影响已有会话；限流的计数在重启后清零”）：
 * 起真实的 `nb-site` 进程，只经 HTTP 与命令行看它。限流的计数在进程里，各组起自己的进程，互不吃额度。
 *
 * 计数按对齐的时间窗算（输出 19）：数次数的用例先用测试控制入口把时钟拨到窗口开头之后一秒，免得一串请求正好跨过边界被分进两个
 * 窗口。
 *
 * 本文件测不到、在别处的：排队 5 秒的超时与满 10 万个键（要真的等、要发太多请求）在账号包的 `hash-limiter.test.ts`、
 * `rate-limit.test.ts`。
 *
 * 时间预算：起进程、跑命令放在 `beforeAll` 里；用例只发请求。超出 200 毫秒的用例在旁边写明原因。
 */

import {beforeAll, describe, expect, it} from "bun:test";
import {Value} from "typebox/value";

import {ErrorBody, IDENTITY_PATHS, identityPath} from "@notnotype/nb-site-identity-contract";

import {cookieJar, createAdmin, IDENTITY_SITE_ENV, identityRequest, login} from "./testing/identity";
import {useSiteSandbox, type JsonResponse, type SiteProcess} from "./testing/site";

const sandbox = useSiteSandbox("nb-site-contract-tests accounts-limits.test.ts");

const SETUP_TIMEOUT_MS = 30_000;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const TERMS_VERSION = "2026-11-20";
const PASSWORD = "limits-PW-w6Gd19";
const WRONG = "wrong-PW-000000";
/** 会话 Cookie 的名字（`site.accounts` 输出 5）。 */
const SESSION_COOKIE = "__Host-nbsite.session_token";

const invalidCredentials = {status: 401, body: {error: {code: "invalid_credentials"}}};
const rateLimited = {status: 429, body: {error: {code: "rate_limited"}}};

function failure(response: JsonResponse): {readonly status: number; readonly body: unknown} {
    expect(Value.Check(ErrorBody, response.body)).toBe(true);
    return {status: response.status, body: response.body};
}

/** `Retry-After` 是不超过窗长的正整数秒（输出 19），返回它的值。 */
function retryAfter(response: JsonResponse, windowMs: number): number {
    const value = response.headers.get("retry-after") ?? "";
    expect(value).toMatch(/^[1-9]\d*$/u);
    expect(Number(value)).toBeLessThanOrEqual(windowMs / 1000);
    return Number(value);
}

/** 把时钟拨到下一个窗口开头之后一秒（小时窗的开头也是 5 分钟窗的开头）。 */
async function alignToWindow(site: SiteProcess, windowMs: number): Promise<void> {
    const now = await site.advanceClock(1);
    await site.advanceClock(windowMs - (now % windowMs) + 1000);
}

describe("登录、改密码与生成邀请码的限流（输出 19）", () => {
    let site: SiteProcess;

    beforeAll(async () => {
        const dataDir = await sandbox.dataDir();
        await createAdmin(sandbox, dataDir, ["pair"], PASSWORD);
        await Promise.all([
            createAdmin(sandbox, dataDir, ["sixfour"], PASSWORD),
            createAdmin(sandbox, dataDir, ["slow"], PASSWORD),
            createAdmin(sandbox, dataDir, ["changer"], PASSWORD),
            createAdmin(sandbox, dataDir, ["minter"], PASSWORD),
            createAdmin(sandbox, dataDir, ["hoarder"], PASSWORD),
        ]);
        site = await sandbox.start({dataDir, env: IDENTITY_SITE_ENV});
    }, SETUP_TIMEOUT_MS);

    // 超出 200 毫秒的预算：11 次登录各算一次密码哈希，失败的还要补到 150 毫秒的下限。
    it("同一来源加同一用户名 5 分钟 10 次：第 11 次（密码对也一样）rate_limited 带整数 Retry-After；别的来源不受影响；拨过 Retry-After 恢复", async () => {
        await alignToWindow(site, 5 * MINUTE_MS);
        for (let index = 0; index < 10; index += 1) expect(failure(await login(site.url, "pair", WRONG, {from: "203.0.113.10"}))).toEqual(invalidCredentials);
        const limited = await login(site.url, "pair", PASSWORD, {from: "203.0.113.10"});
        expect(failure(limited)).toEqual(rateLimited);
        const seconds = retryAfter(limited, 5 * MINUTE_MS);
        expect((await login(site.url, "pair", PASSWORD, {from: "203.0.113.11"})).status).toBe(200);
        await site.advanceClock(seconds * 1000);
        expect((await login(site.url, "pair", PASSWORD, {from: "203.0.113.10"})).status).toBe(200);
    });

    // 超出 200 毫秒的预算：31 次登录各算一次密码哈希（同时发，受哈希的并发上限约束）。
    it("同一来源 5 分钟 30 次（用户名各不相同）：第 31 次 rate_limited", async () => {
        await alignToWindow(site, 5 * MINUTE_MS);
        const attempts = await Promise.all(Array.from({length: 30}, (_, index) => login(site.url, `nobody${String(index)}`, WRONG, {from: "203.0.113.20"})));
        expect(attempts.map((response) => response.status)).toEqual(Array.from({length: 30}, () => 401));
        const limited = await login(site.url, "pair", PASSWORD, {from: "203.0.113.20"});
        expect(failure(limited)).toEqual(rateLimited);
        retryAfter(limited, 5 * MINUTE_MS);
    });

    // 超出 200 毫秒的预算：同上，11 次登录各算一次密码哈希。
    it("IPv6 来源按前 64 位算一个：同一个 /64 里换地址也被限，另一个 /64 不受影响", async () => {
        await alignToWindow(site, 5 * MINUTE_MS);
        for (let index = 0; index < 10; index += 1) expect(failure(await login(site.url, "sixfour", WRONG, {from: `2001:db8:1:2::${(index + 1).toString(16)}`}))).toEqual(invalidCredentials);
        expect(failure(await login(site.url, "sixfour", PASSWORD, {from: "2001:db8:1:2:ffff::1"}))).toEqual(rateLimited);
        expect((await login(site.url, "sixfour", PASSWORD, {from: "2001:db8:1:3::1"})).status).toBe(200);
    });

    // 超出 200 毫秒的预算：要看到的就是先等 2 秒；另有 20 次失败的登录。
    it("同一个用户名失败 20 次以后，下一次登录（密码对）先等至少 2 秒再成功", async () => {
        await alignToWindow(site, HOUR_MS);
        // 来源加用户名每个来源 5 分钟只有 10 次：20 次失败从两个来源发。
        for (let index = 0; index < 20; index += 1) expect(failure(await login(site.url, "slow", WRONG, {from: `203.0.113.${String(30 + (index % 2))}`}))).toEqual(invalidCredentials);
        const started = performance.now();
        const response = await login(site.url, "slow", PASSWORD, {from: "203.0.113.32"});
        const elapsed = performance.now() - started;
        expect(response.status).toBe(200);
        expect(elapsed).toBeGreaterThanOrEqual(2000);
    }, 15_000);

    // 超出 200 毫秒的预算：每次改密码都要算哈希。
    it("改密码按账号一小时 5 次：第 6 次 rate_limited 带整数 Retry-After，字段不合格的不计入；拨过 Retry-After 恢复", async () => {
        await alignToWindow(site, HOUR_MS);
        const jar = cookieJar();
        expect((await login(site.url, "changer", PASSWORD, {from: "203.0.113.40", jar})).status).toBe(200);
        expect((await identityRequest(site.url, IDENTITY_PATHS.meConsent, {method: "POST", from: "203.0.113.40", jar, body: {termsVersion: TERMS_VERSION, overseasStorage: true}})).status).toBe(200);
        const change = (body: unknown) => identityRequest(site.url, IDENTITY_PATHS.mePassword, {method: "POST", from: "203.0.113.40", jar, body});
        for (let index = 0; index < 3; index += 1) expect((await change({newPassword: "short"})).status).toBe(400);
        for (let index = 0; index < 5; index += 1) expect(failure(await change({currentPassword: WRONG, newPassword: "changed-PW-r2Lm84"}))).toEqual(invalidCredentials);
        const limited = await change({currentPassword: PASSWORD, newPassword: "changed-PW-r2Lm84"});
        expect(failure(limited)).toEqual(rateLimited);
        const seconds = retryAfter(limited, HOUR_MS);
        await site.advanceClock(seconds * 1000);
        expect((await change({currentPassword: PASSWORD, newPassword: "changed-PW-r2Lm84"})).status).toBe(200);
    });

    // 超出 200 毫秒的预算：登录算一次密码哈希，另生成、停用各十个码。
    it("生成邀请码按账号一小时 10 次：停用了再生成也算，第 11 次 rate_limited 带整数 Retry-After，请求体不合格的不计入；拨过 Retry-After 恢复", async () => {
        await alignToWindow(site, HOUR_MS);
        const jar = cookieJar();
        expect((await login(site.url, "minter", PASSWORD, {from: "203.0.113.50", jar})).status).toBe(200);
        expect((await identityRequest(site.url, IDENTITY_PATHS.meConsent, {method: "POST", from: "203.0.113.50", jar, body: {termsVersion: TERMS_VERSION, overseasStorage: true}})).status).toBe(200);
        const generate = (body?: unknown) => identityRequest(site.url, IDENTITY_PATHS.meInviteCodes, {method: "POST", from: "203.0.113.50", jar, ...(body === undefined ? {} : {body})});
        for (let index = 0; index < 3; index += 1) expect((await generate({maxUses: 5})).status).toBe(400);
        // 每生成一个就停用：同时有效的始终是 0 个，挡住第 11 次的只有限流。
        for (let index = 0; index < 10; index += 1) {
            const generated = await generate();
            expect(generated.status).toBe(200);
            const id = (generated.body as {id: number}).id;
            expect((await identityRequest(site.url, identityPath.meInviteCode(id), {method: "PATCH", from: "203.0.113.50", jar, body: {disabled: true}})).status).toBe(200);
        }
        const limited = await generate();
        expect(failure(limited)).toEqual(rateLimited);
        const seconds = retryAfter(limited, HOUR_MS);
        await site.advanceClock(seconds * 1000);
        expect((await generate()).status).toBe(200);
    });

    // 超出 200 毫秒的预算：登录算一次密码哈希，另生成十个码。
    it("生成邀请码的先后（失败表）：已有 10 个有效的码、这一小时也已生成 10 次时，第 11 次回 rate_limited，不是 invite_code_limit", async () => {
        await alignToWindow(site, HOUR_MS);
        const jar = cookieJar();
        expect((await login(site.url, "hoarder", PASSWORD, {from: "203.0.113.55", jar})).status).toBe(200);
        expect((await identityRequest(site.url, IDENTITY_PATHS.meConsent, {method: "POST", from: "203.0.113.55", jar, body: {termsVersion: TERMS_VERSION, overseasStorage: true}})).status).toBe(200);
        const generate = () => identityRequest(site.url, IDENTITY_PATHS.meInviteCodes, {method: "POST", from: "203.0.113.55", jar});
        // 不停用：10 个码都还有效，两道限制同时满了，回答只看谁排在前面。
        for (let index = 0; index < 10; index += 1) expect((await generate()).status).toBe(200);
        const blocked = await generate();
        expect(failure(blocked)).toEqual(rateLimited);
        retryAfter(blocked, HOUR_MS);
    });
});

describe("注册的限流（输出 19）", () => {
    let site: SiteProcess;
    let code: string;

    beforeAll(async () => {
        const dataDir = await sandbox.dataDir();
        await createAdmin(sandbox, dataDir, ["issuer"], PASSWORD);
        site = await sandbox.start({dataDir, env: IDENTITY_SITE_ENV});
        const jar = cookieJar();
        if ((await login(site.url, "issuer", PASSWORD, {from: "203.0.113.70", jar})).status !== 200) throw new Error("the admin could not sign in");
        await identityRequest(site.url, IDENTITY_PATHS.meConsent, {method: "POST", from: "203.0.113.70", jar, body: {termsVersion: TERMS_VERSION, overseasStorage: true}});
        const issued = await identityRequest(site.url, IDENTITY_PATHS.adminRegistrationCodes, {method: "POST", from: "203.0.113.70", jar, body: {maxUses: null}});
        if (issued.status !== 200) throw new Error(`issuing a registration code answered ${String(issued.status)}`);
        code = (issued.body as {code: string}).code;
    }, SETUP_TIMEOUT_MS);

    // 超出 200 毫秒的预算：拨过窗口之后的那次注册要算一次密码哈希。
    it("同一来源一小时 5 次：第 6 次 rate_limited 带整数 Retry-After；字段不合格的不计入；别的来源不受影响；拨过 Retry-After 恢复", async () => {
        await alignToWindow(site, HOUR_MS);
        const register = (body: Record<string, unknown>, from: string) => identityRequest(site.url, IDENTITY_PATHS.register, {method: "POST", from, body});
        const valid = (name: string, overrides: Record<string, unknown> = {}) => ({
            username: name,
            email: `${name}@example.com`,
            password: PASSWORD,
            registrationCode: code,
            termsVersion: TERMS_VERSION,
            overseasStorage: true,
            ...overrides,
        });
        // 3 次字段不合格的、5 次过了校验却缺同意的：只有后 5 次计入。缺同意的被拒、不算哈希，用例不必等。
        for (let index = 0; index < 3; index += 1) expect((await register(valid("ab"), "203.0.113.71")).status).toBe(400);
        for (let index = 0; index < 5; index += 1) expect(failure(await register(valid(`counted${String(index)}`, {overseasStorage: false}), "203.0.113.71"))).toEqual({status: 403, body: {error: {code: "consent_required"}}});
        const limited = await register(valid("limited"), "203.0.113.71");
        expect(failure(limited)).toEqual(rateLimited);
        const seconds = retryAfter(limited, HOUR_MS);
        expect(failure(await register(valid("other", {overseasStorage: false}), "203.0.113.72"))).toEqual({status: 403, body: {error: {code: "consent_required"}}});
        await site.advanceClock(seconds * 1000);
        expect((await register(valid("limited"), "203.0.113.71")).status).toBe(200);
    });
});

describe("过载（输出 20）", () => {
    let site: SiteProcess;

    beforeAll(async () => {
        const dataDir = await sandbox.dataDir();
        await createAdmin(sandbox, dataDir, ["busy"], PASSWORD);
        site = await sandbox.start({dataDir, env: {...IDENTITY_SITE_ENV, NB_SITE_IDENTITY_HASH_CONCURRENCY: "1", NB_SITE_IDENTITY_HASH_QUEUE: "0"}});
    }, SETUP_TIMEOUT_MS);

    it("同时算哈希的上限 1、不排队：同时 8 个登录，有成功的，其余回 503 overloaded", async () => {
        // 计划写的是“同时两个、一个 overloaded”：两个请求不一定真的重叠（第一个可能在第二个到达之前就算完），发 8 个让重叠成为必然。
        const responses = await Promise.all(Array.from({length: 8}, (_, index) => login(site.url, "busy", PASSWORD, {from: `203.0.113.${String(50 + index)}`})));
        const overloaded = responses.filter((response) => response.status === 503);
        expect(responses.filter((response) => response.status !== 503).map((response) => response.status)).toContain(200);
        expect(responses.every((response) => response.status === 200 || response.status === 503)).toBe(true);
        expect(overloaded.length).toBeGreaterThan(0);
        for (const response of overloaded) expect(failure(response)).toEqual({status: 503, body: {error: {code: "overloaded"}}});
    });
});

describe("重启（时序：会话保留，限流清零）", () => {
    let cookie: string;
    let limitedBefore: JsonResponse;
    let restarted: SiteProcess;

    beforeAll(async () => {
        const dataDir = await sandbox.dataDir();
        await createAdmin(sandbox, dataDir, ["restart"], PASSWORD);
        const first = await sandbox.start({dataDir, env: IDENTITY_SITE_ENV});
        const jar = cookieJar();
        const signedIn = await login(first.url, "restart", PASSWORD, {from: "203.0.113.60", jar});
        if (signedIn.status !== 200) throw new Error(`login answered ${String(signedIn.status)}`);
        cookie = `${SESSION_COOKIE}=${jar.last(SESSION_COOKIE)!.value}`;
        await alignToWindow(first, 5 * MINUTE_MS);
        for (let index = 0; index < 10; index += 1) await login(first.url, "restart", WRONG, {from: "203.0.113.61"});
        limitedBefore = await login(first.url, "restart", PASSWORD, {from: "203.0.113.61"});
        await first.stop();
        restarted = await sandbox.start({dataDir, env: IDENTITY_SITE_ENV});
    }, SETUP_TIMEOUT_MS);

    it("重启前的会话在重启后仍有效", async () => {
        const asked = await identityRequest(restarted.url, IDENTITY_PATHS.whoami, {from: "203.0.113.62", headers: {Cookie: cookie}});
        expect(asked.body).toMatchObject({state: "authenticated", user: {username: "restart"}});
    });

    it("重启前被限流的来源加用户名，重启后照常登录", async () => {
        expect(failure(limitedBefore)).toEqual(rateLimited);
        expect((await login(restarted.url, "restart", PASSWORD, {from: "203.0.113.61"})).status).toBe(200);
    });
});
