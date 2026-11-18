/**
 * 上传图片的判定：按文件开头的字节，不信客户端给的类型与文件名。SVG 不在内：它不是位图，也没有固定的文件头。
 *
 * 魔数只在这里写一份。收哪几种由调用方定：封面与主题素材只收静态位图（`sniffStillImageType`，不含 GIF），作品里的图片
 * 上传（`nbook.files` 的“写入图片”）多收 GIF（`sniffImageType`）。
 */

export type RasterImageType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

/** 封面、主题素材收的三种：不含会动的 GIF。 */
export type StillImageType = Exclude<RasterImageType, "image/gif">;

export function sniffImageType(bytes: Uint8Array): RasterImageType | null {
    const starts = (...expected: number[]) => expected.every((byte, index) => bytes[index] === byte);
    if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
    if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
    // `GIF87a` 与 `GIF89a`。
    if (starts(0x47, 0x49, 0x46, 0x38) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return "image/gif";
    if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
    return null;
}

/** 只认静态位图：GIF 当作不是图片。 */
export function sniffStillImageType(bytes: Uint8Array): StillImageType | null {
    const type = sniffImageType(bytes);
    return type === "image/gif" ? null : type;
}
