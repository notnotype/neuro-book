/**
 * Storage 公共边界的可序列化合同。
 *
 * 本文件只承载跨宿主消费的数据形态与限制常量；带函数的运行期状态定义在 `definition.ts`，
 * 服务端实现（文件、锁、订阅）在 `server/storage/`。前端适配器只消费这里的类型与错误 code，
 * 不从这里导入任何宿主对象。
 */

/** 状态归属：user 跨 Project 使用，project 需要明确的有效 Project 上下文。 */
export type StorageScope = "user" | "project";

/** 客户端归属：local 额外按客户端隔离；shared 只省略客户端维度，不表示跨 data 同步。 */
export type StorageLocality = "local" | "shared";

/** 一条记录的逻辑地址；resource 只用于 owner 声明的稳定资源标识。 */
export type StorageAddress = {readonly resource?: string};

/** 单条值的默认上限；owner 可在注册时显式提高到硬上限。 */
export const STORAGE_DEFAULT_MAX_VALUE_BYTES = 64 * 1024;

/** 单条值的硬上限；注册超过它的定义会失败。 */
export const STORAGE_MAX_VALUE_BYTES = 1024 * 1024;

/** 单个实际分区默认记录数上限；删除标记计入条数。 */
export const STORAGE_DEFAULT_MAX_RECORDS = 1024;

/** 单个实际分区默认字节上限；按记录文件大小计。 */
export const STORAGE_DEFAULT_MAX_PARTITION_BYTES = 16 * 1024 * 1024;

/**
 * 记录文件封装版本；与 owner 的 schemaVersion 分别兼容。
 *
 * 读取到更高封装版本必须与损坏区分，并且不得被普通保存覆盖。
 */
export const STORAGE_WRAPPER_VERSION = 1;

/**
 * 逻辑标识（owner / key / resource）允许的单段安全字符集。
 *
 * 只允许小写：大小写不敏感文件系统会把 `Layout` 与 `layout` 折叠成同一路径，不同逻辑键必须在所有平台
 * 落成不同文件，不能依赖调用方碰巧只写小写。
 */
export const STORAGE_IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,62}$/u;

/** 有效容量限制；由定义声明并在注册时冻结。 */
export type StorageLimits = {
    readonly maxValueBytes: number;
    readonly maxRecords: number;
    readonly maxPartitionBytes: number;
};

/**
 * 一次远程 owner 访问捕获的分区代次绑定。
 *
 * 长期句柄用它在接纳边界核对代次：绑定只含分区代次，不含主体、存储根或路径，
 * 也不代替身份核验——每个请求仍要重新核验访问上下文。上下文没有客户端分区时 `local` 为 `null`。
 */
export type StoragePartitionBinding = {
    readonly local: number | null;
    readonly shared: number;
};

/** 记录的条件凭据；`revision: null` 表示读取时该记录缺失。 */
export type StorageCredential = {
    readonly revision: string | null;
    readonly partitionGeneration: number;
};

/** 损坏或未知版本记录的修复凭据；绑定读取时的原始文件内容与分区代次。 */
export type StorageRepairCredential = {
    readonly partitionGeneration: number;
    readonly contentFingerprint: string;
};

/**
 * 读取分类。
 *
 * `missing`、`deleted`、`legacy-value`、`unsupported-version` 与 `corrupt` 必须互不混淆：
 * 缺失不创建默认值记录，未知版本与损坏禁止普通保存，只有 `value` 是当前 schemaVersion 的已确认值。
 * 服务端诊断用于定位坏记录；HTTP adapter 投影为固定公开文案，不能原样公开解析器错误。
 */
export type StorageReadResult<T> =
    | {
        readonly kind: "value";
        readonly value: T;
        readonly schemaVersion: number;
        readonly credential: StorageCredential;
    }
    | {
        /** 低于当前 schemaVersion 的旧值；不做自动迁移，也不按当前规则校验。 */
        readonly kind: "legacy-value";
        readonly value: unknown;
        readonly schemaVersion: number;
        readonly credential: StorageCredential;
    }
    | {readonly kind: "deleted"; readonly credential: StorageCredential}
    | {readonly kind: "missing"; readonly credential: StorageCredential}
    | {
        readonly kind: "unsupported-version";
        readonly wrapperVersion: number | null;
        readonly schemaVersion: number | null;
        readonly diagnosis: string;
        readonly repair: StorageRepairCredential;
    }
    | {
        readonly kind: "corrupt";
        readonly diagnosis: string;
        readonly repair: StorageRepairCredential;
    };

/** 订阅快照与读取分类同形；订阅只报告当前状态，不做每个中间值的审计重放。 */
export type StorageSnapshot<T> = StorageReadResult<T>;

/**
 * 单个回收目标的处理结果；只有 `reclaimed` 表示墓碑已被删除。
 *
 * 这里只报告原因类别，不返回原始错误文本：结果的消费方包括 HTTP 响应，
 * 内部诊断可能带磁盘路径、身份域或锁细节。
 */
export type StorageReclaimOutcome = {
    readonly address: StorageAddress;
    readonly outcome: "reclaimed" | "retained";
    readonly reason?: "live" | "missing" | "broken" | "io-failure";
};

/** 一次墓碑回收的结果；新代次使回收前的全部条件凭据失效。 */
export type StorageReclaimResult = {
    readonly partitionGeneration: number;
    readonly outcomes: readonly StorageReclaimOutcome[];
};
