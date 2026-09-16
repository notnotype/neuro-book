/**
 * `workbench.migration` 的受信状态定义：旧桶迁移原件、进度与完成标记。
 *
 * 归属与容量依据 [迁移合同](../../../../../packages/neuro-book/docs/migrations/storage-state.md)：
 * 原件与元数据属于 data 内的**专用备份边界**，由本 owner 的 user/local 分区拥有，
 * 使用本次迁移版本与来源定位，不跟随尺寸目标的删除或分区回收，也不占其它 owner 的普通状态 quota。
 *
 * 容量分配（硬约束见 `shared/storage/contract.ts`）：
 * - 单条值硬上限 1 MiB → 8 MiB 原件必须**分块**，每块原始预算 384 KiB（UTF-8 字节），
 *   最坏情况（逐字符转义）序列化后仍在 1 MiB 内；
 * - 整个分区 ≤ 16 MiB → 声明 9 MiB：8 MiB 原件 + 进度/完成各 64 KiB + 封装预留；
 * - 分区条数与字节对同一 owner/scope/locality 必须一致，因此四个定义声明同一份 limits。
 *
 * 定义函数只在注册与校验时使用，不进入任何可序列化 DTO。
 */

import {STORAGE_MAX_VALUE_BYTES, type StorageLimits} from "nbook/shared/storage/contract";
import {defineStorageState, type DefinedStorageState} from "nbook/shared/storage/definition";

export const WORKBENCH_MIGRATION_OWNER = "workbench.migration";

/** 本次迁移版本；与来源一起定位原件、进度与完成标记。 */
export const WORKBENCH_MIGRATION_VERSION = 1;

/** 迁移唯一的源桶；其它桶的迁移必须使用自己的版本与来源，不复用本标记。 */
export const WORKBENCH_MIGRATION_SOURCE = "novel.ide.local";

export const WORKBENCH_MIGRATION_ORIGINAL_KEY = "original";
export const WORKBENCH_MIGRATION_CHUNK_KEY = "original-chunk";
export const WORKBENCH_MIGRATION_PROGRESS_KEY = "progress";
export const WORKBENCH_MIGRATION_COMPLETION_KEY = "completion";

/** 原件原始字符串上限 8 MiB（UTF-8 字节）。 */
export const WORKBENCH_MIGRATION_ORIGINAL_LIMIT_BYTES = 8 * 1024 * 1024;
/** 进度与完成元数据上限 64 KiB。 */
export const WORKBENCH_MIGRATION_METADATA_LIMIT_BYTES = 64 * 1024;
/** 单块原文的 UTF-8 字节预算；分块后每条记录仍满足单条硬上限。 */
export const WORKBENCH_MIGRATION_CHUNK_BYTES = 384 * 1024;
/** 分块记录的单条上限取硬上限：原文预算已经保证不会触顶。 */
export const WORKBENCH_MIGRATION_CHUNK_VALUE_BYTES = STORAGE_MAX_VALUE_BYTES;
/** 备份边界分区上限 9 MiB。 */
export const WORKBENCH_MIGRATION_PARTITION_BYTES = 9 * 1024 * 1024;
/** 备份边界条数上限：8 MiB 原件最多 22 块，加三个元数据记录后仍有余量。 */
export const WORKBENCH_MIGRATION_MAX_RECORDS = 64;

const WORKBENCH_MIGRATION_LIMITS: StorageLimits = {
    maxValueBytes: WORKBENCH_MIGRATION_CHUNK_VALUE_BYTES,
    maxRecords: WORKBENCH_MIGRATION_MAX_RECORDS,
    maxPartitionBytes: WORKBENCH_MIGRATION_PARTITION_BYTES,
};

/** 逐项导入结果：只描述本次迁移做了什么，不改变目标权威值。 */
export type WorkbenchMigrationOutcome =
    /** 目标记录从未创建，且源值合法：已条件初始化。 */
    | "imported"
    /** 目标已有记录：按目标权威值恢复，不用源覆盖。 */
    | "already-present"
    /** 用户重置形成的删除标记：不重新导入。 */
    | "tombstoned"
    /** 未知高版本或损坏：保留原件，禁止普通保存。 */
    | "protected"
    /** 源里有该字段但不是合法值：只记诊断，保留原件。 */
    | "invalid-source"
    /** 源里根本没有该字段：使用产品默认，不落盘。 */
    | "source-missing";

/** 迁移的源字段；与旧桶 `pick` 中的三个键同名。 */
export const WORKBENCH_MIGRATION_FIELDS = ["leftPanelWidth", "agentPanelWidth", "projectPickerLayoutMode"] as const;
export type WorkbenchMigrationFieldId = (typeof WORKBENCH_MIGRATION_FIELDS)[number];

