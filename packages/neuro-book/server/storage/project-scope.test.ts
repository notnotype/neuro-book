import {randomUUID} from "node:crypto";
import {mkdir, readdir, readFile, rm, stat, writeFile} from "node:fs/promises";
import {createServer} from "node:http";
import path from "node:path";
import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {createApp, createError, defineEventHandler, toNodeListener} from "h3";
import {lock as acquireFileLock} from "proper-lockfile";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import type {StoragePartitionBinding} from "nbook/shared/storage/contract";
import {defineStorageState} from "nbook/shared/storage/definition";
import {STORAGE_ACCESS_CONTEXT_HEADER, STORAGE_CLIENT_CREDENTIAL_HEADER} from "nbook/shared/storage/host";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {deriveStorageClientId} from "nbook/server/storage/access-context";
import {disposeStorageHost, setStorageHostContextForTest} from "nbook/server/storage/host";
import {
    projectStorageRootFromProjectRoot,
    storageIdentityFilePath,
    storagePartitionPaths,
    storageRecordFileName,
    userStorageRootFromWorkspaceRoot,
} from "nbook/server/storage/storage-address";
import type {StorageLockAdapter} from "nbook/server/storage/partition-lock";
import {projectWorkspaceRef, type ProjectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import {
    closeAllProjects,
    closeProject,
    openProject,
    resetProjectSessionsForTest,
} from "nbook/server/workspace-files/project-session";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {writeProjectManifest} from "nbook/server/workspace-files/project-workspace";
import {setWorkspaceRuntimeRootContextForTest} from "nbook/server/workspace-files/workspace-runtime-root";

const PROJECT_STATE = defineStorageState<{readonly width: number}>({
    owner: "test.project",
    key: "layout",
    scope: "project",
    records: "single",
    schemaVersion: 1,
    defaultValue: {width: 320},
    validate: (value): value is {readonly width: number} => typeof value === "object" && value !== null
        && typeof (value as {readonly width?: unknown}).width === "number",
});

const PROJECT_CONTEXT_PATH = "/api/storage/project/context";
const PROJECT_ACTION_PATH = "/api/storage/project/action";
const USER_CONTEXT_PATH = "/api/storage/user/context";
const USER_ACTION_PATH = "/api/storage/user/action";
const CLIENT = "c".repeat(64);
const TEST_SUBJECT = "user:7";

type StorageHttpFixture = {
    readonly origin: string;
    request(target: string, init?: {
        readonly method?: string;
        readonly body?: unknown;
        readonly contextId?: string;
        readonly credential?: string;
    }): Promise<Response>;
    issueProject(projectRoot: string, publicId: string): Promise<string>;
    issueUser(): Promise<string>;
    bindProject(contextId: string, owner: string): Promise<StoragePartitionBinding>;
    actProject(contextId: string, action: unknown): Promise<Response>;
    releaseProject(contextId: string): Promise<Response>;
    close(): Promise<void>;
};

/**
 * 建立真实 Node HTTP + H3 路由 + 隔离 Workspace Root 的 Storage project 宿主。
 *
 * 路由模块必须在 `defineEventHandler` 全局就位后才加载（与产品自动导入一致），因此这里用动态导入。
 */
async function createStorageHttpFixture(): Promise<StorageHttpFixture> {
    const globalForRoutes = globalThis as typeof globalThis & {defineEventHandler?: typeof defineEventHandler};
    globalForRoutes.defineEventHandler ??= defineEventHandler;
    const [projectContext, projectAction, userContext, userAction, userContextDelete] = await Promise.all([
        Promise.all([
            import("nbook/server/api/storage/project/context.post"),
            import("nbook/server/api/storage/project/context.delete"),
        ]),
        import("nbook/server/api/storage/project/action.post"),
        import("nbook/server/api/storage/user/context.post"),
        import("nbook/server/api/storage/user/action.post"),
        import("nbook/server/api/storage/user/context.delete"),
    ]);
    const app = createApp();
    app.use(PROJECT_CONTEXT_PATH, defineEventHandler(async (event) => {
        if (event.method === "POST") return await projectContext[0].default(event);
        if (event.method === "DELETE") return await projectContext[1].default(event);
        throw createError({statusCode: 405, message: "仅支持 POST 与 DELETE"});
    }));
    app.use(PROJECT_ACTION_PATH, defineEventHandler(async (event) => {
        if (event.method !== "POST") throw createError({statusCode: 405, message: "仅支持 POST"});
        return await projectAction.default(event);
    }));
    app.use(USER_CONTEXT_PATH, defineEventHandler(async (event) => {
        if (event.method === "POST") return await userContext.default(event);
        if (event.method === "DELETE") return await userContextDelete.default(event);
        throw createError({statusCode: 405, message: "仅支持 POST 与 DELETE"});
    }));
    app.use(USER_ACTION_PATH, defineEventHandler(async (event) => {
        if (event.method !== "POST") throw createError({statusCode: 405, message: "仅支持 POST"});
        return await userAction.default(event);
    }));
    const server = createServer(toNodeListener(app));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
        throw new Error("Storage project fixture 未监听 TCP 端口");
    }
    const origin = `http://127.0.0.1:${String(address.port)}`;
    const request = async (target: string, init: Parameters<StorageHttpFixture["request"]>[1] = {}): Promise<Response> => {
        const headers: Record<string, string> = {
            [STORAGE_CLIENT_CREDENTIAL_HEADER]: init.credential ?? CLIENT,
            ...(init.contextId === undefined ? {} : {[STORAGE_ACCESS_CONTEXT_HEADER]: init.contextId}),
            ...(init.body === undefined ? {} : {"content-type": "application/json"}),
        };
        return await fetch(`${origin}${target}`, {
            method: init.method ?? "POST",
            headers,
            ...(init.body === undefined ? {} : {body: JSON.stringify(init.body)}),
        });
    };
    const issue = async (target: string, body?: unknown): Promise<string> => {
        const response = await request(target, body === undefined ? {} : {body});
        const parsed = await response.json() as {contextId?: unknown};
        if (response.status !== 200 || typeof parsed.contextId !== "string") {
            throw new Error(`初始化未返回上下文：${String(response.status)} ${JSON.stringify(parsed)}`);
        }
        return parsed.contextId;
    };
    return {
        origin,
        request,
        issueProject: (projectRoot, publicId) => issue(PROJECT_CONTEXT_PATH, {projectRoot, publicId}),
        issueUser: () => issue(USER_CONTEXT_PATH),
        async bindProject(contextId, owner) {
            const response = await request(PROJECT_ACTION_PATH, {contextId, body: {kind: "bind", owner}});
            const parsed = await response.json() as {binding?: StoragePartitionBinding};
            if (response.status !== 200 || parsed.binding === undefined) {
                throw new Error(`绑定未返回分区代次：${String(response.status)} ${JSON.stringify(parsed)}`);
            }
            return parsed.binding;
        },
        actProject: (contextId, action) => request(PROJECT_ACTION_PATH, {contextId, body: action}),
        releaseProject: (contextId) => request(PROJECT_CONTEXT_PATH, {method: "DELETE", contextId}),
        async close() {
            const closed = Promise.withResolvers<void>();
            server.close(() => { closed.resolve(); });
            await closed.promise;
        },
    };
}

