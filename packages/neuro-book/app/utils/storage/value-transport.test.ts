import {afterEach, describe, expect, it, vi} from "vitest";
import {createFetch} from "ofetch";
import type {ApiFetchOptions} from "nbook/app/utils/api-fetch";
import {createStorageHttpTransport, isStorageAdapterError} from "nbook/app/utils/storage/value-transport";
import {STORAGE_ACCESS_CONTEXT_HEADER, STORAGE_CLIENT_CREDENTIAL_HEADER} from "nbook/shared/storage/host";

const session = {contextId: "f".repeat(64), clientCredential: "0123456789abcdef".repeat(4)};
const binding = {local: 1, shared: 1};
const readAction = {kind: "read", owner: "test.adapter", key: "layout", schemaVersion: 1, binding} as const;

afterEach(() => vi.useRealTimers());

type RecordedCall = {readonly request: string; readonly options: ApiFetchOptions | undefined};

function recordingRequest(payload: unknown, calls: RecordedCall[]) {
    return (request: string, options?: ApiFetchOptions): Promise<unknown> => {
        calls.push({request, options});
        return Promise.resolve(payload);
    };
}

describe("createStorageHttpTransport", () => {
    it("只经唯一的动作入口提交 DTO，并显式禁止自动重放", async () => {
        const calls: RecordedCall[] = [];
        const transport = createStorageHttpTransport({
            session,
            request: recordingRequest({kind: "read", result: {kind: "missing", credential: {revision: null, partitionGeneration: 1}}}, calls),
        });

        const response = await transport.send(readAction);

        expect(response).toMatchObject({kind: "read", result: {kind: "missing"}});
        expect(calls).toHaveLength(1);
        expect(calls[0]?.request).toBe("/api/storage/user/action");
        expect(calls[0]?.options?.method).toBe("POST");
        expect(calls[0]?.options?.headers).toEqual({
            [STORAGE_ACCESS_CONTEXT_HEADER]: session.contextId,
            [STORAGE_CLIENT_CREDENTIAL_HEADER]: session.clientCredential,
        });
        expect(calls[0]?.options?.body).toEqual(readAction);
        // 自动重放会把第二次请求落在新 revision 或新代次上，因此由传输显式关闭。
        expect(calls[0]?.options?.retry).toBe(false);
        expect(calls[0]?.options?.notify).toBe(false);
    });

    it("响应与本合同不一致时按适配器失败报告，不返回半个结果", async () => {
        const transport = createStorageHttpTransport({
            session,
            request: recordingRequest({kind: "read", result: {kind: "mystery"}}, []),
        });

        const failure = await transport.send(readAction).catch((error: unknown) => error);
        expect(isStorageAdapterError(failure)).toBe(true);
        expect(failure).toMatchObject({code: null, status: null, committed: null});

        const mismatched = createStorageHttpTransport({
            session,
            request: recordingRequest({kind: "reclaim", result: {partitionGeneration: 1, outcomes: []}}, []),
        });
        await expect(mismatched.send(readAction)).rejects.toMatchObject({code: null, status: null});
    });

    it("不合法的动作在发送前拒绝", async () => {
        const calls: RecordedCall[] = [];
        const transport = createStorageHttpTransport({session, request: recordingRequest({}, calls)});

        await expect(transport.send({...readAction, owner: ""})).rejects
            .toMatchObject({code: "STORAGE_REQUEST_INVALID", committed: false});
        expect(calls).toHaveLength(0);
    });

    it("HTTP 失败保留 code/status 与提交事实，断线是未确认", async () => {
        const conflict = Object.assign(new Error("Storage 记录已被其他写入修改，请重读后再保存"), {
            statusCode: 409,
            data: {code: "STORAGE_REVISION_CONFLICT", message: "Storage 记录已被其他写入修改，请重读后再保存"},
        });
        const conflictTransport = createStorageHttpTransport({session, request: () => Promise.reject(conflict)});
        const conflictFailure = await conflictTransport.send(readAction).catch((error: unknown) => error);
        expect(conflictFailure).toMatchObject({
            code: "STORAGE_REVISION_CONFLICT",
            status: 409,
            committed: false,
            message: "Storage 记录已被其他写入修改，请重读后再保存",
        });

        const committed = Object.assign(new Error("Storage 分区正被其他进程占用，请稍后重试"), {
            statusCode: 503,
            data: {code: "STORAGE_LOCK_UNAVAILABLE", message: "Storage 分区正被其他进程占用", committed: true},
        });
        const lockTransport = createStorageHttpTransport({session, request: () => Promise.reject(committed)});
        await expect(lockTransport.send(readAction)).rejects.toMatchObject({status: 503, committed: true});

        const offline = createStorageHttpTransport({session, request: () => Promise.reject(new Error("connect ECONNREFUSED"))});
        const offlineFailure = await offline.send(readAction).catch((error: unknown) => error);
        expect(offlineFailure).toMatchObject({status: null, committed: null});
        expect(isStorageAdapterError(offlineFailure)).toBe(true);
    });

    it("成功响应按 DTO 校验后才交付给句柄", async () => {
        const transport = createStorageHttpTransport({
            session,
            request: recordingRequest({
                kind: "save",
                credential: {revision: "rev-2", partitionGeneration: 1},
            }, []),
        });

        await expect(transport.send({
            kind: "save",
            owner: "test.adapter",
            key: "layout",
            schemaVersion: 1,
            binding,
            expected: {revision: null, partitionGeneration: 1},
            value: {width: 1},
        })).resolves.toEqual({kind: "save", credential: {revision: "rev-2", partitionGeneration: 1}});

        const malformed = createStorageHttpTransport({
            session,
            request: recordingRequest({kind: "save", credential: {revision: "rev-2", partitionGeneration: 0}}, []),
        });
        await expect(malformed.send({
            kind: "save",
            owner: "test.adapter",
            key: "layout",
            schemaVersion: 1,
            binding,
            expected: {revision: null, partitionGeneration: 1},
            value: {width: 1},
        })).rejects.toMatchObject({code: null, status: null});
    });
});

