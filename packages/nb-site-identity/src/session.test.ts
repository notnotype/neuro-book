/**
 * 会话的读、到期、延长、最后使用时间、问身份、登出与清理（`session.ts`；`site.accounts` 输出 5、7、17，时序与寿命一节）。
 * 真实的 Better Auth 与 bun:sqlite；时间只经模块的手动时钟走。这里只测会话本身：会话经 `sessions.issue` 直接发，读会话经
 * `authorize`（中间件里不碰 Hono 的那一半），不经登录与具体的路由。
 */

import {SQLiteError} from "bun:sqlite";
import {afterEach, describe, expect, it} from "bun:test";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {isDbUnavailable} from "./db/connection";
import {libDate} from "./db/library-rows";
import {authorize, CONSENT_EXEMPT_ROUTES, type RouteKey} from "./middleware";
import {endAllSessions, endSession} from "./session";
import {ManualTimers} from "./testing/library";
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

    it("按系统时间已到期（库只回空）：要会话的接口回 unauthenticated 并清 Cookie，行留给清理任务；签名不对的会话 Cookie 也清", async () => {
        // 起点在 31 天前、时钟不拨：模块按自己的时钟认为会话还有效，库按系统时间认为它已到期，走不到模块删行的那一支。
        const {identity, cookie, sessionId} = await setup("identity-session-lib-expired", {start: Date.now() - 31 * DAY_MS});
        const sessions = identity.assembly.sessions;

        const result = await authorize(sessions, cookie, "GET /me", "user");
        expect(result).toMatchObject({ok: false, code: "unauthenticated"});
        expect(sessionCookies(result.cookies).map(isClearing)).toEqual([true]);
        expect(await identity.sessionRow(sessionId)).not.toBeNull();

        const forged = await authorize(sessions, `${cookie.slice(0, -2)}xx`, "GET /me", "user");
        expect(sessionCookies(forged.cookies).map(isClearing)).toEqual([true]);
        // 没带会话 Cookie 的请求不发清除。
        expect(await authorize(sessions, "other=1", "GET /me", "user")).toEqual({ok: false, code: "unauthenticated", cookies: []});
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

    it("不查同意记录：同意表读不出时，已登录的 whoami 照常回答（要会话的接口这时读不了会话）", async () => {
        const {identity, userId, cookie} = await setup("identity-session-whoami-no-consent");
        // 在另一条连接上把同意表改名：之后按原名查它的语句都失败，库自己的表不受影响。
        const other = identity.root.openOther();
        other.exec("ALTER TABLE identity_consent RENAME TO identity_consent_unreadable");
        expect(await whoami(identity, cookie)).toEqual({status: 200, body: {state: "authenticated", user: {id: userId, username: "alice", role: "user"}}, setCookies: []});
        // 对照：查同意的那条路径确实读不了，上面的回答不是因为同意表照样能读。
        await expect(authorize(identity.assembly.sessions, cookie, "GET /me", "user")).rejects.toBeInstanceOf(SQLiteError);
    });

    it("账号库不可读时回 503 unavailable 的 ErrorBody（库把读错包成 APIError，原错误在 cause 里）", async () => {
        const {identity, cookie} = await setup("identity-session-whoami-closed");
        await identity.conn.close(0);
        const response = await identity.assembly.sessions.whoami(new Request(`https://site.test/whoami`, {headers: {cookie}}));
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({error: {code: "unavailable"}});
    });
});

describe("问身份与写事务交错", () => {
    it("改角色并结束全部会话的写排在问身份的读之后时，问身份回旧的角色，之后是匿名；不会拿旧会话回新角色", async () => {
        // 手动计时器只用来数排队等锁的个数（每个等锁的登记一个上限计时器），不拨它，没人等到超时。
        const timers = new ManualTimers();
        identity = await createTestIdentity("identity-session-whoami-interleave", {timers});
        const userId = await identity.addUser("alice", {consent: CONSENTED});
        const {cookie} = await identity.issue(userId);
        const {adapter} = await identity.assembly.auth.$context;

        // 先让一个库的事务占住队列，问身份与改角色依次排在它后面：放开以后它们按排队的先后执行。
        const started = Promise.withResolvers<void>();
        const finish = Promise.withResolvers<void>();
        const holder = identity.conn.withLibTransaction(adapter, async () => {
            started.resolve();
            await finish.promise;
        });
        await started.promise;
        const crossing = whoami(identity, cookie);
        await waitUntil("问身份的读在排队", () => timers.pending === 1);
        const nowMs = identity.clock.now();
        const promote = identity.conn.write((tx) => {
            tx.query(`UPDATE "user" SET "role" = 'admin' WHERE "id" = ?`).run(userId);
            return endAllSessions(tx, userId, nowMs);
        });
        await waitUntil("改角色的写排在它后面", () => timers.pending === 2);
        finish.resolve();
        await holder;

        expect(await promote).toBe(1);
        expect(await crossing).toEqual({status: 200, body: {state: "authenticated", user: {id: userId, username: "alice", role: "user"}}, setCookies: []});
        expect((await whoami(identity, cookie)).body).toEqual({state: "anonymous"});
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

        await identity.conn.write((tx) => endSession(tx, sessionId, identity.clock.now()));
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

    it("库被占着写时记 warn、以库不可用的错误失败，下一次再删", async () => {
        const {identity, sessionId} = await setup("identity-session-purge-locked");
        identity.clock.advance(SESSION_MS);
        const release = holdWriteLock(identity);
        let failed: unknown;
        try {
            failed = await Promise.resolve(identity.jobs[0]!.run()).then(() => undefined, (error: unknown) => error);
        } finally {
            release();
        }
        expect(isDbUnavailable(failed)).toBe(true);
        expect(await identity.sessionRow(sessionId)).not.toBeNull();
        expect(identity.log.lines.map((line) => line.event)).toContain("identity.purge_skipped");

        await identity.jobs[0]!.run();
        expect(await identity.sessionRow(sessionId)).toBeNull();
    });
});
