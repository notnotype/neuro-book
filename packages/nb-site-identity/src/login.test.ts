/**
 * 登录（`login.ts`；`site.accounts` 输出 4、19、20、21，时序一节“封禁与登录并发”“改密码或重置密码与登录并发”，验收 7）。
 *
 * 这里测合同测试测不到的部分（计划第 6 节的“位置”一列）：要在校验与发会话之间、或在发会话的事务开着时插入动作的并发；“三种失败都算
 * 了一次同样的哈希”与失败下限（量响应时间在共享的机器上不稳，改为数校验的调用、用注入的睡眠核对补齐）；先等 2 秒不占名额与队列；
 * 旧站格式（合同里造不出旧格式的哈希）；没有密码的账号（本 Task 的合同里造不出）。插入动作经校验函数与发会话的包装，包装都调真的函数。
 */

import {scrypt} from "node:crypto";

import {afterEach, describe, expect, it} from "bun:test";
import {Value} from "typebox/value";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import {ErrorBody, LoginResponse} from "@notnotype/nb-site-identity-contract";

import {FAILURE_FLOOR_MS} from "./hash-limiter";
import {isBannedUserError, LOGIN_DELAY_MS} from "./login";
import {hashPassword, REAL_PASSWORD_FUNCTIONS, type PasswordFunctions} from "./password";
import {endAllSessions} from "./session";
import {ManualTimers, TEST_SITE_URL} from "./testing/library";
import {createTestIdentity, SESSION_COOKIE, sessionCookieOf, TEST_CLIENT_ADDRESS_HEADER, TEST_TERMS_VERSION, type TestIdentity} from "./testing/module";

let identity: TestIdentity | undefined;

afterEach(async () => {
    await identity?.root.cleanup();
    identity = undefined;
});

const CONSENTED = {termsVersion: TEST_TERMS_VERSION, overseasStorage: true} as const;
const PASSWORD = "correct horse battery";

function login(target: TestIdentity, identifier: string, password: string, address = "203.0.113.1"): Promise<Response> {
    return target.fetch("/login", {
        method: "POST",
        headers: {origin: TEST_SITE_URL, "content-type": "application/json", [TEST_CLIENT_ADDRESS_HEADER]: address},
        body: JSON.stringify({identifier, password}),
    });
}

async function outcome(response: Response): Promise<{readonly status: number; readonly body: unknown}> {
    return {status: response.status, body: await response.json()};
}

const invalidCredentials = {status: 401, body: {error: {code: "invalid_credentials"}}};

async function sessionCount(target: TestIdentity, userId: number): Promise<number> {
    return target.conn.read((tx) => tx.query<{n: number}, [number]>(`SELECT COUNT(*) AS n FROM "session" WHERE "userId" = ?`).get(userId)!.n);
}

async function storedHash(target: TestIdentity, userId: number): Promise<string | null> {
    return target.conn.read((tx) => tx.query<{password: string | null}, [number]>(`SELECT "password" FROM "account" WHERE "userId" = ? AND "providerId" = 'credential'`).get(userId)?.password ?? null);
}

function legacyHash(password: string, salt: string): Promise<string> {
    return new Promise((resolve, reject) => {
        scrypt(password, salt, 64, (error, key) => (error ? reject(error) : resolve(`scrypt:${salt}:${key.toString("hex")}`)));
    });
}

/** 数校验次数的包装；`after` 给了时，第一次校验通过之后执行它一次（模拟两步之间别处的改动）。 */
function countingPasswords(): PasswordFunctions & {verifies: number; after: (() => Promise<void>) | undefined} {
    const passwords = {
        verifies: 0,
        after: undefined as (() => Promise<void>) | undefined,
        hash: REAL_PASSWORD_FUNCTIONS.hash,
        verify: async (password: string, stored: string, context: Parameters<PasswordFunctions["verify"]>[2]) => {
            passwords.verifies += 1;
            const ok = await REAL_PASSWORD_FUNCTIONS.verify(password, stored, context);
            const after = passwords.after;
            if (ok && after !== undefined) {
                passwords.after = undefined;
                await after();
            }
            return ok;
        },
    };
    return passwords;
}

