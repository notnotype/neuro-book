/**
 * Storage 稳定失败合同。
 *
 * 每个失败都有独立 code 与 HTTP 映射，宿主按 code 分派，不解析 message 文本。
 * 基类沿用 Project Domain Error 的版本化全局构造器，使 HMR 后的旧模块仍能通过 instanceof 识别新错误。
 */

/** Storage 失败种类；新增种类必须同时给出 HTTP 映射与可观察的触发条件。 */
export type StorageErrorCode =
    | "STORAGE_CLIENT_CREDENTIAL_INVALID"
    | "STORAGE_REQUEST_INVALID"
    | "STORAGE_DEFINITION_INVALID"
    | "STORAGE_REGISTRATION_CONFLICT"
    | "STORAGE_STATE_UNREGISTERED"
    | "STORAGE_SCHEMA_MISMATCH"
    | "STORAGE_CONTEXT_INVALID"
    | "STORAGE_CONTEXT_LIMIT"
    | "STORAGE_ADDRESS_INVALID"
    | "STORAGE_VALUE_INVALID"
    | "STORAGE_VALUE_TOO_LARGE"
    | "STORAGE_QUOTA_EXCEEDED"
    | "STORAGE_REVISION_CONFLICT"
    | "STORAGE_REPAIR_CONFLICT"
    | "STORAGE_CREDENTIAL_STALE"
    | "STORAGE_WRITE_BLOCKED"
    | "STORAGE_IDENTITY_INVALID"
    | "STORAGE_PARTITION_INVALID"
    | "STORAGE_PATH_ESCAPE"
    | "STORAGE_LOCK_UNAVAILABLE"
    | "STORAGE_IO_FAILURE"
    | "STORAGE_HANDLE_CLOSED"
    | "STORAGE_SERVICE_CLOSED";

class StorageDomainErrorDefinition extends Error {
    declare readonly code: StorageErrorCode;
    declare readonly statusCode: number;
    /**
     * 本次 mutation 的真实文件副作用是否已经提交。
     *
     * 只有提交后失败的操作携带它：调用方据此区分“确定未写入”和“已提交但结果未确认”，
     * 不能把后者报告成未保存或自动重放。
     */
    declare committed?: boolean;

    /** 建立带稳定 code 的 Storage 领域错误；code 与 statusCode 保持非枚举，避免意外进入响应。 */
    constructor(code: StorageErrorCode, statusCode: number, message: string, options?: ErrorOptions) {
        super(message, options);
        Object.defineProperty(this, "code", {configurable: false, enumerable: false, value: code, writable: false});
        Object.defineProperty(this, "statusCode", {configurable: false, enumerable: false, value: statusCode, writable: false});
    }
}

type StorageDomainErrorConstructor = typeof StorageDomainErrorDefinition;

const globalForStorageDomainError = globalThis as typeof globalThis & {
    __nbookStorageDomainErrorV1?: StorageDomainErrorConstructor;
};

/** 版本化全局构造器只保存 nominal identity，不持有文件、锁或订阅资源。 */
export const StorageDomainError = globalForStorageDomainError.__nbookStorageDomainErrorV1
    ??= StorageDomainErrorDefinition;

export type StorageDomainError = InstanceType<StorageDomainErrorConstructor>;

/** 先验证 HMR 稳定基类，再比较 exact code；不接受 name/message 形似的普通对象。 */
export function isStorageDomainError(error: unknown, code?: StorageErrorCode): error is StorageDomainError {
    return error instanceof StorageDomainError && (code === undefined || error.code === code);
}

/** 状态定义在注册前就被拒绝：标识、schemaVersion、默认值或限制不合法。 */
export class StorageDefinitionInvalidError extends StorageDomainError {
    readonly reason: string;

    constructor(reason: string, message: string) {
        super("STORAGE_DEFINITION_INVALID", 500, message);
        this.name = "StorageDefinitionInvalidError";
        this.reason = reason;
    }
}

/** 同一 owner/key 已经登记了不兼容定义；两个声明不能共存。 */
export class StorageRegistrationConflictError extends StorageDomainError {
    readonly owner: string;
    readonly key: string;

