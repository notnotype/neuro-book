/**
 * 对外 OAuth 令牌与授权码随站点会话与账号失效（`site.oauth-provider` 输出 8 与时序一节；`site.accounts` 输出 6；`site.admin`
 * 输出 2 到 4；w00037 t08 计划 3.5、3.11）。经模块的接口做结束会话的各种操作，再经真实的库（进程内的 `auth.handler`，
 * `testing/oauth.ts`）看此前的访问令牌调用户信息得几、没用掉的授权码换不换得出。
 *
 * 合同测试（第 7 片的 `oauth-invalidation.test.ts`）经 HTTP 覆盖同样的事件；这里另测合同造不出的：撤销与删会话同一个事务
 * （删会话的那一步失败时，令牌与码照旧有效，要在会话表上临时加拒绝删除的触发器），`verification` 表里另有库别的行时撤销只删
 * 授权码（要往表里放行），清理任务删过期的行（要读表），以及还没有接口的按授权、按客户端撤（第 4、7 片接上）。
 */

import {afterEach, describe, expect, it} from "bun:test";

import {libDate} from "../db/library-rows";
import {TEST_SITE_URL} from "../testing/library";
import {createTestIdentity, TEST_CONFIG, type TestIdentity} from "../testing/module";
import {addOAuthUser, authorize, CONSENTED, exchange, grantTokens, registerClient, userinfo, type TestClient} from "../testing/oauth";
import {revokeOAuthForClient, revokeOAuthForGrant} from "./revoke";

const PASSWORD = "correct horse battery staple";
const DAY_MS = 86_400_000;
const SESSION_MS = TEST_CONFIG.sessionDays * DAY_MS;

let identity: TestIdentity | undefined;

afterEach(async () => {
    await identity?.assembly.close();
    await identity?.root.cleanup();
    identity = undefined;
});

/** 在一个会话里拿到的：一个换过的访问令牌，一个还没换的授权码。 */
interface Issued {
    readonly accessToken: string;
    readonly code: {readonly code: string; readonly verifier: string};
    readonly client: TestClient;
}

async function issueIn(target: TestIdentity, cookie: string, client: TestClient): Promise<Issued> {
    const {access_token: accessToken} = await grantTokens(target, cookie, client);
    return {accessToken, code: await authorize(target, cookie, client), client};
}

/** 令牌调用户信息的状态码，与授权码换得出（`exchanged`）还是换码的错误码。换码会用掉授权码，每份只看一次。 */
async function observe(target: TestIdentity, issued: Issued): Promise<{readonly token: number; readonly code: string}> {
    const token = (await userinfo(target, issued.accessToken)).status;
    const response = await exchange(target, issued.client, issued.code);
    const code = response.status === 200 ? "exchanged" : String(((await response.json()) as {error?: unknown}).error);
    return {token, code};
}

const REVOKED = {token: 401, code: "invalid_grant"} as const;
const UNTOUCHED = {token: 200, code: "exchanged"} as const;

function post(target: TestIdentity, cookie: string, path: string, body?: unknown): Promise<Response> {
    return target.fetch(path, {
        method: "POST",
        headers: {origin: TEST_SITE_URL, cookie, ...(body === undefined ? {} : {"content-type": "application/json"})},
        ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    });
}

/** 一个有密码的账号两个会话，另一个账号一个会话，各在测试客户端名下拿一份令牌与码。 */
async function setup(name: string, options: {readonly start?: number} = {}) {
    const target = await createTestIdentity(name, options);
    identity = target;
    const client = await registerClient(target);
    const operatorId = await target.addUser("operator", {role: "admin", ...CONSENTED});
    const operator = await target.issue(operatorId);
    const aliceId = await addOAuthUser(target, "alice", {password: PASSWORD, ...CONSENTED});
    const s1 = await target.issue(aliceId);
    const s2 = await target.issue(aliceId);
    const bob = await target.issue(await addOAuthUser(target, "bob", CONSENTED));
    return {
        target,
        client,
        operator,
        aliceId,
        s1,
        s2,
        inS1: await issueIn(target, s1.cookie, client),
        inS2: await issueIn(target, s2.cookie, client),
        ofBob: await issueIn(target, bob.cookie, client),
    };
}

