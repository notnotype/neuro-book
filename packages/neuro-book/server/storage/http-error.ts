/**
 * Storage 领域错误到 HTTP 错误的映射。
 *
 * 公开文案来自本合同的白名单：Storage 内部诊断可能带磁盘路径、身份域或锁细节，
 * 不能进入响应；调用方按 `data.code` 分派，不解析 message 文本。
 */

import {createError, type H3Error} from "h3";
import {
    isStorageDomainError,
    StorageClientCredentialInvalidError,
    StorageContextInvalidError,
    StorageLockUnavailableError,
    StorageRequestInvalidError,
    type StorageDomainError,
    type StorageErrorCode,
} from "nbook/shared/storage/storage-errors";

export type StorageHttpErrorData = {
    readonly code: StorageErrorCode;
    /**
     * 公开文案；状态行与 statusMessage 只能是 ASCII，前端展示因此固定读这里，
     * 不依赖响应头的 reason phrase。
     */
    readonly message: string;
    /** 仅带固定枚举的失败类别，不含主体、凭证、身份域或路径。 */
    readonly reason?: string;
    /**
     * 本次 mutation 的真实文件副作用是否已经提交。
     *
     * 锁失败总是携带它（`false` 表示确定没有提交）；其它失败只在提交后失败时携带 `true`。
     * 调用方不能把 `true` 的报告成“未保存”，重试前必须重读当前记录。
     */
    readonly committed?: boolean;
};

/** 每个 Storage 失败种类都有固定公开文案；新增 code 必须同时补齐这里。 */
const STORAGE_PUBLIC_MESSAGES: Record<StorageErrorCode, string> = {
    STORAGE_CLIENT_CREDENTIAL_INVALID: "Storage 请求缺少可用的客户端定位凭证",
    STORAGE_REQUEST_INVALID: "Storage 请求格式不合法",
    STORAGE_DEFINITION_INVALID: "Storage 状态定义不合法",
    STORAGE_REGISTRATION_CONFLICT: "Storage 状态定义与已登记定义冲突",
    STORAGE_STATE_UNREGISTERED: "Storage 状态未在服务端注册",
    STORAGE_CONTEXT_INVALID: "Storage 访问上下文已失效，请重新初始化",
    STORAGE_CONTEXT_LIMIT: "暂时无法建立新的存储连接，请稍后重试",
    STORAGE_ADDRESS_INVALID: "Storage 记录地址不合法",
    STORAGE_VALUE_INVALID: "Storage 状态值不合法",
    STORAGE_VALUE_TOO_LARGE: "Storage 状态值超过单条上限",
    STORAGE_QUOTA_EXCEEDED: "Storage 分区容量已满，请先删除或回收记录",
    STORAGE_REVISION_CONFLICT: "Storage 记录已被其他写入修改，请重读后再保存",
    STORAGE_REPAIR_CONFLICT: "Storage 修复凭据已失效，请重新读取记录",
    STORAGE_CREDENTIAL_STALE: "Storage 条件凭据已失效，请重新初始化",
    STORAGE_WRITE_BLOCKED: "Storage 记录不可按普通保存写入",
    STORAGE_IDENTITY_INVALID: "Storage 身份域元数据无效",
    STORAGE_PARTITION_INVALID: "Storage 分区元数据无效",
    STORAGE_PATH_ESCAPE: "Storage 记录地址越过分区边界",
    STORAGE_LOCK_UNAVAILABLE: "Storage 分区正被其他进程占用，请稍后重试",
    STORAGE_IO_FAILURE: "Storage 读写失败",
    STORAGE_HANDLE_CLOSED: "Storage 句柄已释放",
    STORAGE_SERVICE_CLOSED: "Storage 服务正在关闭，请稍后重试",
};

/** 已知 Storage 领域错误映射为 H3 error；未知错误返回 null，由路由原样抛出。 */
export function createStorageHttpError(error: unknown): H3Error<StorageHttpErrorData> | null {
    if (!isStorageDomainError(error)) return null;
    return storageError(error.statusCode, error.code, STORAGE_PUBLIC_MESSAGES[error.code], {
        ...publicReason(error),
        ...publicCommitted(error),
    });
}

/** 路由与领域入口之间唯一的异步 wrapper；未知错误保持原对象与堆栈。 */
export async function withStorageHttpError<TResult>(handler: () => Promise<TResult>): Promise<TResult> {
    try {
        return await handler();
    } catch (error) {
        throw createStorageHttpError(error) ?? error;
    }
}

/** 使用字符串入口避免 H3 把领域错误保存在 cause；随后只赋值白名单公开字段。 */
function storageError(
    statusCode: number,
    code: StorageErrorCode,
    message: string,
    reason: {readonly reason?: string},
): H3Error<StorageHttpErrorData> {
    const error = createError<StorageHttpErrorData>(message);
    error.statusCode = statusCode;
    error.statusMessage = code;
    error.data = {code, message, ...reason};
    return error;
}

/** 锁失败总是报告提交事实；其它失败只在确实提交后失败时报 `true`，不无差别地声明未写入。 */
function publicCommitted(error: StorageDomainError): {readonly committed?: boolean} {
    if (error instanceof StorageLockUnavailableError) {
        return {committed: error.committed};
    }
    return error.committed === true ? {committed: true} : {};
}

function publicReason(error: unknown): {readonly reason?: string} {
    if (error instanceof StorageRequestInvalidError) {
        if (["body", "action"].includes(error.reason)) {
            return {reason: error.reason};
        }
    }
    if (error instanceof StorageClientCredentialInvalidError || error instanceof StorageContextInvalidError) {
        if (["missing", "malformed", "context-id", "unknown-context", "owner-mismatch", "claims-mismatch", "auth-changed"].includes(error.reason)) {
            return {reason: error.reason};
        }
    }
    return {};
}