/** 原件清单：原始字符串本身按 `chunkCount` 块分别存放，清单最后写入。 */
export type WorkbenchMigrationOriginalRecord = {
    readonly source: string;
    readonly version: number;
    readonly capturedAt: string;
    /** 原始字符串的 UTF-8 字节数（不是 UTF-16 长度）。 */
    readonly byteLength: number;
    /** 非加密摘要：用于检出截断与错配，不用于安全判定。 */
    readonly digest: string;
    readonly chunkCount: number;
    /** 分块时使用的单块字节预算；版本内固定，便于核验算法一致。 */
    readonly chunkBytes: number;
};

/** 一个（目标记录 × 源字段）的进度条目。 */
export type WorkbenchMigrationTargetProgress = {
    /** 稳定目标标识，例如 `surface:idle`、`shelf-mode`。 */
    readonly target: string;
    readonly field: WorkbenchMigrationFieldId;
    readonly outcome: WorkbenchMigrationOutcome;
    readonly at: string;
    /** `imported` 时记录本次提交后的 revision；其它结果没有写入，恒为 null。 */
    readonly revision: string | null;
    readonly diagnosis: string | null;
};

/** 进度：只增不改；重启后按已登记的终态项续跑未完成项，不重复导入。 */
export type WorkbenchMigrationProgressRecord = {
    readonly source: string;
    readonly version: number;
    readonly updatedAt: string;
    readonly entries: readonly WorkbenchMigrationTargetProgress[];
};

/** 完成标记：独立于目标记录与墓碑保留，多标签读取同一份，写完不再改写。 */
export type WorkbenchMigrationCompletionRecord = {
    readonly source: string;
    readonly version: number;
    readonly completedAt: string;
    readonly originalDigest: string;
    /** 本次迁移逐（目标 × 字段）的结果摘要；只描述这一版迁移做过什么。 */
    readonly entries: readonly {
        readonly target: string;
        readonly field: WorkbenchMigrationFieldId;
        readonly outcome: WorkbenchMigrationOutcome;
    }[];
};

const OUTCOMES: Record<string, true> = {
    imported: true,
    "already-present": true,
    tombstoned: true,
    protected: true,
    "invalid-source": true,
    "source-missing": true,
};

const FIELDS: Record<string, true> = Object.fromEntries(WORKBENCH_MIGRATION_FIELDS.map((field) => [field, true]));

/** 记录形状的最外层判据：普通对象；字段含义仍由各定义自己的校验决定。 */
function isMigrationObject(value: unknown): value is {[key: string]: unknown} {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, maxLength: number): value is string {
    return typeof value === "string" && value.length <= maxLength;
}

function isPositiveInteger(value: unknown, max: number): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= max;
}

function isMigrationField(value: unknown): value is WorkbenchMigrationFieldId {
    return typeof value === "string" && FIELDS[value] === true;
}

function isOutcome(value: unknown): value is WorkbenchMigrationOutcome {
    return typeof value === "string" && OUTCOMES[value] === true;
}

export function isWorkbenchMigrationChunk(value: unknown): value is string {
    return typeof value === "string" && value.length > 0;
}

export function isWorkbenchMigrationOriginalRecord(value: unknown): value is WorkbenchMigrationOriginalRecord {
    if (!isMigrationObject(value)) {
        return false;
    }
    return isBoundedString(value.source, 64)
        && isPositiveInteger(value.version, 1024)
        && isBoundedString(value.capturedAt, 40)
        && isPositiveInteger(value.byteLength, WORKBENCH_MIGRATION_ORIGINAL_LIMIT_BYTES)
        && isBoundedString(value.digest, 64)
        && isPositiveInteger(value.chunkCount, WORKBENCH_MIGRATION_MAX_RECORDS)
        && isPositiveInteger(value.chunkBytes, WORKBENCH_MIGRATION_ORIGINAL_LIMIT_BYTES);
}

export function isWorkbenchMigrationTargetProgress(value: unknown): value is WorkbenchMigrationTargetProgress {
    if (!isMigrationObject(value)) {
        return false;
    }
    return isBoundedString(value.target, 64)
        && isMigrationField(value.field)
        && isOutcome(value.outcome)
        && isBoundedString(value.at, 40)
        && (value.revision === null || isBoundedString(value.revision, 128))
        && (value.diagnosis === null || isBoundedString(value.diagnosis, 300));
}

export function isWorkbenchMigrationProgressRecord(value: unknown): value is WorkbenchMigrationProgressRecord {
    if (!isMigrationObject(value) || !isBoundedString(value.source, 64) || !isPositiveInteger(value.version, 1024)
        || !isBoundedString(value.updatedAt, 40)) {
        return false;
    }
    const entries: unknown = value.entries;
    return Array.isArray(entries)
        && entries.length <= WORKBENCH_MIGRATION_FIELDS.length * 8
        && entries.every(isWorkbenchMigrationTargetProgress);
}