describe("一次会话结束：在这次会话里发出的失效，别的会话的照用", () => {
    it("登出", async () => {
        const {target, s1, inS1, inS2, ofBob} = await setup("identity-revoke-logout");
        expect((await post(target, s1.cookie, "/logout")).status).toBe(200);
        expect([await observe(target, inS1), await observe(target, inS2), await observe(target, ofBob)]).toEqual([REVOKED, UNTOUCHED, UNTOUCHED]);
    });

    it("在会话列表里结束另一个会话", async () => {
        const {target, s1, s2, inS1, inS2} = await setup("identity-revoke-end-one");
        const response = await target.fetch(`/me/sessions/${String(s1.sessionId)}`, {method: "DELETE", headers: {origin: TEST_SITE_URL, cookie: s2.cookie}});
        expect(response.status).toBe(200);
        expect([await observe(target, inS1), await observe(target, inS2)]).toEqual([REVOKED, UNTOUCHED]);
    });

    it("会话到期后清理任务跑完：到期会话里的失效，没到期的照用（时序一节）", async () => {
        // 会话的到期按模块的时钟，令牌与码的到期是库按系统时间写的。起点拨到 30 天前、再过几分钟：会话按模块的时钟到期时，
        // 令牌与码按同一只钟还没过期，清理任务删过期行的那一步碰不到它们，失效只能来自撤销。
        const start = Date.now() - SESSION_MS + 5 * 60_000;
        const {target, client, inS1} = await setup("identity-revoke-purge", {start});
        target.clock.advance(2 * 60_000);
        const later = await target.issue(await addOAuthUser(target, "carol", CONSENTED));
        const inLater = await issueIn(target, later.cookie, client);
        target.clock.set(start + SESSION_MS);
        await target.jobs.find((job) => job.name === "purge")!.run();
        expect([await observe(target, inS1), await observe(target, inLater)]).toEqual([REVOKED, UNTOUCHED]);
    });

    it("会话到期之后、清理任务之前换它名下的码回 invalid_request，换不出令牌；清理之后是 invalid_grant（时序一节）", async () => {
        const {target, s1, inS1, inS2} = await setup("identity-revoke-expired-before-purge");
        // 换码时库按系统时间查这个码所属的会话是否到期，模块的时钟它看不出。会话的到期时刻改到系统时间的一秒之前，就是系统时间
        // 走过了它的样子；模块的时钟与系统时间起点相同，按它也已到期。
        await target.conn.write((tx) => tx.query(`UPDATE "session" SET "expiresAt" = ? WHERE "id" = ?`).run(libDate(Date.now() - 1000), s1.sessionId));
        const exchangeError = async (code: Issued["code"]) => {
            const response = await exchange(target, inS1.client, code);
            return {status: response.status, error: ((await response.json()) as {error?: unknown}).error};
        };
        expect(await exchangeError(inS1.code)).toEqual({status: 400, error: "invalid_request"});
        expect(await target.conn.read((tx) => tx.query<{n: number}, []>(`SELECT count(*) AS n FROM "oauthAccessToken"`).get()!.n)).toBe(3);
        await target.jobs.find((job) => job.name === "purge")!.run();
        expect(await exchangeError(inS1.code)).toEqual({status: 400, error: "invalid_grant"});
        expect(await observe(target, inS2)).toEqual(UNTOUCHED);
    });
});

describe("账号名下的全部失效（封禁、改角色、重置密码、结束全部会话）", () => {
    const ACTIONS = [
        {name: "封禁", path: "ban", body: undefined},
        {name: "改角色", path: "role", body: {role: "admin"}},
        {name: "重置密码", path: "reset-password", body: undefined},
        {name: "结束全部会话", path: "revoke-sessions", body: undefined},
    ] as const;
    for (const action of ACTIONS) {
        it(action.name, async () => {
            const {target, operator, aliceId, inS1, inS2, ofBob} = await setup(`identity-revoke-admin-${action.path}`);
            expect((await post(target, operator.cookie, `/admin/users/${String(aliceId)}/${action.path}`, action.body ?? {})).status).toBe(200);
            expect([await observe(target, inS1), await observe(target, inS2), await observe(target, ofBob)]).toEqual([REVOKED, REVOKED, UNTOUCHED]);
        });
    }
});

describe("自己改密码", () => {
    it("账号名下的全部失效，当前会话里发出的也失效；当前会话本身照用，之后发出的令牌有效", async () => {
        const {target, client, s2, inS1, inS2, ofBob} = await setup("identity-revoke-change-password");
        expect((await post(target, s2.cookie, "/me/password", {currentPassword: PASSWORD, newPassword: "another long enough password"})).status).toBe(200);
        expect([await observe(target, inS1), await observe(target, inS2), await observe(target, ofBob)]).toEqual([REVOKED, REVOKED, UNTOUCHED]);
        expect(((await (await target.fetch("/whoami", {headers: {cookie: s2.cookie}})).json()) as {state: string}).state).toBe("authenticated");
        expect(await observe(target, await issueIn(target, s2.cookie, client))).toEqual(UNTOUCHED);
    });
});

