import {afterEach, describe, expect, it, vi} from "vitest";
import type {ApiFetchOptions} from "nbook/app/utils/api-fetch";
import type {StorageClientIdentityTarget} from "nbook/app/utils/storage/client-identity";
import {
    closeStorageContext,
    openStorageProjectContext,
    openStorageUserContext,
} from "nbook/app/utils/storage/host-context-client";
import {openStorageOwnerHandle} from "nbook/app/utils/storage/owner-handle";
import {createStorageHttpTransport} from "nbook/app/utils/storage/value-transport";
import {defineStorageState} from "nbook/shared/storage/definition";
import {STORAGE_ACCESS_CONTEXT_HEADER, STORAGE_CLIENT_CREDENTIAL_HEADER} from "nbook/shared/storage/host";

const CREDENTIAL = "0123456789abcdef".repeat(4);
const CONTEXT_ID = "f".repeat(64);
const PROJECT_CONTEXT_ID = "a".repeat(64);

const layout = defineStorageState<{readonly width: number}>({
    owner: "test.adapter",
    key: "layout",
    scope: "project",
    locality: "local",
    records: "single",
    schemaVersion: 1,
    defaultValue: {width: 320},
    validate: (value): value is {readonly width: number} => typeof value === "object" && value !== null
        && typeof (value as {readonly width: number}).width === "number",
});

/**
 * 只提供“已保存一条凭证”的成功路径替身；真实事务语义由 Chromium 隔离宿主验证。
 * 这里用它证明 adapter 把浏览器保留的身份原样交给服务端，而不是自报 clientId 或主体。
 */
function identityTarget(): StorageClientIdentityTarget {
    const request = {
        result: undefined as unknown,
        error: null as unknown,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onupgradeneeded: null as (() => void) | null,
        onblocked: null as (() => void) | null,
    };
    const indexedDB = {
        open: () => {
            queueMicrotask(() => {
                request.result = {
                    onversionchange: null,
                    objectStoreNames: {contains: () => true},
                    close: () => undefined,
                    createObjectStore: () => undefined,
                    transaction: () => {
                        const transaction = {
                            error: null,
                            oncomplete: null as (() => void) | null,
                            onerror: null as (() => void) | null,
                            onabort: null as (() => void) | null,
                            objectStore: () => ({
                                get: () => {
                                    const get = {
                                        result: CREDENTIAL,
                                        onsuccess: null as (() => void) | null,
                                        onerror: null,
                                    };
                                    queueMicrotask(() => {
                                        get.onsuccess?.();
                                        transaction.oncomplete?.();
                                    });
                                    return get;
                                },
                            }),
                        };
                        return transaction;
                    },
                };
                request.onsuccess?.();
            });
            return request;
        },
    };
    return {indexedDB: indexedDB as unknown as IDBFactory};
}

type RecordedCall = {readonly request: string; readonly options: ApiFetchOptions | undefined};

function recordingRequest(payload: unknown, calls: RecordedCall[]) {
    return (request: string, options?: ApiFetchOptions): Promise<unknown> => {
        calls.push({request, options});
        return Promise.resolve(payload);
    };
}

afterEach(() => {
    vi.useRealTimers();
});

