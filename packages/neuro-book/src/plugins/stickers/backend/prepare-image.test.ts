/**
 * 加图的核对与缩小（docs/specs/agent/stickers.md 输出 29）：纯函数，图片由 `Bun.Image` 现做。像素上限的样本改小图的 PNG 头（宽高写大），
 * 不真的解出几千万像素；GIF 过大的样本是在小 GIF 后面补零字节。
 */

import {describe, expect, test} from "bun:test";
import {deflateSync} from "node:zlib";

import {IMAGE_MAX_BYTES, IMAGE_MAX_SIDE} from "../shared/contracts";
import {isAnimatedWebp, prepareImage, uploadName} from "./prepare-image";

const PIXEL = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), (char) => char.charCodeAt(0));
const GIF = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), (char) => char.charCodeAt(0));
const png = (width: number, height: number): Promise<Uint8Array> => new Bun.Image(PIXEL).resize(width, height).png().bytes();
const jpeg = (width: number, height: number): Promise<Uint8Array> => new Bun.Image(PIXEL).resize(width, height).jpeg().bytes();
const sizeOf = async (bytes: Uint8Array): Promise<{width: number; height: number; format: string}> => new Bun.Image(bytes).metadata() as Promise<{width: number; height: number; format: string}>;

/** 不压缩的 PNG（zlib 的存储块）装随机像素：压不下去，比 2 MiB 大。 */
function noisePng(width: number, height: number): Uint8Array {
    let seed = 0x2545f491;
    const row = 1 + width * 3;
    const raw = new Uint8Array(row * height);
    for (let at = 0; at < raw.length; at += 1) {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        raw[at] = at % row === 0 ? 0 : seed & 0xff;
    }
    const chunk = (type: string, data: Uint8Array): Uint8Array => {
        const out = new Uint8Array(12 + data.length);
        const view = new DataView(out.buffer);
        view.setUint32(0, data.length);
        out.set(new TextEncoder().encode(type), 4);
        out.set(data, 8);
        view.setUint32(8 + data.length, Bun.hash.crc32(out.subarray(4, 8 + data.length)));
        return out;
    };
    const header = new Uint8Array(13);
    new DataView(header.buffer).setUint32(0, width);
    new DataView(header.buffer).setUint32(4, height);
    header.set([8, 2, 0, 0, 0], 8);
    const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw, {level: 0})), chunk("IEND", new Uint8Array())];
    return Uint8Array.from(parts.flatMap((part) => [...part]));
}

describe("加图的文件名", () => {
    test("单段、不以点开头、扩展名是允许的几种；路径分隔符、冒号与控制字符不收", () => {
        for (const good of ["开心.png", "a.JPG", "b-2.webp", "c.gif", "d.jpeg"]) expect(uploadName(good)).toBe(true);
        for (const bad of ["a/b.png", "a\\b.png", ".hidden.png", "readme.txt", "a:b.png", "a\u0001.png", "png", ".png", ""]) expect(uploadName(bad)).toBe(false);
    });
});

describe("图片的核对与缩小", () => {
    test("不超限的原样收下", async () => {
        const bytes = await png(64, 64);
        const result = await prepareImage("开心.png", bytes);
        expect(result).toEqual({ok: true, file: "开心.png", bytes, resized: false});
    });

    test("宽或高超过 1024 的静态图按比例缩到 1024 以内，格式与文件名不变", async () => {
        const big = await prepareImage("大.png", await png(2000, 1500));
        if (!big.ok) throw new Error(big.reason);
        expect(big).toMatchObject({file: "大.png", resized: true});
        expect(await sizeOf(big.bytes)).toMatchObject({width: IMAGE_MAX_SIDE, height: 768, format: "png"});
        const photo = await prepareImage("照.jpg", await jpeg(700, 1400));
        if (!photo.ok) throw new Error(photo.reason);
        expect(await sizeOf(photo.bytes)).toMatchObject({width: 512, height: IMAGE_MAX_SIDE, format: "jpeg"});
    });

    test("类型与扩展名对不上、读不出的拒绝", async () => {
        expect(await prepareImage("a.jpg", await png(8, 8))).toEqual({ok: false, reason: "type-mismatch"});
        expect(await prepareImage("a.png", new TextEncoder().encode("not an image"))).toEqual({ok: false, reason: "type-mismatch"});
        expect(await prepareImage("a/b.png", await png(8, 8))).toEqual({ok: false, reason: "file-invalid"});
        // 头是 PNG、后面是垃圾：读不出宽高。
        expect(await prepareImage("a.png", PIXEL.subarray(0, 12))).toEqual({ok: false, reason: "unreadable"});
    });

    test("宽乘高超过 3000 万像素的不解码（样本改了 PNG 头：6000 × 6000）", async () => {
        const wide = PIXEL.slice();
        new DataView(wide.buffer).setUint32(16, 6000);
        new DataView(wide.buffer).setUint32(20, 6000);
        expect(await prepareImage("宽.png", wide)).toEqual({ok: false, reason: "too-many-pixels"});
    });

    test("GIF 超过 2 MiB 一律拒绝（缩不了）；不超限的照收", async () => {
        const padded = new Uint8Array(IMAGE_MAX_BYTES + 1024);
        padded.set(GIF);
        expect(await prepareImage("动.gif", padded)).toEqual({ok: false, reason: "gif-too-large"});
        expect(await prepareImage("动.gif", GIF)).toMatchObject({ok: true, resized: false});
    });

    test("动态 WebP 只看 VP8X 块的动画位", () => {
        const header = (flags: number): Uint8Array => {
            const bytes = new Uint8Array(30);
            bytes.set(new TextEncoder().encode("RIFF"), 0);
            bytes.set(new TextEncoder().encode("WEBPVP8X"), 8);
            bytes[20] = flags;
            return bytes;
        };
        expect(isAnimatedWebp(header(0x12))).toBe(true);
        expect(isAnimatedWebp(header(0x10))).toBe(false);
        expect(isAnimatedWebp(new Uint8Array(30))).toBe(false);
    });

    test("尺寸不超限、字节超过 2 MiB 的静态图（随机像素的 PNG）：重新编码后仍超就改存 WebP，扩展名跟着变", async () => {
        const noise = noisePng(900, 900);
        expect(noise.length).toBeGreaterThan(IMAGE_MAX_BYTES);
        const result = await prepareImage("噪.png", noise);
        if (!result.ok) throw new Error(result.reason);
        expect(result.file).toBe("噪.webp");
        expect(result.bytes.length).toBeLessThanOrEqual(IMAGE_MAX_BYTES);
        expect(await sizeOf(result.bytes)).toMatchObject({width: 900, height: 900, format: "webp"});
    });
});
