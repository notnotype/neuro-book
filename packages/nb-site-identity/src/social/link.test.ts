/**
 * 社交关联（`start.ts` 的关联意图、`hooks.ts`、`upstream-name.ts`；`site.accounts` 输出 15、24，时序一节“关联与结束会话并发”
 * “同一个身份并发关联”，验收 12、13）。
 *
 * 这里测合同测试测不到的：要在库的处理中间插入动作的时序（经占住连接的队列一步一步放行，见 `lockstep`）、库插 `account` 失败
 * 留下的孤行、库表里的列（上游令牌、`emailVerified`）。库插 `account` 失败经一个只在这个用例的库里建的触发器造：钩子已经提交、
 * 库的那一条插入被数据库拒绝，与进程在两步之间出错留下的状态相同。
 */

import {afterEach, beforeEach, describe, expect, it} from "bun:test";

import {startFakeUpstream, type FakeGoogleUser, type FakeUpstream} from "@notnotype/neuro-book-test-support/oauth-upstream";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {endAllSessions} from "../session";
import {ManualTimers} from "../testing/library";
import {createTestIdentity, SESSION_COOKIE, TEST_TERMS_VERSION, type TestIdentity} from "../testing/module";
import {fakeSocialConfig, followSocial, holdQueue, landing, lockstep, openCallback, startedSocial, startSocial, upstreamCallback} from "../testing/social";
import {UPSTREAM_NAME_CLAIM_GRACE_MS} from "./upstream-name";

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
const PASSWORD = "correct horse battery";

/** `email` 为 null 时上游这次不给邮箱。 */
function googleUser(sub: string, email: string | null = `${sub}@gmail.test`, verified = true): FakeGoogleUser {
    return {sub, ...(email === null ? {} : {email}), email_verified: verified, name: `Name ${sub}`};
}

async function socialIdentity(name: string, timers?: ManualTimers): Promise<TestIdentity> {
    identity = await createTestIdentity(name, {config: {social: fakeSocialConfig(upstream)}, ...(timers === undefined ? {} : {timers})});
    return identity;
}

/** 建一个有密码、有当前同意的账号并发会话。 */
async function member(target: TestIdentity, username: string): Promise<{readonly userId: number; readonly cookie: string}> {
    const userId = await target.addUser(username, {...CONSENTED, password: PASSWORD});
    const {cookie} = await target.issue(userId);
    return {userId, cookie};
}

/** `currentPassword` 为 null 时请求体里不带它。 */
function startLink(target: TestIdentity, cookie: string, provider = "google", currentPassword: string | null = PASSWORD): Promise<Response> {
    return startSocial(target, provider, {intent: "link", ...(currentPassword === null ? {} : {currentPassword})}, cookie);
}

interface AccountRow {
    readonly userId: number;
    readonly providerId: string;
    readonly accountId: string;
    readonly accessToken: string | null;
    readonly refreshToken: string | null;
    readonly idToken: string | null;
    readonly accessTokenExpiresAt: string | null;
    readonly refreshTokenExpiresAt: string | null;
}

async function socialAccounts(target: TestIdentity): Promise<AccountRow[]> {
    return target.conn.read((tx) =>
        tx
            .query<AccountRow, []>(
                `SELECT "userId", "providerId", "accountId", "accessToken", "refreshToken", "idToken", "accessTokenExpiresAt", "refreshTokenExpiresAt" FROM "account" WHERE "providerId" <> 'credential' ORDER BY "id"`,
            )
            .all(),
    );
}

async function upstreamNames(target: TestIdentity): Promise<{readonly user_id: number; readonly provider: string; readonly upstream_account_id: string; readonly name: string}[]> {
    return target.conn.read((tx) =>
        tx.query<{user_id: number; provider: string; upstream_account_id: string; name: string}, []>(`SELECT user_id, provider, upstream_account_id, name FROM identity_upstream_name ORDER BY id`).all(),
    );
}

/** 五个令牌列都为空的一行（上游令牌不落库）。 */
function withoutTokens(userId: number, providerId: string, accountId: string): AccountRow {
    return {userId, providerId, accountId, accessToken: null, refreshToken: null, idToken: null, accessTokenExpiresAt: null, refreshTokenExpiresAt: null};
}

