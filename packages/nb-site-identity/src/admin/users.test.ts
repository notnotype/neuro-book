/**
 * 账号的管理接口（`admin/users.ts`；`site.admin` 输出 1 到 5、8）。
 *
 * 合同测试（`nb-site-contract-tests` 的 `admin.test.ts`）覆盖经 HTTP 看得到的部分：封禁、解封、改角色、结束会话、重置密码的效果与审计，
 * 列表与详情。这里测合同里造不出的（计划第 6 节的“位置”一列）：
 * - 处置的写事务复核操作者：要在“中间件认过身份”与“写事务”之间降级、封禁操作者或结束他的会话，时机靠一个慢慢到的请求体
 *   （与 `registration-codes.test.ts` 同一种做法）。
 * - 审计与操作同时生效：要让写审计那一步失败，在审计表上临时加一个拒绝插入的触发器。
 * - 结束全部会话的条数不算已到期、还没被清理的会话：要一个会话到期而那一行还在，靠拨模块的时钟、清理任务不跑，并直接数表里的行。
 * - 重置的新密码取自计划定的字母表、长度 20：合同只说“给出一个新密码”，字母表是实现的选择。
 * - 重置在哈希过载时回 `overloaded`（`site.accounts` 输出 20）：要另一个哈希确定地占着名额，经哈希函数的包装。
 */

import {afterEach, describe, expect, it} from "bun:test";

import {REAL_PASSWORD_FUNCTIONS, type PasswordFunctions} from "../password";
import {endAllSessions} from "../session";
import {TEST_SITE_URL} from "../testing/library";
import {createTestIdentity, TEST_TERMS_VERSION, type TestIdentity} from "../testing/module";
import {RESET_PASSWORD_ALPHABET, RESET_PASSWORD_LENGTH, generateResetPassword} from "./users";

let identity: TestIdentity | undefined;

afterEach(async () => {
    await identity?.root.cleanup();
    identity = undefined;
});

const CONSENTED = {termsVersion: TEST_TERMS_VERSION, overseasStorage: true} as const;

async function outcome(response: Response): Promise<{readonly status: number; readonly body: unknown}> {
    return {status: response.status, body: await response.json()};
}

function post(target: TestIdentity, cookie: string, path: string, body: unknown = {}): Promise<Response> {
    return target.fetch(path, {method: "POST", headers: {origin: TEST_SITE_URL, "content-type": "application/json", cookie}, body: JSON.stringify(body)});
}

/** 账号与会话的状态，加上审计：处置没生效时它们都不变。 */
function snapshot(target: TestIdentity): Promise<unknown> {
    return target.conn.read((tx) => ({
        users: tx.query(`SELECT "id", "role", "banned" FROM "user" ORDER BY "id"`).all(),
        sessions: tx.query(`SELECT "id", "userId" FROM "session" ORDER BY "id"`).all(),
        passwords: tx.query(`SELECT "userId", "password" FROM "account" ORDER BY "id"`).all(),
        audit: tx.query(`SELECT * FROM identity_audit ORDER BY id`).all(),
    }));
}

/** 慢慢到的请求体，见 `registration-codes.test.ts` 的同名函数。 */
function slowBody(body: unknown): {readonly stream: ReadableStream<Uint8Array>; readonly length: number; readonly requested: Promise<void>; deliver(): void} {
    const bytes = new TextEncoder().encode(JSON.stringify(body));
    const requested = Promise.withResolvers<void>();
    const delivered = Promise.withResolvers<void>();
    const stream = new ReadableStream<Uint8Array>(
        {
            async pull(controller) {
                requested.resolve();
                await delivered.promise;
                controller.enqueue(bytes);
                controller.close();
            },
        },
        {highWaterMark: 0},
    );
    return {stream, length: bytes.byteLength, requested: requested.promise, deliver: () => delivered.resolve()};
}

/** 一个管理员（带会话）与一个有密码、有会话的普通用户。 */
async function setup(target: TestIdentity) {
    const adminId = await target.addUser("root", {role: "admin", consent: CONSENTED});
    const admin = await target.issue(adminId);
    const memberId = await target.addUser("member", {consent: CONSENTED, password: "member-PW-1234"});
    await target.issue(memberId);
    return {adminId, admin, memberId};
}

