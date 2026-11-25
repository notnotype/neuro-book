/**
 * 创建管理员的命令（`create-admin.ts`；`site.operations` 输出 5、失败表与时序一节）。命令跑在同一个库文件的另一条连接上（入口给
 * 命令的是它自己的连接），模块实例开在第一条连接上，用来看“服务那一侧”是否立即按新状态判断。真实的 SQLite、真实的哈希；
 * 读密码的来源是包内的 `TestPasswordSource`（读密码本身的规则在 `read-password.test.ts`）。
 *
 * 时间：哈希与校验用产品的 argon2id 参数（`password.ts`），一次几十到上百毫秒；要核对“新密码能用、旧密码不能用”的几条要做三四次，
 * 超出单个用例 200 毫秒的预算。不换成便宜的参数：命令用的是不是产品的哈希函数，正要靠这几条看出来。
 */

import {afterEach, describe, expect, it} from "bun:test";

import {IdentityConnection} from "../db/connection";
import {libDate} from "../db/library-rows";
import {hashPassword, verifyPassword} from "../password";
import {recordingLog} from "../testing/library";
import {createTestIdentity, type TestIdentity} from "../testing/module";
import {TestPasswordSource} from "../testing/password-source";
import {runCreateAdmin, type BusyRetry, type CreateAdminOptions} from "./create-admin";

const PASSWORD = "correct horse battery";
const START = Date.parse("2026-11-25T10:00:00.000Z");

let identity: TestIdentity | undefined;

afterEach(async () => {
    await identity?.root.cleanup();
    identity = undefined;
});

async function setup(name: string) {
    identity = await createTestIdentity(name, {start: START});
    return identity;
}

interface Run {
    readonly result: Promise<Awaited<ReturnType<typeof runCreateAdmin>>>;
    readonly log: ReturnType<typeof recordingLog>;
    readonly source: TestPasswordSource;
}

/** 在另一条连接上跑命令；密码缺省从管道送 `PASSWORD`。 */
function runCommand(target: TestIdentity, args: Readonly<Record<string, string | undefined>>, overrides: Partial<CreateAdminOptions> & {readonly source?: TestPasswordSource} = {}): Run {
    const log = recordingLog();
    const source = overrides.source ?? new TestPasswordSource(false).send(`${PASSWORD}\n`).end();
    const commandDb = target.root.openOther();
    const result = runCreateAdmin({
        conn: new IdentityConnection(commandDb, {log}),
        log,
        clock: target.clock,
        args,
        signal: new AbortController().signal,
        input: source,
        ...overrides,
    });
    return {result, log, source};
}

type Row = Readonly<Record<string, unknown>>;

function all(target: TestIdentity, sql: string, ...params: (string | number)[]): Promise<Row[]> {
    return target.conn.read((tx) => tx.query<Row, (string | number)[]>(sql).all(...params));
}

const users = (target: TestIdentity) => all(target, `SELECT * FROM "user" ORDER BY "id"`);
const audits = (target: TestIdentity) => all(target, `SELECT * FROM identity_audit ORDER BY id`);
const credentials = (target: TestIdentity, userId: number) => all(target, `SELECT * FROM "account" WHERE "userId" = ? AND "providerId" = 'credential'`, userId);

async function verifies(target: TestIdentity, userId: number, password: string): Promise<boolean> {
    const [row] = await credentials(target, userId);
    return verifyPassword(password, row!.password as string, {accountId: Number(row!.id), log: target.log});
}

/** 什么也没写：没有新账号、没有审计。 */
async function expectNothingWritten(target: TestIdentity, usersBefore: number): Promise<void> {
    expect(await users(target)).toHaveLength(usersBefore);
    expect(await audits(target)).toEqual([]);
}

async function whoamiState(target: TestIdentity, cookie: string): Promise<unknown> {
    return ((await (await target.fetch("/whoami", {headers: {cookie}})).json()) as {state: unknown}).state;
}