describe("openStorageUserContext", () => {
    it("把浏览器保留的凭证交给服务端并返回本次访问上下文", async () => {
        const calls: RecordedCall[] = [];
        const result = await openStorageUserContext({
            identity: identityTarget(),
            request: recordingRequest({contextId: CONTEXT_ID}, calls),
        });

        expect(result).toEqual({status: "ready", session: {scope: "user", contextId: CONTEXT_ID, clientCredential: CREDENTIAL}});
        expect(Object.isFrozen((result as {readonly session: object}).session)).toBe(true);
        expect(calls).toHaveLength(1);
        expect(calls[0]?.request).toBe("/api/storage/user/context");
        expect(calls[0]?.options?.method).toBe("POST");
        expect(calls[0]?.options?.headers).toEqual({[STORAGE_CLIENT_CREDENTIAL_HEADER]: CREDENTIAL});
        // 签发不是幂等动作，且后台失败不能反复触发全局通知。
        expect(calls[0]?.options?.retry).toBe(false);
        expect(calls[0]?.options?.notify).toBe(false);
        expect(calls[0]?.options?.signal).toBeInstanceOf(AbortSignal);
        // user 访问不带 Project 定位字段。
        expect(calls[0]?.options?.body).toBeUndefined();
    });

    it("身份不可持久恢复时不请求后端，也不改落其它身份来源", async () => {
        const calls: RecordedCall[] = [];
        const result = await openStorageUserContext({
            identity: {indexedDB: null},
            request: recordingRequest({contextId: CONTEXT_ID}, calls),
        });

        expect(result).toMatchObject({status: "unavailable", reason: "identity-unrecoverable"});
        expect(calls).toHaveLength(0);
    });

    it("后端拒绝时带出服务端公开文案", async () => {
        const rejected = Object.assign(new Error("Storage 访问上下文已失效，请重新初始化"), {
            statusCode: 403,
            status: 403,
            data: {code: "STORAGE_CONTEXT_INVALID", message: "Storage 访问上下文已失效，请重新初始化"},
        });
        const result = await openStorageUserContext({
            identity: identityTarget(),
            request: () => Promise.reject(rejected),
        });

        expect(result).toMatchObject({
            status: "unavailable",
            reason: "backend-rejected",
            code: "STORAGE_CONTEXT_INVALID",
            statusCode: 403,
            diagnosis: "Storage 访问上下文已失效，请重新初始化",
        });
    });

    it("后端不可达与响应不合同时分别可识别", async () => {
        const unreachable = await openStorageUserContext({
            identity: identityTarget(),
            request: () => Promise.reject(new Error("connect ECONNREFUSED")),
        });
        expect(unreachable).toMatchObject({status: "unavailable", reason: "backend-unreachable"});

        const malformed = await openStorageUserContext({
            identity: identityTarget(),
            request: recordingRequest({contextId: "not-a-context"}, []),
        });
        expect(malformed).toMatchObject({status: "unavailable", reason: "backend-rejected"});
    });
});

