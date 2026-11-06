/** 上传图片的判定（封面、主题场景素材共用）：按文件开头的字节，不信客户端给的类型与文件名。SVG 不在内：它不是位图，也没有固定的文件头。 */

export type RasterImageType = "image/png" | "image/jpeg" | "image/webp";

export function sniffImageType(bytes: Uint8Array): RasterImageType | null {
    const starts = (...expected: number[]) => expected.every((byte, index) => bytes[index] === byte);
    if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
    if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
    if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
    return null;
}