describe("登录成功（输出 4）", () => {
    it("按用户名、按邮箱（大小写不同）都能登录：回公开资料与会话 Cookie，记下最后登录时间", async () => {
        identity = await createTestIdentity("identity-login-ok");
        const userId = await identity.addUser("alice", {consent: CONSENTED, password: PASSWORD});
        for (const identifier of ["Alice", "ALICE@Example.com"]) {
            const response = await login(identity, identifier, PASSWORD);
            const body = await response.json();
            expect({identifier, status: response.status, shape: Value.Check(LoginResponse, body)}).toEqual({identifier, status: 200, shape: true});
            expect(body).toEqual({
                user: {id: userId, username: "alice", displayName: "alice", avatarUrl: null, website: null, bio: null, role: "user", createdAt: new Date(identity.clock.now()).toISOString()},
            });
            const cookie = sessionCookieOf(response.headers.getSetCookie());
            const whoami = await (await identity.fetch("/whoami", {headers: {cookie}})).json();
            expect(whoami).toEqual({state: "authenticated", user: {id: userId, username: "alice", role: "user"}});
        }
        expect(await sessionCount(identity, userId)).toBe(2);
        const lastLogin = await identity.conn.read((tx) => tx.query<{last_login_at: string}, [number]>(`SELECT last_login_at FROM identity_profile WHERE user_id = ?`).get(userId));
        expect(lastLogin).toEqual({last_login_at: new Date(identity.clock.now()).toISOString()});
    });
});

