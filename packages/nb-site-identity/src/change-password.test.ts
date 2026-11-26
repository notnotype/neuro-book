/**
 * 改密码与设密码（`change-password.ts`；`site.accounts` 输出 6、9、19、20，时序一节“改密码或重置密码与登录并发”）。
 *
 * 合同测试覆盖主路径（别的会话失效、当前会话保留、旧密码错、限流）；这里补合同测不到的：没有密码的账号（本 Task 的合同里造不出）、
 * 两步之间会话被结束或密码被别处改了（经校验与算哈希的包装插入，包装都调真的函数）。
 */

import {afterEach, describe, expect, it} from "bun:test";

import {insertCredentialRow} from "./db/library-rows";
import {hashPassword, REAL_PASSWORD_FUNCTIONS, type PasswordFunctions} from "./password";
import {endSession} from "./session";
import {TEST_SITE_URL} from "./testing/library";
import {createTestIdentity, sessionCookieOf, TEST_TERMS_VERSION, type TestIdentity} from "./testing/module";

let identity: TestIdentity | undefined;

afterEach(async () => {
    await identity?.root.cleanup();
    identity = undefined;
});

const CONSENTED = {termsVersion: TEST_TERMS_VERSION, overseasStorage: true} as const;
const PASSWORD = "correct horse battery";
const NEW_PASSWORD = "a brand new passphrase";

function changePassword(target: TestIdentity, cookie: string, body: unknown): Promise<Response> {
    return target.fetch("/me/password", {method: "POST", headers: {origin: TEST_SITE_URL, "content-type": "application/json", cookie}, body: JSON.stringify(body)});
}

function login(target: TestIdentity, identifier: string, password: string): Promise<Response> {
    return target.fetch("/login", {method: "POST", headers: {origin: TEST_SITE_URL, "content-type": "application/json"}, body: JSON.stringify({identifier, password})});
}

async function outcome(response: Response): Promise<{readonly status: number; readonly body: unknown}> {
    return {status: response.status, body: await response.json()};
}

async function whoamiState(target: TestIdentity, cookie: string): Promise<string> {
    return ((await (await target.fetch("/whoami", {headers: {cookie}})).json()) as {state: string}).state;
}

const invalidCredentials = {status: 401, body: {error: {code: "invalid_credentials"}}};