describe("openStorageProjectContext", () => {
    it("把精确 ready 的定位字段交给 project 入口，并绑定到返回的 session", async () => {
        const calls: RecordedCall[] = [];
        const result = await openStorageProjectContext(
            {projectRoot: "/workspace/A", publicId: "public-a"},
            {identity: identityTarget(), request: recordingRequest({contextId: PROJECT_CONTEXT_ID}, calls)},
        );

        expect(result).toEqual({
            status: "ready",
            session: {
                scope: "project",
                contextId: PROJECT_CONTEXT_ID,
                clientCredential: CREDENTIAL,
                projectRoot: "/workspace/A",
                publicId: "public-a",
            },
        });
        expect(calls).toHaveLength(1);
        expect(calls[0]?.request).toBe("/api/storage/project/context");
        expect(calls[0]?.options?.method).toBe("POST");
        expect(calls[0]?.options?.headers).toEqual({[STORAGE_CLIENT_CREDENTIAL_HEADER]: CREDENTIAL});
        // 请求体只有定位标量：ready 的 UI revision 计数不进入请求。
        expect(calls[0]?.options?.body).toEqual({projectRoot: "/workspace/A", publicId: "public-a"});
    });

    it("ready 的形状直接可用，两个目标的请求彼此隔离", async () => {
        const calls: RecordedCall[] = [];
        const request = recordingRequest({contextId: PROJECT_CONTEXT_ID}, calls);
        // ProjectSessionReady 比目标多一个 revision 字段，仍然满足定位形状。
        const readyA = {projectRoot: "/workspace/A", publicId: "public-a", revision: 1};
        const readyB = {projectRoot: "/workspace/B", publicId: "public-b", revision: 2};

        await openStorageProjectContext(readyA, {identity: identityTarget(), request});
        await openStorageProjectContext(readyB, {identity: identityTarget(), request});

        expect(calls.map((call) => call.options?.body)).toEqual([
            {projectRoot: "/workspace/A", publicId: "public-a"},
            {projectRoot: "/workspace/B", publicId: "public-b"},
        ]);
    });

    it("身份初始化等待期间目标被改写仍请求原来捕获的 A", async () => {
        const calls: RecordedCall[] = [];
        const target = {projectRoot: "/workspace/A", publicId: "public-a"};
        const pending = openStorageProjectContext(target, {
            identity: identityTarget(),
            request: recordingRequest({contextId: PROJECT_CONTEXT_ID}, calls),
        });
        target.projectRoot = "/workspace/B";
        target.publicId = "public-b";

        const result = await pending;

        expect(calls[0]?.options?.body).toEqual({projectRoot: "/workspace/A", publicId: "public-a"});
        expect(result).toMatchObject({
            status: "ready",
            session: {scope: "project", projectRoot: "/workspace/A", publicId: "public-a"},
        });
    });

    it.each([
        {label: "publicId 缺失", target: {projectRoot: "/workspace/A"} as unknown as {projectRoot: string; publicId: string}},
        {label: "publicId 为空", target: {projectRoot: "/workspace/A", publicId: ""}},
        {label: "publicId 超长", target: {projectRoot: "/workspace/A", publicId: "x".repeat(513)}},
        {label: "projectRoot 为空", target: {projectRoot: "", publicId: "public-a"}},
    ])("$label 时直接不可用且不请求后端", async ({target}) => {
        const calls: RecordedCall[] = [];
        // 身份同样不可恢复：目标错误必须优先，调用方不能把非法目标当成身份问题处理。
        const result = await openStorageProjectContext(target, {
            identity: {indexedDB: null},
            request: recordingRequest({contextId: PROJECT_CONTEXT_ID}, calls),
        });

        expect(result).toMatchObject({status: "unavailable", reason: "target-invalid"});
        expect(calls).toHaveLength(0);
    });

    it("身份失效不 fallback 到 user 或其它身份来源", async () => {
        const calls: RecordedCall[] = [];
        const result = await openStorageProjectContext(
            {projectRoot: "/workspace/A", publicId: "public-a"},
            {identity: {indexedDB: null}, request: recordingRequest({contextId: PROJECT_CONTEXT_ID}, calls)},
        );

        expect(result).toMatchObject({status: "unavailable", reason: "identity-unrecoverable"});
        expect(calls).toHaveLength(0);
    });

    it("服务端拒绝与响应不合同时分别可识别", async () => {
        const rejected = Object.assign(new Error("Storage project 代次已失效，请重新初始化"), {
            statusCode: 409,
            data: {code: "STORAGE_CONTEXT_INVALID", message: "Storage project 代次已失效，请重新初始化"},
        });
        const refused = await openStorageProjectContext(
            {projectRoot: "/workspace/A", publicId: "public-a"},
            {identity: identityTarget(), request: () => Promise.reject(rejected)},
        );
        expect(refused).toMatchObject({status: "unavailable", reason: "backend-rejected", code: "STORAGE_CONTEXT_INVALID"});

        const malformed = await openStorageProjectContext(
            {projectRoot: "/workspace/A", publicId: "public-a"},
            {identity: identityTarget(), request: recordingRequest({contextId: "not-a-context"}, [])},
        );
        expect(malformed).toMatchObject({status: "unavailable", reason: "backend-rejected"});
    });

    it("超时按未确认失败返回，不伪装成功也不自动重放", async () => {
        vi.useFakeTimers();
        const calls: RecordedCall[] = [];
        const stalled = (request: string, options?: ApiFetchOptions): Promise<unknown> => {
            calls.push({request, options});
            const signal = options?.signal;
            if (!(signal instanceof AbortSignal)) throw new Error("missing cancellation");
            const {promise, reject} = Promise.withResolvers<unknown>();
            signal.addEventListener("abort", () => reject(signal.reason), {once: true});
            return promise;
        };
        const pending = openStorageProjectContext(
            {projectRoot: "/workspace/A", publicId: "public-a"},
            {identity: identityTarget(), request: stalled},
        );

        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(15_000);
        const result = await pending;

        expect(result).toMatchObject({status: "unavailable", reason: "backend-unreachable", statusCode: null});
        expect((result as {readonly diagnosis: string}).diagnosis).toBe("Storage 请求超时");
        expect(calls).toHaveLength(1);
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe("closeStorageContext", () => {
    it.each([
        {
            label: "user",
            path: "/api/storage/user/context",
            session: {scope: "user", contextId: CONTEXT_ID, clientCredential: CREDENTIAL} as const,
        },
        {
            label: "project",
            path: "/api/storage/project/context",
            session: {
                scope: "project",
                contextId: PROJECT_CONTEXT_ID,
                clientCredential: CREDENTIAL,
                projectRoot: "/workspace/A",
                publicId: "public-a",
            } as const,
        },
    ])("按 session 的 scope 释放对应入口：$label", async ({path, session}) => {
        const calls: RecordedCall[] = [];
        await closeStorageContext(session, {request: recordingRequest({released: true}, calls)});

        expect(calls).toHaveLength(1);
        expect(calls[0]?.request).toBe(path);
        expect(calls[0]?.options?.method).toBe("DELETE");
        expect(calls[0]?.options?.headers).toEqual({
            [STORAGE_ACCESS_CONTEXT_HEADER]: session.contextId,
            [STORAGE_CLIENT_CREDENTIAL_HEADER]: CREDENTIAL,
        });
        expect(calls[0]?.options?.body).toBeUndefined();
        expect(calls[0]?.options?.retry).toBe(false);
        expect(calls[0]?.options?.notify).toBe(false);
    });

    it("释放失败显式抛出，不静默成功", async () => {
        const unreachable = new Error("connect ECONNREFUSED");
        await expect(closeStorageContext(
            {scope: "project", contextId: PROJECT_CONTEXT_ID, clientCredential: CREDENTIAL, projectRoot: "/workspace/A", publicId: "public-a"},
            {request: () => Promise.reject(unreachable)},
        )).rejects.toThrow(unreachable);
    });
});

describe("真实 adapter 的 project 链路", () => {
    it("context → bind → read/save/read → release 只经 project 入口", async () => {
        const calls: RecordedCall[] = [];
        const request = (path: string, options?: ApiFetchOptions): Promise<unknown> => {
            calls.push({request: path, options});
            const body = options?.body as {readonly kind?: string} | undefined;
            if (path === "/api/storage/project/context") {
                return Promise.resolve(options?.method === "DELETE" ? {released: true} : {contextId: PROJECT_CONTEXT_ID});
            }
            if (path !== "/api/storage/project/action") throw new Error(`未预期的入口：${path}`);
            switch (body?.kind) {
                case "bind":
                    return Promise.resolve({kind: "bind", binding: {local: 1, shared: 1}});
                case "read":
                    return Promise.resolve({kind: "read", result: {kind: "missing", credential: {revision: null, partitionGeneration: 1}}});
                case "save":
                    return Promise.resolve({kind: "save", credential: {revision: "rev-1", partitionGeneration: 1}});
                default:
                    throw new Error(`未预期的动作：${JSON.stringify(body)}`);
            }
        };
        const opened = await openStorageProjectContext(
            {projectRoot: "/workspace/A", publicId: "public-a"},
            {identity: identityTarget(), request},
        );
        if (opened.status !== "ready") throw new Error(`未签发 project 上下文：${JSON.stringify(opened)}`);
        const session = opened.session;
        const handle = await openStorageOwnerHandle({
            session,
            owner: "test.adapter",
            transport: createStorageHttpTransport({session, request}),
        });
        const credential = {revision: null, partitionGeneration: 1};

        const missing = await handle.read(layout);
        await handle.save(layout, {expected: credential, value: {width: 1}});
        const afterSave = await handle.read(layout);
        await handle.release();
        await closeStorageContext(session, {request});

        expect(calls.map((call) => call.request)).toEqual([
            "/api/storage/project/context",
            "/api/storage/project/action",
            "/api/storage/project/action",
            "/api/storage/project/action",
            "/api/storage/project/action",
            "/api/storage/project/context",
        ]);
        expect(calls[0]?.options?.body).toEqual({projectRoot: "/workspace/A", publicId: "public-a"});
        expect(calls[1]?.options?.body).toEqual({kind: "bind", owner: "test.adapter"});
        expect(calls[2]?.options?.body).toMatchObject({kind: "read", owner: "test.adapter", key: "layout", schemaVersion: 1, binding: {local: 1, shared: 1}});
        expect(calls[3]?.options?.body).toMatchObject({
            kind: "save",
            expected: credential,
            value: {width: 1},
        });
        expect(calls[4]?.options?.body).toMatchObject({kind: "read"});
        for (const call of calls.slice(1, 5)) {
            expect(call.options?.headers).toEqual({
                [STORAGE_ACCESS_CONTEXT_HEADER]: PROJECT_CONTEXT_ID,
                [STORAGE_CLIENT_CREDENTIAL_HEADER]: CREDENTIAL,
            });
            expect(call.options?.retry).toBe(false);
            expect(call.options?.notify).toBe(false);
        }
        expect(calls[5]?.options?.method).toBe("DELETE");
        expect(missing).toMatchObject({kind: "missing"});
        expect(afterSave).toMatchObject({kind: "missing"});
        // 整条链路都不落到 user 分区。
        expect(calls.some((call) => call.request.includes("/user/"))).toBe(false);
    });
});
