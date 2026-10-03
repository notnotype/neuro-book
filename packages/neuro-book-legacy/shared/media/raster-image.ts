export const RASTER_IMAGE_MIME_TYPES = [
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
] as const;

export type RasterImageMimeType = typeof RASTER_IMAGE_MIME_TYPES[number];

/** 将外部 MIME 收窄为受支持的光栅图片类型。 */
export function canonicalImageMime(value: string): RasterImageMimeType | null {
    const normalized = value.trim().toLowerCase();
    if (normalized === "image/jpg") {
        return "image/jpeg";
    }
    return RASTER_IMAGE_MIME_TYPES.find((mimeType) => mimeType === normalized) ?? null;
}

/**
 * 判断图片上传的 MIME 是否只是传输层占位。
 *
 * 浏览器会把空 File.type 序列化成 application/octet-stream；该值不提供图片类型事实，
 * 最终类型必须由服务端读取原始 bytes 后识别。其它具体 MIME 仍需参与一致性校验。
 */
export function isUnspecifiedImageMime(value?: string): boolean {
    const normalized = value?.trim().toLowerCase() ?? "";
    return normalized === "" || normalized === "application/octet-stream";
}
