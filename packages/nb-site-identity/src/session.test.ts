/**
 * 会话的读、到期、延长、最后使用时间、问身份、登出与清理（`session.ts`；`site.accounts` 输出 5、7、17，时序与寿命一节）。
 * 真实的 Better Auth 与 bun:sqlite；时间只经模块的手动时钟走。这一片还没有对外的登录，会话经 `sessions.issue` 发；要会话的
 * 路由也还没有，读会话经 `authorize`（中间件里不碰 Hono 的那一半）。
 */

import {afterEach, describe, expect, it} from "bun:test";

import {libDate} from "./db/library-rows";
import {authorize, CONSENT_EXEMPT_ROUTES, type RouteKey} from "./middleware";
import {endSession} from "./session";
import {createTestIdentity, SESSION_COOKIE, TEST_TERMS_VERSION, type TestIdentity} from "./testing/module";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const SESSION_MS = 30 * DAY_MS;
const CONSENTED = {termsVersion: TEST_TERMS_VERSION, overseasStorage: true} as const;

let identity: TestIdentity | undefined;

afterEach(async () => {
    await identity?.root.cleanup();
    identity = undefined;
});

/** 另一条连接持住写锁（模拟进程外的写者）；回放锁的函数。 */
function holdWriteLock(target: TestIdentity): () => void {
    const other = target.root.openOther();
    other.exec("BEGIN IMMEDIATE");
    return () => other.exec("ROLLBACK");
}

async function whoami(target: TestIdentity, cookie: string): Promise<{status: number; body: unknown; setCookies: string[]}> {
    const response = await target.fetch("/whoami", {headers: {cookie}});
    return {status: response.status, body: await response.json(), setCookies: response.headers.getSetCookie()};
}

function sessionCookies(setCookies: readonly string[]): string[] {
    return setCookies.filter((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`));
}

/** 清除会话 Cookie 的 `Set-Cookie`：值为空、`Max-Age=0`（库同时清它的另两个 Cookie，这里只看会话的那一个）。 */
function isClearing(setCookie: string): boolean {
    return setCookie.startsWith(`${SESSION_COOKIE}=;`) && /;\s*Max-Age=0(;|$)/i.test(setCookie);
}

async function setup(name: string, options: {readonly start?: number} = {}) {
    identity = await createTestIdentity(name, options);
    const userId = await identity.addUser("alice", {consent: CONSENTED});
    const issued = await identity.issue(userId);
    return {identity, userId, ...issued};
}

describe("读会话", () => {
    it("发的会话能被读出：问身份回账号的 id、用户名与角色", async () => {
        const {identity, userId, cookie} = await setup("identity-session-read");
        expect(await whoami(identity, cookie)).toEqual({status: 200, body: {state: "authenticated", user: {id: userId, username: "alice", role: "user"}}, setCookies: []});
    });

    it("没带 Cookie、签名不对时是匿名", async () => {
        const {identity, cookie} = await setup("identity-session-anonymous");
        expect((await identity.fetch("/whoami")).status).toBe(200);
        expect(await (await identity.fetch("/whoami")).json()).toEqual({state: "anonymous"});
        const forged = `${cookie.slice(0, -2)}xx`;
        expect((await whoami(identity, forged)).body).toEqual({state: "anonymous"});
    });

    it("按模块的时钟过了会话时长：要会话的接口读不出、当场删行并清 Cookie", async () => {
        const {identity, cookie, sessionId} = await setup("identity-session-expire");
        identity.clock.advance(SESSION_MS);

        const result = await authorize(identity.assembly.sessions, cookie, "GET /me", "user");
        expect(result).toMatchObject({ok: false, code: "unauthenticated"});
        expect(sessionCookies(result.cookies).map(isClearing)).toEqual([true]);
        expect(await identity.sessionRow(sessionId)).toBeNull();
    });

    it("被封禁的账号残留的会话读不出", async () => {
        const {identity, cookie, userId} = await setup("identity-session-banned");
        await identity.conn.write((tx) => tx.query(`UPDATE "user" SET "banned" = 1 WHERE "id" = ?`).run(userId));
        expect((await whoami(identity, cookie)).body).toEqual({state: "anonymous"});
        expect(await authorize(identity.assembly.sessions, cookie, "GET /me", "user")).toMatchObject({ok: false, code: "unauthenticated"});
    });
});

describe("问身份不写库", () => {
    it("拨过两天也不延长、不更新最后使用时间、不发 Cookie", async () => {
        const {identity, cookie, sessionId} = await setup("identity-session-whoami-no-extend");
        const before = await identity.sessionRow(sessionId);
        identity.clock.advance(2 * DAY_MS);

        const answered = await whoami(identity, cookie);
        expect(answered.status).toBe(200);
        expect(answered.setCookies).toEqual([]);
        expect(await identity.sessionRow(sessionId)).toEqual(before);
    });

    it("按模块的时钟到期时回匿名、不删行（留给下一次要会话的请求或清理）", async () => {
        const {identity, cookie, sessionId} = await setup("identity-session-whoami-expired");
        identity.clock.advance(SESSION_MS);
        expect(await whoami(identity, cookie)).toEqual({status: 200, body: {state: "anonymous"}, setCookies: []});
        expect(await identity.sessionRow(sessionId)).not.toBeNull();
    });

    it("账号库被别的连接占着写时照常回答，已登录与按系统时间真的到期的会话都是", async () => {
        // 起点在 31 天前：会话按系统时间已经到期，库的 getSession 会把它当到期处理（不带 deferSessionRefresh 时它在这里删行）。
        const start = Date.now() - 31 * DAY_MS;
        identity = await createTestIdentity("identity-session-whoami-locked", {start});
        const userId = await identity.addUser("alice", {consent: CONSENTED});
        const expired = await identity.issue(userId);
        identity.clock.set(Date.now());
        const live = await identity.issue(userId);

        const release = holdWriteLock(identity);
        try {
            expect(await whoami(identity, live.cookie)).toEqual({status: 200, body: {state: "authenticated", user: {id: userId, username: "alice", role: "user"}}, setCookies: []});
            expect(await whoami(identity, expired.cookie)).toEqual({status: 200, body: {state: "anonymous"}, setCookies: []});
            expect((await identity.fetch("/meta")).status).toBe(200);
        } finally {
            release();
        }
        expect(await identity.sessionRow(expired.sessionId)).not.toBeNull();
    });

    it("账号库不可读时回 503 unavailable 的 ErrorBody（库把读错包成 APIError，原错误在 cause 里）", async () => {
        const {identity, cookie} = await setup("identity-session-whoami-closed");
        await identity.conn.close(0);
        const response = await identity.assembly.sessions.whoami(new Request(`https://site.test/whoami`, {headers: {cookie}}));
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({error: {code: "unavailable"}});
    });
});

