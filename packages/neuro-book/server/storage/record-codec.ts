/**
 * 记录文件的封装编解码。
 *
 * 一个文件共同保存封装版本、revision、schemaVersion 与值/删除状态，因此替换成功即整条记录生效。
 * 解析只做格式层分类；“schemaVersion 高于当前定义”由调用方在分类结果上追加判断。
 */

import {createHash} from "node:crypto";
import {STORAGE_WRAPPER_VERSION} from "nbook/shared/storage/contract";

/** 记录文件名后缀；临时文件使用 `.tmp` 后缀，不会被当成正式记录。 */
export const STORAGE_RECORD_FILE_SUFFIX = ".json" as const;

/** 同目录临时文件后缀；写入者负责清理，维护操作可回收崩溃残留。 */
export const STORAGE_TEMP_FILE_SUFFIX = ".tmp" as const;

/** revision 使用随机 UUID；删除后不复用旧标识。 */
export const STORAGE_REVISION_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/**
 * 封装字段（版本、revision、schemaVersion、state 与 JSON 标点）的字节预算。
 *
 * 记录文件的读取上限由“定义声明的单条上限 + 本预算”推出，避免先无界读整份文件再判断大小。
 */
export const STORAGE_RECORD_WRAPPER_MAX_BYTES = 4 * 1024;

/** 已经过格式校验的记录状态。 */
export type StorageStoredRecord =
    | {readonly kind: "value"; readonly revision: string; readonly schemaVersion: number; readonly value: unknown}
    | {readonly kind: "deleted"; readonly revision: string};

/** 记录文件的解析分类；损坏与更高封装版本必须与合法记录区分。 */
export type StorageParsedRecord =
    | StorageStoredRecord
    | {readonly kind: "corrupt"; readonly diagnosis: string}
    | {
        readonly kind: "unsupported-version";
        readonly wrapperVersion: number | null;
        readonly schemaVersion: number | null;
        readonly diagnosis: string;
    };

const VALUE_RECORD_FIELDS: Record<string, true> = {
    wrapper: true,
    revision: true,
    state: true,
    schemaVersion: true,
    value: true,
};
const DELETED_RECORD_FIELDS: Record<string, true> = {
    wrapper: true,
    revision: true,
    state: true,
};

/** 记录文件名判定；容量扫描与清理都只认这个后缀。 */
export function isStorageRecordFileName(name: string): boolean {
    return name.endsWith(STORAGE_RECORD_FILE_SUFFIX);
}

/** 只回收本模块唯一临时名，不能把手工放入的任意 .tmp 文件当作可删除残留。 */
export function isStorageTempFileName(name: string): boolean {
    return name.endsWith(STORAGE_TEMP_FILE_SUFFIX)
        && name.length > 41
        && name.at(-41) === "."
        && STORAGE_REVISION_PATTERN.test(name.slice(-40, -4));
}

/** 绑定原始字节的内容指纹；修复凭据与诊断都用它比较“原内容是否已改变”。 */
export function storageContentFingerprint(raw: string | Buffer): string {
    return `sha256:${createHash("sha256").update(raw).digest("hex")}`;
}

/** 序列化为单行可审查 JSON；结尾换行让记录文件保持普通文本形态。 */
export function serializeStorageRecord(record: StorageStoredRecord): string {
    if (record.kind === "deleted") {
        return `${JSON.stringify({
            wrapper: STORAGE_WRAPPER_VERSION,
            revision: record.revision,
            state: "deleted",
        })}\n`;
    }
    return `${JSON.stringify({
        wrapper: STORAGE_WRAPPER_VERSION,
        revision: record.revision,
        state: "value",
        schemaVersion: record.schemaVersion,
        value: record.value,
    })}\n`;
}

/** 解析记录文件；未知字段、缺失字段与非法状态都归为损坏并给出可诊断原因。 */
export function parseStorageRecord(raw: string): StorageParsedRecord {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {kind: "corrupt", diagnosis: `不是合法 JSON：${message}`};
    }
    if (!isJsonObject(parsed)) {
        return {kind: "corrupt", diagnosis: "记录封装必须是 JSON 对象"};
    }
    const wrapper = parsed.wrapper;
    const schemaVersion = typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : null;
    if (typeof wrapper !== "number" || !Number.isSafeInteger(wrapper) || wrapper < 1) {
        return {kind: "corrupt", diagnosis: "记录封装缺少合法 wrapper 版本"};
    }
    if (wrapper > STORAGE_WRAPPER_VERSION) {
        return {
            kind: "unsupported-version",
            wrapperVersion: wrapper,
            schemaVersion,
            diagnosis: `记录封装版本 ${String(wrapper)} 高于当前支持的 ${String(STORAGE_WRAPPER_VERSION)}`,
        };
    }
    const revision = parsed.revision;
    if (typeof revision !== "string" || !STORAGE_REVISION_PATTERN.test(revision)) {
        return {kind: "corrupt", diagnosis: "记录封装缺少合法 revision"};
    }
    if (parsed.state === "deleted") {
        if (!Object.keys(parsed).every((field) => DELETED_RECORD_FIELDS[field] === true)) {
            return {kind: "corrupt", diagnosis: "删除标记包含未知字段"};
        }
        return {kind: "deleted", revision};
    }
    if (parsed.state === "value") {
        if (!Object.keys(parsed).every((field) => VALUE_RECORD_FIELDS[field] === true)) {
            return {kind: "corrupt", diagnosis: "值记录包含未知字段"};
        }
        if (typeof parsed.schemaVersion !== "number" || !Number.isSafeInteger(parsed.schemaVersion) || parsed.schemaVersion < 1) {
            return {kind: "corrupt", diagnosis: "值记录缺少合法 schemaVersion"};
        }
        if (!Object.hasOwn(parsed, "value")) {
            return {kind: "corrupt", diagnosis: "值记录缺少 value"};
        }
        return {kind: "value", revision, schemaVersion: parsed.schemaVersion, value: parsed.value};
    }
    return {kind: "corrupt", diagnosis: `未知记录状态：${String(parsed.state)}`};
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
