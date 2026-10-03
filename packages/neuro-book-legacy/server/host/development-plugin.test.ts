import {describe, expect, it, beforeEach, vi} from "vitest";

const mocks = vi.hoisted(() => ({
    start: vi.fn(),
    stop: vi.fn<() => Promise<void>>(),
    fatalSync: vi.fn(),
}));
vi.mock("nitropack/runtime", () => ({defineNitroPlugin: (plugin: unknown) => plugin}));
vi.mock("nbook/server/runtime/product-startup", () => ({
    startProductRuntime: mocks.start,
}));
vi.mock("nbook/server/app-logs/logger", () => ({appLogger: {fatalSync: mocks.fatalSync}}));
import plugin from "./development-plugin";

describe("开发初始化适配器", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.start.mockReturnValue({stop: mocks.stop});
        mocks.stop.mockResolvedValue(undefined);
    });

    it("开发实例关闭失败写致命诊断并结算，不向 Nitro 抛错", async () => {
        const closeHooks: Array<() => Promise<void>> = [];
        plugin({hooks: {hook: (_name: string, handler: () => Promise<void>) => {closeHooks.push(handler);}}} as never);
        expect(closeHooks).toHaveLength(1);
        const failure = new Error("plugin close failed");
        mocks.stop.mockRejectedValue(failure);
        await closeHooks[0]!();
        expect(mocks.fatalSync).toHaveBeenCalledWith("product.shutdown.failed", undefined, failure, expect.any(String));
    });
});
