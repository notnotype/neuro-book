/**
 * 库的装配（`auth.ts`）依赖的库 1.7.27 的行为，每条用例对着包说明 `AGENTS.md` 升级清单里的一项。用真实的 Better Auth 与
 * bun:sqlite；“标准错误为空”要看整个进程的标准错误，起一个真实的子进程（`testing/handler-under-lock.ts`）。
 */

import {afterEach, describe, expect, it} from "bun:test";
import {join} from "node:path";

import {LIB_BASE_PATH} from "./auth";
import {createIdentityModule} from "./index";
import {hashPassword, verifyPassword} from "./password";
import {createTestDbRoot, type TestDbRoot} from "./testing/db";
import {recordingLog, TEST_SITE_URL} from "./testing/library";
import {createTestIdentity, SESSION_COOKIE, TEST_CONFIG, type TestIdentity} from "./testing/module";

const DAY_MS = 86_400_000;

let identity: TestIdentity | undefined;
let bareRoot: TestDbRoot | undefined;

afterEach(async () => {
    await identity?.root.cleanup();
    await bareRoot?.cleanup();
    identity = undefined;
    bareRoot = undefined;
});

/** 一个 `Set-Cookie` 的属性，名字小写；没有值的属性（`HttpOnly`）值为空串。 */
function cookieAttributes(setCookie: string): Map<string, string> {
    const [, ...parts] = setCookie.split(";");
    return new Map(
        parts.map((part) => {
            const [name, ...value] = part.trim().split("=");
            return [name!.toLowerCase(), value.join("=")] as const;
        }),
    );
}

describe("只供服务端调用的端点", () => {
    it("经库的 handler 都是 404，到不了处理函数", async () => {
        identity = await createTestIdentity("identity-auth-server-only");
        const userId = await identity.addUser("alice");
        for (const [path, body] of [
            ["/nb-session/issue", {userId, userAgent: null}],
            ["/nb-session/cookie", {token: "x"}],
            ["/nb-session/clear", {}],
        ] as const) {
            const response = await identity.assembly.auth.handler(
                new Request(`${TEST_SITE_URL}${LIB_BASE_PATH}${path}`, {method: "POST", headers: {origin: TEST_SITE_URL, "content-type": "application/json"}, body: JSON.stringify(body)}),
            );
            expect(response.status).toBe(404);
            expect(response.headers.getSetCookie()).toEqual([]);
        }
        expect(await identity.conn.read((tx) => tx.query(`SELECT count(*) AS n FROM "session"`).get())).toEqual({n: 0});
    });
});

describe("发会话", () => {
    it("Cookie 的名字与属性照输出 5；会话行的时间取模块的时钟，来源地址与空的浏览器标识存成空", async () => {
        const start = Date.UTC(2026, 0, 1, 12, 0, 0, 7);
        identity = await createTestIdentity("identity-auth-issue", {start});
        const userId = await identity.addUser("alice");
        const {setCookies, sessionId} = await identity.issue(userId);

        expect(setCookies).toHaveLength(1);
        const attributes = cookieAttributes(setCookies[0]!);
        expect(setCookies[0]!.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
        expect(attributes.has("httponly")).toBe(true);
        expect(attributes.has("secure")).toBe(true);
        expect(attributes.get("samesite")?.toLowerCase()).toBe("lax");
        expect(attributes.get("path")).toBe("/");
        expect(attributes.get("max-age")).toBe(String(30 * 86_400));
        expect(attributes.has("domain")).toBe(false);

        expect(await identity.sessionRow(sessionId)).toMatchObject({
            userId,
            createdAt: new Date(start).toISOString(),
            updatedAt: new Date(start).toISOString(),
            expiresAt: new Date(start + 30 * DAY_MS).toISOString(),
            ipAddress: null,
            userAgent: null,
        });
    });

    it("给了浏览器标识的概要时原样存", async () => {
        identity = await createTestIdentity("identity-auth-issue-agent");
        const userId = await identity.addUser("alice");
        const summary = JSON.stringify({browser: "Firefox", os: "Linux"});
        const {sessionId} = await identity.issue(userId, summary);
        expect(await identity.sessionRow(sessionId)).toMatchObject({userAgent: summary});
    });
});

describe("库读会话", () => {
    it("直接删掉会话行之后，库的 getSession 立即读不到（库没有会话缓存）", async () => {
        identity = await createTestIdentity("identity-auth-no-cache");
        const userId = await identity.addUser("alice");
        const {cookie, sessionId} = await identity.issue(userId);
        const auth = identity.assembly.auth;
        expect(await auth.api.getSession({headers: new Headers({cookie})})).not.toBeNull();

        await identity.conn.write((tx) => tx.query(`DELETE FROM "session" WHERE "id" = ?`).run(sessionId));
        expect(await auth.api.getSession({headers: new Headers({cookie})})).toBeNull();
    });
});

describe("经库的 handler 的错误", () => {
    it("撞写锁的数据库错误从 handler 抛出，进程的标准错误为空", async () => {
        const child = Bun.spawn([process.execPath, join(import.meta.dir, "testing/handler-under-lock.ts")], {stdout: "pipe", stderr: "pipe"});
        try {
            const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
            expect({exitCode, stderr}).toEqual({exitCode: 0, stderr: ""});
            expect(JSON.parse(stdout)).toEqual({thrown: true, unavailable: true});
        } finally {
            child.kill();
        }
    });
});

describe("结构检查", () => {
    it("库的表少了一列时建模块失败，错误码是库的 SCHEMA_MISMATCH", async () => {
        bareRoot = await createTestDbRoot("identity-auth-schema");
        const db = bareRoot.open();
        db.exec(`ALTER TABLE "session" DROP COLUMN "impersonatedBy"`);
        const created = createIdentityModule({
            db,
            config: TEST_CONFIG,
            siteUrl: TEST_SITE_URL,
            log: recordingLog(),
            clock: {now: () => Date.now()},
            jobs: {register: () => undefined},
            clientAddress: () => null,
        });
        await expect(created).rejects.toMatchObject({code: "SCHEMA_MISMATCH"});
    });
});

describe("库碰密码时用模块的哈希", () => {
    it("库上下文里的哈希写出模块的格式，校验认得模块写的哈希", async () => {
        identity = await createTestIdentity("identity-auth-password");
        const {password} = await identity.assembly.auth.$context;
        const written = await password.hash("library-PW-123456");
        expect(written).toStartWith("$argon2id$");
        expect(await verifyPassword("library-PW-123456", written, {accountId: 0, log: identity.log})).toBe(true);
        expect(await password.verify({hash: await hashPassword("module-PW-123456"), password: "module-PW-123456"})).toBe(true);
        expect(await password.verify({hash: written, password: "other-PW-123456"})).toBe(false);
    });
});
