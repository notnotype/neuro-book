import {describe, expect, it} from "vitest";
import {IMAGE_VARIANT_PRESETS, ImageVariantError} from "nbook/server/media/image-variant";
import {parseImageVariantQuery} from "nbook/server/media/image-variant-query";

describe("parseImageVariantQuery", () => {
    it("没有变体参数时保留原图语义", () => {
        expect(parseImageVariantQuery({})).toBeNull();
    });

    it("preset 与显式同规格返回相同规范化结构", () => {
        expect(parseImageVariantQuery({preset: "project-cover"})).toEqual(IMAGE_VARIANT_PRESETS["project-cover"]);
        expect(parseImageVariantQuery({width: "384", height: "576", fit: "cover", quality: "80"}))
            .toEqual(IMAGE_VARIANT_PRESETS["project-cover"]);
        expect(parseImageVariantQuery({width: "768"})).toEqual(IMAGE_VARIANT_PRESETS["attachment-chat"]);
        expect(parseImageVariantQuery({width: 768, quality: 80})).toEqual(IMAGE_VARIANT_PRESETS["attachment-chat"]);
    });

    it.each([
        [{preset: "project-cover", width: "384"}, "preset 不能"],
        [{preset: "missing"}, "未知"],
        [{quality: "80"}, "至少提供一个"],
        [{width: "0"}, "1..2048"],
        [{width: "2049"}, "1..2048"],
        [{width: "1.5"}, "整数"],
        [{width: ["100", "200"]}, "单个非空值"],
        [{width: false}, "单个非空值"],
        [{width: "100", fit: "cover"}, "同时提供"],
        [{width: "100", fit: "fill"}, "cover 或 contain"],
        [{width: "100", quality: "39"}, "40..95"],
        [{width: "100", quality: "96"}, "40..95"],
    ] as const)("拒绝非法查询 %#", (query, message) => {
        expect(() => parseImageVariantQuery(query)).toThrowError(message);
        try {
            parseImageVariantQuery(query);
        } catch (error) {
            expect(error).toBeInstanceOf(ImageVariantError);
            expect((error as ImageVariantError).code).toBe("INVALID_IMAGE_VARIANT");
        }
    });
});
