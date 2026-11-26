/**
 * 社交登录（`start.ts`、`callback.ts`；`site.accounts` 输出 11、12、15、23 的登录意图，时序一节“发起起 10 分钟、只能用一次”，验收 11）。
 *
 * 上游是仿真上游（第三方的替身），站点是真的模块。合同测试（`nb-site-contract-tests` 的 `accounts-social.test.ts`）走同样的
 * 场景；这里另测合同测试里不好造的：拨模块时钟让流程过期、清理任务删流程行、库给的 state Cookie 换成另一份、同一个回调并发到达
 * （经占住连接的队列让三个都排在认领之前）、Google 的发现文档取不到、发起的限流。
 */

import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {createServer} from "node:net";

import {startFakeUpstream, type FakeUpstream} from "@notnotype/neuro-book-test-support/oauth-upstream";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {LIB_BASE_PATH} from "../auth";
import {SOCIAL_FLOW_MS} from "./flow";
import {ManualTimers, TEST_SITE_URL} from "../testing/library";
import {createTestIdentity, SESSION_COOKIE, TEST_CLIENT_ADDRESS_HEADER, TEST_TERMS_VERSION, type TestIdentity} from "../testing/module";
import {fakeSocialConfig, followSocial, holdQueue, insertSocialAccount, landing, openCallback, startedSocial, startSocial, upstreamCallback} from "../testing/social";

let upstream: FakeUpstream;
let identity: TestIdentity | undefined;

beforeEach(async () => {
    upstream = await startFakeUpstream();
});

afterEach(async () => {
    await identity?.root.cleanup();
    identity = undefined;
    await upstream.close();
});

const CONSENTED = {consent: {termsVersion: TEST_TERMS_VERSION, overseasStorage: true}} as const;
const ALICE = {sub: "google-alice", email: "alice@gmail.test", email_verified: true, name: "Alice"} as const;

async function socialIdentity(name: string): Promise<TestIdentity> {
    identity = await createTestIdentity(name, {config: {social: fakeSocialConfig(upstream)}});
    return identity;
}

