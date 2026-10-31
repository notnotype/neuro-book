/** 存储层的编码小工具：大块内容的阈值、UTF-8 编码与 SHA-256。值的规则在 `api/json-value.ts`。 */

import {createHash} from "node:crypto";

export {BLOB_KEY, jsonProblem} from "../api/index.js";

/** 大块内容的阈值：UTF-8 字节数。 */
export const BLOB_THRESHOLD = 16 * 1024;

const encoder = new TextEncoder();
export const utf8 = (text: string): Uint8Array => encoder.encode(text);
export const sha256 = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");
