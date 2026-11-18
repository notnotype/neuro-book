/**
 * 表情包页加进来的图（docs/specs/agent/stickers.md 输出 29）：核对类型，超限的静态 PNG、JPEG、WebP 按比例缩到 1024 以内，缩完仍超
 * 2 MiB 的改存 WebP；GIF 与动态 WebP 超限不缩（`Bun.Image` 写不出 GIF，也分不出 GIF 是不是动图），宽乘高超过 `PIXELS_MAX` 的不解码。
 * 纯函数：只看字节与文件名。
 */

import {sniffImageType} from "nbook/shared/image-type";

import {IMAGE_MAX_BYTES, IMAGE_MAX_SIDE, IMAGE_TYPES} from "../shared/contracts";
import {isImageFileName} from "../shared/manifest";

/** 解码前的像素上限：3000 万像素的 RGBA 约 115 MiB，两张同时也在可接受的范围。 */
export const PIXELS_MAX = 30_000_000;

export type RejectReason = "file-invalid" | "type-mismatch" | "unreadable" | "too-many-pixels" | "gif-too-large" | "animated-too-large" | "still-too-large";

export type Prepared = {readonly ok: true; readonly file: string; readonly bytes: Uint8Array; readonly resized: boolean} | {readonly ok: false; readonly reason: RejectReason};

/** 加进来的文件名：单段、不以点开头、扩展名是允许的几种（控制字符与路径分隔符一律不收）。 */
export function uploadName(file: string): boolean {
    return file.length > 0 && file.length <= 255 && !/[/\\:\u0000-\u001f\u007f]/u.test(file) && isImageFileName(file);
}

/** WebP 的 VP8X 块里“有动画”那一位（RIFF 头之后第一个块）。 */
export function isAnimatedWebp(bytes: Uint8Array): boolean {
    const tag = (offset: number): string => String.fromCharCode(...bytes.subarray(offset, offset + 4));
    return bytes.length >= 21 && tag(0) === "RIFF" && tag(8) === "WEBP" && tag(12) === "VP8X" && (bytes[20]! & 0x02) !== 0;
}

const extensionOf = (file: string): string => file.slice(file.lastIndexOf(".") + 1).toLowerCase();
const stemOf = (file: string): string => file.slice(0, file.lastIndexOf("."));

export async function prepareImage(file: string, bytes: Uint8Array): Promise<Prepared> {
    if (!uploadName(file)) return {ok: false, reason: "file-invalid"};
    const type = sniffImageType(bytes);
    if (type === null || type !== IMAGE_TYPES[extensionOf(file)]) return {ok: false, reason: "type-mismatch"};
    let size: {width: number; height: number};
    try {
        size = await new Bun.Image(bytes).metadata();
    } catch {
        return {ok: false, reason: "unreadable"};
    }
    if (size.width * size.height > PIXELS_MAX) return {ok: false, reason: "too-many-pixels"};
    if (size.width <= IMAGE_MAX_SIDE && size.height <= IMAGE_MAX_SIDE && bytes.length <= IMAGE_MAX_BYTES) return {ok: true, file, bytes, resized: false};
    if (type === "image/gif") return {ok: false, reason: "gif-too-large"};
    if (type === "image/webp" && isAnimatedWebp(bytes)) return {ok: false, reason: "animated-too-large"};
    const scale = Math.min(1, IMAGE_MAX_SIDE / size.width, IMAGE_MAX_SIDE / size.height);
    const width = Math.max(1, Math.round(size.width * scale));
    const height = Math.max(1, Math.round(size.height * scale));
    try {
        const resized = new Bun.Image(bytes).resize(width, height);
        const same = await (type === "image/png" ? resized.png() : type === "image/jpeg" ? resized.jpeg({quality: 90}) : resized.webp({quality: 90})).bytes();
        if (same.length <= IMAGE_MAX_BYTES) return {ok: true, file, bytes: same, resized: true};
        const webp = await new Bun.Image(bytes).resize(width, height).webp({quality: 85}).bytes();
        if (webp.length <= IMAGE_MAX_BYTES) return {ok: true, file: `${stemOf(file)}.webp`, bytes: webp, resized: true};
    } catch {
        return {ok: false, reason: "unreadable"};
    }
    return {ok: false, reason: "still-too-large"};
}