const ACTIONS = [
    {name: "封禁", path: "ban", body: {}},
    {name: "解封", path: "unban", body: {}},
    {name: "改角色", path: "role", body: {role: "admin"}},
    {name: "结束全部会话", path: "revoke-sessions", body: {}},
    {name: "重置密码", path: "reset-password", body: {}},
] as const;

describe("处置的写事务复核操作者（设计审查第 5 条，输出 1、6）", () => {
    const changes = [
        {name: "被降级", apply: "UPDATE \"user\" SET \"role\" = 'user' WHERE \"id\" = ?"},
        {name: "被封禁", apply: 'UPDATE "user" SET "banned" = 1 WHERE "id" = ?'},
        {name: "会话被结束", apply: undefined},
    ] as const;

    for (const change of changes) {
        for (const action of ACTIONS) {
            it(`中间件认过身份之后操作者${change.name}：${action.name}得 unauthenticated，账号、会话、密码与审计都没变`, async () => {
                identity = await createTestIdentity(`identity-admin-users-operator-${String(changes.indexOf(change))}-${String(ACTIONS.indexOf(action))}`);
                const target = identity;
                const {adminId, admin, memberId} = await setup(target);

                const body = slowBody(action.body);
                const response = target.fetch(`/admin/users/${String(memberId)}/${action.path}`, {
                    method: "POST",
                    headers: {origin: TEST_SITE_URL, "content-type": "application/json", "content-length": String(body.length), cookie: admin.cookie},
                    body: body.stream,
                    duplex: "half",
                } as RequestInit);
                await body.requested;
                await target.conn.write((tx) => {
                    if (change.apply === undefined) endAllSessions(tx, adminId, target.clock.now());
                    else tx.query(change.apply).run(adminId);
                });
                const before = await snapshot(target);
                body.deliver();

                expect(await outcome(await response)).toEqual({status: 401, body: {error: {code: "unauthenticated"}}});
                expect(await snapshot(target)).toEqual(before);
            });
        }
    }

    it("对照：操作者在同一时机没有变化时，同一个慢请求体的封禁照常成功", async () => {
        identity = await createTestIdentity("identity-admin-users-operator-control");
        const {admin, memberId} = await setup(identity);
        const body = slowBody({});
        const response = identity.fetch(`/admin/users/${String(memberId)}/ban`, {
            method: "POST",
            headers: {origin: TEST_SITE_URL, "content-type": "application/json", "content-length": String(body.length), cookie: admin.cookie},
            body: body.stream,
            duplex: "half",
        } as RequestInit);
        await body.requested;
        body.deliver();
        expect((await response).status).toBe(200);
    });
});

describe("审计与操作同时生效（输出 8）", () => {
    for (const action of ACTIONS) {
        it(`写审计失败时${action.name}不生效：回 500，账号、会话、密码都没变`, async () => {
            identity = await createTestIdentity(`identity-admin-users-audit-fails-${String(ACTIONS.indexOf(action))}`);
            const {admin, memberId} = await setup(identity);
            await identity.conn.write((tx) => tx.query(`CREATE TRIGGER reject_audit BEFORE INSERT ON identity_audit BEGIN SELECT RAISE(ABORT, 'rejected by test'); END`).run());
            const before = await snapshot(identity);
            expect(await outcome(await post(identity, admin.cookie, `/admin/users/${String(memberId)}/${action.path}`, action.body))).toEqual({status: 500, body: {error: {code: "internal"}}});
            expect(await snapshot(identity)).toEqual(before);
        });
    }
});