describe("传输失败与取消", () => {
    it.each([
        {statusCode: 503, data: {data: {code: "STORAGE_LOCK_UNAVAILABLE", committed: true}}},
        {statusCode: 503, response: {_data: {data: {code: "STORAGE_LOCK_UNAVAILABLE", committed: true}}}},
        {statusCode: 409, data: {data: {committed: true}}},
    ])("保留嵌套响应中的已提交事实 %#", async (error) => {
        const transport = createStorageHttpTransport({session, request: () => Promise.reject(error)});
        await expect(transport.send(readAction)).rejects.toMatchObject({committed: true});
    });

    it.each([502, 503])("HTTP %i 无提交字段时保持未确认", async (statusCode) => {
        const transport = createStorageHttpTransport({session, request: () => Promise.reject({statusCode})});
        await expect(transport.send(readAction)).rejects.toMatchObject({status: statusCode, committed: null});
    });

    it("向 HTTP 请求传递取消信号", async () => {
        const calls: RecordedCall[] = [];
        const transport = createStorageHttpTransport({session, request: recordingRequest({kind: "read", result: {kind: "missing", credential: {revision: null, partitionGeneration: 1}}}, calls)});
        const abort = new AbortController();
        const request = createStorageHttpTransport({session, request: (_path, options) => {
            const signal = options?.signal;
            if (!(signal instanceof AbortSignal)) throw new Error("missing cancellation");
            return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), {once: true}));
        }});
        const pending = request.send(readAction, {signal: abort.signal});
        const rejected = expect(pending).rejects.toMatchObject({committed: null});
        abort.abort();
        await rejected;
        await transport.send(readAction, {signal: new AbortController().signal});
        expect(calls[0]?.options?.signal).toBeInstanceOf(AbortSignal);
    });

    it.each(["no-headers", "pending-body"] as const)("真实 ofetch 在 %s 且带取消信号时仍按 15 秒超时", async (mode) => {
        vi.useFakeTimers();
        let requests = 0;
        const headersDelivered = Promise.withResolvers<void>();
        const stalledFetch = Object.assign(
            async (_input: Parameters<typeof fetch>[0], options?: Parameters<typeof fetch>[1]): Promise<Response> => {
                requests += 1;
                const signal = options?.signal;
                if (!signal) throw new Error("missing signal");
                if (mode === "no-headers") {
                    return await new Promise<Response>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), {once: true}));
                }
                const body = new ReadableStream<Uint8Array>({
                    start(controller) {
                        signal.addEventListener("abort", () => controller.error(signal.reason), {once: true});
                    },
                });
                headersDelivered.resolve();
                return new Response(body, {headers: {"content-type": "application/json"}});
            },
            {preconnect: vi.fn<typeof fetch.preconnect>()},
        );
        const request = createFetch({fetch: stalledFetch});
        const transport = createStorageHttpTransport({session, request: (path, options) => request(path, {...options, method: "POST"})});
        const abort = new AbortController();
        const pending = transport.send(readAction, {signal: abort.signal});
        const rejected = expect(pending).rejects.toMatchObject({committed: null});
        if (mode === "pending-body") await headersDelivered.promise;
        let settled = false;
        void pending.then(() => {settled = true;}, () => {settled = true;});
        await vi.advanceTimersByTimeAsync(14_999);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await rejected;
        expect(requests).toBe(1);
        expect(abort.signal.aborted).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });
});
