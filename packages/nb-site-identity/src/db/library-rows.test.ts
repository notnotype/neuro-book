/**
 * 存法契约（包说明 `AGENTS.md` 升级清单“存法”一行；计划“设计审查的处理”第 14 条）：模块用自己的 SQL 写库的表时，写出的行与
 * 库 1.7.27 自己写的逐列一样，库读回来也一样。同一份账号分别经库（`internalAdapter.createUser`、`linkAccount`）写进一个库、
 * 经 `library-rows.ts` 写进另一个库，再比。升级库后这里失败，说明库换了存法，模块的 SQL 要跟着改。
 */

import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {betterAuth} from "better-auth";

import {identityAuthOptions} from "../auth";
import {createTestDbRoot, type TestDbRoot} from "../testing/db";
import {createTestAuth, recordingLog, TEST_SECRET, TEST_SITE_URL, TEST_TERMS_VERSION} from "../testing/library";
import {IdentityConnection} from "./connection";
import {insertCredentialRow, insertUserRow, libDate, libDateMs} from "./library-rows";

/** 毫秒不为零，能看出时间是否带毫秒。 */
const AT = Date.UTC(2026, 10, 20, 8, 30, 15, 123);

let viaLibrary: TestDbRoot;
let viaModule: TestDbRoot;

beforeEach(async () => {
    viaLibrary = await createTestDbRoot("identity-storage-library");
    viaModule = await createTestDbRoot("identity-storage-module");
});

afterEach(async () => {
    await viaLibrary.cleanup();
    await viaModule.cleanup();
});

/**
 * 产品装配的库，只去掉建用户、建账号前的社交钩子：它们只许库在社交回调里建 `user`、`account` 行（`social/hooks.ts`），这里是
 * 直接调库的内部接口量存法。别的钩子照旧，建账号前钩子也不改密码登录方式的行（它只把令牌列置空，这一行本来就是空的）。
 */
async function libraryOn(root: TestDbRoot) {
    const conn = new IdentityConnection(root.open(), {log: recordingLog()});
    const options = identityAuthOptions({conn, siteUrl: TEST_SITE_URL, secret: TEST_SECRET, sessionDays: 30, termsVersion: TEST_TERMS_VERSION, clock: {now: () => Date.now()}, log: recordingLog()});
    const {create: _socialAccountOnly, ...accountHooks} = options.databaseHooks.account;
    const {create: _socialUserOnly, ...userHooks} = options.databaseHooks.user;
    return (await betterAuth({...options, databaseHooks: {...options.databaseHooks, user: userHooks, account: accountHooks}}).$context).internalAdapter;
}

function rawRows(root: TestDbRoot, table: "user" | "account"): unknown[] {
    const db = root.openOther();
    return db.query(`SELECT * FROM "${table}" ORDER BY "id"`).all();
}

describe("模块的 SQL 与库写出同样的行", () => {
    it("账号与密码登录方式：原始行逐列相同，经库读回的结果也相同", async () => {
        const library = await libraryOn(viaLibrary);
        const user = await library.createUser({
            name: "Alice",
            email: "alice@example.com",
            emailVerified: false,
            username: "alice",
            displayUsername: "Alice",
            createdAt: new Date(AT),
            updatedAt: new Date(AT),
        }, {method: "email-password"});
        await library.linkAccount({userId: user.id, providerId: "credential", accountId: user.id, password: "hash$x", createdAt: new Date(AT), updatedAt: new Date(AT)});

        const moduleConn = new IdentityConnection(viaModule.open(), {log: recordingLog()});
        const userId = await moduleConn.write((tx) => insertUserRow(tx, {username: "alice", displayUsername: "Alice", name: "Alice", email: "alice@example.com", role: "user", now: AT}));
        await moduleConn.write((tx) => insertCredentialRow(tx, {userId, passwordHash: "hash$x", now: AT}));

        expect(rawRows(viaModule, "user")).toEqual(rawRows(viaLibrary, "user"));
        expect(rawRows(viaModule, "account")).toEqual(rawRows(viaLibrary, "account"));

        const readBack = await createTestAuth(moduleConn).$context;
        expect(await readBack.internalAdapter.findUserById(String(userId))).toEqual(await library.findUserById(user.id));
        expect(await readBack.internalAdapter.findAccounts(String(userId))).toEqual(await library.findAccounts(user.id));
    });
});

describe("时间的写法", () => {
    it("libDate 与 libDateMs 互逆，不是库的写法的文本被拒", () => {
        expect(libDate(AT)).toBe("2026-11-20T08:30:15.123Z");
        expect(libDateMs(libDate(AT))).toBe(AT);
        expect(() => libDateMs("2026-11-20 08:30:15")).toThrow();
        expect(() => libDateMs("2026-11-20T08:30:15Z")).toThrow();
    });
});