describe("新建管理员", () => {
    it("没给邮箱：管理员、没封禁、显示名是原样的用户名、占位邮箱待补、能用这个密码登录，审计一条", async () => {
        const target = await setup("create-admin-new");
        const run = runCommand(target, {username: "Site_Admin"});
        expect(await run.result).toBeUndefined();

        const [user] = await users(target);
        const id = user!.id as number;
        expect(user).toEqual({
            id,
            name: "Site_Admin",
            email: `u${String(id)}@placeholder.invalid`,
            emailVerified: 0,
            image: null,
            createdAt: libDate(START),
            updatedAt: libDate(START),
            username: "site_admin",
            displayUsername: "Site_Admin",
            role: "admin",
            banned: 0,
            banReason: null,
            banExpires: null,
        });
        expect(await all(target, `SELECT user_id, email_pending, website, bio, last_login_at FROM identity_profile`)).toEqual([{user_id: id, email_pending: 1, website: null, bio: null, last_login_at: null}]);
        expect(await credentials(target, id)).toHaveLength(1);
        expect(await verifies(target, id, PASSWORD)).toBe(true);
        expect(await audits(target)).toEqual([{id: 1, created_at: libDate(START), actor_id: null, action: "admin.cli_upsert", target_type: "user", target_id: id, params: `{"created":true}`}]);
        expect(run.log.lines).toEqual([{level: "info", event: "identity.admin_upserted", fields: {userId: id, created: true, emailIgnored: false}}]);
    });

    it("给了邮箱：按小写存，不待补", async () => {
        const target = await setup("create-admin-new-email");
        expect(await runCommand(target, {username: "root", email: "Root@Example.COM"}).result).toBeUndefined();
        const [user] = await users(target);
        expect(user!.email).toBe("root@example.com");
        expect(await all(target, `SELECT email_pending FROM identity_profile`)).toEqual([{email_pending: 0}]);
    });

    it("邮箱已被别的账号用（不分大小写）：email_taken，什么也没写", async () => {
        const target = await setup("create-admin-email-taken");
        await target.addUser("bob");
        const run = runCommand(target, {username: "carol", email: "BOB@example.com"});
        expect(await run.result).toMatchObject({code: "email_taken"});
        await expectNothingWritten(target, 1);
        expect(run.log.lines).toEqual([]);
    });

    for (const email of ["not-an-email", "carol@site.invalid"]) {
        it(`邮箱不合规则（${email}）：invalid_argument，name 是 email，什么也没写`, async () => {
            const target = await setup("create-admin-email-invalid");
            expect(await runCommand(target, {username: "carol", email}).result).toEqual({code: "invalid_argument", message: expect.any(String), fields: {name: "email", problem: "invalid"}});
            await expectNothingWritten(target, 0);
        });
    }
});

describe("已有的账号", () => {
    /** 有两个会话、带旧密码、被封禁的账号。会话要在封禁之前发（库不给封禁的账号发会话）。 */
    async function bannedUserWithSessions(name: string) {
        const target = await setup(name);
        const userId = await target.addUser("alice");
        const sessions = [await target.issue(userId), await target.issue(userId)];
        expect(await whoamiState(target, sessions[0]!.cookie)).toBe("authenticated");
        const oldHash = await hashPassword("the old password");
        await target.conn.write((tx) => {
            tx.query(`UPDATE "user" SET "banned" = 1, "banReason" = 'spam', "banExpires" = ? WHERE "id" = ?`).run(libDate(START + 86_400_000), userId);
            tx.query(`INSERT INTO "account" ("accountId", "providerId", "userId", "password", "createdAt", "updatedAt") VALUES (?, 'credential', ?, ?, ?, ?)`).run(String(userId), userId, oldHash, libDate(START), libDate(START));
        });
        return {target, userId, sessions};
    }

    it("改成没封禁的管理员、换密码、结束全部会话；服务那一侧立即认：旧会话失效", async () => {
        const {target, userId, sessions} = await bannedUserWithSessions("create-admin-existing");
        target.clock.advance(60_000);

        const run = runCommand(target, {username: "ALICE"});
        expect(await run.result).toBeUndefined();

        const [user] = await users(target);
        expect(user).toMatchObject({id: userId, role: "admin", banned: 0, banReason: null, banExpires: null, email: "alice@example.com", updatedAt: libDate(START + 60_000)});
        expect(await credentials(target, userId)).toHaveLength(1);
        expect(await verifies(target, userId, PASSWORD)).toBe(true);
        expect(await verifies(target, userId, "the old password")).toBe(false);
        for (const session of sessions) {
            expect(await target.sessionRow(session.sessionId)).toBeNull();
            expect(await whoamiState(target, session.cookie)).toBe("anonymous");
        }
        expect(await audits(target)).toEqual([{id: 1, created_at: libDate(START + 60_000), actor_id: null, action: "admin.cli_upsert", target_type: "user", target_id: userId, params: `{"created":false}`}]);
        expect(run.log.lines).toEqual([{level: "info", event: "identity.admin_upserted", fields: {userId, created: false, emailIgnored: false}}]);
        // 只改不建：没有为它另建资料行。
        expect(await all(target, `SELECT user_id FROM identity_profile`)).toEqual([]);
    });

    it("没有密码登录方式的账号：补一条", async () => {
        const target = await setup("create-admin-existing-no-credential");
        const userId = await target.addUser("alice");
        expect(await runCommand(target, {username: "alice"}).result).toBeUndefined();
        expect(await credentials(target, userId)).toHaveLength(1);
        expect(await verifies(target, userId, PASSWORD)).toBe(true);
    });

    for (const email of ["new@example.com", "bob@example.com", "not-an-email"]) {
        it(`给的邮箱（${email}）不校验、不查重、不写，成功日志标明被忽略`, async () => {
            const target = await setup("create-admin-existing-email");
            const userId = await target.addUser("alice");
            await target.addUser("bob");
            const run = runCommand(target, {username: "alice", email});
            expect(await run.result).toBeUndefined();
            const [user] = await users(target);
            expect(user!.email).toBe("alice@example.com");
            expect(run.log.lines).toEqual([{level: "info", event: "identity.admin_upserted", fields: {userId, created: false, emailIgnored: true}}]);
        });
    }
});

