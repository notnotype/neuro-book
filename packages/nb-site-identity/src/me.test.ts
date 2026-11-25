/**
 * 自己的资料与补交同意（`me.ts`；`site.accounts` 输出 8、10，同意门槛的放行表）。
 *
 * 合同测试覆盖“建管理员、登录、补交同意”的主路径；这里补字段的各种取值（邮箱待补、没有密码、条款版本过期、不同意境外存放）与
 * 补交同意的写事务复核会话（中间件读会话与写事务之间会话被结束，经队列的先后插入）。
 */

import {afterEach, describe, expect, it} from "bun:test";
import {Value} from "typebox/value";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import {MeResponse} from "@notnotype/nb-site-identity-contract";

import {endSession} from "./session";
import {ManualTimers, TEST_SITE_URL} from "./testing/library";
import {createTestIdentity, TEST_TERMS_VERSION, type TestIdentity} from "./testing/module";

let identity: TestIdentity | undefined;

afterEach(async () => {
    await identity?.root.cleanup();
    identity = undefined;
});

const CONSENTED = {termsVersion: TEST_TERMS_VERSION, overseasStorage: true} as const;

function getMe(target: TestIdentity, cookie: string): Promise<Response> {
    return target.fetch("/me", {headers: {cookie}});
}

function consent(target: TestIdentity, cookie: string, body: unknown): Promise<Response> {
    return target.fetch("/me/consent", {method: "POST", headers: {origin: TEST_SITE_URL, "content-type": "application/json", cookie}, body: JSON.stringify(body)});
}

async function outcome(response: Response): Promise<{readonly status: number; readonly body: unknown}> {
    return {status: response.status, body: await response.json()};
}

describe("GET me（输出 8）", () => {
    it("回公开资料加邮箱、有没有密码、是否缺同意", async () => {
        identity = await createTestIdentity("identity-me-full");
        const userId = await identity.addUser("alice", {consent: CONSENTED, password: "correct horse battery", role: "admin"});
        await identity.conn.write((tx) => tx.query(`INSERT INTO identity_profile (user_id, website, bio) VALUES (?, 'https://alice.example', 'hello')`).run(userId));
        const {cookie} = await identity.issue(userId);
        const response = await getMe(identity, cookie);
        const body = await response.json();
        expect(Value.Check(MeResponse, body)).toBe(true);
        expect({status: response.status, body}).toEqual({
            status: 200,
            body: {
                id: userId,
                username: "alice",
                displayName: "alice",
                avatarUrl: null,
                website: "https://alice.example",
                bio: "hello",
                role: "admin",
                createdAt: new Date(identity.clock.now()).toISOString(),
                email: "alice@example.com",
                emailPending: false,
                hasPassword: true,
                consentRequired: false,
            },
        });
    });

    it("邮箱待补时不给占位邮箱；没有密码时 hasPassword 为 false", async () => {
        identity = await createTestIdentity("identity-me-pending");
        const userId = await identity.addUser("bob", {consent: CONSENTED});
        await identity.conn.write((tx) => tx.query(`INSERT INTO identity_profile (user_id, email_pending) VALUES (?, 1)`).run(userId));
        const {cookie} = await identity.issue(userId);
        expect(await (await getMe(identity, cookie)).json()).toMatchObject({email: null, emailPending: true, hasPassword: false, consentRequired: false});
    });

    it("缺同意的人也能读（放行表），consentRequired 为 true：没有记录、条款版本旧、不同意境外存放三种", async () => {
        identity = await createTestIdentity("identity-me-consent-required");
        const cases = [
            ["没有记录", undefined],
            ["条款版本旧", {termsVersion: "2020-01-01", overseasStorage: true}],
            ["不同意境外存放", {termsVersion: TEST_TERMS_VERSION, overseasStorage: false}],
        ] as const;
        for (const [index, [name, given]] of cases.entries()) {
            const userId = await identity.addUser(`user${String(index)}`, given === undefined ? {} : {consent: given});
            const {cookie} = await identity.issue(userId);
            const response = await getMe(identity, cookie);
            expect({name, status: response.status, consentRequired: ((await response.json()) as {consentRequired: boolean}).consentRequired}).toEqual({name, status: 200, consentRequired: true});
        }
    });

    it("没登录回 unauthenticated", async () => {
        identity = await createTestIdentity("identity-me-anonymous");
        expect(await outcome(await getMe(identity, ""))).toEqual({status: 401, body: {error: {code: "unauthenticated"}}});
    });
});