describe("社交关联", () => {
    it("关联成功：回 /account，上游名字记下，account 行不含上游令牌；之后用这个身份能登录", async () => {
        const target = await socialIdentity("social-link-ok");
        const alice = await member(target, "alice");
        upstream.setUser("google", googleUser("g-alice"));

        const response = await followSocial(target, await startLink(target, alice.cookie), alice.cookie);
        expect(landing(response)).toEqual({status: 302, path: "/account", socialError: null});
        expect(await socialAccounts(target)).toEqual([withoutTokens(alice.userId, "google", "g-alice")]);
        expect(await upstreamNames(target)).toEqual([{user_id: alice.userId, provider: "google", upstream_account_id: "g-alice", name: "g-alice@gmail.test"}]);

        const login = await followSocial(target, await startSocial(target, "google", {intent: "login"}));
        expect(landing(login)).toEqual({status: 302, path: "/", socialError: null});
        expect(login.headers.getSetCookie().some((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`))).toBe(true);
        // 再登录（`updateAccountOnSignIn: false` 与改账号前钩子）之后也不含令牌。
        expect(await socialAccounts(target)).toEqual([withoutTokens(alice.userId, "google", "g-alice")]);
    });

    it("GitHub 的身份：上游名字是 login，按 id 认", async () => {
        const target = await socialIdentity("social-link-github");
        const alice = await member(target, "alice");
        upstream.setUser("github", {id: 99, login: "alice-gh", name: "Alice", email: null, emails: [{email: "alice@github.test", primary: true, verified: true, visibility: null}]});

        expect(landing(await followSocial(target, await startLink(target, alice.cookie, "github"), alice.cookie)).socialError).toBeNull();
        expect(await upstreamNames(target)).toEqual([{user_id: alice.userId, provider: "github", upstream_account_id: "99", name: "alice-gh"}]);
        expect(await socialAccounts(target)).toEqual([withoutTokens(alice.userId, "github", "99")]);
    });

    it("有密码的账号：不带当前密码 validation_failed，带错的 invalid_credentials，都不发起", async () => {
        const target = await socialIdentity("social-link-password");
        const alice = await member(target, "alice");
        const missing = await startLink(target, alice.cookie, "google", null);
        expect({status: missing.status, body: await missing.json()}).toEqual({status: 400, body: {error: {code: "validation_failed", fields: ["currentPassword"]}}});
        const wrong = await startLink(target, alice.cookie, "google", "not the password");
        expect({status: wrong.status, body: await wrong.json()}).toEqual({status: 401, body: {error: {code: "invalid_credentials"}}});
        expect(await target.conn.read((tx) => tx.query<{n: number}, []>(`SELECT COUNT(*) AS n FROM identity_social_flow`).get()!.n)).toBe(0);
    });

    it("没有密码的账号免带当前密码", async () => {
        const target = await socialIdentity("social-link-no-password");
        const userId = await target.addUser("carol", CONSENTED);
        const {cookie} = await target.issue(userId);
        upstream.setUser("google", googleUser("g-carol"));
        expect(landing(await followSocial(target, await startLink(target, cookie, "google", null), cookie)).socialError).toBeNull();
    });

    it("再关联已关联的同一个身份：identity_exists，account 行不变", async () => {
        const target = await socialIdentity("social-link-again");
        const alice = await member(target, "alice");
        upstream.setUser("google", googleUser("g-alice"));
        await followSocial(target, await startLink(target, alice.cookie), alice.cookie);

        const again = await followSocial(target, await startLink(target, alice.cookie), alice.cookie);
        expect(landing(again)).toEqual({status: 302, path: "/account", socialError: "identity_exists"});
        expect(await socialAccounts(target)).toEqual([withoutTokens(alice.userId, "google", "g-alice")]);
    });

    it("这个账号在该上游已有别的身份：identity_exists；别的账号已关联这个身份：identity_taken", async () => {
        const target = await socialIdentity("social-link-conflicts");
        const alice = await member(target, "alice");
        const bob = await member(target, "bob");
        upstream.setUser("google", googleUser("g-alice"));
        await followSocial(target, await startLink(target, alice.cookie), alice.cookie);

        upstream.setUser("google", googleUser("g-alice-2"));
        expect(landing(await followSocial(target, await startLink(target, alice.cookie), alice.cookie)).socialError).toBe("identity_exists");
        upstream.setUser("google", googleUser("g-alice"));
        expect(landing(await followSocial(target, await startLink(target, bob.cookie), bob.cookie)).socialError).toBe("identity_taken");
        expect(await socialAccounts(target)).toEqual([withoutTokens(alice.userId, "google", "g-alice")]);
        expect((await upstreamNames(target)).map((row) => [row.user_id, row.upstream_account_id])).toEqual([[alice.userId, "g-alice"]]);
    });

    it("发起的会话在回调之前结束：social_state_invalid，不关联", async () => {
        const target = await socialIdentity("social-link-session-ended");
        const alice = await member(target, "alice");
        upstream.setUser("google", googleUser("g-alice"));
        const started = await startedSocial(await startLink(target, alice.cookie));
        const callback = await upstreamCallback(started);
        await target.conn.write((tx) => endAllSessions(tx, alice.userId, target.clock.now()));

        expect(landing(await openCallback(target, callback, started.stateCookie))).toEqual({status: 302, path: "/account", socialError: "social_state_invalid"});
        expect(await socialAccounts(target)).toEqual([]);
    });

    it("上游已返回、关联钩子复核之前会话被结束：social_state_invalid，不关联、不记上游名字", async () => {
        const timers = new ManualTimers();
        const target = await socialIdentity("social-link-session-ended-late", timers);
        const alice = await member(target, "alice");
        upstream.setUser("google", googleUser("g-alice"));
        const started = await startedSocial(await startLink(target, alice.cookie));
        const callback = await upstreamCallback(started);
        const token = upstream.holdToken("google");
        const opened = openCallback(target, callback, `${started.stateCookie}; ${alice.cookie}`);
        await token.arrived;

        // 换令牌之后，库在关联钩子之前查两次库（库 1.7.27 的 `linkOAuthAccount`：按 state 里的令牌复核会话、按上游身份找已有的
        // `account` 行；升级清单“社交”的“关联的先后”）。让库复核会话那一步先跑过，再把结束会话的写排在库的第二步与钩子之间。
        const first = await holdQueue(target);
        await first.started;
        token.release();
        await waitUntil("库复核会话的那一步排上", () => timers.pending === 1);
        const second = await holdQueue(target);
        await waitUntil("第二个占位排在它后面", () => timers.pending === 2);
        await first.release();
        await second.started;
        await waitUntil("库找已有 account 行的那一步排上", () => timers.pending === 1);
        const ended = target.conn.write((tx) => endAllSessions(tx, alice.userId, target.clock.now()));
        await waitUntil("结束会话的写排在它后面", () => timers.pending === 2);
        await second.release();
        await ended;

        expect(landing(await opened)).toEqual({status: 302, path: "/account", socialError: "social_state_invalid"});
        expect(await socialAccounts(target)).toEqual([]);
        expect(await upstreamNames(target)).toEqual([]);
    });

    it("另一个浏览器打开关联的回调（state Cookie 不是它发起时拿到的）：social_state_invalid，不关联", async () => {
        const target = await socialIdentity("social-link-other-browser");
        const alice = await member(target, "alice");
        upstream.setUser("google", googleUser("g-alice"));
        const browserA = await startedSocial(await startLink(target, alice.cookie));
        const browserB = await startedSocial(await startSocial(target, "google", {intent: "login"}));
        const opened = await openCallback(target, await upstreamCallback(browserA), browserB.stateCookie);
        expect(landing(opened)).toEqual({status: 302, path: "/account", socialError: "social_state_invalid"});
        expect(opened.headers.getSetCookie().some((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`) && !cookie.startsWith(`${SESSION_COOKIE}=;`))).toBe(false);
        expect(await socialAccounts(target)).toEqual([]);
    });

    it("库插 account 失败留下的孤行：1 分钟之内再关联 identity_exists，过了 1 分钟能关联", async () => {
        const target = await socialIdentity("social-link-orphan");
        const alice = await member(target, "alice");
        upstream.setUser("google", googleUser("g-alice"));
        await target.conn.write((tx) => tx.query(`CREATE TRIGGER reject_social_account BEFORE INSERT ON "account" WHEN NEW."providerId" = 'google' BEGIN SELECT RAISE(ABORT, 'injected'); END`).run());

        expect(landing(await followSocial(target, await startLink(target, alice.cookie), alice.cookie)).socialError).toBe("social_failed");
        expect(await socialAccounts(target)).toEqual([]);
        expect(await upstreamNames(target)).toHaveLength(1);

        await target.conn.write((tx) => tx.query(`DROP TRIGGER reject_social_account`).run());
        expect(landing(await followSocial(target, await startLink(target, alice.cookie), alice.cookie)).socialError).toBe("identity_exists");
        target.clock.advance(UPSTREAM_NAME_CLAIM_GRACE_MS);
        expect(landing(await followSocial(target, await startLink(target, alice.cookie), alice.cookie)).socialError).toBeNull();
        expect(await socialAccounts(target)).toEqual([withoutTokens(alice.userId, "google", "g-alice")]);
        expect(await upstreamNames(target)).toHaveLength(1);
    });

    it("同一个账号并发关联两个身份：只成一个，另一个 identity_exists", async () => {
        const timers = new ManualTimers();
        const target = await socialIdentity("social-link-concurrent-same-account", timers);
        const alice = await member(target, "alice");
        const flows = [];
        for (const sub of ["g-one", "g-two"]) {
            upstream.setUser("google", googleUser(sub));
            const started = await startedSocial(await startLink(target, alice.cookie));
            flows.push({started, callback: await upstreamCallback(started)});
        }
        const tokens = flows.map(() => upstream.holdToken("google"));
        const opened = flows.map((flow) => openCallback(target, flow.callback, `${flow.started.stateCookie}; ${alice.cookie}`));
        await Promise.all(tokens.map((token) => token.arrived));
        const first = await holdQueue(target);
        await first.started;
        for (const token of tokens) token.release();

        const results = (await lockstep(target, timers, first, opened)).map((response) => landing(response).socialError);
        expect(results.toSorted((left, right) => String(left).localeCompare(String(right)))).toEqual(["identity_exists", null]);
        expect(await socialAccounts(target)).toHaveLength(1);
        expect(await upstreamNames(target)).toHaveLength(1);
    });

    it("两个账号并发关联同一个身份：只成一个，另一个 identity_taken", async () => {
        const timers = new ManualTimers();
        const target = await socialIdentity("social-link-concurrent-same-identity", timers);
        const members = [await member(target, "alice"), await member(target, "bob")];
        upstream.setUser("google", googleUser("g-shared"));
        const flows = [];
        for (const who of members) {
            const started = await startedSocial(await startLink(target, who.cookie));
            flows.push({started, cookie: who.cookie, callback: await upstreamCallback(started)});
        }
        const tokens = flows.map(() => upstream.holdToken("google"));
        const opened = flows.map((flow) => openCallback(target, flow.callback, `${flow.started.stateCookie}; ${flow.cookie}`));
        await Promise.all(tokens.map((token) => token.arrived));
        const first = await holdQueue(target);
        await first.started;
        for (const token of tokens) token.release();

        const results = (await lockstep(target, timers, first, opened)).map((response) => landing(response).socialError);
        expect(results.toSorted((left, right) => String(left).localeCompare(String(right)))).toEqual(["identity_taken", null]);
        expect(await socialAccounts(target)).toHaveLength(1);
        expect(await upstreamNames(target)).toHaveLength(1);
    });
});

