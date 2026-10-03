import {describe, expect, it} from "vitest";
import {sanitizeProviderErrorMessage} from "nbook/server/agent/observability/provider-error-sanitizer";

describe("sanitizeProviderErrorMessage", () => {
    it("清理 bearer、authorization、cookie、api key 和 secret", () => {
        const sanitized = sanitizeProviderErrorMessage("Bearer sk-live-123 authorization=topsecret cookie=session123 api_key=key123 secret: hidden");
        expect(sanitized).not.toContain("sk-live-123");
        expect(sanitized).not.toContain("topsecret");
        expect(sanitized).not.toContain("session123");
        expect(sanitized).not.toContain("key123");
        expect(sanitized).not.toContain("hidden");
    });

    it("限制持久化长度并标记截断", () => {
        const sanitized = sanitizeProviderErrorMessage("x".repeat(8_000));
        expect(sanitized.length).toBeLessThan(4_100);
        expect(sanitized).toContain("Provider 错误已截断");
    });

    it("清理 Basic、JSON header、裸 sk key 和包含空格的 secret", () => {
        const sanitized = sanitizeProviderErrorMessage([
            "Authorization: Basic dXNlcjpwYXNz",
            "{\"api_key\":\"key with spaces\",\"cookie\":\"session=abc; Path=/\"}",
            "upstream rejected sk-live-1234567890",
        ].join("\n"));

        expect(sanitized).not.toContain("dXNlcjpwYXNz");
        expect(sanitized).not.toContain("key with spaces");
        expect(sanitized).not.toContain("session=abc");
        expect(sanitized).not.toContain("sk-live-1234567890");
    });
});
