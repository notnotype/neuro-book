import sharp from "sharp";

export type RasterTestFixtures = {
    png: Buffer;
    jpeg: Buffer;
    webp: Buffer;
    gif: Buffer;
};

/** 生成可完整解码的小型 raster 图片，供 Attachment 与图片工具测试共用。 */
export async function createRasterTestFixtures(): Promise<RasterTestFixtures> {
    const image = sharp({create: {width: 2, height: 2, channels: 4, background: "#224466"}});
    const [png, jpeg, webp] = await Promise.all([
        image.clone().png().toBuffer(),
        image.clone().jpeg().toBuffer(),
        image.clone().webp().toBuffer(),
    ]);
    return {
        png,
        jpeg,
        webp,
        gif: Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64"),
    };
}

/** 只改 JPEG SOF 尺寸，构造不会分配巨幅像素内存的上限 fixture。 */
export function jpegWithDimensions(input: Buffer, width: number, height: number): Buffer {
    const result = Buffer.from(input);
    for (let index = 0; index < result.length - 8; index += 1) {
        const marker = result[index + 1];
        if (result[index] !== 0xff || marker === undefined || !isStartOfFrame(marker)) {
            continue;
        }
        result.writeUInt16BE(height, index + 5);
        result.writeUInt16BE(width, index + 7);
        return result;
    }
    throw new Error("JPEG fixture 缺少 SOF marker");
}

/** 判断 JPEG marker 是否携带宽高。 */
function isStartOfFrame(marker: number): boolean {
    return marker >= 0xc0
        && marker <= 0xcf
        && marker !== 0xc4
        && marker !== 0xc8
        && marker !== 0xcc;
}
