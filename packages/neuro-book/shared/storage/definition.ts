/**
 * Storage 状态定义与注册表。
 *
 * 定义是运行期对象：owner 在这里声明归属、schemaVersion、默认值、校验、迁移与容量。
 * 注册表同时是类型 token：读写只接受注册时的同一个实例，因此运行期策略与调用方的
 * `DefinedStorageState<T>` 严格绑定，重建定义必须重建注册表。
 */

import {captureStorageJsonValue} from "nbook/shared/storage/bounded-json";
import {
    STORAGE_DEFAULT_MAX_PARTITION_BYTES,
    STORAGE_DEFAULT_MAX_RECORDS,
    STORAGE_DEFAULT_MAX_VALUE_BYTES,
    STORAGE_IDENTIFIER_PATTERN,
    STORAGE_MAX_VALUE_BYTES,
    type StorageLimits,
    type StorageLocality,
    type StorageScope,
} from "nbook/shared/storage/contract";
import {
    StorageDefinitionInvalidError,
    StorageRegistrationConflictError,
    StorageStateUnregisteredError,
} from "nbook/shared/storage/storage-errors";

/** Windows 保留设备名；它们即使在带扩展名时也不是安全文件名。 */
const RESERVED_STORAGE_IDENTIFIERS: Record<string, true> = {
    con: true,
    prn: true,
    aux: true,
    nul: true,
    ...Object.fromEntries(Array.from({length: 9}, (_, index) => [`com${String(index + 1)}`, true as const])),
    ...Object.fromEntries(Array.from({length: 9}, (_, index) => [`lpt${String(index + 1)}`, true as const])),
};

const definedStates = new WeakSet<object>();

/** 判断逻辑标识是否为单段安全名称；拒绝大写、分隔符、点目录、尾点和平台保留名。 */
export function isSafeStorageIdentifier(value: string): boolean {
    if (!STORAGE_IDENTIFIER_PATTERN.test(value) || value.endsWith(".")) {
        return false;
    }
    return RESERVED_STORAGE_IDENTIFIERS[value.split(".", 1)[0]!] !== true;
}

/** owner 声明的状态格式；函数字段只在注册与迁移时使用，不进入任何可序列化 DTO。 */
export type StorageStateDefinition<T> = {
    readonly owner: string;
    readonly key: string;
    readonly scope: StorageScope;
    readonly locality?: StorageLocality;
    /** `single` 表示单例记录；`identified` 要求每次访问都给出稳定资源标识。 */
    readonly records: "single" | "identified";
    readonly schemaVersion: number;
    readonly defaultValue: T;
    readonly validate: (value: unknown) => value is T;
    /** 旧 schemaVersion 的显式迁移；迁移操作在未提供值时调用它。 */
    readonly migrate?: (value: unknown, fromVersion: number) => T;
    readonly limits?: Partial<StorageLimits>;
};

/** 校验并冻结后的定义；limits 已补全为有效值，defaultValue 是已验证的序列化快照。 */
export type DefinedStorageState<T> = Omit<StorageStateDefinition<T>, "limits" | "locality"> & {
    readonly locality: StorageLocality;
    readonly limits: StorageLimits;
    readonly address: string;
};

/**
 * 建立并校验一个状态定义。
 *
 * 单条容量默认 64 KiB，owner 可显式提高到 1 MiB 硬上限；分区条数与字节只能降到默认值以下，
 * 因为 storage.persistence 未给出更高的受信上限。默认值会先序列化再冻结，确保后续写盘的
 * 就是通过校验的那份快照，而不是调用方之后仍可改写的对象。
 */
