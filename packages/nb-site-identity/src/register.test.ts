/**
 * 注册（`register.ts`；`site.accounts` 输出 1 到 3）。
 *
 * 合同测试（`nb-site-contract-tests` 的 `accounts-register.test.ts`）覆盖经 HTTP 看得到的部分：拒绝码与先后、限流、码停用过期用完、
 * 并发扣码。这里测合同里造不出的（计划第 6 节的“位置”一列）：
 * - 扣码之后建账号失败、发会话失败时码不被扣：要让事务中途失败，合同里造不出；这里在账号表上临时加一个拒绝插入的触发器、或让发会话
 *   抛错。
 * - 预检之后、写事务之前用户名被别人占了：要在两步之间插入动作，经哈希函数的包装（包装调真的哈希）。
 * - 邀请码：停用、过期、用完与没有主人的码经接口造不出，这里用 SQL 直接放进表里。用接口生成的码注册见 `invite-codes.test.ts`。
 * - 哈希过载回 `overloaded`：要一个注册确定地停在算哈希那一步、占着名额，经哈希函数的包装。合同只能同时发一批请求，不能保证它们重叠
 *   （登录的过载用例是这样做的）。
 */

import {afterEach, describe, expect, it} from "bun:test";
import {Value} from "typebox/value";

import {MeResponse, RegisterResponse} from "@notnotype/nb-site-identity-contract";

import {libDate} from "./db/library-rows";
import {REAL_PASSWORD_FUNCTIONS, type PasswordFunctions} from "./password";
import {TEST_SITE_URL} from "./testing/library";
import {createTestIdentity, sessionCookieOf, TEST_CLIENT_ADDRESS_HEADER, TEST_TERMS_VERSION, type TestIdentity} from "./testing/module";

let identity: TestIdentity | undefined;

afterEach(async () => {
    await identity?.root.cleanup();
    identity = undefined;
});

const PASSWORD = "correct horse battery";
const DAY_MS = 86_400_000;

let address = 0;
/** 每次注册换一个来源地址：注册按来源每小时 5 次，这里不测限流。 */
const nextAddress = () => `198.51.100.${String(++address % 250)}`;

function registerBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {username: "Alice", email: "Alice@Example.com", password: PASSWORD, registrationCode: "REG-CODE", termsVersion: TEST_TERMS_VERSION, overseasStorage: true, ...overrides};
}

function register(target: TestIdentity, body: Record<string, unknown>): Promise<Response> {
    return target.fetch("/register", {
        method: "POST",
        headers: {origin: TEST_SITE_URL, "content-type": "application/json", [TEST_CLIENT_ADDRESS_HEADER]: nextAddress()},
        body: JSON.stringify(body),
    });
}

async function outcome(response: Response): Promise<{readonly status: number; readonly body: unknown}> {
    return {status: response.status, body: await response.json()};
}

interface CodeOptions {
    readonly maxUses?: number | null;
    readonly expiresAt?: number;
    readonly disabled?: boolean;
    readonly ownerId?: number;
}

