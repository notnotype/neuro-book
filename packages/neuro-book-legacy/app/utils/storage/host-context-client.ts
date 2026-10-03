/**
 * 浏览器侧的 user / project 访问上下文 adapter。
 *
 * 顺序固定：先取得本浏览器存储上下文保留（或首次创建）的定位凭证，再让服务端核验当前主体、
 * 凭证与 data 身份域后签发一次访问上下文。project 访问额外提交精确 ready 的定位字段，
 * 由服务端解析仍有效的代次；定位不构成授权。上下文只在签发它的后端运行期有效，重开后重新初始化即可，
 * 浏览器身份仍指向原 local 分区；后端重启只撤销访问，不清除浏览器身份。
 *
 * adapter 不缓存状态值，也不把 clientId、身份域或磁盘路径当作前端字段；身份不可持久恢复
 * （reason 为 identity-unrecoverable）时调用方不得开始旧键导入或改落共享分区。
 * 旧 session 不会被重新签发：上下文失效后只能由宿主显式重新初始化，不能用路径再取一次 ready。
 */

import {resolveApiErrorCode, resolveApiErrorMessage, resolveApiErrorStatus} from "nbook/app/utils/api-error";
import {apiFetch, type ApiFetchOptions} from "nbook/app/utils/api-fetch";
import {
    isStorageAccessContextId,
    StorageProjectContextRequestSchema,
    STORAGE_ACCESS_CONTEXT_HEADER,
    STORAGE_CLIENT_CREDENTIAL_HEADER,
} from "nbook/shared/storage/host";
import {
    loadOrCreateStorageClientIdentity,
    type StorageClientIdentityTarget,
} from "nbook/app/utils/storage/client-identity";
import {createRequestCancellation} from "nbook/app/utils/storage/request-deadline";

/** 访问上下文入口；按 session 固定的 scope 选择，调用方不能自带 URL。 */
const STORAGE_CONTEXT_PATHS: Record<StorageContextScope, string> = {
    user: "/api/storage/user/context",
    project: "/api/storage/project/context",
};

/** 一次访问上下文的归属；值动作入口同样按它选择，不能在一次访问内混用。 */
export type StorageContextScope = "user" | "project";

/** 宿主 HTTP 入口；产品内是 `apiFetch`，隔离宿主与测试可以注入自己的实现。 */
export type StorageHostRequest = (request: string, options?: ApiFetchOptions) => Promise<unknown>;

/** user 访问：绑定服务端核验的主体与浏览器定位凭证，不绑定 Project。 */
export type StorageUserContextSession = {
    readonly scope: "user";
    /** 服务端签发、每次请求都要重新核验的访问上下文标识。 */
    readonly contextId: string;
    /** 浏览器保留的定位凭证；释放上下文不会清除它。 */
    readonly clientCredential: string;
};

/** project 访问：在签发时捕获本次精确 ready 的定位字段，之后改写目标对象不改变本 session。 */
export type StorageProjectContextSession = {
    readonly scope: "project";
    readonly contextId: string;
    readonly clientCredential: string;
    readonly projectRoot: string;
    readonly publicId: string;
};

export type StorageAccessSession = StorageUserContextSession | StorageProjectContextSession;

/** 后端问题只影响本次访问；身份不可持久恢复或目标非法时调用方必须停下并给出明确状态。 */
export type StorageContextFailureReason =
    | "identity-unrecoverable"
    | "backend-rejected"
    | "backend-unreachable"
    | "target-invalid";

export type StorageContextUnavailable = {
    readonly status: "unavailable";
    readonly reason: StorageContextFailureReason;
    readonly diagnosis: string;
    readonly code: string | null;
    readonly statusCode: number | null;
};

export type StorageUserContextOpenResult =
    | {readonly status: "ready"; readonly session: StorageUserContextSession}
    | StorageContextUnavailable;

export type StorageProjectContextOpenResult =
    | {readonly status: "ready"; readonly session: StorageProjectContextSession}
    | StorageContextUnavailable;

export type StorageContextOpenOptions = {
    readonly identity?: StorageClientIdentityTarget;
    readonly request?: StorageHostRequest;
};

/**
 * 精确 ready 的定位字段；`ProjectSessionReady` 满足该形状，其 UI revision 计数不进入请求。
 *
 * 这里不引入 Project 生命周期模块的类型：adapter 只消费定位标量，ready 语义仍由 Project owner 拥有。
 */
export type StorageProjectContextTarget = {
    readonly projectRoot: string;
    readonly publicId: string;
};

