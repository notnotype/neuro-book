/**
 * 插件记录的定义与 Storage 的公开接口（docs/specs/storage/persistence.md）。放在 `shared/` 而不是
 * `nbook.storage` 插件里：每个插件都要在运行时调用 `defineRecord`，而插件之间只允许 `import type`。
 *
 * 记录描述是定义去掉类型参数后的纯 JSON；分区拥有者按它的规范 JSON（指纹）判断两份定义是否相同。
 */

import type {Static, TObject, TSchema} from "typebox";

export type RecordScope = "user" | "project";
export type RecordLocality = "local" | "shared";

/** 值的 JSON 文本按 UTF-8 计的字节上限：缺省与最大。 */
export const DEFAULT_RECORD_MAX_BYTES = 64 * 1024;
export const MAX_RECORD_MAX_BYTES = 1024 * 1024;

const KEY_PATTERN = /^[a-z0-9][a-z0-9.-]{0,63}$/u;
const RESOURCE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/u;

/** 分区拥有者核对用的描述：纯 JSON，可经远程服务原样传递。 */
export interface RecordDescriptor {
    readonly key: string;
    readonly scope: RecordScope;
    readonly locality: RecordLocality;
    readonly version: number;
    readonly keyed: boolean;
    readonly maxBytes: number;
    /** TypeBox schema；TypeBox 1.x 的 schema 就是普通 JSON Schema，经 JSON 往返后校验结果不变。 */
    readonly schema: TSchema;
}

declare const recordValue: unique symbol;

/** `defineRecord` 的结果：描述、指纹，以及只在类型上存在的值类型。 */
export interface RecordDefinition<T> extends RecordDescriptor {
    readonly descriptor: RecordDescriptor;
    readonly fingerprint: string;
    readonly [recordValue]?: T;
}

export interface RecordOptions<Schema extends TObject> {
    readonly key: string;
    readonly scope: RecordScope;
    readonly locality?: RecordLocality;
    readonly version: number;
    readonly schema: Schema;
    readonly keyed?: boolean;
    readonly maxBytes?: number;
}

/** 在模块加载时校验定义，不合规则抛 TypeError；返回冻结对象。 */
export function defineRecord<Schema extends TObject>(options: RecordOptions<Schema>): RecordDefinition<Static<Schema>> {
    const descriptor: RecordDescriptor = {
        key: options.key,
        scope: options.scope,
        locality: options.locality ?? "local",
        version: options.version,
        keyed: options.keyed ?? false,
        maxBytes: options.maxBytes ?? DEFAULT_RECORD_MAX_BYTES,
        schema: options.schema,
    };
    const problem = descriptorProblem(descriptor);
    if (problem !== null) throw new TypeError(`记录定义 ${String(options.key)} 不合规则：${problem}`);
    const frozen = Object.freeze(descriptor);
    return Object.freeze({...frozen, descriptor: frozen, fingerprint: recordFingerprint(frozen)});
}

/**
 * 描述的结构问题；没有问题为 null。分区拥有者也用它核对远程调用方带来的描述（同一套规则，不信任对端）。
 */
export function descriptorProblem(value: unknown): string | null {
    if (typeof value !== "object" || value === null) return "描述不是对象";
    const descriptor = value as Record<string, unknown>;
    const extra = Object.keys(descriptor).filter((name) => !["key", "scope", "locality", "version", "keyed", "maxBytes", "schema"].includes(name));
    if (extra.length > 0) return `多出字段 ${extra.join("、")}`;
    if (typeof descriptor.key !== "string" || !KEY_PATTERN.test(descriptor.key)) return "key 须为 1–64 个字符，[a-z0-9] 开头，其余为 [a-z0-9.-]";
    if (descriptor.scope !== "user" && descriptor.scope !== "project") return "scope 须为 user 或 project";
    if (descriptor.locality !== "local" && descriptor.locality !== "shared") return "locality 须为 local 或 shared";
    if (typeof descriptor.version !== "number" || !Number.isSafeInteger(descriptor.version) || descriptor.version < 1) return "version 须为正整数";
    if (typeof descriptor.keyed !== "boolean") return "keyed 须为布尔";
    if (typeof descriptor.maxBytes !== "number" || !Number.isSafeInteger(descriptor.maxBytes) || descriptor.maxBytes < 1 || descriptor.maxBytes > MAX_RECORD_MAX_BYTES) {
        return `maxBytes 须为 1 到 ${String(MAX_RECORD_MAX_BYTES)} 之间的整数`;
    }
    const schema = descriptor.schema as Record<string, unknown> | null;
    if (typeof schema !== "object" || schema === null || schema.type !== "object" || schema.additionalProperties !== false) {
        return "schema 须为顶层 type: object 且 additionalProperties: false 的 TypeBox schema";
    }
    return null;
}