describe("登录失败（输出 4、失败表）", () => {
    it("账号不存在、没有密码、密码错都回同一个 invalid_credentials，三种都恰好校验了一次", async () => {
        const passwords = countingPasswords();
        identity = await createTestIdentity("identity-login-invalid", {overrides: {passwords}});
        await identity.addUser("alice", {consent: CONSENTED, password: PASSWORD});
        await identity.addUser("nopass", {consent: CONSENTED});
        const cases = [
            ["账号不存在", "nobody", PASSWORD],
            ["没有密码", "nopass", PASSWORD],
            ["密码错", "alice", "wrong password"],
            ["邮箱找不到", "nobody@example.com", PASSWORD],
        ] as const;
        for (const [name, identifier, password] of cases) {
            const before = passwords.verifies;
            const response = await login(identity, identifier, password);
            const body = await response.json();
            expect({name, status: response.status, body, shape: Value.Check(ErrorBody, body), verifies: passwords.verifies - before, setCookies: response.headers.getSetCookie()}).toEqual({
                name,
                ...invalidCredentials,
                shape: true,
                verifies: 1,
                setCookies: [],
            });
        }
    });

    it("三种失败都等到下限才回应；成功的登录不补", async () => {
        const sleeps: {readonly ms: number; readonly done: PromiseWithResolvers<void>}[] = [];
        // 时钟停在 0：从起点算剩下的就是整个下限。
        const failureFloor = {
            now: () => 0,
            sleep: (ms: number) => {
                const done = Promise.withResolvers<void>();
                sleeps.push({ms, done});
                return done.promise;
            },
        };
        identity = await createTestIdentity("identity-login-floor", {overrides: {failureFloor}});
        await identity.addUser("alice", {consent: CONSENTED, password: PASSWORD});
        await identity.addUser("nopass", {consent: CONSENTED});
        for (const [name, identifier, password] of [
            ["账号不存在", "nobody", PASSWORD],
            ["没有密码", "nopass", PASSWORD],
            ["密码错", "alice", "wrong password"],
        ] as const) {
            let settled = false;
            const index = sleeps.length;
            const pending = login(identity, identifier, password).then((response) => {
                settled = true;
                return response;
            });
            // 回应先到了（没补下限）也停下等：那时 `sleeps[index]` 是 undefined，下一句断言失败，而不是等到超时。
            await waitUntil(`${name}：补齐下限的睡眠或回应`, () => sleeps[index] !== undefined || settled);
            const sleep = sleeps[index];
            expect({name, ms: sleep?.ms, settled}).toEqual({name, ms: FAILURE_FLOOR_MS, settled: false});
            sleep!.done.resolve();
            expect({name, ...(await outcome(await pending))}).toEqual({name, ...invalidCredentials});
        }
        const before = sleeps.length;
        expect((await login(identity, "alice", PASSWORD)).status).toBe(200);
        expect(sleeps.length).toBe(before);
    });

    it("下限从拿到哈希名额起算：排队的时间不算进去，排得比下限还久，失败的回应照样补到下限", async () => {
        // 下限的时钟只由用例推：第二个登录排队时推 1000 毫秒（远超下限），它的校验本身推 40 毫秒。起点在拿到名额时，剩下的是下限减 40；
        // 起点在排队之前时，剩下的是负数、不睡。
        let floorNow = 0;
        const sleeps: number[] = [];
        const failureFloor = {
            now: () => floorNow,
            sleep: (ms: number) => {
                sleeps.push(ms);
                return Promise.resolve();
            },
        };
        const gate = Promise.withResolvers<void>();
        const entered = Promise.withResolvers<void>();
        let holdFirst = true;
        const passwords: PasswordFunctions = {
            hash: REAL_PASSWORD_FUNCTIONS.hash,
            verify: async (password, stored, context) => {
                if (holdFirst) {
                    holdFirst = false;
                    entered.resolve();
                    await gate.promise;
                } else {
                    floorNow += 40;
                }
                return REAL_PASSWORD_FUNCTIONS.verify(password, stored, context);
            },
        };
        // 手动计时器只用来数排队的个数（每个排队的登记一个 5 秒的上限计时器），不拨它。
        const hashTimers = new ManualTimers();
        identity = await createTestIdentity("identity-login-floor-queue", {config: {hashConcurrency: 1, hashQueue: 4}, overrides: {passwords, failureFloor, hashTimers}});
        const target = identity;
        await target.addUser("alice", {consent: CONSENTED, password: PASSWORD});
        const first = login(target, "alice", PASSWORD, "192.0.2.1");
        await entered.promise;
        const queued = login(target, "nobody", PASSWORD, "192.0.2.2");
        await waitUntil("第二个登录排进哈希的队", () => hashTimers.pending === 1);
        floorNow += 1_000;
        gate.resolve();
        expect((await first).status).toBe(200);
        expect(await outcome(await queued)).toEqual(invalidCredentials);
        expect(sleeps).toEqual([FAILURE_FLOOR_MS - 40]);
    });

    it("邮箱待补的账号不能用邮箱登录，用户名照常；开尔文符号的用户名找不到 kelvin", async () => {
        identity = await createTestIdentity("identity-login-lookup");
        const pendingId = await identity.addUser("pending", {consent: CONSENTED, password: PASSWORD});
        await identity.conn.write((tx) => tx.query(`INSERT INTO identity_profile (user_id, email_pending) VALUES (?, 1)`).run(pendingId));
        await identity.addUser("kelvin", {consent: CONSENTED, password: PASSWORD});
        expect(await outcome(await login(identity, "pending@example.com", PASSWORD))).toEqual(invalidCredentials);
        expect((await login(identity, "pending", PASSWORD)).status).toBe(200);
        expect(await outcome(await login(identity, "Kelvin", PASSWORD))).toEqual(invalidCredentials);
        expect((await login(identity, "Kelvin", PASSWORD)).status).toBe(200);
    });

    it("字段不合格回 validation_failed 并列出字段；密码只查上限，比 8 个码点短的旧密码照常校验", async () => {
        identity = await createTestIdentity("identity-login-fields");
        await identity.addUser("short", {consent: CONSENTED, passwordHash: await legacyHash("abc", "salt")});
        const post = (body: unknown) => identity!.fetch("/login", {method: "POST", headers: {origin: TEST_SITE_URL, "content-type": "application/json"}, body: JSON.stringify(body)});
        expect(await outcome(await post({identifier: "", password: PASSWORD}))).toEqual({status: 400, body: {error: {code: "validation_failed", fields: ["identifier"]}}});
        expect(await outcome(await post({identifier: "alice", password: "a".repeat(129)}))).toEqual({status: 400, body: {error: {code: "validation_failed", fields: ["password"]}}});
        expect(await outcome(await post({identifier: "alice"}))).toEqual({status: 400, body: {error: {code: "validation_failed", fields: ["password"]}}});
        expect((await login(identity, "short", "abc")).status).toBe(200);
    });

    it("被封禁的账号：密码对回 account_banned、不留会话；密码错仍是 invalid_credentials", async () => {
        identity = await createTestIdentity("identity-login-banned");
        const userId = await identity.addUser("alice", {consent: CONSENTED, password: PASSWORD});
        await identity.conn.write((tx) => tx.query(`UPDATE "user" SET "banned" = 1 WHERE "id" = ?`).run(userId));
        expect(await outcome(await login(identity, "alice", PASSWORD))).toEqual({status: 403, body: {error: {code: "account_banned"}}});
        expect(await outcome(await login(identity, "alice", "wrong password"))).toEqual(invalidCredentials);
        expect(await sessionCount(identity, userId)).toBe(0);
    });

    it("库给被封禁账号建会话时抛的错误认得出（升级清单：admin 插件的 BANNED_USER）", async () => {
        identity = await createTestIdentity("identity-login-banned-error");
        const userId = await identity.addUser("alice", {consent: CONSENTED});
        await identity.conn.write((tx) => tx.query(`UPDATE "user" SET "banned" = 1 WHERE "id" = ?`).run(userId));
        const error = await identity.assembly.sessions.issue(userId, null).then(
            () => undefined,
            (thrown: unknown) => thrown,
        );
        expect(isBannedUserError(error)).toBe(true);
        expect(isBannedUserError(new Error("BANNED_USER"))).toBe(false);
        expect(await sessionCount(identity, userId)).toBe(0);
    });
});