describe("结束全部会话的条数（输出 8）", () => {
    it("已到期、清理任务还没删的会话不算：审计记 1、与之前详情的会话数一样；之后详情是 0，到期的那行也删了", async () => {
        identity = await createTestIdentity("identity-admin-users-revoke-count");
        const adminId = await identity.addUser("root", {role: "admin", consent: CONSENTED});
        const memberId = await identity.addUser("member", {consent: CONSENTED});
        await identity.issue(memberId);
        // 会话时长 30 天（测试配置），拨过以后第一个会话到期；清理任务没跑，那一行还在。
        identity.clock.advance(31 * 86_400_000);
        await identity.issue(memberId);
        const admin = await identity.issue(adminId);
        const detail = async () => ((await identity!.fetch(`/admin/users/${String(memberId)}`, {headers: {cookie: admin.cookie}})).json() as Promise<{sessionCount: number}>);
        const memberRows = () => identity!.conn.read((tx) => tx.query<{n: number}, [number]>(`SELECT count(*) AS n FROM "session" WHERE "userId" = ?`).get(memberId)!.n);
        expect({sessionCount: (await detail()).sessionCount, rows: await memberRows()}).toEqual({sessionCount: 1, rows: 2});

        expect((await post(identity, admin.cookie, `/admin/users/${String(memberId)}/revoke-sessions`)).status).toBe(200);
        const audit = await identity.conn.read((tx) => tx.query<{params: string}, []>(`SELECT params FROM identity_audit WHERE action = 'user.revoke_sessions'`).all());
        expect(audit.map((row) => JSON.parse(row.params) as unknown)).toEqual([{count: 1}]);
        expect({sessionCount: (await detail()).sessionCount, rows: await memberRows()}).toEqual({sessionCount: 0, rows: 0});
    });
});

describe("重置密码时哈希过载（输出 4；site.accounts 输出 20）", () => {
    it("并发 1、不排队：另一个重置在算哈希时，这一个回 503 overloaded，账号、会话、密码与审计都没变；前一个照常成功", async () => {
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
        identity = await createTestIdentity("identity-admin-users-reset-overloaded", {config: {hashConcurrency: 1, hashQueue: 0}, overrides: {passwords}});
        const {admin, memberId} = await setup(identity);
        const otherId = await identity.addUser("other", {consent: CONSENTED, password: "other-PW-5678"});
        const held = {entered: Promise.withResolvers<void>(), gate: Promise.withResolvers<void>()};
        hold = held;
        const first = post(identity, admin.cookie, `/admin/users/${String(otherId)}/reset-password`);
        await held.entered.promise;
        // 前一个还停在哈希上、什么都没写：此刻的状态就是“这一个没生效”要对照的样子。
        const before = await snapshot(identity);

        expect(await outcome(await post(identity, admin.cookie, `/admin/users/${String(memberId)}/reset-password`))).toEqual({status: 503, body: {error: {code: "overloaded"}}});
        expect(await snapshot(identity)).toEqual(before);

        held.gate.resolve();
        expect((await first).status).toBe(200);
    });
});

describe("重置密码的新密码（输出 4）", () => {
    it("20 个字符，取自去掉 0、O、1、l、I 的字母与数字；每次不同", () => {
        expect(RESET_PASSWORD_ALPHABET).toHaveLength(57);
        expect([...RESET_PASSWORD_ALPHABET].filter((char) => "0O1lI".includes(char))).toEqual([]);
        const passwords = Array.from({length: 200}, () => generateResetPassword());
        for (const password of passwords) expect({password, ok: password.length === RESET_PASSWORD_LENGTH && [...password].every((char) => RESET_PASSWORD_ALPHABET.includes(char))}).toEqual({password, ok: true});
        expect(new Set(passwords).size).toBe(passwords.length);
    });

    it("新密码不进日志与审计：模块记下的每一行日志、审计表里都找不到它", async () => {
        identity = await createTestIdentity("identity-admin-users-reset-not-logged");
        const {admin, memberId} = await setup(identity);
        const response = await outcome(await post(identity, admin.cookie, `/admin/users/${String(memberId)}/reset-password`));
        expect(response.status).toBe(200);
        const {password} = response.body as {password: string};
        const audit = await identity.conn.read((tx) => tx.query(`SELECT * FROM identity_audit`).all());
        expect(audit).toHaveLength(1);
        expect(JSON.stringify(audit).includes(password)).toBe(false);
        expect(JSON.stringify(identity.log.lines).includes(password)).toBe(false);
    });
});
