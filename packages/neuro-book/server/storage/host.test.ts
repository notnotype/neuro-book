import {mkdtemp, readFile, rm, mkdir, rename, writeFile} from "node:fs/promises";
import path from "node:path";
import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {createApp, createError, defineEventHandler, toWebHandler} from "h3";
import {afterEach, describe, expect, it, vi} from "vitest";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {storageIdentityFilePath} from "nbook/server/storage/storage-address";
import {STORAGE_ACCESS_CONTEXT_HEADER, STORAGE_CLIENT_CREDENTIAL_HEADER} from "nbook/shared/storage/host";

const CONTEXT_PATH = "/api/storage/user/context";
const RESOLVE_PATH = "/api/storage/test/resolve";
const CLIENT_A = "a".repeat(64);
const CLIENT_B = "b".repeat(64);

const roots: string[] = [];

afterEach(async () => {
    await (await import("nbook/server/storage/host")).disposeStorageHost();
    vi.doUnmock("nbook/server/utils/auth");
    vi.unstubAllGlobals();
    vi.resetModules();
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

type AuthStub = {
    readonly enabled: boolean;
    userId?: number;
    sessionId?: string;
    waitForUser?: () => Promise<void>;
    waitForSession?: () => Promise<void>;
};

type HostFixtureOptions = {
    readonly auth?: AuthStub;
    readonly subject?: {current: string};
};

/**
 * 以隔离存储根与可控鉴权建立真实路由的 HTTP 宿主；不接触机器默认 data。
 *
 * 主机模块必须按用例在 `vi.doMock` 之后重新加载：静态导入会在 mock 注册前绑定真实鉴权模块，
 * 因此这里刻意使用动态导入。
 */
async function createHostFixture(options: HostFixtureOptions = {}) {
    vi.resetModules();
    vi.doUnmock("nbook/server/utils/auth");
    const auth = options.auth;
    if (auth !== undefined) {
        vi.doMock("nbook/server/utils/auth", () => ({
            isAuthEnabled: () => auth.enabled,
            requireCurrentUser: async () => {
                await auth.waitForUser?.();
                if (auth.userId === undefined) throw createError({statusCode: 401, message: "请先登录"});
                return {id: auth.userId};
            },
            requireCurrentAuthSessionId: async () => {
                await auth.waitForSession?.();
                if (auth.sessionId === undefined) throw createError({statusCode: 401, message: "请先登录"});
                return auth.sessionId;
            },
        }));
    }
    vi.stubGlobal("defineEventHandler", defineEventHandler);
    const scratch = await mkdtemp(testHostPath("nbook-storage-host-"));
    roots.push(scratch);
    const root = absoluteFsPath(path.join(scratch, "storage"));
    const host = await import("nbook/server/storage/host");
    const subject = options.subject;
    await host.setStorageHostContextForTest({
        storageRoot: root,
        resolveSubject: subject === undefined ? undefined : () => subject.current,
    });
    const issue = (await import("nbook/server/api/storage/user/context.post")).default;
    const release = (await import("nbook/server/api/storage/user/context.delete")).default;
    const httpError = await import("nbook/server/storage/http-error");
    const app = createApp();
    app.use(CONTEXT_PATH, defineEventHandler(async (event) => {
        if (event.method === "POST") return await issue(event);
        if (event.method === "DELETE") return await release(event);
        throw createError({statusCode: 405, message: "仅支持 POST 与 DELETE"});
    }));
    app.use(RESOLVE_PATH, defineEventHandler((event) => httpError.withStorageHttpError(async () => {
        const context = await host.resolveStorageAccessContext(event);
        return {
            contextId: context.contextId,
            subject: context.subject,
            identityDomain: context.identityDomain,
            storageRoot: context.storageRoot,
        };
    })));
    return {host, root, send: toWebHandler(app)};
}

function headers(input: {readonly credential?: string; readonly contextId?: string}): Record<string, string> {
    return {
        ...(input.credential === undefined ? {} : {[STORAGE_CLIENT_CREDENTIAL_HEADER]: input.credential}),
        ...(input.contextId === undefined ? {} : {[STORAGE_ACCESS_CONTEXT_HEADER]: input.contextId}),
    };
}

async function issueContext(send: (request: Request) => Promise<Response>, credential = CLIENT_A): Promise<string> {
    const response = await send(new Request(`http://localhost${CONTEXT_PATH}`, {method: "POST", headers: headers({credential})}));
    const body = await response.json() as {contextId?: string};
    if (response.status !== 200 || typeof body.contextId !== "string") {
        throw new Error(`初始化未返回上下文：${String(response.status)} ${JSON.stringify(body)}`);
    }
    return body.contextId;
}

async function resolveContext(
    send: (request: Request) => Promise<Response>,
    contextId: string,
    credential = CLIENT_A,
): Promise<Response> {
    return await send(new Request(`http://localhost${RESOLVE_PATH}`, {headers: headers({credential, contextId})}));
}

describe("user 访问上下文 HTTP 接线", () => {
    it("初始化只创建身份域元数据，同一客户端的每次初始化是独立访问", async () => {
        const fixture = await createHostFixture({auth: {enabled: false}});
        const first = await issueContext(fixture.send);
        expect(first).toMatch(/^[0-9a-f]{64}$/u);
        const second = await issueContext(fixture.send);
        expect(second).not.toBe(first);

        // 客户端身份收敛不等于访问生命周期共享：释放一个标签页的访问不撤销另一个。
        const released = await fixture.send(new Request(`http://localhost${CONTEXT_PATH}`, {
            method: "DELETE",
            headers: headers({credential: CLIENT_A, contextId: first}),
        }));
        await expect(released.json()).resolves.toEqual({released: true});
        expect((await resolveContext(fixture.send, second)).status).toBe(200);

        const identity = JSON.parse(await readFile(storageIdentityFilePath(fixture.root), "utf8")) as {identityDomain: string};
        expect(identity.identityDomain).toMatch(/^[0-9a-f-]{36}$/u);
    });

    it("缺少或非法定位凭证以 400 拒绝且不创建身份元数据", async () => {
        const fixture = await createHostFixture({auth: {enabled: false}});
        const missing = await fixture.send(new Request(`http://localhost${CONTEXT_PATH}`, {method: "POST"}));
        expect(missing.status).toBe(400);
        await expect(missing.json()).resolves.toMatchObject({
            data: {code: "STORAGE_CLIENT_CREDENTIAL_INVALID", reason: "missing"},
        });

        const malformed = await fixture.send(new Request(`http://localhost${CONTEXT_PATH}`, {
            method: "POST",
            headers: headers({credential: "not-a-credential"}),
        }));
        expect(malformed.status).toBe(400);
        await expect(malformed.json()).resolves.toMatchObject({
            data: {code: "STORAGE_CLIENT_CREDENTIAL_INVALID", reason: "malformed"},
        });

        await expect(readFile(storageIdentityFilePath(fixture.root), "utf8")).rejects.toThrow();
    });

    it("不同客户端凭证与不同主体各自独立，跨主体或跨凭证核验被拒绝", async () => {
        const subject = {current: "user:7"};
        const fixture = await createHostFixture({subject});
        const forA = await issueContext(fixture.send, CLIENT_A);
        const forB = await issueContext(fixture.send, CLIENT_B);
        expect(forB).not.toBe(forA);

        const resolved = await resolveContext(fixture.send, forA);
        expect(resolved.status).toBe(200);
        await expect(resolved.json()).resolves.toMatchObject({contextId: forA, subject: "user:7"});

        const stolen = await resolveContext(fixture.send, forA, CLIENT_B);
        expect(stolen.status).toBe(403);
        await expect(stolen.json()).resolves.toMatchObject({
            data: {code: "STORAGE_CONTEXT_INVALID", reason: "claims-mismatch"},
        });

        subject.current = "user:8";
        const swapped = await resolveContext(fixture.send, forA);
        expect(swapped.status).toBe(403);
        await expect(swapped.json()).resolves.toMatchObject({data: {code: "STORAGE_CONTEXT_INVALID"}});
    });

    it("请求 body 不能自报主体、客户端、身份域或存储根", async () => {
        const fixture = await createHostFixture({auth: {enabled: false}});
        const issued = await fixture.send(new Request(`http://localhost${CONTEXT_PATH}`, {
            method: "POST",
            headers: {...headers({credential: CLIENT_A}), "content-type": "application/json"},
            body: JSON.stringify({
                subject: "user:999",
                clientId: CLIENT_B,
                identityDomain: "22222222-2222-4222-8222-222222222222",
                storageRoot: process.platform === "win32" ? "C:\\elsewhere" : "/elsewhere",
            }),
        }));
        const {contextId} = await issued.json() as {contextId: string};
        const resolved = await resolveContext(fixture.send, contextId);
        expect(resolved.status).toBe(200);

        const body = await resolved.json() as {subject: string; identityDomain: string; storageRoot: string};
        expect(body.subject).toMatch(/^local:/u);
        expect(body.storageRoot).toBe(fixture.root);
        const identity = JSON.parse(await readFile(storageIdentityFilePath(fixture.root), "utf8")) as {identityDomain: string};
        expect(body.identityDomain).toBe(identity.identityDomain);
    });

    it("data 身份域被替换后旧上下文不能继续解析", async () => {
        const fixture = await createHostFixture({auth: {enabled: false}});
        const contextId = await issueContext(fixture.send);
        await rm(storageIdentityFilePath(fixture.root), {force: true});

        const response = await resolveContext(fixture.send, contextId);
        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toMatchObject({data: {code: "STORAGE_CONTEXT_INVALID"}});
    });

    it("释放只作用于自己的上下文、重复释放幂等，释放后不能继续解析", async () => {
        const fixture = await createHostFixture({auth: {enabled: false}});
        const contextId = await issueContext(fixture.send);

        const otherClient = await fixture.send(new Request(`http://localhost${CONTEXT_PATH}`, {
            method: "DELETE",
            headers: headers({credential: CLIENT_B, contextId}),
        }));
        expect(otherClient.status).toBe(403);

        const released = await fixture.send(new Request(`http://localhost${CONTEXT_PATH}`, {
            method: "DELETE",
            headers: headers({credential: CLIENT_A, contextId}),
        }));
        await expect(released.json()).resolves.toEqual({released: true});

        const repeated = await fixture.send(new Request(`http://localhost${CONTEXT_PATH}`, {
            method: "DELETE",
            headers: headers({credential: CLIENT_A, contextId}),
        }));
        await expect(repeated.json()).resolves.toEqual({released: false});

        const afterRelease = await resolveContext(fixture.send, contextId);
        expect(afterRelease.status).toBe(403);
    });

    it("同路径新目录即使复制原身份文件，旧访问仍失效", async () => {
        const fixture = await createHostFixture({auth: {enabled: false}});
        const contextId = await issueContext(fixture.send);
        const original = await readFile(storageIdentityFilePath(fixture.root));
        await rename(fixture.root, `${fixture.root}-old`);
        await mkdir(fixture.root);
        await writeFile(storageIdentityFilePath(fixture.root), original);
        expect((await resolveContext(fixture.send, contextId)).status).toBe(403);
        expect((await resolveContext(fixture.send, await issueContext(fixture.send))).status).toBe(200);
    });

    it("关闭排空在途鉴权并拒绝后续请求，不创建身份目录", async () => {
        const fixture = await createHostFixture({subject: {current: "user:7"}});
        const entered = Promise.withResolvers<void>();
        const gate = Promise.withResolvers<string>();
        await fixture.host.setStorageHostContextForTest({storageRoot: fixture.root, resolveSubject: () => {
            entered.resolve();
            return gate.promise;
        }});
        const pending = fixture.send(new Request(`http://localhost${CONTEXT_PATH}`, {method: "POST", headers: headers({credential: CLIENT_A})}));
        await entered.promise;
        const closing = fixture.host.disposeStorageHost();
        expect(fixture.host.disposeStorageHost()).toBe(closing);
        let closed = false;
        void closing.then(() => {closed = true;});
        await Promise.resolve();
        expect(closed).toBe(false);
        gate.resolve("user:7");
        expect((await pending).status).toBe(503);
        await closing;
        await expect(readFile(storageIdentityFilePath(fixture.root))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("退出撤销旧 session：同主体同凭证切回也不能恢复访问", async () => {
        const auth: AuthStub = {enabled: true, userId: 7, sessionId: "session-a"};
        const fixture = await createHostFixture({auth});
        const old = await issueContext(fixture.send);
        fixture.host.revokeStorageAuthSession("session-a");
        expect((await resolveContext(fixture.send, old)).status).toBe(403);
        auth.sessionId = "session-b";
        expect((await resolveContext(fixture.send, await issueContext(fixture.send))).status).toBe(200);
        auth.sessionId = "session-a";
        expect((await resolveContext(fixture.send, old)).status).toBe(403);
    });

    it.each([
        {phase: "user", revokedSession: "session-a"}, {phase: "user", revokedSession: "other-session"},
        {phase: "cookie", revokedSession: "session-a"}, {phase: "cookie", revokedSession: "other-session"},
    ])("在途 $phase 核验只受自己 session 撤销影响：$revokedSession", async ({phase, revokedSession}) => {
        const entered = Promise.withResolvers<void>();
        const gate = Promise.withResolvers<void>();
        const wait = () => {
            entered.resolve(); return gate.promise;
        };
        const fixture = await createHostFixture({auth: {enabled: true, userId: 7, sessionId: "session-a",
            ...(phase === "user" ? {waitForUser: wait} : {waitForSession: wait}),
        }});
        const pending = fixture.send(new Request(`http://localhost${CONTEXT_PATH}`, {method: "POST", headers: headers({credential: CLIENT_A})}));
        await entered.promise;
        fixture.host.revokeStorageAuthSession(revokedSession);
        gate.resolve();
        const result = await pending;
        if (revokedSession !== "session-a") {
            expect(result.status).toBe(200);
            return;
        }
        expect(result.status).toBe(403);
        await expect(result.json()).resolves.toMatchObject({data: {reason: "auth-changed"}});
        await expect(readFile(storageIdentityFilePath(fixture.root))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("产品关闭后不再签发或核验", async () => {
        const fixture = await createHostFixture({auth: {enabled: false}});
        const contextId = await issueContext(fixture.send);
        await fixture.host.disposeStorageHost();
        await fixture.host.disposeStorageHost();

        const issue = await fixture.send(new Request(`http://localhost${CONTEXT_PATH}`, {
            method: "POST",
            headers: headers({credential: CLIENT_A}),
        }));
        expect(issue.status).toBe(503);
        await expect(issue.json()).resolves.toMatchObject({data: {code: "STORAGE_SERVICE_CLOSED"}});

        const resolve = await resolveContext(fixture.send, contextId);
        expect(resolve.status).toBe(503);
        await expect(resolve.json()).resolves.toMatchObject({data: {code: "STORAGE_SERVICE_CLOSED"}});
    });

    it("鉴权开启时按当前 session 用户签发，换账号或 session 失效后不能再访问", async () => {
        const auth: AuthStub = {enabled: true, userId: 7, sessionId: "session-a"};
        const fixture = await createHostFixture({auth});
        const contextId = await issueContext(fixture.send);
        await expect((await resolveContext(fixture.send, contextId)).json()).resolves.toMatchObject({subject: "user:7"});

        auth.userId = 8;
        const swapped = await resolveContext(fixture.send, contextId);
        expect(swapped.status).toBe(403);
        const forOtherUser = await issueContext(fixture.send);
        expect(forOtherUser).not.toBe(contextId);
        await expect((await resolveContext(fixture.send, forOtherUser)).json()).resolves.toMatchObject({subject: "user:8"});

        auth.userId = undefined;
        const expired = await fixture.send(new Request(`http://localhost${CONTEXT_PATH}`, {
            method: "POST",
            headers: headers({credential: CLIENT_A}),
        }));
        expect(expired.status).toBe(401);
    });

    it("同一用户重新登录（新 session）后旧访问不能复活", async () => {
        const auth: AuthStub = {enabled: true, userId: 7, sessionId: "session-a"};
        const fixture = await createHostFixture({auth});
        const contextId = await issueContext(fixture.send);
        expect((await resolveContext(fixture.send, contextId)).status).toBe(200);

        // 登出再登录换 session，但用户编号相同：旧访问上下文不能因此继续有效。
        auth.sessionId = "session-b";
        const relogged = await resolveContext(fixture.send, contextId);
        expect(relogged.status).toBe(403);
        await expect(relogged.json()).resolves.toMatchObject({
            data: {code: "STORAGE_CONTEXT_INVALID", reason: "claims-mismatch"},
        });
        const reissued = await issueContext(fixture.send);
        expect(reissued).not.toBe(contextId);
        expect((await resolveContext(fixture.send, reissued)).status).toBe(200);
    });

    it("鉴权关闭时使用跟随 data 身份域的本地主体，独立 data 得到不同主体", async () => {
        const first = await createHostFixture({auth: {enabled: false}});
        const firstContext = await issueContext(first.send);
        const firstBody = await (await resolveContext(first.send, firstContext)).json() as {subject: string; identityDomain: string};
        expect(firstBody.subject).toBe(`local:${firstBody.identityDomain}`);

        const second = await createHostFixture({auth: {enabled: false}});
        const secondBody = await (await resolveContext(second.send, await issueContext(second.send))).json() as {subject: string};
        expect(secondBody.subject).not.toBe(firstBody.subject);
    });
});