export function defineStorageState<T>(definition: StorageStateDefinition<T>): DefinedStorageState<T> {
    if (!isSafeStorageIdentifier(definition.owner)) {
        throw new StorageDefinitionInvalidError("owner", `Storage owner 不是安全逻辑标识：${definition.owner}`);
    }
    if (!isSafeStorageIdentifier(definition.key)) {
        throw new StorageDefinitionInvalidError("key", `Storage key 不是安全逻辑标识：${definition.key}`);
    }
    if (definition.scope !== "user" && definition.scope !== "project") {
        throw new StorageDefinitionInvalidError("scope", `Storage scope 非法：${String(definition.scope)}`);
    }
    const locality = definition.locality ?? "local";
    if (locality !== "local" && locality !== "shared") {
        throw new StorageDefinitionInvalidError("locality", `Storage locality 非法：${String(definition.locality)}`);
    }
    if (definition.records !== "single" && definition.records !== "identified") {
        throw new StorageDefinitionInvalidError("records", `Storage 寻址方式非法：${String(definition.records)}`);
    }
    if (!Number.isSafeInteger(definition.schemaVersion) || definition.schemaVersion < 1) {
        throw new StorageDefinitionInvalidError("schemaVersion", `Storage schemaVersion 必须是正整数：${String(definition.schemaVersion)}`);
    }
    const limits = Object.freeze(resolveLimits(definition));
    const inspection = captureStorageJsonValue(definition.defaultValue, limits.maxValueBytes);
    if (!inspection.ok) {
        throw new StorageDefinitionInvalidError("defaultValue", `Storage 默认值不是有限有界 JSON：${describeInspection(inspection)}`);
    }
    if (!definition.validate(inspection.value)) {
        throw new StorageDefinitionInvalidError("defaultValue", `Storage 默认值未通过自身校验：${definition.owner}/${definition.key}`);
    }
    const defaultValue = inspection.value;
    const defined = Object.freeze({
        owner: definition.owner,
        key: definition.key,
        scope: definition.scope,
        locality,
        records: definition.records,
        schemaVersion: definition.schemaVersion,
        defaultValue,
        validate: definition.validate,
        migrate: definition.migrate,
        limits,
        address: `${definition.scope}/${definition.owner}/${definition.key}`,
    });
    definedStates.add(defined);
    return defined;
}

/**
 * 按 owner/key 注册定义。
 *
 * 同一实例重复登记是幂等操作；另一个实例（包括声明完全相同的重新定义）会被拒绝，因为函数字段无法比较，
 * 接受它会让既有句柄的策略在运行期被替换。需要新定义时重建注册表。
 * 同一 owner 在同一 scope/locality 下共用一个实际分区，因此分区容量也必须声明一致。
 */
export class StorageStateRegistry {
    private readonly definitions = new Map<string, DefinedStorageState<unknown>>();
    private readonly partitionLimits = new Map<string, {readonly maxRecords: number; readonly maxPartitionBytes: number}>();

    /** 登记定义；同一 owner/key 的不同实例或不同分区容量都会拒绝启动该 owner。 */
    register<T>(definition: DefinedStorageState<T>): DefinedStorageState<T> {
        if (!definedStates.has(definition)) {
            throw new StorageDefinitionInvalidError("definition", "Storage 注册只接受 defineStorageState 创建的已校验实例");
        }
        const key = storageStateRegistryKey(definition.owner, definition.key);
        const existing = this.definitions.get(key);
        if (existing !== undefined && existing !== definition) {
            throw new StorageRegistrationConflictError(
                definition.owner,
                definition.key,
                `Storage 状态 ${definition.owner}/${definition.key} 已登记另一个定义实例：${existing.address} 与 ${definition.address}`,
            );
        }
        const partitionKey = storagePartitionLimitsKey(definition);
        const registeredLimits = this.partitionLimits.get(partitionKey);
        if (registeredLimits !== undefined
            && (registeredLimits.maxRecords !== definition.limits.maxRecords
                || registeredLimits.maxPartitionBytes !== definition.limits.maxPartitionBytes)) {
            throw new StorageRegistrationConflictError(
                definition.owner,
                definition.key,
                `Storage 分区容量声明不一致：${definition.address} 的 ${String(definition.limits.maxRecords)} 条 / ${String(definition.limits.maxPartitionBytes)} 字节与已登记分区不同`,
            );
        }
        this.partitionLimits.set(partitionKey, {
            maxRecords: definition.limits.maxRecords,
            maxPartitionBytes: definition.limits.maxPartitionBytes,
        });
        this.definitions.set(key, definition as DefinedStorageState<unknown>);
        return definition;
    }

    /** 解析注册策略；只有注册时的同一实例可用，避免用同名定义绕过注册的策略。 */
    resolve<T>(definition: DefinedStorageState<T>): DefinedStorageState<T> {
        const registered = this.definitions.get(storageStateRegistryKey(definition.owner, definition.key));
        if (registered === undefined) {
            throw new StorageStateUnregisteredError(definition.owner, definition.key, "该 owner/key 没有注册定义");
        }
        if (registered !== definition) {
            throw new StorageStateUnregisteredError(
                definition.owner,
                definition.key,
                "传入的不是注册时的同一实例；重建定义必须重建注册表",
            );
        }
        return definition;
    }

