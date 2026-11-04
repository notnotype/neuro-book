/**
 * `read` 交给模型的图片（docs/specs/agent/builtin-tools.md 输出 7），做法照 omp 的 `resizeImage`：图片随日志留在会话里、每次请求都发，
 * 所以压得比服务商的上限紧得多；太小的图服务商会报 400，而它已经进了日志，这个会话之后每次请求都会失败，所以要放大。
 */

const MAX_EDGE = 1_568;
const MIN_EDGE = 200;
const TARGET_BYTES = 500 * 1024;
/** 比它小又尺寸合适的不重新编码：省不了多少，还会损失画质。 */
const COMFORTABLE_BYTES = TARGET_BYTES / 4;
const FIRST_QUALITY = 80;
const QUALITIES = [70, 60, 50, 40];
const SCALES = [1, 0.75, 0.5, 0.35, 0.25];
/** 缩小到这以下模型也看不清了，不再往下缩。 */
const SMALLEST_EDGE = 100;

export interface PreparedImage {
    readonly data: Uint8Array;
    readonly mime: string;
    readonly width: number;
    readonly height: number;
    readonly originalWidth: number;
    readonly originalHeight: number;
}

/** 只读文件头：JPEG 没有透明；PNG 看颜色类型与 `tRNS`；别的格式（WebP、GIF）不解析，当作可能有。 */
function mayHaveAlpha(bytes: Uint8Array): boolean {
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return false;
    if (bytes[0] !== 0x89 || bytes[1] !== 0x50) return true;
    const colorType = bytes[25];
    if (colorType === 4 || colorType === 6) return true;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = 33; offset + 8 <= bytes.length; offset += 12 + view.getUint32(offset)) {
        const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
        if (type === "tRNS") return true;
        if (type === "IDAT") return false;
    }
    return false;
}

/** 比例不变：先缩到上限内，短边不够再放大，放大不越过上限（细长的图短边可以小于下限）。 */
function targetSize(width: number, height: number): {readonly width: number; readonly height: number} {
    const down = Math.min(1, MAX_EDGE / Math.max(width, height));
    const shrunk = {width: width * down, height: height * down};
    const up = Math.max(1, Math.min(MIN_EDGE / Math.min(shrunk.width, shrunk.height), MAX_EDGE / Math.max(shrunk.width, shrunk.height)));
    return {width: Math.max(1, Math.round(shrunk.width * up)), height: Math.max(1, Math.round(shrunk.height * up))};
}

interface Encoded {
    readonly data: Uint8Array;
    readonly mime: string;
}

const smallest = (candidates: readonly Encoded[]): Encoded => candidates.reduce((best, item) => (item.data.length < best.data.length ? item : best));

/** 抛错说明解码或编码失败（文件头对、内容坏）。 */
export async function prepareImage(bytes: Uint8Array, format: "png" | "jpeg" | "gif" | "webp"): Promise<PreparedImage> {
    const {width: originalWidth, height: originalHeight} = await new Bun.Image(bytes).metadata();
    const original = {originalWidth, originalHeight};
    const fits = Math.max(originalWidth, originalHeight) <= MAX_EDGE && Math.min(originalWidth, originalHeight) >= MIN_EDGE;
    if (fits && format !== "gif" && bytes.length <= COMFORTABLE_BYTES) return {data: bytes, mime: `image/${format}`, width: originalWidth, height: originalHeight, ...original};

    const alpha = mayHaveAlpha(bytes);
    const lossy = async (source: Uint8Array, quality: number): Promise<Encoded> => smallest(await Promise.all([
        new Bun.Image(source).webp({quality}).bytes().then((data) => ({data, mime: "image/webp"})),
        ...(alpha ? [] : [new Bun.Image(source).jpeg({quality}).bytes().then((data) => ({data, mime: "image/jpeg"}))]),
    ]));
    const size = targetSize(originalWidth, originalHeight);
    const resized = await new Bun.Image(bytes).resize(size.width, size.height, {fit: "fill"}).png().bytes();
    let best = smallest([{data: resized, mime: "image/png"}, await lossy(resized, FIRST_QUALITY)]);
    if (best.data.length <= TARGET_BYTES) return {...best, ...size, ...original};

    for (const scale of SCALES) {
        const width = Math.round(size.width * scale);
        const height = Math.round(size.height * scale);
        if (Math.min(width, height) < SMALLEST_EDGE) break;
        const source = scale === 1 ? resized : await new Bun.Image(bytes).resize(width, height, {fit: "fill"}).png().bytes();
        for (const quality of QUALITIES) {
            best = await lossy(source, quality);
            if (best.data.length <= TARGET_BYTES) return {...best, width, height, ...original};
        }
    }
    // 压到头也超目标：交回最后一档，由服务商的上限（通常 5 MB）兜底。
    const last = SCALES.findLast((scale) => Math.min(size.width * scale, size.height * scale) >= SMALLEST_EDGE) ?? 1;
    return {...best, width: Math.round(size.width * last), height: Math.round(size.height * last), ...original};
}
