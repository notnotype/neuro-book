/**
 * 浏览器侧 Storage 值动作的 HTTP 传输。
 *
 * 这是前端与后端之间唯一的动作边界：请求在发送前按共享 DTO 校验，响应在网络边界上按同一合同校验，
 * 失败投影为带 code/status/committed 的适配器错误。传输不缓存状态值、不持有身份，也不决定重试策略：
 * mutation 显式禁止 HTTP 层自动重放，结果不明时由 owner 决定重读还是放弃。
 */

import {resolveApiErrorCode, resolveApiErrorMessage, resolveApiErrorStatus} from "nbook/app/utils/api-error";
import {apiFetch} from "nbook/app/utils/api-fetch";
import type {StorageHostRequest, StorageUserContextSession} from "nbook/app/utils/storage/host-context-client";
import {
    StorageActionRequestSchema,
    StorageActionResponseSchema,
    type StorageActionRequest,
    type StorageActionResponse,
} from "nbook/shared/storage/action";
import {STORAGE_ACCESS_CONTEXT_HEADER, STORAGE_CLIENT_CREDENTIAL_HEADER} from "nbook/shared/storage/host";

/** user 值动作入口；scope、主体、存储根与注册定义只由服务端拥有。 */
const STORAGE_USER_ACTION_PATH = "/api/storage/user/action";
const STORAGE_REQUEST_TIMEOUT_MS = 15_000;

/** 一次失败的可观察事实；`committed` 为 `null` 表示结果未确认（超时或断线）。 */
export type StorageAdapterFailure = {
    readonly code: string | null;
    readonly status: number | null;
    readonly message: string;
    readonly committed: boolean | null;
};

/**
 * 适配器失败。
 *
 * 只承载服务端已经公开的 code/status/committed 与展示文案；不携带路径、主体或原始响应体。
 */
export class StorageAdapterError extends Error {
    /** HMR 或跨模块副本下仍可识别，不依赖 `instanceof` 的单例性。 */
    readonly storageAdapterError = true;
    readonly code: string | null;
    readonly status: number | null;
    readonly committed: boolean | null;

    constructor(failure: StorageAdapterFailure) {
        super(failure.message);
        this.name = "StorageAdapterError";
        this.code = failure.code;
        this.status = failure.status;
        this.committed = failure.committed;
    }
}

export function isStorageAdapterError(error: unknown): error is StorageAdapterError {
    return error instanceof Error && (error as {readonly storageAdapterError?: unknown}).storageAdapterError === true;
}

/** 显式提交事实优先；只有确定的请求拒绝可推断为未提交。 */
export function projectStorageAdapterFailure(error: unknown): StorageAdapterFailure {
    const status = resolveApiErrorStatus(error);
    return {
        code: resolveApiErrorCode(error),
        status,
        message: resolveApiErrorMessage(error, "Storage 请求失败"),
        committed: readCommitted(error) ?? (status !== null && [400, 401, 403, 409, 413, 422].includes(status) ? false : null),
    };
}

/** 值动作的传输替换接缝；换成别的传输不改句柄、快照与失效语义。 */
export type StorageValueTransport = {
    readonly send: (action: StorageActionRequest, options?: {readonly signal?: AbortSignal}) => Promise<StorageActionResponse>;
};

export type StorageHttpTransportOptions = {
    readonly session: StorageUserContextSession;
    /** 宿主 HTTP 入口；产品内是 `apiFetch`，隔离宿主与测试可以注入自己的实现。 */
    readonly request?: StorageHostRequest;
};

/**
 * 建立默认 HTTP 传输。
 *
 * 每次动作都重新核验访问上下文：句柄不因为用过一次就获得更长的授权。
 */
export function createStorageHttpTransport(options: StorageHttpTransportOptions): StorageValueTransport {
    const request = options.request ?? apiFetch;
    const headers = {
        [STORAGE_ACCESS_CONTEXT_HEADER]: options.session.contextId,
        [STORAGE_CLIENT_CREDENTIAL_HEADER]: options.session.clientCredential,
    };
    return {
        async send(action, sendOptions) {
            const parsed = StorageActionRequestSchema.safeParse(action);
            if (!parsed.success) {
                const issue = parsed.error.issues[0];
                throw new StorageAdapterError({
                    code: "STORAGE_REQUEST_INVALID",
                    status: null,
                    message: `Storage 动作请求不合法：${issue === undefined ? "未知字段" : `${issue.path.join(".")} ${issue.message}`}`,
                    // 请求没有离开浏览器，确定没有写入。
                    committed: false,
                });
            }
            let payload: unknown;
            // ofetch 在提供 signal 时忽略 timeout，且自带计时器只覆盖响应头；这里覆盖完整响应体读取。
            const cancellation = createRequestCancellation(sendOptions?.signal);
            try {
                payload = await request(STORAGE_USER_ACTION_PATH, {
                    method: "POST",
                    headers,
                    body: parsed.data,
                    // mutation 一旦自动重放，第二次可能落在新 revision 或新代次上；重试由 owner 显式决定。
                    retry: false,
                    signal: cancellation.signal,
                    // 错误由句柄的调用方或 onError 展示，后台轮询不能反复触发全局通知。
                    notify: false,
                });
            } catch (error) {
                throw new StorageAdapterError(projectStorageAdapterFailure(error));
            } finally {
                cancellation.dispose();
            }
            const response = StorageActionResponseSchema.safeParse(payload);
            if (!response.success || response.data.kind !== parsed.data.kind) {
                throw new StorageAdapterError({
                    code: null,
                    status: null,
                    message: "Storage 动作响应与本合同不一致",
                    committed: null,
                });
            }
            return response.data;
        },
    };
}

/** 每次请求独占计时器和监听器；外部取消不拥有写队列，也不替代请求期限。 */
function createRequestCancellation(signal: AbortSignal | undefined): {readonly signal: AbortSignal; dispose(): void} {
    const controller = new AbortController();
    const cancel = (): void => controller.abort(signal?.reason);
    if (signal?.aborted) cancel();
    else signal?.addEventListener("abort", cancel, {once: true});
    const timeout = setTimeout(() => controller.abort(new DOMException("Storage 请求超时", "TimeoutError")), STORAGE_REQUEST_TIMEOUT_MS);
    return {
        signal: controller.signal,
        dispose() {
            clearTimeout(timeout);
            signal?.removeEventListener("abort", cancel);
        },
    };
}

/** `committed` 只从服务端公开字段读取；缺失时按“未确认”处理，不替服务端推断。 */
function readCommitted(error: unknown): boolean | undefined {
    if (typeof error !== "object" || error === null) return undefined;
    const data = "data" in error ? (error as {readonly data?: unknown}).data : undefined;
    const direct = committedField(data);
    if (direct !== undefined) return direct;
    const response = "response" in error ? (error as {readonly response?: unknown}).response : undefined;
    if (typeof response !== "object" || response === null || !("_data" in response)) return undefined;
    return committedField((response as {readonly _data?: unknown})._data);
}

function committedField(value: unknown, depth = 0): boolean | undefined {
    if (depth > 3 || typeof value !== "object" || value === null) return undefined;
    const committed: unknown = (value as {readonly committed?: unknown}).committed;
    if (typeof committed === "boolean") return committed;
    return "data" in value ? committedField((value as {readonly data?: unknown}).data, depth + 1) : undefined;
}
