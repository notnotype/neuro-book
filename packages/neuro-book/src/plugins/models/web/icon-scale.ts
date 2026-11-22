/**
 * 上传图标在客户端缩小（docs/specs/models/settings-pages.md 标题区）：读用户选的图片，缩到边长 128 像素以内（保持比例、不放大），
 * 用画布编码成 PNG，交回 base64 字符串（不含 `data:` 前缀）。服务端按 PNG 头再校验一遍，所以这里的失败只用来给用户写原因。
 * 解码与编码是注入的（`IconCodec`）：dom 测试用假的，真实图片在 e2e 里验一条。
 */

export const ICON_SIDE = 128;

export type IconScaleFailure = "not-image" | "svg" | "read-failed" | "too-large";

export class IconScaleError extends Error {
    constructor(readonly reason: IconScaleFailure) {
        super(reason);
    }
}

export interface IconCodec {
    /** 读出图片的像素尺寸与一个把它画到指定大小并编码成 PNG 的函数；读不出时抛错。 */
    decode(file: Blob): Promise<{readonly width: number; readonly height: number; encode(width: number, height: number): Promise<Uint8Array>}>;
}

/** 编码后的上限（与服务端的 64 KB 对齐，留一点余量给 base64 之前的原始字节）。 */
const MAX_BYTES = 60 * 1024;

const toBase64 = (bytes: Uint8Array): string => {
    let binary = "";
    for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
    return btoa(binary);
};

export async function scaleIcon(file: Blob & {readonly name?: string}, codec: IconCodec = browserCodec()): Promise<string> {
    if (file.type === "image/svg+xml" || file.name?.toLowerCase().endsWith(".svg") === true) throw new IconScaleError("svg");
    if (!file.type.startsWith("image/")) throw new IconScaleError("not-image");
    let decoded;
    try {
        decoded = await codec.decode(file);
    } catch {
        throw new IconScaleError("read-failed");
    }
    const ratio = Math.min(1, ICON_SIDE / Math.max(decoded.width, decoded.height));
    const bytes = await decoded.encode(Math.max(1, Math.round(decoded.width * ratio)), Math.max(1, Math.round(decoded.height * ratio)));
    if (bytes.length > MAX_BYTES) throw new IconScaleError("too-large");
    return toBase64(bytes);
}

/** 浏览器的实现：`createImageBitmap` 解码、画布编码。 */
export function browserCodec(): IconCodec {
    const page = globalThis as unknown as {
        createImageBitmap(blob: Blob): Promise<{readonly width: number; readonly height: number; close(): void}>;
        document: {createElement(tag: "canvas"): {width: number; height: number; getContext(kind: "2d"): {drawImage(image: unknown, x: number, y: number, w: number, h: number): void} | null; toBlob(callback: (blob: Blob | null) => void, type: string): void}};
    };
    return {
        async decode(file) {
            const bitmap = await page.createImageBitmap(file);
            return {
                width: bitmap.width,
                height: bitmap.height,
                encode: async (width, height) => {
                    const canvas = page.document.createElement("canvas");
                    canvas.width = width;
                    canvas.height = height;
                    const context = canvas.getContext("2d");
                    if (context === null) throw new Error("no 2d canvas");
                    context.drawImage(bitmap, 0, 0, width, height);
                    bitmap.close();
                    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
                    if (blob === null) throw new Error("encoding failed");
                    return new Uint8Array(await blob.arrayBuffer());
                },
            };
        },
    };
}
