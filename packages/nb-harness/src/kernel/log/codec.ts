/**
 * 日志行的编码：事件加批标记写成一行 JSON；超过阈值的字符串换成 `{$blob, size}`，内容另存。
 * 读回时反过来：引用换回字符串（长度与哈希不符是损坏），去掉批标记得到 `LogEvent`。
 */

import type {BatchMark, BlobRef, JsonValue, LogEvent, LogRecord} from "../api/index.js";
import {BLOB_KEY, BLOB_THRESHOLD, sha256, utf8} from "./json.js";

export interface EncodedBatch {
    /** 整批的字节，每行以换行结束。 */
    readonly bytes: Uint8Array;
    /** 这一批引用的大块内容：哈希 → 内容。 */
    readonly blobs: ReadonlyMap<string, string>;
}

function extract(value: JsonValue, blobs: Map<string, string>): JsonValue {
    if (typeof value === "string") {
        const bytes = utf8(value);
        if (bytes.length <= BLOB_THRESHOLD) return value;
        const hash = sha256(bytes);
        blobs.set(hash, value);
        return {[BLOB_KEY]: hash, size: bytes.length} satisfies BlobRef as unknown as JsonValue;
    }
    if (Array.isArray(value)) return value.map((item: JsonValue) => extract(item, blobs));
    if (value !== null && typeof value === "object") {
        const out: Record<string, JsonValue> = {};
        for (const [key, child] of Object.entries(value)) out[key] = extract(child, blobs);
        return out;
    }
    return value;
}

/** 一个写入批编码成连续的行。只有 `data` 里会有大块内容；其余字段是内核写的短值。 */
export function encodeBatch(events: readonly LogEvent[], batchId: string): EncodedBatch {
    const blobs = new Map<string, string>();
    const lines = events.map((event, index) => {
        const batch: BatchMark = {id: batchId, n: index + 1, of: events.length};
        const record = {...event, data: extract(event.data as JsonValue, blobs), batch};
        return `${JSON.stringify(record)}\n`;
    });
    return {bytes: utf8(lines.join("")), blobs};
}

export function isBlobRef(value: unknown): value is BlobRef {
    return typeof value === "object" && value !== null && !Array.isArray(value) && typeof (value as Record<string, unknown>)[BLOB_KEY] === "string";
}

/** 记录里引用的大块内容的哈希。 */
export function blobRefsOf(value: unknown, into: Set<string> = new Set()): Set<string> {
    if (isBlobRef(value)) into.add(value.$blob);
    else if (Array.isArray(value)) for (const item of value) blobRefsOf(item, into);
    else if (value !== null && typeof value === "object") for (const child of Object.values(value)) blobRefsOf(child, into);
    return into;
}

/** 把引用换回字符串；`contents` 里的内容已核对过哈希与长度。 */
export function resolveBlobs(value: JsonValue, contents: ReadonlyMap<string, string>): JsonValue {
    if (isBlobRef(value)) return contents.get(value.$blob) ?? value;
    if (Array.isArray(value)) return value.map((item: JsonValue) => resolveBlobs(item, contents));
    if (value !== null && typeof value === "object") {
        const out: Record<string, JsonValue> = {};
        for (const [key, child] of Object.entries(value)) out[key] = resolveBlobs(child, contents);
        return out;
    }
    return value;
}

/**
 * 去掉批标记、换回大块内容，得到交给会话的事件。记录是刚解析出来、别处没有引用的对象，就地改，
 * 打开长会话时不必再复制一份全部事件。
 */
export function toEventInPlace(record: LogRecord, contents: ReadonlyMap<string, string>): LogEvent {
    const mutable = record as unknown as {batch?: unknown; data: JsonValue};
    delete mutable.batch;
    if (contents.size > 0) mutable.data = resolveBlobs(mutable.data, contents);
    return record as unknown as LogEvent;
}