/** 签发一次独立 user 访问；失败交给调用方展示或重试，不在这里制造 fallback 身份。 */
export async function openStorageUserContext(
    options: StorageContextOpenOptions = {},
): Promise<StorageUserContextOpenResult> {
    const identity = await loadOrCreateStorageClientIdentity(options.identity);
    if (identity.status === "unrecoverable") return unavailableIdentity(identity.diagnosis);
    const credential = identity.credential;
    const issued = await requestStorageContext("user", credential, undefined, options.request ?? apiFetch);
    if (issued.status === "unavailable") return issued;
    return {status: "ready", session: Object.freeze({scope: "user", contextId: issued.contextId, clientCredential: credential})};
}

/**
 * 为精确 ready 的 Project 签发一次独立访问。
 *
 * 目标在第一次 await 之前复制校验：调用方在身份初始化期间切换页面不改变本次请求地址，
 * 也不会因为路径相同就取到另一个代次。缺少或非法 publicId 直接不可用且不发请求。
 */
export async function openStorageProjectContext(
    target: StorageProjectContextTarget,
    options: StorageContextOpenOptions = {},
): Promise<StorageProjectContextOpenResult> {
    const parsed = StorageProjectContextRequestSchema.safeParse({projectRoot: target.projectRoot, publicId: target.publicId});
    if (!parsed.success) {
        return {
            status: "unavailable",
            reason: "target-invalid",
            code: null,
            statusCode: null,
            diagnosis: "Storage Project 目标缺少可定位的 projectRoot 或 publicId，不能签发访问上下文",
        };
    }
    // 标量先落成局部值：请求体与返回的 session 都用它们，注入的 request 改写对象也不影响已定住的目标。
    const {projectRoot, publicId} = parsed.data;
    const identity = await loadOrCreateStorageClientIdentity(options.identity);
    if (identity.status === "unrecoverable") return unavailableIdentity(identity.diagnosis);
    const credential = identity.credential;
    const issued = await requestStorageContext(
        "project",
        credential,
        {projectRoot, publicId},
        options.request ?? apiFetch,
    );
    if (issued.status === "unavailable") return issued;
    return {
        status: "ready",
        session: Object.freeze({scope: "project", contextId: issued.contextId, clientCredential: credential, projectRoot, publicId}),
    };
}

/**
 * 释放 session 自己的一次访问上下文；入口由 session 固定的 scope 决定。
 *
 * 释放只撤销这一份访问：不关闭 Project、不释放 presence，也不清除浏览器定位凭证。
 * 后端不可达或超时在这里抛出，由调用方决定重试；上下文本来也会随后端运行期结束而失效。
 */
export async function closeStorageContext(
    session: StorageAccessSession,
    options: {readonly request?: StorageHostRequest} = {},
): Promise<void> {
    const request = options.request ?? apiFetch;
    const cancellation = createRequestCancellation(undefined);
    try {
        await request(STORAGE_CONTEXT_PATHS[session.scope], {
            method: "DELETE",
            headers: {
                [STORAGE_ACCESS_CONTEXT_HEADER]: session.contextId,
                [STORAGE_CLIENT_CREDENTIAL_HEADER]: session.clientCredential,
            },
            // 释放是幂等的，但超时后自动重放会让调用方分不清哪一次的结果；重试由调用方显式决定。
            retry: false,
            notify: false,
            signal: cancellation.signal,
        });
    } finally {
        cancellation.dispose();
    }
}

type StorageContextIssueResult =
    | {readonly status: "issued"; readonly contextId: string}
    | StorageContextUnavailable;

/** 两个 scope 共用同一签发顺序：定位凭证只进请求头，目标字段只进请求体。 */
async function requestStorageContext(
    scope: StorageContextScope,
    credential: string,
    body: {readonly projectRoot: string; readonly publicId: string} | undefined,
    request: StorageHostRequest,
): Promise<StorageContextIssueResult> {
    const cancellation = createRequestCancellation(undefined);
    let payload: unknown;
    try {
        payload = await request(STORAGE_CONTEXT_PATHS[scope], {
            method: "POST",
            headers: {[STORAGE_CLIENT_CREDENTIAL_HEADER]: credential},
            ...(body === undefined ? {} : {body}),
            // 签发不是幂等动作：自动重放会多签一份独立访问，重试由调用方显式决定。
            retry: false,
            // 初始化失败由调用方展示，后台失败不能反复触发全局通知。
            notify: false,
            signal: cancellation.signal,
        });
    } catch (error) {
        return {status: "unavailable", ...describeRequestFailure(error)};
    } finally {
        cancellation.dispose();
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
    return {status: "issued", contextId};
}

function unavailableIdentity(diagnosis: string): StorageContextUnavailable {
    return {status: "unavailable", reason: "identity-unrecoverable", diagnosis, code: null, statusCode: null};
}

function readContextId(payload: unknown): string | null {
    if (typeof payload !== "object" || payload === null || !("contextId" in payload)) return null;
    const contextId: unknown = payload.contextId;
    return typeof contextId === "string" && isStorageAccessContextId(contextId) ? contextId : null;
}

function describeRequestFailure(error: unknown): {
    readonly reason: StorageContextFailureReason;
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