describe("有密码的账号（输出 6）", () => {
    it("旧密码对：换成新密码，结束其它会话、保留当前会话；旧密码不再能登录", async () => {
        identity = await createTestIdentity("identity-change-password-ok");
        const userId = await identity.addUser("alice", {consent: CONSENTED, password: PASSWORD});
        const current = await identity.issue(userId);
        const other = await identity.issue(userId);
        expect(await outcome(await changePassword(identity, current.cookie, {currentPassword: PASSWORD, newPassword: NEW_PASSWORD}))).toEqual({status: 200, body: {}});
        expect(await whoamiState(identity, current.cookie)).toBe("authenticated");
        expect(await whoamiState(identity, other.cookie)).toBe("anonymous");
        expect(await outcome(await login(identity, "alice", PASSWORD))).toEqual(invalidCredentials);
        expect((await login(identity, "alice", NEW_PASSWORD)).status).toBe(200);
    });

    it("旧密码错回 invalid_credentials，什么都不改；没带旧密码是字段不合格；新密码太短也是", async () => {
        identity = await createTestIdentity("identity-change-password-wrong");
        const userId = await identity.addUser("alice", {consent: CONSENTED, password: PASSWORD});
        const current = await identity.issue(userId);
        const other = await identity.issue(userId);
        expect(await outcome(await changePassword(identity, current.cookie, {currentPassword: "wrong password", newPassword: NEW_PASSWORD}))).toEqual(invalidCredentials);
        expect(await outcome(await changePassword(identity, current.cookie, {newPassword: NEW_PASSWORD}))).toEqual({status: 400, body: {error: {code: "validation_failed", fields: ["currentPassword"]}}});
        expect(await outcome(await changePassword(identity, current.cookie, {currentPassword: PASSWORD, newPassword: "short"}))).toEqual({status: 400, body: {error: {code: "validation_failed", fields: ["newPassword"]}}});
        expect(await whoamiState(identity, other.cookie)).toBe("authenticated");
        expect((await login(identity, "alice", PASSWORD)).status).toBe(200);
    });

    it("一小时 5 次：第 6 次 rate_limited 带整数 Retry-After，字段不合格的不计入；过了窗口恢复", async () => {
        identity = await createTestIdentity("identity-change-password-rate", {start: Date.UTC(2026, 10, 25, 10, 0, 0)});
        const userId = await identity.addUser("alice", {consent: CONSENTED, password: PASSWORD});
        const {cookie} = await identity.issue(userId);
        for (let index = 0; index < 3; index += 1) expect((await changePassword(identity, cookie, {newPassword: NEW_PASSWORD})).status).toBe(400);
        for (let index = 0; index < 5; index += 1) expect(await outcome(await changePassword(identity, cookie, {currentPassword: "wrong password", newPassword: NEW_PASSWORD}))).toEqual(invalidCredentials);
        const limited = await changePassword(identity, cookie, {currentPassword: PASSWORD, newPassword: NEW_PASSWORD});
        expect(await outcome(limited)).toEqual({status: 429, body: {error: {code: "rate_limited"}}});
        expect(limited.headers.get("retry-after")).toBe("3600");
        identity.clock.advance(3_600_000);
        expect((await changePassword(identity, cookie, {currentPassword: PASSWORD, newPassword: NEW_PASSWORD})).status).toBe(200);
    });

    it("校验旧密码之后、写入之前密码被别处改了：invalid_credentials，不盖掉别处的改动，其它会话不动", async () => {
        const otherHash = await hashPassword("set by the admin meanwhile");
        let armed = false;
        let userId = 0;
        let target: TestIdentity | undefined;
        const passwords: PasswordFunctions = {
            hash: REAL_PASSWORD_FUNCTIONS.hash,
            verify: async (password, stored, context) => {
                const ok = await REAL_PASSWORD_FUNCTIONS.verify(password, stored, context);
                if (armed) {
                    armed = false;
                    await target!.conn.write((tx) => void tx.query(`UPDATE "account" SET "password" = ? WHERE "userId" = ?`).run(otherHash, userId));
                }
                return ok;
            },
        };
        identity = target = await createTestIdentity("identity-change-password-race", {overrides: {passwords}});
        userId = await identity.addUser("alice", {consent: CONSENTED, password: PASSWORD});
        const current = await identity.issue(userId);
        const other = await identity.issue(userId);
        armed = true;
        expect(await outcome(await changePassword(identity, current.cookie, {currentPassword: PASSWORD, newPassword: NEW_PASSWORD}))).toEqual(invalidCredentials);
        expect(armed).toBe(false);
        const stored = await identity.conn.read((tx) => tx.query<{password: string}, [number]>(`SELECT "password" FROM "account" WHERE "userId" = ?`).get(userId)!.password);
        expect(stored).toBe(otherHash);
        expect(await whoamiState(identity, other.cookie)).toBe("authenticated");
    });

    it("请求进来之后、写入之前当前会话被结束：unauthenticated，密码不改、其它会话不动", async () => {
        let armed = false;
        let sessionId = 0;
        let target: TestIdentity | undefined;
        const passwords: PasswordFunctions = {
            verify: REAL_PASSWORD_FUNCTIONS.verify,
            hash: async (password) => {
                const fresh = await REAL_PASSWORD_FUNCTIONS.hash(password);
                if (armed) {
                    armed = false;
                    await target!.conn.write((tx) => endSession(tx, sessionId, target!.clock.now()));
                }
                return fresh;
            },
        };
        identity = target = await createTestIdentity("identity-change-password-session-ended", {overrides: {passwords}});
        const userId = await identity.addUser("alice", {consent: CONSENTED, password: PASSWORD});
        const current = await identity.issue(userId);
        const other = await identity.issue(userId);
        sessionId = current.sessionId;
        armed = true;
        expect(await outcome(await changePassword(identity, current.cookie, {currentPassword: PASSWORD, newPassword: NEW_PASSWORD}))).toEqual({status: 401, body: {error: {code: "unauthenticated"}}});
        expect(armed).toBe(false);
        expect(await whoamiState(identity, other.cookie)).toBe("authenticated");
        expect((await login(identity, "alice", PASSWORD)).status).toBe(200);
    });
});

