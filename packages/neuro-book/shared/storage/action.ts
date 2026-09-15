/**
 * 值动作的跨端协议。
 *
 * 调用方只提交动作名、owner/key 与可选资源标识、本次消费的定义版本，以及该操作的值或条件凭据；
 * scope、locality、主体、客户端、存储根、注册定义与容量都由服务端拥有，不进入请求字段。
 * 请求与响应与 `storage.persistence` 的读取分类、条件凭据同形，入口只转发核心结果，不复制其算法。
 */

import {z} from "zod";
import {
    STORAGE_DEFAULT_MAX_RECORDS,
    STORAGE_MAX_VALUE_BYTES,
    type StorageCredential,
    type StoragePartitionBinding,
    type StorageReadResult,
    type StorageReclaimResult,
} from "nbook/shared/storage/contract";

/** 动作请求体的字节上限：硬上限的单条值加上有界封装；更大请求在解析前就被拒绝。 */
export const STORAGE_ACTION_BODY_LIMIT_BYTES = STORAGE_MAX_VALUE_BYTES + 64 * 1024;

/**
 * 逻辑标识只约束长度与类型；安全字符集、注册状态与寻址方式由服务端注册边界判定。
 */
const StorageAddressFields = {
    owner: z.string().min(1).max(63),
    key: z.string().min(1).max(63),
    resource: z.string().min(1).max(63).optional(),
} as const;

/** 条件凭据由读取结果原样回传；`revision: null` 表示读取时该记录缺失。 */
const StorageCredentialSchema = z.object({
    revision: z.string().min(1).max(128).nullable(),
    partitionGeneration: z.number().int().min(1),
});

/**
 * 分区代次绑定：`bind` 返回后由值动作原样回传，表示调用方要使用的分区代次。
 *
 * 它只描述代次，不是服务端签发的授权凭据，也不证明来源；服务端按当前代次核对它，
 * 但少传一项就等于要求句柄重新采用当前代次，正是本 DTO 要禁止的静默换版。
 */
const StoragePartitionBindingSchema = z.object({
    local: z.number().int().min(1).nullable(),
    shared: z.number().int().min(1),
}).strict();

/** 修复凭据绑定读取时的原始内容，只能在显式修复/重置时提交。 */
const StorageRepairCredentialSchema = z.object({
    partitionGeneration: z.number().int().min(1),
    contentFingerprint: z.string().min(1).max(128),
});

/**
 * 调用方实际消费的定义版本；服务端取回注册定义后核对必须相等。
 *
 * 双方定义不同版本时，服务端当前的值语义与调用方要写入/解释的语义不是一回事，
 * 因此不相等即拒绝，而不是让调用方按另一个版本继续读写。
 */
const StorageSchemaVersionFields = {
    schemaVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
} as const;

/**
 * 一次值动作。
 *
 * 未知字段一律拒绝：客户端不能借自定义字段提交 scope、locality、主体或磁盘路径，
 * 也不能用额外的“默认值”字段绕过注册定义的校验与默认值。
 * 除 `bind` 外的每个动作都必须带 `bind` 返回的分区代次绑定与本次消费的定义版本；
 * 句柄据此在接纳与读取边界核对代次，服务端据此核对定义版本。
 */
export const StorageActionRequestSchema = z.discriminatedUnion("kind", [
    z.object({kind: z.literal("bind"), owner: z.string().min(1).max(63)}).strict(),
    z.object({kind: z.literal("read"), ...StorageAddressFields, ...StorageSchemaVersionFields, binding: StoragePartitionBindingSchema}).strict(),
    z.object({kind: z.literal("save"), ...StorageAddressFields, ...StorageSchemaVersionFields, binding: StoragePartitionBindingSchema, expected: StorageCredentialSchema, value: z.unknown()}).strict(),
    z.object({kind: z.literal("remove"), ...StorageAddressFields, ...StorageSchemaVersionFields, binding: StoragePartitionBindingSchema, expected: StorageCredentialSchema}).strict(),
    z.object({kind: z.literal("migrate"), ...StorageAddressFields, ...StorageSchemaVersionFields, binding: StoragePartitionBindingSchema, expected: StorageCredentialSchema, value: z.unknown().optional()}).strict(),
    z.object({kind: z.literal("repair"), ...StorageAddressFields, ...StorageSchemaVersionFields, binding: StoragePartitionBindingSchema, expected: StorageRepairCredentialSchema, value: z.unknown()}).strict(),
    z.object({
        kind: z.literal("reclaim"),
        ...StorageAddressFields,
        ...StorageSchemaVersionFields,
        binding: StoragePartitionBindingSchema,
        targets: z.array(z.object({resource: z.string().min(1).max(63).optional()}).strict())
            .min(1)
            .max(STORAGE_DEFAULT_MAX_RECORDS),
    }).strict(),
]);