/**
 * 描述的规范 JSON：每一层对象都按键排序后序列化。不能用 `JSON.stringify` 的 replacer 数组排序：它对每一层
 * 都按同一组键过滤，嵌套的 schema 会被清成 `{}`，只差 schema 的两个定义得到同一个指纹。
 */
export function recordFingerprint(descriptor: RecordDescriptor): string {
    return JSON.stringify(canonical(descriptor));
}

function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (typeof value !== "object" || value === null) return value;
    const sorted: Record<string, unknown> = {};
    for (const name of Object.keys(value).sort()) {
        const item = (value as Record<string, unknown>)[name];
        if (item !== undefined) sorted[name] = canonical(item);
    }
    return sorted;
}

/** 资源 id 与 `keyed` 的核对；合规为 null。`keyed: false` 的记录资源 id 为空串。 */
export function resourceProblem(descriptor: Pick<RecordDescriptor, "keyed">, resource: string | undefined): string | null {
    if (!descriptor.keyed) return resource === undefined || resource === "" ? null : "这条记录不按资源 id 寻址，不能给出资源 id";
    if (resource === undefined || resource === "") return "这条记录按资源 id 寻址，必须给出资源 id";
    return RESOURCE_PATTERN.test(resource) ? null : "资源 id 须为 1–128 个字符，[a-z0-9] 开头，其余为 [a-z0-9._-]";
}

// ---------- 服务接口 ----------

/** 记录的修订标识：对插件不透明；分区内单调递增、不复用，但不保证连续。 */
export type Revision = string;

export type StorageFailure =
    | "conflict"
    | "invalid-value"
    | "too-large"
    | "protected"
    | "originals-full"
    | "definition-conflict"
    | "no-client"
    | "no-project"
    | "invalid-resource"
    | "denied"
    | "busy"
    | "io-error"
    | "unavailable"
    | "unknown-outcome";

export const STORAGE_FAILURES: ReadonlyArray<StorageFailure> = [
    "conflict",
    "invalid-value",
    "too-large",
    "protected",
    "originals-full",
    "definition-conflict",
    "no-client",
    "no-project",
    "invalid-resource",
    "denied",
    "busy",
    "io-error",
    "unavailable",
    "unknown-outcome",
];

export type StorageFailed = {readonly ok: false; readonly code: StorageFailure; readonly detail: string};

export type RecordSnapshot<T> =
    | {readonly status: "missing"; readonly revision: Revision | null}
    | {readonly status: "ok"; readonly value: T; readonly revision: Revision}
    | {readonly status: "corrupt" | "unsupported-version"; readonly revision: Revision; readonly detail: string}
    | {readonly status: "error"; readonly code: StorageFailure; readonly detail: string};

export type WriteResult = {readonly ok: true; readonly revision: Revision} | StorageFailed;
export type OpenResult<T> = {readonly ok: true; readonly handle: RecordHandle<T>} | StorageFailed;
export type SubscribeResult = {readonly ok: true; readonly handle: {release(): void}} | StorageFailed;

export interface RecordHandle<T> {
    read(): Promise<RecordSnapshot<T>>;
    /** 条件保存：只在当前 revision 等于 `expect` 时写入；从未写过为 null。 */
    save(value: T, options: {readonly expect: Revision | null}): Promise<WriteResult>;
    /** 条件删除：写入带新 revision 的删除标记。 */
    remove(options: {readonly expect: Revision | null}): Promise<WriteResult>;
    /** 条件写入；当前是 corrupt 或 unsupported-version 时先把原件写进原件区。 */
    reset(value: T, options: {readonly expect: Revision | null}): Promise<WriteResult>;
    /** 先推一次当前快照，之后推送分区拥有者进程里的每次写入。 */
    subscribe(listener: (snapshot: RecordSnapshot<T>) => void, options?: {readonly onEnd?: (reason: string) => void}): Promise<SubscribeResult>;
}

/** `nbook.storage` 交给每个调用方插件的服务；owner 由内核填写的调用方身份决定。 */
export interface StorageService {
    open<T>(record: RecordDefinition<T>, resource?: string): Promise<OpenResult<T>>;
}
