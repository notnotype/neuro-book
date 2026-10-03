import {describe, expect, it} from "vitest";
import {encodeRfc5987Filename} from "nbook/server/utils/rfc5987";

describe("encodeRfc5987Filename", () => {
    it("编码中文、空格和 RFC 5987 保留字符", () => {
        expect(encodeRfc5987Filename("封面 final !'()*.png")).toBe(
            "%E5%B0%81%E9%9D%A2%20final%20%21%27%28%29%2A.png",
        );
    });
});