describe("登录与改动并发（时序一节）", () => {
    it("校验通过之后、发会话之前被重置了密码：invalid_credentials，没有会话（验收 7）", async () => {
        const passwords = countingPasswords();
        identity = await createTestIdentity("identity-login-reset-race", {overrides: {passwords}});
        const userId = await identity.addUser("alice", {consent: CONSENTED, password: PASSWORD});
        const resetHash = await hashPassword("a new password from the admin");
        passwords.after = () =>
            identity!.conn.write((tx) => {
                tx.query(`UPDATE "account" SET "password" = ? WHERE "userId" = ?`).run(resetHash, userId);
                endAllSessions(tx, userId, identity!.clock.now());
            });
        expect(await outcome(await login(identity, "alice", PASSWORD))).toEqual(invalidCredentials);
        expect(await sessionCount(identity, userId)).toBe(0);
        expect(passwords.after).toBeUndefined();
    });

    it("同一时机哈希换成了同一个密码的新哈希（并发的登录换了格式）：再校验一次，照常登录", async () => {
        const passwords = countingPasswords();
        identity = await createTestIdentity("identity-login-rehash-race", {overrides: {passwords}});
        const userId = await identity.addUser("alice", {consent: CONSENTED, password: PASSWORD});
        const sameHash = await hashPassword(PASSWORD);
        passwords.after = () => identity!.conn.write((tx) => void tx.query(`UPDATE "account" SET "password" = ? WHERE "userId" = ?`).run(sameHash, userId));
        const before = passwords.verifies;
        expect((await login(identity, "alice", PASSWORD)).status).toBe(200);
        expect(passwords.verifies - before).toBe(2);
        expect(await sessionCount(identity, userId)).toBe(1);
    });

    it("校验通过之后、发会话之前被封禁：account_banned，没有会话", async () => {
        const passwords = countingPasswords();
        identity = await createTestIdentity("identity-login-ban-race", {overrides: {passwords}});
        const userId = await identity.addUser("alice", {consent: CONSENTED, password: PASSWORD});
        passwords.after = () =>
            identity!.conn.write((tx) => {
                tx.query(`UPDATE "user" SET "banned" = 1 WHERE "id" = ?`).run(userId);
                endAllSessions(tx, userId, identity!.clock.now());
            });
        expect(await outcome(await login(identity, "alice", PASSWORD))).toEqual({status: 403, body: {error: {code: "account_banned"}}});
        expect(await sessionCount(identity, userId)).toBe(0);
    });

    for (const [name, from, to] of [
        ["升为管理员", "user", "admin"],
        ["降为普通用户", "admin", "user"],
    ] as const) {
        it(`校验通过之后、发会话之前被${name}：登录回的角色就是新会话的角色（输出 4）`, async () => {
            const passwords = countingPasswords();
            identity = await createTestIdentity(`identity-login-role-race-${to}`, {overrides: {passwords}});
            const target = identity;
            const rootId = await target.addUser("root", {role: "admin", consent: CONSENTED});
            const root = await target.issue(rootId);
            const userId = await target.addUser("alice", {role: from, consent: CONSENTED, password: PASSWORD});
            // 经真实的管理接口改角色：它与登录的发会话事务走同一条队列，排在哈希校验之后、发会话之前。
            let changed: Response | undefined;
            passwords.after = async () => {
                changed = await target.fetch(`/admin/users/${String(userId)}/role`, {
                    method: "POST",
                    headers: {origin: TEST_SITE_URL, "content-type": "application/json", cookie: root.cookie},
                    body: JSON.stringify({role: to}),
                });
            };
            const response = await login(target, "alice", PASSWORD);
            expect({changed: changed?.status, login: response.status}).toEqual({changed: 200, login: 200});
            const body = (await response.json()) as {user: {role: string}};
            const cookie = sessionCookieOf(response.headers.getSetCookie());
            const whoami = await (await target.fetch("/whoami", {headers: {cookie}})).json();
            expect({response: body.user.role, whoami}).toEqual({response: to, whoami: {state: "authenticated", user: {id: userId, username: "alice", role: to}}});
        });
    }

    it("封禁在发会话的事务开着时到达：排在事务之后，提交后删掉刚发的会话，之后的登录回 account_banned", async () => {
        // 手动计时器只用来数排队等锁的个数（每个等锁的登记一个上限计时器），不拨它。
        const timers = new ManualTimers();
        const trigger = Promise.withResolvers<void>();
        let armed = false;
        identity = await createTestIdentity("identity-login-ban-during-tx", {
            timers,
            overrides: {
                wrapIssueSession: (issue) => async (userId, userAgent) => {
                    const issued = await issue(userId, userAgent);
                    if (armed) {
                        armed = false;
                        trigger.resolve();
                        await waitUntil("封禁的写排在发会话的事务之后", () => timers.pending === 1);
                    }
                    return issued;
                },
            },
        });
        const target = identity;
        const userId = await target.addUser("alice", {consent: CONSENTED, password: PASSWORD});
        // 封禁从事务之外发起：在测试自己的异步上下文里等触发，不继承事务的上下文。
        const ban = (async () => {
            await trigger.promise;
            return target.conn.write((tx) => {
                tx.query(`UPDATE "user" SET "banned" = 1 WHERE "id" = ?`).run(userId);
                return endAllSessions(tx, userId, target.clock.now());
            });
        })();
        armed = true;
        const response = await login(target, "alice", PASSWORD);
        expect(response.status).toBe(200);
        expect(await ban).toBe(1);
        const cookie = sessionCookieOf(response.headers.getSetCookie());
        expect(await (await target.fetch("/whoami", {headers: {cookie}})).json()).toEqual({state: "anonymous"});
        expect(await outcome(await login(target, "alice", PASSWORD))).toEqual({status: 403, body: {error: {code: "account_banned"}}});
    });
});