describe("撤销与删会话在同一个事务里", () => {
    const CASES = [
        {name: "登出", run: (s: Awaited<ReturnType<typeof setup>>) => post(s.target, s.s1.cookie, "/logout")},
        {name: "封禁", run: (s: Awaited<ReturnType<typeof setup>>) => post(s.target, s.operator.cookie, `/admin/users/${String(s.aliceId)}/ban`, {})},
    ];
    for (const [index, testCase] of CASES.entries()) {
        it(`删会话那一步失败时${testCase.name}不生效：令牌与码照旧有效`, async () => {
            const s = await setup(`identity-revoke-rollback-${String(index)}`);
            await s.target.conn.write((tx) => tx.query(`CREATE TRIGGER reject_session_delete BEFORE DELETE ON "session" BEGIN SELECT RAISE(ABORT, 'rejected by test'); END`).run());
            expect((await testCase.run(s)).status).toBe(500);
            await s.target.conn.write((tx) => tx.query(`DROP TRIGGER reject_session_delete`).run());
            expect([await observe(s.target, s.inS1), await observe(s.target, s.inS2)]).toEqual([UNTOUCHED, UNTOUCHED]);
        });
    }
});

/**
 * 往 `verification` 表里放三行库别的一次性凭据，回它们的标识。撤销只按授权码删，碰到这几行既不能出错也不能删（`revoke.ts`
 * 文件头；实现审查第 5 条）：
 * - 社交登录的 state：照库 1.7.27 `generateGenericState` 的写法，标识是 `auth-state:` 加 state，`value` 是 JSON，关联意图时
 *   `link.userId` 是账号 id 的字符串；到期是系统时间加 10 分钟。
 * - `value` 不是 JSON 的一行：撤销的 SQL 少了 `json_valid` 的守护时，SQLite 对它报 malformed JSON，整个操作失败。
 * - 顶层带这个账号的 `userId` 与这次会话的 `sessionId`、`type` 却不是授权码的 JSON 一行：库 1.7.27 不写这样的行，放进来让撤销
 *   对 `type` 的判断有用例分辨。
 */
async function addUnrelatedVerifications(target: TestIdentity, userId: number, sessionId: number): Promise<string[]> {
    const now = Date.now();
    const rows = [
        {
            identifier: "auth-state:lab-state-0123456789abcdef0123456789abcd",
            value: JSON.stringify({
                callbackURL: `${TEST_SITE_URL}/__social_ok`,
                codeVerifier: "verifier-0123456789abcdef0123456789abcdef0123",
                errorURL: `${TEST_SITE_URL}/__social_error`,
                link: {email: "alice@example.com", userId: String(userId)},
                expiresAt: now + 600_000,
                oauthState: "lab-state-0123456789abcdef0123456789abcd",
            }),
        },
        {identifier: "unrelated-not-json", value: "not json"},
        {identifier: "unrelated-other-type", value: JSON.stringify({type: "authorization_code_x", userId: String(userId), sessionId: String(sessionId)})},
    ];
    await target.conn.write((tx) => {
        for (const row of rows) {
            tx.query(`INSERT INTO "verification" ("identifier", "value", "expiresAt", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)`).run(row.identifier, row.value, libDate(now + 600_000), libDate(now), libDate(now));
        }
    });
    return rows.map((row) => row.identifier);
}

function remainingVerifications(target: TestIdentity, identifiers: readonly string[]): Promise<string[]> {
    return target.conn.read((tx) =>
        tx
            .query<{identifier: string}, string[]>(`SELECT "identifier" FROM "verification" WHERE "identifier" IN (${identifiers.map(() => "?").join(", ")})`)
            .all(...identifiers)
            .map((row) => row.identifier),
    );
}