describe("POST me/consent（输出 10）", () => {
    it("交当前版本并同意境外存放：回更新后的资料，之后过得了同意门槛；旧的同意记录留着", async () => {
        identity = await createTestIdentity("identity-me-consent");
        const userId = await identity.addUser("alice", {consent: {termsVersion: "2020-01-01", overseasStorage: true}, password: "correct horse battery"});
        const {cookie} = await identity.issue(userId);
        const blocked = await identity.fetch("/me/password", {method: "POST", headers: {origin: TEST_SITE_URL, "content-type": "application/json", cookie}, body: JSON.stringify({currentPassword: "correct horse battery", newPassword: "a brand new passphrase"})});
        expect(await outcome(blocked)).toEqual({status: 403, body: {error: {code: "consent_required"}}});

        const response = await consent(identity, cookie, CONSENTED);
        const body = await response.json();
        expect({status: response.status, shape: Value.Check(MeResponse, body)}).toEqual({status: 200, shape: true});
        expect(body).toMatchObject({id: userId, consentRequired: false});

        const allowed = await identity.fetch("/me/password", {method: "POST", headers: {origin: TEST_SITE_URL, "content-type": "application/json", cookie}, body: JSON.stringify({currentPassword: "correct horse battery", newPassword: "a brand new passphrase"})});
        expect(allowed.status).toBe(200);
        const rows = await identity.conn.read((tx) => tx.query<{terms_version: string; overseas_storage: number}, [number]>(`SELECT terms_version, overseas_storage FROM identity_consent WHERE user_id = ? ORDER BY id`).all(userId));
        expect(rows).toEqual([
            {terms_version: "2020-01-01", overseas_storage: 1},
            {terms_version: TEST_TERMS_VERSION, overseas_storage: 1},
        ]);
    });

    it("版本不是当前的、或不同意境外存放：consent_required，不写记录；字段缺了是 validation_failed", async () => {
        identity = await createTestIdentity("identity-me-consent-rejected");
        const userId = await identity.addUser("alice");
        const {cookie} = await identity.issue(userId);
        expect(await outcome(await consent(identity, cookie, {termsVersion: "2020-01-01", overseasStorage: true}))).toEqual({status: 403, body: {error: {code: "consent_required"}}});
        expect(await outcome(await consent(identity, cookie, {termsVersion: TEST_TERMS_VERSION, overseasStorage: false}))).toEqual({status: 403, body: {error: {code: "consent_required"}}});
        expect(await outcome(await consent(identity, cookie, {termsVersion: TEST_TERMS_VERSION}))).toEqual({status: 400, body: {error: {code: "validation_failed", fields: ["overseasStorage"]}}});
        const count = await identity.conn.read((tx) => tx.query<{n: number}, [number]>(`SELECT COUNT(*) AS n FROM identity_consent WHERE user_id = ?`).get(userId)!.n);
        expect(count).toBe(0);
    });

    it("中间件读过会话之后、写事务之前会话被结束：unauthenticated，不写记录", async () => {
        // 手动计时器只用来数排队等锁的个数，不拨它。
        const timers = new ManualTimers();
        identity = await createTestIdentity("identity-me-consent-session-ended", {timers});
        const userId = await identity.addUser("alice");
        const {cookie, sessionId} = await identity.issue(userId);
        const {adapter} = await identity.assembly.auth.$context;

        // 先让一个库的事务占住队列：中间件读会话排第一，结束会话的写排第二；补交同意的写在中间件之后才发起，排在结束会话之后。
        const started = Promise.withResolvers<void>();
        const finish = Promise.withResolvers<void>();
        const holder = identity.conn.withLibTransaction(adapter, async () => {
            started.resolve();
            await finish.promise;
        });
        await started.promise;
        const request = consent(identity, cookie, CONSENTED);
        await waitUntil("中间件读会话在排队", () => timers.pending === 1);
        const end = identity.conn.write((tx) => endSession(tx, sessionId));
        await waitUntil("结束会话的写排在它后面", () => timers.pending === 2);
        finish.resolve();
        await holder;

        expect(await end).toBe(1);
        expect(await outcome(await request)).toEqual({status: 401, body: {error: {code: "unauthenticated"}}});
        const count = await identity.conn.read((tx) => tx.query<{n: number}, [number]>(`SELECT COUNT(*) AS n FROM identity_consent WHERE user_id = ?`).get(userId)!.n);
        expect(count).toBe(0);
    });
});
