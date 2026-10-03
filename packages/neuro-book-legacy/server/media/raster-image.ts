import type {RasterImageMimeType} from "nbook/shared/media/raster-image";

/** 所有服务端光栅图片完整解码入口共用的源像素上限。 */
export const MAX_RASTER_IMAGE_PIXELS = 64 * 1024 * 1024;

export {
    RASTER_IMAGE_MIME_TYPES,
    canonicalImageMime,
    isUnspecifiedImageMime,
    type RasterImageMimeType,
} from "nbook/shared/media/raster-image";

/** 使用魔数识别 PNG、JPEG、GIF 与 WebP，不信任扩展名或请求头。 */
export function imageMimeType(bytes: Uint8Array): RasterImageMimeType | null {
    if (
        bytes.length >= 8
        && bytes[0] === 0x89
        && bytes[1] === 0x50
        && bytes[2] === 0x4e
        && bytes[3] === 0x47
        && bytes[4] === 0x0d
        && bytes[5] === 0x0a
        && bytes[6] === 0x1a
        && bytes[7] === 0x0a
    ) {
        return "image/png";
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return "image/jpeg";
    }
    if (bytes.length >= 6) {
        const header = Buffer.from(bytes.subarray(0, 6)).toString("ascii");
        if (header === "GIF87a" || header === "GIF89a") {
            return "image/gif";
        }
    }
    if (
        bytes.length >= 12
        && Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF"
        && Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP"
    ) {
        return "image/webp";
    }
    return null;
}

/** Sharp 对像素上限的错误文本跨平台略有差异，只在图片解码边界内识别。 */
export function isSharpPixelLimitError(error: unknown): boolean {
    return error instanceof Error && /pixel limit|input image exceeds/iu.test(error.message);
}