describe("verification 表里另有库别的行：撤销照常成功，只删授权码", () => {
    it("登出", async () => {
        const {target, aliceId, s1, inS1, inS2} = await setup("identity-revoke-unrelated-logout");
        const unrelated = await addUnrelatedVerifications(target, aliceId, s1.sessionId);
        expect((await post(target, s1.cookie, "/logout")).status).toBe(200);
        expect([await observe(target, inS1), await observe(target, inS2)]).toEqual([REVOKED, UNTOUCHED]);
        expect((await remainingVerifications(target, unrelated)).sort()).toEqual([...unrelated].sort());
    });

    it("封禁", async () => {
        const {target, operator, aliceId, s1, inS1, inS2, ofBob} = await setup("identity-revoke-unrelated-ban");
        const unrelated = await addUnrelatedVerifications(target, aliceId, s1.sessionId);
        expect((await post(target, operator.cookie, `/admin/users/${String(aliceId)}/ban`, {})).status).toBe(200);
        expect([await observe(target, inS1), await observe(target, inS2), await observe(target, ofBob)]).toEqual([REVOKED, REVOKED, UNTOUCHED]);
        expect((await remainingVerifications(target, unrelated)).sort()).toEqual([...unrelated].sort());
    });

    it("会话到期后的清理任务", async () => {
        // 起点的拨法同“会话到期后清理任务跑完”：会话按模块的时钟到期时，这几行（系统时间加 10 分钟到期）按同一只钟还没过期，
        // 清理删过期行的那一步碰不到它们，剩下的只看撤销删不删。
        const start = Date.now() - SESSION_MS + 5 * 60_000;
        const {target, aliceId, s1, inS1} = await setup("identity-revoke-unrelated-purge", {start});
        const unrelated = await addUnrelatedVerifications(target, aliceId, s1.sessionId);
        target.clock.set(start + SESSION_MS);
        await target.jobs.find((job) => job.name === "purge")!.run();
        expect(await observe(target, inS1)).toEqual(REVOKED);
        expect((await remainingVerifications(target, unrelated)).sort()).toEqual([...unrelated].sort());
    });
});

describe("清理任务删过期的授权码与访问令牌", () => {
    it("按模块的时钟过期的授权码与令牌行删掉，没过期的留着", async () => {
        const {target} = await setup("identity-revoke-purge-expired");
        const counts = () =>
            target.conn.read((tx) => ({
                verifications: tx.query<{n: number}, []>(`SELECT count(*) AS n FROM "verification"`).get()!.n,
                accessTokens: tx.query<{n: number}, []>(`SELECT count(*) AS n FROM "oauthAccessToken"`).get()!.n,
            }));
        // setup 里三份令牌、三个没换的码；拨过令牌的 1 小时（码的 10 分钟更早过）。会话 30 天，还没到期。
        expect(await counts()).toEqual({verifications: 3, accessTokens: 3});
        target.clock.advance(2 * 3_600_000);
        await target.jobs.find((job) => job.name === "purge")!.run();
        expect(await counts()).toEqual({verifications: 0, accessTokens: 0});
        expect(target.log.lines).toContainEqual({level: "info", event: "identity.oauth_purged", fields: {verifications: 3, accessTokens: 3}});
    });

    it("别的写方删掉的会话（令牌的 sessionId 被置空）：清理任务跑完后它名下的令牌失效，别的照用（时序一节，换回上一个版本）", async () => {
        const {target, s1, inS1, inS2, ofBob} = await setup("identity-revoke-purge-orphaned");
        // 上一个版本的登出只删会话行、不撤令牌；外键把令牌的 sessionId 置空。直接删行，就是它在库里留下的样子。
        target.root.openOther().query(`DELETE FROM "session" WHERE "id" = ?`).run(s1.sessionId);
        expect((await userinfo(target, inS1.accessToken)).status).toBe(200);
        await target.jobs.find((job) => job.name === "purge")!.run();
        expect((await userinfo(target, inS1.accessToken)).status).toBe(401);
        expect((await userinfo(target, inS2.accessToken)).status).toBe(200);
        expect((await userinfo(target, ofBob.accessToken)).status).toBe(200);
    });
});

describe("按授权、按客户端撤（撤销授权与停用客户端用）", () => {
    async function twoClients(name: string) {
        const s = await setup(name);
        const other = await registerClient(s.target, "admin2");
        return {...s, other, inOther: await issueIn(s.target, s.s1.cookie, other)};
    }

    it("按授权：这个账号在这个客户端名下的全部，别的客户端与别的账号的照用", async () => {
        const {target, client, aliceId, inS1, inS2, ofBob, inOther} = await twoClients("identity-revoke-grant");
        await target.conn.write((tx) => revokeOAuthForGrant(tx, aliceId, client.clientId, target.clock.now()));
        expect([await observe(target, inS1), await observe(target, inS2), await observe(target, inOther), await observe(target, ofBob)]).toEqual([REVOKED, REVOKED, UNTOUCHED, UNTOUCHED]);
    });

    it("按客户端：这个客户端名下的全部，别的客户端的照用", async () => {
        const {target, client, inS1, ofBob, inOther} = await twoClients("identity-revoke-client");
        await target.conn.write((tx) => revokeOAuthForClient(tx, client.clientId, target.clock.now()));
        expect([await observe(target, inS1), await observe(target, ofBob), await observe(target, inOther)]).toEqual([REVOKED, REVOKED, UNTOUCHED]);
    });
});
