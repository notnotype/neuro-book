/**
 * 自己的资料、改资料与补交同意（`me.ts`；`site.accounts` 输出 8、10，同意门槛的放行表）。
 *
 * 合同测试覆盖“建管理员、登录、补交同意、改资料”的主路径；这里补字段的各种取值（邮箱待补、没有密码、条款版本过期、不同意境外存放、
 * 改资料的每个字段与拒收），以及补交同意与改资料的写事务复核会话（中间件读会话与写事务之间会话被结束，经队列的先后插入）。
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
        const nowMs = identity.clock.now();
        const end = identity.conn.write((tx) => endSession(tx, sessionId, nowMs));
        await waitUntil("结束会话的写排在它后面", () => timers.pending === 2);
        finish.resolve();
        await holder;

        expect(await end).toBe(1);
        expect(await outcome(await request)).toEqual({status: 401, body: {error: {code: "unauthenticated"}}});
        const count = await identity.conn.read((tx) => tx.query<{n: number}, [number]>(`SELECT COUNT(*) AS n FROM identity_consent WHERE user_id = ?`).get(userId)!.n);
        expect(count).toBe(0);
    });
});

function patchMe(target: TestIdentity, cookie: string, body: unknown): Promise<Response> {
    return target.fetch("/me", {method: "PATCH", headers: {origin: TEST_SITE_URL, "content-type": "application/json", cookie}, body: JSON.stringify(body)});
}

describe("PATCH me（输出 8）", () => {
    it("每个字段单独改：回更新后的资料，GET me 读到同样的；邮箱转小写", async () => {
        identity = await createTestIdentity("identity-me-patch-fields");
        const userId = await identity.addUser("alice", {consent: CONSENTED});
        const {cookie} = await identity.issue(userId);
        const cases = [
            [{displayName: "爱丽丝 🌸"}, {displayName: "爱丽丝 🌸"}],
            [{avatarUrl: "https://cdn.example/alice.png"}, {avatarUrl: "https://cdn.example/alice.png"}],
            [{website: "http://alice.example/blog"}, {website: "http://alice.example/blog"}],
            [{bio: "写长篇的人"}, {bio: "写长篇的人"}],
            [{email: "Alice.New@Example.COM"}, {email: "alice.new@example.com"}],
        ] as const;
        for (const [body, expected] of cases) {
            const response = await patchMe(identity, cookie, body);
            const answer = await response.json();
            expect({body, status: response.status, shape: Value.Check(MeResponse, answer)}).toEqual({body, status: 200, shape: true});
            expect(answer).toMatchObject(expected);
            expect(await (await getMe(identity, cookie)).json()).toEqual(answer);
        }
        expect(await (await getMe(identity, cookie)).json()).toMatchObject({
            username: "alice",
            displayName: "爱丽丝 🌸",
            avatarUrl: "https://cdn.example/alice.png",
            website: "http://alice.example/blog",
            bio: "写长篇的人",
            email: "alice.new@example.com",
        });
    });

    it("头像、网站、签名给 null 清空；签名可以是空串", async () => {
        identity = await createTestIdentity("identity-me-patch-clear");
        const userId = await identity.addUser("alice", {consent: CONSENTED});
        const {cookie} = await identity.issue(userId);
        await patchMe(identity, cookie, {avatarUrl: "https://cdn.example/a.png", website: "https://alice.example", bio: "hello"});
        expect(await (await patchMe(identity, cookie, {avatarUrl: null, website: null, bio: null})).json()).toMatchObject({avatarUrl: null, website: null, bio: null});
        expect(await (await patchMe(identity, cookie, {bio: ""})).json()).toMatchObject({bio: ""});
    });

    it("长度按码点数：显示名 50 个、签名 200 个表情符号照收，再多一个是 validation_failed", async () => {
        identity = await createTestIdentity("identity-me-patch-length");
        const userId = await identity.addUser("alice", {consent: CONSENTED});
        const {cookie} = await identity.issue(userId);
        expect((await patchMe(identity, cookie, {displayName: "🌸".repeat(50), bio: "🌸".repeat(200)})).status).toBe(200);
        expect(await outcome(await patchMe(identity, cookie, {displayName: "🌸".repeat(51)}))).toEqual({status: 400, body: {error: {code: "validation_failed", fields: ["displayName"]}}});
        expect(await outcome(await patchMe(identity, cookie, {bio: "🌸".repeat(201)}))).toEqual({status: 400, body: {error: {code: "validation_failed", fields: ["bio"]}}});
    });

    it("空对象、多余的键（含用户名）、不合规则的地址与邮箱：validation_failed，什么都不改", async () => {
        identity = await createTestIdentity("identity-me-patch-invalid");
        const userId = await identity.addUser("alice", {consent: CONSENTED});
        const {cookie} = await identity.issue(userId);
        const before = await (await getMe(identity, cookie)).json();
        const cases: readonly (readonly [body: unknown, fields: readonly string[]])[] = [
            [{}, []],
            [{username: "mallory"}, ["username"]],
            [{displayName: "Alice", role: "admin"}, ["role"]],
            [{avatarUrl: "javascript:alert(1)"}, ["avatarUrl"]],
            // 协议开头对、解析不出来：schema 过了，`isWebUrl` 拒收。
            [{website: "https://"}, ["website"]],
            [{displayName: "Alice", avatarUrl: "https://"}, ["avatarUrl"]],
            // 解析时会被删掉或编码的字符：空白、控制字符、双向控制符（字段规则）。
            [{avatarUrl: "https://cdn.example/\n<b>x</b>"}, ["avatarUrl"]],
            [{avatarUrl: "https://cdn.example/a.png\u0000"}, ["avatarUrl"]],
            [{website: "https://\tgoogle.com@evil.example"}, ["website"]],
            [{website: "https://alice.example/\u202Eexe.gpj"}, ["website"]],
            [{website: "https://alice.example/\u0085"}, ["website"]],
            [{avatarUrl: "https://cdn.example/a png", website: "https://alice.example/\u2066"}, ["avatarUrl", "website"]],
            // \u5f00\u5934\u6ca1\u6709\u5b57\u9762\u7684 `//`\uff1a\u65e0\u57fa\u51c6\u4e0e\u6309\u9875\u9762\u7684\u57fa\u51c6\u89e3\u6790\u51fa\u7684\u5730\u5740\u4e0d\u540c\uff08\u5b57\u6bb5\u89c4\u5219\uff1a\u4ee5 http:// \u6216 https:// \u5f00\u5934\u3001\u5e26\u4e3b\u673a\uff09\u3002
            [{website: "https:example.org"}, ["website"]],
            [{avatarUrl: "HTTPS:/cdn.example/a.png"}, ["avatarUrl"]],
            [{website: "http:\\\\evil.example"}, ["website"]],
            [{avatarUrl: "http://"}, ["avatarUrl"]],
            [{email: "alice@placeholder.invalid"}, ["email"]],
            [{email: "not an email"}, ["email"]],
            [{displayName: ""}, ["displayName"]],
        ];
        for (const [body, fields] of cases) {
            expect({request: body, ...(await outcome(await patchMe(identity, cookie, body)))}).toEqual({request: body, status: 400, body: {error: {code: "validation_failed", fields}}});
        }
        expect(await (await getMe(identity, cookie)).json()).toEqual(before);
    });

    it("文字里有孤立的代理项（JSON 转义写出的）：validation_failed，fields 是那个顶层键，什么都不改；合法的代理对与 U+FFFD 照收", async () => {
        identity = await createTestIdentity("identity-me-patch-lone-surrogate");
        const userId = await identity.addUser("alice", {consent: CONSENTED});
        const {cookie} = await identity.issue(userId);
        const before = await (await getMe(identity, cookie)).json();
        // `JSON.stringify` 把孤立代理项写成 `\ud800` 这样的转义：请求体的字节是合法的 UTF-8，解析出的字符串却不良构。
        const rejected: readonly (readonly [name: string, body: unknown, fields: readonly string[]])[] = [
            ["高代理项", {displayName: "\ud800"}, ["displayName"]],
            ["低代理项", {bio: "\udc00"}, ["bio"]],
            ["夹在文字中间", {displayName: "a\ud800b"}, ["displayName"]],
            ["顺序反了的一对", {displayName: "\udc00\ud800"}, ["displayName"]],
            ["两个字段各一个，按出现的先后", {bio: "\udfff", displayName: "\ud83c"}, ["bio", "displayName"]],
            ["只有一个字段不良构，别的合规则也不改", {displayName: "Alice", bio: "\ud800"}, ["bio"]],
            ["嵌套的值", {displayName: ["\ud800"]}, ["displayName"]],
            ["嵌套的键名", {bio: {"\ud800": 1}}, ["bio"]],
            ["顶层键名本身不良构时不列它", {"\ud800": "x"}, []],
        ];
        for (const [name, body, fields] of rejected) {
            expect({name, ...(await outcome(await patchMe(identity, cookie, body)))}).toEqual({name, status: 400, body: {error: {code: "validation_failed", fields}}});
        }
        expect(await (await getMe(identity, cookie)).json()).toEqual(before);
        for (const displayName of ["🌸", "🌸", "�", "a�b"]) {
            const response = await patchMe(identity, cookie, {displayName});
            expect({displayName, status: response.status, stored: ((await response.json()) as {displayName: string}).displayName}).toEqual({displayName, status: 200, stored: displayName});
            expect(((await (await getMe(identity, cookie)).json()) as {displayName: string}).displayName).toBe(displayName);
        }
    });

    it("邮箱改成别人的（大小写不同也算）：email_taken，什么都不改；改成自己现在的邮箱照样成功", async () => {
        identity = await createTestIdentity("identity-me-patch-email-taken");
        const userId = await identity.addUser("alice", {consent: CONSENTED});
        await identity.addUser("bob");
        const {cookie} = await identity.issue(userId);
        expect(await outcome(await patchMe(identity, cookie, {displayName: "Changed", email: "BOB@example.com"}))).toEqual({status: 409, body: {error: {code: "email_taken"}}});
        expect(await (await getMe(identity, cookie)).json()).toMatchObject({displayName: "alice", email: "alice@example.com"});
        const same = await patchMe(identity, cookie, {email: "ALICE@example.com"});
        expect({status: same.status, email: ((await same.json()) as {email: string}).email}).toEqual({status: 200, email: "alice@example.com"});
    });

    it("邮箱待补的账号补上邮箱：邮箱待补清掉，之后能用这个邮箱登录", async () => {
        identity = await createTestIdentity("identity-me-patch-email-pending");
        const userId = await identity.addUser("pending", {consent: CONSENTED, password: "correct horse battery"});
        await identity.conn.write((tx) => {
            tx.query(`UPDATE "user" SET "email" = 'pending.pending@placeholder.invalid' WHERE "id" = ?`).run(userId);
            tx.query(`INSERT INTO identity_profile (user_id, email_pending) VALUES (?, 1)`).run(userId);
        });
        const login = (identifier: string) =>
            identity!.fetch("/login", {method: "POST", headers: {origin: TEST_SITE_URL, "content-type": "application/json"}, body: JSON.stringify({identifier, password: "correct horse battery"})});
        expect((await login("pending@example.org")).status).toBe(401);
        const {cookie} = await identity.issue(userId);
        expect(await (await patchMe(identity, cookie, {email: "pending@example.org"})).json()).toMatchObject({email: "pending@example.org", emailPending: false});
        expect((await login("pending@example.org")).status).toBe(200);
    });

    it("补充资料那一行还没有的账号（命令行建的）也能改网站与签名", async () => {
        identity = await createTestIdentity("identity-me-patch-no-profile");
        const userId = await identity.addUser("alice", {consent: CONSENTED});
        const {cookie} = await identity.issue(userId);
        expect(await (await patchMe(identity, cookie, {website: "https://alice.example", bio: "hi"})).json()).toMatchObject({website: "https://alice.example", bio: "hi"});
    });

    it("在同意门槛之内：缺同意时 consent_required，不改", async () => {
        identity = await createTestIdentity("identity-me-patch-consent");
        const userId = await identity.addUser("alice", {consent: {termsVersion: "2020-01-01", overseasStorage: true}});
        const {cookie} = await identity.issue(userId);
        expect(await outcome(await patchMe(identity, cookie, {displayName: "Changed"}))).toEqual({status: 403, body: {error: {code: "consent_required"}}});
        expect(await (await getMe(identity, cookie)).json()).toMatchObject({displayName: "alice"});
    });

    it("中间件读过会话之后、写事务之前会话被结束：unauthenticated，不改", async () => {
        // 手动计时器只用来数排队等锁的个数，不拨它。
        const timers = new ManualTimers();
        identity = await createTestIdentity("identity-me-patch-session-ended", {timers});
        const userId = await identity.addUser("alice", {consent: CONSENTED});
        const {cookie, sessionId} = await identity.issue(userId);
        const {adapter} = await identity.assembly.auth.$context;

        // 与补交同意的那条一样排队：中间件读会话排第一，结束会话的写排第二，改资料的写在中间件之后才发起、排在最后。
        const started = Promise.withResolvers<void>();
        const finish = Promise.withResolvers<void>();
        const holder = identity.conn.withLibTransaction(adapter, async () => {
            started.resolve();
            await finish.promise;
        });
        await started.promise;
        const request = patchMe(identity, cookie, {displayName: "Changed"});
        await waitUntil("中间件读会话在排队", () => timers.pending === 1);
        const nowMs = identity.clock.now();
        const end = identity.conn.write((tx) => endSession(tx, sessionId, nowMs));
        await waitUntil("结束会话的写排在它后面", () => timers.pending === 2);
        finish.resolve();
        await holder;

        expect(await end).toBe(1);
        expect(await outcome(await request)).toEqual({status: 401, body: {error: {code: "unauthenticated"}}});
        expect(await identity.conn.read((tx) => tx.query<{name: string}, [number]>(`SELECT "name" FROM "user" WHERE "id" = ?`).get(userId))).toEqual({name: "alice"});
    });
});