function hasSessionCookie(response: Response): boolean {
    return response.headers.getSetCookie().some((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`) && !cookie.startsWith(`${SESSION_COOKIE}=;`));
}

async function flowCount(target: TestIdentity): Promise<number> {
    return target.conn.read((tx) => tx.query<{n: number}, []>(`SELECT COUNT(*) AS n FROM identity_social_flow`).get()!.n);
}

async function sessionCount(target: TestIdentity): Promise<number> {
    return target.conn.read((tx) => tx.query<{n: number}, []>(`SELECT COUNT(*) AS n FROM "session"`).get()!.n);
}

/** 一个此刻没人监听的本机端口：先监听再关掉，连它会被拒绝。 */
async function refusedPort(): Promise<number> {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    await new Promise<void>((resolve, reject) => server.close((error) => (error === undefined ? resolve() : reject(error))));
    if (address === null || typeof address === "string") throw new Error("the probe server has no port");
    return address.port;
}

describe("社交登录", () => {
    it("已关联的身份登录：落到首页、发会话、记最近登录时间", async () => {
        const target = await socialIdentity("social-login-linked");
        const userId = await target.addUser("alice", CONSENTED);
        await insertSocialAccount(target, userId, "google", ALICE.sub);
        upstream.setUser("google", ALICE);

        const response = await followSocial(target, await startSocial(target, "google", {intent: "login"}));
        expect(landing(response)).toEqual({status: 302, path: "/", socialError: null});
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(hasSessionCookie(response)).toBe(true);
        const lastLogin = await target.conn.read((tx) => tx.query<{at: string | null}, [number]>(`SELECT last_login_at AS at FROM identity_profile WHERE user_id = ?`).get(userId)?.at ?? null);
        expect(lastLogin).not.toBeNull();
    });

    it("GitHub 的身份同样按上游的 id 认人", async () => {
        const target = await socialIdentity("social-login-github");
        const userId = await target.addUser("bob", CONSENTED);
        await insertSocialAccount(target, userId, "github", "4242");
        upstream.setUser("github", {id: 4242, login: "bob-gh", name: null, email: null, emails: [{email: "bob@github.test", primary: true, verified: true, visibility: null}]});

        const response = await followSocial(target, await startSocial(target, "github", {intent: "login"}));
        expect(landing(response)).toEqual({status: 302, path: "/", socialError: null});
        expect(hasSessionCookie(response)).toBe(true);
    });

    it("没有关联的上游身份：回登录页带 social_not_registered，不建账号、不发会话", async () => {
        const target = await socialIdentity("social-login-unknown");
        upstream.setUser("google", ALICE);

        const response = await followSocial(target, await startSocial(target, "google", {intent: "login"}));
        expect(landing(response)).toEqual({status: 302, path: "/login", socialError: "social_not_registered"});
        expect(hasSessionCookie(response)).toBe(false);
        expect(await target.conn.read((tx) => tx.query<{n: number}, []>(`SELECT COUNT(*) AS n FROM "user"`).get()!.n)).toBe(0);
    });

    it("上游给的已验证邮箱与一个没关联的账号相同：仍是 social_not_registered，不按邮箱关联、不发会话（输出 12）", async () => {
        const target = await socialIdentity("social-login-same-email");
        const userId = await target.addUser("alice", CONSENTED);
        // 库这时判出的是 `account_not_linked`，码由库的内部文字换来（升级清单“社交”的“错误码表”一行守着它）。
        upstream.setUser("google", {...ALICE, email: "alice@example.com"});

        const response = await followSocial(target, await startSocial(target, "google", {intent: "login"}));
        expect(landing(response)).toEqual({status: 302, path: "/login", socialError: "social_not_registered"});
        expect(hasSessionCookie(response)).toBe(false);
        expect(await target.conn.read((tx) => tx.query<{n: number}, [number]>(`SELECT COUNT(*) AS n FROM "account" WHERE "userId" = ? AND "providerId" = 'google'`).get(userId)!.n)).toBe(0);
    });

    it("上游取消：social_cancelled；上游换令牌出错：social_failed", async () => {
        const target = await socialIdentity("social-login-upstream-errors");
        const userId = await target.addUser("alice", CONSENTED);
        await insertSocialAccount(target, userId, "google", ALICE.sub);
        upstream.setUser("google", ALICE);

        upstream.cancelNext("google");
        expect(landing(await followSocial(target, await startSocial(target, "google", {intent: "login"})))).toEqual({status: 302, path: "/login", socialError: "social_cancelled"});
        upstream.failToken("google");
        expect(landing(await followSocial(target, await startSocial(target, "google", {intent: "login"})))).toEqual({status: 302, path: "/login", socialError: "social_failed"});
        upstream.failToken("github");
        upstream.setUser("github", {id: 7, login: "x", name: null, email: null, emails: []});
        expect(landing(await followSocial(target, await startSocial(target, "github", {intent: "login"})))).toEqual({status: 302, path: "/login", socialError: "social_failed"});
    });

    it("同一个回调地址的三个请求同时到达（都排在认领之前）：恰好一个登录成功、只建一个会话，另两个 social_state_invalid", async () => {
        const timers = new ManualTimers();
        const target = await createTestIdentity("social-login-concurrent-callbacks", {config: {social: fakeSocialConfig(upstream)}, timers});
        identity = target;
        const userId = await target.addUser("alice", CONSENTED);
        await insertSocialAccount(target, userId, "google", ALICE.sub);
        upstream.setUser("google", ALICE);

        const started = await startedSocial(await startSocial(target, "google", {intent: "login"}));
        const callback = await upstreamCallback(started);
        // 占住连接的队列，三个回调对库的第一次访问（认领）都排在它后面，再一起放开：认领若不是一次原子的写，三个都会认领到。
        const gate = await holdQueue(target);
        await gate.started;
        const opened = [0, 1, 2].map(() => openCallback(target, callback, started.stateCookie));
        await waitUntil("三个回调的认领都排上", () => timers.pending === opened.length);
        await gate.release();
        const landings = (await Promise.all(opened)).map((response) => ({...landing(response), session: hasSessionCookie(response)}));

        expect(landings.filter((item) => item.socialError === null)).toEqual([{status: 302, path: "/", socialError: null, session: true}]);
        expect(landings.filter((item) => item.socialError !== null)).toEqual([
            {status: 302, path: "/login", socialError: "social_state_invalid", session: false},
            {status: 302, path: "/login", socialError: "social_state_invalid", session: false},
        ]);
        expect(await sessionCount(target)).toBe(1);
    });

    it("同一个回调地址只能用一次：第二次 social_state_invalid、不发会话", async () => {
        const target = await socialIdentity("social-login-replay");
        const userId = await target.addUser("alice", CONSENTED);
        await insertSocialAccount(target, userId, "google", ALICE.sub);
        upstream.setUser("google", ALICE);

        const started = await startedSocial(await startSocial(target, "google", {intent: "login"}));
        const callback = await upstreamCallback(started);
        expect(landing(await openCallback(target, callback, started.stateCookie)).socialError).toBeNull();
        const replay = await openCallback(target, callback, started.stateCookie);
        expect(landing(replay)).toEqual({status: 302, path: "/login", socialError: "social_state_invalid"});
        expect(hasSessionCookie(replay)).toBe(false);
    });

    it("发起起 10 分钟后才回来：social_state_invalid（模块时钟）", async () => {
        const target = await socialIdentity("social-login-expired");
        const userId = await target.addUser("alice", CONSENTED);
        await insertSocialAccount(target, userId, "google", ALICE.sub);
        upstream.setUser("google", ALICE);

        const started = await startedSocial(await startSocial(target, "google", {intent: "login"}));
        const callback = await upstreamCallback(started);
        target.clock.advance(SOCIAL_FLOW_MS);
        const response = await openCallback(target, callback, started.stateCookie);
        expect(landing(response)).toEqual({status: 302, path: "/login", socialError: "social_state_invalid"});
        expect(hasSessionCookie(response)).toBe(false);
    });

    it("带另一份 state Cookie 打开回调（另一个浏览器）：social_state_invalid，这次流程也用掉了", async () => {
        const target = await socialIdentity("social-login-other-browser");
        const userId = await target.addUser("alice", CONSENTED);
        await insertSocialAccount(target, userId, "google", ALICE.sub);
        upstream.setUser("google", ALICE);

        const browserA = await startedSocial(await startSocial(target, "google", {intent: "login"}));
        const browserB = await startedSocial(await startSocial(target, "google", {intent: "login"}));
        const callbackA = await upstreamCallback(browserA);
        const opened = await openCallback(target, callbackA, browserB.stateCookie);
        expect(landing(opened)).toEqual({status: 302, path: "/login", socialError: "social_state_invalid"});
        expect(hasSessionCookie(opened)).toBe(false);
        // A 自己再带对的 Cookie 来也不成：流程在认浏览器之前就被认领了（时序一节“只能用一次”）。
        expect(landing(await openCallback(target, callbackA, browserA.stateCookie)).socialError).toBe("social_state_invalid");
    });

    it("回调地址带别的 error（包括本站的码与库的码）：social_failed；只有 access_denied 是 social_cancelled", async () => {
        const target = await socialIdentity("social-login-url-error");
        for (const [error, expected] of [
            ["account_already_linked_to_different_user", "social_failed"],
            ["signup_disabled", "social_failed"],
            ["social_not_registered", "social_failed"],
            ["access_denied", "social_cancelled"],
        ] as const) {
            const started = await startedSocial(await startSocial(target, "google", {intent: "login"}));
            const state = new URL(started.url).searchParams.get("state")!;
            const response = await openCallback(target, `${LIB_BASE_PATH}/callback/google?${new URLSearchParams({state, error})}`, started.stateCookie);
            expect({error, ...landing(response)}).toEqual({error, status: 302, path: "/login", socialError: expected});
        }
    });

    it("带不合格的续接令牌发起：照常发起，成功后落到首页（合格的那条在合同测试，oauth-provider 验收 14）", async () => {
        const target = await socialIdentity("social-login-continue-bad");
        const userId = await target.addUser("alice", CONSENTED);
        await insertSocialAccount(target, userId, "google", ALICE.sub);
        upstream.setUser("google", ALICE);

        const response = await followSocial(target, await startSocial(target, "google", {intent: "login", continue: "not-a-signed-token"}));
        expect(landing(response)).toEqual({status: 302, path: "/", socialError: null});
    });

    it("上游没开放：provider_disabled；不是两个上游之一：not_found", async () => {
        identity = await createTestIdentity("social-login-disabled", {config: {social: {github: fakeSocialConfig(upstream).github!}}});
        const disabled = await startSocial(identity, "google", {intent: "login"});
        expect({status: disabled.status, body: await disabled.json()}).toEqual({status: 403, body: {error: {code: "provider_disabled"}}});
        const unknown = await startSocial(identity, "twitter", {intent: "login"});
        expect(unknown.status).toBe(404);
        const meta = await identity.fetch("/meta");
        expect(((await meta.json()) as {providers: unknown}).providers).toEqual({google: false, github: true});
        // 没开放的上游连回调也不放（挂载层）。
        expect((await identity.request(`${LIB_BASE_PATH}/callback/google?state=x&code=y`)).status).toBe(404);
    });

    it("Google 的发现文档取不到（上游拒绝连接）：站点照常起来、站点信息仍说开放，发起回 503 unavailable、不写流程行（输出 11）", async () => {
        const social = fakeSocialConfig(upstream);
        const issuer = `http://127.0.0.1:${String(await refusedPort())}/google`;
        identity = await createTestIdentity("social-login-discovery-down", {config: {social: {...social, google: {...social.google!, issuer}}}});
        const meta = await identity.fetch("/meta");
        expect(((await meta.json()) as {providers: unknown}).providers).toEqual({google: true, github: true});

        const start = await startSocial(identity, "google", {intent: "login"});
        expect({status: start.status, body: await start.json()}).toEqual({status: 503, body: {error: {code: "unavailable"}}});
        expect(await flowCount(identity)).toBe(0);
        expect(identity.log.lines.filter((line) => line.event === "identity.social_provider_unavailable" || line.event === "identity.unhandled_error").map((line) => line.event)).toEqual([
            "identity.social_provider_unavailable",
        ]);
        // 没用发现文档的 GitHub 不受影响。
        expect((await startSocial(identity, "github", {intent: "login"})).status).toBe(200);
    });

    it("登录意图的发起计入登录的来源地址计数，与密码登录共用额度：超限回 429 rate_limited 带 Retry-After、不写流程行；别的来源不受影响（输出 19）", async () => {
        identity = await createTestIdentity("social-login-rate-limit", {config: {social: fakeSocialConfig(upstream)}, start: Date.UTC(2026, 10, 25, 10, 0, 0)});
        const target = identity;
        const from = "198.51.100.40";
        // 先用掉 10 次密码登录（每次一个不存在的用户名，来源加用户名的键不会先满），再发起社交登录用完剩下的 20 次。
        for (let index = 0; index < 10; index += 1) {
            const password = await target.fetch("/login", {
                method: "POST",
                headers: {origin: TEST_SITE_URL, "content-type": "application/json", [TEST_CLIENT_ADDRESS_HEADER]: from},
                body: JSON.stringify({identifier: `nobody${String(index)}`, password: "wrong password"}),
            });
            expect(password.status).toBe(401);
        }
        for (let index = 0; index < 20; index += 1) expect((await startSocial(target, "google", {intent: "login"}, undefined, from)).status).toBe(200);
        expect(await flowCount(target)).toBe(20);

        const limited = await startSocial(target, "google", {intent: "login"}, undefined, from);
        expect({status: limited.status, body: await limited.json(), retryAfter: limited.headers.get("retry-after")}).toEqual({status: 429, body: {error: {code: "rate_limited"}}, retryAfter: "300"});
        expect(await flowCount(target)).toBe(20);
        const password = await target.fetch("/login", {
            method: "POST",
            headers: {origin: TEST_SITE_URL, "content-type": "application/json", [TEST_CLIENT_ADDRESS_HEADER]: from},
            body: JSON.stringify({identifier: "nobody-else", password: "wrong password"}),
        });
        expect(password.status).toBe(429);
        expect((await startSocial(target, "google", {intent: "login"}, undefined, "198.51.100.41")).status).toBe(200);
    });

    it("发起发的 state Cookie 活 10 分钟，与流程的时限一样长", async () => {
        const target = await socialIdentity("social-login-state-cookie");
        const response = await startSocial(target, "google", {intent: "login"});
        expect(response.status).toBe(200);
        // 比流程短时，浏览器在时限之内回来却已丢了 Cookie，落到 social_state_invalid（升级清单“社交”）。
        const state = response.headers.getSetCookie().find((cookie) => cookie.startsWith("__Host-nbsite.state="));
        expect(state?.split(";").map((part) => part.trim().toLowerCase())).toContain(`max-age=${String(SOCIAL_FLOW_MS / 1000)}`);
    });

    it("请求体的意图不认识：validation_failed，只报 intent", async () => {
        const target = await socialIdentity("social-login-body");
        const unknown = await startSocial(target, "google", {intent: "steal"});
        expect({status: unknown.status, body: await unknown.json()}).toEqual({status: 400, body: {error: {code: "validation_failed", fields: ["intent"]}}});
    });

    it("清理任务删 10 分钟之前的流程行", async () => {
        const target = await socialIdentity("social-login-purge");
        await startedSocial(await startSocial(target, "google", {intent: "login"}));
        expect(await flowCount(target)).toBe(1);
        await target.assembly.sessions.purge();
        expect(await flowCount(target)).toBe(1);
        target.clock.advance(SOCIAL_FLOW_MS);
        await target.assembly.sessions.purge();
        expect(await flowCount(target)).toBe(0);
    });
});