export function isWorkbenchMigrationCompletionRecord(value: unknown): value is WorkbenchMigrationCompletionRecord {
    if (!isMigrationObject(value) || !isBoundedString(value.source, 64) || !isPositiveInteger(value.version, 1024)) {
        return false;
    }
    const entries: unknown = value.entries;
    return isBoundedString(value.completedAt, 40)
        && isBoundedString(value.originalDigest, 64)
        && Array.isArray(entries)
        && entries.length <= WORKBENCH_MIGRATION_FIELDS.length * 8
        && entries.every((entry) => isMigrationObject(entry)
            && isBoundedString(entry.target, 64)
            && isMigrationField(entry.field)
            && isOutcome(entry.outcome));
}

/** 原件清单定义：单例，上限取元数据上限。 */
export function defineWorkbenchMigrationOriginalState(): DefinedStorageState<WorkbenchMigrationOriginalRecord> {
    return defineStorageState<WorkbenchMigrationOriginalRecord>({
        owner: WORKBENCH_MIGRATION_OWNER,
        key: WORKBENCH_MIGRATION_ORIGINAL_KEY,
        scope: "user",
        locality: "local",
        records: "single",
        schemaVersion: WORKBENCH_MIGRATION_VERSION,
        defaultValue: {
            source: WORKBENCH_MIGRATION_SOURCE,
            version: WORKBENCH_MIGRATION_VERSION,
            capturedAt: "",
            byteLength: 1,
            digest: "",
            chunkCount: 1,
            chunkBytes: WORKBENCH_MIGRATION_CHUNK_BYTES,
        },
        validate: isWorkbenchMigrationOriginalRecord,
        limits: {...WORKBENCH_MIGRATION_LIMITS, maxValueBytes: WORKBENCH_MIGRATION_METADATA_LIMIT_BYTES},
    });
}

/** 原件分块定义：按 `chunk-000` 这类稳定资源标识寻址。 */
export function defineWorkbenchMigrationChunkState(): DefinedStorageState<string> {
    return defineStorageState<string>({
        owner: WORKBENCH_MIGRATION_OWNER,
        key: WORKBENCH_MIGRATION_CHUNK_KEY,
        scope: "user",
        locality: "local",
        records: "identified",
        schemaVersion: WORKBENCH_MIGRATION_VERSION,
        defaultValue: " ",
        validate: isWorkbenchMigrationChunk,
        limits: WORKBENCH_MIGRATION_LIMITS,
    });
}

/** 进度定义：只增不改，条目数按"目标 × 字段"上限约束。 */
export function defineWorkbenchMigrationProgressState(): DefinedStorageState<WorkbenchMigrationProgressRecord> {
    return defineStorageState<WorkbenchMigrationProgressRecord>({
        owner: WORKBENCH_MIGRATION_OWNER,
        key: WORKBENCH_MIGRATION_PROGRESS_KEY,
        scope: "user",
        locality: "local",
        records: "single",
        schemaVersion: WORKBENCH_MIGRATION_VERSION,
        defaultValue: {
            source: WORKBENCH_MIGRATION_SOURCE,
            version: WORKBENCH_MIGRATION_VERSION,
            updatedAt: "",
            entries: [],
        },
        validate: isWorkbenchMigrationProgressRecord,
        limits: {...WORKBENCH_MIGRATION_LIMITS, maxValueBytes: WORKBENCH_MIGRATION_METADATA_LIMIT_BYTES},
    });
}

/** 完成标记定义：写完不再改写，因此不提供 migrate。 */
export function defineWorkbenchMigrationCompletionState(): DefinedStorageState<WorkbenchMigrationCompletionRecord> {
    return defineStorageState<WorkbenchMigrationCompletionRecord>({
        owner: WORKBENCH_MIGRATION_OWNER,
        key: WORKBENCH_MIGRATION_COMPLETION_KEY,
        scope: "user",
        locality: "local",
        records: "single",
        schemaVersion: WORKBENCH_MIGRATION_VERSION,
        defaultValue: {
            source: WORKBENCH_MIGRATION_SOURCE,
            version: WORKBENCH_MIGRATION_VERSION,
            completedAt: "",
            originalDigest: "",
            entries: [],
        },
        validate: isWorkbenchMigrationCompletionRecord,
        limits: {...WORKBENCH_MIGRATION_LIMITS, maxValueBytes: WORKBENCH_MIGRATION_METADATA_LIMIT_BYTES},
    });
}

/** 备份边界的四个定义：供注册入口与迁移适配器共用同一份声明。 */
export function defineWorkbenchMigrationStates(): readonly DefinedStorageState<unknown>[] {
    return [
        defineWorkbenchMigrationOriginalState(),
        defineWorkbenchMigrationChunkState(),
        defineWorkbenchMigrationProgressState(),
        defineWorkbenchMigrationCompletionState(),
    ];
}

/** 分块资源标识；只在版本内使用，不跨版本复用原件。 */
export function workbenchMigrationChunkResource(index: number): string {
    return `chunk-${String(index).padStart(3, "0")}`;
}