describe("project 访问上下文与动作 HTTP 接线", () => {
    let tempRoot: string;
    let workspaceRoot: AbsoluteFsPath;
    let fixture: StorageHttpFixture;

    beforeEach(async () => {
        resetProjectSessionsForTest();
        await setStorageHostContextForTest({
            resolveSubject: () => TEST_SUBJECT,
            definitions: [PROJECT_STATE],
        });
        tempRoot = testHostPath(`nbook-storage-project-${randomUUID()}`);
        workspaceRoot = absoluteFsPath(path.join(tempRoot, "workspace"));
        await mkdir(workspaceRoot, {recursive: true});
        setWorkspaceRuntimeRootContextForTest({workspaceRoot});
        fixture = await createStorageHttpFixture();
    });

    afterEach(async () => {
        await closeAllProjects().catch(() => undefined);
        resetProjectSessionsForTest();
        await disposeStorageHost();
        await fixture.close();
        setWorkspaceRuntimeRootContextForTest(null);
        collectReleasedSqliteHandles({force: true});
        await rm(tempRoot, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
    }, 90_000);

    async function createProjectForTest(projectRoot: string): Promise<ProjectWorkspaceRef> {
        const ref = projectWorkspaceRef(projectRoot);
        await writeProjectManifest(workspaceRoot, ref, {kind: "novel", title: projectRoot, summary: ""});
        return ref;
    }

    function readAction(binding: StoragePartitionBinding): unknown {
        return {kind: "read", owner: PROJECT_STATE.owner, key: PROJECT_STATE.key, schemaVersion: 1, binding};
    }

    /** 记录文件地址来自声明的寻址规则，用直接读盘证据证明隔离与写入结果。 */
    async function recordFile(
        project: {readonly root: AbsoluteFsPath},
        clientCredential = CLIENT,
    ): Promise<AbsoluteFsPath> {
        const identityDomain = JSON.parse(
            await readFile(storageIdentityFilePath(absoluteFsPath(path.join(workspaceRoot, ".nbook", "storage"))), "utf8"),
        ) as {identityDomain: string};
        const partition = storagePartitionPaths({
            storageRoot: projectStorageRootFromProjectRoot(project.root),
            identityDomain: identityDomain.identityDomain,
            subject: TEST_SUBJECT,
            locality: "local",
            clientId: deriveStorageClientId(clientCredential),
            owner: PROJECT_STATE.owner,
        });
        return absoluteFsPath(path.join(partition.recordsDirectory, storageRecordFileName(PROJECT_STATE.key)));
    }

    it("context→bind→缺失读取→CAS save→重读→release，两个 Project 互不可见", async () => {
        const alpha = await createProjectForTest("alpha");
        const beta = await createProjectForTest("beta");
        const alphaReady = await openProject(alpha, {kind: "user"}, workspaceRoot);
        const betaReady = await openProject(beta, {kind: "user"}, workspaceRoot);
        const alphaRoot = projectStorageRootFromProjectRoot(alphaReady.workspace.root);

        // 普通 open 不激活 Storage：建根只发生在显式签发访问时。
        await expect(stat(alphaRoot)).rejects.toMatchObject({code: "ENOENT"});
        await expect(stat(absoluteFsPath(path.join(workspaceRoot, ".nbook", "storage", "identity.json"))))
            .rejects.toMatchObject({code: "ENOENT"});

        const alphaContext = await fixture.issueProject("alpha", alphaReady.publicId);
        const alphaBinding = await fixture.bindProject(alphaContext, PROJECT_STATE.owner);
        const missing = await fixture.actProject(alphaContext, readAction(alphaBinding));
        expect(missing.status).toBe(200);
        const missingResult = (await missing.json() as {result: {kind: string; credential: unknown}}).result;
        expect(missingResult.kind).toBe("missing");

        const saved = await fixture.actProject(alphaContext, {
            kind: "save",
            owner: PROJECT_STATE.owner,
            key: PROJECT_STATE.key,
            schemaVersion: 1,
            binding: alphaBinding,
            expected: missingResult.credential,
            value: {width: 480},
        });
        expect(saved.status).toBe(200);

        const reloaded = await fixture.actProject(alphaContext, readAction(alphaBinding));
        await expect(reloaded.json()).resolves.toMatchObject({result: {kind: "value", value: {width: 480}}});

        // 同 data、同主体、同客户端的另一个 Project 是独立分区：同名键读不到别人的记录。
        const betaContext = await fixture.issueProject("beta", betaReady.publicId);
        const betaBinding = await fixture.bindProject(betaContext, PROJECT_STATE.owner);
        await expect((await fixture.actProject(betaContext, readAction(betaBinding))).json())
            .resolves.toMatchObject({result: {kind: "missing"}});
        await expect(readFile(await recordFile(alphaReady.workspace), "utf8")).resolves.toContain("480");
        await expect(readFile(await recordFile(betaReady.workspace), "utf8")).rejects.toMatchObject({code: "ENOENT"});

        await expect((await fixture.releaseProject(alphaContext)).json()).resolves.toEqual({released: true});
        await expect((await fixture.releaseProject(alphaContext)).json()).resolves.toEqual({released: false});
        expect((await fixture.actProject(alphaContext, readAction(alphaBinding))).status).toBe(403);
    }, 90_000);

    it("未 open、缺标识、同根旧 publicId 与 user/project 混用都拒绝且不建根", async () => {
        const alpha = await createProjectForTest("alpha");
        const beta = await createProjectForTest("beta");
        const alphaReady = await openProject(alpha, {kind: "user"}, workspaceRoot);

        const unopened = await fixture.request(PROJECT_CONTEXT_PATH, {
            body: {projectRoot: "beta", publicId: alphaReady.publicId},
        });
        expect(unopened.status).toBe(409);
        await expect(unopened.json()).resolves.toMatchObject({data: {code: "PROJECT_NOT_OPEN"}});

        const malformed = await fixture.request(PROJECT_CONTEXT_PATH, {body: {projectRoot: "alpha"}});
        expect(malformed.status).toBe(400);
        await expect(malformed.json()).resolves.toMatchObject({data: {code: "STORAGE_REQUEST_INVALID"}});

        const selfReported = await fixture.request(PROJECT_CONTEXT_PATH, {
            body: {projectRoot: "alpha", publicId: alphaReady.publicId, subject: "user:999", storageRoot: "/elsewhere"},
        });
        expect(selfReported.status).toBe(400);

        const context = await fixture.issueProject("alpha", alphaReady.publicId);
        const userContext = await fixture.issueUser();
        // 两侧都不接受对方 scope 的上下文：project 访问不能借 user 分区，user 请求也不能驱动 project 目录。
        expect((await fixture.request(USER_ACTION_PATH, {
            contextId: context,
            body: {kind: "bind", owner: PROJECT_STATE.owner},
        })).status).toBe(403);
        expect((await fixture.actProject(userContext, {kind: "bind", owner: PROJECT_STATE.owner})).status).toBe(403);

        // 闭后重开：同根旧 publicId 不接纳，且拒绝不会递归 mkdir 重建已经删除的 Storage 根。
        const storageRoot = projectStorageRootFromProjectRoot(alphaReady.workspace.root);
        await closeProject(alpha, "shutdown");
        await rm(storageRoot, {recursive: true, force: true});
        const reopened = await openProject(alpha, {kind: "user"}, workspaceRoot);
        expect(reopened.publicId).not.toBe(alphaReady.publicId);

        expect((await fixture.request(PROJECT_CONTEXT_PATH, {
            body: {projectRoot: "alpha", publicId: alphaReady.publicId},
        })).status).toBe(409);
        await expect(stat(storageRoot)).rejects.toMatchObject({code: "ENOENT"});
        // 关闭时 lazy Module 主动失效旧上下文：同一份 contextId 在重开后不写新代次。
        expect((await fixture.actProject(context, {kind: "bind", owner: PROJECT_STATE.owner})).status).toBe(403);
        await expect(fixture.issueProject("alpha", reopened.publicId)).resolves.toMatch(/^[0-9a-f]{64}$/u);
    }, 90_000);

    it("Project Storage 根被同路径替换后旧上下文在副作用前失败，不重建记录", async () => {
        const alpha = await createProjectForTest("alpha");
        const ready = await openProject(alpha, {kind: "user"}, workspaceRoot);
        const context = await fixture.issueProject("alpha", ready.publicId);
        const binding = await fixture.bindProject(context, PROJECT_STATE.owner);
        const initial = await fixture.actProject(context, readAction(binding));
        const credential = (await initial.json() as {result: {credential: unknown}}).result.credential;
        const storageRoot = projectStorageRootFromProjectRoot(ready.workspace.root);

        // 真实替换：删除已签发的存储根，再在同路径放回一个全新的目录（新设备/编号/创建时刻）。
        await rm(storageRoot, {recursive: true, force: true, maxRetries: 10, retryDelay: 50});
        await mkdir(storageRoot);

        const replaced = await fixture.actProject(context, {
            kind: "save",
            owner: PROJECT_STATE.owner,
            key: PROJECT_STATE.key,
            schemaVersion: 1,
            binding,
            expected: credential,
            value: {width: 1},
        });
        expect(replaced.status).toBe(403);
        await expect(replaced.json()).resolves.toMatchObject({
            data: {code: "STORAGE_CONTEXT_INVALID", reason: "claims-mismatch"},
        });
        // 拒绝发生在副作用之前：被替换的新根本身保持为空，没有任何分区或记录被写进去。
        await expect(readdir(storageRoot)).resolves.toEqual([]);
    }, 90_000);

    it("已接纳的保存先收口，普通关闭随后才失效上下文", async () => {
        // 只在受控窗口内卡住句柄打开：bind 与读取先正常完成，闸门只拦本次已接纳的保存。
        let armed = false;
        const entered = Promise.withResolvers<void>();
        const gate = Promise.withResolvers<void>();
        await setStorageHostContextForTest({
            resolveSubject: () => TEST_SUBJECT,
            definitions: [PROJECT_STATE],
            openHandle: async (input, service) => {
                if (armed) {
                    entered.resolve();
                    await gate.promise;
                }
                return await service.openHandle(input);
            },
        });

        const alpha = await createProjectForTest("alpha");
        const ready = await openProject(alpha, {kind: "user"}, workspaceRoot);
        const context = await fixture.issueProject("alpha", ready.publicId);
        const binding = await fixture.bindProject(context, PROJECT_STATE.owner);
        const initial = await fixture.actProject(context, readAction(binding));
        const credential = (await initial.json() as {result: {credential: unknown}}).result.credential;

        armed = true;
        const saving = fixture.actProject(context, {
            kind: "save",
            owner: PROJECT_STATE.owner,
            key: PROJECT_STATE.key,
            schemaVersion: 1,
            binding,
            expected: credential,
            value: {width: 512},
        });
        await entered.promise;

        let closed = false;
        const closing = closeProject(alpha, "user").then(() => { closed = true; });
        await new Promise<void>((resolve) => { setImmediate(resolve); });
        // 关闭必须先等已接纳的保存 settle，再关 lazy Module 与 Occupancy。
        expect(closed).toBe(false);

        gate.resolve();
        expect((await saving).status).toBe(200);
        await closing;
        expect(closed).toBe(true);
        await expect(readFile(await recordFile(ready.workspace), "utf8")).resolves.toContain("512");
        // Module close 主动失效本 scope 的访问：关闭后的迟到请求不再写盘。
        expect((await fixture.actProject(context, readAction(binding))).status).toBe(403);
    }, 90_000);

    it("本标签 release 只释放自己的上下文，另一个标签的访问继续可用", async () => {
        const alpha = await createProjectForTest("alpha");
        const ready = await openProject(alpha, {kind: "user"}, workspaceRoot);
        const first = await fixture.issueProject("alpha", ready.publicId);
        const second = await fixture.issueProject("alpha", ready.publicId);
        expect(second).not.toBe(first);

        await expect((await fixture.releaseProject(first)).json()).resolves.toEqual({released: true});
        const binding = await fixture.bindProject(second, PROJECT_STATE.owner);
        expect((await fixture.actProject(second, readAction(binding))).status).toBe(200);
    }, 90_000);

    it("user 释放不接受 project 上下文，也不静默撤销它", async () => {
        const alpha = await createProjectForTest("alpha");
        const ready = await openProject(alpha, {kind: "user"}, workspaceRoot);
        const context = await fixture.issueProject("alpha", ready.publicId);

        // user 释放只比主体与客户端，挡不住同主体同客户端的 project 上下文；这里必须按 scope 拒绝。
        const response = await fixture.request(USER_CONTEXT_PATH, {method: "DELETE", contextId: context});
        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toMatchObject({data: {code: "STORAGE_CONTEXT_INVALID"}});
        // 拒绝不是撤销：被拒绝的 project 访问仍然可用。
        expect((await fixture.actProject(context, {kind: "bind", owner: PROJECT_STATE.owner})).status).toBe(200);
    }, 90_000);

    it("data 物理根被同路径重建后旧 project 上下文在副作用前拒绝", async () => {
        const alpha = await createProjectForTest("alpha");
        const ready = await openProject(alpha, {kind: "user"}, workspaceRoot);
        const context = await fixture.issueProject("alpha", ready.publicId);
        const binding = await fixture.bindProject(context, PROJECT_STATE.owner);
        const dataRoot = userStorageRootFromWorkspaceRoot(workspaceRoot);
        const identityBytes = await readFile(storageIdentityFilePath(dataRoot));

        // 复制同一份 identity.json 重建 data 根：身份域字符串相同，物理目录已不是签发时的那个。
        await rm(dataRoot, {recursive: true, force: true, maxRetries: 10, retryDelay: 50});
        await mkdir(dataRoot);
        await writeFile(storageIdentityFilePath(dataRoot), identityBytes);

        const response = await fixture.actProject(context, readAction(binding));
        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toMatchObject({
            data: {code: "STORAGE_CONTEXT_INVALID", reason: "claims-mismatch"},
        });
    }, 90_000);

    it("等 Storage 锁期间重建 data 物理根：已接纳保存停在真实副作用前，原记录字节不变", async () => {
        let armed = false;
        const entered = Promise.withResolvers<void>();
        const gate = Promise.withResolvers<void>();
        await setStorageHostContextForTest({
            resolveSubject: () => TEST_SUBJECT,
            definitions: [PROJECT_STATE],
            lockAdapter: {
                acquire: async (file, options) => {
                    if (armed) {
                        entered.resolve();
                        await gate.promise;
                    }
                    return await acquireFileLock(file, options);
                },
            },
        });

        const alpha = await createProjectForTest("alpha");
        const ready = await openProject(alpha, {kind: "user"}, workspaceRoot);
        const context = await fixture.issueProject("alpha", ready.publicId);
        const binding = await fixture.bindProject(context, PROJECT_STATE.owner);
        const initial = await fixture.actProject(context, readAction(binding));
        const absent = (await initial.json() as {result: {credential: unknown}}).result.credential;
        const seeded = await fixture.actProject(context, {
            kind: "save",
            owner: PROJECT_STATE.owner,
            key: PROJECT_STATE.key,
            schemaVersion: 1,
            binding,
            expected: absent,
            value: {width: 256},
        });
        expect(seeded.status).toBe(200);
        const reloaded = await fixture.actProject(context, readAction(binding));
        const credential = (await reloaded.json() as {result: {credential: unknown}}).result.credential;
        const recordPath = await recordFile(ready.workspace);
        const before = await readFile(recordPath);

        const dataRoot = userStorageRootFromWorkspaceRoot(workspaceRoot);
        const identityBytes = await readFile(storageIdentityFilePath(dataRoot));

        armed = true;
        const saving = fixture.actProject(context, {
            kind: "save",
            owner: PROJECT_STATE.owner,
            key: PROJECT_STATE.key,
            schemaVersion: 1,
            binding,
            expected: credential,
            value: {width: 900},
        });
        await entered.promise;

        // 已接纳的保存正在等 Storage 锁：此时用同一份 identity.json 重建 data 物理根。
        // 身份域字符串相同，只有真实物理身份能拒绝这次写入。
        await rm(dataRoot, {recursive: true, force: true, maxRetries: 10, retryDelay: 50});
        await mkdir(dataRoot);
        await writeFile(storageIdentityFilePath(dataRoot), identityBytes);

        gate.resolve();
        const response = await saving;
        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toMatchObject({
            data: {code: "STORAGE_CONTEXT_INVALID", reason: "claims-mismatch"},
        });
        // 拒绝发生在副作用之前：原 Project 记录文件字节不变。
        await expect(readFile(recordPath)).resolves.toEqual(before);
    }, 90_000);

    it("等 Storage 锁期间 Project 被替换：已接纳保存停在真实副作用前", async () => {
        let armed = false;
        const entered = Promise.withResolvers<void>();
        const gate = Promise.withResolvers<void>();
        await setStorageHostContextForTest({
            resolveSubject: () => TEST_SUBJECT,
            definitions: [PROJECT_STATE],
            lockAdapter: {
                acquire: async (file, options) => {
                    if (armed) {
                        entered.resolve();
                        await gate.promise;
                    }
                    return await acquireFileLock(file, options);
                },
            },
        });

        const alpha = await createProjectForTest("alpha");
        const ready = await openProject(alpha, {kind: "user"}, workspaceRoot);
        const context = await fixture.issueProject("alpha", ready.publicId);
        const binding = await fixture.bindProject(context, PROJECT_STATE.owner);
        const initial = await fixture.actProject(context, readAction(binding));
        const credential = (await initial.json() as {result: {credential: unknown}}).result.credential;

        armed = true;
        const saving = fixture.actProject(context, {
            kind: "save",
            owner: PROJECT_STATE.owner,
            key: PROJECT_STATE.key,
            schemaVersion: 1,
            binding,
            expected: credential,
            value: {width: 777},
        });
        await entered.promise;

        // 已接纳的保存正在等锁：此时 Project 的写入目标终止（根替换与锁失效走同一终止标记）。
        let closeSettled = false;
        const closing = closeProject(alpha, "root-replaced").then(
            () => { closeSettled = true; },
            () => { closeSettled = true; },
        );
        await new Promise<void>((resolve) => { setImmediate(resolve); });
        expect(closeSettled).toBe(false);

        gate.resolve();
        const response = await saving;
        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toMatchObject({
            data: {code: "STORAGE_CONTEXT_INVALID", reason: "claims-mismatch"},
        });
        await closing;
        // 拒绝发生在副作用之前：本次保存没有写任何记录。
        await expect(stat(await recordFile(ready.workspace))).rejects.toMatchObject({code: "ENOENT"});
    }, 90_000);

    it("初始化在真实 mkdir 之前再次核验：等待期间被关闭的 Project 不重建 Storage 根", async () => {
        let armed = false;
        const entered = Promise.withResolvers<void>();
        const gate = Promise.withResolvers<void>();
        await setStorageHostContextForTest({
            resolveSubject: async () => {
                if (armed) {
                    entered.resolve();
                    await gate.promise;
                }
                return TEST_SUBJECT;
            },
            definitions: [PROJECT_STATE],
        });

        const alpha = await createProjectForTest("alpha");
        const ready = await openProject(alpha, {kind: "user"}, workspaceRoot);
        const storageRoot = projectStorageRootFromProjectRoot(ready.workspace.root);

        armed = true;
        const issuing = fixture.request(PROJECT_CONTEXT_PATH, {body: {projectRoot: "alpha", publicId: ready.publicId}});
        await entered.promise;

        let closeSettled = false;
        const closing = closeProject(alpha, "root-replaced").then(
            () => { closeSettled = true; },
            () => { closeSettled = true; },
        );
        await new Promise<void>((resolve) => { setImmediate(resolve); });
        expect(closeSettled).toBe(false);

        gate.resolve();
        // 鉴权/身份域 await 之后、mkdir 之前重新核验精确 ready：已终止的 Project 不签发访问，也不建目录。
        const response = await issuing;
        expect(response.status).toBe(409);
        await closing;
        await expect(stat(storageRoot)).rejects.toMatchObject({code: "ENOENT"});
    }, 90_000);
});
