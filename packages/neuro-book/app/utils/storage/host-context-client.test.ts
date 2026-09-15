import {describe, expect, it} from "vitest";
import type {ApiFetchOptions} from "nbook/app/utils/api-fetch";
import type {StorageClientIdentityTarget} from "nbook/app/utils/storage/client-identity";
import {closeStorageUserContext, openStorageUserContext} from "nbook/app/utils/storage/host-context-client";
import {STORAGE_ACCESS_CONTEXT_HEADER, STORAGE_CLIENT_CREDENTIAL_HEADER} from "nbook/shared/storage/host";

const CREDENTIAL = "0123456789abcdef".repeat(4);
const CONTEXT_ID = "f".repeat(64);

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

describe("openStorageUserContext", () => {
    it("把浏览器保留的凭证交给服务端并返回本次访问上下文", async () => {
        const calls: RecordedCall[] = [];
        const result = await openStorageUserContext({
            identity: identityTarget(),
            request: recordingRequest({contextId: CONTEXT_ID}, calls),
        });

        expect(result).toEqual({status: "ready", session: {contextId: CONTEXT_ID, clientCredential: CREDENTIAL}});
        expect(calls).toHaveLength(1);
        expect(calls[0]?.request).toBe("/api/storage/user/context");
        expect(calls[0]?.options?.method).toBe("POST");
        expect(calls[0]?.options?.headers).toEqual({[STORAGE_CLIENT_CREDENTIAL_HEADER]: CREDENTIAL});
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

describe("closeStorageUserContext", () => {
    it("只用上下文标识与宿主凭证释放", async () => {
        const calls: RecordedCall[] = [];
        await closeStorageUserContext(
            {contextId: CONTEXT_ID, clientCredential: CREDENTIAL},
            {request: recordingRequest({released: true}, calls)},
        );

        expect(calls).toHaveLength(1);
        expect(calls[0]?.request).toBe("/api/storage/user/context");
        expect(calls[0]?.options?.method).toBe("DELETE");
        expect(calls[0]?.options?.headers).toEqual({
            [STORAGE_ACCESS_CONTEXT_HEADER]: CONTEXT_ID,
            [STORAGE_CLIENT_CREDENTIAL_HEADER]: CREDENTIAL,
        });
    });
});
