import {describe, test, expect} from "vitest";
import {encodeVector, decodeVector, cosineSimilarity} from "nbook/server/world-engine/embedding-vector";

describe("embedding-vector", () => {
    test("encode/decode round-trips（Float32 精度内）", () => {
        const v = [0.1, -0.5, 1.0, 0.3333, -0.9999];
        const decoded = decodeVector(encodeVector(v));
        expect(decoded.length).toBe(v.length);
        for (let i = 0; i < v.length; i++) {
            expect(decoded[i]).toBeCloseTo(v[i], 5);
        }
    });

    test("encode 产出 4B × dim 字节", () => {
        expect(encodeVector([1, 2, 3]).byteLength).toBe(12);
    });

    test("decode 拒绝非 4 倍数字节", () => {
        expect(() => decodeVector(new Uint8Array([1, 2, 3]))).toThrow("4 的倍数");
    });

    test("cosine：同向=1，反向=-1，正交=0", () => {
        expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1, 6);
        expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 6);
        expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
    });

    test("cosine：维度不一致 / 零向量返回 0", () => {
        expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
        expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    });

    test("cosine 排序：更相近的得分更高", () => {
        const q = [1, 1, 0];
        const near = cosineSimilarity(q, [1, 0.9, 0]);
        const far = cosineSimilarity(q, [0, 0, 1]);
        expect(near).toBeGreaterThan(far);
    });
});
