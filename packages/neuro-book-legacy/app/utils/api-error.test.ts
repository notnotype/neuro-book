import {describe, expect, it} from "vitest";
import {resolveApiErrorCode} from "nbook/app/utils/api-error";

describe("resolveApiErrorCode", () => {
    it.each([
        [{data: {code: "SESSION_NOT_FOUND"}}],
        [{data: {data: {code: "SESSION_NOT_FOUND"}}}],
        [{response: {_data: {code: "SESSION_NOT_FOUND"}}}],
        [{response: {_data: {data: {code: "SESSION_NOT_FOUND"}}}}],
    ])("读取 $fetch/h3 的稳定业务错误码", (error) => {
        expect(resolveApiErrorCode(error)).toBe("SESSION_NOT_FOUND");
    });

    it("未知或非字符串 code 返回 null", () => {
        expect(resolveApiErrorCode(null)).toBeNull();
        expect(resolveApiErrorCode({data: {code: 404}})).toBeNull();
        expect(resolveApiErrorCode(new Error("failed"))).toBeNull();
    });
});
