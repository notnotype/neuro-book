import {describe, expect, it, vi} from "vitest";
import {PRODUCT_SHUTDOWN_PATH} from "@notnotype/neuro-book-contracts/product-runtime";

describe("auth middleware user session exemptions", () => {
    it("允许部署健康检查读取应用版本，但不放开其他应用接口", async () => {
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
        const {isPublicPath} = await import("nbook/server/middleware/auth");

        expect(isPublicPath("/api/app/version")).toBe(true);
        expect(isPublicPath(PRODUCT_SHUTDOWN_PATH)).toBe(false);
        expect(isPublicPath("/api/app/logs/status")).toBe(false);

        vi.unstubAllGlobals();
    });

    it("API 路径即使以静态资源扩展名结尾也不公开，静态资源仍公开", async () => {
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
        const {isPublicPath} = await import("nbook/server/middleware/auth");

        expect(isPublicPath("/api/projects/world-engine/slices/chapter.js")).toBe(false);
        expect(isPublicPath("/api/projects/plot/nodes/cover.png")).toBe(false);
        expect(isPublicPath("/api/agent/traces/bucket/trace.map")).toBe(false);
        expect(isPublicPath("/_nuxt/entry.abc123.js")).toBe(true);
        expect(isPublicPath("/images/logo.svg")).toBe(true);
        expect(isPublicPath("/favicon.ico")).toBe(true);

        vi.unstubAllGlobals();
    });

    it("只让精确的 POST shutdown 绕过用户 session 鉴权", async () => {
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
        const {isUserSessionAuthExemptRequest} = await import("nbook/server/middleware/auth");

        expect(isUserSessionAuthExemptRequest(PRODUCT_SHUTDOWN_PATH, "POST")).toBe(true);
        expect(isUserSessionAuthExemptRequest(PRODUCT_SHUTDOWN_PATH, "GET")).toBe(false);
        expect(isUserSessionAuthExemptRequest(`${PRODUCT_SHUTDOWN_PATH}/status`, "POST")).toBe(false);
        expect(isUserSessionAuthExemptRequest("/__nbook/control/restart", "POST")).toBe(false);

        vi.unstubAllGlobals();
    });
});
