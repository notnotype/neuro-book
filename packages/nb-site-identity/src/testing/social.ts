/**
 * 包内测试走社交流程：接仿真上游（`@notnotype/neuro-book-test-support/oauth-upstream`，第三方的替身）的配置，经站点的发起接口拿上游
 * 地址与 state Cookie，像浏览器一样请求上游的授权地址（上游自动同意、302 回站点的回调），再带 state Cookie 请求站点的回调，回落点。
 * 请求都经 `TestIdentity` 的入口挂法，与产品同一条路径。不含断言。
 */

import {FAKE_CLIENTS, type FakeUpstream} from "@notnotype/neuro-book-test-support/oauth-upstream";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import type {SocialProvider} from "@notnotype/nb-site-identity-contract";

import type {SocialConfig} from "../config";
import {libDate} from "../db/library-rows";
import {type ManualTimers, TEST_SITE_URL} from "./library";
import {TEST_CLIENT_ADDRESS_HEADER, type TestIdentity} from "./module";

/** 两个上游都接到仿真上游上（与 `upstreamEnv` 给入口的七个变量同一套值）。 */
export function fakeSocialConfig(upstream: Pick<FakeUpstream, "base">): SocialConfig {
    return {
        google: {clientId: FAKE_CLIENTS.google.id, clientSecret: FAKE_CLIENTS.google.secret, issuer: `${upstream.base}/google`},
        github: {clientId: FAKE_CLIENTS.github.id, clientSecret: FAKE_CLIENTS.github.secret, url: `${upstream.base}/github`, apiUrl: `${upstream.base}/github/api`},
    };
}

/**
 * `POST social/:provider/start`；`cookie` 是发起者的会话 Cookie（关联意图要）。`clientAddress` 是请求的来源地址（注册意图按它计
 * 限流），不给时用 `createTestIdentity` 的缺省地址。
 */
export function startSocial(identity: TestIdentity, provider: string, body: unknown, cookie?: string, clientAddress?: string): Promise<Response> {
    return identity.fetch(`/social/${provider}/start`, {
        method: "POST",
        headers: {
            origin: TEST_SITE_URL,
            "content-type": "application/json",
            ...(cookie === undefined ? {} : {cookie}),
            ...(clientAddress === undefined ? {} : {[TEST_CLIENT_ADDRESS_HEADER]: clientAddress}),
        },
        body: JSON.stringify(body),
    });
}

/** 发起成功时拿到的：上游地址、要带回回调的 state Cookie（`名字=值`）。 */
export interface StartedSocial {
    readonly url: string;
    readonly stateCookie: string;
}

/** 读发起接口的成功响应；不是 200 时抛，带上状态与响应体，便于看用例为什么没走下去。 */
export async function startedSocial(response: Response): Promise<StartedSocial> {
    if (response.status !== 200) throw new Error(`social start answered ${String(response.status)}: ${await response.text()}`);
    const {url} = (await response.json()) as {readonly url: string};
    const stateCookie = response.headers
        .getSetCookie()
        .map((cookie) => cookie.split(";")[0]!)
        .find((pair) => pair.startsWith("__Host-nbsite.state="));
    if (stateCookie === undefined) throw new Error("social start set no state cookie");
    return {url, stateCookie};
}

/** 请求上游的授权地址（仿真上游立即 302 回站点），回站点回调的地址（从站点根起的路径与查询串）。 */
export async function upstreamCallback(started: StartedSocial): Promise<string> {
    const response = await fetch(started.url, {redirect: "manual"});
    const location = response.headers.get("location");
    if (response.status !== 302 || location === null) throw new Error(`fake upstream answered ${String(response.status)} without a redirect`);
    const target = new URL(location);
    if (target.origin !== TEST_SITE_URL) throw new Error(`fake upstream redirected off site: ${target.origin}`);
    return `${target.pathname}${target.search}`;
}