    /**
     * 按逻辑地址取回登记定义。
     *
     * HTTP 等边界只有 owner/key，拿不到定义实例；这里只返回注册时的同一实例，
     * 因此调用方的读写策略仍由注册边界决定，不能用同名临时定义绕过校验与容量。
     */
    resolveAddress(owner: string, key: string): DefinedStorageState<unknown> {
        const registered = this.definitions.get(storageStateRegistryKey(owner, key));
        if (registered === undefined) {
            throw new StorageStateUnregisteredError(owner, key, "该 owner/key 没有注册定义");
        }
        return registered;
    }

    /**
     * 按 owner 取回该 owner 已登记的任一实例。
     *
     * 远程分区代次绑定只描述 owner 的分区，不涉及具体 key；这里只确认 owner 已在受信边界登记，
     * 未登记的 owner 拿不到绑定，也就不能用随意的字符串探测分区代次。
     */
    resolveOwner(owner: string): DefinedStorageState<unknown> {
        for (const registered of this.definitions.values()) {
            if (registered.owner === owner) return registered;
        }
        throw new StorageStateUnregisteredError(owner, "*", "该 owner 没有登记任何状态定义");
    }

    /** 列出已登记定义，供宿主暴露或诊断使用。 */
    list(): readonly DefinedStorageState<unknown>[] {
        return [...this.definitions.values()];
    }
}

function resolveLimits(definition: StorageStateDefinition<unknown>): StorageLimits {
    const limits: StorageLimits = {
        maxValueBytes: definition.limits?.maxValueBytes ?? STORAGE_DEFAULT_MAX_VALUE_BYTES,
        maxRecords: definition.limits?.maxRecords ?? STORAGE_DEFAULT_MAX_RECORDS,
        maxPartitionBytes: definition.limits?.maxPartitionBytes ?? STORAGE_DEFAULT_MAX_PARTITION_BYTES,
    };
    if (!Number.isInteger(limits.maxValueBytes) || limits.maxValueBytes < 1 || limits.maxValueBytes > STORAGE_MAX_VALUE_BYTES) {
        throw new StorageDefinitionInvalidError(
            "limits",
            `Storage 单条上限必须介于 1 与 ${String(STORAGE_MAX_VALUE_BYTES)} 字节：${String(limits.maxValueBytes)}`,
        );
    }
    if (!Number.isInteger(limits.maxRecords) || limits.maxRecords < 1 || limits.maxRecords > STORAGE_DEFAULT_MAX_RECORDS) {
        throw new StorageDefinitionInvalidError(
            "limits",
            `Storage 分区条数上限必须介于 1 与 ${String(STORAGE_DEFAULT_MAX_RECORDS)}：${String(limits.maxRecords)}`,
        );
    }
    if (!Number.isInteger(limits.maxPartitionBytes) || limits.maxPartitionBytes < 1 || limits.maxPartitionBytes > STORAGE_DEFAULT_MAX_PARTITION_BYTES) {
        throw new StorageDefinitionInvalidError(
            "limits",
            `Storage 分区字节上限必须介于 1 与 ${String(STORAGE_DEFAULT_MAX_PARTITION_BYTES)}：${String(limits.maxPartitionBytes)}`,
        );
    }
    return limits;
}

function describeInspection(inspection: {readonly kind: "invalid"; readonly reason: string} | {readonly kind: "oversize"; readonly bytes: number; readonly maxBytes: number}): string {
    return inspection.kind === "invalid"
        ? inspection.reason
        : `${String(inspection.bytes)} 字节超过 ${String(inspection.maxBytes)} 字节`;
}

function storageStateRegistryKey(owner: string, key: string): string {
    return `${owner}\u0000${key}`;
}

/** 同一 scope/locality/owner 的定义落在同一个实际分区，容量声明必须唯一。 */
function storagePartitionLimitsKey(definition: DefinedStorageState<unknown>): string {
    return `${definition.scope}\u0000${definition.locality}\u0000${definition.owner}`;
}
