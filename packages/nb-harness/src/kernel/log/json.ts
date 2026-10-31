/** 存储层的编码小工具：大块内容的阈值、UTF-8 编码与 SHA-256。值的规则在 `api/json-value.ts`。 */

import {createHash} from "node:crypto";

export {BLOB_KEY, jsonProblem} from "../api/index.js";

/** 大块内容的阈值：UTF-8 字节数。 */
export const BLOB_THRESHOLD = 16 * 1024;

const encoder = new TextEncoder();
export const utf8 = (text: string): Uint8Array => encoder.encode(text);
export const sha256 = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");

/** 键按字典序排好的 JSON：同一个值不论键的先后都得同一串，用来比较、算哈希。 */
export function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(",")}]`;
    if (value !== null && typeof value === "object") {
        const entries = Object.entries(value).filter(([, child]) => child !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
    }
    return JSON.stringify(value);
}
