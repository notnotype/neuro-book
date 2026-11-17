/**
 * 图片类型的判定（`shared/image-type.ts`）：按文件开头的字节，四种位图；静态判定不含 GIF。封面、主题素材与主题包导入各自
 * 的“GIF 被拒”在它们自己的测试里（`cover-routes.test.ts`、`theme-asset-route.test.ts`、`package-io.test.ts`）。
 */

import {describe, expect, it} from "bun:test";

import {sniffImageType, sniffStillImageType} from "./image-type";

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10);
const GIF89 = bytes(...ascii("GIF89a"), 1, 0, 1, 0);
const GIF87 = bytes(...ascii("GIF87a"), 1, 0, 1, 0);
const WEBP = bytes(...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP"), ...ascii("VP8 "));

describe("按文件头判定位图类型", () => {
    it("PNG、JPEG、GIF（87a 与 89a）、WebP", () => {
        expect(sniffImageType(PNG)).toBe("image/png");
        expect(sniffImageType(JPEG)).toBe("image/jpeg");
        expect(sniffImageType(GIF89)).toBe("image/gif");
        expect(sniffImageType(GIF87)).toBe("image/gif");
        expect(sniffImageType(WEBP)).toBe("image/webp");
    });

    it("不是这四种的都不是：文本、SVG、WAV（RIFF 但不是 WEBP）、`GIF8` 后面不是 7 或 9 加 a、空与太短的", () => {
        for (const body of [bytes(), bytes(0x89, 0x50), new TextEncoder().encode("<svg/>"), new TextEncoder().encode("hello"), bytes(...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WAVE")), bytes(...ascii("GIF88a")), bytes(...ascii("GIF89b"))]) {
            expect(sniffImageType(body)).toBeNull();
        }
    });

    it("静态判定把 GIF 当作不是图片，别的照常", () => {
        expect(sniffStillImageType(GIF89)).toBeNull();
        expect(sniffStillImageType(GIF87)).toBeNull();
        expect([sniffStillImageType(PNG), sniffStillImageType(JPEG), sniffStillImageType(WEBP)]).toEqual(["image/png", "image/jpeg", "image/webp"]);
    });
});
