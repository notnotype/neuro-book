import {describe, expect, it} from "vitest";
import {
    RASTER_IMAGE_MIME_TYPES,
    canonicalImageMime,
    isUnspecifiedImageMime,
} from "nbook/shared/media/raster-image";

describe("raster image MIME contract", () => {
    it("统一规范化受支持的 MIME，并兼容 image/jpg", () => {
        expect(RASTER_IMAGE_MIME_TYPES).toEqual([
            "image/png",
            "image/jpeg",
            "image/gif",
            "image/webp",
        ]);
        expect(canonicalImageMime(" IMAGE/PNG ")).toBe("image/png");
        expect(canonicalImageMime("image/jpg")).toBe("image/jpeg");
        expect(canonicalImageMime("image/JPEG")).toBe("image/jpeg");
    });

    it("拒绝空值、非图片和未支持的图片格式", () => {
        expect(canonicalImageMime("")).toBeNull();
        expect(canonicalImageMime("text/html")).toBeNull();
        expect(canonicalImageMime("image/svg+xml")).toBeNull();
    });

    it("只把空值和 application/octet-stream 视为未声明图片 MIME", () => {
        expect(isUnspecifiedImageMime()).toBe(true);
        expect(isUnspecifiedImageMime("  ")).toBe(true);
        expect(isUnspecifiedImageMime(" APPLICATION/OCTET-STREAM ")).toBe(true);
        expect(isUnspecifiedImageMime("text/plain")).toBe(false);
        expect(isUnspecifiedImageMime("image/svg+xml")).toBe(false);
        expect(isUnspecifiedImageMime("image/png")).toBe(false);
    });
});
