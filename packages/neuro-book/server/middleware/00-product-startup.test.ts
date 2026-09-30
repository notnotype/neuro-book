import {afterEach, describe, expect, it, vi} from "vitest";

const mocks = vi.hoisted(() => ({
    productRuntimeReady: vi.fn<() => Promise<void>>(),
    exitOnProductStartupFailure: vi.fn(),
}));
vi.mock("nbook/server/runtime/product-startup", () => ({
    productRuntimeReady: mocks.productRuntimeReady,
    exitOnProductStartupFailure: mocks.exitOnProductStartupFailure,
}));

describe("product startup middleware", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.resetModules();
    });

    it("启动失败时交给有序退出，而不是抛出会被 Nitro 吞掉的未捕获异常", async () => {
        const failure = new Error("migration pending");
        mocks.productRuntimeReady.mockImplementation(() => Promise.reject(failure));
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);

        await import("nbook/server/middleware/00-product-startup");

        await vi.waitFor(() => expect(mocks.exitOnProductStartupFailure).toHaveBeenCalledWith(failure));
    });
});
