/**
 * 自己的会话：列表与结束一个（`my-sessions.ts`；`site.accounts` 输出 17）。
 *
 * 合同测试经 HTTP 覆盖两个浏览器的列表、结束别的会话与当前会话；这里补要拨钟或直接改库才造得出的：同一时刻建的会话按 id 排、
 * 到期的会话不在列表里、最后使用时间按小时更新、列里存了不是概要的值时不把它交出去。
 */

import {afterEach, describe, expect, it} from "bun:test";
import {Value} from "typebox/value";

import {SessionListResponse} from "@notnotype/nb-site-identity-contract";

import {TEST_SITE_URL} from "./testing/library";
import {createTestIdentity, SESSION_COOKIE, TEST_TERMS_VERSION, type TestIdentity} from "./testing/module";

let identity: TestIdentity | undefined;

afterEach(async () => {
    await identity?.root.cleanup();
    identity = undefined;
});

const CONSENTED = {termsVersion: TEST_TERMS_VERSION, overseasStorage: true} as const;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0";
const CHROME_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function listSessions(target: TestIdentity, cookie: string): Promise<Response> {
    return target.fetch("/me/sessions", {headers: {cookie}});
}

function endSessionRequest(target: TestIdentity, cookie: string, id: number | string, body?: string): Promise<Response> {
    return target.fetch(`/me/sessions/${String(id)}`, {method: "DELETE", headers: {origin: TEST_SITE_URL, cookie, ...(body === undefined ? {} : {"content-type": "application/json"})}, ...(body === undefined ? {} : {body})});
}

async function outcome(response: Response): Promise<{readonly status: number; readonly body: unknown}> {
    return {status: response.status, body: await response.json()};
}

async function listed(target: TestIdentity, cookie: string): Promise<SessionListResponse> {
    const response = await listSessions(target, cookie);
    const body = await response.json();
    expect({status: response.status, shape: Value.Check(SessionListResponse, body)}).toEqual({status: 200, shape: true});
    return body as SessionListResponse;
}

describe("GET me/sessions（输出 17）", () => {
    it("自己的未到期会话按建立时间倒序、同一时刻按 id 倒序；标出当前会话；只给浏览器与系统的名字，认不出的为 null", async () => {
        const start = Date.now();
        identity = await createTestIdentity("identity-my-sessions-list", {start});
        const alice = await identity.addUser("alice", {consent: CONSENTED});
        const bob = await identity.addUser("bob", {consent: CONSENTED});
        const firefox = await identity.issue(alice, FIREFOX_LINUX);
        identity.clock.advance(10 * 60_000);
        const chrome = await identity.issue(alice, CHROME_WINDOWS);
        const curl = await identity.issue(alice, "curl/8.10.1");
        await identity.issue(bob, FIREFOX_LINUX);

        const response = await listSessions(identity, chrome.cookie);
        const text = await response.text();
        expect(text).not.toContain("Mozilla");
        expect(text).not.toContain("curl");
        const later = new Date(start + 10 * 60_000).toISOString();
        expect(JSON.parse(text)).toEqual({
            items: [
                {id: curl.sessionId, createdAt: later, lastUsedAt: later, browser: null, os: null, current: false},
                {id: chrome.sessionId, createdAt: later, lastUsedAt: later, browser: "Chrome", os: "Windows", current: true},
                {id: firefox.sessionId, createdAt: new Date(start).toISOString(), lastUsedAt: new Date(start).toISOString(), browser: "Firefox", os: "Linux", current: false},
            ],
        });
    });

    it("到期的会话不在列表里", async () => {
        identity = await createTestIdentity("identity-my-sessions-expired");
        const alice = await identity.addUser("alice", {consent: CONSENTED});
        await identity.issue(alice, FIREFOX_LINUX);
        identity.clock.advance(31 * DAY_MS);
        const current = await identity.issue(alice, CHROME_WINDOWS);
        expect((await listed(identity, current.cookie)).items.map((item) => item.id)).toEqual([current.sessionId]);
    });

    it("最后使用时间：一小时内再用不变，过了一小时再用就更新（精确到一小时以内）", async () => {
        const start = Date.now();
        identity = await createTestIdentity("identity-my-sessions-last-used", {start});
        const alice = await identity.addUser("alice", {consent: CONSENTED});
        const {cookie} = await identity.issue(alice);
        identity.clock.advance(HOUR_MS - 1);
        expect((await listed(identity, cookie)).items[0]!.lastUsedAt).toBe(new Date(start).toISOString());
        identity.clock.advance(1);
        // 这一次请求里先更新再读：列表回的是这次请求的时刻。
        expect((await listed(identity, cookie)).items[0]!.lastUsedAt).toBe(new Date(start + HOUR_MS).toISOString());
    });

    it("列里存了不是概要的值（绕过了建会话的钩子）：回两个 null，不把它交出去，记一行诊断", async () => {
        identity = await createTestIdentity("identity-my-sessions-unreadable");
        const alice = await identity.addUser("alice", {consent: CONSENTED});
        const {cookie, sessionId} = await identity.issue(alice);
        await identity.conn.write((tx) => tx.query(`UPDATE "session" SET "userAgent" = ? WHERE "id" = ?`).run(FIREFOX_LINUX, sessionId));
        const response = await listSessions(identity, cookie);
        const text = await response.text();
        expect(text).not.toContain("Mozilla");
        expect((JSON.parse(text) as SessionListResponse).items).toEqual([expect.objectContaining({id: sessionId, browser: null, os: null})]);
        expect(identity.log.lines.filter((line) => line.event === "identity.session_agent_unreadable")).toEqual([{level: "warn", event: "identity.session_agent_unreadable", fields: {count: 1}}]);
    });

    it("在同意门槛之内：缺同意时 consent_required", async () => {
        identity = await createTestIdentity("identity-my-sessions-consent");
        const alice = await identity.addUser("alice", {consent: {termsVersion: "2020-01-01", overseasStorage: true}});
        const {cookie} = await identity.issue(alice);
        expect(await outcome(await listSessions(identity, cookie))).toEqual({status: 403, body: {error: {code: "consent_required"}}});
    });
});