/** 带 `cookie`（state Cookie，可能另有会话 Cookie）请求站点的回调地址，回站点的应答（不跟随跳转）。 */
export function openCallback(identity: TestIdentity, callbackPath: string, cookie: string): Promise<Response> {
    return identity.request(callbackPath, {headers: {cookie}});
}

/** 一个浏览器走完一次：发起、上游、回调。`sessionCookie` 是这个浏览器已有的会话 Cookie。 */
export async function followSocial(identity: TestIdentity, start: Response, sessionCookie?: string): Promise<Response> {
    const started = await startedSocial(start);
    const callback = await upstreamCallback(started);
    return openCallback(identity, callback, sessionCookie === undefined ? started.stateCookie : `${started.stateCookie}; ${sessionCookie}`);
}

/** 站点的落点：跳去的路径与 `social_error`（没有时为 null）。 */
export function landing(response: Response): {readonly status: number; readonly path: string; readonly socialError: string | null} {
    const location = response.headers.get("location") ?? "";
    const target = new URL(location, TEST_SITE_URL);
    return {status: response.status, path: target.origin === TEST_SITE_URL ? target.pathname : target.href, socialError: target.searchParams.get("social_error")};
}

/**
 * 直接写一行库的 `account`（与库关联后留下的形状相同，不带令牌）：给只测登录的用例准备已关联的身份，不经关联流程。
 */
export async function insertSocialAccount(identity: TestIdentity, userId: number, provider: SocialProvider, upstreamAccountId: string): Promise<void> {
    const now = libDate(identity.clock.now());
    await identity.conn.write((tx) =>
        tx
            .query(`INSERT INTO "account" ("accountId", "providerId", "userId", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)`)
            .run(upstreamAccountId, provider, userId, now, now),
    );
}

/**
 * 占住连接的队列（一个开着的库事务），直到放开。`started` 在取到锁时 resolve。手动计时器只用来数排队等锁的个数：占位取到锁之后，
 * `timers.pending` 就是排在它后面的个数。
 */
export async function holdQueue(target: TestIdentity): Promise<{readonly started: Promise<void>; release(): Promise<void>}> {
    const {adapter} = await target.assembly.auth.$context;
    const started = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    const done = target.conn.withLibTransaction(adapter, async () => {
        started.resolve();
        await finish.promise;
    });
    return {started: started.promise, release: async () => (finish.resolve(), await done)};
}

/**
 * 让几个回调对库的每一步访问都排在一起跑：先占住队列、等每个回调的下一步都排上；再在它们后面排一个新占位，放开旧的；它们的这一步
 * 跑完、下一步都排在新占位后面……直到有一个回调做完。这样“每个回调的第 i 步”都在“任何一个的第 i+1 步”之前跑完：例如关联钩子的写
 * （第 i 步）都在库插 `account`（第 i+1 步）之前，两个并发的关联都看不到对方的 `account` 行（`social/link.test.ts`）。队列先来先跑：各回调
 * 两步之间不另等别的（网络、计时器）时，每一轮里的先后与第一步排上队的先后相同。调用前 `first` 已占住队列。
 */
export async function lockstep(target: TestIdentity, timers: ManualTimers, first: Awaited<ReturnType<typeof holdQueue>>, requests: readonly Promise<Response>[]): Promise<Response[]> {
    let settled = 0;
    const count = (): void => {
        settled += 1;
    };
    // 这里只数做完的个数；失败由调用方 `Promise.all` 时看到。
    for (const request of requests) request.then(count, count);
    let gate = first;
    for (;;) {
        await waitUntil("每个回调的下一步都排上，或有一个做完了", () => timers.pending === requests.length || settled > 0);
        if (settled > 0) break;
        const next = await holdQueue(target);
        await waitUntil("新占位排在它们后面", () => timers.pending === requests.length + 1);
        await gate.release();
        await next.started;
        gate = next;
    }
    await gate.release();
    return Promise.all(requests);
}