describe("已关联身份的再登录", () => {
    it("上游说邮箱已验证、且与账号的相同：账号的 emailVerified 仍为 false", async () => {
        const target = await socialIdentity("social-relogin-email-verified");
        const alice = await member(target, "alice");
        // 与 `addUser` 给账号的邮箱相同：库只在两者相同时改 `emailVerified`。
        upstream.setUser("google", googleUser("g-alice", "alice@example.com", true));
        await followSocial(target, await startLink(target, alice.cookie), alice.cookie);

        expect(landing(await followSocial(target, await startSocial(target, "google", {intent: "login"}))).socialError).toBeNull();
        const column = await target.conn.read((tx) => tx.query<{v: number}, [number]>(`SELECT "emailVerified" AS v FROM "user" WHERE "id" = ?`).get(alice.userId)!.v);
        expect(column).toBe(0);
    });

    it("这次上游没给邮箱：social_failed，不发会话", async () => {
        const target = await socialIdentity("social-relogin-no-email");
        const alice = await member(target, "alice");
        upstream.setUser("google", googleUser("g-alice"));
        await followSocial(target, await startLink(target, alice.cookie), alice.cookie);
        upstream.setUser("github", {id: 5, login: "alice-gh", name: null, email: null, emails: [{email: "alice@github.test", primary: true, verified: true, visibility: null}]});
        await followSocial(target, await startLink(target, alice.cookie, "github"), alice.cookie);

        upstream.setUser("google", googleUser("g-alice", null));
        const google = await followSocial(target, await startSocial(target, "google", {intent: "login"}));
        expect(landing(google)).toEqual({status: 302, path: "/login", socialError: "social_failed"});
        expect(google.headers.getSetCookie().some((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`) && !cookie.startsWith(`${SESSION_COOKIE}=;`))).toBe(false);
        upstream.setUser("github", {id: 5, login: "alice-gh", name: null, email: null, emails: []});
        expect(landing(await followSocial(target, await startSocial(target, "github", {intent: "login"}))).socialError).toBe("social_failed");
    });
});