describe("旧站格式（输出 21）", () => {
    it("旧格式的密码能登录，登录后换成新格式，之后同一个密码照常登录", async () => {
        identity = await createTestIdentity("identity-login-legacy");
        const userId = await identity.addUser("alice", {consent: CONSENTED, passwordHash: await legacyHash(PASSWORD, "old-salt")});
        expect((await login(identity, "alice", PASSWORD)).status).toBe(200);
        expect(await storedHash(identity, userId)).toStartWith("$argon2id$");
        expect((await login(identity, "alice", PASSWORD)).status).toBe(200);
        expect(identity.log.lines.filter((line) => line.event === "identity.password_rehashed")).toEqual([{level: "info", event: "identity.password_rehashed", fields: {accountId: expect.any(Number)}}]);
    });

    it("同时 8 个旧格式登录：都成功，只换了一次格式", async () => {
        identity = await createTestIdentity("identity-login-legacy-concurrent");
        const target = identity;
        const userId = await target.addUser("alice", {consent: CONSENTED, passwordHash: await legacyHash(PASSWORD, "old-salt")});
        const responses = await Promise.all(Array.from({length: 8}, (_, index) => login(target, "alice", PASSWORD, `203.0.113.${String(index + 10)}`)));
        expect(responses.map((response) => response.status)).toEqual(Array.from({length: 8}, () => 200));
        expect(await storedHash(target, userId)).toStartWith("$argon2id$");
        expect(target.log.lines.filter((line) => line.event === "identity.password_rehashed")).toHaveLength(1);
        expect(await sessionCount(target, userId)).toBe(8);
    });

    it("换格式算新哈希期间密码被重置：写回不盖掉重置后的密码", async () => {
        const resetHash = await hashPassword("a new password from the admin");
        let armed = false;
        let userId = 0;
        let target: TestIdentity | undefined;
        const passwords: PasswordFunctions = {
            verify: REAL_PASSWORD_FUNCTIONS.verify,
            // 登录里只有换格式会算哈希（假哈希在装配时算，那时还没装上开关）。
            hash: async (password) => {
                const fresh = await REAL_PASSWORD_FUNCTIONS.hash(password);
                if (armed) {
                    armed = false;
                    await target!.conn.write((tx) => void tx.query(`UPDATE "account" SET "password" = ? WHERE "userId" = ?`).run(resetHash, userId));
                }
                return fresh;
            },
        };
        identity = target = await createTestIdentity("identity-login-legacy-reset", {overrides: {passwords}});
        userId = await identity.addUser("alice", {consent: CONSENTED, passwordHash: await legacyHash(PASSWORD, "old-salt")});
        armed = true;
        expect((await login(identity, "alice", PASSWORD)).status).toBe(200);
        expect(armed).toBe(false);
        expect(await storedHash(identity, userId)).toBe(resetHash);
        expect(identity.log.lines.filter((line) => line.event === "identity.password_rehashed")).toEqual([]);
    });
});

