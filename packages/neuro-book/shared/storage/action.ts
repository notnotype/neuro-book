/**
 * 值动作的跨端协议。
 *
 * 调用方只提交动作名、owner/key 与可选资源标识，以及该操作的值或条件凭据；
 * scope、locality、主体、客户端、存储根、注册定义与容量都由服务端拥有，不进入请求字段。
 * 请求与响应与 `storage.persistence` 的读取分类、条件凭据同形，入口只转发核心结果，不复制其算法。
 */

import {z} from "zod";
import {
    STORAGE_DEFAULT_MAX_RECORDS,
    STORAGE_MAX_VALUE_BYTES,
    type StorageCredential,
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

/** 修复凭据绑定读取时的原始内容，只能在显式修复/重置时提交。 */
const StorageRepairCredentialSchema = z.object({
    partitionGeneration: z.number().int().min(1),
    contentFingerprint: z.string().min(1).max(128),
});

/**
 * 一次值动作。
 *
 * 未知字段一律拒绝：客户端不能借自定义字段提交 scope、locality、主体或磁盘路径，
 * 也不能用额外的“默认值”字段绕过注册定义的校验与默认值。
 */
export const StorageActionRequestSchema = z.discriminatedUnion("kind", [
    z.object({kind: z.literal("read"), ...StorageAddressFields}).strict(),
    z.object({kind: z.literal("save"), ...StorageAddressFields, expected: StorageCredentialSchema, value: z.unknown()}).strict(),
    z.object({kind: z.literal("remove"), ...StorageAddressFields, expected: StorageCredentialSchema}).strict(),
    z.object({kind: z.literal("migrate"), ...StorageAddressFields, expected: StorageCredentialSchema, value: z.unknown().optional()}).strict(),
    z.object({kind: z.literal("repair"), ...StorageAddressFields, expected: StorageRepairCredentialSchema, value: z.unknown()}).strict(),
    z.object({
        kind: z.literal("reclaim"),
        ...StorageAddressFields,
        targets: z.array(z.object({resource: z.string().min(1).max(63).optional()}).strict())
            .min(1)
            .max(STORAGE_DEFAULT_MAX_RECORDS),
    }).strict(),
]);

export type StorageActionRequest = z.infer<typeof StorageActionRequestSchema>;

/** 动作种类；与核心 `StorageHandle` 的同名能力一一对应。 */
export type StorageActionKind = StorageActionRequest["kind"];

/** 动作结果：读取分类与回收结果直接复用核心形态，保存类动作返回持久化后的条件凭据。 */
export type StorageActionResponse =
    | {readonly kind: "read"; readonly result: StorageReadResult<unknown>}
    | {readonly kind: "save" | "remove" | "migrate" | "repair"; readonly credential: StorageCredential}
    | {readonly kind: "reclaim"; readonly result: StorageReclaimResult};
