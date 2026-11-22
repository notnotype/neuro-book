/**
 * 上传图标的校验（docs/specs/models/service.md 输出 21）：客户端缩好的 PNG，服务端按 PNG 头解析、不信魔数。
 * 纯函数；确认“能显示”（解码一次）由调用方用运行时的图像解码做，这里只管形状。
 */

/** 解码后的上限：边长与字节数（客户端缩到 128 像素，留余量）。 */
export const ICON_MAX_SIDE = 256;
export const ICON_MAX_BYTES = 64 * 1024;

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export type IconCheck = {readonly ok: true; readonly width: number; readonly height: number} | {readonly ok: false; readonly reason: "not-png" | "too-large" | "animated"};

/** 按 PNG 块逐个走：签名、IHDR 的尺寸、第一块 IDAT 之前没有 `acTL`（动图）。 */
export function checkPng(bytes: Uint8Array): IconCheck {
    if (bytes.length > ICON_MAX_BYTES) return {ok: false, reason: "too-large"};
    if (bytes.length < 33 || SIGNATURE.some((value, index) => bytes[index] !== value)) return {ok: false, reason: "not-png"};
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const typeAt = (offset: number): string => String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);
    if (view.getUint32(8) !== 13 || typeAt(12) !== "IHDR") return {ok: false, reason: "not-png"};
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    if (width === 0 || height === 0) return {ok: false, reason: "not-png"};
    if (width > ICON_MAX_SIDE || height > ICON_MAX_SIDE) return {ok: false, reason: "too-large"};
    for (let offset = 8; offset + 12 <= bytes.length;) {
        const length = view.getUint32(offset);
        const type = typeAt(offset + 4);
        if (type === "acTL") return {ok: false, reason: "animated"};
        if (type === "IDAT" || type === "IEND") break;
        offset += 12 + length;
    }
    return {ok: true, width, height};
}

/** 图标文件名：内容的 SHA-256 加 `.png`，同一张图只存一份。 */
export const ICON_NAME = /^[a-f0-9]{64}\.png$/u;