describe("参数与密码", () => {
    const cases: readonly {readonly name: string; readonly username: string; readonly problem: "missing" | "invalid"}[] = [
        {name: "空的用户名", username: "", problem: "missing"},
        {name: "太短", username: "ab", problem: "invalid"},
        {name: "非 ASCII（开尔文符号转小写后才是 k）", username: "Kelvin", problem: "invalid"},
    ];
    for (const testCase of cases) {
        it(`用户名${testCase.name}：invalid_argument，不读密码`, async () => {
            const target = await setup("create-admin-username");
            const run = runCommand(target, {username: testCase.username});
            expect(await run.result).toEqual({code: "invalid_argument", message: expect.any(String), fields: {name: "username", problem: testCase.problem}});
            expect(run.source.subscriptions).toBe(0);
            await expectNothingWritten(target, 0);
        });
    }

    it("密码不合规则：invalid_argument，name 是 password，什么也没写", async () => {
        const target = await setup("create-admin-password-invalid");
        const source = new TestPasswordSource(false).send("short\n").end();
        expect(await runCommand(target, {username: "root"}, {source}).result).toEqual({code: "invalid_argument", message: expect.any(String), fields: {name: "password", problem: "invalid"}});
        await expectNothingWritten(target, 0);
    });

    it("终端里两次不一致：mismatch，什么也没写", async () => {
        const target = await setup("create-admin-password-mismatch");
        const source = new TestPasswordSource(true).send(`${PASSWORD}\r`).send(`${PASSWORD}.\r`);
        expect(await runCommand(target, {username: "root"}, {source}).result).toEqual({code: "invalid_argument", message: expect.any(String), fields: {name: "password", problem: "mismatch"}});
        await expectNothingWritten(target, 0);
    });

    it("终端里按 Ctrl-C：以 interrupted 的失败结束（不是 reject），终端恢复，什么也没写", async () => {
        const target = await setup("create-admin-ctrl-c");
        const source = new TestPasswordSource(true).send("corr\u0003");
        expect(await runCommand(target, {username: "root"}, {source}).result).toEqual({code: "interrupted", message: expect.any(String), fields: {module: "identity", command: "create-admin"}});
        expect(source.rawModes).toEqual([true, false]);
        await expectNothingWritten(target, 0);
    });
});

