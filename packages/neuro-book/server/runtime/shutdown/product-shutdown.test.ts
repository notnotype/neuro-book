import {beforeEach, describe, expect, it, vi} from "vitest";
import type {ProductShutdownController} from "nbook/server/runtime/shutdown/product-shutdown-controller";

const mocks = vi.hoisted(() => ({
    stopProductRuntime: vi.fn<() => Promise<void>>(),
    flush: vi.fn<() => Promise<void>>(),
}));
vi.mock("nbook/server/app-logs/logger", () => ({appLogger: {flush: mocks.flush, fatalSync: vi.fn()}}));
vi.mock("nbook/server/runtime/product-startup", () => ({stopProductRuntime: mocks.stopProductRuntime}));

let controller: ProductShutdownController;
describe("Product shutdown", () => {
    beforeEach(async () => {
        vi.resetModules();
        vi.resetAllMocks();
        mocks.stopProductRuntime.mockResolvedValue(undefined);
        mocks.flush.mockResolvedValue(undefined);
        controller = (await import("nbook/server/runtime/shutdown/product-shutdown")).productShutdownController;
    });

    it("运行时关闭在途时不刷写日志，全部插件完成后才完成关闭", async () => {
        const close = Promise.withResolvers<void>();
        mocks.stopProductRuntime.mockReturnValue(close.promise);
        const stopping = controller.shutdown();
        await vi.waitFor(() => expect(mocks.stopProductRuntime).toHaveBeenCalledOnce());
        expect(mocks.flush).not.toHaveBeenCalled();
        close.resolve();
        await stopping;
        expect(mocks.flush).toHaveBeenCalledOnce();
    });

    it("运行时关闭不完整仍刷写诊断，最终保留 product-runtime 失败身份", async () => {
        const cause = new Error("plugin release failed");
        mocks.stopProductRuntime.mockRejectedValue(cause);
        await expect(controller.shutdown()).rejects.toMatchObject({
            errors: [expect.objectContaining({message: "Product shutdown step 失败：product-runtime", cause})],
        });
        expect(mocks.flush).toHaveBeenCalledOnce();
    });
});
