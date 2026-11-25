/**
 * 社交登录（`start.ts`、`callback.ts`；`site.accounts` 输出 11、12、15、23 的登录意图，时序一节“发起起 10 分钟、只能用一次”，验收 11）。
 *
 * 上游是仿真上游（第三方的替身），站点是真的模块。合同测试（`nb-site-contract-tests` 的 `accounts-social.test.ts`）走同样的
 * 场景；这里另测合同测试里不好造的：拨模块时钟让流程过期、清理任务删流程行、库给的 state Cookie 换成另一份。
 */

import {afterEach, beforeEach, describe, expect, it} from "bun:test";

import {startFakeUpstream, type FakeUpstream} from "@notnotype/neuro-book-test-support/oauth-upstream";

import {LIB_BASE_PATH} from "../auth";
import {SOCIAL_FLOW_MS} from "./flow";
import {createTestIdentity, SESSION_COOKIE, TEST_TERMS_VERSION, type TestIdentity} from "../testing/module";
import {fakeSocialConfig, followSocial, insertSocialAccount, landing, openCallback, startedSocial, startSocial, upstreamCallback} from "../testing/social";

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
