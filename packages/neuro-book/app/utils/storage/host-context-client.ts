/**
 * 浏览器侧的 user 访问上下文 adapter。
 *
 * 顺序固定：先取得本浏览器存储上下文保留（或首次创建）的定位凭证，再让服务端核验当前主体、
 * 凭证与 data 身份域后签发一次访问上下文。上下文只在签发它的后端运行期有效，重开后重新初始化即可，
 * 浏览器身份仍指向原 local 分区；后端重启只撤销访问，不清除浏览器身份。
 *
 * adapter 不缓存状态值，也不把 clientId、身份域或磁盘路径当作前端字段；身份不可持久恢复
 * （reason 为 identity-unrecoverable）时调用方不得开始旧键导入或改落共享分区。
 */

import {resolveApiErrorCode, resolveApiErrorMessage, resolveApiErrorStatus} from "nbook/app/utils/api-error";
import {apiFetch, type ApiFetchOptions} from "nbook/app/utils/api-fetch";
import {
    isStorageAccessContextId,
    STORAGE_ACCESS_CONTEXT_HEADER,
    STORAGE_CLIENT_CREDENTIAL_HEADER,
} from "nbook/shared/storage/host";
import {
    loadOrCreateStorageClientIdentity,
    type StorageClientIdentityTarget,
} from "nbook/app/utils/storage/client-identity";

/** user 访问上下文的 HTTP 入口；存储根与身份域只由服务端解析。 */
const STORAGE_USER_CONTEXT_PATH = "/api/storage/user/context";

/** 宿主 HTTP 入口；产品内是 `apiFetch`，隔离宿主与测试可以注入自己的实现。 */
export type StorageHostRequest = (request: string, options?: ApiFetchOptions) => Promise<unknown>;

export type StorageUserContextSession = {
    /** 服务端签发、每次请求都要重新核验的访问上下文标识。 */
    readonly contextId: string;
    /** 浏览器保留的定位凭证；释放上下文不会清除它。 */
    readonly clientCredential: string;
};

/** 后端问题只影响本次访问；身份不可持久恢复时调用方必须停下并给出明确状态。 */
export type StorageUserContextFailureReason = "identity-unrecoverable" | "backend-rejected" | "backend-unreachable";

export type StorageUserContextOpenResult =
    | {readonly status: "ready"; readonly session: StorageUserContextSession}
    | {readonly status: "unavailable"; readonly reason: StorageUserContextFailureReason; readonly diagnosis: string; readonly code: string | null; readonly statusCode: number | null};

export type StorageUserContextOpenOptions = {
    readonly identity?: StorageClientIdentityTarget;
    readonly request?: StorageHostRequest;
};

/** 签发一次独立 user 访问；失败交给调用方展示或重试，不在这里制造 fallback 身份。 */
export async function openStorageUserContext(
    options: StorageUserContextOpenOptions = {},
): Promise<StorageUserContextOpenResult> {
    const identity = await loadOrCreateStorageClientIdentity(options.identity);
    if (identity.status === "unrecoverable") {
        return {status: "unavailable", reason: "identity-unrecoverable", diagnosis: identity.diagnosis, code: null, statusCode: null};
    }
    const request = options.request ?? apiFetch;
    let payload: unknown;
    try {
        payload = await request(STORAGE_USER_CONTEXT_PATH, {
            method: "POST",
            headers: {[STORAGE_CLIENT_CREDENTIAL_HEADER]: identity.credential},
        });
    } catch (error) {
        return {status: "unavailable", ...describeRequestFailure(error)};
    }
    const contextId = readContextId(payload);
    if (contextId === null) {
        return {
            status: "unavailable",
            reason: "backend-rejected",
            code: null,
            statusCode: null,
            diagnosis: "服务端没有返回本合同的 Storage 访问上下文标识",
        };
    }
    return {status: "ready", session: {contextId, clientCredential: identity.credential}};
}

/**
 * 释放一次访问上下文并返回服务端结果。
 *
 * 后端不可达时抛出，由调用方决定重试；上下文本来就会随后端运行期结束而失效，
 * 这里的释放只影响当前运行期的容量与撤销时机。
 */
export async function closeStorageUserContext(
    session: StorageUserContextSession,
    options: {readonly request?: StorageHostRequest} = {},
): Promise<void> {
    const request = options.request ?? apiFetch;
    await request(STORAGE_USER_CONTEXT_PATH, {
        method: "DELETE",
        headers: {
            [STORAGE_ACCESS_CONTEXT_HEADER]: session.contextId,
            [STORAGE_CLIENT_CREDENTIAL_HEADER]: session.clientCredential,
        },
    });
}

function readContextId(payload: unknown): string | null {
    if (typeof payload !== "object" || payload === null || !("contextId" in payload)) return null;
    const contextId: unknown = payload.contextId;
    return typeof contextId === "string" && isStorageAccessContextId(contextId) ? contextId : null;
}

function describeRequestFailure(error: unknown): {
    readonly reason: StorageUserContextFailureReason;
    readonly diagnosis: string;
    readonly code: string | null;
    readonly statusCode: number | null;
} {
    return {
        reason: resolveApiErrorStatus(error) === null ? "backend-unreachable" : "backend-rejected",
        diagnosis: resolveApiErrorMessage(error, "无法初始化 Storage 访问上下文"),
        code: resolveApiErrorCode(error),
        statusCode: resolveApiErrorStatus(error),
    };
}
