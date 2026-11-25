import {describe, expect, it} from "bun:test";

import {TELEMETRY_API_PREFIX} from "./index";

describe("统计合同", () => {
    it("路径前缀是 /api/ 下带版本号的一段，不以斜杠结尾", () => {
        expect(TELEMETRY_API_PREFIX).toMatch(/^\/api\/[a-z]+\/v1$/u);
    });
});
