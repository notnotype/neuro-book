/**
 * 子应用的登出与出错出口（`app.ts`、`errors.ts`；`site.accounts` 输出 5、22，失败表）。来源头、请求体、未知路径这些对外形状
 * 由合同测试（`nb-site-contract-tests` 的 `accounts.test.ts`）在真实进程上验；这里验要会话或要撞写锁才看得到的部分：这一片
 * 还没有对外的登录，合同测试造不出会话。
 */

import type {SQLiteError} from "bun:sqlite";
import {afterEach, describe, expect, it} from "bun:test";

import {APIError} from "better-auth/api";
import {LoginRequest} from "@notnotype/nb-site-identity-contract";

import {IdentityQueueMisuseError} from "./db/connection";
import {failureFor, invalidFields} from "./errors";
import {recordingLog, TEST_SITE_URL} from "./testing/library";
import {createTestIdentity, SESSION_COOKIE, TEST_TERMS_VERSION, type TestIdentity} from "./testing/module";

let identity: TestIdentity | undefined;

afterEach(async () => {
    await identity?.root.cleanup();
    identity = undefined;
});

function logout(target: TestIdentity, cookie?: string): Promise<Response> {
    return target.fetch("/logout", {method: "POST", headers: {origin: TEST_SITE_URL, ...(cookie === undefined ? {} : {cookie})}});
}

async function whoamiState(target: TestIdentity, cookie: string): Promise<unknown> {
    return ((await (await target.fetch("/whoami", {headers: {cookie}})).json()) as {state: unknown}).state;
}

const clearsSession = (setCookies: readonly string[]) => setCookies.some((cookie) => cookie.startsWith(`${SESSION_COOKIE}=;`) && /;\s*Max-Age=0(;|$)/i.test(cookie));

describe("登出", () => {
    it("只结束当前会话：回 {}、清 Cookie、删行；同一账号的另一个会话照常", async () => {
        identity = await createTestIdentity("identity-app-logout");
        const userId = await identity.addUser("alice", {consent: {termsVersion: TEST_TERMS_VERSION, overseasStorage: true}});
        const current = await identity.issue(userId);
        const other = await identity.issue(userId);

        const response = await logout(identity, current.cookie);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({});
        expect(clearsSession(response.headers.getSetCookie())).toBe(true);
        expect(await identity.sessionRow(current.sessionId)).toBeNull();
        expect(await whoamiState(identity, current.cookie)).toBe("anonymous");
        expect(await whoamiState(identity, other.cookie)).toBe("authenticated");
    });

    it("没有会话时也成功并清 Cookie", async () => {
        identity = await createTestIdentity("identity-app-logout-anonymous");
        const response = await logout(identity);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({});
        expect(clearsSession(response.headers.getSetCookie())).toBe(true);
    });

    it("账号库被别的连接占着写时回 503 unavailable、不清 Cookie，会话仍然有效", async () => {
        identity = await createTestIdentity("identity-app-logout-locked");
        const userId = await identity.addUser("alice", {consent: {termsVersion: TEST_TERMS_VERSION, overseasStorage: true}});
        const {cookie, sessionId} = await identity.issue(userId);

        const holder = identity.root.openOther();
        holder.exec("BEGIN IMMEDIATE");
        let response: Response;
        try {
            response = await logout(identity, cookie);
        } finally {
            holder.exec("ROLLBACK");
        }
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({error: {code: "unavailable"}});
        expect(response.headers.getSetCookie()).toEqual([]);
        expect(await identity.sessionRow(sessionId)).not.toBeNull();
        expect(await whoamiState(identity, cookie)).toBe("authenticated");
        expect(identity.log.lines.map((line) => line.event)).toContain("identity.db_unavailable");
    });
});

/** 另一条连接持着写锁时，在不等锁的连接上写一句，取到 SQLite 的原错误。 */
async function realBusyError(target: TestIdentity): Promise<SQLiteError> {
    const holder = target.root.openOther();
    const writer = target.root.openOther();
    writer.exec("PRAGMA busy_timeout = 0");
    holder.exec("BEGIN IMMEDIATE");
    try {
        writer.exec(`DELETE FROM "session"`);
    } catch (error) {
        return error as SQLiteError;
    } finally {
        holder.exec("ROLLBACK");
    }
    throw new Error("the write did not fail under the lock");
}

describe("出错出口的归类", () => {
    it("SQLite 的忙：503 unavailable；被库包成 APIError、原错误在 cause 里时也是", async () => {
        identity = await createTestIdentity("identity-app-errors");
        const busy = await realBusyError(identity);
        const wrapped = APIError.from("INTERNAL_SERVER_ERROR", {code: "FAILED_TO_GET_SESSION", message: "Failed to get session"}, {cause: busy});
        for (const error of [busy, wrapped]) {
            const log = recordingLog();
            expect(failureFor(error, log)).toEqual({status: 503, body: {error: {code: "unavailable"}}, headers: {}});
            expect(log.lines).toEqual([{level: "warn", event: "identity.db_unavailable", fields: {errorType: error.name}}]);
        }
    });

    it("漏到出口的 APIError 与别的错误：500 internal，记 error；队列用错了也是 500，单独记一个事件", () => {
        const cases = [
            [new APIError("BAD_REQUEST", {message: "x", code: "X"}), "identity.unhandled_error"],
            [new TypeError("boom"), "identity.unhandled_error"],
            [new IdentityQueueMisuseError("misuse"), "identity.queue_misuse"],
        ] as const;
        for (const [error, event] of cases) {
            const log = recordingLog();
            expect(failureFor(error, log)).toEqual({status: 500, body: {error: {code: "internal"}}, headers: {}});
            expect(log.lines.map((line) => [line.level, line.event])).toEqual([["error", event]]);
        }
    });
});

describe("请求体的字段名", () => {
    it("类型不对、缺的、多余的键各报自己的键名，去重", () => {
        expect(invalidFields(LoginRequest, {identifier: "alice", password: "pw"})).toEqual([]);
        expect(invalidFields(LoginRequest, {identifier: 1, password: "pw"})).toEqual(["identifier"]);
        expect(invalidFields(LoginRequest, {identifier: "alice"})).toEqual(["password"]);
        expect(invalidFields(LoginRequest, {identifier: "alice", password: "pw", extra: true})).toEqual(["extra"]);
        expect(invalidFields(LoginRequest, {identifier: 1, password: 2, extra: true}).sort()).toEqual(["extra", "identifier", "password"]);
    });
});
