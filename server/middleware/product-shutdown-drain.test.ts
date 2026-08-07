import {EventEmitter} from "node:events";
import {beforeEach, describe, expect, it, vi} from "vitest";

const mocks = vi.hoisted(() => ({
    enterRequest: vi.fn<() => {signal: AbortSignal; release: () => void} | null>(),
}));

vi.mock("nbook/server/runtime/shutdown/product-shutdown", () => ({
    productShutdownController: {enterRequest: mocks.enterRequest},
}));

import drainMiddleware from "nbook/server/middleware/product-shutdown-drain";

describe("Product shutdown HTTP drain middleware", () => {
    beforeEach(() => vi.clearAllMocks());

    it("响应结束或连接关闭时只释放一次请求 lease", () => {
        const release = vi.fn();
        mocks.enterRequest.mockReturnValue({signal: new AbortController().signal, release});
        const response = new EventEmitter();
        const context: Record<string, unknown> = {};

        drainMiddleware({context, node: {res: response}} as never);
        response.emit("finish");
        response.emit("close");

        expect(release).toHaveBeenCalledTimes(1);
        expect(context.productShutdownSignal).toBeUndefined();
    });

    it("draining 后拒绝新请求", () => {
        mocks.enterRequest.mockReturnValue(null);

        expect(capture(() => drainMiddleware({context: {}, node: {res: new EventEmitter()}} as never)))
            .toMatchObject({statusCode: 503});
    });
});

/** 捕获同步 H3 middleware 错误。 */
function capture(run: () => unknown): unknown {
    try {
        run();
        throw new Error("预期 middleware 拒绝请求");
    } catch (error) {
        return error;
    }
}