describe("没有密码的账号（输出 9）", () => {
    it("直接设密码、不看旧密码；之后能用它登录，再改就要旧密码", async () => {
        identity = await createTestIdentity("identity-change-password-set");
        const userId = await identity.addUser("alice", {consent: CONSENTED});
        const current = await identity.issue(userId);
        const other = await identity.issue(userId);
        expect(await outcome(await changePassword(identity, current.cookie, {currentPassword: "ignored", newPassword: NEW_PASSWORD}))).toEqual({status: 200, body: {}});
        expect(((await (await identity.fetch("/me", {headers: {cookie: current.cookie}})).json()) as {hasPassword: boolean}).hasPassword).toBe(true);
        expect(await whoamiState(identity, other.cookie)).toBe("anonymous");
        const response = await login(identity, "alice", NEW_PASSWORD);
        expect(response.status).toBe(200);
        const cookie = sessionCookieOf(response.headers.getSetCookie());
        expect(await outcome(await changePassword(identity, cookie, {newPassword: "yet another passphrase"}))).toEqual({status: 400, body: {error: {code: "validation_failed", fields: ["currentPassword"]}}});
    });

    it("算哈希期间别处先设了密码：invalid_credentials，留下别处设的那个", async () => {
        const otherHash = await hashPassword("set elsewhere meanwhile");
        let armed = false;
        let userId = 0;
        let target: TestIdentity | undefined;
        const passwords: PasswordFunctions = {
            verify: REAL_PASSWORD_FUNCTIONS.verify,
            hash: async (password) => {
                const fresh = await REAL_PASSWORD_FUNCTIONS.hash(password);
                if (armed) {
                    armed = false;
                    await target!.conn.write((tx) => insertCredentialRow(tx, {userId, passwordHash: otherHash, now: target!.clock.now()}));
                }
                return fresh;
            },
        };
        identity = target = await createTestIdentity("identity-change-password-set-race", {overrides: {passwords}});
        userId = await identity.addUser("alice", {consent: CONSENTED});
        const {cookie} = await identity.issue(userId);
        armed = true;
        expect(await outcome(await changePassword(identity, cookie, {newPassword: NEW_PASSWORD}))).toEqual(invalidCredentials);
        expect(armed).toBe(false);
        const rows = await identity.conn.read((tx) => tx.query<{password: string}, [number]>(`SELECT "password" FROM "account" WHERE "userId" = ? AND "providerId" = 'credential'`).all(userId));
        expect(rows).toEqual([{password: otherHash}]);
    });
});

describe("哈希过载（输出 20）", () => {
    // 合同测试里要让改密码正好撞上别人占着唯一的哈希名额，只能靠并发碰运气；这里经校验的包装把一个登录停在校验这一步，占着名额。
    it("并发 1、不排队：一个登录在校验时，改密码回 503 overloaded，密码不改、其它会话不动；那个登录照常成功", async () => {
        // 只拦第一次校验（那个登录的）；之后的照常，免得改密码万一拿到了名额也停在这里、用例等到超时才失败。
        let hold: {readonly entered: PromiseWithResolvers<void>; readonly gate: PromiseWithResolvers<void>} | undefined;
        const passwords: PasswordFunctions = {
            hash: REAL_PASSWORD_FUNCTIONS.hash,
            verify: async (password, stored, context) => {
                const current = hold;
                hold = undefined;
                if (current !== undefined) {
                    current.entered.resolve();
                    await current.gate.promise;
                }
                return REAL_PASSWORD_FUNCTIONS.verify(password, stored, context);
            },
        };
        identity = await createTestIdentity("identity-change-password-overloaded", {config: {hashConcurrency: 1, hashQueue: 0}, overrides: {passwords}});
        const aliceId = await identity.addUser("alice", {consent: CONSENTED, password: PASSWORD});
        await identity.addUser("bob", {consent: CONSENTED, password: PASSWORD});
        const current = await identity.issue(aliceId);
        const other = await identity.issue(aliceId);
        const held = {entered: Promise.withResolvers<void>(), gate: Promise.withResolvers<void>()};
        hold = held;
        const bob = login(identity, "bob", PASSWORD);
        await held.entered.promise;

        expect(await outcome(await changePassword(identity, current.cookie, {currentPassword: PASSWORD, newPassword: NEW_PASSWORD}))).toEqual({status: 503, body: {error: {code: "overloaded"}}});
        held.gate.resolve();
        expect((await bob).status).toBe(200);
        expect(await whoamiState(identity, other.cookie)).toBe("authenticated");
        expect((await login(identity, "alice", PASSWORD)).status).toBe(200);
    });
});

describe("门槛", () => {
    it("没登录回 unauthenticated；缺同意回 consent_required", async () => {
        identity = await createTestIdentity("identity-change-password-gate");
        const userId = await identity.addUser("alice", {password: PASSWORD});
        const {cookie} = await identity.issue(userId);
        expect(await outcome(await changePassword(identity, "", {currentPassword: PASSWORD, newPassword: NEW_PASSWORD}))).toEqual({status: 401, body: {error: {code: "unauthenticated"}}});
        expect(await outcome(await changePassword(identity, cookie, {currentPassword: PASSWORD, newPassword: NEW_PASSWORD}))).toEqual({status: 403, body: {error: {code: "consent_required"}}});
        expect((await login(identity, "alice", PASSWORD)).status).toBe(200);
    });
});