describe("使用中的会话", () => {
    it("满一天后延长一次并重发同一个令牌的 Cookie；同一天里不再延长", async () => {
        const {identity, cookie, sessionId} = await setup("identity-session-extend");
        const sessions = identity.assembly.sessions;

        identity.clock.advance(DAY_MS - 1);
        expect((await authorize(sessions, cookie, "GET /me", "user")).cookies).toEqual([]);

        const extendedAt = identity.clock.advance(1);
        const extended = await authorize(sessions, cookie, "GET /me", "user");
        expect(extended.ok).toBe(true);
        const reissued = sessionCookies(extended.cookies);
        expect(reissued).toHaveLength(1);
        expect(reissued[0]!.split(";")[0]).toBe(cookie);
        expect(reissued[0]).toMatch(new RegExp(`;\\s*Max-Age=${SESSION_MS / 1000}(;|$)`, "i"));
        expect(await identity.sessionRow(sessionId)).toMatchObject({expiresAt: libDate(extendedAt + SESSION_MS), updatedAt: libDate(extendedAt)});

        identity.clock.advance(DAY_MS - 1);
        expect((await authorize(sessions, cookie, "GET /me", "user")).cookies).toEqual([]);
        expect(await identity.sessionRow(sessionId)).toMatchObject({expiresAt: libDate(extendedAt + SESSION_MS)});
    });

    it("延长的那一刻会话已被结束时不发 Cookie", async () => {
        const {identity, cookie, sessionId} = await setup("identity-session-extend-ended");
        const sessions = identity.assembly.sessions;
        identity.clock.advance(DAY_MS);
        const {session} = await sessions.read(cookie, "use");
        expect(session).not.toBeNull();

        await identity.conn.write((tx) => endSession(tx, sessionId));
        expect(await sessions.maintain(session!)).toEqual([]);
    });

    it("最后使用时间早于一小时前才更新", async () => {
        const {identity, cookie, sessionId} = await setup("identity-session-touch");
        const sessions = identity.assembly.sessions;
        const issuedRow = await identity.sessionRow(sessionId);

        identity.clock.advance(HOUR_MS - 1);
        await authorize(sessions, cookie, "GET /me", "user");
        expect(await identity.sessionRow(sessionId)).toEqual(issuedRow);

        const touchedAt = identity.clock.advance(1);
        expect((await authorize(sessions, cookie, "GET /me", "user")).cookies).toEqual([]);
        expect(await identity.sessionRow(sessionId)).toMatchObject({updatedAt: libDate(touchedAt), expiresAt: issuedRow!.expiresAt});
    });

    it("延长与更新最后使用时间遇到库被占着写时记 warn、照常放行", async () => {
        const {identity, cookie, sessionId} = await setup("identity-session-maintain-locked");
        const sessions = identity.assembly.sessions;
        const before = await identity.sessionRow(sessionId);

        identity.clock.advance(HOUR_MS);
        const release = holdWriteLock(identity);
        try {
            expect(await authorize(sessions, cookie, "GET /me", "user")).toMatchObject({ok: true, cookies: []});
            identity.clock.advance(DAY_MS);
            expect(await authorize(sessions, cookie, "GET /me", "user")).toMatchObject({ok: true, cookies: []});
        } finally {
            release();
        }
        expect(await identity.sessionRow(sessionId)).toEqual(before);
        expect(identity.log.lines.filter((line) => line.level === "warn").map((line) => line.event)).toEqual(
            expect.arrayContaining(["identity.session_touch_skipped", "identity.session_extend_skipped"]),
        );
    });
});