describe("DELETE me/sessions/:id（输出 17）", () => {
    it("结束别的会话：回 {}、当前的 Cookie 不动；被结束的会话的 Cookie 之后得 unauthenticated", async () => {
        identity = await createTestIdentity("identity-my-sessions-end-other");
        const alice = await identity.addUser("alice", {consent: CONSENTED});
        const current = await identity.issue(alice, CHROME_WINDOWS);
        const other = await identity.issue(alice, FIREFOX_LINUX);
        const response = await endSessionRequest(identity, current.cookie, other.sessionId);
        expect({setCookie: response.headers.getSetCookie(), ...(await outcome(response))}).toEqual({setCookie: [], status: 200, body: {}});
        expect(await outcome(await identity.fetch("/me", {headers: {cookie: other.cookie}}))).toEqual({status: 401, body: {error: {code: "unauthenticated"}}});
        expect((await listed(identity, current.cookie)).items.map((item) => item.id)).toEqual([current.sessionId]);
    });

    it("结束当前会话：带清除 Cookie 的 Set-Cookie，之后这个 Cookie 得 unauthenticated", async () => {
        identity = await createTestIdentity("identity-my-sessions-end-current");
        const alice = await identity.addUser("alice", {consent: CONSENTED});
        const current = await identity.issue(alice);
        const response = await endSessionRequest(identity, current.cookie, current.sessionId, "{}");
        expect(await outcome(response)).toEqual({status: 200, body: {}});
        const cleared = response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`));
        expect(cleared?.toLowerCase()).toContain("max-age=0");
        expect(await identity.sessionRow(current.sessionId)).toBeNull();
        expect(await outcome(await identity.fetch("/me", {headers: {cookie: current.cookie}}))).toEqual({status: 401, body: {error: {code: "unauthenticated"}}});
    });

    it("别人的会话与不存在的会话：not_found，别人的会话还在", async () => {
        identity = await createTestIdentity("identity-my-sessions-end-not-own");
        const alice = await identity.addUser("alice", {consent: CONSENTED});
        const bob = await identity.addUser("bob", {consent: CONSENTED});
        const mine = await identity.issue(alice);
        const theirs = await identity.issue(bob);
        expect(await outcome(await endSessionRequest(identity, mine.cookie, theirs.sessionId))).toEqual({status: 404, body: {error: {code: "not_found"}}});
        expect(await outcome(await endSessionRequest(identity, mine.cookie, theirs.sessionId + 100))).toEqual({status: 404, body: {error: {code: "not_found"}}});
        expect(await identity.sessionRow(theirs.sessionId)).not.toBeNull();
        expect((await identity.fetch("/me", {headers: {cookie: theirs.cookie}})).status).toBe(200);
    });

    it("请求体只能为空或没有键的对象（输出 22）；缺同意时 consent_required", async () => {
        identity = await createTestIdentity("identity-my-sessions-end-body");
        const alice = await identity.addUser("alice", {consent: CONSENTED});
        const current = await identity.issue(alice);
        const other = await identity.issue(alice);
        expect(await outcome(await endSessionRequest(identity, current.cookie, other.sessionId, JSON.stringify({id: other.sessionId})))).toEqual({status: 400, body: {error: {code: "validation_failed", fields: []}}});
        expect(await identity.sessionRow(other.sessionId)).not.toBeNull();

        const stale = await identity.addUser("stale", {consent: {termsVersion: "2020-01-01", overseasStorage: true}});
        const staleSession = await identity.issue(stale);
        const staleOther = await identity.issue(stale);
        expect(await outcome(await endSessionRequest(identity, staleSession.cookie, staleOther.sessionId))).toEqual({status: 403, body: {error: {code: "consent_required"}}});
        expect(await identity.sessionRow(staleOther.sessionId)).not.toBeNull();
    });
});