    constructor(owner: string, key: string, message: string) {
        super("STORAGE_REGISTRATION_CONFLICT", 500, message);
        this.name = "StorageRegistrationConflictError";
        this.owner = owner;
        this.key = key;
    }
}

/** 调用方提交了未在本服务注册的 owner/key 或不同实例的定义，拒绝用临时定义读写。 */
export class StorageStateUnregisteredError extends StorageDomainError {
    readonly owner: string;
    readonly key: string;
    readonly detail: string;

    constructor(owner: string, key: string, detail: string) {
        super("STORAGE_STATE_UNREGISTERED", 500, `Storage 状态未注册：${owner}/${key}（${detail}）`);
        this.name = "StorageStateUnregisteredError";
        this.owner = owner;
        this.key = key;
        this.detail = detail;
    }
}

/**
 * 调用方消费的定义版本与注册定义不一致：值语义由版本决定，服务端不能替它解释另一个版本。
 *
 * 与磁盘记录的 legacy/unsupported 分类独立：那些描述已存记录的格式，这里描述双方当前的定义。
 */
export class StorageSchemaMismatchError extends StorageDomainError {
    readonly consumedVersion: number;
    readonly registeredVersion: number;

    constructor(consumedVersion: number, registeredVersion: number) {
        super(
            "STORAGE_SCHEMA_MISMATCH",
            409,
            `Storage 定义版本不一致：调用方消费 ${String(consumedVersion)}，服务端注册 ${String(registeredVersion)}`,
        );
        this.name = "StorageSchemaMismatchError";
        this.consumedVersion = consumedVersion;
        this.registeredVersion = registeredVersion;
    }
}

/**
 * 请求没有携带可用的客户端定位凭证；服务端不接受调用方自报 clientId。
 *
 * message 只描述格式要求：原始凭证不进错误响应、日志或任何持久化记录。
 */
export class StorageClientCredentialInvalidError extends StorageDomainError {
    readonly reason: "missing" | "malformed";

    constructor(reason: "missing" | "malformed", message: string) {
        super("STORAGE_CLIENT_CREDENTIAL_INVALID", 400, message);
        this.name = "StorageClientCredentialInvalidError";
        this.reason = reason;
    }
}

/**
 * 请求体或逻辑地址不是本合同的合法动作；形状问题与状态内容问题分开报告。
 *
 * HTTP 入口在读取注册定义之前拒绝它，因此不合法的动作不会触碰任何记录文件。
 */
export class StorageRequestInvalidError extends StorageDomainError {
    readonly reason: string;

    constructor(reason: string, message: string) {
        super("STORAGE_REQUEST_INVALID", 400, message);
        this.name = "StorageRequestInvalidError";
        this.reason = reason;
    }
}

/** 活跃访问达到上限，拒绝新签发以保留现有访问。 */
export class StorageContextLimitError extends StorageDomainError {
    constructor() {
        super("STORAGE_CONTEXT_LIMIT", 503, "Storage 活跃访问上下文已达容量上限");
        this.name = "StorageContextLimitError";
    }
}

/** 宿主上下文或句柄绑定不满足访问前提；失败不给可写句柄。 */
export class StorageContextInvalidError extends StorageDomainError {
    readonly reason: string;

    constructor(reason: string, message: string) {
        super("STORAGE_CONTEXT_INVALID", 403, message);
        this.name = "StorageContextInvalidError";
        this.reason = reason;
    }
}

/** 记录地址与定义声明的寻址方式不符，或资源标识不合法。 */
export class StorageAddressInvalidError extends StorageDomainError {
    readonly reason: string;

    constructor(reason: string, message: string) {
        super("STORAGE_ADDRESS_INVALID", 400, message);
        this.name = "StorageAddressInvalidError";
        this.reason = reason;
    }
}

/** 值不是有限有界 JSON，或未通过注册的校验规则。 */
export class StorageValueInvalidError extends StorageDomainError {
    readonly reason: string;

