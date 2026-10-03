import {describe, expect, it} from "vitest";
import {inspectStorageJsonValue, STORAGE_MAX_JSON_DEPTH} from "nbook/shared/storage/bounded-json";

/** 建立指定层数的嵌套数组。 */
function nest(depth: number): unknown {
    let value: unknown = null;
    for (let index = 0; index < depth; index += 1) {
        value = [value];
    }
    return value;
}

describe("inspectStorageJsonValue", () => {
    it("无需 Node Buffer 即可度量中文、表情和孤立代理项", () => {
        const previous = globalThis.Buffer;
        const sample = {text: "中文🌱\ud800"};
        const expected = new TextEncoder().encode(JSON.stringify(sample)).byteLength;
        let result;
        try {
            Object.defineProperty(globalThis, "Buffer", {value: undefined, configurable: true, writable: true});
            result = inspectStorageJsonValue(sample, 1024);
        } finally {
            Object.defineProperty(globalThis, "Buffer", {value: previous, configurable: true, writable: true});
        }
        expect(result).toEqual({ok: true, bytes: expected});
    });

    it("拒绝访问器且不执行 getter，允许无循环的重复对象引用", () => {
        let called = false;
        const accessor = {get width() { called = true; return 320; }};
        expect(inspectStorageJsonValue(accessor, 1024)).toMatchObject({ok: false, kind: "invalid"});
        expect(called).toBe(false);
        const leaf = {width: 320};
        expect(inspectStorageJsonValue([leaf, leaf], 1024).ok).toBe(true);
    });

    it("接受普通对象、数组与 JSON 标量并返回 UTF-8 字节数", () => {
        expect(inspectStorageJsonValue({width: 320}, 1024)).toEqual({ok: true, bytes: 13});
        expect(inspectStorageJsonValue([1, 2, 3], 1024)).toEqual({ok: true, bytes: 7});
        expect(inspectStorageJsonValue(null, 1024)).toEqual({ok: true, bytes: 4});
    });

    it("拒绝非有限数字、不可序列化对象与函数", () => {
        for (const value of [Number.NaN, Number.POSITIVE_INFINITY, undefined, () => undefined, Symbol("x"), 1n]) {
            const inspection = inspectStorageJsonValue({value}, 1024);
            expect(inspection).toMatchObject({ok: false, kind: "invalid"});
        }
        for (const value of [new Date(), new Map([["a", 1]]), new Set([1]), new (class Sample {readonly a = 1;})()]) {
            expect(inspectStorageJsonValue(value, 1024)).toMatchObject({ok: false, kind: "invalid"});
        }
    });

    it("拒绝循环引用与稀疏数组空洞", () => {
        const cyclic: Record<string, unknown> = {name: "cyclic"};
        cyclic.self = cyclic;
        expect(inspectStorageJsonValue(cyclic, 1024)).toMatchObject({ok: false, kind: "invalid"});
        const sparse = new Array<number>(3);
        sparse[0] = 1;
        sparse[2] = 3;
        expect(inspectStorageJsonValue(sparse, 1024)).toMatchObject({ok: false, kind: "invalid"});
    });

    it("拒绝超过深度上限的嵌套并接受恰好达到上限的结构", () => {
        expect(inspectStorageJsonValue(nest(STORAGE_MAX_JSON_DEPTH), 64 * 1024)).toMatchObject({ok: true});
        expect(inspectStorageJsonValue(nest(STORAGE_MAX_JSON_DEPTH + 1), 64 * 1024)).toMatchObject({
            ok: false,
            kind: "invalid",
        });
    });

    it("区分非法形态与超限体积", () => {
        expect(inspectStorageJsonValue({text: "12345678"}, 8)).toEqual({ok: false, kind: "oversize", bytes: 19, maxBytes: 8});
        expect(inspectStorageJsonValue({value: Number.NaN}, 8)).toMatchObject({ok: false, kind: "invalid"});
    });
});
