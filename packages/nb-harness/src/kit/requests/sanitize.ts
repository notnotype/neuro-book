/**
 * 落盘之前的遮盖与去图（docs/specs/agent/request-trace.md 输出 5、12）。配置密钥原值适配器已经换掉了（models.md 输出 20），
 * 这里按名字补遮头与地址的查询参数，并把所有图片换成类型、字节数与哈希。
 */

import {createHash} from "node:crypto";
import type {ContentBlock, JsonValue, Message} from "../../kernel/contracts.js";

export const MASK = "[REDACTED]";

/** 凭据类的头：只记名字。名字含 `ratelimit` 的是限流信息，照记原值（旧应用 `sanitizeResponseHeaders` 的名单）。 */
const SECRET_HEADERS = new Set(["set-cookie", "cookie", "authorization", "proxy-authorization", "www-authenticate"]);
const SECRET_PARTS = ["token", "secret", "apikey"];
const SECRET_QUERY = new Set(["key", "api_key", "apikey", "token", "access_token", "secret", "signature"]);

export function maskHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) {
        const lower = name.toLowerCase();
        const compact = lower.replaceAll("-", "").replaceAll("_", "");
        const secret = SECRET_HEADERS.has(lower) || (!lower.includes("ratelimit") && SECRET_PARTS.some((part) => compact.includes(part)));
        result[lower] = secret ? MASK : value;
    }
    return result;
}

export function maskUrl(url: string): string {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        // 不是绝对地址（只可能来自自定义的传输）：没有可按名字遮的查询参数，原样记。
        return url;
    }
    for (const name of [...parsed.searchParams.keys()]) if (SECRET_QUERY.has(name.toLowerCase())) parsed.searchParams.set(name, MASK);
    return parsed.href;
}

/**
 * 去过图的图片块：只记类型、字节数与哈希（Spec 输出 12）。去过图的内容只用来落盘与显示大纲，不再交给适配器，所以它不是
 * `ContentBlock`；请求里的块的 `origin` 在运行时照样跟着（展开时带上），类型里不写。
 */
export type StrippedImage = {readonly kind: "image"; readonly mime: string; readonly bytes: number; readonly hash: string; readonly width?: number; readonly height?: number};
export type StoredBlock = Exclude<ContentBlock, {readonly kind: "image"}> | StrippedImage;
export type StoredMessage = Omit<Message, "content"> & {readonly content: readonly StoredBlock[]};

/** base64 的字节数（去掉补位）。 */
function decodedBytes(data: string): number {
    const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
    return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

export const sha256 = (data: string): string => createHash("sha256").update(data).digest("hex");

function stripBlock(block: ContentBlock): StoredBlock {
    if (block.kind !== "image") return block;
    const {data, ...rest} = block;
    return {...rest, bytes: decodedBytes(data), hash: sha256(data)};
}

/** 记录器只对没算过哈希的内容调它（见 `recorder.ts` 的 `#store`），所以每次都复制也不在热路径上。 */
export function stripMessage(message: Message): StoredMessage {
    return {...message, content: message.content.map(stripBlock)};
}

export function stripBlocks(blocks: readonly ContentBlock[]): readonly StoredBlock[] {
    return blocks.map(stripBlock);
}

const DATA_URL = /^data:([^;,]+);base64,/u;
const MIME_FIELDS = ["media_type", "mimeType", "mime_type", "mime"];
/** 只换像图片的长串：短的 `data` 字段多半不是图。 */
const MIN_INLINE_IMAGE = 256;

/**
 * 服务商原生请求体里的图片：OpenAI 的 data URL、Anthropic 的 `source.data`、Gemini 的 `inlineData.data` 都按形状认，
 * 不按服务商分支。解析不了的请求体原样交回（不是 JSON，就没有可认的图片结构）。
 */
export function stripPayloadImages(body: string): string {
    let parsed: unknown;
    try {
        parsed = JSON.parse(body);
    } catch {
        return body;
    }
    const walk = (value: unknown): unknown => {
        if (typeof value === "string") {
            const match = DATA_URL.exec(value);
            return match === null ? value : `[image ${match[1]}, ${String(decodedBytes(value.slice(match[0].length)))} bytes, sha256 ${sha256(value)}]`;
        }
        if (Array.isArray(value)) return value.map(walk);
        if (value === null || typeof value !== "object") return value;
        const object = value as Record<string, unknown>;
        const mimeField = MIME_FIELDS.find((field) => typeof object[field] === "string" && (object[field] as string).startsWith("image/"));
        const result: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(object)) {
            result[key] = mimeField !== undefined && key === "data" && typeof item === "string" && item.length >= MIN_INLINE_IMAGE
                ? `[image ${String(object[mimeField])}, ${String(decodedBytes(item))} bytes, sha256 ${sha256(item)}]`
                : walk(item);
        }
        return result;
    };
    return JSON.stringify(walk(parsed) as JsonValue);
}