describe("限流与过载（输出 19、20）", () => {
    it("同一来源同一用户名 5 分钟 10 次：第 11 次 rate_limited 带整数 Retry-After；字段不合格的不计入；换一个窗口恢复", async () => {
        identity = await createTestIdentity("identity-login-rate", {start: Date.UTC(2026, 10, 25, 10, 0, 0)});
        await identity.addUser("alice", {consent: CONSENTED, password: PASSWORD});
        for (let index = 0; index < 5; index += 1) {
            const response = await identity.fetch("/login", {method: "POST", headers: {origin: TEST_SITE_URL, "content-type": "application/json"}, body: JSON.stringify({identifier: "alice"})});
            expect(response.status).toBe(400);
        }
        for (let index = 0; index < 10; index += 1) expect(await outcome(await login(identity, "alice", "wrong password"))).toEqual(invalidCredentials);
        const limited = await login(identity, "alice", PASSWORD);
        expect(await outcome(limited)).toEqual({status: 429, body: {error: {code: "rate_limited"}}});
        expect(limited.headers.get("retry-after")).toBe("300");
        // 别的来源不受这个键影响。
        expect((await login(identity, "alice", PASSWORD, "198.51.100.7")).status).toBe(200);
        identity.clock.advance(5 * 60_000);
        expect((await login(identity, "alice", PASSWORD)).status).toBe(200);
    });

    it("同一个用户名失败满 20 次后，下一次登录（成功的也是）先等 2 秒；等的时候不占哈希名额、不持队列的锁，别人的登录照常", async () => {
        const delays: {readonly ms: number; readonly done: PromiseWithResolvers<void>}[] = [];
        const hashTimers = new ManualTimers();
        identity = await createTestIdentity("identity-login-delay", {
            config: {hashConcurrency: 1, hashQueue: 4},
            overrides: {
                hashTimers,
                loginDelay: (ms) => {
                    const done = Promise.withResolvers<void>();
                    delays.push({ms, done});
                    return done.promise;
                },
            },
        });
        const target = identity;
        await target.addUser("alice", {consent: CONSENTED, password: PASSWORD});
        const bobId = await target.addUser("bob", {consent: CONSENTED, password: PASSWORD});
        // 来源加用户名每个来源 5 分钟只有 10 次：20 次失败从 20 个来源发。
        for (let index = 0; index < 20; index += 1) expect(await outcome(await login(target, "alice", "wrong password", `198.51.100.${String(index + 1)}`))).toEqual(invalidCredentials);
        expect(delays).toEqual([]);

        const delayed = login(target, "alice", PASSWORD, "192.0.2.1");
        const delay = await waitUntil("alice 在先等", () => delays[0]);
        expect(delay.ms).toBe(LOGIN_DELAY_MS);
        let bobDone = false;
        const bob = login(target, "bob", PASSWORD, "192.0.2.2").then((response) => {
            bobDone = true;
            return response;
        });
        // 名额被占着时 bob 会排进哈希的队（登记一个排队计时器）；没被占时它直接做完，期间还要写库发会话（队列的锁没被持着）。
        await waitUntil("bob 做完或排进哈希的队", () => bobDone || hashTimers.pending > 0);
        expect({bobDone, queued: hashTimers.pending}).toEqual({bobDone: true, queued: 0});
        expect((await bob).status).toBe(200);
        expect(await sessionCount(target, bobId)).toBe(1);

        delay.done.resolve();
        expect((await delayed).status).toBe(200);
    });

    it("并发 1、不排队：一个登录在校验时，另一个回 503 overloaded", async () => {
        const gate = Promise.withResolvers<void>();
        const entered = Promise.withResolvers<void>();
        const passwords: PasswordFunctions = {
            hash: REAL_PASSWORD_FUNCTIONS.hash,
            verify: async (password, stored, context) => {
                entered.resolve();
                await gate.promise;
                return REAL_PASSWORD_FUNCTIONS.verify(password, stored, context);
            },
        };
        identity = await createTestIdentity("identity-login-overloaded", {config: {hashConcurrency: 1, hashQueue: 0}, overrides: {passwords}});
        await identity.addUser("alice", {consent: CONSENTED, password: PASSWORD});
        const first = login(identity, "alice", PASSWORD, "192.0.2.1");
        await entered.promise;
        expect(await outcome(await login(identity, "nobody", PASSWORD, "192.0.2.2"))).toEqual({status: 503, body: {error: {code: "overloaded"}}});
        gate.resolve();
        expect((await first).status).toBe(200);
    });

    it("关闭以后的登录回 overloaded 或 unavailable，不挂起", async () => {
        identity = await createTestIdentity("identity-login-closed");
        await identity.addUser("alice", {consent: CONSENTED, password: PASSWORD});
        await identity.assembly.close();
        const response = await login(identity, "alice", PASSWORD);
        expect(response.status).toBe(503);
        expect(["overloaded", "unavailable"]).toContain(((await response.json()) as {error: {code: string}}).error.code);
    });
});

describe("清理任务", () => {
    it("purge 照常删到期的会话（顺带清限流的窗口）", async () => {
        identity = await createTestIdentity("identity-login-purge");
        const userId = await identity.addUser("alice", {consent: CONSENTED, password: PASSWORD});
        const response = await login(identity, "alice", PASSWORD);
        expect(response.headers.getSetCookie().some((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`))).toBe(true);
        identity.clock.advance(31 * 86_400_000);
        await identity.jobs.find((job) => job.name === "purge")!.run();
        expect(await sessionCount(identity, userId)).toBe(0);
    });
});
