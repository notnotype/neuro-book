import {describe, expect, it} from "vitest";
import {generateComplexPassword} from "nbook/app/utils/password";

describe("password utils", () => {
    it("生成的复杂密码包含大小写、数字和符号", () => {
        const password = generateComplexPassword();

        expect(password).toHaveLength(20);
        expect(password).toMatch(/[a-z]/);
        expect(password).toMatch(/[A-Z]/);
        expect(password).toMatch(/[0-9]/);
        expect(password).toMatch(/[!@#$%^&*_\-+=?]/);
    });
});