describe("门槛", () => {
    const user = async (name: string, options: Parameters<TestIdentity["addUser"]>[1]) => {
        identity ??= await createTestIdentity("identity-session-gates");
        const userId = await identity.addUser(name, options);
        return (await identity.issue(userId)).cookie;
    };

    it("放行表正好是 GET me、POST me/consent、POST logout", () => {
        expect([...CONSENT_EXEMPT_ROUTES].sort()).toEqual(["GET /me", "POST /logout", "POST /me/consent"]);
    });

    it("缺当前版本的同意时只有放行表里的路由通过，其余回 consent_required（含管理接口，先于角色门槛）", async () => {
        const missing = await user("none", {});
        const outdated = await user("old", {consent: {termsVersion: "2025-01-01", overseasStorage: true}});
        const declined = await user("declined", {consent: {termsVersion: TEST_TERMS_VERSION, overseasStorage: false}});
        const sessions = identity!.assembly.sessions;
        for (const cookie of [missing, outdated, declined]) {
            for (const route of CONSENT_EXEMPT_ROUTES) expect(await authorize(sessions, cookie, route, "user")).toMatchObject({ok: true});
            for (const route of ["GET /me/invite-codes", "PATCH /me", "GET /me/sessions"] satisfies RouteKey[]) {
                expect(await authorize(sessions, cookie, route, "user")).toMatchObject({ok: false, code: "consent_required"});
            }
            expect(await authorize(sessions, cookie, "GET /admin/users", "admin")).toMatchObject({ok: false, code: "consent_required"});
        }
    });

    it("同意齐了以后：普通用户调管理接口得 forbidden，管理员通过", async () => {
        const plain = await user("plain", {consent: CONSENTED});
        const admin = await user("boss", {role: "admin", consent: CONSENTED});
        const sessions = identity!.assembly.sessions;
        expect(await authorize(sessions, plain, "GET /me/invite-codes", "user")).toMatchObject({ok: true});
        expect(await authorize(sessions, plain, "GET /admin/users", "admin")).toMatchObject({ok: false, code: "forbidden"});
        expect(await authorize(sessions, admin, "GET /admin/users", "admin")).toMatchObject({ok: true, session: {role: "admin"}});
    });

    it("没有会话时回 unauthenticated", async () => {
        identity = await createTestIdentity("identity-session-gates-none");
        expect(await authorize(identity.assembly.sessions, null, "GET /me", "user")).toEqual({ok: false, code: "unauthenticated", cookies: []});
    });
});

describe("清理任务", () => {
    it("登记为启动后先跑一次、每 10 分钟一次；删到期的会话、留下没到期的", async () => {
        const {identity, userId, sessionId: old} = await setup("identity-session-purge");
        identity.clock.advance(DAY_MS);
        const {sessionId: fresh} = await identity.issue(userId);
        expect(identity.jobs.map(({name, intervalMs, initialDelayMs}) => ({name, intervalMs, initialDelayMs}))).toEqual([{name: "purge", intervalMs: 600_000, initialDelayMs: 0}]);

        identity.clock.advance(SESSION_MS - DAY_MS);
        await identity.jobs[0]!.run();
        expect(await identity.sessionRow(old)).toBeNull();
        expect(await identity.sessionRow(fresh)).not.toBeNull();
        expect(identity.log.lines).toContainEqual({level: "info", event: "identity.purged", fields: {sessions: 1}});
    });

    it("库被占着写时记 warn、不抛，下一次再删", async () => {
        const {identity, sessionId} = await setup("identity-session-purge-locked");
        identity.clock.advance(SESSION_MS);
        const release = holdWriteLock(identity);
        try {
            await identity.jobs[0]!.run();
        } finally {
            release();
        }
        expect(await identity.sessionRow(sessionId)).not.toBeNull();
        expect(identity.log.lines.map((line) => line.event)).toContain("identity.purge_skipped");

        await identity.jobs[0]!.run();
        expect(await identity.sessionRow(sessionId)).toBeNull();
    });
});