export type StorageActionRequest = z.infer<typeof StorageActionRequestSchema>;

/** 动作种类；与核心 `StorageHandle` 的同名能力一一对应。 */
export type StorageActionKind = StorageActionRequest["kind"];

/** 值动作必须携带的绑定；来自 `bind` 的返回值，不构成授权。 */
export type StorageValueActionRequest = Exclude<StorageActionRequest, {kind: "bind"}>;

/** 写动作种类；它们的结果形状相同：返回本次提交后的条件凭据。 */
type StorageWriteActionKind = "save" | "remove" | "migrate" | "repair";

/**
 * 动作结果：读取分类与回收结果直接复用核心形态，绑定动作返回 `bind` 时的分区代次。
 *
 * 每个成员只声明自己的 `kind`：把四个写动作写成一个多字面量成员会让
 * `Extract<StorageActionResponse, {kind: K}>` 退化为 never，调用方再也无法按动作分派。
 */
export type StorageActionResponse =
    | {readonly kind: "bind"; readonly binding: StoragePartitionBinding}
    | {readonly kind: "read"; readonly result: StorageReadResult<unknown>}
    | {readonly kind: "reclaim"; readonly result: StorageReclaimResult}
    | {[Kind in StorageWriteActionKind]: {readonly kind: Kind; readonly credential: StorageCredential}}[StorageWriteActionKind];

/** 读取分类与订阅快照的响应校验；值本身只要求是 JSON，由消费定义决定含义。 */
const StorageReadResultSchema = z.discriminatedUnion("kind", [
    z.object({
        kind: z.literal("value"),
        value: z.unknown(),
        schemaVersion: z.number().int().min(1),
        credential: StorageCredentialSchema,
    }).strict(),
    z.object({
        kind: z.literal("legacy-value"),
        value: z.unknown(),
        schemaVersion: z.number().int().min(1),
        credential: StorageCredentialSchema,
    }).strict(),
    z.object({kind: z.literal("deleted"), credential: StorageCredentialSchema}).strict(),
    z.object({kind: z.literal("missing"), credential: StorageCredentialSchema}).strict(),
    z.object({
        kind: z.literal("unsupported-version"),
        wrapperVersion: z.number().int().min(1).nullable(),
        schemaVersion: z.number().int().min(1).nullable(),
        diagnosis: z.string(),
        repair: StorageRepairCredentialSchema,
    }).strict(),
    z.object({
        kind: z.literal("corrupt"),
        diagnosis: z.string(),
        repair: StorageRepairCredentialSchema,
    }).strict(),
]);

const StorageReclaimResultSchema = z.object({
    partitionGeneration: z.number().int().min(1),
    outcomes: z.array(z.object({
        address: z.object({resource: z.string().min(1).max(63).optional()}).strict(),
        outcome: z.enum(["reclaimed", "retained"]),
        reason: z.enum(["live", "missing", "broken", "io-failure"]).optional(),
    }).strict()).max(STORAGE_DEFAULT_MAX_RECORDS),
}).strict();

/**
 * 动作响应的边界校验。
 *
 * 跨网络的对象不是可信输入：响应形状必须与共享合同一致，投影与订阅才能按 kind 分派；
 * 这里只校验结构，值内容仍由 owner 的注册定义解释。
 */
export const StorageActionResponseSchema = z.discriminatedUnion("kind", [
    z.object({kind: z.literal("bind"), binding: StoragePartitionBindingSchema}).strict(),
    z.object({kind: z.literal("read"), result: StorageReadResultSchema}).strict(),
    z.object({kind: z.literal("save"), credential: StorageCredentialSchema}).strict(),
    z.object({kind: z.literal("remove"), credential: StorageCredentialSchema}).strict(),
    z.object({kind: z.literal("migrate"), credential: StorageCredentialSchema}).strict(),
    z.object({kind: z.literal("repair"), credential: StorageCredentialSchema}).strict(),
    z.object({kind: z.literal("reclaim"), result: StorageReclaimResultSchema}).strict(),
]);
