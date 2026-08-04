import {describe, expect, it} from "vitest";
import {DEFAULT_PI_MAX_RETRIES, parsePiMaxRetries} from "nbook/shared/dto/pi-request-options.dto";

describe("Pi request options defaults", () => {
    it("未配置时使用默认重试次数", () => {
        expect(DEFAULT_PI_MAX_RETRIES).toBe(5);
        expect(parsePiMaxRetries(undefined)).toBe(5);
    });

    it.each([0, 1, 23])("保留显式 maxRetries=%s", (value) => {
        expect(parsePiMaxRetries(value)).toBe(value);
    });

    it.each([-1, 1.5, "5", null])("拒绝非法 maxRetries=%s", (value) => {
        expect(() => parsePiMaxRetries(value)).toThrow();
    });
});
