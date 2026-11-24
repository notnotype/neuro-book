import {describe, expect, it} from "bun:test";

import {IDENTITY_API_PREFIX} from "./index";

describe("账号合同", () => {
    it("路径前缀是 /api/ 下带版本号的一段，不以斜杠结尾", () => {
        expect(IDENTITY_API_PREFIX).toMatch(/^\/api\/[a-z]+\/v1$/u);
    });
});