    constructor(reason: string, message: string) {
        super("STORAGE_VALUE_INVALID", 400, message);
        this.name = "StorageValueInvalidError";
        this.reason = reason;
    }
}

/** 单条值超过该定义声明的上限。 */
export class StorageValueTooLargeError extends StorageDomainError {
    readonly bytes: number;
    readonly maxBytes: number;

    constructor(bytes: number, maxBytes: number) {
        super("STORAGE_VALUE_TOO_LARGE", 413, `Storage 值 ${String(bytes)} 字节超过上限 ${String(maxBytes)} 字节`);
        this.name = "StorageValueTooLargeError";
        this.bytes = bytes;
        this.maxBytes = maxBytes;
    }
}

/** 该写入会让分区超过条数或字节容量；减少占用的更新不受影响。 */
export class StorageQuotaExceededError extends StorageDomainError {
    readonly limit: "records" | "bytes";
    readonly projected: number;
    readonly max: number;

    constructor(limit: "records" | "bytes", projected: number, max: number) {
        super(
            "STORAGE_QUOTA_EXCEEDED",
            409,
            limit === "records"
                ? `Storage 分区记录数将达到 ${String(projected)}，超过上限 ${String(max)}`
                : `Storage 分区字节将达到 ${String(projected)}，超过上限 ${String(max)}`,
        );
        this.name = "StorageQuotaExceededError";
        this.limit = limit;
        this.projected = projected;
        this.max = max;
    }
}

/** 条件凭据的 revision 与当前记录不一致；调用方须重读或显式放弃。 */
export class StorageRevisionConflictError extends StorageDomainError {
    readonly expectedRevision: string | null;
    readonly observedRevision: string | null;

    constructor(expectedRevision: string | null, observedRevision: string | null) {
        super(
            "STORAGE_REVISION_CONFLICT",
            409,
            `Storage 记录 revision 已变化：期望 ${expectedRevision ?? "缺失"}，当前 ${observedRevision ?? "缺失"}`,
        );
        this.name = "StorageRevisionConflictError";
        this.expectedRevision = expectedRevision;
        this.observedRevision = observedRevision;
    }
}

/** 修复凭据绑定的原始内容已经改变，或待修复记录不存在。 */
export class StorageRepairConflictError extends StorageDomainError {
    readonly expectedFingerprint: string;
    readonly observedFingerprint: string | null;

    constructor(expectedFingerprint: string, observedFingerprint: string | null) {
        super(
            "STORAGE_REPAIR_CONFLICT",
            409,
            `Storage 修复凭据已失效：期望 ${expectedFingerprint}，当前 ${observedFingerprint ?? "缺失"}`,
        );
        this.name = "StorageRepairConflictError";
        this.expectedFingerprint = expectedFingerprint;
        this.observedFingerprint = observedFingerprint;
    }
}

/** 条件凭据或句柄绑定的分区代次已被显式回收替换；调用方须重新初始化。 */
export class StorageCredentialStaleError extends StorageDomainError {
    readonly scope: "handle" | "credential";
    readonly expectedGeneration: number;
    readonly currentGeneration: number;

    constructor(scope: "handle" | "credential", expectedGeneration: number, currentGeneration: number) {
        super(
            "STORAGE_CREDENTIAL_STALE",
            409,
            scope === "handle"
                ? `Storage 句柄绑定代次 ${String(expectedGeneration)} 已失效，当前代次 ${String(currentGeneration)}`
                : `Storage 条件凭据绑定代次 ${String(expectedGeneration)} 已失效，当前代次 ${String(currentGeneration)}`,
        );
        this.name = "StorageCredentialStaleError";
        this.scope = scope;
        this.expectedGeneration = expectedGeneration;
        this.currentGeneration = currentGeneration;
    }
}

/** 记录不可按当前操作写入：未知更高版本、损坏、待迁移旧值或不是值记录。 */
export class StorageWriteBlockedError extends StorageDomainError {
    readonly reason: "corrupt" | "unsupported-version" | "legacy-value" | "no-value-record";
    readonly diagnosis: string;