describe("停止信号", () => {
    it("等密码时收到：reject 为 signal.reason，什么也没写", async () => {
        const target = await setup("create-admin-abort-reading");
        const controller = new AbortController();
        const source = new TestPasswordSource(true);
        const run = runCommand(target, {username: "root"}, {source, signal: controller.signal});
        const reason = new DOMException("stop", "AbortError");
        controller.abort(reason);
        expect(await run.result.then(() => "resolved", (error: unknown) => error)).toBe(reason);
        expect(source.rawModes).toEqual([true, false]);
        await expectNothingWritten(target, 0);
    });

    it("算完哈希、写库之前收到：不写", async () => {
        const target = await setup("create-admin-abort-after-hash");
        const userId = await target.addUser("alice");
        const session = await target.issue(userId);
        const controller = new AbortController();
        const reason = new DOMException("stop", "AbortError");
        const hash = async (password: string): Promise<string> => {
            const hashed = await hashPassword(password);
            controller.abort(reason);
            return hashed;
        };
        const run = runCommand(target, {username: "alice"}, {signal: controller.signal, hash});
        expect(await run.result.then(() => "resolved", (error: unknown) => error)).toBe(reason);
        expect(await users(target)).toMatchObject([{role: "user"}]);
        expect(await audits(target)).toEqual([]);
        expect(await whoamiState(target, session.cookie)).toBe("authenticated");
    });

    it("撞忙等着重试时收到：reject，不再试", async () => {
        const target = await setup("create-admin-abort-busy");
        const lock = holdWriteLockFast(target);
        const controller = new AbortController();
        const reason = new DOMException("stop", "AbortError");
        const retry: BusyRetry = {
            retries: 5,
            delayMs: 0,
            sleep: async () => {
                controller.abort(reason);
            },
        };
        const run = runCommand(target, {username: "root"}, {signal: controller.signal, busyRetry: retry, conn: lock.commandConn});
        expect(await run.result.then(() => "resolved", (error: unknown) => error)).toBe(reason);
        lock.release();
        await expectNothingWritten(target, 0);
    });
});

/**
 * 另一条连接持住写锁（像正在写的服务）。命令那条连接的 `busy_timeout` 改成 0：撞忙立即以 `SQLITE_BUSY` 失败，不在每次尝试上
 * 等满入口给的 250 毫秒；这里测的是重试，等多久由 SQLite 管。
 */
function holdWriteLockFast(target: TestIdentity): {readonly commandConn: IdentityConnection; release(): void} {
    const holder = target.root.openOther();
    holder.exec("BEGIN IMMEDIATE");
    const commandDb = target.root.openOther();
    commandDb.exec("PRAGMA busy_timeout = 0");
    let held = true;
    return {
        commandConn: new IdentityConnection(commandDb, {log: target.log}),
        release: () => {
            if (!held) return;
            held = false;
            holder.exec("ROLLBACK");
        },
    };
}

describe("与服务排队", () => {
    it("服务持着写锁时隔一阵重试，锁放开后照常写成", async () => {
        const target = await setup("create-admin-busy-retry");
        const lock = holdWriteLockFast(target);
        const sleeps: number[] = [];
        const retry: BusyRetry = {
            retries: 3,
            delayMs: 100,
            sleep: async (ms) => {
                sleeps.push(ms);
                // 第二次睡的时候服务写完了。
                if (sleeps.length === 2) lock.release();
            },
        };
        expect(await runCommand(target, {username: "root"}, {busyRetry: retry, conn: lock.commandConn}).result).toBeUndefined();
        expect(sleeps).toEqual([100, 100]);
        expect(await users(target)).toHaveLength(1);
        expect(await audits(target)).toHaveLength(1);
    });

    it("重试用完仍忙：unavailable，什么也没写", async () => {
        const target = await setup("create-admin-busy-exhausted");
        const lock = holdWriteLockFast(target);
        let sleeps = 0;
        const retry: BusyRetry = {
            retries: 2,
            delayMs: 100,
            sleep: async () => {
                sleeps += 1;
            },
        };
        const run = runCommand(target, {username: "root"}, {busyRetry: retry, conn: lock.commandConn});
        expect(await run.result).toEqual({code: "unavailable", message: expect.any(String), fields: {module: "identity"}});
        expect(sleeps).toBe(2);
        lock.release();
        await expectNothingWritten(target, 0);
    });
});

describe("审计与操作同时生效", () => {
    it("审计写不进去时账号也不变（同一个事务）", async () => {
        const target = await setup("create-admin-audit-atomic");
        // 在审计表的边界上造故障：库自己拒绝这一行，像磁盘满或约束失败那样从同一个事务里抛出。
        await target.conn.write((tx) => {
            tx.query(`CREATE TRIGGER test_audit_rejects BEFORE INSERT ON identity_audit BEGIN SELECT RAISE(ABORT, 'test: audit rejected'); END`).run();
        });
        const run = runCommand(target, {username: "root"});
        await expect(run.result).rejects.toThrow("test: audit rejected");
        expect(await users(target)).toEqual([]);
        expect(await all(target, `SELECT * FROM "account"`)).toEqual([]);
        expect(await all(target, `SELECT * FROM identity_profile`)).toEqual([]);
    });
});
