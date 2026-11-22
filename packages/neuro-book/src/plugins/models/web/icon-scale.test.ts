/** 上传图标的客户端缩放（同名模块头）：尺寸换算、拒收 SVG 与非图片、读不出、缩后仍过大。 */

import {describe, expect, test} from "bun:test";

import {IconScaleError, scaleIcon} from "./icon-scale";
import type {IconCodec} from "./icon-scale";

const codec = (width: number, height: number, size = 100): {codec: IconCodec; encoded: Array<[number, number]>} => {
    const encoded: Array<[number, number]> = [];
    return {encoded, codec: {decode: async () => ({width, height, encode: async (w, h) => {
        encoded.push([w, h]);
        return new Uint8Array(size).fill(65);
    }})}};
};
const file = (type: string, name = "a.png") => Object.assign(new Blob(["x"], {type}), {name});

describe("scaleIcon", () => {
    test("缩到 128 以内保持比例，小图不放大；结果是 base64", async () => {
        const big = codec(512, 256);
        expect(await scaleIcon(file("image/png"), big.codec)).toBe(btoa("A".repeat(100)));
        expect(big.encoded).toEqual([[128, 64]]);
        const small = codec(32, 16);
        await scaleIcon(file("image/png"), small.codec);
        expect(small.encoded).toEqual([[32, 16]]);
    });

    test("拒收 SVG（按类型与扩展名）、非图片；读不出、缩后仍过大各有原因", async () => {
        const reason = async (promise: Promise<unknown>): Promise<string> => {
            try {
                await promise;
                return "ok";
            } catch (error) {
                return error instanceof IconScaleError ? error.reason : "other";
            }
        };
        expect(await reason(scaleIcon(file("image/svg+xml"), codec(1, 1).codec))).toBe("svg");
        expect(await reason(scaleIcon(file("", "logo.svg"), codec(1, 1).codec))).toBe("svg");
        expect(await reason(scaleIcon(file("text/plain", "a.txt"), codec(1, 1).codec))).toBe("not-image");
        expect(await reason(scaleIcon(file("image/png"), {decode: async () => { throw new Error("bad"); }}))).toBe("read-failed");
        expect(await reason(scaleIcon(file("image/png"), codec(10, 10, 70_000).codec))).toBe("too-large");
    });
});
