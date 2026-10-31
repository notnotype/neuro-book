/**
 * 日志里的值：能被 JSON 如实表示，键 `$blob` 留给大块内容的引用（docs/specs/harness/session.md“事件”一节的规则）。
 * 内核在写入批之前用 `jsonProblem` 查扩展交来的数据；存储层只信任已查过的事件。
 */

import {createHash} from "node:crypto";

export const BLOB_KEY = "$blob";
/** 大块内容的阈值：UTF-8 字节数。 */
export const BLOB_THRESHOLD = 16 * 1024;

const encoder = new TextEncoder();
export const utf8 = (text: string): Uint8Array => encoder.encode(text);
export const sha256 = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");

/** 值不能被 JSON 如实表示时返回第一处问题（带 JSON Pointer），否则 null。 */
export function jsonProblem(value: unknown, path = ""): string | null {
    const seen = new Set<object>();
    const visit = (item: unknown, at: string): string | null => {
        switch (typeof item) {
            case "string":
            case "boolean":
                return null;
            case "number":
                return Number.isFinite(item) ? null : `${at || "/"}: ${item} is not a finite number`;
            case "object": {
                if (item === null) return null;
                if (seen.has(item)) return `${at || "/"}: circular reference`;
                seen.add(item);
                if (Array.isArray(item)) {
                    for (let index = 0; index < item.length; index += 1) {
                        const problem = visit(item[index], `${at}/${index}`);
                        if (problem !== null) return problem;
                    }
                } else {
                    const prototype = Object.getPrototypeOf(item);
                    if (prototype !== Object.prototype && prototype !== null) return `${at || "/"}: ${prototype?.constructor?.name ?? "object"} is not a plain object`;
                    for (const [key, child] of Object.entries(item)) {
                        if (key === BLOB_KEY) return `${at}/${key}: the key ${BLOB_KEY} is reserved`;
                        const problem = visit(child, `${at}/${key}`);
                        if (problem !== null) return problem;
                    }
                }
                seen.delete(item);
                return null;
            }
            default:
                return `${at || "/"}: ${typeof item} is not a JSON value`;
        }
    };
    return visit(value, path);
}