/** 往注册码或邀请码表里放一个码，回 id。 */
function addCode(target: TestIdentity, table: "identity_registration_code" | "identity_invite_code", code: string, options: CodeOptions = {}): Promise<number> {
    const now = libDate(target.clock.now());
    const expiresAt = options.expiresAt === undefined ? null : libDate(options.expiresAt);
    const disabledAt = options.disabled === true ? now : null;
    const maxUses = options.maxUses === undefined ? null : options.maxUses;
    return target.conn.write((tx) =>
        table === "identity_registration_code"
            ? Number(tx.query(`INSERT INTO identity_registration_code (code, max_uses, expires_at, disabled_at, created_at) VALUES (?, ?, ?, ?, ?)`).run(code, maxUses, expiresAt, disabledAt, now).lastInsertRowid)
            : Number(
                  tx.query(`INSERT INTO identity_invite_code (code, owner_id, max_uses, expires_at, disabled_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(code, options.ownerId ?? null, maxUses, expiresAt, disabledAt, now).lastInsertRowid,
              ),
    );
}

function usedCount(target: TestIdentity, table: "identity_registration_code" | "identity_invite_code", id: number): Promise<number> {
    return target.conn.read((tx) => tx.query<{used_count: number}, [number]>(`SELECT used_count FROM ${table} WHERE id = ?`).get(id)!.used_count);
}

function userCount(target: TestIdentity): Promise<number> {
    return target.conn.read((tx) => tx.query<{n: number}, []>(`SELECT COUNT(*) AS n FROM "user"`).get()!.n);
}

describe("注册成功（输出 1）", () => {
    it("回公开资料与会话 Cookie，随即 me 可用；用户名与邮箱转小写、显示名省略时取原样的用户名；记下注册码、同意，码用了 1 次", async () => {
        identity = await createTestIdentity("identity-register-ok");
        const codeId = await addCode(identity, "identity_registration_code", "REG-CODE", {maxUses: 3});
        const response = await register(identity, registerBody());
        const body = await response.json();
        expect(response.status).toBe(200);
        expect(Value.Check(RegisterResponse, body)).toBe(true);
        const user = (body as RegisterResponse).user;
        expect(user).toEqual({
            id: user.id,
            username: "alice",
            displayName: "Alice",
            avatarUrl: null,
            website: null,
            bio: null,
            role: "user",
            createdAt: libDate(identity.clock.now()),
        });

        const cookie = sessionCookieOf(response.headers.getSetCookie());
        const me = await identity.fetch("/me", {headers: {cookie}});
        const meBody = await me.json();
        expect(Value.Check(MeResponse, meBody)).toBe(true);
        expect(meBody).toMatchObject({id: user.id, email: "alice@example.com", emailPending: false, hasPassword: true, consentRequired: false});

        expect(await usedCount(identity, "identity_registration_code", codeId)).toBe(1);
        const recorded = await identity.conn.read((tx) => ({
            profile: tx.query(`SELECT registration_code_id, invite_code_id, inviter_id FROM identity_profile WHERE user_id = ?`).get(user.id),
            consent: tx.query(`SELECT terms_version, overseas_storage FROM identity_consent WHERE user_id = ?`).all(user.id),
        }));
        expect(recorded).toEqual({profile: {registration_code_id: codeId, invite_code_id: null, inviter_id: null}, consent: [{terms_version: TEST_TERMS_VERSION, overseas_storage: 1}]});
        // 合同测试里同一个人拿新密码登录，这里只确认存的是新格式的哈希、能登录。
        const login = await identity.fetch("/login", {
            method: "POST",
            headers: {origin: TEST_SITE_URL, "content-type": "application/json", [TEST_CLIENT_ADDRESS_HEADER]: nextAddress()},
            body: JSON.stringify({identifier: "ALICE@example.com", password: PASSWORD}),
        });
        expect(login.status).toBe(200);
    });

    it("码按去掉首尾空白后的原文比对，不转大小写", async () => {
        identity = await createTestIdentity("identity-register-code-compare");
        await addCode(identity, "identity_registration_code", "Mixed-Case");
        expect(await outcome(await register(identity, registerBody({username: "lower", email: "lower@example.com", registrationCode: "mixed-case"})))).toEqual({
            status: 422,
            body: {error: {code: "registration_code_invalid"}},
        });
        expect((await register(identity, registerBody({username: "padded", email: "padded@example.com", registrationCode: " \tMixed-Case\n"}))).status).toBe(200);
    });
});

describe("注册的原子性（输出 2）", () => {
    it("扣码之后建账号失败：整个事务回滚，码没被扣、没有账号；去掉故障后同一个码照常能用", async () => {
        identity = await createTestIdentity("identity-register-user-insert-fails");
        const codeId = await addCode(identity, "identity_registration_code", "REG-CODE", {maxUses: 1});
        // 触发器在扣码那条 UPDATE 之后、插入账号时拒绝：这是“扣了码、账号没建成”的中途失败。
        await identity.conn.write((tx) => tx.query(`CREATE TRIGGER reject_user BEFORE INSERT ON "user" BEGIN SELECT RAISE(ABORT, 'rejected by test'); END`).run());
        expect(await outcome(await register(identity, registerBody()))).toEqual({status: 500, body: {error: {code: "internal"}}});
        expect({used: await usedCount(identity, "identity_registration_code", codeId), users: await userCount(identity)}).toEqual({used: 0, users: 0});

        await identity.conn.write((tx) => tx.query(`DROP TRIGGER reject_user`).run());
        expect((await register(identity, registerBody())).status).toBe(200);
        expect(await usedCount(identity, "identity_registration_code", codeId)).toBe(1);
    });

    it("发会话失败：账号、同意记录与扣码一起回滚", async () => {
        let fail = true;
        identity = await createTestIdentity("identity-register-issue-fails", {
            overrides: {
                wrapIssueSession: (issue) => async (userId, userAgent) => {
                    const issued = await issue(userId, userAgent);
                    if (fail) throw new Error("issue failed by test");
                    return issued;
                },
            },
        });
        const codeId = await addCode(identity, "identity_registration_code", "REG-CODE", {maxUses: 1});
        expect(await outcome(await register(identity, registerBody()))).toEqual({status: 500, body: {error: {code: "internal"}}});
        const left = await identity.conn.read((tx) => ({
            users: tx.query<{n: number}, []>(`SELECT COUNT(*) AS n FROM "user"`).get()!.n,
            sessions: tx.query<{n: number}, []>(`SELECT COUNT(*) AS n FROM "session"`).get()!.n,
            consents: tx.query<{n: number}, []>(`SELECT COUNT(*) AS n FROM identity_consent`).get()!.n,
        }));
        expect({...left, used: await usedCount(identity, "identity_registration_code", codeId)}).toEqual({users: 0, sessions: 0, consents: 0, used: 0});
        fail = false;
        expect((await register(identity, registerBody())).status).toBe(200);
    });

    it("预检之后、写事务之前用户名或邮箱被别人占了：回对应的码，码没被扣", async () => {
        const cases = [
            {name: "用户名", username: "alice", email: "someone@example.com", expected: "username_taken"},
            {name: "邮箱（大小写不同）", username: "someone", email: "ALICE@example.com", expected: "email_taken"},
        ] as const;
        for (const testCase of cases) {
            let takeOver: (() => Promise<unknown>) | undefined;
            const passwords: PasswordFunctions = {
                verify: REAL_PASSWORD_FUNCTIONS.verify,
                hash: async (password) => {
                    const hashed = await REAL_PASSWORD_FUNCTIONS.hash(password);
                    const action = takeOver;
                    takeOver = undefined;
                    await action?.();
                    return hashed;
                },
            };
            identity = await createTestIdentity(`identity-register-taken-after-precheck-${testCase.expected}`, {overrides: {passwords}});
            const target = identity;
            const codeId = await addCode(target, "identity_registration_code", "REG-CODE", {maxUses: 1});
            // 算哈希在预检之后、写事务之前（`register.ts` 第 7 步）：在这里建一个账号，就是两步之间别人注册成功。它的用户名是 alice、
            // 邮箱是 alice@example.com，两条用例各撞其中一个。
            takeOver = () => target.addUser("alice");
            const response = await register(target, registerBody({username: testCase.username, email: testCase.email}));
            expect({name: testCase.name, ...(await outcome(response))}).toEqual({name: testCase.name, status: 409, body: {error: {code: testCase.expected}}});
            expect({name: testCase.name, used: await usedCount(target, "identity_registration_code", codeId), users: await userCount(target)}).toEqual({name: testCase.name, used: 0, users: 1});
            await target.root.cleanup();
            identity = undefined;
        }
    });
});

describe("哈希过载（site.accounts 输出 20）", () => {
    it("并发 1、不排队：一个注册在算哈希时，另一个回 503 overloaded，没有建账号、码没被扣；前一个照常成功", async () => {
        // 包一层真的哈希：放行之前停在算哈希这一步、占着唯一的名额。装配时也要算一次哈希（假校验用的那条），所以建好之后才拦。
        let hold: {readonly entered: PromiseWithResolvers<void>; readonly gate: PromiseWithResolvers<void>} | undefined;
        const passwords: PasswordFunctions = {
            verify: REAL_PASSWORD_FUNCTIONS.verify,
            hash: async (password) => {
                const current = hold;
                hold = undefined;
                if (current !== undefined) {
                    current.entered.resolve();
                    await current.gate.promise;
                }
                return REAL_PASSWORD_FUNCTIONS.hash(password);
            },
        };
        identity = await createTestIdentity("identity-register-overloaded", {config: {hashConcurrency: 1, hashQueue: 0}, overrides: {passwords}});
        const codeId = await addCode(identity, "identity_registration_code", "REG-CODE", {maxUses: 2});
        const held = {entered: Promise.withResolvers<void>(), gate: Promise.withResolvers<void>()};
        hold = held;
        const first = register(identity, registerBody());
        await held.entered.promise;

        expect(await outcome(await register(identity, registerBody({username: "bob", email: "bob@example.com"})))).toEqual({status: 503, body: {error: {code: "overloaded"}}});
        expect({used: await usedCount(identity, "identity_registration_code", codeId), users: await userCount(identity)}).toEqual({used: 0, users: 0});

        held.gate.resolve();
        expect((await first).status).toBe(200);
        expect({used: await usedCount(identity, "identity_registration_code", codeId), users: await userCount(identity)}).toEqual({used: 1, users: 1});
    });
});

describe("邀请码（输出 1 的邀请归属、输出 3）", () => {
    it("带可用的邀请码注册：邀请码用了 1 次，补充资料里记下邀请码与邀请人", async () => {
        identity = await createTestIdentity("identity-register-invite");
        const inviter = await identity.addUser("inviter");
        await addCode(identity, "identity_registration_code", "REG-CODE");
        const inviteId = await addCode(identity, "identity_invite_code", "INVITE-1", {ownerId: inviter});
        const response = await register(identity, registerBody({inviteCode: "  INVITE-1 "}));
        expect(response.status).toBe(200);
        const userId = ((await response.json()) as RegisterResponse).user.id;
        expect(await usedCount(identity, "identity_invite_code", inviteId)).toBe(1);
        expect(await identity.conn.read((tx) => tx.query(`SELECT invite_code_id, inviter_id FROM identity_profile WHERE user_id = ?`).get(userId))).toEqual({invite_code_id: inviteId, inviter_id: inviter});
    });

    it("邀请码是空串（前端输入框留空）时按没给处理", async () => {
        identity = await createTestIdentity("identity-register-invite-empty");
        await addCode(identity, "identity_registration_code", "REG-CODE");
        const response = await register(identity, registerBody({inviteCode: "  "}));
        expect(response.status).toBe(200);
        const userId = ((await response.json()) as RegisterResponse).user.id;
        expect(await identity.conn.read((tx) => tx.query(`SELECT invite_code_id, inviter_id FROM identity_profile WHERE user_id = ?`).get(userId))).toEqual({invite_code_id: null, inviter_id: null});
    });

    it("邀请码不存在、停用、过期、用完：invite_code_invalid，注册码与邀请码都没被扣、没有账号", async () => {
        identity = await createTestIdentity("identity-register-invite-invalid");
        const now = identity.clock.now();
        const registrationId = await addCode(identity, "identity_registration_code", "REG-CODE");
        const ids = {
            disabled: await addCode(identity, "identity_invite_code", "DISABLED", {disabled: true}),
            expired: await addCode(identity, "identity_invite_code", "EXPIRED", {expiresAt: now}),
            exhausted: await addCode(identity, "identity_invite_code", "EXHAUSTED", {maxUses: 1}),
        };
        await identity.conn.write((tx) => tx.query(`UPDATE identity_invite_code SET used_count = 1 WHERE id = ?`).run(ids.exhausted));
        for (const inviteCode of ["MISSING", "DISABLED", "EXPIRED", "EXHAUSTED"]) {
            expect({inviteCode, ...(await outcome(await register(identity, registerBody({inviteCode}))))}).toEqual({inviteCode, status: 422, body: {error: {code: "invite_code_invalid"}}});
        }
        expect({
            registration: await usedCount(identity, "identity_registration_code", registrationId),
            exhausted: await usedCount(identity, "identity_invite_code", ids.exhausted),
            users: await userCount(identity),
        }).toEqual({registration: 0, exhausted: 1, users: 0});
    });

    it("邀请码在预检之后被用完：写事务的条件扣减影响 0 行，回 invite_code_invalid，注册码没被扣", async () => {
        let useUp: (() => Promise<unknown>) | undefined;
        const passwords: PasswordFunctions = {
            verify: REAL_PASSWORD_FUNCTIONS.verify,
            hash: async (password) => {
                const hashed = await REAL_PASSWORD_FUNCTIONS.hash(password);
                await useUp?.();
                return hashed;
            },
        };
        identity = await createTestIdentity("identity-register-invite-used-up", {overrides: {passwords}});
        const target = identity;
        const registrationId = await addCode(target, "identity_registration_code", "REG-CODE");
        const inviteId = await addCode(target, "identity_invite_code", "LAST-ONE", {maxUses: 1});
        useUp = () => target.conn.write((tx) => tx.query(`UPDATE identity_invite_code SET used_count = 1 WHERE id = ?`).run(inviteId));
        expect(await outcome(await register(target, registerBody({inviteCode: "LAST-ONE"})))).toEqual({status: 422, body: {error: {code: "invite_code_invalid"}}});
        expect({registration: await usedCount(target, "identity_registration_code", registrationId), users: await userCount(target)}).toEqual({registration: 0, users: 0});
    });
});

describe("注册码在预检之后失效", () => {
    it("预检之后被停用、或拨钟过了它的过期时间：registration_code_invalid，没有账号", async () => {
        for (const change of ["disable", "expire"] as const) {
            let act: (() => Promise<unknown>) | undefined;
            const passwords: PasswordFunctions = {
                verify: REAL_PASSWORD_FUNCTIONS.verify,
                hash: async (password) => {
                    const hashed = await REAL_PASSWORD_FUNCTIONS.hash(password);
                    await act?.();
                    return hashed;
                },
            };
            identity = await createTestIdentity(`identity-register-code-${change}-after-precheck`, {overrides: {passwords}});
            const target = identity;
            const codeId = await addCode(target, "identity_registration_code", "REG-CODE", {expiresAt: target.clock.now() + DAY_MS});
            act =
                change === "disable"
                    ? () => target.conn.write((tx) => tx.query(`UPDATE identity_registration_code SET disabled_at = ? WHERE id = ?`).run(libDate(target.clock.now()), codeId))
                    : async () => target.clock.advance(DAY_MS);
            expect({change, ...(await outcome(await register(target, registerBody())))}).toEqual({change, status: 422, body: {error: {code: "registration_code_invalid"}}});
            expect({change, used: await usedCount(target, "identity_registration_code", codeId), users: await userCount(target)}).toEqual({change, used: 0, users: 0});
            await target.root.cleanup();
            identity = undefined;
        }
    });
});