    constructor(reason: "corrupt" | "unsupported-version" | "legacy-value" | "no-value-record", diagnosis: string) {
        super("STORAGE_WRITE_BLOCKED", 409, `Storage 记录不可按普通保存写入（${reason}）：${diagnosis}`);
        this.name = "StorageWriteBlockedError";
        this.reason = reason;
        this.diagnosis = diagnosis;
    }
}

/** 身份域元数据缺失以外的问题：文件损坏或版本不受支持。 */
export class StorageIdentityInvalidError extends StorageDomainError {
    readonly diagnosis: string;

    constructor(diagnosis: string) {
        super("STORAGE_IDENTITY_INVALID", 500, `Storage 身份域元数据无效：${diagnosis}`);
        this.name = "StorageIdentityInvalidError";
        this.diagnosis = diagnosis;
    }
}

/** 分区元数据损坏或版本不受支持；无法安全判断代次时失败关闭。 */
export class StoragePartitionInvalidError extends StorageDomainError {
    readonly diagnosis: string;

    constructor(diagnosis: string) {
        super("STORAGE_PARTITION_INVALID", 500, `Storage 分区元数据无效：${diagnosis}`);
        this.name = "StoragePartitionInvalidError";
        this.diagnosis = diagnosis;
    }
}

/** 逻辑地址的真实路径越过存储根：路径穿越或符号链接逃逸。 */
export class StoragePathEscapeError extends StorageDomainError {
    readonly target: string;

    constructor(target: string, detail: string) {
        super("STORAGE_PATH_ESCAPE", 500, `Storage 路径越过存储根：${target}（${detail}）`);
        this.name = "StoragePathEscapeError";
        this.target = target;
    }
}

/** 分区锁竞争超时、被判失效，或释放结果无法确认；已提交事实不因此回滚。 */
export class StorageLockUnavailableError extends StorageDomainError {
    readonly reason: "contended" | "compromised" | "release";
    /** 锁失败总是携带提交事实：释放结果未确认时调用方必须重读当前记录。 */
    declare committed: boolean;

    constructor(reason: "contended" | "compromised" | "release", committed: boolean, options?: ErrorOptions) {
        super(
            "STORAGE_LOCK_UNAVAILABLE",
            503,
            reason === "contended"
                ? "Storage 分区锁被其他进程占用，等待期限内未取得"
                : reason === "compromised"
                    ? "Storage 分区锁已失效，停止写入"
                    : `Storage 分区锁释放结果未确认（已提交：${String(committed)}）`,
            options,
        );
        this.name = "StorageLockUnavailableError";
        this.reason = reason;
        this.committed = committed;
    }
}

/** 文件系统读写失败；读取失败不得当作缺失，保存失败不得删除有效原件。 */
export class StorageIoError extends StorageDomainError {
    readonly operation: "read" | "write" | "replace" | "remove" | "mkdir" | "stat";
    readonly target: string;

    constructor(
        operation: StorageIoError["operation"],
        target: string,
        message: string,
        options?: ErrorOptions,
    ) {
        super("STORAGE_IO_FAILURE", 500, `Storage ${operation} 失败：${target}（${message}）`, options);
        this.name = "StorageIoError";
        this.operation = operation;
        this.target = target;
    }
}

/** 句柄已释放或被服务关闭，不再接纳新操作。 */
export class StorageHandleClosedError extends StorageDomainError {
    readonly reason: "released" | "service-closed";

    constructor(owner: string, reason: "released" | "service-closed") {
        super(
            "STORAGE_HANDLE_CLOSED",
            409,
            reason === "released"
                ? `Storage 句柄已释放：${owner}`
                : `Storage 服务已关闭，句柄停止服务：${owner}`,
        );
        this.name = "StorageHandleClosedError";
        this.reason = reason;
    }
}

/** 服务已关闭，拒绝新句柄与新操作。 */
export class StorageServiceClosedError extends StorageDomainError {
    constructor() {
        super("STORAGE_SERVICE_CLOSED", 503, "Storage 服务已关闭，不再接纳句柄");
        this.name = "StorageServiceClosedError";
    }
}
